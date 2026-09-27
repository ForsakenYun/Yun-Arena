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
changelog of every fix, refactor, or small UI tweak. See Section 11 for
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
- **Team Role (角色) and System Identity (身份) are completely
  independent** — never conflate them, and never swap the two words
  (Section 4, including its Terminology Refactoring entry).
- **Only the Developer (开发者) identity manages permissions** — an
  Admin can never promote, demote, or change anyone's 身份.
- **Simplified Chinese interface**, gaming-style UI with a Theme
  Switcher (dark with a neon teal glow, or a light "Cyber-Teal" mode —
  see the account dropdown's 暗色模式/亮色模式 toggle), consistent across
  every page **including** the Draft Arena and Spectator Page as of the
  Theme Switcher's light-mode rollout: `bg-panel`/`text-ink-*`/
  `border-panel-line` and friends inside `DraftArena.jsx` now follow the
  ambient theme the same as everywhere else (`DraftVisualLock`, which
  used to force this dark regardless of the account's saved theme, has
  been removed from both `DraftArena.jsx` and `SpectatorPage.jsx` — see
  Section 8). What's still **not** restyled is Draft Arena's own *brand
  glow* — the Orbitron display font at the sizes/weights Draft Arena uses
  it (the same font family is a site-wide token, Tailwind's `font-display`
  — Admin/Lobby use it too, just smaller and less often), and the neon
  purple/cyan glow system (`TEAL`/`TEAL_SOFT` constants, the
  `rgba(124,92,255,...)`/`rgba(34,229,255,...)` accent glows/text-shadows
  scattered through captain/teammate cards and the Final Matchups
  spotlight, and BroadcastFrame's corner brackets/pulse) all stay fixed
  regardless of theme, the same as before. (Corrected by the Section 8
  visual audit below: this paragraph used to say "gold/Cinzel-Orbitron"
  and "the overall gold Final Matchups treatment" — stale, describing an
  earlier poster-style design that predates the VS-duel spotlight this
  doc's own Section 8 already documents; there is no Cinzel font and no
  gold color anywhere in the current implementation.) In short: Draft
  Arena's *surfaces and text* now theme like the rest of the app; its
  *brand glow* doesn't. **Exception,
  by explicit request:** all of Draft Arena's admin-only action buttons —
  Final Matchups' five (定角锁定/随机生成剩余对阵/重置/解除本场对阵/
  结束锦标赛) plus the Draft Captain/Player header strip's three
  (撤销/开始队员选秀/进入最终对阵) — rendered through `DraftAction`,
  a bordered button component that started as a copy of Tournament
  Lobby's `RailAction` (classes: `flex items-center gap-2.5 px-3 py-2.5
  rounded-lg border text-sm font-medium`, default/danger hover
  treatment, `disabled:opacity-50`). Tournament Lobby's own `RailAction`
  has since moved to the borderless sidebar-row style (Section 7). Final
  Matchups' own five buttons have since moved again, off `DraftAction`
  entirely and into the rail as `FmpRailAction` (Section 8), matching
  `RailAction`'s current borderless look; `DraftAction` now renders only
  the Draft Captain/Player header strip's three buttons, still bordered,
  on purpose (Section 8 explains why: relocating Final Matchups' buttons
  into a now-borderless rail without also updating their own style would
  have visibly clashed, but restyling the shared `DraftAction` itself
  would have silently changed this other, unrelated strip's buttons
  too). The three names are independent components now — a change to one
  does not need mirroring in the others. It is paired
  with a local `DraftIcon` stroke-icon
  set matching the site's icon style — replacing emoji, the header
  strip's three hand-rolled inline-styled buttons (previously amber for
  撤销, glowing teal for the other two), and one previously hand-rolled
  inline-styled Final Matchups button. `DraftAction` has one addition on
  top of that original `RailAction` shape: an optional trailing `badge`
  (a small count pill) so 撤销's remaining-undo count didn't have to be
  silently dropped when it moved onto the shared component — `RailAction`
  itself has no such slot. Both were named `MatchupAction`/`MatchupIcon`
  and scoped to just the five Final Matchups buttons before the Theme
  Switcher's light-mode support broadened it, then renamed
  `DraftAction`/`DraftIcon` when the same treatment was extended
  app-wide across Draft Arena's admin controls, on request. Don't read
  *this* note as license to touch Draft Arena's brand glow/fonts without
  being asked again.
- **`AuthPage.jsx` always renders dark, regardless of the ambient
  theme** — it's the brand's front door, rendering before any account
  (and therefore any saved theme preference) exists, so it has no
  legitimate light/dark choice to reflect. Enforced two ways, both on
  `AuthPage`'s own root element: `DARK_THEME_LOCK_STYLE`
  (`AppShell.jsx`) re-declares every themed CSS variable back to its
  dark value for that subtree, and the root itself carries an explicit
  `bg-void` class so it actually paints that locked-dark value rather
  than just making it available to descendants. **Bug fix, by explicit
  report:** a disconnect/logout redirect back to this page while a
  light-mode account's `data-theme='light'` was still set on `<html>`
  showed an inconsistent white canvas around/behind the dark panel.
  Root cause: `body`'s own `background-color: rgb(var(--color-void))`
  rule (`index.css`) sits on an *ancestor* of `AuthPage`'s root, outside
  the subtree either fix above can reach, so it kept reading the
  ambient light value — and `AuthPage`'s root had no background of its
  own painting over it (hence adding `bg-void` above). Fixed by having
  `AuthPage` set `document.body.style.backgroundColor` directly on
  mount (highest specificity, no selector/`!important` games needed)
  and clear it on unmount so every other page keeps following the
  ambient theme via `body`'s normal rule once `AuthPage` is gone; done
  in a `useLayoutEffect`, not `useEffect`, so it applies before the
  browser's next paint and there's no visible flash on the redirect
  itself either.
- **`bg-accent-gradient` (every gradient button/CTA/chip app-wide)
  renders the same violet→cyan gradient in both themes, by explicit
  request** — it used to read `--color-accent`/`--color-accent2`
  directly (`tailwind.config.js`), which are the Cyber-Teal light
  identity's *color* tokens too, so the gradient collapsed to a flat,
  single-stop teal in light mode (both stops resolved to the same
  value) instead of a real gradient. Now reads two dedicated variables,
  `--color-accent-grad-from`/`-to` (`index.css`'s `:root` block,
  matching dark mode's original violet/cyan values), that are
  deliberately *not* re-declared under `[data-theme='light']` — so
  every `bg-accent-gradient` consumer (`.btn-primary` and therefore
  every button built on it — including 参加比赛 — plus the AuthPage
  login/register toggle, Admin Dashboard's role chips/avatar badges,
  brand marks) is unaffected by theme. `--color-accent`/`--color-accent2`
  themselves are untouched and still theme-following (teal in light
  mode) for their other, independent, non-gradient uses (`text-accent2`,
  `border-accent/40`, etc.) — only the gradient fill changed, not the
  Cyber-Teal identity generally.
- **`AppShell.jsx`'s top nav tabs (管理后台/锦标赛大厅/观赛 etc.) use the
  same violet→cyan active-state language as the rest of the app now, in
  both themes, by explicit request** — `NavTab` used to branch on
  `theme`: light mode gave the active tab's label a solid Cyber-Teal
  `text-accent` color plus a plain dark-neutral (`bg-ink-primary`)
  indicator bar, while dark mode kept the label neutral
  (`text-ink-primary`) and put the accent on a `bg-accent-gradient`
  indicator bar instead. Once buttons/CTAs stopped going flat-teal in
  light mode (the `bg-accent-gradient` fix above), that lingering teal
  nav-tab text read as inconsistent — a one-off teal next to gradient
  buttons everywhere else. Unified both themes onto dark mode's original
  treatment: neutral `text-ink-primary` label + `bg-accent-gradient`
  indicator bar, no `theme`/`isLight` branching left in `NavTab` at all
  (the `theme` prop was dropped from its one call site too, now unused
  there — `AppShell`'s own `theme` state is still used elsewhere, e.g.
  `AccountChip`'s toggle). Since the gradient itself is already
  theme-independent, this single treatment automatically reads as
  violet→cyan in both themes with no further branching needed.
- **Account dropdown trigger shows a settings cog, not a chevron.**
  `AccountChip` (in `AppShell.jsx`, so it applies on every page) ends
  with `NAV_ICONS.gear` — a classic cog, `w-4 h-4`, muted at rest,
  `accent2` on hover, and turned 90° + `accent2` while the menu is open.
  It is intentionally a different glyph from `TournamentLobby.jsx`'s
  ray-style `gear` (used for 锦标赛设置), which looks too much like the
  `sun` theme-toggle icon inside the same dropdown.
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
- **Draft Arena and the Spectator Page are one system, not two —
  treat them that way in every change.** The Spectator Page
  (`SpectatorPage.jsx`, Section 9) renders live off exactly what Draft
  Arena (`DraftArena.jsx`, Section 8) persists — same components
  (`<DraftArena>`/`<FinalMatchupsStage>` themselves, mounted
  `isStaff={false}`), same tables, same payload shapes, same timing.
  There is no independent Spectator implementation to "forget about."
  Whenever *any* change to Draft Arena — adding, removing, refactoring,
  or otherwise modifying anything in it — could affect the Spectator
  Page's UI, state shape, persisted data, animations, timing, sync
  behavior, or failure modes, the Spectator Page MUST be inspected and
  updated in the same change, not as a follow-up. This is not a
  suggestion: two real, shipped bugs (Section 9's persistence-vs-
  connection rework, and the `tournament_draft_state`/
  `tournament_draft_history` payload-size split) both came from this
  link being treated as incidental instead of load-bearing. Concretely,
  before merging any Draft Arena change, check whether it touches: the
  shape of anything written to `tournament_draft_state`/
  `tournament_draft_history` or `tournament_matches`; the debounce/
  coalescing/timing of when those writes happen; the `isStaff={false}`
  rendering path in `<DraftArena>`/`<FinalMatchupsStage>` (admin-only
  controls, spectator-replay animations); or anything
  `SpectatorPage.jsx` itself reads, subscribes to, or assumes.
- **A click's own success must never depend solely on that same
  client's Realtime subscription echoing its own write back.** Found
  twice as a real, reported bug (进入最终对阵 and 结束锦标赛, Section 8
  — both fixed by applying the RPC's own result/success directly
  instead): a write succeeding server-side and *this client's own*
  postgres_changes subscription having already processed it by the
  time the click handler returns are only *usually* close together in
  time, never guaranteed to be — so the very first click could produce
  no visible change at all until something else (often just a second
  click's own write, prompting a second round trip) coincidentally
  arrived. The symptom is distinctive and easy to mistake for
  something else: click does nothing, click again and it works. The
  fix is always the same shape, and is already the established pattern
  for every other mutation in `FinalMatchupsStage`
  (createManualMatchup/rollTournamentMatchupsPool/
  removeTournamentMatchup/resetTournamentMatchups all do this
  already) — apply the awaited RPC call's own return value (or a
  direct follow-up callback on success, e.g. `onEnded()`) straight to
  local state/navigation, synchronously in the same handler. Realtime
  still stays exactly as useful as before for *every other* connected
  client (another staff tab, or Spectators) — this isn't "remove
  Realtime," it's "never make the acting client wait on it for its own
  action." Any new admin-mutating button added to Draft Arena or
  Admin Dashboard should be checked against this before shipping.
- **Every top-level page (Tournament Lobby, Admin Dashboard, Draft
  Arena/Final Matchups, Spectator) must receive `account` and
  `onLogout` from `App.jsx` and forward both into its own `<AppShell>`
  call — there is no other source for either.** Found as a real,
  shipped bug twice over: Draft Arena/Final Matchups (they share one
  `<AppShell>` mount in `DraftArenaPage`) was missing `onLogout`, so
  its 退出登录 button silently called `undefined()`; the Spectator Page
  was hard-coding `account={null}` plus a `viewerMode` flag that
  stripped the account chip entirely, rather than forwarding the real
  `account`/`onLogout` it was already being passed. Any new top-level
  page added later needs this wiring checked explicitly — don't assume
  it's covered just because other pages already do it right.

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
  scrolls (`lg:flex-1 lg:min-h-0 overflow-y-auto`). Primary navigation
  always stays in the top header (`AppShell`). Admin Dashboard and
  Tournament Lobby additionally carry a page-level left sidebar for
  their own controls (Section 7) — that sidebar is not navigation
  between pages.
- **Full-bleed main cards (Admin Dashboard 已注册用户, Tournament Lobby
  参赛名单, Final Matchups' spotlight column), by explicit request.** From
  `lg` up the page wrapper carries only a left inset (`lg:pl-6 lg:pr-0
  lg:py-0 lg:gap-0`; it's still `gap-5 p-4 sm:p-5` below `lg`), so the main
  card runs flush against the header, the page bottom, the viewport's right
  edge, and the sidebar. **The rail's old spacing moved onto each
  `<aside>`** so the three rails sit exactly where they did: `lg:py-6`
  (content still starts 24px below the header) and a right padding standing
  in for the old gap (`lg:pr-5` on Admin; `lg:pr-6` on Lobby/Draft Arena,
  which is their old 4px `pr-1` plus the 20px gap). Their declared width
  grew `lg:w-[220px]` -> `lg:w-[240px]` to pay for it, so **usable rail
  content is unchanged: 220px on Admin, 216px on Lobby/Draft Arena, with
  the card's left edge still 264px from the page's left.** (Padding on an
  `<aside>` is subtracted from its declared width -- see Section 8's
  sidebar bug fix -- so never change one of these without the other.)
  **Keep the width and padding on all three asides in step.** Admin and
  Lobby put the square-edge utilities directly on their `.glass-panel`
  sections: **`rounded-none` at every breakpoint** (by explicit request;
  sharp corners, so nothing shows in the corners where the card meets the
  header, the page bottom, the sidebar seam and the viewport edge), plus,
  from `lg` up, `lg:border-y-0 lg:border-r-0` and `lg:[clip-path:inset(0)]`
  (no shadow or light-mode ring bleeds over the header or onto the
  sidebar). Its **left border stays, as the seam against the sidebar**.
  The Final Matchups spotlight does the same (`rounded-none` +
  `lg:border-0`) and the seam there is the column's own `lg:border-l`.
  **These live in the JSX on purpose, not in an index.css helper class:**
  an earlier version used a `.glass-panel-flush` class in index.css, and
  when that file wasn't updated alongside the components the cards fell
  back to `.glass-panel`'s default `rounded-2xl` and showed a rounded
  corner right under the header. Don't move this back into CSS. Below `lg`
  the cards keep their bordered, padded, stacked layout (they're just
  square now); the page scrolls.
  **Using the extra space:** the scroll areas were already `flex-1
  lg:min-h-0 overflow-auto`, so they show more rows; table rows are roomier
  (`lg:py-3` on every `<td>`, was `py-2.5`); and on the two tables
  every header/data cell's horizontal padding scales up
  (`px-3 lg:px-5 xl:px-7`, headers and cells always changed together so
  columns stay aligned) with the table's scroll area at `lg:px-4` and the
  card header's title inset to match (`lg:px-9 xl:px-11` = scroll-area
  padding + cell padding, so the title lines up with the first column).
  Admin's 邀请码管理 section is the same card in the same slot, so it got
  the same flush treatment rather than jumping when you switch tabs (its
  header just takes `lg:px-6`, since its rows aren't table cells).
- The UI must still remain responsive for smaller screens: below the
  `lg` breakpoint, everything falls back to normal stacked, full-page
  scroll for mobile.
- `min-h-0` belongs on the outer container that's actually meant to
  size-cap and internally scroll (paired with `overflow-y-auto`/
  `overflow-hidden` on that same element) — never on an individual
  `shrink-0` content card nested inside it. Putting it on the card
  itself removes that card's own content-height floor, letting the
  card get squeezed shorter than its own content on a short viewport
  instead of its scrollable ancestor absorbing the overflow. Real,
  reported bug: the Tournament Lobby's 赛事管理 panel had its buttons
  spill out past its own border because `min-h-0` had ended up on the
  panel itself rather than on its scrollable `<aside>` parent.
- A `backdrop-blur`/`filter` element with no explicit `z-index` still
  forms its own stacking context, but sits at an implicit `z-index: 0`
  when ordered against *other* stacking-context-forming siblings (any
  element also using `backdrop-blur`/`transform`/`opacity`) — ties are
  broken by DOM order, so later page content can silently paint over
  an earlier header/dropdown that visually "should" be on top. Real,
  reported bug: `AppShell`'s header bar (`backdrop-blur-md`) needed an
  explicit `relative z-20` for exactly this reason — its own account
  dropdown (already `z-20` internally, relative to the header) was
  still rendering behind ordinary page content elsewhere on the page.
  Give any always-on-top chrome an explicit `z-index` — don't rely on
  DOM order alone to keep it on top.
- Applied to `TournamentLobby`, `AdminDashboard`, and `DraftArena`'s own
  pages (`AuthPage` is exempt — it stays a single centered card by
  design).

**Technical stack:** React + Vite, Tailwind CSS, Supabase (Postgres +
Storage + Realtime, no Supabase Auth).

## 4. Terminology

- **Username (账号)** — login credential only, never shown publicly.
  The UI label is 账号 everywhere (login/registration forms, Admin
  Dashboard and Lobby tables/forms, error messages); it was 用户名
  before. The code identifiers (`accounts.username`, `username`,
  `invalid_username`, `username_taken`) are unchanged. Note 账号 is also
  used in ordinary sentences for "the account as a whole" (e.g.
  还没有账号？, 该账号已登录) — same word, context tells them apart.
- **Display Name (昵称)** — the public name shown throughout the site.
- **Invite Code** — required to register.
- **Team Role (角色 / 队内角色)** — 队长 (Captain) or 队员 (Player),
  chosen at registration. A tournament label only — grants no site
  access. Stored as `accounts.tournament_role`.
- **System Identity (身份)** — Developer (开发者) / Admin (管理员) /
  User (普通用户). Controls Admin Dashboard access and permission
  management (Section 5). Stored as `accounts.permission_role`.

These two concepts are unrelated: a Captain can be a Developer, Admin,
or User, and neither ever changes the other.

### Terminology Refactoring — 身份 / 角色 global swap

**The rule (permanent, applies to every future devlog entry, UI label,
code comment, error message, and architecture/backend doc):**

| Concept | Values | Label to use | English term |
|---|---|---|---|
| System-level user type | 开发者 / 管理员 / 普通用户 | **身份** | System Identity |
| Team-level position | 队长 / 队员 | **角色** (队内角色) | Team Role |

Before this change the two words were assigned the other way around
(角色 meant 开发者/管理员/普通用户, 身份 meant 队长/队员), which made
Admin Dashboard's 已注册用户 table — where both columns sit side by
side — hard to talk about. The labels were swapped globally so that
**身份 = who you are in the system** and **角色 = what you play on a
team**. Use exactly these words; never write "the 角色 column" to mean
开发者/管理员/普通用户 again, and never use 身份 for 队长/队员.

**What changed (labels, user-visible text, and docs only):**
- `AdminDashboard.jsx`: 已注册用户 table headers (队长/队员 column is
  now 角色, 开发者/管理员/普通用户 column is now 身份 — column
  positions themselves unchanged) and the 编辑用户 form's 队长/队员
  toggle label (身份 → 角色).
- `TournamentLobby.jsx`: 参赛名单 table's 队长/队员 column header
  (身份 → 角色), and the 开始比赛 validation dialog's wording
  ("身份分配"/"身份异常" → "角色分配"/"角色异常").
- `AddParticipantsDialog.jsx`, `EditParticipantDialog.jsx`: 队长/队员
  column header / form label (身份 → 角色).
- `AuthPage.jsx`: registration form's 队长/队员 label and its
  "请选择…" validation toast (身份 → 角色).
- `adminApi.js` / `auth.js`: the `invalid_tournament_role` error
  message (身份无效 / 请选择身份 → 角色无效 / 请选择角色).
- Code comments in `AdminDashboard.jsx`, `TournamentLobby.jsx`,
  `AddParticipantsDialog.jsx`, `DraftArena.jsx`, and `supabase/
  schema.sql` re-worded to the new terms. This document's own
  Sections 3–5, 7, 8 were updated the same way.

**What deliberately did NOT change:** database/code *identifiers* —
the `accounts.tournament_role` and `accounts.permission_role` columns,
the `invalid_tournament_role` RPC error code, and frontend names such
as `ROLE_LABEL`, `PERMISSION_LABEL`, `RoleBadge`, `RoleToggle`,
`TOURNAMENT_ROLE_SORT_PRIORITY`, `PERMISSION_SORT_PRIORITY`, and the
`tournamentRole`/`permissionRole` sort keys. This was a semantic/label
swap, not a schema migration: renaming columns or RPC error codes would
require a coordinated database migration against the live Supabase
project and would break every existing RPC and client for no
user-visible benefit. So when reading code, remember the mapping:
`tournament_role` = 角色 (队长/队员), `permission_role` = 身份
(开发者/管理员/普通用户). If identifiers are ever renamed to match, do it
as its own explicit, planned migration.

## 5. Permission System (enforced server-side)

- **Developer (开发者)** — full access to everything, including
  managing permissions (promote/demote, change anyone's 身份).
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
- **Realtime channel names must be unique among every *concurrently
  open* channel, not just per call site.** Reusing a fixed channel
  name (e.g. `supabase.channel('some-fixed-name')`) while a previous
  `.subscribe()` on that exact same name hasn't been torn down yet
  throws (`cannot add 'postgres_changes' callbacks... after
  'subscribe()'`) instead of quietly multiplexing — and an uncaught
  throw during render takes down the whole component tree. Real,
  shipped bug: `subscribeDraftState` (`tournamentApi.js`) used one
  fixed channel name, which was fine while only the Spectator Page
  ever called it — until `App.jsx`'s system-wide draft-start listener
  (Section 8) added a second, permanently-open subscriber and crashed
  the Spectator Page on load. Fixed by suffixing the channel name with
  an incrementing counter per call. Any `tournamentApi.js`/`adminApi.js`
  subscribe function that might ever gain a second concurrent
  subscriber needs this same per-call-unique-name treatment.

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
  in Section 8). 🏁 结束锦标赛 (Section 8, Final Matchups) now also
  removes every temp account automatically once the tournament ends —
  see that section's "Temp-player cleanup on end" note. That behavior
  exists solely because this feature exists; it should be removed
  along with 创建临时玩家/移除临时玩家 if this feature ever is. 创建临时玩家
  is a one-shot action while any temp accounts exist — the button
  locks (disabled, label switches to 已创建临时玩家) the moment the
  roster shows any temp participant, and re-enables itself the instant
  移除临时玩家 clears the last one. This is derived live from
  `accounts.is_temp` (now returned as `isTemp` on every participant
  from `fetchLobby()`), not local component state — so the lock stays
  correct across a page reload or a second admin's tab. Don't
  reintroduce a local-only "did I just click create" flag here.
- **开始比赛** validates the joined roster against Tournament Settings
  exactly (`requiredCaptains` = team count, `requiredPlayers` = team
  count × (players per team − 1), `requiredTotal` = their sum, all
  three checked independently) before navigating to the Draft Arena;
  any mismatch blocks navigation with a breakdown of what's needed.
  **Already-started guard, by explicit request:** now that 选秀台 is its
  own persistent nav tab (Section 8), re-entering an in-progress draft
  is no longer this button's job — it now checks `fetchDraftState()`
  *first*, before the roster validation above, using the exact same
  "resume" signal (`existing.teams.length > 0`) `DraftArenaPage`'s own
  mount effect checks; if a draft is already in progress, navigation is
  blocked and the standard bottom-right toast fires instead (锦标赛已
  开始，请通过顶部导航栏前往「选秀台」。), pointing the admin at that
  tab rather than silently re-entering. A `fetchDraftState()` failure
  itself (network hiccup, not "no row found" — `maybeSingle()` already
  resolves that case to `null`, no throw) is treated as "no active
  draft," the same way `DraftArenaPage`'s own mount-effect catch treats
  it, so a transient error here can't permanently block starting a
  genuinely new tournament.
- 参赛名单 (this page) and Admin Dashboard's 已注册用户 both render as
  real `<table>` elements with a sticky header row — column headers,
  cell padding, row borders/hover, and status-badge styling are
  deliberately identical between the two (copied verbatim, not
  independently derived). Neither uses the shared `TileRow` list
  component (`ui.jsx`) that other lists in the app (e.g. the
  invite-code list) still use. If either table's structure or styling
  changes, mirror the change in the other rather than letting them
  drift apart.
- **Page layout: left sidebar + roster, mirroring Admin Dashboard.**
  `TournamentLobby.jsx`'s `<aside>` is built from the same anatomy as
  `AdminDashboard.jsx`'s (`lg:w-[240px]` -- 220px usable, see Section 3 -- `eyebrow` labels, `border-t`
  separated blocks, the same compact `RailStat` tile, sidebar-row
  buttons) — the two are separate copies, not a shared component, so
  keep them visually in step. Top to bottom: **锦标赛大厅** (Tournament
  Settings' name plus "N 支队伍 · 每队 M 人" when a name is set, the
  join/leave status and 参加比赛/退出比赛 button), **实时统计** (总人数 /
  在线队长 / 在线队员 — always visible, including on mobile, unlike the
  Admin sidebar's 概览), and, Admin/Developer only, **赛事管理**
  (锦标赛设置, 添加参赛选手, 随机摇号, 创建/移除临时玩家, 清空参赛名单,
  then 开始比赛). Every 赛事管理 button is a `RailAction`: borderless
  `font-heading` rows like the Admin sidebar's inactive tabs. The aside
  scrolls on its own on desktop (`lg:overflow-y-auto`), since this
  page's control stack is taller than Admin's; below `lg` it stacks above
  the roster like Admin's does (no collapsible drawer). The main
  参赛名单 section keeps its own header — title, "实时同步 · N 人已加入",
  and the top-right **N 人在线** counter (online captains + players,
  `hidden` below `sm`) — over the roster table. There is no lobby date
  or tournament-status field in the data, so none is shown.
- Gender (`accounts.gender`, `'male'|'female'`, nullable): required at
  registration, editable in Admin Dashboard's edit-user dialog,
  display-only everywhere (icon only, no text label) — has no effect
  on permissions, matchmaking, or drafting.
- **添加参赛选手** (Admin/Developer-only, `AddParticipantsDialog.jsx`,
  own file sitting right next to `TournamentSettingsDialog.jsx` — same
  fixed-backdrop modal shell, same "fetch on open" approach, opened from
  a `RailAction` directly below 锦标赛设置): the admin-driven counterpart
  to 参加比赛 — lets staff put any already-registered account straight
  onto the roster instead of waiting for that person to click it
  themselves. Backed by a new `add_participants(p_token, p_target_account_ids
  uuid[])` RPC (admin/developer-gated via `_require_role`, `schema.sql`,
  next to `remove_participant`) — the batch/admin-driven twin of
  `join_tournament` (which only ever joins the *calling* account) the same
  way `remove_participant` is already `leave_tournament`'s admin-driven
  twin. Takes an array so a multi-select add is one round trip, not one
  RPC call per person; idempotent per id via `on conflict (account_id) do
  nothing`, exactly like `join_tournament` — an id already on the roster
  (e.g. that person joined themselves in the moments between the dialog
  opening and the admin clicking Add) is silently skipped rather than
  failing the whole batch, and an id for an account that no longer exists
  is dropped the same way (`select id from accounts where id = any(...)`
  rather than inserting the passed-in ids directly, so a stale selection
  can't throw a foreign-key violation).
  - The dialog lists every registered account (`fetchUsers()`,
    `adminApi.js` — the same call Admin Dashboard's 已注册用户 table
    already uses) except `is_temp` ones: temp accounts exist solely for
    创建临时玩家/移除临时玩家 and are always already joined the instant
    they're created, so this dialog has nothing useful to add for them.
  - Real-time 昵称 search (same contains/lowercase match Admin
    Dashboard's own search already uses), a multi-select checklist with a
    live "已选择 N 人" count and a 全选当前结果/取消全选 shortcut scoped to
    whatever the search currently shows, and each row disabled (checked,
    struck to 50% opacity, labeled 已参赛) rather than hidden once that
    account is already on the roster — so the admin can still see why a
    given person can't be re-added instead of them just silently missing
    from the list. `existingParticipantIds` is rebuilt fresh from live
    `participants` state on every `TournamentLobby` render, not computed
    once when the dialog opens, so a row flips to disabled immediately if
    someone joins through another tab while the dialog is still open.
  - Row fields are the four requested: 头像/昵称/性别/角色. 角色 here
    means the *team* role — 队长/队员 (`tournament_role`), the same
    thing the main roster table's own 角色 column shows — **not** the
    system 身份 (开发者/管理员/普通用户, `permission_role`). **Fixed, by
    explicit report** (twice): this column first rendered
    `permission_role` via a duplicate of Admin Dashboard's
    `PermissionBadge`, but the screenshot this dialog is meant to match
    made clear the intended field was the team role. So the badge here
    is `RoleBadge`, at first a verbatim duplicate of
    TournamentLobby.jsx's/AdminDashboard.jsx's own component, reading
    `tournament_role` — labels and field choice unchanged since (see
    below for the badge's own further styling
    history). `Avatar`/`GenderIcon` inside this file stayed duplicated
    rather than imported, the same "kept as an exact duplicate, not a
    shared import" convention this page's own `trash` icon already
    follows — expected to drift independently if either page's needs
    diverge later, not something to keep in sync by hand.
  - **Layout fixed, by explicit report** (three times now):
    1. First shipped as a single bordered list box (`divide-y` rows) —
       reported as too cramped.
    2. Became a `grid grid-cols-1 sm:grid-cols-2 gap-3` card grid, each
       user its own bordered, padded tile — a follow-up request (with a
       screenshot of the main roster table) asked to scrap the card
       concept entirely and match that table instead: a header row (头像/
       昵称/性别/角色, muted text, `border-b border-panel-line`, sticky
       like the roster table's own `<thead>`) above flat rows, no
       per-row box, just a `border-b border-panel-line/35` divider
       between them. Header and rows shared one
       `grid-cols-[40px_60px_1fr_80px_100px]` template so columns stayed
       pinned under their headers without needing an actual `<table>`,
       which is what let this dialog keep a leading checkbox column the
       roster table itself doesn't have.
    3. That `1fr` nickname column was then reported as leaving a wide gap
       before 性别/角色 whenever a name didn't fill the available width
       — a flexible track sized itself to the *widest possible* name,
       not to the column header above it, so short names left the rest
       of the row looking unaligned. Replaced with a fully fixed
       template, `grid-cols-[36px_48px_140px_80px_100px]`, so the
       nickname column (and every column) is a constant width regardless
       of content length — the wrapper's `min-w-[404px]` was tightened
       to match (was `420px`, sized for the wider first template).
       `min-w-0` stayed on the nickname `<span>` since a fixed-width grid
       track still needs it to truncate instead of overflowing.
    4. With the row content now a fixed ~428px (`404px` of columns +
       `24px` of row padding), the dialog shell itself — still `max-w-2xl`
       (`42rem`/672px) from before this became a data table at all — was
       reported as leaving dead space on the right. Shrunk to
       `w-[480px] max-w-full` (the `max-w-full` keeps it from overflowing
       a narrow viewport, same responsive intent `w-full max-w-2xl` had
       before), and the now-redundant `min-w-[404px]` inner wrapper
       (step 3's fix, made unnecessary once the outer shell itself is
       sized to fit) was removed rather than left as dead weight.
    5. A follow-up explicit request asked for the dialog shell as
       `w-full max-w-[480px]` specifically rather than `w-[480px]
       max-w-full` -- functionally near-identical at this width (both cap
       around 480px and both fall back to the viewport on narrow
       screens), but `max-w-[480px]` is the form the rest of this app's
       responsive containers already use (see `TournamentSettingsDialog`
       `w-full max-w-lg`, this file's own search input/action buttons
       already `w-full`/`flex-1`), so this switches to match that
       convention instead of the fixed-then-capped one used before.
    6. Same request also caught the 角色 column not lining up with 已选择
       N 人 above it: the header/row grid divs carried their own `px-3`
       horizontal padding, insetting every column 12px from the dialog's
       own `px-6` edge that everything else (title, search box, the
       已选择 counter, the action buttons) sits flush against. Dropped
       that `px-3` from both the header row and every data row so the
       grid's first (checkbox) and last (角色) columns land on the exact
       same left/right margins as the rest of the dialog's content, not
       a narrower margin of their own.
    7. A further explicit request asked the table to fill the full
       ~432px dialog width edge-to-edge rather than stopping short partway
       across (`36+48+140+80+100 = 404px` of fixed columns, short of the
       ~432px available inside `max-w-[480px]`'s `px-6` padding). Nickname
       went back to a flexible `1fr` track (`grid-cols-[36px_48px_1fr_
       60px_auto]`, 性别 tightened `80px` → `60px`, 角色 `100px` → `auto`,
       sized to the badge's own `w-fit` width) -- the *same* `1fr` choice
       step 3 above had already tried and reverted for leaving a gap
       before 性别/角色 on short names, but this time that gap is the
       intended effect, not a bug: 性别/角色 are now right-aligned
       (`justify-self-end`/`text-right` added to the 角色 header `<span>`
       and to `RoleBadge` itself) so they sit flush against the row's
       right edge -- matching 已选择 N 人's own right-aligned position
       above them -- regardless of how much of the `1fr` track a given
       nickname actually fills, rather than trailing the nickname text
       directly the way step 3's fixed-width columns did. 性别 (a single
       icon, no text) didn't need an alignment class added since it was
       never wide enough to visibly drift within its own track either way.
    8. A follow-up explicit request reversed step 7's `1fr` choice again
       -- the gap it deliberately introduced between 昵称 and 性别ended up
       reading as unwanted whitespace rather than the intended "table
       fills the container" effect, so nickname went back to a fixed
       track: `grid-cols-[36px_48px_130px_60px_72px]` (性别 `60px`
       unchanged from step 7, 角色 `auto` → a fixed `72px`). Paired with
       shrinking the dialog shell itself from `max-w-[480px]` to
       `max-w-[400px]` (row content is now a fixed `36+48+130+60+72 =
       346px`, comfortably inside `400px − 48px` of `px-6` padding = 352px
       available) so the shell hugs the now-compact table instead of
       leaving dead space on the right the way the wider `480px` shell did
       once the columns stopped being flexible.
    9. A final explicit request undid step 7's right-alignment entirely:
       `justify-self-end`/`text-right` removed from both the 角色 header
       `<span>` and `RoleBadge` (all three states -- captain, player, and
       the `—` unset fallback), back to the column's natural left edge.
       With 角色 now a fixed `72px` track (step 8) rather than the
       `auto`-sized one right-alignment was originally added for (step 7),
       角色 sitting apart as the one right-aligned column in an otherwise
       left-aligned table read as inconsistent rather than as matching
       已选择 N 人's alignment above it, so this reverts to left, the same
       side 头像/昵称/性别 already align to.
    Already-joined users stay disabled + `（已参赛）` next to their name
    rather than hidden, unchanged since the card version, just moved off
    its dedicated second line since a flat row has none.
  - **`RoleBadge` restyled, by explicit report** (three times): the badge
    itself started as a verbatim duplicate of the other two pages'
    `RoleBadge` (`rounded-md`, flat border, no glow), then a follow-up
    request asked for a `rounded-full` pill with a subtle glow instead —
    the two source badges don't actually look like that themselves (see
    the entry below for their real, unglowed styling), so this became a
    deliberate one-off variant kept only in this file, not a third copy of
    the other two: same `ROLE_LABEL`/`#00A2E8` accent/border-only-for-队员
    choices, just `rounded-full` with a `bg-[#00A2E8]/10` tint and a
    `shadow-[0_0_10px_-2px_rgba(0,162,232,0.6)]` glow added on the 队长
    state only (队员/unset stay flat — "subtle" means the glow marks the
    standout state, not every pill). A second report then caught the
    badge stretching to fill the full 100px identity column instead of
    shrink-wrapping its text — as a direct grid child (it sits straight
    in the row's `grid-cols-[...]` template, not wrapped in its own cell
    `<div>`), CSS Grid's default `justify-items: normal` stretches a
    direct child along the inline axis unless the child's own width says
    otherwise. Added `w-fit` (overrides the stretch) and `justify-center`
    alongside the existing `items-center` (which only ever centered the
    icon/label vertically, not the pill's own horizontal centering) so
    the content-sized pill's label stayed centered within it. A third,
    separate explicit request then reversed the shape decision entirely —
    back to `rounded-md`, the corner radius every other badge in this app
    already uses, not a pill. `w-fit`/`justify-center` stayed (a rounded
    rectangle sitting as a direct grid child stretches exactly the same
    way a pill did — the fix was never about the corner radius) and so did
    the `#00A2E8`/glow choices from the second point; only `rounded-full`
    became `rounded-md`.
- The 队长 (Captain) `RoleBadge` (this page and Admin Dashboard's 已注册
  用户 table — same verbatim-copy rule as above; `AddParticipantsDialog.jsx`'s
  own copy has since diverged into the pill/glow variant documented just
  above, so it's excluded from this description) uses a single fixed
  accent color, `#00A2E8`, for both border and text — `bg-transparent
  border-[#00A2E8] text-[#00A2E8]` — identical in both themes, sitting
  border-only directly on the row background (no fill) in light and
  dark alike. Unlike most of the app this does **not** theme through the
  CSS-variable tokens (`--color-*`); it's one deliberate brand color
  reused as-is, not a theme-following one. `tailwind.config.js` still
  carries `darkMode: ['selector', '[data-theme="dark"]']` from an
  earlier iteration of this badge that used different shades/fills per
  theme (kept, unused for now, since it wires Tailwind's `dark:` variant
  to the app's own `data-theme` attribute — set by App.jsx — rather than
  Tailwind's default `prefers-color-scheme` media query; if this badge
  or anything else needs per-theme `dark:` classes again in the future,
  they'll follow the in-app toggle automatically with no further config
  needed).

- **Every 角色 badge app-wide is now a `rounded-full` pill; 身份 and
  Draft Arena's own 队长 tag deliberately are not.** First applied to just
  `TournamentLobby.jsx`'s `RoleBadge`/`StatusBadge` (角色 and 状态
  columns), then, by an explicit follow-up request, extended to every
  other 角色 badge in the app: `AdminDashboard.jsx`'s `RoleBadge` (its own
  角色 column) and `AddParticipantsDialog.jsx`'s `RoleBadge`. Every time:
  colors, borders, and every other class unchanged -- only the corner
  radius.
  - **`AddParticipantsDialog.jsx`'s `RoleBadge` has now flipped shape four
    times** across four separate explicit requests: `rounded-md` (verbatim
    duplicate of the other two pages) -> `rounded-full` with a tint/glow
    (its own entry above) -> reverted back to `rounded-md` (a third,
    separate request -- "the corner radius every other badge in this app
    already uses") -> `rounded-full` again, this time. The `w-fit`/
    `justify-center` grid-stretch fix and the `#00A2E8` tint/glow from its
    own history are untouched by any of this -- only the radius keeps
    moving.
  - **`AdminDashboard.jsx`'s `PermissionBadge` (身份: 开发者/管理员/
    普通用户) deliberately stays `rounded-md`.** It reads a different
    field (`permission_role`, not `tournament_role`) and the request was
    specifically for 角色/状态 badges; 身份 and 角色 have been kept
    deliberately distinct since Section 4's Terminology Refactoring, so
    this was not folded in without being asked.
  - **`DraftArena.jsx`'s `CaptainBadge`** (the small 队长 tag on a
    drafted captain's TeamCard, Draft Arena's own draft-stage UI, not a
    table column) **deliberately stays `rounded-md`** too -- a different
    page and a differently-shaped element (an inline confirmation tag, not
    a table-row badge), and Draft Arena's own visual identity is
    established elsewhere in this doc as something not to restyle without
    an explicit ask naming Draft Arena specifically.
  - The shared `ui.jsx` `Badge` component is unchanged and, as of this
    writing, has no consumers anywhere in the app (`grep` finds no
    `<Badge` usage outside its own definition) -- there is currently
    nothing rendered by it to be inconsistent with anything else.
  - So, after this change: `TournamentLobby.jsx`'s `RoleBadge`/
    `StatusBadge`, `AdminDashboard.jsx`'s `RoleBadge`, and
    `AddParticipantsDialog.jsx`'s `RoleBadge` are all pills.
    `AdminDashboard.jsx`'s `PermissionBadge` and `DraftArena.jsx`'s
    `CaptainBadge` stay `rounded-md`, on purpose, pending an explicit
    request to include them too.

