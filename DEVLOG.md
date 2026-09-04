# DEVLOG.md · Project Handoff

**项目**: 选秀台 (Draft Stage) — 锦标赛选秀网站

This is the official project handoff document: what the project is,
what's been decided, what exists today, and what's still open — not
how the code is written (the repository is the reference for that;
see `README.md` for setup/build). It describes the **current state**
of the project, not a history of how it got there. Read this before
making changes, and keep it current as the project evolves — replace
outdated statements rather than appending a new entry that contradicts
an old one left in place.

---

## 1. Project Overview

选秀台 (Draft Stage) is a tournament drafting website: a gaming-style
platform where players register, get organized into teams via
captains and players, and take part in drafts, live tournaments, and
spectating.

Built one phase at a time, each completed and approved before the next
begins. See Section 2 for phase status.

## 2. Roadmap / Phase Status

1. Login & Registration — **done**
2. Admin Dashboard — **done**
3. Backend Foundation — **done** (Section 6)
4. Tournament Lobby — **done** (Section 7)
5. Draft System — **done** (Section 8). Live real-time sync of the
   captain/teammate draft itself (previously the one outstanding piece)
   now exists as a one-way broadcast to `tournament_draft_state`, added
   in Phase 6 purely to feed the Spectator Page — see Section 8's Live
   Draft State note and Section 9.
6. Spectator Page — **done** (Section 9)

**Phase 3 (Backend Foundation)** converted everything from Phases 1–2
off frontend mock data onto a real Supabase Postgres backend. **Every
phase from 4 onward builds directly on that same database,
authentication, permissions, and real-time layer** — new phases should
never introduce a separate/parallel backend.

Only work on the currently approved phase; don't skip ahead unless
explicitly instructed.

## 3. Product Decisions & Development Rules

Core decisions — do not change these without an explicit request:

- **No email anywhere.** No password reset, no "remember me," no
  terms-of-service checkbox.
- **Registration is invite-only**, enforced server-side.
- **Username and Display Name are separate fields on purpose** (Section 4).
- **Tournament Role and Permission Role are completely independent** —
  never conflate them (Section 4).
- **Only the Developer permission role manages permissions** — an
  Admin can never promote, demote, or change anyone's permission role.
- **Simplified Chinese interface**, dark theme with neon teal glow,
  modern gaming-style UI, consistent across every page — except the
  Draft Arena, which is an intentionally separate self-contained gold/
  Cinzel-Orbitron visual system (see Section 8) that was delivered
  pre-built and is not meant to be restyled to match the rest of the
  app.
- **Login/Registration stays a single centered card** — no side panels
  or decorative graphics.
- **Validation is deliberately low-friction** (e.g. `1` is a valid
  username/password) — don't add stricter rules unasked.

Development rules:
- Build one phase at a time; don't implement future phases unasked.
- Don't redesign completed pages or change existing functionality
  without approval — prefer extending established patterns.
- Design new systems to be easy to expand later (e.g. the dashboard's
  tab navigation).
- Keep the UI simple; don't add unrequested features.

**Full Browser Layout Standard** (permanent, from Phase 4 onward,
applies to main pages only — not dialogs/modals): target a 1920×1080
desktop monitor. Main pages fill the full browser width with only
small edge padding (no fixed max-width, no centered document-style
layout) and use a fixed-height app-frame shell (`lg:h-screen
lg:overflow-hidden`) where the header/stat rows are `shrink-0` and only
the content/table area scrolls (`lg:flex-1 lg:min-h-0 overflow-y-auto`).
No permanent sidebar — navigation stays in the top header. Below the
`lg` breakpoint, everything falls back to normal stacked, full-page
scroll for mobile. Applied to `TournamentLobby`, `AdminDashboard`, and
`DraftArena`'s own pages (`AuthPage` is exempt — it stays a single
centered card by design).

**Technical stack:** React + Vite, Tailwind CSS, Supabase (Postgres +
Storage + Realtime, no Supabase Auth).

## 4. Terminology

- **Username** — login credential only, never shown publicly.
- **Display Name (昵称)** — the public name shown throughout the site.
- **Invite Code** — required to register.
- **Tournament Role** — 队长 (Captain) or 队员 (Player), chosen at
  registration. A tournament label only — grants no site access.
- **Permission Role** — Developer (开发者) / Admin (管理员) / User
  (普通用户). Controls Admin Dashboard access and permission
  management (Section 5).

These two "role" concepts are unrelated: a Captain can be a Developer,
Admin, or User, and neither role ever changes the other.

## 5. Permission System (enforced server-side)

- **Developer (开发者)** — full access to everything, including
  managing permissions (promote/demote, change any permission role).
  The seeded `admin`/`111` account. Can never be deleted through the
  app by anyone (`delete_user` rejects it in the database itself,
  regardless of caller); the Delete button is also hidden for
  Developer rows in the UI. An Admin *can* edit a Developer account's
  profile fields, but cannot delete it or change permissions.
- **Admin (管理员)** — full access to the Admin Dashboard and
  tournament management, except managing permissions.
- Every privileged database function checks the caller's session and
  `permission_role` before doing anything — the UI mirrors this but is
  not the actual enforcement point.

## 6. Backend Architecture (Phase 3)

The entire backend is one idempotent file: `supabase/schema.sql`. Run
it once against a fresh Supabase project's SQL Editor and everything
(tables, security, seeded Developer account) exists; safe to re-run.

- **No Supabase Auth.** Accounts live in `public.accounts`, passwords
  in `public.credentials` (bcrypt via `pgcrypto`), checked through
  `SECURITY DEFINER` functions — not `auth.users`.
- **Session tokens, not JWTs.** `login_account`/`register_account`
  issue a random `sessions.token` (stored client-side in
  `localStorage`), passed explicitly to every privileged RPC. Every
  such RPC verifies the token is alive before doing anything, so
  permission enforcement lives in the database, not hidden UI buttons.
