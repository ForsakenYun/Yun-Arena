# DEVLOG.md · Project Handoff

**项目**: 选秀台 (Draft Stage) — 锦标赛选秀网站

This is the official project handoff document. It explains what the
project is, what's been decided, what exists today, and what's still
open — not how the code is written or how to run it (see `README.md`
for setup/build instructions). It describes the current state of the
project, not the history of how it got there. Read this before making
changes, and keep it up to date as the project evolves.

---

## 1. Project Overview

选秀台 (Draft Stage) is a tournament drafting website: a gaming-style
platform where players register, get organized into teams via
captains and players, and take part in drafts, live tournaments, and
spectating.

The site is being built one phase at a time, each fully completed and
approved before the next begins. See Section 11 for the full roadmap.

## 2. Current Working Features

Everything below is built and functional against a **real Supabase
Postgres backend** — no sample/mock data remains anywhere in Login,
Registration, or the Admin Dashboard.

- **Login** — real Username + Password authentication. Credentials are
  checked against a bcrypt hash in the database via a database
  function; nothing is hardcoded in the React app. Only one active
  session is allowed per account — see Single Active Session Per
  Account below.
- **Registration** — real accounts are created directly in our own
  `accounts` table (not Supabase Auth). Invite code, display name,
  tournament role, username, password, and optional avatar (uploaded
  to Supabase Storage) are all persisted for real. Confirm Password is
  validated against Password before submitting.
- **Single Active Session Per Account** — logging into an account that
  already has a live session is rejected outright ("该账号已登录。请先退出当前登录后再尝试。"),
  with no second session ever created. Enforced in `login_account`
  itself, not just the frontend. See Section 15, Single Active Session
  Per Account.
- **Real Developer account** — `admin` / `111`, Developer permission
  role, created by the seed step in `supabase/schema.sql`. The old
  hardcoded Temporary Developer Login (former Section 8.1) has been
  completely removed from the React app; this account now
  authenticates exactly like any other. It can never be deleted
  through the app, by anyone — see Section 10, Developer Account
  Protection.
- **Admin Dashboard** — only reachable by logging in with an Admin or
  Developer account; tab-based shell unchanged visually.
- **Tab Navigation** — unchanged from Phase 2.
- **Registered Users** — live table backed by the `accounts` table,
  updating in real time across every connected browser.
- **User Edit/Delete** — writes to the real database through
  permission-checked functions (`edit_user`, `delete_user`).
  `delete_user` refuses to remove a Developer-role account, and the
  Delete button is hidden entirely on Developer rows.
- **Permission Role** — stored in the database (`permission_role`
  column) and enforced server-side, not just displayed.
- **Promote/Demote** — Developer-only, enforced both in the database
  (`promote_user`/`demote_user` reject the call for non-Developers)
  and in the UI (buttons are hidden for Admins). Both are gated behind
  a confirmation dialog (确认提升管理员 / 确认移除管理员) before the
  call is made.
- **Invite Code Management** — codes are generated, validated,
  counted, expired, and deleted for real; a code can no longer be used
  to register once it hits its usage limit or expiration.
- **Real-time synchronization** — Supabase Realtime keeps the
  Registered Users table and the Invite Code table in sync across
  every open browser with no page refresh. See Section 15 for how this
  works for invite codes specifically, since they can't be broadcast
  directly without undermining the invite gate.
- **Logout** — a single click opens a confirmation dialog (确认退出登录);
  confirming invalidates the session token server-side immediately and
  returns to the Login page. Available from both the Admin Dashboard and
  the Tournament Lobby.
- **Live session / presence** — being logged in requires an active
  heartbeat, not just a stored token. Closing the tab or browser (or a
  crash) stops the heartbeat and the session expires server-side on
  its own shortly after, with no reliance on the client getting to run
  a logout. A lost connection while the tab stays open shows a
  reconnect dialog instead of failing silently. See Section 15, Session
  Liveness: Heartbeat & Presence.
- **Tournament Lobby** — the real destination for logged-in "User"
  accounts (Admin/Developer accounts can also reach it from a nav
  button on the Admin Dashboard, to monitor the tournament). Any
  logged-in account can join the tournament in one click; leaving asks
  for confirmation first (确认离开比赛) since it's easy to hit by
  accident. Admin/Developer accounts additionally see a 移除 action on
  every row, letting them force-remove any participant — online or
  not — after a confirmation dialog of their own; this only clears the
  tournament_participants row, never the account, and the player can
  rejoin any time with 参加比赛. The participant list, each
  participant's Online/Disconnected status, and the live statistics all
  sync in real time across every open browser. See Section 16.
- **Roll Numbers** — Admin/Developer-only "随机摇号" button in the
  Tournament Lobby. One click assigns every currently-joined
  participant (online or offline) a unique random number from 1–100,
  all at once, shown in an "抽签号" column beside their name; a new
  roll overwrites the previous one entirely. Once any roll has
  happened, the participant list automatically re-sorts itself
  highest-number-first (new joiners with no number yet sort to the
  bottom); before the first roll, the list stays in normal join order.
  Numbers sync live to every open browser the same way the rest of the
  roster does. A player who joins after a roll shows "—" until the
  next roll. See Section 16, Roll Numbers.
- **Clear Tournament Participants** — Admin/Developer-only "清空参赛名单"
  button in the Tournament Lobby, behind a confirmation dialog
  (确认清空参赛名单). Confirming removes every current participant in
  one action — the same effect as each of them clicking 退出比赛
  themselves, just batched — resetting the participant count to 0.
  Accounts, permissions, and presence are untouched; it just clears
  `tournament_participants`, syncing live across every open browser
  through the same Realtime subscription the rest of the roster uses.
  See Section 16, Clear Tournament Participants.
- **Tournament Settings** — Admin/Developer-only "锦标赛设置" button in
  the Tournament Lobby, opening a dialog with Tournament Name, Number
  of Teams, Players Per Team, and Draft Order Settings. There is only
  ever one settings record (a singleton row) — Save always replaces
  it, never creates another, so reopening the dialog later always
  shows whatever was saved last. This fully replaces the previously
  planned standalone Tournament Configuration phase, which has been
  cancelled. See Section 16, Tournament Settings.