- **Brand mark (the gradient-square "秀" tile) straightened, by explicit
  request.** It appears in exactly two places, `AppShell.jsx` (the 8x8
  nav-bar logo) and `AuthPage.jsx` (its own separate 14x14 copy on the
  login screen) -- both were `rotate-3` on the tile with a counter
  `-rotate-3` on the 秀 glyph itself (so the glyph stayed level while the
  tile visibly tilted). Both classes are simply removed from both copies;
  nothing else (size, gradient, glow, corner radius) changed. Checked for
  any other copy of this mark (e.g. a third one on some other page,
  following this app's established "verbatim duplicate per page" pattern)
  -- there isn't one; every other `bg-accent-gradient` tile in the app
  (the avatar-edit camera badge, `TournamentLobby.jsx`'s `StatCard` icon
  tile, its pick-number badge) is a different, unrelated icon and was
  never rotated to begin with.

- **编辑参赛选手 (Admin/Developer-only, `EditParticipantDialog.jsx`, opened
  from a new pencil icon in the roster table's own 操作 column, right
  beside the existing 删除 button):** the same "编辑用户" form Admin
  Dashboard's `EditUserModal` already offers (头像/账号/昵称/密码/角色/
  性别), reused via the same `editUser` RPC wrapper (`adminApi.js`) rather
  than a second copy of it, so staff editing someone from the Lobby and
  staff editing them from 管理后台 go through the identical permission
  check and validation in `edit_user` (`schema.sql`) either way. The
  dialog itself, and every subcomponent inside it (`Field`/`PasswordField`/
  `RoleToggle`/`GenderToggle`, its own small icon set), is a fresh
  duplicate of `AdminDashboard.jsx`'s own copies rather than an import —
  same "kept as an exact duplicate, not a shared import" convention this
  page's `trash`/`edit` icons and `AddParticipantsDialog.jsx` already
  follow, and the same reason every dialog opened from this page builds
  its own fixed-backdrop shell instead of importing Admin Dashboard's
  `ModalShell`.
  - `fetchLobby()` (`tournamentApi.js`) only ever selected the `accounts`
    columns the roster table itself renders (display_name/avatar_url/
    tournament_role/gender/is_temp) — missing `username` and
    `permission_role`, both of which this form needs (`username` as a
    field to edit; `permission_role` to decide whether 编辑 should even
    be offered, next point). Both were added to that `select(...)` and to
    the camelCase participant object it returns (`username`/
    `permissionRole`), rather than this dialog issuing its own separate
    fetch for the one row being edited — the roster's own live state
    already has everything else this form needs, so it's the natural
    source for these two fields as well.
  - **Developer-account protection carried over:** `edit_user` already
    rejects an admin (non-developer) editing a developer-owned account
    server-side — that's the real enforcement point, unchanged by this
    feature. `TournamentLobby.jsx` mirrors Admin Dashboard's own
    convenience-only guard on top of it: the 编辑 button itself only
    renders when `isDeveloper || p.permissionRole !== 'developer'`, the
    same condition Admin Dashboard's 编辑 button already uses, so an
    admin viewing the Lobby doesn't see a 编辑 button for a developer's
    row that would just fail server-side anyway.
  - **Sync:** `subscribeLobby()` already listens for `postgres_changes`
    on `accounts` (needed since this page's own 加入时间/头像/昵称 columns
    can change out from under it for other reasons too), so an edit from
    *any* client eventually lands here regardless. This feature doesn't
    rely on waiting for that round trip for the editing admin's own
    screen, though: `onSaved` explicitly calls `loadLobby()` right after
    `editUser()` resolves, the same "don't just wait on Realtime for your
    own action" pattern `saveUser` → `loadUsers()` already uses in
    `AdminDashboard.jsx`, so the row updates immediately for the person
    who made the change rather than depending on the Realtime round trip
    even for themselves.

