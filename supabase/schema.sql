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
  gender           text check (gender in ('male', 'female')),
  permission_role  text not null default 'user' check (permission_role in ('developer', 'admin', 'user')),
  avatar_url       text,
  created_at       timestamptz not null default now()
);

comment on table public.accounts is
  'Public-safe account rows (no password). Readable by anyone with the anon key; writes only via SECURITY DEFINER functions.';

-- Gender (Phase 4 UI Enhancement): required at registration, display-only
-- for now (no effect on permissions/matchmaking/drafting). `create table
-- if not exists` above won't add this column to an already-existing
-- table on re-run, so it's added separately here, same as roll_number
-- and draft_order elsewhere in this file.
alter table public.accounts
  add column if not exists gender text check (gender in ('male', 'female'));

-- Temporary Testing Buttons (Phase 5 -- Tournament Participant
-- Synchronization): marks accounts created by create_temp_participants()
-- so remove_temp_participants() can find and delete exactly those, and
-- only those, in one shot. false for every real account (registration
-- never sets this); never surfaced in any UI beyond the two dev buttons
-- that write/read it.
alter table public.accounts
  add column if not exists is_temp boolean not null default false;

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

-- Roll Numbers (Tournament Lobby improvement): null until an admin/developer
-- runs a roll. `create table if not exists` above won't add this column to
-- an already-existing table on re-run, so it's added separately here.
alter table public.tournament_participants
  add column if not exists roll_number integer;

comment on table public.tournament_participants is
  'Phase 4: players who have joined the current tournament. Public read (safe -- just account_id, joined_at, roll_number). Only removed by leave_tournament, an explicit player action -- a disconnect or heartbeat timeout never removes a row here, per the Tournament Lobby product decision that participation and online status are separate concepts. roll_number is null until roll_tournament_numbers() assigns one; a fresh join (including rejoining after a leave) always starts at null.';

create table if not exists public.presence (
  account_id    uuid primary key references public.accounts(id) on delete cascade,
  last_seen_at  timestamptz not null default now()
);

comment on table public.presence is
  'Public-safe last-seen timestamp per account, deliberately separate from the locked public.sessions table. Upserted by login/register, heartbeat, and every _current_session_account()-gated RPC call; deleted outright on explicit logout. Clients compare last_seen_at against the same _session_timeout() window used for session liveness to render Online/Disconnected in the Tournament Lobby, re-evaluating locally on a timer rather than requiring a server push for every tick of elapsed time.';

-- Tournament Settings (Tournament Lobby improvement -- replaces the
-- cancelled standalone "Tournament Configuration" phase; see Section 16).
-- `id boolean primary key check (id)` is a standard Postgres singleton-row
-- trick: id can only ever be `true`, and the primary key guarantees
-- uniqueness, so the table can never hold more than the one active record
-- by construction, not just by app-level convention.
create table if not exists public.tournament_settings (
  id                boolean primary key default true,
  tournament_name   text not null default '',
  team_count        integer not null default 8,
  players_per_team  integer not null default 5,
  draft_order       jsonb,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.accounts(id) on delete set null,
  constraint tournament_settings_singleton check (id)
);

-- draft_order may not exist yet on a table created before this feature --
-- add it idempotently the same way roll_number was added to
-- tournament_participants.
alter table public.tournament_settings
  add column if not exists draft_order jsonb;

comment on table public.tournament_settings is
  'Singleton row (Tournament Lobby -- Tournament Settings). Public read (safe -- name, team count, players per team, draft order, and who last touched it), written only through save_tournament_settings() by an Admin/Developer. There is never more than one row; a save always updates the same record rather than creating a new one, which is how "remember the last saved settings" works. draft_order is a JSON array of rounds (one array of team numbers per round, length = players_per_team - 1); this is Draft Order Settings only -- configuring the order captains draft goes here, actually running the draft is a future phase.';

