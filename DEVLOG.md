# DEVLOG.md · Project Handoff

**项目**: 选秀台 (Draft Stage) — 锦标赛选秀网站

This is the official project handoff document: what the project is,
what's been decided, how it's built, and what to be careful about —
not how the code is written line-by-line (the repository itself is the
reference for that; see `README.md` for setup/build). It describes the
**current state** of the project, not a history of how it got there.

**The project is feature-complete** (see Section 2). From here on,
this document should stay short: record architecture, product
decisions, and genuinely important behavior/limitations — not a
changelog of every fix, refactor, or small UI tweak. See Section 12 for
the full rule on what belongs here.

Read this before making changes, and keep it current as the project
evolves — replace outdated statements rather than appending a new entry
that contradicts an old one left in place.

---

## 1. Project Overview

选秀台 (Draft Stage) is a tournament drafting website: a gaming-style
platform where players register, get organized into teams via captains
and players, and take part in drafts, live tournaments, and spectating.

## 2. Project Status

All planned functionality is built and shipped: Login & Registration,
Admin Dashboard, Backend Foundation, Tournament Lobby, Draft System
(captain assignment → teammate draft → final matchups), and a live
Spectator Page. The project is in a stable, feature-complete state,
built entirely on one Supabase backend (Postgres + Storage + Realtime)
— every part of the app shares that same database, authentication,
permissions, and real-time layer; never introduce a separate/parallel
backend for a new feature.

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
- Don't redesign existing pages or change existing functionality
  without approval — prefer extending established patterns.
- Design new systems to be easy to expand later (e.g. the dashboard's
  tab navigation).
- Keep the UI simple; don't add unrequested features.

**Browser Layout Standard** (permanent — applies to main pages only,
not dialogs/modals):
- **Primary desktop design target: 1920×1080.** At 100% browser zoom
  with Chrome maximized, the usable viewport is approximately
  **1920×953** (browser chrome takes the rest) — check all desktop
  layouts against this size.
- Main pages fill the full browser width with only small edge padding
  (no fixed max-width, no centered document-style layout) and use a
  fixed-height app-frame shell (`lg:h-screen lg:overflow-hidden`) where
  header/stat rows are `shrink-0` and only the content/table area
  scrolls (`lg:flex-1 lg:min-h-0 overflow-y-auto`). No permanent
  sidebar — navigation stays in the top header.
- The UI must still remain responsive for smaller screens: below the
  `lg` breakpoint, everything falls back to normal stacked, full-page
  scroll for mobile.
- Applied to `TournamentLobby`, `AdminDashboard`, and `DraftArena`'s own
  pages (`AuthPage` is exempt — it stays a single centered card by
  design).

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

## 6. Backend Architecture

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
  created by `schema.sql` itself — it attempts to auto-provision them
  (wrapped in an exception handler, harmless no-op + `NOTICE` if the
  connecting role lacks privilege); the fallback is a one-time manual
  setup via the Supabase Dashboard (see `schema.sql`'s own comment near
  the bucket-creation block).
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

## 7. Tournament Lobby

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
- **Temporary Testing Buttons** (创建临时玩家/移除临时玩家,
  Admin/Developer-only): `create_temp_participants`/
  `remove_temp_participants` create/remove real (but `accounts.is_temp
  = true`) accounts sized to the current Tournament Settings, auto-
  joined to the tournament, for exercising the Draft System without
  real registrations. Bypasses the invite-code gate on purpose — a dev
  convenience, not a real registration path. Each temp account gets a
  display name from a fixed roster (`create_temp_participants` in
  `schema.sql`, 8 captain names / 32 player names — sized for the
  default 8×5 tournament shape, falls back to a numbered placeholder
  past the end of the list) and an `avatar_url` that's never left
  null — a small original placeholder icon generated in-database by
  `_temp_avatar_svg()` (10 themed badge designs × 4 color variants, all
  precomputed as plain SVG with no runtime filters — kept filter-free
  deliberately, since an earlier filter-heavy version caused a real
  animation-performance regression in the Draft Arena; see the caution
  in Section 8).