- **Table exposure:** `accounts` is public-read + Realtime (drives live
  UI updates). `credentials`, `invite_codes`, and `sessions` have zero
  RLS policies/grants — only reachable from inside a `SECURITY
  DEFINER` function. `sync_events` is a tiny public/Realtime table used
  to signal "something in invite codes changed" without ever
  broadcasting a code directly. All writes to `accounts`/
  `invite_codes` go through functions (`register_account`, `edit_user`,
  `delete_user`, `promote_user`, `demote_user`, `create_invite_code`,
  `delete_invite_code`) — direct table writes are revoked at the role
  level.
- **Avatars** upload to a public `avatars` Storage bucket; the URL is
  stored on `accounts.avatar_url`. `storage.*` objects are owned by
  Supabase's internal role, so the bucket + its policies can't be
  created by `schema.sql` itself — `schema.sql` attempts to
  auto-provision them (wrapped in an exception handler, harmless
  no-op + `NOTICE` if the connecting role lacks privilege); the
  fallback is a one-time manual setup via the Supabase Dashboard (see
  `schema.sql` Section 8's comment).
- Frontend integration: `src/lib/supabaseClient.js` (client),
  `auth.js` (register/login/session/heartbeat/avatar upload),
  `adminApi.js` (Admin Dashboard RPCs + its two Realtime
  subscriptions), `tournamentApi.js` (Lobby + Draft Arena RPCs),
  `sessionMonitor.js` + `DisconnectedModal.jsx` (heartbeat/presence,
  below).

### Session liveness (standing policy, whole project)

A session is only "alive" while the client actively proves it, not a
durable flag — closing the tab/browser/crash should end it without
relying on a graceful client-side logout.

- **Server:** `sessions.last_seen_at` + `_session_timeout()` (currently
  45s) is the single definition of "alive," enforced inside
  `_current_session_account()` (which every privileged RPC funnels
  through) alongside the existing `expires_at` cap. A `heartbeat
  (p_token)` RPC lets the client refresh it on a timer; any
  authenticated call refreshes it too. `logout_session` deletes the
  row outright. An optional `pg_cron` job sweeps dead rows (pure
  hygiene, skipped silently if `pg_cron` isn't enabled).
- **Client:** `sessionMonitor.js` pings `heartbeat` every 15s. `{ok:
  false}` (server confirms the session is genuinely gone) → clear
  state, return to Login with "会话已过期，请重新登录". A thrown/network
  error (can't reach the server, not "session invalid") → show
  `DisconnectedModal` ("网络连接已断开 / 正在尝试重新连接…"), retry every
  3s + on the `online` event + on manual click; resumes silently on
  the next successful heartbeat.
- **Single active session per account:** `login_account` rejects a
  login with `account_already_logged_in` if the account already has a
  genuinely alive session (checked *after* password verification, so a
  wrong-password guess can't leak whether the account is logged in
  elsewhere; a stale/timed-out session never blocks a legit re-login).

### Supabase-specific gotchas (learned the hard way — keep in mind for any new SQL)

- **PostgREST schema cache:** after DDL applied via the SQL Editor
  (rather than the CLI migration flow), RPCs can fail through the app
  even though they're provably correct at the database level, because
  PostgREST is looking at a stale cached schema. `schema.sql` ends with
  `notify pgrst, 'reload schema';` to force a refresh on every re-run;
  if something still misbehaves immediately after re-running the
  schema, use Supabase Dashboard → Project Settings → Data API →
  "Reload schema" as a manual fallback.
- **Bare `DELETE`/`UPDATE` without a `WHERE` clause is rejected** by
  this project's Supabase instance's safety rule, even inside a
  `SECURITY DEFINER` function. Any "delete every row" statement must
  use an explicit `where true` (e.g. `clear_tournament`'s `delete from
  tournament_participants where true;`), not a bare `DELETE`.
- This project targets **Supabase only**, not generic Postgres: don't
  assume default schemas/`search_path`; extension functions
  (`pgcrypto`'s `crypt()`/`gen_salt()`) need explicit schema-qualifying
  or an `extensions`-inclusive `search_path`; never write DDL against
  the `storage` schema in `schema.sql` itself (see Avatars, above) —
  that's a manual one-time Dashboard/CLI step.

## 7. Tournament Lobby (Phase 4)

Landing page for logged-in "User" accounts; Admin/Developer accounts
can also reach it (nav button on the Admin Dashboard) to monitor the
tournament. `App.jsx` routes Admin/Developer → `#admin`, everyone else
→ `#lobby`, on both fresh login and session restore.

- **Participation vs. presence are separate tables on purpose** —
  `tournament_participants` (roster: join/leave only, via
  `join_tournament`/`leave_tournament`) is untouched by disconnects,
  heartbeat timeouts, or logout. `presence` (`last_seen_at`) is a
  public-safe mirror of liveness, upserted by any authenticated
  action, deleted by logout. Both public-read, Realtime-enabled,
  writes only through `SECURITY DEFINER` functions.
- **Online/Disconnected is computed client-side**, not server-pushed:
  the client compares `presence.last_seen_at` against the same 45s
  timeout on a 3s local tick (`PRESENCE_TIMEOUT_MS`/`isOnline()` in
  `tournamentApi.js`) — nothing proactively flips a row.
- Any logged-in account can 参加比赛 in one click; 退出比赛 asks for
  confirmation first. Admin/Developer accounts see a per-row 移除
  action (`remove_participant`, admin-gated twin of `leave_tournament`
  — only clears the roster row, the player can rejoin any time) and
  two header-level actions: **随机摇号** (`roll_tournament_numbers`,
  assigns every joined participant — online or not — a unique random
  1–100 into `roll_number`; re-sorts the list highest-first once any
  roll has happened; re-rolling overwrites everyone unconditionally,
  no confirmation needed since it's non-destructive to participation)
  and **清空参赛名单** (`clear_tournament`, deletes every participant
  row in one shot, behind a confirmation dialog — same effect as
  everyone clicking 退出比赛 themselves).
- Destructive/impactful actions (Logout, 退出比赛, admin 移除,
  Promote/Demote, 清空参赛名单) all go through a shared
  `ConfirmDialog.jsx` (title + message + cancel/confirm, `busy` state
  disables both buttons mid-request) rather than firing directly.
- **Tournament Settings** (锦标赛设置 dialog, Admin/Developer-only):
  Tournament Name, Number of Teams, Players per Team, Draft Order.
  `tournament_settings` is a structural singleton (`id boolean primary
  key check (id)`) — Save always replaces the one row via
  `save_tournament_settings`, never creates a second. Public-read but
  deliberately **not** Realtime — the dialog fetches on open, writes on
  save, last-write-wins between concurrent admins.
  - **Draft Order Settings** (part of the same dialog): captains are
    assigned manually and never appear in the order, so there are
    always exactly `players_per_team - 1` rounds, each a permutation of
    `1..team_count`, stored as `tournament_settings.draft_order`
    (`jsonb`). Validated both client-side (`validateDraftRound`, so
    Save can be disabled inline) and — the real enforcement — inside
    `save_tournament_settings` itself. `generateSnakeDraft()` seeds the
    default (odd rounds ascending, even rounds descending) whenever
    there's nothing saved yet, or whenever Number of Teams/Players per
    Team actually changes shape; the admin can freely retype any round.
    Round-order text auto-inserts spaces as team numbers are typed
    (`formatDraftRoundInput` in `tournamentApi.js`).
- **Temporary Testing Buttons** (创建临时玩家/移除临时玩家,
  Admin/Developer-only): `create_temp_participants`/
  `remove_temp_participants` create/remove real (but `accounts.is_temp
  = true`) accounts sized to the current Tournament Settings, auto-
  joined to the tournament, for exercising the Draft System before
  registration is fully rolled out. Bypasses the invite-code gate on
  purpose — a dev convenience, not a real registration path. Display
  names are picked in order from two fixed lists in
  `create_temp_participants` (8 captain names, 32 player names — sized
  for the default 8 teams × 5 players/team shape) rather than a generic
  "临时队长N"/"临时队员N" label, so temp accounts read naturally in the
  lobby, draft pools, and Final Matchups poster; falls back to the old
  numbered pattern only past the end of a list (larger tournaments).
  `avatar_url` is likewise never left null for a temp account — each
  gets a small original "badge icon" SVG generated in-database by
  `_temp_avatar_svg()` (one of 10 gradient-shaded, drop-shadowed themed
  icons — mountain/river/dragon/space/flame/tree/crystal/moon/compass/
  wave — each in one of 4 hue-rotated colorways), embedded directly as a
  `data:image/svg+xml;base64,` URI — no network call, no external image
  host, nothing that can go offline or rot later.
- **开始比赛** validates the joined roster against Tournament Settings
  exactly (`requiredCaptains` = team count, `requiredPlayers` = team
  count × (players per team − 1), `requiredTotal` = their sum, all
  three checked independently) before navigating to the Draft Arena;
  any mismatch blocks navigation with a breakdown of what's needed.
- Gender (`accounts.gender`, `'male'|'female'`, nullable): required at
  registration, editable in Admin Dashboard's edit-user dialog,
  display-only everywhere (icon only, no text label) — has no effect
  on permissions, matchmaking, or drafting.

## 8. Draft Arena (Phase 5)

Reached via 开始比赛 from the Tournament Lobby (validated, see Section
7). `src/components/DraftArena.jsx` — its own self-contained visual
system (Orbitron/Cinzel display fonts, dark radial background,
teal-glow `PanelFrame`/`PrimaryButton` components for the captain/
teammate stages, a separate gold theme for the Final Matchups poster)
is intentionally **not** restyled to match the rest of the app's
Tailwind teal theme — leave it alone unless a change is explicitly
requested.

Three stages, in order: **Captain assignment → Teammate draft (snake
order) → Final Matchups.**

### Captain assignment & teammate draft

- Captain Pool / Player Pool are the real joined Tournament
  participants (`fetchLobby()`, split by Tournament Role), and team
  count / rounds / roster slots all come from the Lobby's real
  Tournament Settings (`fetchTournamentSettings()`) — both fetched
  fresh **on every page open**, not live-synced while the page stays
  open (see "Not yet built," below).
- Click a captain candidate → click an empty team card to assign
  (flying "card slide" animation, Web Animations API). Once every team
  has a captain and the draft order validates, a locked custom
  snake-order teammate draft begins; clicking a pool player commits the
  pick to whichever team is on the clock, same flight animation.
- Full undo stack (`draftHistory`) across both phases; a live team grid
  (`TeamCard`s); a pick-by-pick sequence strip once teammate drafting
  starts.
- `isStaff` prop (default `true`, so admin usage is unchanged) added in
  Phase 6: when `false`, every admin-only control (back/undo/start-
  teammate-draft/proceed-to-final-matchups) is not rendered at all, and
  every click handler that would mutate the draft no-ops immediately —
  see the Spectator Page (Section 9), which is this component's only
  `isStaff={false}` caller.
- Same `isStaff=false` path also replays the flying "card slide"
  animation for picks that arrive from a Realtime prop update rather
  than a local click, via `cardPositionsRef`/`prevTournamentRef` just
  above the existing `hiddenKeys` effect. Every render **merges** each
  currently-visible `[data-card-id]` card's on-screen position into
  `cardPositionsRef` (`{...cardPositionsRef.current, ...freshlyMeasured}`
  — merge, never replace); then, when `tournament` actually changed,
  diffs the previous `tournament.teams` against the new one, and any
  captain/slot that just went from empty to filled calls the exact same
  `beginFlight()` the admin's own click handlers use, sourced from that
  card's last-known position. **The merge (not replace) is load-bearing:**
  the first version of this rebuilt the position map from scratch every
  render (`const map = {}`, then only `document.querySelectorAll(...)`'s
  *currently* visible cards), which silently discarded a card's position
  the instant it was assigned — the exact moment its position is actually
  needed for the diff that fires *next* render, since by then the card is
  already gone from the DOM and was never in that render's fresh map
  either. Caught with a Vitest+jsdom+Testing-Library regression check
  (rendering `DraftArena` standalone with an `isStaff=false` prop update
  and asserting a `.df-ghost` element gets created) after two rounds of
  purely-visual bug reports failed to pin it down; the equivalent
  standalone `DraftArena` test setup isn't part of this repo (it was
  scaffolding for that one investigation, not a maintained suite), but
  the same rendering approach — mount with an initial `tournament`, then
  `rerender()` with a version that has one more filled captain/slot than
  before, assert `document.querySelectorAll('.df-ghost').length > 0` —
  is the fastest way to check this specific path again if it ever
  regresses. (A `flushSync()`-based variant of this same replay was
  tried and reverted in the same investigation — calling `flushSync`
  from inside a `useLayoutEffect` that's already part of an in-progress
  commit reliably logs "flushSync was called from inside a lifecycle
  method"; the plain `beginFlight()` → let the existing `[hiddenKeys]`
  effect pick it up next render, same as the admin's own click path,
  is the one actually in the code.) Never runs for `isStaff=true` — the
  admin's own click already calls `beginFlight()` synchronously at the
  moment of the click, before this diff path could ever see the change.
  Only fires for changes that happen *while watching* — the very first
  `tournament` a Spectator Page mount receives is never diffed against
  (there is no "previous" to compare), so joining mid-draft shows the
  current state directly instead of replaying every prior pick's
  animation at once.
- The ephemeral pre-assignment captain selection (click a captain
  candidate, before clicking a team to assign) is also mirrored for
  spectators: `onSelectedCaptainChange` (optional prop, no-op default)
  fires whenever this component's own local `selectedCaptain` changes;
  DraftArenaPage forwards it into the same broadcast payload as
  `selectedCaptainId` (Live Draft State, below). On the receiving side, an
  `effectiveSelectedCaptain` value (`selectedCaptain` itself when
  `isStaff`, otherwise `externalSelectedCaptainId` resolved back to a
  full candidate via `captainCandidates.find()`) replaces every *rendering*
  use of `selectedCaptain` — the headline text, the "现在点击下方一张空
  战队卡片" hint, `TeamCard`'s `assignable` highlight, and the selected
  candidate's own scale/glow (`PlayerStatCard`'s `selected` prop) — while
  every *click-handling* use of the raw `selectedCaptain` state is left
  exactly as it was (still gated by `isStaff` regardless).
- The 4 stat values on player cards (胜率/冠军/擅长位置/天梯分) are
  deterministic placeholders derived from player id — not real data.

**Layout-stability patterns established here** (apply these to any
future edit in this file rather than re-discovering them):
- Slots that swap content on assignment (captain slot, roster slot)
  must stay a **single persistent DOM node** whose content/inline
  style changes — never a structural remount between "empty" and
  "assigned" states — or the surrounding panel visibly reflows.
  Likewise, don't apply a CSS `transition` to a node's `opacity` if
  React swaps its content in the same commit — that animates a fade
  of the *new* content, not a clean instant swap.
- Rows that must never resize regardless of content use an explicit
  reserved `height` + `boxSizing: "border-box"` + `overflow: "hidden"`
  (e.g. `CAPTAIN_SLOT_H = 46`, `HEADER_H = 160`), not size-tuning.
- Card grids (`flex flex-wrap`) use `items-start`, not the flex
  default `stretch` — otherwise a selected/active card's own
  box-model change (e.g. a wider border) stretches every sibling in
  its row to match. Selection/active states should only ever differ by
  `border-color`/`box-shadow`/`transform` (paint-only, never affects
  layout) — never by border **width**.
- Scroll containers need real padding, sized to whatever glow/blur they
  contain (`box-shadow` paints outside the element's own box and gets
  clipped at the nearest `overflow`-non-`visible` ancestor's padding
  edge) — and elements that get auto-scrolled into view should carry a
  matching `scroll-margin` so `scrollIntoView` leaves the same
  clearance the resting layout already has.
- Size sections to their own content (`min-h-0` + `shrink`, optionally
  a `max-h-[...]` cap as a backstop) rather than forcing a fixed
  `flex-basis` proportion — a forced basis either wastes space when
  content is smaller than it, or gets scrolled unnecessarily when
  content plus padding exceeds it.

### Final Matchups ("01 冠军海报版" poster)

Reached via 进入最终对阵 (previously a no-op placeholder). **This UI is
a literal, character-for-character port of an external reference file
(`final_matchups_concept3_variants_v2.html`'s concept 01), not a React
reimplementation** — `FMP_HTML`/`FMP_CSS` inside `DraftArena.jsx` are
copied verbatim (only `#fmpStage`-prefixed for scoping and
`@keyframes` renamed to avoid collisions), and the mount effect's
`makeModel`/`initials`/`renderFilmstrip`/`renderCasting`/
`runRollSequence`/`cutTo`/`renderCast` functions are the reference's
own imperative DOM code, deliberately not translated into React state.
**Any future change to this poster should edit this existing code in
place, matching its existing patterns (inline `<style>` strings,
`querySelector`/`innerHTML` DOM building) — do not redesign it as
idiomatic React.** The only intentional deviations from the raw
reference are: real team names/data instead of the demo's hardcoded
array; click handlers wired to real RPCs (below) instead of local-only
state; a Realtime prop-sync effect; staff-only visibility gating for
non-admin viewers; and small appended (never edited-in) wire-up chrome
like the per-match dissolve button (`FMP_WIRE_CSS`, a separate
stylesheet from `FMP_CSS`) — grouped into the same `#actions1`/
`actionsWrap` action bar as 定角锁定/开幕！随机生成剩余对阵/重置/结束
锦标赛, rather than sitting under the featured matchup box itself, so
every admin action lives in one place, and sized/styled to match those
four (`.pv-btn`'s own `padding:12px 20px;border-radius:10px;` and
Orbitron 800/11px/.03em) instead of its own smaller Rajdhani chip style
— gold border, muted-red text on a dark fill, so it still reads as
"the destructive one" without literally duplicating 结束锦标赛's own
red-fill treatment; always visible once staff can see the action bar at
all (never hidden just because no match is currently selected), same as
`lockBtn`/🎬定角锁定 — `updatePairControls()` toggles only `.disabled`
(`!m || busy`), matching how `lockBtn.disabled` already worked off
`model.selected.length < 2`, rather than toggling `pairCtl`'s own
`display`; and an optional `showBackButton`
prop (default `true`, so admin usage is unchanged) letting a caller like
the Spectator Page (Section 9) suppress this stage's own back button
when it already has its own exit control.

**Workflow (admin-controlled, blank canvas — nothing auto-generated):**
entering this stage snapshots the drafted teams (captain identity
only) with zero matchups. From there, freely mixable:
- **Manual Pairing** — select exactly 2 remaining teams from the
  casting pool → 锁定此对阵 → creates an already-**locked** matchup.
- **Random Roll** — select any number of teams (or none, which
  defaults to "every currently-free team") → 开幕！随机生成剩余对阵 →
  server shuffles + pairs just that pool (odd count → one team gets a
  **轮空**/bye), plays the full countdown → flicker → reveal animation
  against the real result. Every locked matchup (manual or
  previously-locked-roll) is left completely untouched by any later
  roll.
- Every matchup can be locked/unlocked or removed (✕ 解除对阵, returns
  both teams to the free pool immediately). 定角锁定 with 3+ selected
  delegates straight to Random Roll for that exact group instead of
  being disabled.
- 🔄 重置 wipes every matchup back to the blank canvas. 🏁 结束锦标赛
  deletes the whole `tournament_matches` row *and* clears
  `tournament_participants` (nobody carries into the next tournament;
  `tournament_settings` is left alone, so a new tournament reuses the
  last-configured team count/order) — every connected client is booted
  back to the Tournament Lobby.
- A bye (轮空) team's cast portrait (`.h1-portrait`) is silver
  (`.bye` modifier class) instead of the normal gold `.used`; its
  featured spotlight card shows only `"{team} 轮空"`, centered (the "VS"
  span and the second-name span are `display:none`'d, not just
  emptied, so the flex row's `gap` doesn't reserve space for them).

**Backend:** `public.tournament_matches` — another structural singleton
(same `id boolean primary key` trick), holding a `teams` snapshot and
a `matchups` **append-only** JSON array (`{"a": idx, "b": idx-or-null,
"locked": bool}` — a team not yet in any entry is "remaining"; a
missing `b` is a finished bye slot, not a pending one). Public-read,
Realtime-enabled. Admin/Developer-gated RPCs: `enter_final_matchups`,
`create_manual_matchup`, `remove_tournament_matchup`,
`roll_tournament_matchups_pool` (optional `p_team_idxs` — null/empty
defaults to "every free team"; only ever appends new pairs, never
touches an existing entry), `lock_tournament_matchup`,
`reset_tournament_matchups`, `end_tournament`. (`roll_tournament_
matchups()`, the older "roll everyone, no pool" RPC, still exists but
is unused by the current UI.) The client subscribes to
`tournament_matches` for the whole page's life regardless of which
stage it's on, so a matchup change / End Tournament reaches every
connected client instantly, not just the one that clicked.

**Real-server-data-must-drive-the-reveal pattern:** the countdown/
flicker/reveal animation must only ever paint what the server actually
returned, in step with its own reveal timing — never write the full
already-known result into the model ahead of the sequence (it looks
right eventually but reveals everything early), and guard the
Realtime prop-sync effect from overwriting the DOM mid-sequence (a
`rollAnimatingRef`-style flag for the sequence's exact duration).

**Spectator-only reveal replay (added in Phase 6).** Originally, the
Realtime prop-sync effect (`useEffect(..., [teams, matchups])`) just
wrote whatever `matchups` it received straight into the model and
re-rendered — correct end state, but for anyone who *didn't* click the
roll button themselves (another connected admin, or a spectator), a
Random Roll just snapped instantly to the result instead of playing the
countdown/flicker/reveal sequence at all. `onPoolRollClick`'s own
sequence is entirely local to the client that clicked (`runRollSequence`
called directly from the click handler with the RPC's response) — it
was never going to reach anyone else's browser on its own. Fixed for
`isStaff=false` (the Spectator Page, Section 9) specifically: the
prop-sync effect now diffs the incoming `matchups` against what the
model already has; if it's a **pure append** (every already-known entry
is byte-for-byte unchanged, and at least one new, already-resolved entry
was added — i.e. someone else just locked a pairing or ran a roll),
`playAppendedRevealRef` (set by the mount effect, right after
`onPoolRollClick`) replays the identical countdown→flicker→reveal
sequence via the same `runRollSequence`, just fed the already-known
result as the plan instead of a fresh RPC response. A non-append change
(lock/unlock/remove/reset, or the very first sync right after mount —
joining mid-tournament shows the current state directly rather than
replaying every past roll) still snaps immediately, unchanged. Left
`isStaff=true` entirely alone — another admin's browser still snaps to
the result exactly as before this change; only the Spectator Page's
own genuinely-read-only view was in scope here.

### Live Draft State broadcast, and resuming a paused draft (Phase 6, extended)

The Captain assignment / Teammate draft phases above are still 100%
local React state (`tournament` in `DraftArenaPage`) while actively
being driven — undo, the flying "card slide" animation, and every click
handler are unchanged from Phase 5. What Phase 6 added is a mirror of
that state: every time `tournament` (or the ephemeral
`selectedCaptainId`, or the Undo stack `draftHistory` -- both reported
up from `DraftArena`'s own local state via `onSelectedCaptainChange`/
`onDraftHistoryChange`, see the "reporting up" effects right after
`selectedCaptain`/`draftHistory` are declared) actually changes while
`stage === 'draft'` and the caller is Admin/Developer, `DraftArenaPage`
fire-and-forgets a snapshot (`{tournamentName, teamCount, playersPerTeam,
draftPhase, teams, captainCandidates, pool, pickIndex, roundOrders,
selectedCaptainId, draftHistory}`) to `public.tournament_draft_state`
(structural singleton, public-read, Realtime-enabled) via
`sync_draft_state()`. A failed/slow write here can never block or alter
the admin's own drafting experience.

**No longer purely one-way.** Originally documented as "never read back
by the Draft Arena itself" — that changed with the resume feature below:
DraftArenaPage's own mount effect now calls `fetchDraftState()` first
and, if a row already exists, seeds `tournament` *and* `draftHistory`
straight from it instead of from `fetchTournamentSettings()`/
`fetchLobby()`/an empty Undo stack. This is also why the row is no
longer cleared just because the admin leaves the Draft Arena before
finishing — it deliberately persists, precisely so a later mount can
resume it, Undo included. `<DraftArena>` itself isn't rendered until a
new `ready` flag is true (a lightweight "加载中…" placeholder — the same
one `DraftArena` used to show internally via `teams.length === 0` — sits
in its place until then): `draftHistory` is seeded once, lazily, via
`useState(() => initialDraftHistory)` on `DraftArena`'s own first mount,
so `initialDraftHistory` has to already hold the real (resumed-or-empty)
array *before* `DraftArena` exists at all, unlike `tournament` itself
(read fresh from a prop every render, so it was never sensitive to this
same timing). What still does NOT survive a resume: `lastPick` (pure
`DraftArena`-local, feeds `undoLastPick`'s very next snapshot but is
otherwise cosmetic) resets to `null`, and `selectedCaptainId` is
intentionally not restored (an ephemeral "clicked but not yet assigned"
highlight re-materializing on its own, with no click that just caused
it, would read as wrong) — a resumed draft always starts with no
candidate selected, exactly as if the admin were about to make their
next click fresh.

The row is still cleared (`clear_draft_state()`, unused by any caller
right now but left in place / a `delete` folded into
`enter_final_matchups()` and `end_tournament()`) whenever the draft
reaches Final Matchups or the tournament ends — those are genuine
"this draft is over" events. Leaving the page mid-draft is not one of
them anymore.

## 9. Spectator Page (Phase 6)

`src/components/SpectatorPage.jsx`, reached via a **观赛** button (open
to every logged-in account, staff or not) on the Tournament Lobby,
routed at `#spectate` in `App.jsx`. Uses the main app's Tailwind
dark/neon-teal theme (Section 3) only for its own thin identity/exit
header — the Captain/Teammate draft and Final Matchups bodies are the
**exact same `DraftArena`/`FinalMatchupsStage` components** (both now
exported from `DraftArena.jsx`, along with `GlobalStyle` for the same
Orbitron font/scrollbar styling) the admin's own Draft Arena renders,
mounted with `isStaff={false}` — pixel-identical layout/progress
ring/sequence strip/team-and-pool cards to what staff see, not a
reimplementation.

**Deliberately scoped to the live drafting process only** (Captain
Drafting → Player Drafting → Matchup/Bracket Roll) — general
tournament/roster info already lives in the Tournament Lobby (Section
7), so it is intentionally not duplicated here.

`isStaff={false}` on both reused components means: every admin-only
control (`DraftArena`: 返回选手管理/撤销上一次选择/锁定并开始队员选秀/
进入最终对阵; `FinalMatchupsStage`: 定角锁定/随机生成/重置/结束锦标赛/
per-match lock-unlock-remove) is **not rendered at all** — not merely
disabled/grayed out — and every click handler that would mutate the
draft (captain assignment, teammate pick, undo, phase transition) is
guarded to no-op immediately, so a spectator's click can never diverge
local state from the live broadcast this page renders. Visually,
though, nothing is missing: `DraftArena`'s own `isStaff=false` diff/
replay path (Section 8) fires the identical flying "card slide"
animation for every pick as it arrives live, and `FinalMatchupsStage`'s
own `isStaff=false` reveal-replay path (Section 8, "Spectator-only
reveal replay") plays the identical countdown/flicker/reveal sequence
for every roll as it happens — so both stages animate for a spectator
exactly as they do for the admin running them, in real time, not just
matching the final state.

Views, switched purely by what's currently in the database (never by
anything this page writes), each backed by real data/Realtime, no
mock/demo content:
- **waiting placeholder** — no draft in progress yet and no Final
  Matchups: a minimal "选秀尚未开始" message, nothing else.
- **`drafting`** — a `tournament_draft_state` row exists (see Section
  8's Live Draft State broadcast): `<DraftArena>` fed a `tournament`
  object built directly from that broadcast (`{teams, pickIndex, pool,
  draftPhase, captainCandidates, roundOrders, lastPick: null}`), with a
  no-op `setTournament`.
- **`final`** — a `tournament_matches` row exists: `<FinalMatchupsStage>`
  with `showBackButton={false}` (this page's own header already has the
  exit button, so that component's own is suppressed via that prop
  rather than duplicated). Ending the tournament (the table's DELETE
  event) sends spectators back to the Lobby too, same as every other
  connected client.

## 10. Not Yet Built / Known Limitations

- If two Admin/Developer accounts ran separate drafts concurrently
  before Final Matchups, the snapshot taken on 进入最终对阵 is whichever
  draft called it most recently — an accepted, unaddressed edge case.
  The Live Draft State broadcast (Section 8) has the same "last writer
  wins" behavior for the Spectator Page's `drafting` view, and for
  resuming a paused draft — whichever admin's browser wrote most
  recently (Undo stack included) is what gets resumed, by anyone who
  opens the Draft Arena next.
- Sessions are bearer tokens, not JWTs — no Supabase-Auth-based RLS
  (Section 6 explains why).
- No password reset, "remember me," or email anywhere (by design,
  Section 3).

## 11. Project Cleanup Log

- **`matchup_previews.html` (repo root) — removed.** A standalone,
  non-built design-mockup file ("最终对阵生成 · 5 个 UI 预览方案") holding
  five throwaway HTML/CSS concepts explored for the Final Matchups
  poster. Confirmed unused before removal: not linked from `index.html`
  (the app's only real entry point), not in `tailwind.config.js`'s
  `content` glob, not referenced by `vite.config.js`/`package.json`, and
  no `import`/`fetch`/`<script src>` anywhere in `src/`. Its only living
  connection to the app is conceptual, not a file dependency: concept
  01 from this file was already permanently hand-ported, verbatim, into
  `DraftArena.jsx`'s `FMP_HTML`/`FMP_CSS` strings (see Section 8, Final
  Matchups) — that DraftArena.jsx copy is the one the site actually
  runs, so deleting the original mockup changes nothing at runtime. Kept
  no replacement in the repo; if a similar reference is needed again for
  future visual work, treat it as a design asset outside the shipped
  codebase rather than committing it back to the project root.
- Everything else in the project (every file under `src/`, `supabase/schema.sql`,
  the root config files) was checked and confirmed to be imported/
  referenced/required by the current app — nothing else was removed.

### 11.1 In-file dead code sweep (imports, functions, state, styles)

A second pass audited *inside* every file for unused imports, functions,
state, JSX, and CSS/Tailwind tokens — not just whole unused files. Every
removal below was cross-checked two ways: manually (grep for every call
site, including indirect/dynamic-prop icon lookups) and with a one-off
ESLint `no-unused-vars` pass across `src/` (installed temporarily, not
committed — see `package.json`/`package-lock.json`, both untouched). The
project still builds cleanly (`npm run build`) after every change below.

**Removed — confirmed zero references anywhere:**
- `DraftArena.jsx`: `genUid()` — defined, never called.
- `DraftArena.jsx`: `PrimaryButton` — a full component, defined but never
  rendered and not exported.
- `DraftArena.jsx`: `CoreRoleBadge` + its only helper `coreRoleLabel()` —
  never rendered/called anywhere.
- `DraftArena.jsx`: `SubRoleBadge` + its only helper `posLabel()` — same
  situation, an orphaned pair.
- `DraftArena.jsx`: `CORE_ROLE_COLOR` and `CAPTAIN_ID` constants — these
  became orphaned *as a result of* removing `CoreRoleBadge`/`posLabel`
  above (they were each that dead code's only remaining caller); removed
  in the same pass once confirmed unreferenced.
- `AuthPage.jsx`: the `mail` entry in the local `Icon` object — never
  wired to any `icon="mail"` prop. Consistent with Section 3's "no email
  anywhere" product decision; this was evidently copy-pasted scaffolding
  that never got used once that decision was made.
- `tailwind.config.js`: the `teal.dim` / `teal.deep` color shades and the
  `scanline` / `drift` keyframes+animations — none ever applied via a
  Tailwind class anywhere in `src/`. (Note: these are unrelated to
  `DraftArena.jsx`'s own `TEAL_DIM` — that's a separate local hex
  constant used for inline `style` props on the Final Matchups poster,
  not a Tailwind theme token, and is still very much in use.)

**Checked and confirmed already clean — nothing to remove:**
- All npm dependencies in `package.json` are imported somewhere in `src/`.
- `main.jsx`, `ConfirmDialog.jsx`, `DisconnectedModal.jsx`,
  `supabaseClient.js`, `sessionMonitor.js`, `SpectatorPage.jsx`,
  `TournamentSettingsDialog.jsx` — every import, prop, and state variable
  in each is used.
- `AdminDashboard.jsx`, `TournamentLobby.jsx`, `AuthPage.jsx`'s inline
  `Icon` objects looked unused at first grep (several entries are only
  ever reached via a dynamic `Icon[icon]` lookup driven by an `icon="..."`
  string prop, not a static `Icon.foo` reference) — re-checked against
  every `icon="..."` call site before concluding anything was actually
  dead; only `mail` above turned out to be genuinely unused.
- No `console.log`/`debugger`/`TODO`/`FIXME` cruft, no commented-out
  code blocks, and no mock/dummy test data anywhere in `src/`. The
  deterministic per-player stat placeholders on player cards (胜率/冠军/
  擅长位置/天梯分) were re-verified against Section 8 — they're documented,
  intentional cosmetic placeholders, not leftover test data, and were
  left alone.
- `clearDraftState()` and the non-pool `rollTournamentMatchups()` in
  `tournamentApi.js` are unused by the UI but were **not** touched —
  Section 8 already documents both as deliberately kept in place.
- `DraftArena.jsx`'s `FMP_HTML`/`FMP_CSS`/`FMP_WIRE_CSS` block (the
  ported Final Matchups poster markup) was spot-checked for orphaned CSS
  selectors; several classes looked unused in the static HTML but are
  almost certainly toggled at runtime by the imperative wiring script
  (`classList.add('active')` etc.), not present in the string's own
  markup. Given Section 8's explicit instruction to keep this block
  byte-for-byte faithful to the reference, it was left untouched rather
  than risk misjudging code that isn't statically analyzable this way.

**Flagged, not removed — needs a decision, not just cleanup:**
- `lockTournamentMatchup()` (the frontend wrapper in `tournamentApi.js`,
  imported in `DraftArena.jsx`) is imported but never called. The Final
  Matchups action bar currently only exposes create-and-lock (定角锁定,
  via `createManualMatchup`) and remove (✕ 解除对阵); there is no button
  that calls `lockTournamentMatchup` to toggle an *existing* matchup's
  locked state. This means either a lock/unlock toggle was removed from
  the UI at some point and the import was never cleaned up, or it was
  never wired up to begin with — either way it's a product question
  (should this control exist?), not a cleanup question, so it was left
  in place rather than deleted.

### 11.2 Stale DEVLOG.md section references in code comments

Multiple `// see DEVLOG.md Section N` comments across the codebase
pointed at section numbers that no longer match this document's current
structure (leftover from an earlier, more finely-numbered draft of this
file). All were corrected to the section that actually contains the
referenced material today — comment text only, no logic changed:

| File | Old reference | Fixed to |
|---|---|---|
| `App.jsx` (×2) | Section 15, Section 16 | Section 6, Section 2 |
| `auth.js` | Section 15 | Section 6 |
| `tournamentApi.js` | Section 16 | Section 7 |
| `AdminDashboard.jsx` | Section 10 | Section 5 |
| `TournamentLobby.jsx` (×5) | Section 24 (×2), Section 16 (×2), Section 11 | Section 8 (×2), Section 7 (×2), Section 2 |
| `DraftArena.jsx` (×7) | Section 42 (×2), Section 24, Section 16 (×4) | Section 8 (×3), Section 7 (×4) |
| `TournamentSettingsDialog.jsx` (×2) | Section 16 (×2) | Section 7 (×2) |

### 11.3 Temp-account display names replaced with a fixed roster

`create_temp_participants()` (`supabase/schema.sql`) previously named
every temp account it created `'临时队长' || v_i` / `'临时队员' || v_i`
(临时队长1, 临时队长2, ... / 临时队员1, 临时队员2, ...). Replaced with two
fixed, ordered name lists — `v_captain_names` (8 entries) and
`v_player_names` (32 entries) — declared as local `constant text[]`
inside the function, indexed by the existing loop counter. Sized to
match the default tournament shape (8 teams × 5 players/team =
8 captains + 32 players); falls back to the old numbered pattern for
any index past the end of a list, so larger tournaments (more teams
and/or a bigger roster) still work without error. No other logic in the
function changed — same account/credential/participant inserts, same
`is_temp = true` marking, same permission check, same gender
alternation. See Section 7 for the full behavior of this function.

### 11.4 Temp accounts now get a distinct avatar each

Same function, one more field: `avatar_url` was previously left `null`
for every temp account (falling back to the app's single generic hex-
icon placeholder — see `DEFAULT_AVATAR` in `DraftArena.jsx`). Went
through three revisions before landing on the current design:

1. A `randomuser.me` (photographic) + DiceBear (illustrated) mix —
   worked technically, but depended on a live third party and didn't
   match the desired look.
2. A hand-coded "chibi face" SVG generated entirely in-database (no
   network dependency) — closer, but read as too plain/cartoonish.
3. **Current**: a hand-coded "badge icon" SVG, same in-database
   approach as #2 but a different illustration style — gradient-shaded
   (not flat fills), soft drop shadow, a glossy highlight sheen, so each
   reads as a small polished app-icon-style badge rather than a flat
   cartoon.

`_temp_avatar_svg(p_seed int)` (defined just above
`create_temp_participants`, deliberately left out of the RPC grant list
like `_require_role` — nothing worth restricting, but no reason to
expose it either) picks one of **10 original badge icon designs**
(mountain, river, dragon, space, flame, tree, crystal, moon, compass,
wave — `v_bodies[((p_seed-1) % 10) + 1]`, each with its own matching
background gradient in `v_bg_fills`) and wraps it in one of **4 hue-
rotation filters** (`hue0`/`hue1`/`hue2`/`hue3`, applied via
`<feColorMatrix type="hueRotate">`, selected by
`((p_seed-1) / 10) % 4`) — since the theme index and the hue-variant
index both advance in lockstep with `p_seed`, the two combine to give
each of the 10 designs 4 distinct colorways, covering all 40 default
temp accounts (8 captains + 32 players) with a genuinely distinct-
looking badge each, not just a distinct color on one element. All 10
icon bodies and their gradient/filter `<defs>` are always embedded in
every generated SVG (defs cost nothing if unused) — only which body is
rendered, and which hue filter wraps it, changes per account. Returned
as a `data:image/svg+xml;base64,...` URI, same as revision #2.
`p_seed` is `v_global_i`, a counter incremented once per account across
*both* loops in `create_temp_participants` (1 for the first captain …
40 for the last player by default).

Three real bugs were caught and fixed by actually installing PostgreSQL
locally, loading the full schema, and running the function end-to-end
before calling any revision done (not just eyeballing the SQL):
1. **(Revision #2) Same modulus (8) used for all four color traits**,
   seeded with different multipliers (`×1/×3/×5/×7`) meant to "spread"
   them — this doesn't work, since a linear function mod 8 always has
   period dividing 8 regardless of the multiplier, so the full
   combination silently repeated every 8 accounts (all 32 players
   collapsed to 8 distinct avatars). Fixed by giving each trait a
   differently-sized palette instead.
2. **(Revision #2) PostgreSQL's `encode(bytea, 'base64')` inserts a
   newline every 76 characters** (RFC 2045 MIME-style wrapping) —
   invalid inside a data URI. Fixed with `replace(..., chr(10), '')`
   before concatenating the `data:` prefix; carried forward into
   revision #3.
3. **(Revision #3, caught before shipping) Verified the theme/hue
   combination logic directly** rather than assuming the design worked
   — confirmed via a real `create_temp_participants()` call against the
   local test database that all 40 accounts get distinct `avatar_url`
   values (`count(distinct avatar_url) = 40`), and via decoding +
   rasterizing all 40 generated SVGs that every one renders as valid,
   uncorrupted markup.

Renders automatically everywhere `avatarUrl` already does (Tournament
Lobby, Admin Dashboard, Draft Arena pools/cards, Final Matchups poster)
— no frontend component changed, since `avatar_url` was already a plain
image URL/URI column read the same way for every account.


## 12. Maintaining This Document

- Update it whenever a phase or feature is completed, and before
  handing off to another developer or starting a new chat — this
  document, not prior chat history, is what the next person picks up
  from.
- Describe **current state**, not a changelog of how it got there.
  When a change supersedes something already written here, edit or
  replace that text — don't leave the old, now-wrong description in
  place next to the correction.
- Record product decisions and architecture, not implementation detail
  already visible in the source — the repo is the reference for
  file/folder structure.
- Keep it concise; consolidate rather than repeat across sections.
- For install/run/build instructions, see `README.md`.
