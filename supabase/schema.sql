-- ============================================================================
-- 选秀台 (Draft Stage) — Phase 3: Backend Foundation
-- ============================================================================
-- Run this entire file once in the Supabase SQL Editor (or via `supabase db
-- push` / psql) against a fresh project. It is safe to re-run: everything is
-- guarded with IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE.
--
-- Design summary
-- --------------
-- This project intentionally does NOT use Supabase Auth (no auth.users, no
-- email, no OAuth). Accounts are plain rows in our own `accounts` table,
-- authenticated with Username + Password checked against a bcrypt hash.
--
-- Because the browser only ever holds the public "anon" API key (never a
-- secret), nothing sensitive can be protected by client-side checks alone.
-- So the security model is:
--
--   * `accounts`      — safe-to-read columns only (no password). RLS allows
--                        anyone to SELECT. Realtime is enabled on this table,
--                        so the Admin Dashboard's user list updates live.
--   * `credentials`   — holds only `account_id` + `password_hash`. RLS has
--                        NO policies at all, so it is completely
--                        unreachable from the browser. Only reachable from
--                        inside SECURITY DEFINER functions below.
--   * `invite_codes`  — RLS has NO policies. Codes are never sent to a
--                        browser that hasn't proven (via a valid session
--                        token) that it belongs to an Admin/Developer
--                        account. This is what actually makes the invite
--                        system a gate — if the codes were publicly
--                        readable, anyone could read and use them.
--   * `sessions`      — a lightweight token issued at login, checked by
--                        every privileged function below in place of
--                        Supabase Auth's JWT. RLS locked, RPC-only.
--   * `sync_events`   — a tiny public, realtime-enabled "doorbell" table
--                        with no sensitive payload (just a scope name). The
--                        Admin Dashboard subscribes to it and re-fetches
--                        invite codes whenever a change happens, giving
--                        real-time sync without ever exposing codes over
--                        the realtime/WAL feed.
--
-- All writes (register, login, edit, delete, promote, demote, invite-code
-- management) go through SECURITY DEFINER functions ("RPC functions") so
-- permission checks are enforced in the database, not just hidden in the
-- UI. The browser can never write to `accounts`, `credentials`, or
-- `invite_codes` directly — table-level privileges are revoked from the
-- anon/authenticated roles for every write operation.
-- ============================================================================

-- Supabase projects conventionally install extensions into the
-- `extensions` schema (not `public`). Every SECURITY DEFINER function
-- below sets search_path to include `extensions`, so crypt()/gen_salt()
-- resolve correctly however this ends up installed. This block is a
-- no-op if pgcrypto is already installed anywhere (a fresh Supabase
-- project pre-installs it into `extensions`), and falls back to
-- installing into `public` on a plain Postgres instance that has no
-- `extensions` schema at all.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pgcrypto') then
    return;
  end if;

  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'create extension pgcrypto with schema extensions';
  else
    execute 'create extension pgcrypto';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table if not exists public.accounts (
  id               uuid primary key default gen_random_uuid(),
  username         text not null unique,
  display_name     text not null,
  tournament_role  text check (tournament_role in ('captain', 'player')),
  permission_role  text not null default 'user' check (permission_role in ('developer', 'admin', 'user')),
  avatar_url       text,
  created_at       timestamptz not null default now()
);

comment on table public.accounts is
  'Public-safe account rows (no password). Readable by anyone with the anon key; writes only via SECURITY DEFINER functions.';

create table if not exists public.credentials (
  account_id     uuid primary key references public.accounts(id) on delete cascade,
  password_hash  text not null
);

comment on table public.credentials is
  'Password hashes. RLS locked with zero policies — unreachable from the browser under any circumstance.';