-- Final Matchups (Phase 5 -- Draft Arena, Concept 1 "Tournament Bracket").
-- Singleton row, same trick as tournament_settings (id can only ever be
-- true). This is the ONLY server-persisted snapshot of the completed
-- draft's teams -- captain assignments made during the Captain/Teammate
-- phases themselves are still local-only React state (see DraftArena.jsx),
-- exactly as documented before this phase. The moment an admin clicks
-- 进入最终对阵, that local team list is snapshotted here (captain identity
-- only -- id/name/avatar -- not full rosters, since only captain-vs-captain
-- matchups are ever displayed on this stage) via enter_final_matchups(),
-- with matchups starting completely blank -- nothing is auto-generated.
-- From that point on every connected client (whoever has the Draft Arena
-- open, regardless of their own local draft progress) renders this row
-- instead, kept live by Realtime. This is what makes Random Roll/Manual
-- Pairing/Lock/Reset genuinely multi-client-synchronized instead of
-- "synchronized only for whoever clicked the button."
--
-- matchups is a JSON array, one element per existing matchup, each shaped
-- like {"a": <team index>, "b": <team index or null for a bye>, "locked":
-- bool}. Unlike a fixed bracket, this array only ever contains matchups
-- that actually exist -- a team not yet in any entry simply doesn't appear
-- anywhere in it, and is what create_manual_matchup()/roll_tournament_
-- matchups() below call a "remaining" team. A slot's identity (what a lock
-- protects) is its position in this array. teams is a JSON array of
-- {"idx", "captainAccountId", "captainName", "captainAvatarUrl"}, idx
-- matching the a/b values above.
create table if not exists public.tournament_matches (
  id          boolean primary key default true,
  teams       jsonb not null default '[]'::jsonb,
  matchups    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.accounts(id) on delete set null,
  constraint tournament_matches_singleton check (id)
);

comment on table public.tournament_matches is
  'Singleton row (Draft Arena -- Final Matchups / 对阵生成 stage). Public read, written only through enter_final_matchups()/create_manual_matchup()/remove_tournament_matchup()/roll_tournament_matchups()/lock_tournament_matchup()/reset_tournament_matchups(), all Admin/Developer-only. matchups starts (and, after Reset, returns to) a blank array -- nothing is ever auto-generated. Absence of this row means no tournament has reached the Final Matchups stage yet (or End Tournament just cleared it); its presence is itself the signal every connected Draft Arena client uses to switch into this stage, via Realtime.';

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
alter table public.tournament_settings     enable row level security;
alter table public.tournament_matches      enable row level security;

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

-- tournament_settings: public read (harmless -- name/team counts, no
-- secrets), writes only via save_tournament_settings() below.
drop policy if exists "tournament_settings_public_read" on public.tournament_settings;
create policy "tournament_settings_public_read" on public.tournament_settings
  for select using (true);

revoke insert, update, delete on public.tournament_settings from anon, authenticated;
grant select on public.tournament_settings to anon, authenticated;

-- tournament_matches: public read (safe -- captain names/avatars are
-- already public via accounts, and matchups carry no secrets), writes only
-- via the SECURITY DEFINER functions below (Section 6b).
drop policy if exists "tournament_matches_public_read" on public.tournament_matches;
create policy "tournament_matches_public_read" on public.tournament_matches
  for select using (true);

revoke insert, update, delete on public.tournament_matches from anon, authenticated;
grant select on public.tournament_matches to anon, authenticated;

-- Enable Realtime on the tables clients actually subscribe to.
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

  -- Final Matchups stage (Phase 5): every connected Draft Arena client
  -- subscribes to this table so matchups/locks/rolls/reset/end-tournament
  -- all appear live, exactly like the rest of the project's synced state.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournament_matches'
  ) then
    alter publication supabase_realtime add table public.tournament_matches;
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

