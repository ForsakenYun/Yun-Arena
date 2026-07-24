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
  function; nothing is hardcoded in the React app.
- **Registration** — real accounts are created directly in our own
  `accounts` table (not Supabase Auth). Invite code, display name,
  tournament role, username, password, and optional avatar (uploaded
  to Supabase Storage) are all persisted for real. Confirm Password is
  validated against Password before submitting.
- **Real Developer account** — `admin` / `111`, Developer permission
  role, created by the seed step in `supabase/schema.sql`. The old
  hardcoded Temporary Developer Login (former Section 8.1) has been
  completely removed from the React app; this account now
  authenticates exactly like any other.
- **Admin Dashboard** — only reachable by logging in with an Admin or
  Developer account; tab-based shell unchanged visually.
- **Tab Navigation** — unchanged from Phase 2.
- **Registered Users** — live table backed by the `accounts` table,
  updating in real time across every connected browser.
- **User Edit/Delete** — writes to the real database through
  permission-checked functions (`edit_user`, `delete_user`).
- **Permission Role** — stored in the database (`permission_role`
  column) and enforced server-side, not just displayed.
- **Promote/Demote** — Developer-only, enforced both in the database
  (`promote_user`/`demote_user` reject the call for non-Developers)
  and in the UI (buttons are hidden for Admins).
- **Invite Code Management** — codes are generated, validated,
  counted, expired, and deleted for real; a code can no longer be used
  to register once it hits its usage limit or expiration.
- **Real-time synchronization** — Supabase Realtime keeps the
  Registered Users table and the Invite Code table in sync across
  every open browser with no page refresh. See Section 15 for how this
  works for invite codes specifically, since they can't be broadcast
  directly without undermining the invite gate.
- **Logout** — invalidates the session token server-side and returns
  to the Login page.

## 3. Current Limitations

Intentional, not oversights:

- **No real user-facing destination yet for the "User" permission
  role.** Phase 3 only builds out Login/Registration/Admin Dashboard;
  a logged-in "User"-role account currently sees a toast saying it has
  no dashboard access. The Tournament Lobby (Phase 4) is where regular
  users will land.
- **Sessions are simple bearer tokens, not JWTs.** There is no
  Supabase Auth, so there's no JWT-based RLS. Every privileged
  database function takes the session token as an explicit argument
  and checks it manually — see Section 15.
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
  - **Delete** — removes the user, with a confirmation step.
  - **Promote to Admin** — shown on User-role rows; changes Permission
    Role to Admin.
  - **Demote to User** — shown on Admin-role rows; changes Permission
    Role back to User.
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

## 11. Roadmap

In intended development order:

1. Login & Registration — **done**
2. Admin Dashboard — **done**
3. Backend Foundation — **done** (see Section 15)
4. Tournament Lobby
5. Tournament Configuration
6. Draft System
7. Spectator Page

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
database function. Each of those functions looks the token up, checks
it hasn't expired, and checks the account's `permission_role` before
doing anything — so permission enforcement lives in the database, not
just in hidden UI buttons.

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
- `sessions` — locked the same way as `credentials`.
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
Storage bucket (created by the same schema file); the resulting public
URL is stored in `accounts.avatar_url`.

Frontend integration lives in `src/lib/`: `supabaseClient.js` (client
singleton), `auth.js` (register/login/session), and `adminApi.js`
(everything the Admin Dashboard calls, plus the two realtime
subscriptions described above).