create table if not exists public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  max_uses    integer not null default 1 check (max_uses > 0),
  used_count  integer not null default 0 check (used_count >= 0),
  expires_at  timestamptz,
  created_by  uuid references public.accounts(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.invite_codes is
  'Invite codes. RLS locked with zero policies — only readable/writable via Admin/Developer-gated RPC functions.';

create table if not exists public.sessions (
  token        uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  last_seen_at timestamptz not null default now()
);

comment on table public.sessions is
  'Custom session tokens (stand-in for Supabase Auth JWTs, since Supabase Auth is intentionally not used). A session is only considered alive while both expires_at is in the future AND last_seen_at is within the heartbeat timeout -- see _session_timeout().';

alter table public.sessions add column if not exists last_seen_at timestamptz not null default now();

create table if not exists public.sync_events (
  id          bigint generated always as identity primary key,
  scope       text not null,
  event       text not null,
  created_at  timestamptz not null default now()
);

comment on table public.sync_events is
  'Public realtime "doorbell" with no sensitive payload. Lets clients know to re-fetch invite codes without exposing codes over realtime.';

create table if not exists public.tournament_participants (
  account_id  uuid primary key references public.accounts(id) on delete cascade,
  joined_at   timestamptz not null default now()
);

comment on table public.tournament_participants is
  'Phase 4: players who have joined the current tournament. Public read (safe -- just account_id + joined_at). Only removed by leave_tournament, an explicit player action -- a disconnect or heartbeat timeout never removes a row here, per the Tournament Lobby product decision that participation and online status are separate concepts.';

create table if not exists public.presence (
  account_id    uuid primary key references public.accounts(id) on delete cascade,
  last_seen_at  timestamptz not null default now()
);

comment on table public.presence is
  'Public-safe last-seen timestamp per account, deliberately separate from the locked public.sessions table. Upserted by login/register, heartbeat, and every _current_session_account()-gated RPC call; deleted outright on explicit logout. Clients compare last_seen_at against the same _session_timeout() window used for session liveness to render Online/Disconnected in the Tournament Lobby, re-evaluating locally on a timer rather than requiring a server push for every tick of elapsed time.';

-- ----------------------------------------------------------------------------
-- 2. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.accounts     enable row level security;
alter table public.credentials  enable row level security;
alter table public.invite_codes enable row level security;
alter table public.sessions     enable row level security;
alter table public.sync_events  enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.presence                enable row level security;

-- accounts: public read only (no password column exists on this table at all)
drop policy if exists "accounts_public_read" on public.accounts;
create policy "accounts_public_read" on public.accounts
  for select using (true);

revoke insert, update, delete on public.accounts from anon, authenticated;
grant select on public.accounts to anon, authenticated;

-- credentials / invite_codes / sessions: no policies => fully locked from PostgREST/anon.
revoke all on public.credentials  from anon, authenticated;
revoke all on public.invite_codes from anon, authenticated;
revoke all on public.sessions     from anon, authenticated;

-- sync_events: public read (payload carries no secrets), no direct writes.
drop policy if exists "sync_events_public_read" on public.sync_events;
create policy "sync_events_public_read" on public.sync_events
  for select using (true);

revoke insert, update, delete on public.sync_events from anon, authenticated;
grant select on public.sync_events to anon, authenticated;

-- tournament_participants / presence: public read (Section: Tournament
-- Lobby visibility -- everyone logged in can see who has joined and who's
-- online), writes only via SECURITY DEFINER functions below.
drop policy if exists "tournament_participants_public_read" on public.tournament_participants;
create policy "tournament_participants_public_read" on public.tournament_participants
  for select using (true);

revoke insert, update, delete on public.tournament_participants from anon, authenticated;
grant select on public.tournament_participants to anon, authenticated;

drop policy if exists "presence_public_read" on public.presence;
create policy "presence_public_read" on public.presence
  for select using (true);

revoke insert, update, delete on public.presence from anon, authenticated;
grant select on public.presence to anon, authenticated;

-- Enable Realtime on the two tables clients actually subscribe to.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'accounts'
  ) then
    alter publication supabase_realtime add table public.accounts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_events'
  ) then
    alter publication supabase_realtime add table public.sync_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournament_participants'
  ) then
    alter publication supabase_realtime add table public.tournament_participants;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'presence'
  ) then
    alter publication supabase_realtime add table public.presence;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Helper functions (internal)
-- ----------------------------------------------------------------------------

-- Single source of truth for how long a session may go without a
-- heartbeat before it's considered dead. The client pings well inside
-- this window (see src/lib/sessionMonitor.js); this is deliberately a
-- short grace period, not the 7-day expires_at hard cap, so that
-- closing the tab/browser or losing connectivity ends the session
-- quickly rather than leaving it live until expires_at.
create or replace function public._session_timeout()
returns interval
language sql
immutable
as $$
  select interval '45 seconds'
$$;

-- Confirms a session is alive (both under expires_at AND within the
-- heartbeat timeout of last_seen_at) and, as a side effect, refreshes
-- last_seen_at -- so every privileged RPC call implicitly counts as a
-- heartbeat, not just the dedicated heartbeat() function below.
create or replace function public._current_session_account(p_token uuid)
returns public.accounts
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account_id uuid;
  v_account    public.accounts;