-- Same "alive" definition used everywhere else in the project (expires_at
-- hard cap + within the heartbeat timeout of last_seen_at) -- reused by
-- login_account to enforce Single Active Session Per Account. A session
-- row that's merely stale (heartbeat lapsed, tab closed) does not count
-- as active, so a fresh login is never blocked by a session that's
-- already effectively dead, only by one that's genuinely still alive.
create or replace function public._has_active_session(p_account_id uuid)
returns boolean
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.sessions
    where account_id = p_account_id
      and expires_at > now()
      and last_seen_at > now() - public._session_timeout()
  )
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
  p_gender         text,
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
  if p_gender not in ('male', 'female') then
    raise exception 'invalid_gender' using errcode = '22000';
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

  insert into public.accounts (username, display_name, tournament_role, gender, permission_role, avatar_url)
  values (p_username, p_display_name, p_tournament_role, p_gender, 'user', p_avatar_url)
  returning * into v_account;

  insert into public.credentials (account_id, password_hash)
  values (v_account.id, crypt(p_password, gen_salt('bf')));

  update public.invite_codes set used_count = used_count + 1 where id = v_invite.id;
  insert into public.sync_events (scope, event) values ('invites', 'update');

  -- Registration intentionally stops here: it creates the account and
  -- credentials only. It must NOT insert into public.sessions or
  -- public.presence -- doing so would make the account look "already
  -- logged in" (see _has_active_session() in login_account below) and
  -- "online" before the person had ever actually logged in, blocking
  -- their very next login attempt until that phantom session expired.
  -- The first session/presence row for a new account is created by
  -- login_account(), exactly like every other account, the first time
  -- they actually log in.
  return jsonb_build_object('account', to_jsonb(v_account));
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

  -- Single Active Session Per Account: checked after credentials so a
  -- wrong-password guess never leaks "this account is currently logged
  -- in" to someone who doesn't actually own it.
  if public._has_active_session(v_account.id) then
    raise exception 'account_already_logged_in' using errcode = '55006';
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
  p_tournament_role text,
  p_gender         text,
  p_avatar_url     text default null  -- pass null to leave the existing avatar unchanged
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor   public.accounts;
  v_target  public.accounts;
  v_updated public.accounts;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  select * into v_target from public.accounts where id = p_target_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  -- Developer Account Protection: only a Developer may edit another
  -- Developer account. This is the actual enforcement point -- the
  -- hidden 编辑 button in AdminDashboard.jsx for Developer rows when the
  -- viewer is an Admin is only a convenience on top of it, so a crafted
  -- RPC call that bypasses the UI is rejected here just the same.
  if v_target.permission_role = 'developer' and v_actor.permission_role <> 'developer' then
    raise exception 'cannot_edit_developer' using errcode = '42501';
  end if;

  if p_username !~ '^[A-Za-z0-9]{1,20}$' then
    raise exception 'invalid_username' using errcode = '22000';
  end if;
  if p_display_name is null or length(p_display_name) < 1 or length(p_display_name) > 20 then
    raise exception 'invalid_display_name' using errcode = '22000';
  end if;
  if p_tournament_role is not null and p_tournament_role not in ('captain', 'player') then
    raise exception 'invalid_tournament_role' using errcode = '22000';
  end if;
  if p_gender not in ('male', 'female') then
    raise exception 'invalid_gender' using errcode = '22000';
  end if;

  if exists (select 1 from public.accounts where username = p_username and id <> p_target_id) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  update public.accounts
  set username = p_username,
      display_name = p_display_name,
      tournament_role = p_tournament_role,
      gender = p_gender,
      avatar_url = coalesce(p_avatar_url, avatar_url)
  where id = p_target_id
  returning * into v_updated;

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
  v_actor  public.accounts;
  v_target public.accounts;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  if v_actor.id = p_target_id then
    raise exception 'cannot_delete_self' using errcode = '42501';
  end if;

  select * into v_target from public.accounts where id = p_target_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  -- The Developer account is the project owner account and must never be
  -- removable from the website, by anyone, through any route -- this is
  -- the actual enforcement point; the UI hiding the Delete button is only
  -- a convenience on top of it. The only way to remove a Developer
  -- account is editing the database directly, outside the app.
  if v_target.permission_role = 'developer' then
    raise exception 'cannot_delete_developer' using errcode = '42501';
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
-- 6. Tournament Lobby: join / leave (any account) / admin removal / roll numbers / clear all / settings (Phase 4)
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