- **Excel-style column sorting (排序), both `AdminDashboard.jsx`'s 已注册
  用户 table and this page's own roster table:** click a header label to
  cycle that column ASC (↑) → DESC (↓) → Default (unsorted), same
  three-state cycle Excel's own column sort uses, not a plain two-state
  toggle -- clicking a *different* column always starts that column fresh
  at ASC, discarding whatever state the previous column was left in
  (`nextSortConfig`, duplicated identically in both files per this
  project's usual "not a shared import" rule for small per-file pieces).
  `SortableTh`/`SortIndicator` (also duplicated in both files) wrap a
  column's `<th>` label in a button with the `↑`/`↓` indicator built in;
  头像 and 操作 stay plain `<th>`s in both tables since neither has a
  sensible sort (a photo, a set of action buttons).
  - **Alphabetical columns** (账号/昵称, `.localeCompare`) and **numeric/
    date columns** (抽签号, 加入时间 -- `Date` subtraction) sort exactly the
    way those types normally would. **Priority-ordered columns**
    (性别, 角色, 身份 on Admin Dashboard; 性别, 角色, 状态 here) instead
    rank through a small lookup object per column (`GENDER_SORT_PRIORITY`/
    `TOURNAMENT_ROLE_SORT_PRIORITY`/`PERMISSION_SORT_PRIORITY`, duplicated
    across both files the same way `SortableTh` is) rather than relying on
    string/numeric ordering, since "unset < male < female" or
    "developer < admin < user" isn't alphabetical or numeric order by
    accident -- it's a deliberately chosen business ranking. 性别/角色
    rank an unset value first (`?? 0`, below `male`/`female` or
    `captain`/`player`) on both pages; 身份 (`permission_role`) has no
    unset state to rank (`accounts.permission_role` is `not null default
    'user'`) so it starts at `developer`. 状态 (this page only) ranks by
    the same `isOnline(lastSeenAt, now)` check the status column itself
    already renders with, not a separate/duplicated notion of "online."
  - **Chains off search/the roll-aware default, doesn't replace it:**
    Admin Dashboard's `sortedUsers` is built from `filteredUsers` (the
    already-search-narrowed list), not raw `users`, so sorting only ever
    reorders whatever the search already narrowed down to, the same
    relationship `filteredUsers` already has to raw `users`. This page's
    roster has no search step, but does have a pre-existing default
    ordering worth preserving: once any roll has happened, the table
    auto-sorts by 抽签号 highest-first (renamed `defaultSortedParticipants`
    here, logic unchanged from before this feature). `sortConfig.key ===
    null` -- the "Default" state of the three-state cycle -- falls back to
    exactly that, so cycling a column through to its third click lands
    back on the roll-aware ordering rather than a fixed join-order that
    forgets about rolls.
  - **`useMemo`:** both `sortedUsers` and `sortedParticipants` are
    `useMemo`d, re-deriving only when their inputs actually change
    (`[filteredUsers, sortConfig]` / `[participants,
    defaultSortedParticipants, sortConfig, now]` -- `now` only matters
    when 状态 is the active sort key, but the table already re-renders on
    every `now` tick regardless for the status badges themselves, so
    including it here doesn't add a new re-render source, just lets 状态
    stay correctly ordered through the ones already happening).

## 8. Draft Arena

**⚠ Before changing anything in this section: see Section 3's "Draft
Arena and the Spectator Page are one system" rule. Any change here that
touches persisted data shape, timing, or the `isStaff={false}` path also
needs Section 9 (Spectator Page) inspected and updated in the same
change.**

