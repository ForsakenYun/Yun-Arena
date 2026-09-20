import { useEffect, useMemo, useState } from 'react'
import {
  fetchTournamentSettings,
  fetchDraftState,
  subscribeDraftState,
  fetchFinalMatchups,
  subscribeFinalMatchups,
} from '../lib/tournamentApi.js'
import { DraftArena, FinalMatchupsStage, GlobalStyle, EmptyDraftView } from './DraftArena.jsx'
import AppShell from './AppShell.jsx'

/* ════════════════════════════════════════════════════════════════════════
   SPECTATOR PAGE — a read-only window onto the tournament's persisted
   state, built on the exact same public/Realtime backend as everything
   else in this project (Section 6, DEVLOG.md): no separate data source,
   no fake/demo data.

   Persistence-first, by design (Section 9, DEVLOG.md): every Admin/
   Developer action that changes the draft or the final matchups is
   already saved to Supabase (`tournament_draft_state` /
   `tournament_matches`, both plain public-read tables) the moment it
   happens. Opening this page always reads whatever is currently saved —
   it never depends on an Admin/Developer being on the Draft Arena at the
   same time, being online, or having any live connection at all. A
   Realtime subscription on top of that initial read is a pure
   enhancement: if this page is already open when something changes
   elsewhere, it updates without a manual refresh; if that connection
   ever drops, the page simply shows the last state it read/received
   until it reconnects — it never blocks or gates what's displayed.

   Deliberately scoped to the live drafting process only (Captain
   Drafting → Player Drafting → Matchup/Bracket Roll) — general
   tournament/roster info already lives in the Tournament Lobby, so this
   page doesn't duplicate it.

   The Captain/Teammate draft and Final Matchups bodies are the exact same
   `DraftArena`/`FinalMatchupsStage` components (both exported from
   DraftArena.jsx) the admin's own Draft Arena renders — same layout, same
   live progress ring/sequence strip/team-and-pool cards, same fonts
   (GlobalStyle) — just mounted with isStaff={false}, which makes both
   components:
     (a) not render a single admin control at all (not merely disable one)
         -- 返回选手管理/撤销上一次选择/锁定并开始队员选秀/进入最终对阵 on
         the draft side, 定角锁定/随机生成/重置/结束锦标赛/per-match
         lock-unlock-remove on the Final Matchups side; and
     (b) make every click handler that would mutate the draft a no-op, so
         a spectator's click can never diverge local state from the saved
         state this page renders.
   Header/nav, by explicit request: this page used to render its own
   isolated "< 返回锦标赛大厅" back-link strip here instead of the shared
   tabbed nav bar every other page gets. It now renders the exact same
   AppShell nav bar (管理后台/锦标赛大厅/观赛 + account chip) as Admin
   Dashboard/Tournament Lobby/Draft Arena, nothing unique to this page
   left in the header at all -- see the `isStaff`/`spectateNav`/
   `handleSpectateNavigate` block below. The account chip itself
   (avatar, name, 退出登录) was already the same shared AppShell control
   every other page uses -- see the note on `account`/`onLogout` below
   for why this page forwards both instead of hard-coding `viewerMode`.

   View, switched purely by what's currently saved in the database:
     - 'final'    — a tournament_matches row exists (Final Matchups stage
                    reached, whether or not anyone is still on that page).
     - 'drafting' — no Final Matchups yet, but a tournament_draft_state row
                    exists (a draft has been started and has saved
                    progress — see the persistence effect in
                    DraftArena.jsx's DraftArenaPage).
     - otherwise  — neither has ever been saved: a lightweight "no draft
                    yet" placeholder (no roster/stats — that's the
                    Tournament Lobby's job, not duplicated here).
   ════════════════════════════════════════════════════════════════════════ */

/* ---------- empty state ---------- */
// By explicit request, this now reuses DraftArena.jsx's shared
// EmptyDraftView (see its own comment) instead of a local copy -- same
// icon/layout/title, this page's own subtitle passed in below at the
// call site. Deliberately minimal: general roster/participant info
// already lives in the Tournament Lobby (per explicit product
// decision), so it's not duplicated here -- this page is scoped to the
// live drafting process. Shown purely because no tournament_draft_state/
// tournament_matches row exists in Supabase yet (no draft has ever been
// started) -- not because of any live-connection state, so it renders
// identically whether or not an Admin/Developer happens to be online
// right now.