- **Draft Order Settings** — part of the Tournament Settings dialog.
  Captains are assigned manually and never appear in the draft order,
  so there are always exactly Players Per Team − 1 rounds. Saving (or
  changing Number of Teams / Players Per Team) auto-generates a
  default Snake Draft order sized to match; the admin can freely
  retype any round instead (no comma required, spaces auto-insert as
  team numbers are typed). Save is blocked with a clear message until
  every round contains each team number exactly once. This only
  configures the order — the Draft System itself, which will read and
  follow it, is a future phase. See Section 16, Draft Order Settings.
- **Start Tournament (placeholder)** — Admin/Developer-only "开始比赛"
  button in the Tournament Lobby. Currently a placeholder: clicking it
  shows a toast and does not start anything. The Draft System, which
  this button will eventually trigger, is a future phase (Section 11).

## 3. Current Limitations

Intentional, not oversights:

- **Sessions are simple bearer tokens, not JWTs.** There is no
  Supabase Auth, so there's no JWT-based RLS. Every privileged
  database function takes the session token as an explicit argument
  and checks both its validity and its liveness manually — see
  Section 15.
- **No password reset, no "remember me," no email anywhere** — by
  design, unchanged from Phase 1/2 decisions.

## 4. Important Product Decisions

Core decisions that should not be changed without an explicit request:

- **No email anywhere** — not in login, not in registration.
- **Registration is invite-only.** A valid invite code is required to
  register; this must be enforced server-side once a backend exists.
- **Username and Display Name are separate fields on purpose** — see
  Section 5. This is not a duplicate or a mistake.
- **Tournament Role and Permission Role are completely independent.**
  A user's 队长/队员 label has no bearing on their Developer/Admin/User
  permission level, and vice versa. Never conflate the two — see
  Section 5.
- **Only the Developer permission role will be able to manage
  permissions**, once the permission system is enforced — an Admin
  will not be able to promote, demote, or otherwise change anyone's
  permission role. See Section 10.
- **No terms-of-service checkbox, no "remember me," no "forgot
  password."**
- **Simplified Chinese interface** throughout the site.
- **Dark theme with neon teal glow**, modern gaming-style UI, kept
  visually consistent across every page.
- **Login/Registration is intentionally minimal** — a single centered
  card, no side panels or decorative graphics. Don't add heavy
  decoration without being asked.
- **Validation is deliberately low-friction** (e.g. `1` is a valid
  username or password). Don't add stricter rules without being
  asked.

## 5. Terminology

- **Username** — login credential only. Never shown publicly.
- **Display Name (昵称)** — the public name shown throughout the site.
  Kept separate from Username so people can log in with something
  short while displaying a longer or Chinese name.
- **Invite Code** — required to register. Without a valid code,
  registration is not allowed.
- **Tournament Role** — 队长 (Captain) or 队员 (Player), chosen at
  registration. A tournament label only — it does not grant or
  restrict access to any part of the website.
- **Permission Role** — Developer (开发者), Admin (管理员), or User
  (普通用户). Controls (once enforced) who can access the Admin
  Dashboard and manage permissions — see Section 10. Currently
  display-only; not yet enforced (Section 3).

These two "role" concepts are unrelated. A Captain can be a Developer,
Admin, or User; permission role never changes a user's tournament
role, and tournament role never changes a user's permission role.

## 6. Development Rules

- Build one phase at a time.
- Do not implement future phases unless requested.
- Do not redesign completed pages or change existing functionality
  without approval.
- Keep the UI simple and clean; don't add features that weren't
  requested.
- Complete and test each phase before moving to the next.

## 7. Architecture Principles

These describe the overall development philosophy for this project —
how to approach any phase or feature, not the details of a specific
one.

- **Build incrementally.** Grow the project one phase at a time rather
  than building multiple features in parallel.
- **Complete and approve one phase before starting the next.** Don't
  begin a new phase — even a small one — until the current phase is
  finished and signed off.
- **Prefer extending existing UI over redesigning completed pages.**
  When a new requirement touches a finished page, look for a way to
  add to it using established patterns before considering a redesign.
- **Design new systems to be easy to expand later.** Favor
  structures — configs, lists, small reusable pieces — that let future
  phases add to a system without reworking it. (The dashboard's tab
  navigation, built so new tabs can be added without redesigning the
  page, is the current example of this in practice.)
- **Avoid implementing future features unless explicitly requested.**
  Stay scoped to the current phase; don't get ahead of the roadmap.

## 8. Login & Registration

A single page with a Login/Register tab switcher — no separate pages
or routes.

**Login** asks for Username and Password only.

**Registration** asks for, in this order:
1. Avatar (optional — falls back to a default look if skipped)
2. Invite Code (required)
3. Display Name (required)
4. Tournament Role — 队长 or 队员 (required)
5. Username (required)
6. Password (required)
7. Confirm Password (required)

**Validation:**
- Username and Password: letters and numbers only, no spaces or
  symbols, max 20 characters, no minimum length.
- Display Name: Chinese characters, English letters, numbers, and
  spaces allowed, max 20 characters.
- Confirm Password follows the same character rule as Password but is
  not yet checked for matching (Section 3).
- Invite Code and Tournament Role are required but not validated
  against real data yet (Section 3).

### 8.1 Developer Account (formerly "Temporary Developer Login")

As of Phase 3, this is a real database account, not a hardcoded
credential check. `admin` / `111` is seeded into `accounts` +
`credentials` by `supabase/schema.sql`, with `permission_role =
'developer'`. It logs in through the exact same `login_account`
database function as every other account; the only thing distinguishing
it is its permission role. The old client-side hardcoded check has been
deleted from `AuthPage.jsx` entirely.

It appears as a normal row in the Registered Users table (Section 9.1),
same as before.

## 9. Admin Dashboard

Reachable by logging in with any Admin or Developer account (Section
8.1) — a "User"-role account that logs in is kept off this route.
Visually consistent with Login/Registration: dark theme, neon teal
glow, same component style throughout.

The dashboard is organized into **tabs**, with only one section
visible at a time and instant switching (no reload). This is built to
scale — adding a future section (Tournament Management, Draft
Settings, System Settings, Statistics, etc.) means adding one more tab
without redesigning the page or its navigation. Current tabs:
Registered Users and Invite Code Management.

The header shows the currently logged-in account's avatar and Display
Name in the top-right corner, plus a Logout button that returns to the
Login page.

### 9.1 Registered Users

- A search box filters the table live by Display Name (not Username),
  since admins are expected to recognize players by nickname rather
  than login account.