- **开始比赛** validates the joined roster against Tournament Settings
  exactly (`requiredCaptains` = team count, `requiredPlayers` = team
  count × (players per team − 1), `requiredTotal` = their sum, all
  three checked independently) before navigating to the Draft Arena;
  any mismatch blocks navigation with a breakdown of what's needed.
- Gender (`accounts.gender`, `'male'|'female'`, nullable): required at
  registration, editable in Admin Dashboard's edit-user dialog,
  display-only everywhere (icon only, no text label) — has no effect
  on permissions, matchmaking, or drafting.

## 8. Draft Arena

Reached via 开始比赛 from the Tournament Lobby (validated, see Section
7). `src/components/DraftArena.jsx` — its own self-contained visual
system (Orbitron/Cinzel display fonts, dark radial background,
teal-glow panel components for the captain/teammate stages, a separate
gold theme for the Final Matchups poster) is intentionally **not**
restyled to match the rest of the app's Tailwind teal theme — leave it
alone unless a change is explicitly requested.

Three stages, in order: **Captain assignment → Teammate draft (snake
order) → Final Matchups.**

### Captain assignment & teammate draft

- Captain Pool / Player Pool are the real joined Tournament
  participants (`fetchLobby()`, split by Tournament Role), and team
  count / rounds / roster slots all come from the Lobby's real
  Tournament Settings (`fetchTournamentSettings()`) — both fetched
  fresh **on every page open**, not live-synced while the page stays
  open.
- Click a captain candidate → click an empty team card to assign
  (flying "card slide" animation, Web Animations API). Once every team
  has a captain and the draft order validates, a locked custom
  snake-order teammate draft begins; clicking a pool player commits the
  pick to whichever team is on the clock, same flight animation.
- Full undo stack (`draftHistory`) across both phases; a live team grid
  (`TeamCard`s); a pick-by-pick sequence strip once teammate drafting
  starts.
- `isStaff` prop (default `true`): when `false` (the Spectator Page's
  only use of this component, Section 9), every admin-only control is
  not rendered at all, and every click handler that would mutate the
  draft no-ops immediately. The same `isStaff=false` path also replays
  the flying "card slide" animation for picks arriving from a Realtime
  update (not a local click) — it diffs each render's on-screen card
  positions against the previous one to find what just got assigned.
  **Watch out:** the position map used for that diff must be *merged*
  every render, never rebuilt from scratch — a card's position has to
  still be known one render after it disappears from the DOM (the exact
  moment the diff needs it), so rebuilding the map from only
  currently-visible cards silently breaks this replay. **Also:** the
  effect that snapshots those positions (`document.querySelectorAll` +
  `getBoundingClientRect()` on every `[data-card-id]` card) only needs
  to run at all when `isStaff===false` — it's a real forced-layout cost
  on every render, so gate it behind `if (isStaff) return;` rather than
  letting it run unconditionally; the admin's own click handlers never
  read this map. Skipping this guard was a real, measured cause of lag
  under rapid/spam-clicking (invisible on one click, compounds directly
  with how many renders happen in a short window).
- The 4 stat values on player cards (胜率/冠军/擅长位置/天梯分) are
  deterministic placeholders derived from player id — not real data.
- **Performance note:** the "card slide" flight animation moves via
  `transform` (GPU-composited), not `left`/`top` (forces layout every
  frame) — keep it that way. This matters more than it looks: a prior
  version animated `left`/`top` directly, which was fine while avatars
  were plain text, but caused a real, noticeable lag once avatars
  became real images. Any avatar/image content rendered inside a
  flying card should stay cheap to paint (avoid SVG filters like blur/
  drop-shadow/color-matrix in anything that gets animated repeatedly).

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
  reserved `height` + `boxSizing: "border-box"` + `overflow: "hidden"`,
  not size-tuning.
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