/* ---------- no-op setter, passed to DraftArena so it stays inert ---------- */
// DraftArena still calls setTournament from within a handler in a few
// places if isStaff somehow ends up true here (it never does -- isStaff
// is hardcoded false below), so this is defense-in-depth, not the primary
// safeguard (that's isStaff itself, see DraftArena.jsx).
function noop() {}

/* ---------- top-level page ---------- */
export default function SpectatorPage({ onExitToLobby, account, onLogout, theme, onThemeChange }) {
  const [tournamentName, setTournamentName] = useState('')
  const [draftState, setDraftState] = useState(null)
  const [finalMatches, setFinalMatches] = useState(null) // { teams, matchups } | null
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [finalLoaded, setFinalLoaded] = useState(false)
  const initialLoading = !draftLoaded || !finalLoaded

  // Standard top nav, by explicit request: same fix, same reasoning, as
  // DraftArenaPage's own copy of this comment (DraftArena.jsx) -- this
  // page used to give AppShell backAction/backLabel/title instead of a
  // `nav` array, rendering an isolated "< 返回锦标赛大厅" back-link header
  // in place of the tabbed nav bar every other page gets. This is
  // *this account's own* isStaff (unlike the isStaff={false} always
  // passed to DraftArena/FinalMatchupsStage below -- that one keeps
  // this page read-only for literally everyone regardless of role; this
  // one only decides whether the 管理后台 tab itself is offered, same
  // gating TournamentLobby.jsx uses). `section="spectate"` needs no
  // judgment call the way DraftArenaPage's `section="lobby"` did --
  // this page *is* the 观赛 tab.
  const isStaff = account && (account.permission_role === 'admin' || account.permission_role === 'developer')
  const spectateNav = [
    ...(isStaff ? [{ key: 'admin', icon: 'admin', label: '管理后台' }] : []),
    { key: 'lobby', icon: 'lobby', label: '锦标赛大厅' },
    ...(isStaff ? [{ key: 'draft', icon: 'draft', label: '选秀台' }] : []),
    { key: 'spectate', icon: 'spectate', label: '观赛' },
  ]
  function handleSpectateNavigate(key) {
    if (key === 'lobby') return onExitToLobby?.()
    window.location.hash = key
  }

  // Tournament name (fetch-on-open, same as the Lobby's own Tournament
  // Settings dialog -- not on the Realtime publication, so this is not
  // live; harmless since it rarely changes mid-tournament).
  useEffect(() => {
    let cancelled = false
    fetchTournamentSettings()
      .then((s) => { if (!cancelled) setTournamentName(s.tournamentName || '') })
      .catch((err) => console.error('fetchTournamentSettings failed:', err))
    return () => { cancelled = true }
  }, [])

  // Saved Draft State: the single source of truth for the drafting view is
  // whatever is currently persisted in `tournament_draft_state` -- read
  // once immediately (this is what makes the page correct even if no
  // Admin/Developer is online right now), then kept live via Realtime for
  // as long as this page stays open. This is the exact same
  // fetch-then-subscribe / reconnect-and-refetch pattern DraftArena.jsx
  // uses for `tournament_matches`, kept identical on purpose so there's
  // one way this project handles Realtime resilience, not a
  // Spectator-specific variant: Supabase's client retries the underlying
  // WebSocket on its own, but a channel that was live through a long
  // backgrounded tab or a rough network patch can come back reporting
  // 'CHANNEL_ERROR'/'TIMED_OUT' without ever cleanly re-subscribing, so on
  // any non-SUBSCRIBED status this tears the channel down and reconnects
  // shortly; every SUBSCRIBED (the first connect *and* every later
  // reconnect) re-reads the saved state once, so anything that changed
  // while disconnected is never silently lost.
  useEffect(() => {
    let cancelled = false
    let unsubscribe = null
    let retryTimer = null

    fetchDraftState()
      .then((state) => { if (!cancelled) setDraftState(state) })
      .catch((err) => console.error('fetchDraftState (initial) failed:', err))
      .finally(() => { if (!cancelled) setDraftLoaded(true) })

    function connect() {
      unsubscribe = subscribeDraftState(
        (payload) => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') { setDraftState(null); return }
          const row = payload.new
          if (!row || !row.state || typeof row.state !== 'object') { setDraftState(null); return }
          setDraftState({ ...row.state })
        },
        (status) => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') {
            fetchDraftState().then((state) => { if (!cancelled) setDraftState(state) }).catch((err) => console.error('fetchDraftState (reconnect) failed:', err))
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            unsubscribe?.()
            unsubscribe = null
            if (!cancelled) retryTimer = setTimeout(connect, 2000)
          }
        }
      )
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubscribe?.()
    }
  }, [])

  // Saved Final Matchups -- same table/channel/pattern the Draft Arena
  // itself uses (see the comment above). Ending the tournament (DELETE)
  // sends every connected client, spectators included, back to the
  // Tournament Lobby -- same behavior as everywhere else in the project
  // (DEVLOG.md, Final Matchups section).
  useEffect(() => {
    let cancelled = false
    let unsubscribe = null
    let retryTimer = null

    fetchFinalMatchups()
      .then((row) => { if (!cancelled && row) setFinalMatches(row) })
      .catch((err) => console.error('fetchFinalMatchups (initial) failed:', err))
      .finally(() => { if (!cancelled) setFinalLoaded(true) })

    function connect() {
      unsubscribe = subscribeFinalMatchups(
        (payload) => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            setFinalMatches(null)
            ;(onExitToLobby || (() => {}))()
            return
          }
          const row = payload.new
          if (!row) return
          // See the matching comment in DraftArena.jsx's own subscription:
          // `teams` never changes after creation, but a matchups-only update
          // can still arrive here with `teams` missing due to Postgres
          // logical replication omitting an unchanged TOASTed jsonb column.
          // Keep whatever non-empty teams we already have instead of wiping
          // the roster.
          const incomingTeams = Array.isArray(row.teams) ? row.teams : []
          setFinalMatches((prev) => ({
            teams: incomingTeams.length > 0 ? incomingTeams : prev?.teams ?? [],
            matchups: Array.isArray(row.matchups) ? row.matchups : [],
          }))
        },
        (status) => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') {
            fetchFinalMatchups().then((row) => { if (!cancelled && row) setFinalMatches(row) }).catch((err) => console.error('fetchFinalMatchups (reconnect) failed:', err))
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            unsubscribe?.()
            unsubscribe = null
            if (!cancelled) retryTimer = setTimeout(connect, 2000)
          }
        }
      )
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stage = finalMatches ? 'final' : draftState && Array.isArray(draftState.teams) && draftState.teams.length > 0 ? 'drafting' : 'empty'

  // The exact shape DraftArena's `tournament` prop expects (see
  // DraftArenaPage's own seedTournament()/setTournament in DraftArena.jsx)
  // -- built straight from the live broadcast, nothing invented.
  const draftArenaTournament = useMemo(() => {
    if (!draftState) return null
    return {
      teams: Array.isArray(draftState.teams) ? draftState.teams : [],
      pickIndex: draftState.pickIndex ?? 0,
      pool: Array.isArray(draftState.pool) ? draftState.pool : [],
      lastPick: null,
      draftPhase: draftState.draftPhase || 'captain',
      captainCandidates: Array.isArray(draftState.captainCandidates) ? draftState.captainCandidates : [],
      roundOrders: Array.isArray(draftState.roundOrders) ? draftState.roundOrders : [],
    }
  }, [draftState])

  return (
    <AppShell
      account={account}
      section="spectate"
      nav={spectateNav}
      onNavigate={handleSpectateNavigate}
      onLogout={onLogout}
      theme={theme}
      onThemeChange={onThemeChange}
      bgVariant="default"
    >
      {/* Orbitron font/scrollbar styling used by the reused DraftArena/
          FinalMatchupsStage bodies below, so they render pixel-identical
          to the admin's own Draft Arena (same .font-display, etc.).
          Draft Arena and Spectator Page are one system (DEVLOG Section
          3), so this follows the ambient light/dark theme exactly like
          the admin's own Draft Arena now does -- no DraftVisualLock here
          any more; see DraftArena.jsx for the same tokenized styling
          (bg-panel, text-ink-primary, border-panel-line, and the
          Cyber-Teal light overrides in index.css) that this body
          inherits. */}
      <GlobalStyle />
      {initialLoading ? (
        <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">加载中…</div>
      ) : stage === 'final' && finalMatches ? (
        <FinalMatchupsStage
          tournamentName={tournamentName}
          teams={finalMatches.teams}
          matchups={finalMatches.matchups}
          isStaff={false}
        />
      ) : stage === 'drafting' && draftArenaTournament ? (
        <DraftArena
          tournament={draftArenaTournament}
          setTournament={noop}
          onProceed={noop}
          tournamentName={tournamentName}
          isStaff={false}
          externalSelectedCaptainId={draftState?.selectedCaptainId ?? null}
        />
      ) : (
        <EmptyDraftView subtitle="锦标赛选秀开始后，队长分配、队员选秀与最终对阵将会显示在这里。" />
      )}
    </AppShell>
  )
}