Reached via 开始比赛 from the Tournament Lobby to *start* a draft
(validated, see Section 7's already-started guard too), or directly via
the 选秀台 nav tab to check in on one already running (see this
section's own "选秀台 nav tab" note further down). `src/components/
DraftArena.jsx` has its own visual identity (Orbitron display font at
its own sizes/weights, and a neon purple/cyan glow system -- see Section
3's own corrected description of exactly what this covers) that is
intentionally **not** restyled to match the rest of the app's flatter
Tailwind look -- leave the fonts and glow colors alone unless a change
is explicitly requested. As of the Theme Switcher's light-mode rollout, this page is
**no longer dark-locked**, though: it used to render through
`DraftVisualLock` (an `AppShell.jsx` export that force-pinned every
`bg-panel`/`text-ink-*`/`border-panel-line`-style CSS variable back to
dark, regardless of the account's saved theme), but that wrapper has
been removed from `DraftArenaPage`'s render — the page's surfaces and
text now follow the ambient theme exactly like Tournament Lobby/Admin
Dashboard do, while the brand fonts/glow stay fixed. If you're touching
styling in here, the working split is: theme-following → use the shared
`bg-panel`/`text-ink-primary`/`text-ink-muted`/`border-panel-line`
tokens (same as everywhere else in the app); brand-fixed → leave the
`TEAL`/`TEAL_SOFT` constants and the purple/cyan `rgba(...)` glows as
literal hex, not tokens.

**Light Mode text/badge legibility, bug fix on report:** two spots in
this file still had literal `text-white`/`bg-white` opacity classes
left over from before theming existed, both invisible-in-light-mode for
the same reason as the border/background fixes above — fixed color,
never following `[data-theme]`. The header's subtitle line under the
draft-phase heading (`现在点击上方一张空战队卡片 →` / `剩余N人·已分配N/8`
/ the round-progress line) was `text-white/40`, now `text-ink-muted`
(same token every other secondary/subtitle line in the app uses). The
Final Matchups roster's "轮空" (bye) badge was `bg-white/10 text-white/
50`, now `bg-panel-2/60 text-ink-muted` (matching that row's own idle-
state fill/text just above it). Grepped the file afterward for any
other `text-white/`/`bg-white/` — none left.

**Scrollbar track, bug fix on report:** `GlobalStyle` (rendered by both
`DraftArenaPage` and `SpectatorPage.jsx`, an unscoped global `<style>`
tag) declared its own `::-webkit-scrollbar-track { background:
#06070F }` — a literal near-black that won over `index.css`'s own,
already-theme-aware rule for the same selector
(`rgb(var(--color-panel-alt))`) purely because this `<style>` tag mounts
later in the document (same specificity, later source order wins). That
produced the black scrollbar-track bars in the bug report. Removed
rather than re-declared with a token, so there's exactly one rule for
this selector in the app instead of two that can drift apart again —
the track now just follows `index.css`'s site-wide rule; Draft Arena's
own thinner 6px width and purple/cyan thumb gradient are untouched. Same
sweep also removed `GlobalStyle`'s `input::placeholder { color:
rgba(255,255,255,.2) }` (identical issue; no `<input>` in
`DraftArena.jsx` needs it in the first place, so it's gone rather than
tokenized).

**Phase pill color standardization, by explicit request:** the header
strip's phase badge (第一阶段 · 队长分配 / 第二阶段 · 队员选秀) used to
color Phase 1 green (`#22c55e`) and Phase 2 cyan/teal (`TEAL`) —
different accent colors for what's otherwise an identical pill. Both
phases now render with the exact same cyan/teal values (`TEAL` +
`rgba(34,229,255,.12)` background), so the badge only changes its
label text between phases, not its color. Like `TEAL`/`TEAL_SOFT`
elsewhere in this file, these are literal hex (Draft Arena's fixed
brand accent system), so — per the second instruction — they're
already identical in both themes by construction, not something that
needed separate light/dark handling. Same fix applied to the header's
circular progress ring right next to this badge: `headerRingColor` (the
SVG stroke and the centered percentage text both read this one
variable) was the same green-for-Phase-1/cyan-for-Phase-2 split, now
always `TEAL` — only the fill amount (`headerProgressPct`) still
differs between phases, not the color.


**队长 (Captain) badge, by explicit request:** the two places this page
marks someone as captain — `CaptainBadge` (the team-slot/roster captain
row, plain component, no props) and `PlayerStatCard`'s `badge="队长"`
case (the 队长候选池 captain-candidate cards; its `badgeColors` also
covers a `"队员"` case, untouched) — both now render a solid `#00A2E8`
fill with black text (`bg-[#00A2E8] text-black` / literal
`background:"#00A2E8", color:"#000000"` respectively), replacing the
old translucent-green (`#22c55e`) treatment. This is part of the
page's brand-fixed system (literal hex, not theme tokens, same as
`TEAL`/the purple-cyan glows above) — intentionally the same in light
and dark, not theme-following. `PlayerStatCard`'s inline-style pattern
was kept as-is (not converted to Tailwind classes) to match how the
rest of that component already sets its badge colors; `CaptainBadge`
already used a `className`-only pattern, so it stays that way. Since
`SpectatorPage.jsx` renders the literal same `DraftArena` component
tree (Section 9), this change appears there automatically with no
separate edit.

**Admin action buttons, by explicit request:** every admin-only control
across all three stages below — the header strip's 撤销/开始队员选秀/
进入最终对阵 and Final Matchups' 定角锁定/随机生成剩余对阵/重置/
解除本场对阵/结束锦标赛 — now share one component, `DraftAction`
(see the code comment above its definition for the full history: it
started as `MatchupAction`, scoped to just the five Final Matchups
buttons, then was renamed and extended here). Like the 队长 badge above,
this is a deliberate, requested exception to "leave the brand glow
alone" — these buttons use the bordered `DraftAction` look (originally
copied from Tournament Lobby's `RailAction`) rather than Draft Arena's
own glow-button look, in both themes.

**Border/divider unification, by explicit request:** every structural
border, divider, and card outline across this page (both stages below
and Final Matchups) now uses the same `--color-panel-line` token at
`0.35` opacity that Tournament Lobby/Admin Dashboard's table-row
dividers use (their `border-b border-panel-line/35`), instead of a mix
of full-opacity `border-panel-line`, literal purple/cyan accent
opacities, and a few genuinely hardcoded dark hex left over from before
theming existed. Specifically: `TeamCard`'s outer border and captain-
slot inner border (was `/0.7` and `/0.3`); the empty captain-slot "?"
icon and empty teammate-slot row borders (were plain `border-panel-line`,
Tailwind classes); the position-slot number badge's empty-state border
and text color (were literal `#1c2b2e`/`#3a4a4a`, never adapted to
theme at all); `PANEL_LINE_DIM` (renamed from `TEAL_DIM`, was literal
`#2B3159`) — `Avatar`'s default ring border and a filled teammate-slot
row border both use this; `PanelFrame` (wraps `DraftSequenceStrip`, the
pick-order bar) and `PLAYER_CARD_BORDER`/`PLAYER_CARD_STAT_BORDER` (the
available-player pool cards, outer + inner stat-row borders) — both
were literal purple-accent opacities; `RosterRow`'s idle border (Final
Matchups' 参赛战队 list) and `FilmChip`'s idle border (was plain
`border-panel-line`, hover was `/0.6`, now base `/0.35`/hover `/0.5` so
hover still reads as more prominent than idle); the header strip's and
Final Matchups' section-divider borders (`border-b`/`border-l`, were
`/0.8`); and the Final Matchups "complete" match-row borders. Also
synced in `index.css`: the draft-sequence-strip's light-mode overrides
for `.seq-pick-past`/`.seq-divider`/`.seq-pick-upcoming` (previously
full-opacity `--color-panel-line` or a flat `rgba(0,0,0,.6)` black,
both heavier than the unified look). **Untouched, on request:** active/
focused highlights stay vibrant and literal — `TeamCard`'s active-team
cyan border, `canAssign`'s green dashed border, `RosterRow`/`FilmChip`'s
selected/active cyan-or-accent borders, the captain 队长 badge, and
every accent glow effect described above and below. Also untouched:
`DraftAction`'s idle button border (a bordered button style, not a
divider) and the ambient purple box-shadow glows on `PanelFrame`/
`TeamCard`/player cards (brand ambiance, not a border/line).

**`DraftSequenceStrip` state contrast, by explicit follow-up request:**
the border-unification pass above had left past/upcoming picks on the
*same* `panel-line/0.35` border, and their fill/text were still close
enough (a faint gray vs. a near-transparent cyan wash, both landing
near-white) that the three pick states read as "almost identical" in
light mode. Re-split in `index.css`'s `[data-theme='light']` block:
`.seq-pick-past` now gets a genuinely opaque gray fill
(`--color-panel-2` — slate-200 — at `0.6`) and a visibly faded digit
(`--color-ink-faint` — slate-400 — rather than the closer-to-solid
`ink-muted` used before), so a finished pick clearly recedes;
`.seq-pick-upcoming` now gets an explicit solid white fill
(`--color-panel`) instead of leaving the inline near-invisible cyan
wash in place, so an unstarted pick reads as a crisp, ready surface.
The current pick (JSX inline style, now also tagged with a
`seq-pick-current` class for this hook) was already a vibrant, literal
green fill/border/glow in both themes and didn't need restyling — only
picked up a light-mode-only digit-color override (`#047857`, emerald-
700) since the original `#4ade80` green-on-green read a little washed
out against a light panel specifically. Dark mode is untouched
throughout — same reasoning/mechanism as every other `[data-theme=
'light']` override in this file (`!important` beats the inline style
set directly in JSX; see the original `.seq-round-label`/`.seq-pick-num`
comment above for why that direction works).