- Table columns: Username, Avatar, Display Name, Tournament Role
  (队长 / 队员), Permission Role (开发者 / 管理员 / 普通用户).
  - Avatars are square with slightly rounded corners; a user with no
    avatar shows a small default placeholder icon instead.
  - The Temporary Developer account (Section 8.1) appears here too,
    with no Tournament Role and a Developer Permission Role.
- Row actions:
  - **Edit** — opens a modal to change Username, Display Name,
    Password, and Tournament Role.
  - **Delete** — removes the user, with a confirmation step. Hidden
    entirely for any Developer-role row — see Section 10's Developer
    Account Protection.
  - **Promote to Admin** — shown on User-role rows; changes Permission
    Role to Admin, behind a confirmation dialog (确认提升管理员).
  - **Demote to User** — shown on Admin-role rows; changes Permission
    Role back to User, behind a confirmation dialog (确认移除管理员).
  - Promote/Demote only ever change Permission Role — they never
    touch Tournament Role. Per Section 10, only a Developer can use
    these; this is enforced both in the UI (hidden for Admins) and in
    the database (the `promote_user`/`demote_user` functions reject
    the call for any non-Developer session).

### 9.2 Invite Code Management

- Generating a code lets the admin set a maximum number of uses
  (default `1`, any positive integer) and, optionally, an expiration:
  never (default), 1/2/3 days from now, or a custom date and time.
- Table columns: Invite Code, Usage (`used / max`), Expiration
  (formatted date, "never expires," or an expired indicator), and
  Actions.
- **Codes are hidden by default**, shown as a masked placeholder with
  a Show button per row — revealing a code lasts for the rest of the
  current page session, with no way to re-hide it. This exists so
  codes aren't accidentally exposed on stream.
- Row actions: Copy (copies the real code regardless of whether it's
  currently shown on screen) and Delete, with the same confirmation
  pattern used for users.

## 10. Permission System (Enforced)

This is the Developer/Admin permission system, enforced server-side
since Phase 3. Every database function that mutates data checks the
caller's session and permission role before doing anything (Section
15) — the UI restrictions in Section 9.1 mirror this but are not the
actual enforcement point.