Reached via 进入最终对阵. **This UI is a literal, character-for-character
port of an external reference file, not a React reimplementation** —
`FMP_HTML`/`FMP_CSS` inside `DraftArena.jsx` are copied verbatim (only
scoped/renamed to avoid collisions), and the mount effect's DOM-building
functions are the reference's own imperative code, deliberately not
translated into React state. **Any future change to this poster should
edit this existing code in place, matching its existing patterns
(inline `<style>` strings, `querySelector`/`innerHTML` DOM building) —
do not redesign it as idiomatic React.** The only intentional
deviations from the raw reference are: real team names/data instead of
a demo array; click handlers wired to real RPCs (below); a Realtime
prop-sync effect; staff-only visibility gating for non-admin viewers;
and small appended wire-up chrome (the per-match dissolve button,
`FMP_WIRE_CSS`) styled to match the existing action bar rather than
introducing a new style.

**Workflow (admin-controlled, blank canvas — nothing auto-generated):**
entering this stage snapshots the drafted teams (captain identity
only) with zero matchups. From there, freely mixable:
- **Manual Pairing** — select exactly 2 remaining teams → 锁定此对阵 →
  creates an already-**locked** matchup.
- **Random Roll** — select any number of teams (or none, defaulting to
  "every currently-free team") → 开幕！随机生成剩余对阵 → server shuffles
  + pairs just that pool (odd count → one team gets a **轮空**/bye),
  plays the full countdown → flicker → reveal animation against the
  real result. Locked matchups are left untouched by any later roll.
- Every matchup can be removed (✕ 解除对阵, returns both teams to the
  free pool immediately). 定角锁定 with 3+ selected delegates straight
  to Random Roll for that exact group instead of being disabled.
- 🔄 重置 wipes every matchup back to the blank canvas. 🏁 结束锦标赛
  deletes the whole `tournament_matches` row *and* clears
  `tournament_participants` (nobody carries into the next tournament;
  `tournament_settings` is left alone, so a new tournament reuses the
  last-configured team count/order) — every connected client is booted
  back to the Tournament Lobby.

**Backend:** `public.tournament_matches` — a structural singleton
holding a `teams` snapshot and a `matchups` **append-only** JSON array.
Public-read, Realtime-enabled. Admin/Developer-gated RPCs:
`enter_final_matchups`, `create_manual_matchup`,
`remove_tournament_matchup`, `roll_tournament_matchups_pool`,
`lock_tournament_matchup`, `reset_tournament_matchups`,
`end_tournament`. The client subscribes to `tournament_matches` for the
whole page's life regardless of which stage it's on, so a matchup
change / End Tournament reaches every connected client instantly, not
just the one that clicked.

**Real-server-data-must-drive-the-reveal pattern:** the countdown/
flicker/reveal animation must only ever paint what the server actually
returned, in step with its own reveal timing — never write the
already-known result into the model ahead of the sequence, and guard
the Realtime prop-sync effect from overwriting the DOM mid-sequence.

**Spectator-only reveal replay.** For anyone who didn't click the roll
button themselves (another admin, or a spectator), the prop-sync effect
diffs incoming `matchups` against the current model; a pure append
(someone else just locked/rolled a new pairing) replays the identical
countdown→flicker→reveal sequence instead of snapping straight to the
result. A non-append change (lock/unlock/remove/reset, or the very
first sync on mount) still snaps immediately.

### Live Draft State broadcast, and resuming a paused draft

The Captain assignment / Teammate draft phases are still 100% local
React state (`tournament` in `DraftArenaPage`) while actively being
driven. In parallel, every time that state actually changes (while an
Admin/Developer is on the draft stage), it's mirrored to
`public.tournament_draft_state` (structural singleton, public-read,
Realtime-enabled) via `sync_draft_state()` — this is what feeds the
Spectator Page's live view (Section 9). A failed/slow write here can
never block or alter the admin's own drafting experience.

**Watch out — this broadcast is debounced (200ms) on purpose, and needs
to stay that way:** its payload includes the full Undo stack
(`draftHistory` — every entry itself a deep-cloned snapshot of `teams`/
`pool`) plus the current `teams`/`pool`/`captainCandidates` again, so
`JSON.stringify`-ing it gets measurably more expensive the deeper into
a draft this runs (measured: ~12ms for a realistic full 8×5 draft's
worth of history, ~3MB serialized — cheap once, but a rapid click burst
that recomputes it **on every single click** adds up fast: a 20-click
burst measured at ~220ms of blocking main-thread work undebounced vs.
~11ms debounced). This was a real, measured cause of lag when
spam-clicking Undo (and to a lesser extent, rapid picks) late in a
draft. The debounce means a rapid burst only pays this cost once, right
after it settles — since the broadcast was already fire-and-forget/
eventually-consistent by design, this doesn't change what eventually
gets persisted, just skips the redundant mid-burst recomputation. A
matching "flush on unmount" effect exists alongside it specifically so
navigating away *during* the debounce window still persists the latest
state instead of silently dropping it — keep both effects together if
this code is ever touched again.