begin
  update public.sessions
  set last_seen_at = now()
  where token = p_token
    and expires_at > now()
    and last_seen_at > now() - public._session_timeout()
  returning account_id into v_account_id;

  if not found then
    raise exception 'invalid_session' using errcode = '28000';
  end if;

  -- Any authenticated action doubles as presence too, not just the
  -- dedicated heartbeat() RPC -- see public.presence comment above.
  insert into public.presence (account_id, last_seen_at)
  values (v_account_id, now())
  on conflict (account_id) do update set last_seen_at = excluded.last_seen_at;

  select * into v_account from public.accounts where id = v_account_id;

  return v_account;
end;
$$;

create or replace function public._require_role(p_token uuid, p_roles text[])
returns public.accounts
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account public.accounts;
begin
  v_account := public._current_session_account(p_token);

  if not (v_account.permission_role = any(p_roles)) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  return v_account;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Auth: register / login / session
-- ----------------------------------------------------------------------------

create or replace function public.register_account(
  p_invite_code    text,
  p_username       text,
  p_password       text,
  p_display_name   text,
  p_tournament_role text,
  p_avatar_url     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_invite     public.invite_codes;
  v_account    public.accounts;
  v_token      uuid;
begin
  if p_username !~ '^[A-Za-z0-9]{1,20}$' then
    raise exception 'invalid_username' using errcode = '22000';
  end if;
  if p_password is null or length(p_password) < 1 or length(p_password) > 20 or p_password !~ '^[A-Za-z0-9]+$' then
    raise exception 'invalid_password' using errcode = '22000';
  end if;
  if p_display_name is null or length(p_display_name) < 1 or length(p_display_name) > 20 then
    raise exception 'invalid_display_name' using errcode = '22000';
  end if;
  if p_tournament_role not in ('captain', 'player') then
    raise exception 'invalid_tournament_role' using errcode = '22000';
  end if;

  select * into v_invite from public.invite_codes where code = p_invite_code for update;
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'invite_expired' using errcode = 'P0002';
  end if;
  if v_invite.used_count >= v_invite.max_uses then
    raise exception 'invite_exhausted' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.accounts where username = p_username) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  insert into public.accounts (username, display_name, tournament_role, permission_role, avatar_url)
  values (p_username, p_display_name, p_tournament_role, 'user', p_avatar_url)
  returning * into v_account;

  insert into public.credentials (account_id, password_hash)
  values (v_account.id, crypt(p_password, gen_salt('bf')));

  update public.invite_codes set used_count = used_count + 1 where id = v_invite.id;
  insert into public.sync_events (scope, event) values ('invites', 'update');

  insert into public.sessions (account_id) values (v_account.id) returning token into v_token;

  insert into public.presence (account_id, last_seen_at)
  values (v_account.id, now())
  on conflict (account_id) do update set last_seen_at = excluded.last_seen_at;

  return jsonb_build_object(
    'token', v_token,
    'account', to_jsonb(v_account)
  );
end;
$$;