- **Developer (开发者)** — highest permission level, full access to
  the entire website: the Admin Dashboard and all current/future admin
  features, tournament management, invite code management, viewing all
  registered users, and managing permissions (promoting/demoting users,
  changing any user's permission role).
- **Admin (管理员)** — full access to the Admin Dashboard and all
  tournament management features, with one restriction: an Admin
  cannot manage permissions. Specifically, an Admin cannot promote a
  user to Admin, demote an Admin, or change anyone's permission role.
  Managing permissions is Developer-only.

Tournament Role (队长/队员) remains completely separate from this
system — see Section 5.

**Developer Account Protection.** The Developer account is the
project owner account and must never be removable from the website.
`delete_user` rejects any attempt to delete an account whose
`permission_role` is `developer`, regardless of who's calling it —
this is checked in the database function itself, not just hidden in
the UI, so it holds even against a direct RPC call or a modified
frontend. The Admin Dashboard also hides the Delete button entirely
for any Developer-role row, as a UI convenience on top of that
enforcement. The only way to remove a Developer account is editing
the database directly, outside the app.

## 11. Roadmap

In intended development order:

1. Login & Registration — **done**
2. Admin Dashboard — **done**
3. Backend Foundation — **done** (see Section 15)
4. Tournament Lobby — **done** (see Section 16)
5. Draft System
6. Spectator Page

**Phase 3 – Backend Foundation** is not about building backend
infrastructure for the whole future website — it's scoped to
converting everything already built in Phases 1–2 from frontend mock
data into a real backend-powered system. It includes: database schema,
Supabase setup, authentication, user registration, invite code
validation, user management, the Developer/Admin permission system
(Section 10), real-time synchronization, and persisting all Login,
Registration, and Admin Dashboard data. When Phase 3 is complete,
everything built in Phase 1 and Phase 2 should be fully functional
against the real backend instead of sample data — including retiring
the Temporary Developer Login (Section 8.1) in favor of real
authentication and the Developer/Admin permission system.

**From Phase 4 onward, every new feature builds directly on top of the
Backend Foundation** established in Phase 3 — using the same database,
authentication, permissions, and real-time synchronization from the
start. Future phases should not introduce separate or parallel backend
implementations; they extend what Phase 3 establishes.

Only work on the currently approved phase. Do not skip ahead to a
later phase in this list unless explicitly instructed, even if it
seems like a natural next step.

## 12. Design Guidelines

- Dark theme with neon teal glow accents.
- Modern gaming-style UI.
- Simplified Chinese interface throughout.
- Reuse the existing color palette and component style (cards, inputs,
  buttons, tabs) for visual consistency in future phases rather than
  inventing a new look.

### Full Browser Layout Standard (permanent)

This is a permanent project standard, effective from Phase 4 onward,
and applies to all new pages and page redesigns unless explicitly
instructed otherwise:

- The project's primary target is a 1920×1080 desktop monitor —
  approximately a 1920×953 viewport in Chrome maximized at 100%
  zoom. Mobile responsive support is still required alongside this.
- This standard applies to main application pages/screens — the
  primary views a user navigates between. It does not apply to
  dialogs, modals, settings windows, confirmation dialogs, or other
  temporary popups, which may keep an appropriately fixed, narrower
  width whenever that gives a better user experience.
- Main pages must use the full browser window and make good use of
  the available space. Layouts should naturally expand to fill the
  browser width rather than leaving large empty margins on the left
  and right. Do not constrain a main page's content to a fixed
  maximum width just to keep it centered like a traditional
  document-style webpage — width should stay fluid, with only small
  edge padding.
- Do not add a permanent sidebar to achieve this — navigation stays
  in the top header. Use the freed-up horizontal space for wider
  tables, more panels/cards per row, and denser information display
  instead.

## 13. Technical Requirements

Applies across the whole project:

* React + Vite
* Tailwind CSS
* Dark theme, neon teal glow design
* Modern gaming-style UI
* Simplified Chinese interface

## 14. Maintaining This Document

This document is the single source of truth for the project.

- Update it whenever a phase or feature is completed.
- Update it before handing the project to another developer or
  starting a new chat, so it always reflects the latest project state.
  Development may continue with a different developer or a new AI
  conversation, and this document — not prior chat history — is what
  the next person picks up from.
- Record product decisions and architectural changes, not
  implementation details already visible in the source code — the
  repository itself is the reference for file/folder structure.
- Describe the current state of the project, not the history of how
  it got there — avoid changelog-style writing.
- Keep it concise; consolidate rather than repeat information across
  sections.
- For installation, running, and build instructions, see `README.md`.

## 15. Backend Architecture (Phase 3)

The entire backend is one file: `supabase/schema.sql`. Run it once
against a fresh Supabase project's SQL Editor and everything —
tables, security, and the seeded Developer account — exists. It is
idempotent and safe to re-run.

**No Supabase Auth.** Per the product decision at the top of this
project, accounts live in our own `accounts` table and are checked
with bcrypt (`pgcrypto`'s `crypt()`), not `auth.users`.

**Why a session token instead of a JWT.** Without Supabase Auth there
is no JWT, so Postgres Row Level Security can't use `auth.uid()` the
way it normally would. Instead, `login_account` / `register_account`
issue a random `sessions.token`, which the client stores in
`localStorage` and passes as an explicit argument to every privileged
database function. Each of those functions confirms the session is
alive (see Session Liveness, below), checks the account's
`permission_role`, and only then does anything — so permission
enforcement lives in the database, not just in hidden UI buttons.

**Table exposure, by design:**
- `accounts` — safe columns only (no password), publicly readable,
  Realtime-enabled. This is what makes the Registered Users table
  update live with no page refresh.
- `credentials` — just `account_id` + `password_hash`. Zero RLS
  policies, zero grants. Totally unreachable except from inside a
  `SECURITY DEFINER` function.
- `invite_codes` — also zero RLS policies. This one matters: if codes
  were publicly readable (even just to look "hidden" in the UI),
  anyone with the anon key could list and use them straight from
  devtools, defeating the entire invite-only gate. Codes are only ever
  returned to a caller that `list_invite_codes` has confirmed is
  logged in as Admin/Developer.
- `sessions` — locked the same way as `credentials`. Beyond `token` and
  `expires_at`, it now also tracks `last_seen_at`, which is what the
  heartbeat system below is built on.
- `sync_events` — a tiny public, Realtime-enabled table with no
  payload beyond a scope name (e.g. `{"scope": "invites"}`). Since
  invite codes can't be broadcast directly without leaking them, every
  invite mutation writes a row here instead; the dashboard listens for
  that and re-fetches the list through the permission-checked
  `list_invite_codes` function. This is what makes invite code
  changes sync live across browsers without ever exposing a code
  outside of an authorized fetch.

**All writes to `accounts` and `invite_codes` go through functions**
(`register_account`, `edit_user`, `delete_user`, `promote_user`,
`demote_user`, `create_invite_code`, `delete_invite_code`) — direct
`INSERT`/`UPDATE`/`DELETE` privileges are revoked from the anon/
authenticated roles at the table level, so the only way to write is
through a function that has already checked permissions.

**Avatars** upload straight from the browser to a public `avatars`
Storage bucket; the resulting public URL is stored in
`accounts.avatar_url`. The bucket and its `storage.objects` policies
are **not** created by `supabase/schema.sql` — `storage.buckets` and
`storage.objects` are owned by Supabase's internal
`supabase_storage_admin` role, so statements like `insert into
storage.buckets` fail with "must be owner of table buckets" when run
through the same SQL Editor session as the rest of this file. Creating
the `avatars` bucket (Public) and its public SELECT/INSERT policies is
a one-time setup step done through the Supabase Dashboard or
Management API/CLI instead — see the comment in `schema.sql` Section 8
for the exact steps. Everything in `public.*` in this document still
applies to this migration as normal; only the `storage` schema is
carved out.

Frontend integration lives in `src/lib/`: `supabaseClient.js` (client
singleton), `auth.js` (register/login/session/heartbeat), and
`adminApi.js` (everything the Admin Dashboard calls, plus the two
realtime subscriptions described above). `src/lib/sessionMonitor.js`
and `src/components/DisconnectedModal.jsx` implement the heartbeat/
presence system described next.

### Session Liveness: Heartbeat & Presence

This is a standing policy for the whole project, not just the Admin
Dashboard: **a session is only considered alive while the client is
actively proving it's still there.** Being logged in is treated as a
live connection, not a durable flag — closing the tab, closing the
browser, a crash, or losing connectivity all mean the session should
end, without depending on the client getting a chance to say goodbye.

**Server side.** `sessions.last_seen_at` tracks the last time a given
session proved it was alive. `public._session_timeout()` is the single
source of truth for how long a session may go without one — currently
45 seconds. Every privileged database function funnels through
`_current_session_account()`, which refuses the call and raises
`invalid_session` if `last_seen_at` has gone stale (in addition to the
existing `expires_at` hard cap), and refreshes `last_seen_at` on
success — so any authenticated action doubles as a heartbeat, not just
the dedicated one. This is enforced in the database itself, so it
still works even if the browser crashes and never runs another line of
JS. A `heartbeat(p_token)` RPC exists for the client to call on a
regular interval purely to keep a session alive when the user isn't
otherwise interacting with anything. `logout_session` still deletes
the row outright for an immediate, explicit logout. Dead rows are also
swept up periodically by an optional `pg_cron` job — pure hygiene,
since the timeout check above already refuses stale sessions whether
or not the row has been physically deleted yet, and the schema skips
that job silently if `pg_cron` isn't enabled on the project.

**Client side** (`src/lib/sessionMonitor.js`). While `account` is set,
`App.jsx` runs a heartbeat loop: ping the server every 15 seconds
(comfortably inside the 45-second server timeout). A successful `{ ok:
true }` response keeps things quiet. A successful `{ ok: false }`
response means the server has confirmed the session is genuinely gone
(most commonly because heartbeats stopped for a while — the tab was
closed and later reopened, or was suspended long enough to miss the
window) — the app clears local state and returns to Login with "会话已过期，请重新登录".
A thrown/network error is treated differently: it means "couldn't
reach the server," not "session is invalid," so instead of logging the
user out, the app shows the disconnect dialog (`DisconnectedModal.jsx`
— "网络连接已断开 / 正在尝试重新连接…" with a 重新连接 button) and
retries every 3 seconds in the background, plus immediately on the
browser's `online` event and on a manual click of the button. As soon
as a heartbeat succeeds again, the dialog closes on its own and the
session resumes exactly where it left off, with no other interruption
to the user. If the outage lasted long enough that the session expired
server-side while disconnected, the next successful reconnect attempt
simply reports `{ ok: false }` and the app falls through to the same
expired-session redirect described above — a stale reconnect never
misreports as success.

Net effect: a closed tab/browser stops sending heartbeats and the
session dies server-side within roughly a minute even though no
client-side logout ever ran; a live tab that briefly loses connectivity
gets a clear, honest "you're disconnected, we're retrying" state
instead of silently-failing API calls or a false logout.

### Single Active Session Per Account

Only one session may be alive for a given account at a time.
`login_account` checks `_has_active_session(account_id)` — the same
"alive" definition used everywhere else (`expires_at` hard cap AND
within `_session_timeout()` of `last_seen_at`) — after verifying the
password but before creating a new session row, and rejects the login
with `account_already_logged_in` if one is already alive. The
frontend surfaces this as "该账号已登录。请先退出当前登录后再尝试。"
via the same toast used for other login errors.

This is checked *after* credentials are verified, on purpose: an
incorrect-password guess must not leak whether an account happens to
be logged in elsewhere. It's also checked against genuinely *alive*
sessions only, not just any row in `sessions` — a session that's gone
stale (heartbeat lapsed, tab closed, browser crashed) is not "active"
by this definition, so it never blocks a legitimate re-login; it just
means the previous session dies on its own via the existing timeout
machinery above, same as always. This makes the two features
consistent with each other rather than layering a second, separate
notion of liveness on top.

Enforced entirely in `login_account` itself, so it holds regardless of
what the frontend does or doesn't check first.

### Supabase Compatibility

This project targets Supabase only, not generic PostgreSQL.

- Do not assume PostgreSQL default schemas or `search_path`.
- All new SQL and `SECURITY DEFINER` functions must be written to work
  on a fresh Supabase project.
- Extension functions (such as `pgcrypto`'s `crypt()` and
  `gen_salt()`) must be accessible either by including the
  `extensions` schema in the function `search_path` or by explicitly
  schema-qualifying them.
- Before considering any SQL complete, review it for Supabase
  compatibility (extensions, RPC functions, RLS, permissions,
  Storage, and Realtime).
- `supabase/schema.sql` must never contain statements that modify the
  `storage` schema (`storage.buckets`, `storage.objects`, or policies
  on them) — `storage.*` objects are owned by Supabase's internal
  `supabase_storage_admin` role, not by the role that runs this
  migration, so such statements fail with "must be owner of table
  buckets" (or similar) when run through the SQL Editor. Any Storage
  setup (buckets, bucket policies) is a manual, one-time step done
  through the Supabase Dashboard or Management API/CLI, documented
  inline as a comment where it would otherwise have been created —
  see `schema.sql` Section 8 and the Avatars note above. This
  migration is scoped to the `public` schema only.

## 16. Tournament Lobby (Phase 4)

The Tournament Lobby is the landing page for logged-in "User"
accounts, and a page Admin/Developer accounts can also reach (via a
nav button on the Admin Dashboard) to monitor the tournament. It
introduces two small public tables and reuses everything else —
sessions, the heartbeat system, and the Realtime architecture — as-is.

### Participation vs. presence are two separate tables

- `public.tournament_participants` (`account_id`, `joined_at`) is the
  tournament roster. A row is only ever inserted by `join_tournament`
  and only ever deleted by `leave_tournament`, both of which require a
  live session. Nothing else touches this table — not a disconnect,
  not a heartbeat timeout, not a logout. This is the direct
  implementation of the product decision that "a player's tournament
  participation and online status are two separate concepts."
- `public.presence` (`account_id`, `last_seen_at`) is a public-safe
  mirror of liveness, deliberately separate from the locked
  `public.sessions` table (which stays server-only, per Section 15).
  It is upserted by `login_account`, `register_account`, `heartbeat`,
  and — via `_current_session_account()` — every other privileged RPC
  call, so any authenticated action keeps a player's presence fresh,
  not just the dedicated heartbeat tick. It is deleted outright by
  `logout_session`, so an intentional logout reads as Disconnected
  immediately rather than waiting out the timeout.

Both tables are public read (RLS `using (true)`), like `accounts`
already is; all writes go through `SECURITY DEFINER` functions. Both
are added to the `supabase_realtime` publication.

### Online/Disconnected is a client-side judgement, not a server push

Nothing proactively flips a row to "disconnected" when a player goes
quiet — there's no cron job walking `presence` looking for stale rows.
Instead, the client compares `last_seen_at` against the same
`_session_timeout()` window (45s) used for session liveness, and
recomputes that comparison locally on a short timer (`tournamentApi.js`
exports `PRESENCE_TIMEOUT_MS` and `isOnline()`; `TournamentLobby.jsx`
ticks a `now` state every 3s). A realtime `presence` update on a fresh
heartbeat/login snaps a player back to Online immediately; the passage
of time with no new update is what silently ages someone into
Disconnected. This mirrors the reasoning in Section 15's Heartbeat &
Presence architecture, just surfaced to the UI instead of gating
access.

### Data flow

`tournamentApi.js` fetches `tournament_participants`, `accounts`, and
`presence` as three flat queries and merges them client-side (rather
than relying on PostgREST's nested-embedding inference), then
subscribes to all three tables on one Realtime channel and refetches
on any change — join, leave, a heartbeat's fresh `last_seen_at`, or an
account edit (display name/avatar) all land in the lobby live, the
same "any relevant change re-runs a plain `select`" pattern the Admin
Dashboard already uses.

### Navigation

- `App.jsx` sends Admin/Developer accounts to `#admin` and every other
  account to `#lobby`, both on fresh login and on session restore.
- The Admin Dashboard header has a "锦标赛大厅" button that sets the
  hash to `#lobby`; the Tournament Lobby header has a matching "管理后台"
  button (visible only to Admin/Developer accounts) that sets it back
  to `#admin`. Neither page was otherwise redesigned.

### Confirmation dialogs (Logout, Leave Tournament, admin removal, Promote/Demote)

Clicking Logout, Leave Tournament (退出比赛), an admin's 移除 action, or
Promote/Demote in the Admin Dashboard never fires the underlying
request directly — each opens a shared `src/components/ConfirmDialog.jsx`
first (title + message + 取消 / confirm button), and only the confirm
button calls the real API. This is a single click on the triggering
button either way; the extra step is the confirmation itself, not a
second click needed to register the first one.

`ConfirmDialog` is visually modeled on AdminDashboard.jsx's existing
local `ConfirmDeleteModal` (same overlay, panel, and icon treatment) but
lives in its own file so it can be shared across AdminDashboard.jsx
(logout, promote, demote) and TournamentLobby.jsx (logout, leave, admin
removal) without duplicating that markup a third, fourth, fifth, and
sixth time. It takes a `tone` prop — `danger` for destructive/impactful
actions (leave tournament, admin removal, demote) and `neutral` for
actions that aren't destructive (logout, promote) — and a `busy` prop
that disables both buttons and swaps the confirm label to "处理中…"
while the request is in flight.

### Admin/Developer tournament removal

`public.remove_participant(p_token, p_target_account_id)` is the
admin-side twin of `leave_tournament`: same effect (deletes the
`tournament_participants` row, nothing else), but callable against any
account and gated by `_require_role(p_token, array['admin',
'developer'])` instead of only ever touching the caller's own row. It
does not touch `public.accounts` or `public.presence` — a
force-removed player can rejoin immediately by clicking 参加比赛 again,
exactly as if they'd left voluntarily. The 移除 button and its
confirmation dialog only render when `account.permission_role` is
`admin` or `developer`; regular Users never see the column. Because the
underlying delete is the same table write `leave_tournament` makes, it
flows through the same Realtime subscription and updates every open
browser's participant list and stats without any additional wiring.

### Roll Numbers

`tournament_participants.roll_number` (nullable integer, default
`null`) holds each participant's assigned number. `public
.roll_tournament_numbers(p_token)`, gated by `_require_role(...,
array['admin', 'developer'])`, assigns every row currently in
`tournament_participants` a unique random integer from 1–100 in a
single `UPDATE ... FROM` statement (a random permutation of `1..100`
paired against a random ordering of participants) — the roll only
ever reads that table, so offline-but-still-joined participants get a
number exactly the same as online ones, since participation and
presence are unrelated (see "Participation vs. presence" above). If
more than 100 accounts have joined, the function raises
`roll_range_too_small` rather than silently reusing numbers, since
duplicates are never allowed. Running it again overwrites every
`roll_number` unconditionally — there's no "only fill in the blanks"
mode. A participant row created after a roll (a fresh join, or a
rejoin after leaving) simply starts at `null` and stays that way until
the next roll.

No new table, RLS policy, or Realtime wiring was needed:
`tournament_participants` was already public-read and already
Realtime-enabled for the participant list itself, so the "抽签号"
column populates live across every open browser through the exact
same subscription `fetchLobby`/`subscribeLobby` already use. The
"随机摇号" button in the Tournament Lobby header is admin/developer-only
(same `isStaff` check as the 管理后台 button and the 移除 action) and
is a plain one-click action with no confirmation dialog, since
re-rolling is a repeatable, non-destructive-to-participation action
(it never removes anyone from the tournament) rather than an
irreversible one like Leave or Remove.

Once any participant has a `roll_number`, `TournamentLobby.jsx` sorts
the rendered list highest-number-first (participants still at `null`
sort to the bottom); before the first roll ever runs, the list is left
in its normal join-order. This is a purely client-side `useMemo` sort
over the same data the fetch/Realtime path already produces — the
`fetchLobby()` query itself is unchanged and still orders by
`joined_at`, so nothing about how data is fetched or synced needed to
change for the sort to work.

### Clear Tournament Participants

`public.clear_tournament(p_token)`, gated the same way as
`roll_tournament_numbers`, deletes every row in
`tournament_participants` in one statement. It is the batched
equivalent of every joined player clicking 退出比赛 themselves — same
table, same effect, so it needs no separate Realtime wiring either;
the existing `tournament_participants` subscription reports the
deletes exactly like it would for individual leaves, and
`roll_number` disappears along with the rows rather than being
"reset" as a separate step. `public.accounts`, `permission_role`, and
`public.presence` are all untouched. The "清空参赛名单" button sits next
to "随机摇号" in the header (same `isStaff` gate) and, being
irreversible and affecting everyone at once, is gated behind
`ConfirmDialog` (确认清空参赛名单 / 确定要移除所有已参加比赛的玩家吗？
/ 取消 / 确认清空) the same way Leave Tournament and admin removal are.

### Tournament Settings

**This replaces the previously planned standalone "Tournament
Configuration" phase.** That phase — a separate page or Admin
Dashboard tab — has been cancelled; Tournament Settings is instead a
dialog inside the existing Tournament Lobby. Originally this dialog
covered only Save/load settings and remembering the last saved
settings; it now also covers Draft Order Settings (see the subsection
below) as an extension of the same dialog. It still does not touch
actually drafting players, brackets, or teams — those remain out of
scope until the Draft System phase; Draft Order Settings only decides
what order the (not-yet-built) Draft System will eventually follow.

`public.tournament_settings` is a singleton table: its primary key
`id` is declared `boolean` with `check (id)`, so the only value it can
ever hold is `true`. Combined with the primary key's uniqueness, this
makes "there is only one active Tournament Settings record" a
structural guarantee rather than an app-level convention — there is no
`WHERE` clause or cleanup job relying on nobody accidentally inserting
a second row; a second row is simply not representable. `id=true` is
seeded once at the end of `supabase/schema.sql` (idempotent, `on
conflict (id) do nothing`), so the table is never empty and the
dialog always has something to load, even before an admin has ever
saved anything.

`save_tournament_settings(p_token, p_tournament_name, p_team_count,
p_players_per_team, p_draft_order)` is gated by `_require_role(...,
array['admin', 'developer'])`, validates every field (including
`p_draft_order` — see Draft Order Settings below), then `insert ...
on conflict (id) do update` the same row. "Save" is therefore always
"replace the one active record" — there's no code path that could
create a second configuration, and no notion of presets to choose
between. Because every save updates the same row,
`TournamentSettingsDialog.jsx` fetching that row on open is exactly
"remember the last saved settings": whatever an admin saved today is
what the dialog pre-fills tomorrow, with no extra history or
versioning involved.

`tournament_settings` is public-read like the rest of the Lobby's
data, but deliberately **not** added to the Realtime publication —
nothing in the app subscribes to it. The dialog fetches once when it
opens and writes once on Save; two admins with the dialog open at the
same time simply follow last-write-wins. If a future phase needs the
tournament name or team count to update live elsewhere in the UI,
adding the table to the publication is a one-line change — see how
`tournament_participants` and `presence` were added for the pattern.

### Draft Order Settings

Part of the Tournament Settings dialog, not a separate feature or
page. Captains are assigned manually by the admin and never appear in
the draft order, so the number of rounds is always `players_per_team
- 1`, and each round is a permutation of `1..team_count` (one entry
per team, no duplicates, none missing).

`tournament_settings.draft_order` is a `jsonb` column: an array of
rounds, each round itself an array of team numbers, e.g. `[[1,2,...,
8],[8,7,...,1],...]`. It's added the same idempotent way
`tournament_participants.roll_number` was (`alter table ... add
column if not exists`), and validated inside
`save_tournament_settings` by sorting each round ascending and
checking it's exactly `[1, 2, ..., team_count]` — a single array
comparison that simultaneously proves every team number appears
exactly once and none is missing or duplicated. This is the real
enforcement point; `tournamentApi.js`'s `validateDraftRound` runs the
identical check client-side purely so Save can be disabled with an
inline message before even attempting the request, exactly the same
relationship every other confirmation/validation in this project has
to its database-side twin.

**Default generation and regeneration.** `generateSnakeDraft(teamCount,
playersPerTeam)` produces the default order: odd rounds ascending
`1..N`, even rounds descending `N..1`. `TournamentSettingsDialog.jsx`
generates this default whenever there's no saved `draft_order` to load
(first-ever save) and regenerates it from scratch whenever the admin
changes Number of Teams or Players Per Team to a genuinely different
value during editing — tracked via a `shapeRef` so the dialog doesn't
regenerate on every render, only on an actual shape change, and
doesn't clobber a freshly-loaded custom order the instant the dialog
opens. A shape change invalidates whatever was there before anyway
(different team count or round count), so replacing it with a fresh
Snake Draft default is strictly better than trying to patch a
now-mismatched custom order. The system never forces Snake Draft to
stay — it's only ever the starting template; the admin can retype any
round into any permutation and it's saved exactly as edited.

Regeneration happens **synchronously inside the same `onChange`
handler** that updates `teamCount`/`playersPerTeam` (`handleTeamCount
Change`/`handlePlayersPerTeamChange` call `maybeRegenerate` directly),
not in a separate `useEffect` keyed on those values. An effect-based
version was tried first and had a one-frame race: the effect only
runs on the render *after* the input's `onChange` already committed
the new team count, so for that one frame `teamCountNum` reflected the
new value while `roundTexts` still held the old, now-mismatched
rounds — exactly the window where `roundErrors` validated stale text
against the new team count and every round flashed red with a message
like "需要恰好 8 个号码" before self-correcting. Doing both state
updates in the same event (same React batch) means there is no render
where they're out of sync in the first place, which is why the fix is
structural rather than a debounce or a "suppress errors during
regeneration" flag layered on top.

**Auto-formatting the input.** Round order is typed as
space-separated numbers, no commas, and the admin isn't expected to
press space themselves — `formatDraftRoundInput` in
`tournamentApi.js` inserts it automatically as they type, using a
small state machine that decides whether the digit just typed extends
the number currently being typed or starts a new one. The default rule
is to close out the current number as soon as it's a valid,
not-yet-used team number (this is what turns `12345678` into
`1 2 3 4 5 6 7 8` for an 8-team tournament); it only keeps extending
when closing would be wrong — either the digit just typed is `0` (a
team number can never start with `0`, so it must belong to the
previous number instead) or the current number's value was already
used earlier in the same round (forcing it to grow into a different,
larger number) — which is what correctly turns `123456789101112` into
`1 2 3 4 5 6 7 8 9 10 11 12` for a 12-team tournament. Documented
directly in `tournamentApi.js`: a brand-new multi-digit number with no
internal `0` and no earlier collision (e.g. typing `23` as the very
first characters of a 30-team tournament's round) is genuinely
ambiguous with no further context and may render as `2 3` — a manual
space edit fixes it, and Save-time validation catches the result
either way regardless of how the text got there.

### Start Tournament (placeholder)

The "开始比赛" button next to the other admin controls in the header is
intentionally inert: its click handler only shows a toast
("选秀系统将在下一阶段上线，敬请期待") and calls no RPC. It exists so the
UI slot is in place before the Draft System phase actually implements
what happens when a tournament starts. Do not read this button as an
API contract or a hint at the Draft System's design — it's a marker,
nothing more.

## 17. Desktop UI Optimization (Phase 4)

`TournamentLobby` and `AdminDashboard` are laid out as a desktop
app frame rather than a centered webpage, targeting a 1920×1080
monitor at 100% browser zoom (~1920×953 usable viewport) while still
degrading gracefully to normal stacked/scrolling behavior on mobile.
`AuthPage` is unaffected — it stays a single centered card by design
(see the login/registration note elsewhere in this document).

- No permanent sidebar was added. Navigation stays in the top
  header, exactly as before; only the content below it was
  reorganized into a wider, denser layout.
- The outer shell is `min-h-screen ... flex flex-col lg:h-screen
  lg:overflow-hidden`, with an inner `w-full` wrapper that has
  **no max-width cap** — only small edge padding (`px-4 sm:px-5
  lg:px-6`, i.e. 16–24px). The content genuinely expands to fill
  the browser window on any monitor width, including ultrawide;
  it does not stop at a fixed pixel ceiling. The `lg:` prefix on
  the height classes is deliberate: at `lg:h-screen` the page becomes a
  fixed-height app frame where the header, stat/join row, and (on
  the admin side) tab bar are `shrink-0` and only the
  participant/user/invite table area is `lg:flex-1 lg:min-h-0
  overflow-y-auto` — that's the "only the content area should
  scroll" requirement. Below `lg`, none of the height-constraining
  classes apply, so mobile falls back to plain document flow and a
  normal full-page scroll.
- Table headers use `sticky top-0` on the `<th>` cells (not the
  `<tr>`) so they stay pinned while the table body scrolls inside
  its own container.
- `TournamentLobby`: the three stat cards and the join/leave card
  now share one row on large screens (`grid-cols-12`: stats take 7
  columns, join/leave takes 5) instead of stacking full-width above
  the table, so the same information fits in far less vertical
  space.
- `AdminDashboard`: each tab's header row now also shows compact
  `StatChip` summaries (total/admin/developer counts for 已注册用户;
  total/active counts for 邀请码管理) next to the search box or
  "生成邀请码" button, so the freed-up horizontal space surfaces
  useful counts instead of staying empty. These are derived client-side
  from `users`/`invites` via `useMemo` — no new RPCs.

## 18. Gender Field (Phase 4 UI Enhancement)

`accounts.gender` (`'male' | 'female'`, nullable at the table level)
is required at registration and is display-only for now — it has no
effect on permissions, matchmaking, drafting, or any other
functionality. Treat it purely as a profile attribute unless a future
phase explicitly says otherwise.

- Registration: a `性别` field sits directly below `身份` on the
  Registration form (男生 / 女生, same required-radio-button pattern
  as 身份). `register_account()` takes a new required `p_gender`
  param, validates it the same way `p_tournament_role` is validated,
  and raises `invalid_gender` (mapped client-side to "请选择性别") if
  missing or invalid.
- Accounts created outside `register_account()` — currently just the
  seeded `admin`/Developer account — have `gender = null`, the same
  way that account already has `tournament_role = null`. Display code
  must treat `null` as "unknown", not crash or assume a default.
- Display: wherever player info is already shown as a table
  (Admin Dashboard's 已注册用户 list, Tournament Lobby's participant
  list), there's now a `性别` column showing only a small icon — blue
  Mars symbol for 男生, pink Venus symbol for 女生, a muted dash for
  unknown/null. No text label next to the icon; the icon alone is the
  content. Any future Player Card should follow the same icon-only
  convention. The icon is a small inline SVG (not the Unicode ♂/♀
  glyphs) so it stays visually consistent with the rest of the
  project's stroke-based icon set.
- Gender is not editable from the Admin Dashboard's edit-user dialog
  — only set once, at registration. Add that later only if a future
  phase explicitly asks for it.

## 19. Bug Fix: Registration Avatar Upload

Symptom: selecting an avatar during registration always made
registration fail with a generic "头像上传失败" message; leaving the
avatar empty always worked.

Two real problems, both fixed at the root rather than worked around:

1. **Section 8 (Storage bucket) never actually created the `avatars`
   bucket or its RLS policies** — it only left a comment saying to do
   that manually via the Dashboard. If that manual step was never
   done on a given project, `uploadAvatar()` in `src/lib/auth.js`
   fails every single time at the Supabase Storage layer ("Bucket not
   found", or a permission error if the bucket exists without an
   INSERT policy) — regardless of anything on the client. Section 8
   now attempts to auto-provision the bucket + public
   read/insert policies on `storage.objects` itself, wrapped in an
   exception handler so it's a harmless no-op (with a `NOTICE`) on any
   project where the connecting role doesn't have enough privilege to
   touch the `storage` schema — see that section for the fallback
   manual steps, only needed if the NOTICE fires.
2. **`uploadAvatar()` was routing storage errors through
   `friendlyError()`**, which only knows the Postgres exception codes
   raised by this project's own auth RPCs (`invalid_username`,
   `invite_expired`, etc.). A storage error never matches any of
   those, so it always fell back to the same generic message no
   matter the real cause, which is exactly what made this bug hard to
   diagnose. `uploadAvatar()` now throws the real
   `error.message` from Supabase Storage (prefixed with `头像上传失败：`
   for context), so a future upload failure is actually debuggable
   from the toast instead of always looking identical.

Registration behavior otherwise unchanged: no avatar selected still
skips upload entirely and works exactly as before; a successful
upload still gets linked to the new account via `p_avatar_url` on
`register_account()`, same as originally designed.

## 20. Bug Fix: Registration Created an Active Login Session

Symptom: register a new account -> land back on the Login tab as
intended -> immediately trying to log in with that same account fails
with `account_already_logged_in` ("该账号已登录。请先退出当前登录后再尝试。"),
until the session timeout (Section 15) expired on its own.

Root cause: `register_account()` was doing more than registering. At
the end of the function it also ran
`insert into public.sessions (account_id) values (v_account.id)` and
upserted a `public.presence` row, i.e. it logged the new account in
and marked it online as a side effect of registering, even though the
UI never treated registration as a login (`AuthPage.jsx` always calls
`switchMode('login')` after a successful register, never
`onLoggedIn`). That orphaned session then made `login_account()`'s
`_has_active_session()` check (Section 15 -- Single Active Session Per
Account) see the brand-new account as already logged in on the very
next login attempt, since nothing had ever called `logout_session()`
to close it.

Fix, at the root: `register_account()` no longer touches
`public.sessions` or `public.presence` at all -- it only inserts into
`public.accounts` and `public.credentials` and returns
`{ account }` (no `token`). `src/lib/auth.js`'s `register()` no longer
calls `storeToken()` after registering, since there is no token to
store. `login_account()` is unchanged and remains the only place a
session/presence row is ever created for an account -- registration
and login are now fully separate, matching the ask: a new account can
log in immediately, and is not considered "online" until it actually
does.

## 21. Admin Dashboard: Edit User Improvements

`EditUserModal` (in `AdminDashboard.jsx`) now also supports:

- **Avatar editing**: the same picker UI as `AuthPage.jsx`'s
  registration form (circular preview, camera-badge upload button),
  pre-filled with the user's current avatar. It reuses
  `uploadAvatar()` from `src/lib/auth.js` unchanged -- there is only
  ever one avatar upload code path in the app. Choosing a new file
  uploads it on submit, same timing as registration; leaving it
  untouched sends `p_avatar_url = null` to `edit_user()`, which reads
  as "don't touch the existing avatar" (`coalesce(p_avatar_url,
  avatar_url)`), the same convention already used for the optional
  password field.
- **Gender editing**: a `GenderToggle` (男生/女生), same component
  pattern as `RoleToggle`. `edit_user()` now takes a required
  `p_gender` and validates it exactly like `register_account()` does.
  Because both tables that display `GenderIcon` (已注册用户 and
  参赛玩家) subscribe to realtime `accounts` changes already, an edit
  here updates the icon everywhere immediately with no extra wiring.

**Developer Account Protection** (security-relevant -- enforced at
both layers, not just the UI):

- Frontend: in the 已注册用户 table, the 编辑 button is hidden for any
  row where `permission_role = 'developer'` unless the viewer
  themselves is a Developer (`isDeveloper || u.permission_role !==
  'developer'`). This mirrors how the 删除 button is already hidden
  for Developer rows entirely.
- Backend (the actual enforcement point): `edit_user()` now selects
  the target account first and rejects with `cannot_edit_developer`
  if the target's `permission_role` is `'developer'` and the acting
  session's `permission_role` isn't -- regardless of what the UI
  shows, so a crafted RPC call bypassing the hidden button is still
  rejected. A Developer editing another Developer account is
  unaffected. This is intentionally a different rule from
  `delete_user()`'s Developer check (Section 10/16), which blocks
  deleting a Developer account for *everyone*, including other
  Developers -- editing a Developer account is allowed for Developers,
  only Admins are blocked.