**Standard top nav, by explicit request:** this page (and Spectator
Page below) used to give `AppShell` `backAction`/`backLabel`/`title`
instead of `nav`, rendering an isolated "< 返回锦标赛大厅" back-link
header — `AppShell` renders one or the other depending on whether `nav`
is passed (see its own comment on that branch). Both pages now pass the
same `nav` array shape as `TournamentLobby.jsx`/`AdminDashboard.jsx`
(管理后台 gated to `isStaff`, same gating everywhere else it appears),
so every page in the app renders the identical tabbed nav bar + account
chip. `handleDraftNavigate` mirrors `AdminDashboard`'s own pattern —
'lobby' goes through the existing `onExitToLobby` prop (functionally
identical to `onOpenLobby`/`onOpenAdmin` elsewhere: just `window.
location.hash = 'lobby'`), everything else sets the hash directly,
which `App.jsx`'s existing hashchange routing already handles the same
way for every other page. No new props were threaded through `App.jsx`.
`onExitToLobby` itself is unchanged and still used for its other
existing purposes (结束锦标赛, `FinalMatchupsStage`'s `onEnded`) — only
the header changed, not what "exit" does.

**选秀台 nav tab, by later explicit request:** this page is now also
reachable directly from a persistent nav item (positioned between
锦标赛大厅 and 观赛, `isStaff`-gated the same way 管理后台 is everywhere
it appears — added to all four pages' `nav` arrays: `TournamentLobby.jsx`,
`AdminDashboard.jsx`, this page, and `SpectatorPage.jsx`), not just via
Tournament Lobby's 开始比赛 button. `section="draft"` now marks this new
tab active while drafting, replacing the note just above about
borrowing 锦标赛大厅's highlight — that workaround no longer applies now
that a real tab exists. `App.jsx`'s `#draft` route is now gated to
`isStaff` too (previously documented as "not yet gated to staff-only");
regular users/captains never see the tab and can't reach the route by
hand-editing the URL either, the same protection `#admin` already had.
**Opening this page never starts a draft — only 开始比赛 does.** The
mount effect below resumes a persisted `tournament_draft_state` if one
exists; otherwise it seeds a fresh board **only when 开始比赛 just asked
for it**, via the one-shot `requestDraftStart()`/`consumeDraftStartRequest()`
pair in `tournamentApi.js` (module-level, cleared on read, 30s expiry,
deliberately not re-armed by a page reload). In every other case — 选秀台
tab, direct `#draft` URL, refresh with nothing saved — it sets
`noDraftYet` and renders `EmptyDraftView` ("请先前往「锦标赛大厅」点击
「开始比赛」以开启本次选秀。"), even when the roster already matches
Tournament Settings exactly. **Why this matters (real, reported bug):**
the first `sync_draft_state` write is what creates the
`tournament_draft_state` row, and that row *is* "the draft has started"
system-wide — the Spectator Page renders whatever is saved, and
`App.jsx` yanks every other client to `#spectate` on its `INSERT`
(Section 9). An earlier version auto-seeded whenever the roster
"looked ready", so 创建临时玩家 (which builds exactly the required
roster) followed by staff merely opening 选秀台 started and broadcast a
phantom draft with every captain and player already in the pools. Never
reintroduce a code path that seeds/persists a board without an explicit
start action. When 开始比赛 does start a draft, its roster validation
(mirrored in the mount effect: captains == team count, players == team
count × (players per team − 1)) still applies. `noDraftYet` also keeps
the persistence sync effect below from writing anything, since
`tournament` never leaves its `initialTournament([])` default
(`teams: []`) in that state.

Three stages, in order: **Captain assignment → Teammate draft (snake
order) → Final Matchups.**

### Captain assignment & teammate draft

- Captain Pool / Player Pool are the real joined Tournament
  participants (`fetchLobby()`, split by Team Role / 角色), and team
  count / rounds / roster slots all come from the Lobby's real
  Tournament Settings (`fetchTournamentSettings()`) — both fetched
  fresh **on every page open**, not live-synced while the page stays
  open.
- Click a captain candidate → click an empty team card to assign
  (flying "card slide" animation, Web Animations API). Once every team
  has a captain and the draft order validates, a locked custom
  snake-order teammate draft begins; clicking a pool player commits the
  pick to whichever team is on the clock, same flight animation.
- Full undo stack (`draftHistory`) across both phases; a live team
  strip (`TeamCard`s, one continuous horizontal line, `overflow-x-auto`
  if it doesn't fit — filmstrip pattern, same as FinalMatchupsStage's
  own match-chip strip) sitting directly above whichever pool is
  relevant to the current phase. Same `teamOverviewStrip` JSX both
  phases, declared once — but its *position* differs on purpose:
  **Captain assignment** puts it first, directly above 队长候选池 (team
  cards are literally what you click that phase). **Teammate draft**
  puts the pick-by-pick sequence strip (Draft Order,
  `DraftSequenceStrip`) first instead, 战队总览 second, 待选选手 last —
  confirmed correct against an actual screenshot of the rendered page.
  This one order flip-flopped across several requests in a row before
  landing here — if asked to swap it again, treat it as a real,
  repeatable request and check a fresh screenshot/build rather than
  assuming the code must already be right.
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
- **`visualActiveTeamIdx` vs. `activeTeamIdx` — don't conflate these.**
  `activeTeamIdx` (from `computeDraftMeta`) is derived straight from
  `pickIndex`, which advances to the next team the instant a teammate
  pick commits — same render the flying-card animation *starts*, well
  before it visually lands. Using `activeTeamIdx` directly for "whose
  turn is it" UI (TeamCard's glow, the header's team name, scrolling
  the active team into view) was a real, reported bug: the next team's
  box lit up before the current pick's card had finished flying into
  its slot. `visualActiveTeamIdx` is a separate state that mirrors
  `activeTeamIdx` at all times *except* while a teammate pick's flight
  is still open in `hiddenKeys` (checked by `slot:` key prefix,
  captain-phase `cap:` flights don't gate it — there's no sequential
  "whose turn" during captain assignment) — it only catches up once
  that flight's own `settle()` clears the key. TeamCard's `isActive`,
  the scroll-into-view target, and the header's "队 X 的选人回合"/
  "战队 N" text all read `visualActiveTeamIdx`; `pickPlayer()`,
  `handlePlayerCardClick()`, the snake-order math, and the progress
  ring all still read the real, immediate `activeTeamIdx`/`pickIndex`
  — game logic was never the problem, only the display lagging behind
  it was the fix. Known simplification: rapid multi-click (a second
  pick committed before the first one's flight settles) coalesces —
  the highlight jumps straight to the latest team once every pending
  flight has settled, rather than visiting each intermediate team in
  turn. Not addressed since it wasn't part of what was reported.
- **`readyToProceed` (`allDrafted && hiddenKeys.size === 0`) — 进入最终对阵
  must gate on both, not just `allDrafted`.** Root-caused a real,
  reported bug: `sync_draft_state` 500s, a 404, and an uncaught
  `"Cannot read properties of undefined (reading 'startTime')"`, all
  firing the instant this button was clicked. `allDrafted` flips true
  the instant the *last* pick commits — the same render its flying-card
  animation *starts*, up to ~550–700ms before `runFlight`'s own
  `settle()` actually finishes it. `handleProceed`'s success path flips
  `stage` to `'final'` synchronously (see its own comment,
  DraftArenaPage), which unmounts the entire `<DraftArena>` component —
  including that still-live flight: a raw DOM clone appended straight to
  `document.body` (outside React's tree), a still-running Web Animations
  API `Animation` object, and a pending `settle()` closure reaching back
  into a now-gone component instance. Tearing a WAAPI animation's context
  out from under it mid-flight like that is exactly the class of thing
  that throws a `startTime` TypeError in Chromium. Fix has two parts,
  keep both:
  1. `readyToProceed` on the button itself — the click that unmounts
     `DraftArena` can now only happen once every flight has already
     cleanly finished and called its own `settle()`.
  2. Defense in depth: an unmount effect (`activeFlights` ref, tracking
     every live `{clone, anim}` pair) that cancels and removes any
     flight still running if `DraftArena` unmounts anyway, for any
     *other* reason a future change might introduce. `anim.cancel()` is
     wrapped in try/catch on purpose — cancelling an animation whose
     target already left the document is exactly the kind of call that
     can itself throw inside the browser's own WAAPI implementation.

  The `sync_draft_state` 500s in that same report turned out to be a
  *separate*, more serious issue: confirmed **not** a schema-deployment
  gap (the live project already had the correct 3-argument
  `sync_draft_state`) — the actual error was
  `57014 canceling statement due to statement timeout`, a genuine
  Postgres lock-contention timeout, not a missing function/table.
  `tournament_draft_state`/`tournament_draft_history` are both singleton
  rows (`id = true`) — every write to either takes the same row lock.
  `syncDraftState(...).catch(...)` in the write effect above is
  fire-and-forget, never awaited — so nothing stopped a second write
  from starting before a first one's network round trip finished. The
  200ms window only throttles *when a write starts*, not how many can be
  in flight at once. Several picks landing close together (very
  plausible right at the end of a draft) could queue up overlapping
  writes faster than each cleared, and the queue could compound —
  request 3 waits on request 2 which waits on request 1 — until a
  later request in that pileup genuinely exceeded Postgres's own
  statement_timeout waiting for a lock that was always only milliseconds
  from being released; it just never got the chance to start executing.
  `enter_final_matchups()` (进入最终对阵) deletes these exact same two
  rows, so it queues behind this same lock too, which is why this
  surfaced specifically on that click. Fixed with
  `syncInFlightRef`/`pendingWhileInFlightRef` in the write effect (never
  more than one `sync_draft_state` request in flight — a new write while
  one's already running gets queued, superseding anything already
  queued, and fires the instant the in-flight one finishes) plus
  `flushPendingDraftSync()`, which `handleProceed` awaits before calling
  `enterFinalMatchups()` so that DELETE is never one more request piling
  into the same queue. **If a `57014`/500 on `sync_draft_state`
  resurfaces, suspect this same lock-pileup mechanism before assuming
  schema drift** — the fire-and-forget `sync_draft_state` call's own
  `.catch()` now logs to `console.error` instead of swallowing silently
  (same for every other fire-and-forget fetch in this file and in
  `SpectatorPage.jsx`), specifically so the exact Postgres error text is
  visible in the console next time, rather than only a bare status code
  in the Network tab.
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
  clearance the resting layout already has. `scroll-margin` alone is
  not enough: a scroll offset can't go below 0 or past the end, so the
  *first and last* items of a scroller only ever get the container's own
  padding. The 战队总览 strip (`teamOverviewStrip`) clipped 1号战队's
  left glow/flight-arrival ripple for exactly this reason until the row
  got real padding on all four sides (kept layout-neutral with matching
  negative margins — see the comment there). Pad every side that a glow
  can reach, not only the one that was reported.
- Size sections to their own content (`min-h-0` + `shrink`, optionally
  a `max-h-[...]` cap as a backstop) rather than forcing a fixed
  `flex-basis` proportion — a forced basis either wastes space when
  content is smaller than it, or gets scrolled unnecessarily when
  content plus padding exceeds it.

### Final Matchups ("Broadcast Bracket Reveal")

Reached via 进入最终对阵. **As of the visual redesign pass, this is a
genuine, idiomatic React component** (`FinalMatchupsStage` in
`DraftArena.jsx`) -- the earlier "01 冠军海报版" implementation (a
literal, character-for-character port of an external static HTML/CSS/JS
reference file, rendered via `dangerouslySetInnerHTML` + manual
`querySelector`/`classList`/`innerHTML` DOM building) was fully replaced
at the user's explicit request for a ground-up UI/UX redesign, matching
the rest of the app's shared visual language (AppShell rail+main
composition, `.btn-primary`/`.btn-ghost`/`.btn-danger`, `GlowHeading`,
`Avatar`) instead of a separately-styled gold/Cinzel "movie poster."
**Any future change to this stage should be made the normal React way --
component state, JSX, Tailwind classes -- like every other stage in this
file; there is no more special "edit this like raw DOM-scripting code"
carve-out for it.**

**Light Mode fix (spotlight/BroadcastFrame), by explicit request:** the
spotlight container (the `radial-gradient(...)` div wrapping countdown/
reveal/complete states) and `BroadcastFrame` (the corner-bracketed panel
around a featured VS pair) both used to set `background`/`border` as
literal fixed-dark hex (`#141833`/`#0a0c1c`, `rgba(6,7,15,.35)`) that
never adapted to theme. `TeamFace`'s team-name and CAPTAIN-label text
was already using theme tokens (`text-ink-primary`/`text-ink-faint`),
so in light mode that text correctly went dark -- and then sat on a
container that stayed forced-dark, rendering as dark-on-dark and nearly
invisible (this was the reported bug). Fixed by rebuilding both
backgrounds/borders from `--color-panel`/`--color-void`/`--color-accent`/
`--color-accent2` (same tokens as everywhere else in the app) instead of
literal hex, so the surface is a light panel in light mode and close to
the original dark gradient in dark mode. The reveal flash-burst's
hottest point (previously literal white, which vanishes on a light
panel) now uses `--color-ink-primary` -- this theme's "brightest
legible" tone, white in dark mode, near-black in light mode -- so the
pulse stays a visible, high-contrast burst in both themes rather than a
literal color swap tied to one theme. The four corner brackets keep
their per-caller literal cyan/purple `glowColor` in both themes (still
part of the fixed brand identity below, on request) but pick up a
light-mode-only opacity taper (`.fmp-corner` in `index.css`) so
full-strength neon corners don't read as harsh against a light panel.
None of the `fmpXxx` keyframes (defined in `FMP_ANIM_CSS`, a `<style>`
string local to this component, not `index.css`) needed touching --
they're all pure transform/opacity/blur, no baked-in colors, so they
already worked in both themes.

**Bug fix, by explicit report, follow-up to the Light Mode fix above:**
that pass rebuilt `BroadcastFrame`'s border and the reveal/featured "VS"
text onto theme tokens (`--color-accent`, `text-accent-soft`) instead of
literal fixed-dark hex, which fixed the dark-on-dark case but introduced
a *different* low-contrast bug in both themes, reported later with
screenshots: `--color-accent-soft` is a token meant for subtle
*background* tints (e.g. a highlighted candidate row's fill), not
foreground text -- its dark-mode value (`rgb(46 38 92)`) is a near-black
purple barely lighter than the void background, and its light-mode value
(`rgb(204 251 241)`) is a pale mint that all but vanishes on a light
panel. `BroadcastFrame`'s border had the same shape of problem at a
smaller scale: `--color-accent` at 35% opacity is a visibly thin
hairline in either theme.

Two more explicit-feedback rounds landed on the current state (rather
than that first attempt), each narrower than the last:

- **VS text, round 2:** the border fix's violet-shadow/violet-to-cyan-
  gradient treatment on `VsLabel` was itself superseded, by explicit
  request, before the gradient ever shipped as final -- dark mode is now
  a flat, literal `text-[#40C2F0]` (no gradient), light mode stays
  `text-violet-600`. This also turned out to be an incomplete fix the
  first time: `VsLabel` only covered the two big broadcast-animation "VS"
  instances (reveal phase, featured single match); the *third* "VS" --
  the small label inside each card of the completed Final Lineup list
  (对阵表已揭晓, the `complete && featuredIdx === null` branch; it was a
  `text-[10px]` label then, and is `text-2xl sm:text-3xl` now -- see the
  Final Lineup bullet under "Team details in the spotlight" below) -- was still a bare `text-accent-soft` span and still
  low-contrast, caught in the same round of screenshots. All three now
  render through the one `VsLabel` component (sized via its `className`
  prop) rather than three independent copies -- if a fourth "VS" is ever
  added anywhere in this file, route it through `VsLabel` too instead of
  hand-rolling the color again.
- **`BroadcastFrame`'s border:** reverted back to the original
  `rgb(var(--color-accent) / .35)` theme-token border from the Light
  Mode fix above -- explicitly *not* the slate/shadow treatment this
  section used to describe. Pending specific follow-up feedback on which
  border(s) to actually target; don't reintroduce the slate/shadow
  version speculatively.

Worth remembering generally: a low-contrast theme *token* isn't
automatically safe just because it's theme-aware (Section 3's "surfaces/
text theme, brand glow doesn't" split doesn't by itself catch this) --
`--color-accent-soft` in particular is a background-tint token and stays
wrong for text wherever else it might get reached for.

**Bug fix, by explicit report, the pending border follow-up above
arrived** (historical: `FilmChip` and its "MATCH 0x" strip described
throughout this bullet were removed entirely later on, by explicit
request -- see the Final Matchups section further down. This bullet is
kept as-is for the fix pattern it documents, which still applies to
`DraftAction` and every other component named in it): the specific
target was the top MATCH-card control strip (`FilmChip`) and the bottom
action-bar buttons (`DraftAction`) --
`定角锁定`/`随机生成剩余对阵`/`重置`/`解除本场对阵`/`结束锦标赛`. Both had
the exact same shape of problem as `BroadcastFrame`'s border before its
own Light Mode fix (Section 8, further up): `FilmChip`'s inactive state
was `border-panel-line/35`, `DraftAction` was bare `border-panel-line`
(no opacity suffix, but a similarly thin token color) -- both wash out
in the strip screenshot. Same fix shape as `VsLabel`/`BroadcastFrame`
too: explicit theme-branched Tailwind utilities instead of a theme
token, layered *under* each component's existing interactive states
(`FilmChip`'s `active`/glow highlight; `DraftAction`'s tone-based danger/
default hover colors) rather than replacing them. `FilmChip`'s "MATCH
0x" sublabel moved off `text-ink-faint` the same way, onto
`text-slate-600` (light) / `text-cyan-400` (dark) -- cyan to match the
teal-branded "MATCH XX 生成中"/对阵表已揭晓 labels already using
`text-accent2` nearby, rather than introducing an unrelated hue.
`DraftAction` is also the shared action-button component `DraftArenaPage`
uses for its own captain-selection controls (not just this bottom bar),
so that pass carries there too -- consistent with every other instance
of this class of bug being fixed at the shared component, not the call
site.

**Captain line color (formerly the "CAPTAIN" sublabel):** what used to be
the small caption under the team name in the spotlight is now the "队长"
word of the primary title `队长 · <captain name>` (see "Team details in the
spotlight" below).
Its color rule is unchanged, and the history is why it must not drift: it
was once a near-invisible `text-ink-faint`, was then matched to
`FilmChip`'s "MATCH 0x" sublabel, and -- by explicit request -- was finally
matched strictly to `VsLabel`, the VS text sitting right next to it:
`text-violet-600` (light) / `text-[#40C2F0]` (dark), the exact literal
values `VsLabel` itself uses (Section 8 above, "VS text, round 2"). If
`VsLabel`'s colors ever change, update the 队长 span to match rather than
assuming they're still in sync.

Only the *data/logic* layer was carried over unchanged: `teams`/
`matchups` props (kept live via Realtime), and the same RPC-backed
mutation functions below. The reveal choreography (countdown -> name-
shuffle flicker -> settle) is a new implementation built entirely from
React state (`reveal` = `{idx, phase, n, flickerA, flickerB}`) rather
than manual class-toggling, but keeps the same real-server-data-driven
guarantee described further down.

**Team details in the spotlight (by explicit request; previewed and
confirmed before it was built).** Both spotlight faces -- `TeamFace`, used by
the reveal, the settled/featured view, and the bye view -- show the whole
team, not just the captain. Hierarchy, by explicit request: the **primary
title** is `队长 · <captain name>` (24px, bold; the name in `--ink-primary` --
white in dark mode, not a literal white, which would vanish on the light
panel -- with the 队长 word keeping its VsLabel-matched accent color and a
muted "·" between), and the **subtitle** beneath it is the team name as
`N号战队` (`team.idx + 1`, the same name the draft stage's TeamCards use) in
13px semibold `--ink-muted`. One chip per teammate sits underneath (a small
squircle initial tile in the Avatar's corner ratio, plus the name; max 112px,
ellipsis). The title carries the existing name-slam and the subtitle the
`fmpSubIn` fade. Because the title now holds the captain's name it is the one
element that truncates (with an ellipsis) if a name is very long. **The rail and
filmstrip intentionally still label teams by captain ("谢斌DD 战队")** --
confirmed by the owner, since the captain line ties the two together. If
those are ever relabeled, make it its own change. (The final-lineup list
no longer follows this rule: its cards now use these same faces -- see the
Final Lineup bullet below.)
- **Data.** `toFinalMatchupTeam()` (tournamentApi.js) now also stores
  `members: [{id, name}]` in draft order, taken from the team's `slots`.
  Names only -- initials are all the chips show, so no avatar URLs are
  stored. It is a plain addition to the jsonb snapshot: **no migration**;
  the schema.sql comments describing the snapshot were updated. Snapshots
  taken before this existed have no `members`; those faces render the name
  and captain line with no chip row and no reserved height (never an empty
  gap). Tournaments already at Final Matchups therefore do not get chips
  retroactively -- accepted by the owner; new tournaments do.
- **Layout.** From `xl` (1280px) up the faces sit side by side and the right
  one is an exact mirror: avatar outermost, text right-aligned, chips
  starting at the right edge and flowing inward toward the VS
  (`xl:flex-row-reverse`). Below `xl` they stack and both align left.
  Faces are `max-w-[340px]`. `FaceRow`/`VsSlot` pin the VS to the 72px
  avatar row, so it never shifts when a chip row appears, wraps, or is
  absent. `BroadcastFrame` is `w-full max-w-[980px]`. **The settled
  (featured) wrapper must also be `w-full`:** it is a shrink-to-fit flex
  column, so without it the frame's `w-full` resolved to content width and
  the frame changed width -- and the left team's chips re-wrapped -- at the
  instant the reveal settled. Found and fixed while verifying.
- **Final Lineup list (对阵表已揭晓, `complete && featuredIdx === null`),
  by explicit request.** Each match is now a full-width card built from the
  same `TeamFace`/`FaceRow`/`VsSlot` pieces as the settled view -- captain
  avatar, `队长 · name`, `N号战队`, and the teammate chips for both sides,
  with a `VsLabel` (`text-2xl sm:text-3xl`) between -- instead of the old
  captain-name-only row in a two-column grid. Cards are one per row (two per row from 1900px, see the full-bleed
  entry below) inside a wrapper that's `max-w-[980px]` below `lg` and
  uncapped from `lg` up (was `max-w-2xl`; the faces need the width), with a
  small `01`/`02` index tag in each card's top-left corner. A bye card is
  centered with the `轮空 · 直接晋级` pill, same as the settled bye view. Cards
  are display-only. No
  `animateIn`: the card's own `fmpRowIn` stagger is the entrance, not the
  name-slam/chip cascade. The heading `对阵表已揭晓 · Final Lineup` went from
  `text-[11px]` to `text-2xl sm:text-3xl`, bold, full `accent2`, tracking
  `0.2em` (was `0.3em`, too wide at this size), centered. **Scrolling:** the
  cards are taller than the old rows, so in this view the spotlight box is
  `overflow-y-auto` + `items-start` (its inner wrapper uses `my-auto`, which
  centers when short and scrolls when tall -- plain `items-center` would clip
  the top of an overflowing list unreachably) instead of the usual
  `overflow-hidden items-center`. Spectators get this automatically (same
  component).
- **Corner brackets on the Final Lineup grid cards: added, then reverted,
  both by explicit request.** They were added first (reference: the
  single-match spotlight's own HUD-frame accent, `BroadcastFrame`'s glowing
  cyan corners, which the completed grid's cards didn't have), by factoring
  the four `<span>`s out of `BroadcastFrame` into a standalone
  `CornerBrackets` component (`glowColor`, `size` props) and calling it from
  each grid card too. A follow-up request asked for a plain, clean border on
  these cards again, with no corner accent -- **the grid cards' own
  `<CornerBrackets>` call is removed**, leaving them with just their
  original `border border-panel-line/35`. `CornerBrackets` itself, and
  `BroadcastFrame`'s own use of it, are untouched by this revert: the
  single-match spotlight (both the flicker/reveal phase, via `RevealDuel`,
  and the settled single-match view before the lineup completes) still
  shows its glowing corners exactly as it always has -- verified against
  real components (stubbed data layer): 4 `.fmp-corner` elements render
  during a real match's flicker/reveal and its settled pre-completion view,
  and 0 render anywhere in the completed 对阵表已揭晓 grid. If corner accents
  come back for the grid a third time, reuse `CornerBrackets` again rather
  than re-inlining the four spans -- it still exists for exactly this.
  **Teammate tags now fit 4 per row, by explicit request** (they wrapped
  after 3 on a typical team in the grid's two-per-row layout, where a
  face's chip row is only ~305-312px wide -- the tightest a chip row gets
  anywhere in this file; the roomy single-match spotlight already fit 4
  before this, since it has far more width per face). Reused
  `TeammateChip` everywhere (the grid cards, the spotlight, and the reveal
  cascade), so tightening it changes all three at once, on purpose --
  they're meant to be the same component. Changed: `CHIP_GAP` 6px -> 5px;
  the chip's own `gap-1.5`/`pr-2.5` -> `gap-1`/`pr-2`; its avatar-initial
  badge `w-5 h-5` (20px) -> `w-[18px] h-[18px]`; its `max-w-[112px]` cap ->
  a new `CHIP_MAX_W` constant, 96px (still just a safety cap against
  unusually long member names -- typical 2-4 character names sit well
  under it and are never truncated). `TeamFace`'s reserved-height math
  (`rows`, just above) moved off a bare `/ 3` onto a new `CHIPS_PER_ROW = 4`
  constant so the two stay in sync if either changes again. This part is
  unaffected by the corner-brackets revert above -- it stayed in the same
  request that also reverted the corners, but is a separate, still-current
  change. Verified against real components (stubbed data layer) with this
  conversation's own sample rosters, including a name long enough to hit
  the truncation cap: at 1920px wide (`min-[1900px]:grid-cols-2` active,
  ~305px per face) and at 1280px (one column, ~340px per face), every
  face with 4 members renders on exactly one row, on every card including
  the bye card; at 700px wide the stacked mobile layout is unaffected.
  **Known limit, not a bug:** if every one of a team's 4 members has an
  unusually long name (5+ CJK characters each, all four at once), the row
  can still wrap to a second row in the narrower two-per-row grid layout --
  an inherent width limit at that combination, not something either of
  these two changes
  broke. `CHIP_ROW_H`'s reservation still accounts for that correctly, via
  the same `ceil()` math, now against 4 instead of 3.
- **No "MATCH 01/02/..." filmstrip and no "← 返回完整对阵表" link, in ANY
  state, by explicit request.** `FilmChip` and its render block are gone
  entirely (not just hidden once the lineup completes -- an intermediate
  version only did that, then still showed the strip while a lineup was
  being built; a follow-up request explicitly called that out and this
  removed it from every state). The back link was already removed earlier
  and stays gone. The whole completed-view gate is still one flag,
  `lineupView = complete && featuredIdx === null` (drives the spotlight's
  scroll mode and the Final Lineup list branch); `featuredIdx` itself now
  only ever tracks which match the build-in-progress spotlight is showing
  (set by `runReveal`, or by the sync effect after a remove/reset), never
  something a person clicks.
  **Removing a matchup moved onto the 参赛战队 rail instead, in every
  state (build in progress or complete), not just where the strip used to
  cover:** each roster row's own `status` (`idle`/`used`/`bye`) already
  said whether that team is in a matchup; a `matchOfTeam` map (`idx -> that
  team's match index`, built from `displayMatches`, alongside
  `usedIdxs`/`byeIdxs`) is what a click needs to know *which* one. For
  staff, a `used` or `bye` row is itself a button. Clicking **either** team
  of a pair, or a bye row, no longer removes immediately, by a direct
  follow-up request: **it opens a confirm dialog first** --
  `requestRemoveMatch(matchOfTeam.get(team.idx))` reads that match's two
  team names off `displayMatches`/`teamByIdx` right then, stores the actual
  removal as `pendingActionRef.current.remove`, and sets `confirmRemoveIdx`;
  a `<ConfirmDialog>` (same shared component and idiom as 重置/结束锦标赛,
  further down) shows a tailored message -- both team names for a pair,
  one for a bye -- and only on "确认解除" does `onConfirm` call
  `pendingActionRef.current.remove()`, which runs `handleRemoveMatch(idx)`,
  a generalized version of the old `handleRemove` that takes an explicit
  match index instead of implicitly reading `featuredIdx`. Cancelling
  clears `confirmRemoveIdx` and removes nothing. **`RosterRow`'s own visual
  is back to the plain status dot** (a short-lived intermediate version
  swapped it for an `x` icon plus a danger-tinted row hover as a
  click-to-remove affordance; that's reverted, by explicit request -- the
  dot is unconditional again, same as every status before this feature
  existed, and gives no visual hint a matched row is clickable beyond the
  cursor and hover background it already had). The dialog itself is now
  what carries that signal, and is the only thing standing between a click
  and an actual removal. Guarded the same way as before request: `reveal`
  blocks *opening* the dialog (so a stale index can't be queued mid-roll);
  the dialog's own `busy={busyAction === \`remove:${confirmRemoveIdx}\`}`
  disables its confirm button while the request is in flight, so it can't
  be double-fired. `idle` rows are unaffected -- still plain pool-selection
  clicks for 定角锁定/随机生成剩余对阵, never a remove target. The rail's
  对阵操作 list stays at four buttons (解除本场对阵 is still gone from
  there, unchanged from before this request -- only *how* the per-row
  click behaves changed, not that it moved out of that list).
  **Consequence to know about, unchanged from before this request:**
  removal isn't disabled once the lineup completes -- since it doesn't
  depend on a "featured" selection, staff can remove a match from a
  *completed* 对阵表已揭晓 view too, directly from the rail. If that's
  unwanted, gate the rail's `onClick` on `!lineupView` as well.
  Verified against real components (stubbed data layer, not the live
  Supabase backend): the dot renders (no `x` anywhere in the file);
  clicking a matched team opens the dialog and calls
  `removeTournamentMatchup` zero times until confirmed; the dialog's
  message names both teams for a pair (`将解除「A 战队」与「B 战队」的对阵...`)
  or the one team for a bye; Cancel closes the dialog with zero removal
  calls; Confirm removes exactly the clicked pair's match index.
- **Layout stability.** The chip row reserves `ceil(members / CHIPS_PER_ROW)`
  rows (28px rows, `CHIP_GAP` gaps -- both constants, alongside `CHIP_MAX_W`,
  live next to `CHIPS_PER_ROW` itself; see the corner-brackets/4-per-row
  bullet further down for their current values and why). While the teams
  are rolling (`hideChips`) the row keeps that reserved height but draws
  nothing -- by explicit request, since dashed placeholder pills looked
  noisy mid-shuffle. Do not remove the empty row itself: it is what keeps
  the frame's layout height identical across flicker, reveal, and settled
  (measured 218px in all three at the time this was written, before the
  chip-tightening pass below changed `CHIP_ROW_H`'s inputs -- re-measure if
  this number matters again, since a fixed row height with a smaller
  chip footprint isn't guaranteed to land on the same total). Team size is
  configurable up to 20 players, so the row simply wraps and grows; every
  team in a tournament is the same size, so height is also constant from
  match to match. Frame bottom padding is trimmed to 26px when a chip row
  exists so the reserved space doesn't read as bottom-heavy.
- **Reveal.** All the reveal's animations are unchanged (timings: see the
  next bullet). Added:
  `fmpSubIn` (subtitle fades in, .2s delay) and `fmpChipIn` (chips
  cascade from 320ms, 60ms apart, from the outer edge inward; the last ends
  around 820ms, inside the reveal window). During the flicker only the title
  and subtitle shuffle; the chip row is blank (names are not shuffled at
  110ms). The
  reduced-motion rule now also zeroes `animation-delay`, otherwise chips
  would sit invisible for up to half a second.
- **Reveal timing (by explicit request).** The constants sit next to
  `fmpWait` in DraftArena.jsx and `runReveal` reads them. Per matchup:
  countdown 3-2-1 (`FMP_COUNT_STEP_MS`, 600ms each) -> **team rolling,
  `FMP_ROLL_MS` = 2000ms** -> reveal (`FMP_REVEAL_MS`) -> **hold,
  `FMP_REVEAL_HOLD_MS`** on the finished result -> the next matchup.
  (`FMP_REVEAL_MS`/`FMP_REVEAL_HOLD_MS` were originally 1100ms/1000ms; a
  later request retimed them to total exactly 1000ms combined -- see the
  dedicated timing-pass bullet further down for the current split and why.
  `FMP_HOLD_MS`, 1000ms, still exists separately and is now the *bye's*
  own hold only, not the real-match one -- also covered in that later
  bullet.) The rolling used to be 8 frames (~880ms). It still plays in
  frames of `FMP_ROLL_FRAME_MS` = 110ms (the original shuffle cadence)
  with the last frame absorbing the remainder, so the phase is exactly
  2000ms rather than 1980. **The hold is spent inside the reveal phase,
  not the settled view:** switching to the settled view would replay that
  view's own scale-in animation, and the result would visibly pop a
  second time. Every reveal animation has finished by about 1s, so during
  the hold the frame is fully still (verified: no running animations).
  **This assumption turned out to be incomplete, not wrong:** it correctly
  avoided a pop *during* the hold, but didn't anticipate that the
  *unavoidable* switch to the settled "featured" view immediately *after*
  the hold ends would replay that view's own separate entrance animation
  for the same match -- a real, later-reported bug, fixed by
  `skipFeaturedPopRef`; see its own bullet further down. **Updated, by
  explicit report: the hold now also applies after the LAST matchup of a
  roll**, not just the ones in between -- it used to be skipped there
  ("nothing follows it"), but the owner wanted the final rolled result
  held for the same 1s as every other one before the stage moves on to
  its plain settled view. A random roll of N matchups took about N x 5.9s
  at the time this was written (4 matchups was roughly 23.6s); the later
  timing pass below shortened this considerably. The roll buttons stay
  locked for the whole roll (`busyAction`/`revealingRef`, unchanged).
  Spectators replay through the same `runReveal`, so they get the same
  timing. Known, pre-existing limitation, now a wider window: the live-sync
  effect skips updates while a reveal is playing (`revealingRef`) and only
  re-runs when `matchups`/`teams` next change, so a *different* admin's
  change landing mid-reveal is not re-applied until the next update.
- **Bye matches skip the roll animation entirely, by explicit request**
  (an odd-sized pool -- 3 teams is the example that was reported -- used to
  play the full countdown-3-2-1 / team-rolling flicker / reveal show for
  the one team left with no opponent, which reads as fake suspense: a bye
  is never a random outcome, so there was nothing to actually roll). A bye
  is unambiguous: `m.b == null` on an appended match, which only ever
  happens for a genuine bye (`createManualMatchup` always takes two
  selected teams; a bye only ever comes out of
  `rollTournamentMatchupsPool` on an odd-sized pool) -- so `runReveal`
  checks that per matchup and, for a bye, skips straight past the
  countdown/flicker/reveal block: `reveal` stays `null` for that whole
  step (so nothing new draws over whatever the previous matchup left on
  screen), waits **`FMP_BYE_DELAY_MS` = 1000ms** (next to the other timing
  constants), then commits that matchup's data and `featuredIdx` together
  (same React-18 auto-batched update, so there's never a frame where
  `featuredIdx` points at an index `displayMatches` doesn't have yet) and
  holds for the same `FMP_HOLD_MS` as every other matchup before moving
  on. The ordinary settled-view render path -- unchanged, the same one a
  real match's reveal always lands on -- draws the 轮空 · 直接晋级 state
  immediately, since there's no reveal state left to render anything else.
  A pool of exactly one team behaves the same way (a lone bye with no
  preceding pair in that roll). Verified against a real component (stubbed
  data layer) on a 3-team pool ([{a,b} pair, {a,null} bye] returned from
  one roll call): the countdown digits (3/2/1) appear exactly once across
  the whole sequence, never a second time for the bye; the bye's own
  `轮空`/`直接晋级` text appears roughly `FMP_BYE_DELAY_MS` after the paired
  match's hold ends, with no flicker in between.
- **A follow-up "terminal bye" fix was tried, then fully reverted, both by
  explicit request.** It changed the bye branch above to special-case a
  bye that happens to be the last team placed (jumping `featuredIdx`
  straight to `null` instead of the bye's own index, to avoid a suspected
  double-display), on the theory that the real double-render the owner
  was reporting was specific to a *terminal bye*. A follow-up report
  clarified the actual sequence: the double flash happened on the
  **first, real (non-bye) match** of that same 3-team example ("Ok林仔 VS
  黄翔LongDD"), not the bye at all, and the terminal-bye special case
  wasn't the fix for it -- so it was reverted in full, back to the
  simpler form described just above (bye branch always spotlights the bye
  at its own `idx`, exactly like a real match, with the ordinary
  post-loop `computeComplete` check deciding the hand-off to the grid).
  The bullet directly below this one is the fix for the real, reported
  bug.
- **The real bug, and its fix: a real match's own settled result flashed
  a second time, briefly, right after its normal reveal -- by explicit
  report.** Sequence: a real match's reveal (`RevealDuel`, phase
  `"reveal"`) plays its own entrance (`fmpNameSlam`/`fmpVsPop`/chip
  cascade) and holds for `FMP_REVEAL_HOLD_MS`, all correct and exactly once.
  Immediately after, `runReveal` calls `setReveal(null)`, which switches
  the render from `RevealDuel` to the separate "featured" branch further
  down (`featured ? <div key={featuredIdx} style={{ animation:
  "fmpSlamIn .5s ease forwards" }}>...` ) -- a *different* element at a
  different position in the tree, so React unmounts `RevealDuel` and
  mounts this one fresh, playing its own `fmpSlamIn` entrance for the
  exact same match that had just finished settling a moment ago. That's
  the second flash: shorter than the first (`fmpSlamIn` is .5s vs. the
  reveal's own ~1s total dwell), and it happens for every real match, not
  just a bye. **Fix:** a new `skipFeaturedPopRef` (next to `revealingRef`
  and the other coordination refs already in this component) records
  "the match about to appear in the featured branch was *just* animated
  in by RevealDuel a moment ago, so don't replay its entrance." Set to
  `true` right before the real-match branch's own `setReveal(null)`;
  read once (`skipFeaturedPop = skipFeaturedPopRef.current`) at the top
  of the component's render to decide whether the featured branch's
  outer `<div>` gets the `fmpSlamIn` style at all this render; and reset
  back to `false` in a `useLayoutEffect` with no dependency array (runs
  after every commit) -- deliberately *not* reset inline during render,
  because this component renders inside `<React.StrictMode>`
  (`main.jsx`), which double-invokes render bodies in development; an
  inline read-and-reset would get consumed by the throwaway first pass,
  leaving the real, committed render with the flag already cleared and
  the bug looking unfixed in dev. A bye's own entrance into the featured
  branch never sets this flag (it has no preceding `RevealDuel` animation
  to have already played), so a bye's own `fmpSlamIn` -- and the initial
  `fmpSlamIn` when the live-sync effect mounts straight into a featured
  match with no local reveal at all (e.g. a spectator's first paint, or
  another admin's change arriving via Realtime) -- are both untouched and
  still play normally; only the one redundant replay, immediately
  following this component's own local reveal for the same match, is
  suppressed. Verified against a real component (stubbed data layer) by
  listening for the browser's own `animationstart` events with
  timestamps across an entire 3-team roll (one real pair, then a bye):
  **without** this fix, `fmpSlamIn` fires twice before the completed grid
  appears -- once ~1.7s after the real match's reveal animation (the bug)
  and once for the bye's own legitimate entrance; **with** the fix, it
  fires only once (the bye's), confirming the redundant one is gone and
  the legitimate ones are untouched.
- **Real match reveal shortened to exactly 1000ms total on-screen dwell,
  by explicit report ("staying on screen too long, longer than 1
  second").** Previously `FMP_REVEAL_MS` (1100ms, the settle/entrance
  animation) + `FMP_HOLD_MS` (1000ms, the still pause after it) totalled
  2100ms from when a real match's result first settles to when it moves
  on -- noticeably sluggish once the double-pop bug above was already
  fixed and this became the next-most-visible thing. Split into two
  constants that no longer share one name/value:
  **`FMP_REVEAL_MS` = 900ms, `FMP_REVEAL_HOLD_MS` = 100ms**, summing to
  exactly 1000ms as requested. `FMP_REVEAL_MS` couldn't just be scaled
  down proportionally (900:1000 -- roughly half the original 1100:2100
  ratio -- would have cut a typical 4-member team's own `fmpChipIn`
  cascade off mid-animation, which finishes around 820ms into the reveal;
  see that bullet's own comment above): 900ms was chosen specifically to
  clear that with a real, verified margin, not scaled from the old ratio.
  **`FMP_HOLD_MS` (1000ms) still exists, but is now the *bye's own* hold
  only** (`FMP_BYE_DELAY_MS` then `FMP_HOLD_MS`, unchanged, ~2000ms
  total) -- deliberately kept as a separate constant from
  `FMP_REVEAL_HOLD_MS` rather than reusing one shared "hold" for both, so
  that retiming the real match's dwell (this request) can never silently
  retime the bye's dwell too (which wasn't reported as a problem and
  wasn't touched). Verified against a real component (stubbed data
  layer, 3-team pool, a 4-member roster to exercise the fullest realistic
  chip cascade) via `animationstart`/`animationend` timestamps: the last
  `fmpChipIn` instance ends about 670ms into the reveal, comfortably
  inside the new 900ms `FMP_REVEAL_MS` window (roughly 230ms of margin);
  no extra `fmpSlamIn` fires between the reveal's own entrance and the
  next legitimate one (the bye's), confirming the skipFeaturedPopRef fix
  above still holds at the new timing; and the gap from reveal-start to
  the bye's own entrance is consistent with exactly 1000ms of real-match
  dwell followed by the bye's own untouched ~2000ms pacing.
- **Results no longer bypass the reveal on a remount, by explicit
  report.** App.jsx mounts `DraftArena`/`SpectatorPage` (and so
  `FinalMatchupsStage`) conditionally by `route` (`isDraft`/`isSpectate`),
  so navigating this tab away (e.g. to 锦标赛大厅) and back is a genuine
  unmount + remount, not just a re-render -- React component state and
  refs do not survive that. `FinalMatchupsStage` used to derive its
  initial `displayMatches`/`featuredIdx` straight from the current
  `matchups` prop on every mount, which is correct for a truly fresh page
  load, but wrong for a remount: the roll's RPC already writes the full,
  final result the instant it resolves (the whole point of `runReveal` is
  to reveal that already-known result gradually), so remounting mid-roll
  showed the finished matchups instantly, with the countdown/roll/reveal
  entirely skipped -- exactly what was reported.
  - **Fix: `fmpRevealWatermark`,** a module-scope (not component-state)
    counter of how many of this tournament's matchups THIS browser page
    has genuinely watched `runReveal` play through. Module scope
    specifically because it must survive the unmount/remount above; a
    hard page reload resetting it is fine, since there is no in-flight
    reveal left to protect at that point.
  - **Bootstrapping.** `null` means "never set this page load" -- true
    only on this stage's very first-ever mount since the page loaded.
    Whatever matchups already exist right then predate this viewing
    session entirely (there is no reveal being skipped, so nothing needs
    protecting) and become the trusted baseline, exactly as before this
    fix. Every later mount trusts what the mount before it left behind
    instead of re-trusting the live prop, which is exactly the bug.
    Clamped down to the current matchup count on every mount too, so a
    reset/new tournament (genuinely shorter than the last thing watched)
    can't leave a stale, too-high watermark behind.
  - **Where it advances.** `runReveal` bumps it right after each
    matchup's own `FMP_REVEAL_MS` wait completes -- that specific
    matchup's reveal has genuinely played, so it's now safe to show
    instantly on any future remount, hold included: the hold only delays
    the transition to the *next* matchup (or to settled), it is not part
    of protecting *this* matchup's own result.
  - **What actually changes on mount:** `displayMatches`/`featuredIdx`
    seed from `initialMatches.slice(0, watermark)` instead of the full
    prop. The existing live-sync effect already treats "prop has more
    matches than currently displayed" as "a roll happened, replay it via
    `runReveal`" (added for the Realtime multi-admin case) -- it needed no
    changes at all: seeding from the watermark instead of the full prop is
    what makes it fire correctly on a remount, since the effect can no
    longer see the un-revealed tail as already displayed.
  - **What a remount looks like now, at every point in a roll:** mid
    countdown/rolling -> that matchup restarts its full countdown-roll-
    reveal-hold sequence from the beginning (not an exact resume of the
    interrupted frame, which is both simpler and, on reflection, no worse
    a user experience -- either way the whole sequence plays before the
    result is shown); already-revealed matchups earlier in the same roll
    -> shown instantly, not replayed a second time; everything already
    fully settled before this page's first mount, or before this browser
    session started -> shown instantly, as it always has been. Verified
    on the real component: forcing a remount mid-countdown, mid-roll of
    the *last* matchup in a batch, and after full completion all produced
    the behavior above.
  - Spectators get this automatically (same component, same module).
  - **Follow-up bug, by explicit report: 重置 then a new roll, switching
    tabs mid-animation, instantly exposed the second roll's results too.**
    Cause: `fmpRevealWatermark` was only ever clamped down once, at mount
    time, against that mount's own frozen `initialMatches` snapshot. If
    重置 happened while the SAME instance stayed mounted (the normal case
    -- an admin clicking 重置 then 随机生成剩余对阵 again without ever
    navigating away), nothing clamped the watermark down at that point, so
    it kept sitting at whatever count the FIRST, already-completed roll
    had left behind. Once the second roll's own matches started resolving
    live, a remount mid-way through it clamped the stale watermark against
    the *second* roll's already-current length -- which by then could
    already meet or exceed the old stale number -- and wrongly inherited
    the first roll's trust onto matchups that had never actually been
    watched.
    **Fix:** the live-sync effect's "did not grow" branch (already the
    one place that already directly handles 重置's shrink to the eye,
    and any single 解除本场对阵 removal) now also clamps
    `fmpRevealWatermark` down to the *live* `newMatches.length` right
    there, the moment the shrink is observed -- not just once, later, at
    whatever mount happens to come next. A 重置 (shrink to 0) now zeroes
    it out immediately, and a later remount mid a fresh roll can no longer
    find a stale, too-high number to wrongly trust. A partial removal is
    covered the same way and for the same reason: a different matchup
    later filling that freed slot must still play its own full reveal, not
    inherit the removed one's trust.
    Verified directly on the real component, with a negative control: a
    roll that fully settles, then 重置, then a second (differently-paired)
    roll, with a forced remount mid the second roll's flicker -- before
    this fix the remount showed the second roll's final result instantly;
    after it, the remount correctly restarted that matchup's countdown
    instead. All of the earlier watermark scenarios above were re-verified
    unaffected.
- **Chip border -- reverted, by explicit request.**
 The chips use
  `1px solid rgb(var(--color-panel-line) / .55)` on `--color-panel-alt` at
  .7: the styling that was originally previewed and approved. A stronger
  `rgb(var(--color-ink-muted) / .6)` outline was tried once, on a report that
  the border was hard to see, and was then rolled back at the owner's
  request. If visibility comes up again, ask before changing it; this has
  now gone back and forth once.
- The Spectator Page gets all of this automatically (same component, same
  snapshot row).

- **参赛战队 rail redesigned to Admin/Lobby's own `<aside>` anatomy, by
  explicit request.** Previewed as a live, clickable Today-vs-Redesign
  mockup before any code changed, with two open questions -- rail width
  and the selected-team treatment -- each flagged with a recommended
  option; both were approved as recommended.
  - **`RosterRow`:** was a bordered card (`border border-panel-line/35`)
    with a glowing circular avatar. Now borderless, state shown by
    background color only, matching `AdminDashboard.jsx`'s/
    `TournamentLobby.jsx`'s own sidebar rows (`RailAction`, the nav
    tabs) exactly: idle is plain muted text, used is a soft accent2
    tint with a small dot (no border anywhere), and **selected
    (`定角锁定`'s two-team pick) is a solid `bg-accent-gradient` fill**
    with void-colored text -- the same fill Admin's own active nav tab
    uses -- replacing the old accent-bordered glow-ring outline. 轮空
    keeps its small tag, recolored so it stays legible on top of either
    the flat or the solid-gradient background. `Avatar` itself needed no
    change -- it was already a proportionally-rounded squircle, not a
    true circle as the old bordered card made it look; only the row
    around it changed.
  - **Rail width: 216px of usable content, matching Lobby's own aside**
    (was a one-off 280px; declared as `lg:w-[240px]` with `lg:pr-6`,
    see the full-bleed pass below and Section 3). Team names already
    truncated with an ellipsis before this change; they now do so a
    little sooner.
  - **No 概览 stat block.** The rail is the 参赛战队 roster list plus, for
    staff, the 对阵操作 buttons -- nothing below them. An earlier version
    carried a 概览 tile row (战队/已配对/待定 counts) under the buttons;
    it was removed by explicit request, along with this file's own
    `RailStat` copy and the `users`/`check`/`clock` `DraftIcon` entries
    that existed only for it. Admin Dashboard's 概览 and Tournament
    Lobby's 实时统计 are separate and unaffected. Spectators see the same
    change automatically (same component).
  - Verified on the real component, both themes: the rail measured
    exactly 220px at the time (216px of usable content now that its
    right spacing lives on the aside, see the full-bleed pass below);
    clicking an idle row renders the real
    `linear-gradient(135deg, #7C5CFF, #22E5FF)` fill with void text
    color; a bye row's tag stays legible; the admin action bar
    (定角锁定 etc.) still operates correctly against the redesigned
    rows; the layout still stacks correctly and stays overflow-free at
    narrow widths. Everything to the right of the rail -- the spotlight,
    reveal, and match list -- is untouched; this was a rail-only change.
  - Spectators get this automatically too (same component).

- **Top status strip removed and 对阵操作 relocated into the rail, both
  by explicit request, continuing the same Admin/Lobby-match direction as
  the rail redesign just above.**
  - **Status strip (对阵抽签/对阵已就绪 badge + the "MATCH 0x" / 等待生成
    首个对阵 / 全部对阵已生成 heading) is gone entirely**, not moved --
    neither Admin Dashboard nor Tournament Lobby has a header bar above
    their own `<aside>`/main split, so removing it (rather than
    relocating its text somewhere) is the literal match. Both pieces of
    information it carried stay findable elsewhere: which match is
    showing is still the highlighted `FilmChip` in the strip under the
    spotlight, and "a reveal is in progress" is directly visible in the
    spotlight itself (it's already showing the countdown/roll/reveal).
    `complete`/`reveal`/`featuredIdx` are all still read elsewhere in the
    component (the spotlight's own "对阵表已揭晓" copy, the rail, etc.) --
    only this one usage went away.
  - **All five action buttons (定角锁定, 随机生成剩余对阵, 重置, 解除
    本场对阵, 结束锦标赛) moved from a horizontal bar under the spotlight
    into the rail, directly below the team list** **-- "all", not just the four named in the request; 结束
    锦标赛 is the fifth member of the same action group and leaving it
    alone in the old spot while everything else moved would have read as
    broken, not as a deliberate choice.** Same handlers, same `disabled`
    logic, same `isStaff` gate -- verified on the real component:
    `定角锁定` is disabled with 0 selected and enables at exactly 2, the
    status line below the buttons still updates to "已选择 N 支战队" /
    "未选择 · 将随机排位剩余 N 支战队" (now hidden entirely when there is
    nothing to say, since the old `ml-auto` right-alignment trick it used
    doesn't mean anything in a vertical rail and an empty line is worse
    than no line there), and no buttons were left behind outside the rail.
  - **New button style, `FmpRailAction`, not a change to the shared
    `DraftAction`.** `DraftAction`'s own header comment already says it's
    supposed to be "a verbatim copy of TournamentLobby.jsx's RailAction",
    but `RailAction` was restyled borderless since then (its own entry
    above) and `DraftAction` was never updated to match -- pre-existing
    drift, not introduced here. Relocating these five buttons as-is,
    still bordered, directly under the now-borderless `RosterRow`
    rows would have visibly clashed and undercut the entire
    point of this rail redesign. `DraftAction` is also still used by the
    Draft Captain/Player header's own 撤销 button elsewhere in this file
    -- a different stage this request never named -- so instead of
    changing it (and silently restyling that unrelated button too), a
    new component, `FmpRailAction`, was added that matches `RailAction`'s
    *current* borderless styling exactly, scoped to only these five
    calls. Same per-file-duplication precedent as `RoleBadge`/
    `RailStat`/`RailAction` elsewhere in this doc.

- **Sidebar bug fix, by explicit report: this rail's usable width was
  genuinely narrower than Admin/Lobby's own, despite an identical
  `lg:w-[220px]` on the `<aside>` itself.** Cause: Lobby puts its page-
  level spacing (`gap-5 p-4 sm:p-5 lg:p-6`) on the *wrapper outside* its
  `<aside>`, so the full 220px is available inside it; this rail instead
  put spacing (`px-4 sm:px-5 lg:px-4 py-4`) directly *on* the `<aside>`,
  which -- border-box -- is subtracted from that same 220px, leaving
  roughly 188px of actual content width. Same declared number, visibly
  smaller sidebar. Fix: moved the spacing to the wrapper div, exactly
  where Lobby keeps it (`gap-5 p-4 sm:p-5 lg:p-6 overflow-y-auto` added
  there), and stripped the `<aside>` down to `lg:pr-1`, matching Lobby's
  own `<aside>` exactly, char for char. The main content div's own
  padding/border (`px-5 sm:px-6 py-4`, `lg:border-l`) is untouched --
  out of scope for a sidebar-width report, and analogous to how Lobby's
  own main section layers its header's padding on top of the same outer
  wrapper spacing. Verified by rendering both sidebars' real markup side
  by side against the app's own compiled CSS: identical 220px width,
  identical 24px inset from the page edge on all sides, pixel-aligned in
  a screenshot. All of the previous two entries' own checks (button
  wiring, disabled states, both themes, narrow-width stacking) were
  re-run afterward and still pass.

- **Full-bleed spotlight column, by explicit request** (see the Browser
  Layout Standard rule in Section 3 for the shared rule). The wrapper
  above has no vertical padding, no right padding and no gap from `lg` up
  (`lg:pl-6 lg:pr-0 lg:py-0 lg:gap-0`); the rail's old spacing moved onto
  the `<aside>` (`lg:py-6`, `lg:pr-6`, width 220 -> 240, so its usable
  content stays 216px), which supersedes the "wrapper carries all the
  spacing" wording of the sidebar bug-fix entry above for everything except
  the left inset. The right-hand column is `lg:px-0 lg:py-0 lg:gap-0` and
  keeps its `lg:border-l` as the seam against the rail; the spotlight box
  is `rounded-none lg:border-0` (square at every breakpoint), so it runs edge to edge (its
  complete/not-complete border tint no longer shows from `lg` up -- the
  background gradient still carries the brand color). **While a lineup is
  being built, the filmstrip is attached under the spotlight** as a bottom
  bar (`lg:py-3 lg:px-6 lg:border-t`, no gap; the `px-6` is its own inset
  now that the column has none) so it, not the spotlight, is what touches
  the page bottom; in the completed 对阵表已揭晓 view there's no strip, so
  the spotlight itself does, and its content scrolls inside it
  (`overflow-y-auto`, see the Final Lineup bullet). **Final Lineup uses the
  width:** the lineup wrapper drops its `max-w-[980px]` cap from `lg` up,
  the spotlight's side padding tightens to `lg:px-6` in that view, and from
  `min-[1900px]` (the 1920x1080 design target) the cards go **two per row**
  (`grid-cols-2`, card padding `px-6`), with a lone last card spanning both
  columns (`[&:nth-child(odd):last-child]:col-span-2`) so an odd match count
  doesn't leave a hole. The 1900px threshold is deliberate: below it, two
  cards per row squeeze each face's title (`队长 · name`) into truncation,
  so 1280-1899px stays one card per row, just wider. The Spectator Page
  picks all of this up automatically (same component). Verified in a real
  browser against the compiled CSS at 1920x953, 1600, 1440 and 1280 wide
  (both themes at 1440): card left edge at 264px and right edge == viewport
  width on all three pages; rail content position/width unchanged; at 1920
  two columns with the long-name pairs (`队长 · 黄翔LongDD`,
  `刘嘉俊Sylor1`) not truncated; and unchanged rounded/stacked behavior at
  700px.

- **Scrollbar width bug fix, by explicit report, plus a requested visual
  audit of the rest of the Final Matchups stage against Admin/Lobby.**
  - **Scrollbar: the second half of an old bug, only half-fixed before.**
    `GlobalStyle` (mounted around the whole Draft Arena page, including
    this rail, and reused as-is by Spectator Page) used to carry its own
    `::-webkit-scrollbar-track` rule, a literal near-black that never
    followed the theme; that was removed once already (this doc's own
    earlier entry on it, still accurate as a record). What that entry
    didn't catch: `GlobalStyle` *also* carried its own
    `::-webkit-scrollbar { width: 6px }` / `::-webkit-scrollbar-thumb`
    pair, deliberately narrower than index.css's site-wide 8px rule --
    "Draft Arena's own thinner scrollbar," kept on purpose at the time.
    Same root mistake as the track-color bug: this `<style>` tag mounts
    later than index.css, so anything it re-declares silently wins for
    the same selector, everywhere the component is mounted. That's
    exactly what made this rail's scrollbar narrower than Tournament
    Lobby's own. Fixed the same way as the track color: removed rather
    than re-declared, so there is exactly one `::-webkit-scrollbar` rule
    for the whole app again. Verified directly against the CSSOM after
    mounting (not just a screenshot, since headless Chromium doesn't
    always paint custom scrollbars the same as a full browser): exactly
    one `::-webkit-scrollbar`/`-track`/`-thumb` rule set exists anywhere
    in the document once `GlobalStyle` is mounted, and it is index.css's
    8px one.
  - **Audit: everything else in this stage's own scope was already
    token-based and consistent with Admin/Lobby** -- `BroadcastFrame`,
    `TeamFace`, `TeammateChip`, `VsLabel`, `RosterRow`,
    `FmpRailAction` all already read colors from the same `--color-*`
    tokens Admin/Lobby use (checked by reading each one's source, not by
    eye). **One real exception found and fixed: `FilmChip`'s inactive
    state** was still hardcoded to literal Tailwind default swatches
    (`border-slate-300`, `bg-white/80`, `dark:text-cyan-400`, etc.)
    instead of this app's own tokens -- the one place left in this stage
    that wasn't, everything else having already been brought over during
    the rail redesign above. Its *active* state was already correct
    (`border-accent2 shadow-accent-glow bg-accent2/10`), which is what
    made the mismatch visible on close reading. Replaced with
    `border-panel-line bg-panel-alt/60 hover:border-accent2/40
    hover:bg-panel-alt` and `text-ink-muted` for the label -- same idle/
    hover states, now genuinely following the theme instead of
    coincidentally resembling it. Verified on the real component in both
    themes by reading the actual computed className (not just the
    rendered color, which can coincidentally match a token's value in
    one theme and mask a literal-color bug -- light mode's own
    `--color-panel-line` happens to equal Tailwind's `slate-400`
    numerically, which is exactly the kind of false negative a
    color-only check would miss).
  - **What the audit found but did *not* change, and why:** the
    spotlight's corner brackets/pulse glow, the countdown-flicker-reveal
    choreography, `VsLabel`'s literal (not token) accent color, and the
    Orbitron sizing in team names are Draft Arena's own protected brand
    glow (Section 3) -- the standing project rule is that these are not
    restyled to match Admin/Lobby's flatter look without an explicit,
    specific request, the same rule that's already been granted
    itemized exceptions (badges, the rail, this stage's buttons) one at
    a time throughout this section. Two more things found, both outside
    Final Matchups' own scope so left alone: `DraftAction` (the Draft
    Captain/Player header's own three buttons) and `PlayerStatCard` (the
    teammate-draft player card) carry the exact same hardcoded-slate
    pattern `FilmChip` had -- a different stage this request never
    named, not touched here.
  - **Documentation correction, found while auditing:** Section 3's and
    this section's own opening description of Draft Arena's "brand
    identity" still said "gold/Cinzel-Orbitron" and referenced "the
    Final Matchups poster" -- stale, describing an early design that
    predates the VS-duel spotlight documented everywhere else in this
    section. There is no Cinzel font and no gold color anywhere in the
    current code. Corrected in place (both mentions), with a note left
    behind recording what the text used to say, in case anything else
    in this doc still assumes the old description.

**Workflow (admin-controlled, blank canvas -- nothing auto-generated):**
entering this stage snapshots the drafted teams (captain identity plus a
light `members` teammate list -- id + name only) with zero matchups. From there, freely mixable:
- Team selection for both Manual Pairing and Random Roll happens
  directly in the 参赛战队 roster list -- clicking an eligible (not yet
  paired/bye) row toggles it into the current selection; there is no
  separate picker list alongside it. Rows have three visual states:
  idle, **selected** (violet/`accent` -- the same color this stage
  already uses for "in progress" via the 对阵抽签 status badge), and
  **paired/bye** (cyan/`accent2` -- matching 对阵已就绪). Keep that
  violet-selecting/cyan-settled convention for any new state added
  here later rather than introducing a third color.
- **Manual Pairing** -- select exactly 2 remaining teams -> 定角锁定 ->
  creates an already-**locked** matchup.
- **Random Roll** -- select any number of teams (or none, defaulting to
  "every currently-free team") -> 随机生成剩余对阵 -> server shuffles
  + pairs just that pool (odd count -> one team gets a **轮空**/bye),
  plays the full countdown -> flicker -> reveal animation against the
  real result. Locked matchups are left untouched by any later roll.
- Every matchup can be removed (✕ 解除本场对阵, returns both teams to
  the free pool immediately). 定角锁定 with 3+ selected delegates
  straight to Random Roll for that exact group instead of being
  disabled.
- 🔄 重置 wipes every matchup back to the blank canvas. 🏁 结束锦标赛
  deletes the whole `tournament_matches` row *and* clears
  `tournament_participants` (nobody carries into the next tournament;
  `tournament_settings` is left alone, so a new tournament reuses the
  last-configured team count/order) -- every connected client is
  booted back to the Tournament Lobby.
  - **Temp-player cleanup on end.** `handleEndClick`'s confirmed action
    now also calls `removeTempParticipants()` (Section 7's Temporary
    Testing Buttons) right after `endTournament()` succeeds, so any
    `accounts.is_temp = true` rows created for that session's testing
    are deleted along with everything else 结束锦标赛 already clears --
    an admin who used 创建临时玩家 no longer has to remember to run
    移除临时玩家 separately once the tournament is over. Best-effort and
    silent by design: it's fired-and-caught (`.catch(() => {})`) after
    `endTournament()` has already succeeded, so a failure here (or
    simply there being no temp accounts to remove) never blocks
    `onEnded()` or surfaces an error for what is, from the admin's
    perspective, a successfully-ended tournament. This call is entirely
    a consequence of the Temporary Testing Buttons feature existing at
    all -- if that feature is ever removed, this call (and this note)
    should go with it rather than being left calling into a
    since-removed RPC.

**Backend:** `public.tournament_matches` -- a structural singleton
holding a `teams` snapshot and a `matchups` **append-only** JSON array.
Public-read, Realtime-enabled. Admin/Developer-gated RPCs:
`enter_final_matchups`, `create_manual_matchup`,
`remove_tournament_matchup`, `roll_tournament_matchups_pool`,
`lock_tournament_matchup`, `reset_tournament_matchups`,
`end_tournament`. The client subscribes to `tournament_matches` for the
whole page's life regardless of which stage it's on, so a matchup
change / End Tournament reaches every connected client instantly, not
just the one that clicked.

**Real-server-data-must-drive-the-reveal pattern:** `runReveal()` only
ever paints matches it was explicitly handed (the RPC's own resolved
result, appended entries only) -- `displayMatches` (React state) is
never written ahead of the sequence, and a `revealingRef` guard stops
the Realtime prop-sync effect from overwriting it mid-sequence, same
guarantee as before, just implemented as a plain ref + effect instead
of a mutable non-React model object.

**Spectator-only reveal replay.** For anyone who didn't trigger the
roll themselves (another admin, or a spectator), the prop-sync effect
diffs incoming `matchups` length against `displayMatches`; a pure
append (someone else just locked/rolled a new pairing) replays the
identical countdown->flicker->reveal sequence instead of snapping
straight to the result. A non-append change (removal/reset, or the
very first sync on mount) snaps immediately.

### Live Draft State persistence, and resuming a paused draft

The Captain assignment / Teammate draft phases are still 100% local
React state (`tournament` in `DraftArenaPage`) while actively being
driven. In parallel, every time that state actually changes (while an
Admin/Developer is on the draft stage), it's saved via `sync_draft_state()`
— this is what feeds both the Spectator Page's view (Section 9) and
resuming a paused draft, below. A failed/slow write here can never block
or alter the admin's own drafting experience.

**Split across two tables — `tournament_draft_state` and
`tournament_draft_history` — and this split is load-bearing, not
cosmetic; don't recombine them.** `tournament_draft_state` (public-read,
Realtime-enabled) holds everything the current board needs
(teams/pool/phase/pickIndex/captainCandidates/roundOrders/etc) and stays
small — bounded by team/pool size, not by how many picks have happened.
`tournament_draft_history` (public-read, **not** Realtime-enabled) holds
only the Undo stack (`draftHistory` — every entry itself a deep-cloned
snapshot of `teams`/`pool`), which grows every pick and was measured at
~3MB serialized for a realistic full 8×5 draft.

This used to be one field on one broadcast row, and it was a real shipped
bug: Supabase Realtime's Postgres Changes feature caps a change payload
at 1,024 KB — past that, Realtime doesn't error, it silently drops every
field over 64 bytes from that event
(https://supabase.com/docs/guides/realtime/limits#postgres-changes-payload-limit).
With `draftHistory` folded into the same row Spectator subscribes to,
crossing that cap meant the *entire* `state` field vanished from the
Realtime event the moment a draft's combined payload passed ~1MB —
reliably around the 6th teammate pick in a default 8×5 draft — even
though Postgres still had the correct row the whole time. The Spectator
Page's realtime handler saw a row with no `state` and rendered its empty
placeholder, which looked exactly like "sync randomly breaks mid-draft."
The fix is structural: `draftHistory` only has one real reader
(`DraftArenaPage`'s own resume-on-mount, via a plain REST `fetchDraftHistory()`
— no such payload cap applies to REST), so it lives in a table that was
never added to the `supabase_realtime` publication at all. The Spectator
Page never fetches it and has no reason to.

`sync_draft_state(p_token, p_state, p_history)` writes both tables in one
call/transaction, so they can never drift apart. `enter_final_matchups()`
and `end_tournament()` both clear both tables together for the same
reason.

**Watch out — the write is leading-edge-immediate + trailing-edge-coalesced
(200ms window) on purpose, and needs to stay that way:** an isolated
change (an isolated pick, which is most of a real draft) is written the
instant it happens, with no artificial delay, because the Spectator
Page's whole value is showing what just happened as fast as possible.
The 200ms window only exists to protect against a genuine rapid click
burst (spam-clicking Undo, and to a lesser extent rapid picks) recomputing
`JSON.stringify(draftHistory)` on every single click — `draftHistory`
gets measurably more expensive to serialize the deeper into a draft this
runs (measured: ~12ms for a realistic full 8×5 draft's worth of history —
cheap once, but a 20-click burst measured at ~220ms of blocking
main-thread work if every click recomputed it). So: if no window is
already open, write immediately and open a short window purely to catch
anything landing in the next instant; if a change arrives while a window
is already open, coalesce it into that window's trailing fire instead of
writing again right away. A rapid burst still only pays the recomputation
cost twice (once immediately for the first click, once for the trailing
fire with the final state) instead of once per click — same protection as
a plain debounce, but a quiet draft is never held back by a fixed delay
that only ever existed to protect against bursts. A matching "flush on
unmount" effect exists alongside it specifically so navigating away
*during* an open window still persists the latest state instead of
silently dropping it — keep both effects together if this code is ever
touched again. **This window governs when a write starts, not how many
can be in flight at once — see the separate `syncInFlightRef`/
`pendingWhileInFlightRef` guard (Section 3's development rules, the
`readyToProceed` bullet) for the real, reported bug that gap caused
(`57014` lock-contention timeouts on this same table) and why both
guards need to stay in place together.**

**Resuming a paused draft:** `DraftArenaPage`'s mount effect fetches
`tournament_draft_state` and `tournament_draft_history` together and, if
a state row exists, seeds both `tournament` and the Undo stack from them
instead of starting fresh. Both rows are only cleared when the draft
actually reaches Final Matchups or the tournament ends — leaving the
page mid-draft no longer loses progress. The ephemeral "captain clicked
but not yet assigned" highlight is intentionally **not** restored on
resume (would read as a click that never happened).

**Auto-redirect to Spectator when a draft starts.** `App.jsx` holds its
own `subscribeDraftState` subscription for the entire logged-in session
(independent of whichever page is currently mounted) and treats that
table's first `INSERT` — the same event that means "a draft just began"
above (only ever produced by 开始比赛, never by merely opening the Draft
Arena) — as the signal to send every *other* connected client straight
to `#spectate`. The host needs no special-casing: 开始比赛 (Tournament
Lobby) sets `window.location.hash = 'draft'` synchronously, before
`DraftArenaPage` even mounts and performs the sync that creates this
row, so by the time the `INSERT` fires the host's own tab is already on
`#draft` and the hash check skips them. **Watch out:** this relies on
`subscribeDraftState` giving every call its own uniquely-suffixed
Realtime channel (Section 6) so this listener and the Spectator Page's
own separate `subscribeDraftState` call can stay open at the same
time — reverting that suffixing breaks this feature immediately with a
Realtime crash on the Spectator Page.

## 9. Spectator Page

**⚠ This page is not independent of Draft Arena (Section 8) — see
Section 3's "one system" rule. If you're here because you just changed
something in Draft Arena, that's correct; check this whole section
against that change before considering it done.**

`src/components/SpectatorPage.jsx`, reached via a **观赛** button (open
to every logged-in account, staff or not) on the Tournament Lobby,
routed at `#spectate`. Mounts the exact same shared `<AppShell>` every
other page uses — same nav, same account chip, same working 退出登录 —
not a stripped-down or page-specific header; `account`/`onLogout` are
forwarded straight through from `App.jsx` exactly like every other
top-level page (Section 3's AppShell-wiring rule — this page used to
hard-code a `viewerMode` flag that stripped the account chip entirely,
which was the real bug that rule now guards against). Only the body is
page-specific: the Captain/Teammate draft and Final Matchups content
are the **exact same `DraftArena`/`FinalMatchupsStage` components** the
admin's own Draft Arena renders, mounted with `isStaff={false}` —
pixel-identical layout to what staff see, not a reimplementation.
Deliberately scoped to the live drafting process only — general
tournament/roster info already lives in the Tournament Lobby.

`isStaff={false}` means every admin-only control is not rendered at
all (not merely disabled), and every mutating click handler no-ops —
but visually nothing is missing: both stages' spectator-replay paths
(Section 8) fire the identical animations for every pick/roll as they
happen live, not just the final state.

**Standard top nav, by explicit request:** the "same nav" claim two
paragraphs up describes the *current* state — it wasn't quite true
before this fix. This page used to give `AppShell` `backAction`/
`backLabel`/`title` instead of `nav`, rendering its own isolated "<
返回锦标赛大厅" back-link header, not the real tabbed nav bar. See
`DraftArenaPage`'s matching fix/comment in `DraftArena.jsx` (Section 8
above) for the full reasoning — this page's own `isStaff`/
`spectateNav`/`handleSpectateNavigate` mirror it exactly, with one
difference: `section="spectate"` needed no judgment call the way
`DraftArenaPage`'s active-tab choice did, since this page *is* the 观赛
tab. Note this `isStaff` (gates whether the 管理后台/选秀台 tabs are
offered to *this viewer*) is unrelated to the `isStaff={false}` always
passed to `DraftArena`/`FinalMatchupsStage` below — that one keeps the
page's body read-only for literally everyone regardless of role; this
one only decides what the nav bar itself offers. `spectateNav` picked
up 选秀台 (`isStaff`-gated, same position between 锦标赛大厅 and 观赛)
in the same later pass that added it everywhere else — see Section 8's
own note on that tab for the full reasoning; `handleSpectateNavigate`
needed no change at all for it, since a bare `window.location.hash =
key` already covers any key besides 'lobby'.

**Theme Switcher: follows Section 8, not independent of it.** This page
used to wrap its copy of the `DraftArena`/`FinalMatchupsStage` body in
`DraftVisualLock` too, pinning it dark regardless of the *viewer's own*
saved theme — a second, separate dark-lock from Draft Arena's, and
exactly the kind of drift Section 3's "one system" rule exists to catch.
That wrapper has been removed here as well, so a spectator now sees the
same theme-following surfaces/text (and the same fixed brand glow/fonts)
as the admin does on the actual Draft Arena page, just driven by the
spectator's own account theme rather than the admin's. If Draft Arena's
theming split (Section 8: surfaces/text follow the theme, brand glow/
fonts don't) ever changes, this page's body renders it automatically
since it's the literal same components — but double check anyway,
per this section's own warning banner above.

**Persistence-first, not connection-first.** This page's job is to
render whatever is currently *saved* in Supabase — it never depends on
an Admin/Developer being on the Draft Arena at the same time, being
online, or having any live connection at all. On open it reads
`tournament_draft_state`/`tournament_matches` directly (the same
persisted rows described in Section 8's "Live Draft State" and Final
Matchups sections), so an Admin can draft, close the browser entirely,
and anyone opening Spectator later still sees everything that already
happened. A Realtime subscription on top of that initial read is a pure
enhancement for anyone who already has the page open — if it drops, the
page just keeps showing the last state it read/received until it
reconnects (same reconnect-and-refetch pattern `DraftArenaPage` itself
uses for `tournament_matches`, Section 8); it never gates or blocks what
gets displayed.

Views, switched purely by what's currently saved:
- **empty placeholder** — neither a `tournament_draft_state` row nor a
  `tournament_matches` row has ever been saved: a minimal "暂无选秀数据"
  message. Not a "waiting for the admin to connect" state — it renders
  the same whether or not anyone is currently online. **Bug fix, by
  explicit report:** this and `DraftArenaPage`'s own empty placeholder
  already rendered through the one shared `EmptyDraftView` (Section 8's
  comment on it, `DraftArena.jsx`) in an identical `AppShell`/container,
  but still visibly shifted height/vertical position switching between
  the 选秀台 and 观赛 tabs. Root cause wasn't the container at all — both
  callers' subtitles are different lengths (选秀台's is 27 characters,
  观赛's is 31) inside the shared `max-w-sm`, so one wraps to one line
  and the other to two, and since the icon/title/subtitle group is
  centered as a whole, a taller subtitle pushes the icon above it to a
  different vertical offset. Fixed inside `EmptyDraftView` itself (not
  per-caller) two ways: the subtitle `<p>` now reserves a fixed two-line
  `min-h` regardless of actual wrap, and the outer wrapper adds a
  `min-h-[60vh]` floor under `flex-1` so the centering has a real,
  identical span to work with on sub-`lg` viewports too (where
  `AppShell`'s root is only `min-h-screen`, not `h-screen` — plain
  `flex-1` there shrinks to content size instead of the viewport).
  Watch out: a future subtitle change that's long enough to wrap past
  two lines would reopen this same drift and needs its `min-h` raised
  to match. **Follow-up bug fix, by explicit report:** the subtitle
  `<p>` first shipped with `flex items-center justify-center` inside
  that reserved `min-h`, which kept the icon/title above pinned (good)
  but vertically centered a single-line subtitle *within* the two-line
  box — so 选秀台's one-line subtitle sat visibly lower than 观赛's,
  whose first line starts at the top the moment it wraps to two lines.
  Removed the flex centering; a plain block's text starts at its own
  top by default, so both pages' first subtitle line now lands at the
  same Y under the title regardless of 1- vs 2-line wrap, while `min-h`
  alone still keeps the icon/title above from moving.
- **`drafting`** — a `tournament_draft_state` row exists: `<DraftArena>`
  fed a `tournament` object built from that saved state.
- **`final`** — a `tournament_matches` row exists: `<FinalMatchupsStage>`
  with its own back button suppressed (this page's header already has
  an exit button). Ending the tournament sends spectators back to the
  Lobby too, same as every other connected client.

## 10. Not Yet Built / Known Limitations

- If two Admin/Developer accounts ran separate drafts concurrently
  before Final Matchups, the snapshot taken on 进入最终对阵 is whichever
  draft called it most recently — an accepted, unaddressed edge case.
  The Live Draft State write has the same "last writer wins"
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
- **Terminology is fixed (Section 4's Terminology Refactoring):** use
  **身份** only for the system-level user types (开发者/管理员/普通用户)
  and **角色** only for the team-level positions (队长/队员) — in
  every future devlog update, code comment, UI label, error message, and
  architecture/backend doc. Do not reintroduce the old, reversed usage.
- For install/run/build instructions, see `README.md`.
- **Deliver full zips, not diffs.** Whenever a code change is made to
  this project (in any future chat/session), always hand back the
  COMPLETE, FULL project zip with the change applied — never a partial
  zip, a single changed file, or a diff/patch on its own.