create or replace function public.login_account(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account public.accounts;
  v_hash    text;
  v_token   uuid;
begin
  select a.* into v_account
  from public.accounts a
  where a.username = p_username;

  if not found then
    raise exception 'invalid_credentials' using errcode = '28P01';
  end if;

  select c.password_hash into v_hash
  from public.credentials c
  where c.account_id = v_account.id;

  if v_hash is null or crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid_credentials' using errcode = '28P01';
  end if;

  insert into public.sessions (account_id) values (v_account.id) returning token into v_token;

  -- Logging back in restores Online status immediately (Tournament Lobby,
  -- Phase 4) -- the player does not need to click Join Tournament again,
  -- since tournament_participants was never touched by their disconnect.
  insert into public.presence (account_id, last_seen_at)
  values (v_account.id, now())
  on conflict (account_id) do update set last_seen_at = excluded.last_seen_at;

  return jsonb_build_object(
    'token', v_token,
    'account', to_jsonb(v_account)
  );
end;
$$;

create or replace function public.validate_session(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account public.accounts;
begin
  v_account := public._current_session_account(p_token);
  return jsonb_build_object('account', to_jsonb(v_account));
exception
  when others then
    return jsonb_build_object('account', null);
end;
$$;

-- An explicit logout is a deliberate "I'm leaving" signal, distinct from a
-- disconnect/heartbeat timeout -- so it clears presence immediately instead
-- of leaving a stale last_seen_at for the Tournament Lobby to age out on its
-- own. tournament_participants is untouched: logging out never removes a
-- player from the tournament, only leave_tournament does.
create or replace function public.logout_session(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account_id uuid;
begin
  delete from public.sessions where token = p_token returning account_id into v_account_id;

  if v_account_id is not null then
    delete from public.presence where account_id = v_account_id;
  end if;
end;
$$;

-- Called periodically by the client (see src/lib/sessionMonitor.js) to
-- prove the tab is still alive and to refresh last_seen_at. Unlike the
-- other RPC functions, this deliberately does NOT raise an exception on
-- an expired/missing session -- a normal "not alive anymore" outcome and
-- a genuine network/database error need to be distinguishable to the
-- client (the former means "log the user out", the latter means "show
-- the reconnecting dialog and retry"), so this always returns jsonb and
-- lets a thrown error mean the latter.
create or replace function public.heartbeat(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account_id uuid;
begin
  update public.sessions
  set last_seen_at = now()
  where token = p_token
    and expires_at > now()
    and last_seen_at > now() - public._session_timeout()
  returning account_id into v_account_id;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.presence (account_id, last_seen_at)
  values (v_account_id, now())
  on conflict (account_id) do update set last_seen_at = excluded.last_seen_at;

  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Admin Dashboard: user management (Admin + Developer)
-- ----------------------------------------------------------------------------

create or replace function public.edit_user(
  p_token          uuid,
  p_target_id      uuid,
  p_username       text,
  p_display_name   text,
  p_password       text,      -- pass null/empty to leave password unchanged
  p_tournament_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor   public.accounts;
  v_updated public.accounts;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  if p_username !~ '^[A-Za-z0-9]{1,20}$' then
    raise exception 'invalid_username' using errcode = '22000';
  end if;
  if p_display_name is null or length(p_display_name) < 1 or length(p_display_name) > 20 then
    raise exception 'invalid_display_name' using errcode = '22000';
  end if;
  if p_tournament_role is not null and p_tournament_role not in ('captain', 'player') then
    raise exception 'invalid_tournament_role' using errcode = '22000';
  end if;

  if exists (select 1 from public.accounts where username = p_username and id <> p_target_id) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  update public.accounts
  set username = p_username,
      display_name = p_display_name,
      tournament_role = p_tournament_role
  where id = p_target_id
  returning * into v_updated;

  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if p_password is not null and length(p_password) > 0 then
    update public.credentials
    set password_hash = crypt(p_password, gen_salt('bf'))
    where account_id = p_target_id;
  end if;

  return to_jsonb(v_updated);
end;
$$;

create or replace function public.delete_user(
  p_token     uuid,
  p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor public.accounts;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  if v_actor.id = p_target_id then
    raise exception 'cannot_delete_self' using errcode = '42501';
  end if;

  delete from public.accounts where id = p_target_id;
end;
$$;

-- Only Developer accounts may change permission roles (Section 10, DEVLOG).
create or replace function public.promote_user(
  p_token     uuid,
  p_target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor   public.accounts;
  v_updated public.accounts;
begin
  v_actor := public._require_role(p_token, array['developer']);

  update public.accounts
  set permission_role = 'admin'
  where id = p_target_id and permission_role = 'user'
  returning * into v_updated;

  if not found then
    raise exception 'user_not_found_or_not_promotable' using errcode = 'P0002';
  end if;

  return to_jsonb(v_updated);
end;
$$;

create or replace function public.demote_user(
  p_token     uuid,
  p_target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor   public.accounts;
  v_updated public.accounts;
begin
  v_actor := public._require_role(p_token, array['developer']);

  update public.accounts
  set permission_role = 'user'
  where id = p_target_id and permission_role = 'admin'
  returning * into v_updated;

  if not found then
    raise exception 'user_not_found_or_not_demotable' using errcode = 'P0002';
  end if;

  return to_jsonb(v_updated);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Tournament Lobby: join / leave (Phase 4, any logged-in account)
-- ----------------------------------------------------------------------------

-- Idempotent on purpose: clicking Join while already joined (e.g. a
-- double-click, or two tabs racing) just leaves the existing row alone
-- instead of erroring.
create or replace function public.join_tournament(p_token uuid)
returns public.tournament_participants
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account public.accounts;
  v_row     public.tournament_participants;
begin
  v_account := public._current_session_account(p_token);

  insert into public.tournament_participants (account_id)
  values (v_account.id)
  on conflict (account_id) do nothing;

  select * into v_row from public.tournament_participants where account_id = v_account.id;
  return v_row;
end;
$$;

-- The only thing that permanently removes a player from the tournament
-- (Tournament Lobby product decision -- disconnects/timeouts never do).
create or replace function public.leave_tournament(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account public.accounts;
begin
  v_account := public._current_session_account(p_token);
  delete from public.tournament_participants where account_id = v_account.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Admin Dashboard: invite code management (Admin + Developer)
-- ----------------------------------------------------------------------------

create or replace function public.list_invite_codes(p_token uuid)
returns setof public.invite_codes
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public._require_role(p_token, array['admin', 'developer']);
  return query select * from public.invite_codes order by created_at desc;
end;
$$;

create or replace function public.create_invite_code(
  p_token      uuid,
  p_max_uses   integer,
  p_expires_at timestamptz default null
)
returns public.invite_codes
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor  public.accounts;
  v_code   text;
  v_row    public.invite_codes;
  v_chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  if p_max_uses is null or p_max_uses < 1 then
    raise exception 'invalid_max_uses' using errcode = '22000';
  end if;

  loop
    v_code := (
      select string_agg(substr(v_chars, (floor(random() * length(v_chars)) + 1)::int, 1), '')
      from generate_series(1, 4)
    ) || '-' || (
      select string_agg(substr(v_chars, (floor(random() * length(v_chars)) + 1)::int, 1), '')
      from generate_series(1, 4)
    );
    exit when not exists (select 1 from public.invite_codes where code = v_code);
  end loop;

  insert into public.invite_codes (code, max_uses, expires_at, created_by)
  values (v_code, p_max_uses, p_expires_at, v_actor.id)
  returning * into v_row;

  insert into public.sync_events (scope, event) values ('invites', 'insert');

  return v_row;
end;
$$;

create or replace function public.delete_invite_code(
  p_token uuid,
  p_id    uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public._require_role(p_token, array['admin', 'developer']);

  delete from public.invite_codes where id = p_id;
  insert into public.sync_events (scope, event) values ('invites', 'delete');
end;
$$;

-- Let PostgREST expose these as callable RPCs for the anon key.
grant execute on function
  public.register_account(text, text, text, text, text, text),
  public.login_account(text, text),
  public.validate_session(uuid),
  public.logout_session(uuid),
  public.heartbeat(uuid),
  public.edit_user(uuid, uuid, text, text, text, text),
  public.delete_user(uuid, uuid),
  public.promote_user(uuid, uuid),
  public.demote_user(uuid, uuid),
  public.join_tournament(uuid),
  public.leave_tournament(uuid),
  public.list_invite_codes(uuid),
  public.create_invite_code(uuid, integer, timestamptz),
  public.delete_invite_code(uuid, uuid)
to anon, authenticated;

-- Best-effort physical cleanup of dead session rows. This is purely
-- hygiene -- _current_session_account/heartbeat already refuse any
-- session past _session_timeout() regardless of whether the row still
-- exists, so security does not depend on this running. Skipped silently
-- if pg_cron isn't available/enabled on this project (it's an optional
-- extension, off by default on a fresh Supabase project) so this schema
-- still runs cleanly everywhere.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'draftstage-session-cleanup',
        '*/5 * * * *',
        $cron$delete from public.sessions
               where expires_at < now()
                  or last_seen_at < now() - interval '1 hour';$cron$
      );
    exception
      when others then
        -- pg_cron present but not usable in this environment (e.g.
        -- insufficient privilege) -- fine, fall back to the on-read
        -- expiration checks above.
        null;
    end;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 8. Storage bucket for avatars
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_public_upload" on storage.objects;
create policy "avatars_public_upload" on storage.objects
  for insert with check (bucket_id = 'avatars');

-- ----------------------------------------------------------------------------
-- 9. Seed data: the real Developer account (admin / 111)
-- ----------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  set local search_path = public, extensions, pg_temp;

  if not exists (select 1 from public.accounts where username = 'admin') then
    insert into public.accounts (username, display_name, tournament_role, permission_role)
    values ('admin', 'Developer', null, 'developer')
    returning id into v_id;

    insert into public.credentials (account_id, password_hash)
    values (v_id, crypt('111', gen_salt('bf')));
  end if;
end $$;

-- ============================================================================
-- End of schema. After running this, the "admin" / "111" Developer account
-- exists and can log in immediately.
-- ============================================================================