**Resuming a paused draft:** `DraftArenaPage`'s mount effect checks for
an existing `tournament_draft_state` row first and, if one exists,
seeds both `tournament` and the Undo stack from it instead of starting
fresh. The row is only cleared when the draft actually reaches Final
Matchups or the tournament ends — leaving the page mid-draft no longer
loses progress. The ephemeral "captain clicked but not yet assigned"
highlight is intentionally **not** restored on resume (would read as a
click that never happened).

## 9. Spectator Page

`src/components/SpectatorPage.jsx`, reached via a **观赛** button (open
to every logged-in account, staff or not) on the Tournament Lobby,
routed at `#spectate`. Uses the main app's Tailwind dark/neon-teal
theme only for its own thin identity/exit header — the Captain/Teammate
draft and Final Matchups bodies are the **exact same `DraftArena`/
`FinalMatchupsStage` components** the admin's own Draft Arena renders,
mounted with `isStaff={false}` — pixel-identical layout to what staff
see, not a reimplementation. Deliberately scoped to the live drafting
process only — general tournament/roster info already lives in the
Tournament Lobby.

`isStaff={false}` means every admin-only control is not rendered at
all (not merely disabled), and every mutating click handler no-ops —
but visually nothing is missing: both stages' spectator-replay paths
(Section 8) fire the identical animations for every pick/roll as they
happen live, not just the final state.

Views, switched purely by what's currently in the database:
- **waiting placeholder** — no draft in progress and no Final Matchups
  yet: a minimal "选秀尚未开始" message.
- **`drafting`** — a `tournament_draft_state` row exists: `<DraftArena>`
  fed a `tournament` object built from that broadcast.
- **`final`** — a `tournament_matches` row exists: `<FinalMatchupsStage>`
  with its own back button suppressed (this page's header already has
  an exit button). Ending the tournament sends spectators back to the
  Lobby too, same as every other connected client.

## 10. Not Yet Built / Known Limitations

- If two Admin/Developer accounts ran separate drafts concurrently
  before Final Matchups, the snapshot taken on 进入最终对阵 is whichever
  draft called it most recently — an accepted, unaddressed edge case.
  The Live Draft State broadcast has the same "last writer wins"
  behavior for the Spectator Page's `drafting` view, and for resuming a
  paused draft.
- Sessions are bearer tokens, not JWTs — no Supabase-Auth-based RLS
  (Section 6 explains why).
- No password reset, "remember me," or email anywhere (by design,
  Section 3).

## 11. Maintaining This Document

**The roadmap is complete — this is no longer a phase-by-phase build
log.** Going forward:

- Only record what a new developer actually needs to know: important
  architecture, system behavior, product decisions, known limitations,
  and permanent rules (like Section 3's browser-size standard) — plus
  genuinely important fixes whose *cause* future work needs to avoid
  repeating (see the animation-performance note in Section 8 for the
  right level of detail: what to watch out for, not a blow-by-blow of
  how it was diagnosed).
- Do **not** log every small UI tweak, minor bug fix, command run,
  test, or implementation detail — the repository and its own code
  comments are the reference for that. If it's not something the next
  developer needs to be told up front to avoid a mistake or understand
  a decision, it doesn't belong here.
- Do not keep a chronological history of development actions (file
  removals, refactors, one-off cleanups). Describe **current state**
  only. When a change supersedes something already written here, edit
  or replace that text — don't leave the old, now-wrong description in
  place next to the correction.
- Keep it concise; consolidate rather than repeat across sections.
- Update this document before handing off to another developer or
  starting a new chat — this document, not prior chat history, is what
  the next person picks up from.
- For install/run/build instructions, see `README.md`.