-- Admin/Developer-only: force-remove any participant, online or not.
-- Identical effect to that player clicking "退出比赛" themselves -- only
-- the tournament_participants row is touched, the account itself is left
-- untouched, and the player can rejoin at any time with "参加比赛".
create or replace function public.remove_participant(
  p_token             uuid,
  p_target_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public._require_role(p_token, array['admin', 'developer']);
  delete from public.tournament_participants where account_id = p_target_account_id;
end;
$$;

-- Admin/Developer-only: assigns every current participant a unique random
-- number in 1-100, all at once, overwriting whatever numbers (if any) were
-- assigned by a previous roll. Offline-but-still-joined participants are
-- included -- this reads tournament_participants, which is unaffected by
-- presence/online status. Anyone who joins after this runs simply has
-- roll_number = null (a fresh row) until the next roll.
create or replace function public.roll_tournament_numbers(p_token uuid)
returns setof public.tournament_participants
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_count int;
begin
  perform public._require_role(p_token, array['admin', 'developer']);

  select count(*) into v_count from public.tournament_participants;

  if v_count > 100 then
    raise exception 'roll_range_too_small' using errcode = '22023';
  end if;

  with targets as (
    select account_id, row_number() over (order by random()) as rn
    from public.tournament_participants
  ),
  pool as (
    select n, row_number() over () as rn
    from (
      select n from generate_series(1, 100) as n order by random() limit v_count
    ) shuffled
  )
  update public.tournament_participants tp
  set roll_number = pool.n
  from targets
  join pool on pool.rn = targets.rn
  where tp.account_id = targets.account_id;

  return query select * from public.tournament_participants;
end;
$$;

-- Admin/Developer-only: removes every participant at once. Behaves exactly
-- like every joined player clicking "退出比赛" themselves, just batched
-- into a single statement -- same table, same effect (only the
-- tournament_participants row disappears; accounts, permissions, and
-- presence are all untouched). roll_number isn't "reset" separately, it's
-- simply gone along with the row it lived on.
--
-- `where true` below is required, not decorative: this project's Supabase
-- instance rejects a bare `DELETE` with no `WHERE` clause outright
-- (error 21000, "DELETE requires a WHERE clause") regardless of whether
-- it's issued directly or from inside a SECURITY DEFINER function -- this
-- is enforced at the executor level, so it applies here exactly like it
-- would to any other DELETE. `where true` intentionally still matches
-- every row, preserving the original "delete every current participant"
-- behavior exactly; it's the explicit form of what the missing WHERE was
-- implicitly trying to do, not a narrower condition.
create or replace function public.clear_tournament(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public._require_role(p_token, array['admin', 'developer']);
  delete from public.tournament_participants where true;
end;
$$;

-- Temporary Testing Buttons (Phase 5 -- Tournament Participant
-- Synchronization). Admin/Developer-only. Creates p_captain_count real
-- accounts with tournament_role='captain' and p_player_count with
-- tournament_role='player' -- gender alternated male/female within each
-- group -- and immediately joins every one of them to the tournament
-- (a real tournament_participants row each, exactly like clicking
-- "参加比赛"), so they show up through the exact same fetchLobby() query
-- and Realtime subscription as any other participant. Each gets a random
-- unique username (never shown anywhere) and the same fixed dev password
-- ('temp123', bcrypt-hashed like every other account) so they're usable
-- for manual login-based testing too, not just for populating the Draft
-- Arena's pools. Marked is_temp = true so remove_temp_participants() can
-- clean up exactly these accounts later. Bypasses the invite-code gate on
-- purpose -- this is a developer/testing convenience, not a public
-- registration path.
create or replace function public.create_temp_participants(
  p_token         uuid,
  p_captain_count integer,
  p_player_count  integer
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_i      int;
  v_id     uuid;
  v_gender text;
begin
  perform public._require_role(p_token, array['admin', 'developer']);

  if coalesce(p_captain_count, 0) < 0 or coalesce(p_player_count, 0) < 0 then
    raise exception 'invalid_temp_participant_count' using errcode = '22000';
  end if;

  for v_i in 1..coalesce(p_captain_count, 0) loop
    v_gender := case when v_i % 2 = 0 then 'male' else 'female' end;

    insert into public.accounts (username, display_name, tournament_role, gender, permission_role, is_temp)
    values ('temp_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), '临时队长' || v_i, 'captain', v_gender, 'user', true)
    returning id into v_id;

    insert into public.credentials (account_id, password_hash)
    values (v_id, crypt('temp123', gen_salt('bf')));

    insert into public.tournament_participants (account_id)
    values (v_id)
    on conflict (account_id) do nothing;
  end loop;

  for v_i in 1..coalesce(p_player_count, 0) loop
    v_gender := case when v_i % 2 = 0 then 'male' else 'female' end;

    insert into public.accounts (username, display_name, tournament_role, gender, permission_role, is_temp)
    values ('temp_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), '临时队员' || v_i, 'player', v_gender, 'user', true)
    returning id into v_id;

    insert into public.credentials (account_id, password_hash)
    values (v_id, crypt('temp123', gen_salt('bf')));

    insert into public.tournament_participants (account_id)
    values (v_id)
    on conflict (account_id) do nothing;
  end loop;
end;
$$;

-- Temporary Testing Buttons: the matching cleanup. Admin/Developer-only.
-- Deletes every account ever created by create_temp_participants() in one
-- statement -- credentials, tournament_participants, and presence rows
-- for those accounts all disappear with it via their existing `on delete
-- cascade` foreign keys, so nothing extra needs to be cleaned up by hand.
-- Real accounts (is_temp = false, the default for every account created
-- through register_account) are never touched.
create or replace function public.remove_temp_participants(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public._require_role(p_token, array['admin', 'developer']);
  delete from public.accounts where is_temp = true;
end;
$$;

-- Admin/Developer-only: Tournament Settings (replaces the cancelled
-- standalone Tournament Configuration phase -- this is the entire feature,
-- folded into the Tournament Lobby). Always writes the same singleton row
-- (upsert on the fixed id=true key), so "save" is really "replace the one
-- active record" and the dialog always shows whatever was saved last time
-- it's reopened -- there's no separate list of configurations to choose
-- between.
create or replace function public.save_tournament_settings(
  p_token             uuid,
  p_tournament_name   text,
  p_team_count        integer,
  p_players_per_team  integer,
  p_draft_order       jsonb
)
returns public.tournament_settings
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor          public.accounts;
  v_row            public.tournament_settings;
  v_expected_rounds integer;
  v_round          jsonb;
  v_round_values   integer[];
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  if p_tournament_name is null or char_length(trim(p_tournament_name)) < 1 or char_length(p_tournament_name) > 60 then
    raise exception 'invalid_tournament_name' using errcode = '22000';
  end if;
  if p_team_count is null or p_team_count < 2 or p_team_count > 128 then
    raise exception 'invalid_team_count' using errcode = '22000';
  end if;
  if p_players_per_team is null or p_players_per_team < 1 or p_players_per_team > 20 then
    raise exception 'invalid_players_per_team' using errcode = '22000';
  end if;

  -- Draft Order Settings: captains are assigned manually and never appear
  -- in the draft order, so there are always exactly players_per_team - 1
  -- rounds, each a permutation of 1..team_count (one entry per team).
  -- This is the server-side twin of the client-side check in
  -- tournamentApi.js's validateDraftRound -- the UI blocks Save on an
  -- invalid round already, but the database is the real enforcement point,
  -- same as everywhere else in this project.
  v_expected_rounds := p_players_per_team - 1;

  if p_draft_order is null or jsonb_typeof(p_draft_order) <> 'array' then
    raise exception 'invalid_draft_order' using errcode = '22000';
  end if;

  if jsonb_array_length(p_draft_order) <> v_expected_rounds then
    raise exception 'invalid_draft_order_round_count' using errcode = '22000';
  end if;

  for v_round in select * from jsonb_array_elements(p_draft_order)
  loop
    if jsonb_typeof(v_round) <> 'array' or jsonb_array_length(v_round) <> p_team_count then
      raise exception 'invalid_draft_order_team_count' using errcode = '22000';
    end if;

    begin
      select array_agg(value::int order by value::int)
      into v_round_values
      from jsonb_array_elements_text(v_round) as value;
    exception when others then
      raise exception 'invalid_draft_order' using errcode = '22000';
    end;

    -- Sorted ascending, a round is valid iff it's exactly [1, 2, ..., N] --
    -- that single comparison simultaneously proves every team number
    -- appears, none is missing, and none is duplicated.
    if v_round_values is distinct from (select array_agg(g) from generate_series(1, p_team_count) g) then
      raise exception 'invalid_draft_order_duplicate_or_missing' using errcode = '22000';
    end if;
  end loop;

  insert into public.tournament_settings (id, tournament_name, team_count, players_per_team, draft_order, updated_at, updated_by)
  values (true, trim(p_tournament_name), p_team_count, p_players_per_team, p_draft_order, now(), v_actor.id)
  on conflict (id) do update
    set tournament_name  = excluded.tournament_name,
        team_count       = excluded.team_count,
        players_per_team = excluded.players_per_team,
        draft_order      = excluded.draft_order,
        updated_at       = excluded.updated_at,
        updated_by       = excluded.updated_by
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6b. Draft Arena: Final Matchups stage (Phase 5 -- Concept 1 "Tournament
--     Bracket"). Admin/Developer-only, same pattern as the rest of Section
--     6. See the public.tournament_matches comment above for the overall
--     shape/rationale.
-- ----------------------------------------------------------------------------

-- Snapshots the just-completed draft's teams (captain identity only --
-- id/name/avatar; full rosters are never needed on this stage) into the
-- singleton row with a completely blank matchups array. Called once, when
-- 进入最终对阵 is clicked -- by design, nothing is auto-generated here: the
-- admin decides everything from this point (manual pairing and/or Random
-- Roll), same "admin is always in control" principle as the rest of the
-- project (starting the draft, managing invites, running the tournament).
-- Safe to call again (e.g. a second admin also finishes a draft and
-- proceeds) -- it simply overwrites the singleton with whichever snapshot
-- arrives, same "replace the one active record" behavior as
-- save_tournament_settings.
create or replace function public.enter_final_matchups(
  p_token uuid,
  p_teams jsonb
)
returns public.tournament_matches
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor public.accounts;
  v_row   public.tournament_matches;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  if p_teams is null or jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) < 2 then
    raise exception 'invalid_final_matchup_teams' using errcode = '22000';
  end if;

  insert into public.tournament_matches (id, teams, matchups, updated_at, updated_by)
  values (true, p_teams, '[]'::jsonb, now(), v_actor.id)
  on conflict (id) do update
    set teams      = excluded.teams,
        matchups   = excluded.matchups,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
  returning * into v_row;

  return v_row;
end;
$$;

-- Manual Pairing: the admin hand-picks two teams and locks them together
-- in one step -- there is no "select then separately lock" on the server,
-- a manually created matchup is always born locked (the whole point is
-- "this matchup is now permanently fixed"). Appended as a new entry at the
-- end of the matchups array; existing entries (locked or not) are left
-- completely untouched. Either team already appearing in ANY existing
-- entry (locked or not -- a team mid-roll-result still "belongs" to that
-- slot until the next roll or an explicit removal) is rejected, since a
-- team can only ever be in one matchup at a time.
create or replace function public.create_manual_matchup(
  p_token  uuid,
  p_team_a integer,
  p_team_b integer
)
returns public.tournament_matches
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor      public.accounts;
  v_row        public.tournament_matches;
  v_valid_idxs int[];
  v_used_idxs  int[] := '{}';
  v_m          jsonb;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  select * into v_row from public.tournament_matches where id = true;
  if not found then
    raise exception 'no_final_matchups' using errcode = '22000';
  end if;

  if p_team_a is null or p_team_b is null or p_team_a = p_team_b then
    raise exception 'duplicate_team_selection' using errcode = '22000';
  end if;

  select array_agg((elem->>'idx')::int) into v_valid_idxs from jsonb_array_elements(v_row.teams) elem;
  if not (p_team_a = any(v_valid_idxs)) or not (p_team_b = any(v_valid_idxs)) then
    raise exception 'invalid_team_index' using errcode = '22000';
  end if;

  for v_m in select * from jsonb_array_elements(v_row.matchups)
  loop
    if v_m->>'a' is not null then v_used_idxs := v_used_idxs || (v_m->>'a')::int; end if;
    if v_m->>'b' is not null then v_used_idxs := v_used_idxs || (v_m->>'b')::int; end if;
  end loop;

  if p_team_a = any(v_used_idxs) or p_team_b = any(v_used_idxs) then
    raise exception 'team_already_matched' using errcode = '22000';
  end if;

  update public.tournament_matches
  set matchups   = v_row.matchups || jsonb_build_array(jsonb_build_object('a', p_team_a, 'b', p_team_b, 'locked', true)),
      updated_at = now(),
      updated_by = v_actor.id
  where id = true
  returning * into v_row;

  return v_row;
end;
$$;

-- Dissolves one matchup entirely (manual pairing made by mistake, or an
-- unwanted roll result) -- both teams go straight back into the "remaining
-- teams" pool, immediately, without needing to wait for the next Random
-- Roll. Removes by array position, same indexing as lock_tournament_matchup.
create or replace function public.remove_tournament_matchup(
  p_token       uuid,
  p_match_index integer
)
returns public.tournament_matches
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor public.accounts;
  v_row   public.tournament_matches;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  select * into v_row from public.tournament_matches where id = true;
  if not found then
    raise exception 'no_final_matchups' using errcode = '22000';
  end if;

  if p_match_index is null or p_match_index < 0 or p_match_index >= jsonb_array_length(v_row.matchups) then
    raise exception 'invalid_match_index' using errcode = '22023';
  end if;

  update public.tournament_matches
  set matchups   = v_row.matchups - p_match_index,
      updated_at = now(),
      updated_by = v_actor.id
  where id = true
  returning * into v_row;

  return v_row;
end;
$$;

-- Random Roll only ever touches teams that aren't in ANY existing matchup
-- yet -- neither a locked entry (manual pairing, or a previously-locked
-- roll result) nor an unlocked entry (a still-unlocked earlier roll
-- result, which gets dissolved and re-shuffled along with every other
-- still-unmatched team). Locked entries are copied through completely
-- untouched, in their original array position. This is what makes "lock a
-- matchup, then roll the rest" and "roll again to reshuffle only what's
-- still unlocked" both work exactly as specified.
create or replace function public.roll_tournament_matchups(p_token uuid)
returns public.tournament_matches
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor      public.accounts;
  v_row        public.tournament_matches;
  v_m          jsonb;
  v_used_idxs  int[] := '{}';
  v_free_ids   int[];
  v_shuffled   int[];
  v_free_count int;
  v_kept       jsonb := '[]'::jsonb;
  v_rolled     jsonb := '[]'::jsonb;
  v_ptr        int := 1;
  v_a          int;
  v_b          int;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  select * into v_row from public.tournament_matches where id = true;
  if not found then
    raise exception 'no_final_matchups' using errcode = '22000';
  end if;

  -- Keep every locked entry exactly as-is; everything else (an unlocked
  -- earlier roll result) is dropped so its teams flow back into the free
  -- pool below.
  for v_m in
    select elem from jsonb_array_elements(v_row.matchups) with ordinality as t(elem, ord) order by ord
  loop
    if coalesce((v_m->>'locked')::boolean, false) then
      v_kept := v_kept || jsonb_build_array(v_m);
      if v_m->>'a' is not null then v_used_idxs := v_used_idxs || (v_m->>'a')::int; end if;
      if v_m->>'b' is not null then v_used_idxs := v_used_idxs || (v_m->>'b')::int; end if;
    end if;
  end loop;

  select array_agg((elem->>'idx')::int)
  into v_free_ids
  from jsonb_array_elements(v_row.teams) elem
  where not ((elem->>'idx')::int = any(v_used_idxs));

  v_free_count := coalesce(array_length(v_free_ids, 1), 0);

  if v_free_count > 0 then
    select array_agg(x order by random()) into v_shuffled from unnest(v_free_ids) as x;

    while v_ptr <= v_free_count loop
      v_a := v_shuffled[v_ptr]; v_ptr := v_ptr + 1;
      if v_ptr <= v_free_count then v_b := v_shuffled[v_ptr]; v_ptr := v_ptr + 1; else v_b := null; end if;
      v_rolled := v_rolled || jsonb_build_array(jsonb_build_object('a', v_a, 'b', v_b, 'locked', false));
    end loop;
  end if;

  update public.tournament_matches
  set matchups = v_kept || v_rolled, updated_at = now(), updated_by = v_actor.id
  where id = true
  returning * into v_row;

  return v_row;
end;
$$;

-- Toggles a single match slot's lock flag by its position in the matchups
-- array. Never touches which teams are in that slot. Unlocking a manually
-- created pairing doesn't dissolve it immediately (use
-- remove_tournament_matchup for that) -- it just makes it eligible to be
-- swept up and re-shuffled the next time Random Roll runs.
create or replace function public.lock_tournament_matchup(
  p_token       uuid,
  p_match_index integer,
  p_locked      boolean
)
returns public.tournament_matches
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor public.accounts;
  v_row   public.tournament_matches;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  select * into v_row from public.tournament_matches where id = true;
  if not found then
    raise exception 'no_final_matchups' using errcode = '22000';
  end if;

  if p_match_index is null or p_match_index < 0 or p_match_index >= jsonb_array_length(v_row.matchups) then
    raise exception 'invalid_match_index' using errcode = '22023';
  end if;

  update public.tournament_matches
  set matchups   = jsonb_set(v_row.matchups, array[p_match_index::text, 'locked'], to_jsonb(coalesce(p_locked, false))),
      updated_at = now(),
      updated_by = v_actor.id
  where id = true
  returning * into v_row;

  return v_row;
end;
$$;

-- Restores the exact state the page was in the moment 进入最终对阵 was
-- first clicked: a completely blank matchups array -- no generated
-- matchups, no locks, no manual pairings. Teams themselves are untouched
-- (Reset doesn't re-fetch the draft -- "return every team to the original
-- ungenerated state" means the matchups, not the roster of teams available
-- to match).
create or replace function public.reset_tournament_matchups(p_token uuid)
returns public.tournament_matches
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor public.accounts;
  v_row   public.tournament_matches;
begin
  v_actor := public._require_role(p_token, array['admin', 'developer']);

  select * into v_row from public.tournament_matches where id = true;
  if not found then
    raise exception 'no_final_matchups' using errcode = '22000';
  end if;

  update public.tournament_matches
  set matchups   = '[]'::jsonb,
      updated_at = now(),
      updated_by = v_actor.id
  where id = true
  returning * into v_row;

  return v_row;
end;
$$;

-- Ends the current tournament outright: deletes the Final Matchups
-- singleton (its disappearance is the Realtime signal every connected
-- Draft Arena client -- drafting or already on the Final Matchups stage --
-- uses to leave immediately, see subscribeFinalMatchups() in
-- tournamentApi.js) and clears every joined participant, exactly like
-- clear_tournament(), so nobody carries over into the next tournament --
-- anyone who wants in must click 参加比赛 again. tournament_settings
-- (name/team count/players per team/draft order) is deliberately left
-- alone, same as clear_tournament() leaves it alone -- "a brand new
-- tournament" reuses whatever was last configured until an admin changes
-- it, it doesn't forget the configuration.
create or replace function public.end_tournament(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public._require_role(p_token, array['admin', 'developer']);
  delete from public.tournament_matches      where true;
  delete from public.tournament_participants where true;
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
  public.register_account(text, text, text, text, text, text, text),
  public.login_account(text, text),
  public.validate_session(uuid),
  public.logout_session(uuid),
  public.heartbeat(uuid),
  public.edit_user(uuid, uuid, text, text, text, text, text, text),
  public.delete_user(uuid, uuid),
  public.promote_user(uuid, uuid),
  public.demote_user(uuid, uuid),
  public.join_tournament(uuid),
  public.leave_tournament(uuid),
  public.remove_participant(uuid, uuid),
  public.roll_tournament_numbers(uuid),
  public.clear_tournament(uuid),
  public.create_temp_participants(uuid, integer, integer),
  public.remove_temp_participants(uuid),
  public.save_tournament_settings(uuid, text, integer, integer, jsonb),
  public.enter_final_matchups(uuid, jsonb),
  public.create_manual_matchup(uuid, integer, integer),
  public.remove_tournament_matchup(uuid, integer),
  public.roll_tournament_matchups(uuid),
  public.lock_tournament_matchup(uuid, integer, boolean),
  public.reset_tournament_matchups(uuid),
  public.end_tournament(uuid),
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
--
-- Root cause of the "avatar upload always fails" bug: this file never
-- actually created the `avatars` bucket or its RLS policies on
-- `storage.objects` -- it only left a comment saying to do it manually.
-- If that manual step was never completed against a given project,
-- every upload from uploadAvatar() in src/lib/auth.js fails at the
-- Supabase Storage layer with "Bucket not found" (or a permission
-- error if the bucket exists but has no INSERT policy), regardless of
-- anything on the client. That storage error was then being routed
-- through friendlyError()'s auth-RPC error-code table in auth.js,
-- which has no entry for storage errors, so it silently fell back to
-- the same generic "头像上传失败" message no matter the real cause --
-- see the fix in uploadAvatar() for that half of the bug.
--
-- This block is a best-effort attempt to auto-provision the bucket and
-- policies so this is no longer a required manual step. It's wrapped
-- in its own exception handler and does not touch anything outside the
-- `storage` schema, so it can never break the rest of this migration:
-- `storage.buckets`/`storage.objects` are owned by Supabase's internal
-- `supabase_storage_admin` role on some projects, and depending on the
-- privileges of whatever role actually runs this file (SQL Editor,
-- `supabase db push`, a pooled connection, etc.), this may or may not
-- be permitted -- if it isn't, the block prints a NOTICE naming the
-- underlying error and this becomes a manual step (see below); if it
-- is permitted, avatar upload works immediately with no manual step
-- at all. Re-running this file is always safe (on conflict / if not
-- exists guards throughout).
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;

  drop policy if exists "avatars_public_read" on storage.objects;
  create policy "avatars_public_read" on storage.objects
    for select using (bucket_id = 'avatars');

  drop policy if exists "avatars_public_upload" on storage.objects;
  create policy "avatars_public_upload" on storage.objects
    for insert with check (bucket_id = 'avatars');
exception
  when others then
    raise notice 'Could not auto-provision the "avatars" storage bucket/policies (%). Finish setup manually (see instructions below), then re-run this file to confirm.', sqlerrm;
end $$;
--
-- Manual fallback, only needed if the NOTICE above appears (i.e. the
-- role running this file lacks the required privilege on this
-- project): Supabase Dashboard -> Storage -> New bucket -> name it
-- "avatars", mark it Public, then add policies allowing public SELECT
-- and public INSERT on storage.objects where bucket_id = 'avatars'.
-- Or use the Supabase Management API / CLI (`supabase storage`),
-- which runs with the privileges needed to modify the storage schema.

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

-- Seed the Tournament Settings singleton row so the table is never empty --
-- the dialog always has something to load, even before any admin has saved
-- settings yet.
insert into public.tournament_settings (id)
values (true)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 10. Force PostgREST to pick up this schema immediately
-- ----------------------------------------------------------------------------
--
-- Root-cause fix for a class of bug where a function/column works
-- perfectly when called directly in SQL (as every function in this file
-- has been) but still fails through the app with a generic error -- e.g.
-- "清空参赛名单失败" for clear_tournament despite the function itself
-- being correct. PostgREST (Supabase's REST/RPC layer) caches the
-- database schema and, on some project setups/timings, does not always
-- notice DDL run through the SQL Editor (as opposed to the Supabase CLI's
-- migration flow, which triggers a reload automatically). This NOTIFY is
-- the documented way to force an immediate reload after running this file
-- -- harmless and cheap to send every time, including on a schema that
-- didn't actually change. If a function/column still behaves oddly
-- through the app immediately after running this file, use Supabase
-- Dashboard -> Project Settings -> Data API -> "Reload schema" as a
-- manual fallback (or restart the project), in case this NOTIFY didn't
-- reach a running PostgREST instance for any reason.
notify pgrst, 'reload schema';

-- ============================================================================
-- End of schema. After running this, the "admin" / "111" Developer account
-- exists and can log in immediately.
-- ============================================================================
