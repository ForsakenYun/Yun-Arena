import { useEffect, useMemo, useState } from 'react'
import {
  fetchTournamentSettings,
  fetchDraftState,
  subscribeDraftState,
  fetchFinalMatchups,
  subscribeFinalMatchups,
} from '../lib/tournamentApi.js'
import { DraftArena, FinalMatchupsStage, GlobalStyle } from './DraftArena.jsx'

/* ════════════════════════════════════════════════════════════════════════
   SPECTATOR PAGE (Phase 6) — a read-only window onto the live tournament,
   built on the exact same public/Realtime backend as everything else in
   this project (Section 6, DEVLOG.md): no separate data source, no fake/
   demo data.

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
         a spectator's click can never diverge local state from the live
         broadcast this page renders.
   Only a thin identity/exit strip (this file's own header) is unique to
   this page, in the main app's Tailwind teal theme (Section 3).

   View, switched purely by what's currently in the database (never by
   anything this page writes):
     - 'final'    — a tournament_matches row exists (Final Matchups stage
                    reached).
     - 'drafting' — no Final Matchups yet, but a tournament_draft_state row
                    exists (an admin/developer is actively running the
                    Captain/Teammate draft — see the broadcast effect in
                    DraftArena.jsx's DraftArenaPage).
     - otherwise  — neither exists yet: a lightweight "waiting for the
                    draft to start" placeholder (no roster/stats — that's
                    the Tournament Lobby's job, not duplicated here).
   ════════════════════════════════════════════════════════════════════════ */

/* ---------- inline icons (kept consistent with TournamentLobby.jsx) ---------- */
const Icon = {
  eye: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
}

/* ---------- placeholder view — draft hasn't started yet ---------- */
// Deliberately minimal: general roster/participant info already lives in
// the Tournament Lobby (per explicit product decision), so it's not
// duplicated here — this page is scoped to the live drafting process.
function WaitingSpectatorView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
      <span className="w-14 h-14 rounded-2xl bg-teal/10 border border-teal/30 flex items-center justify-center shadow-teal-glow">
        <Icon.eye className="w-7 h-7 text-teal" />
      </span>
      <h2 className="font-display text-lg font-semibold text-ink-primary">选秀尚未开始</h2>
      <p className="text-sm text-ink-muted max-w-sm">
        请等待管理员开始选秀，队长分配、队员选秀与最终对阵将在开始后自动在此实时更新。
      </p>
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint mt-1">
        <span className="w-1.5 h-1.5 rounded-full bg-teal animate-pulseGlow" />
        实时等待中…
      </span>
    </div>
  )
}

/* ---------- no-op setter, passed to DraftArena so it stays inert ---------- */
// DraftArena still calls setTournament from within a handler in a few
// places if isStaff somehow ends up true here (it never does -- isStaff
// is hardcoded false below), so this is defense-in-depth, not the primary
// safeguard (that's isStaff itself, see DraftArena.jsx).
function noop() {}

/* ---------- top-level page ---------- */
export default function SpectatorPage({ onExitToLobby }) {
  const [tournamentName, setTournamentName] = useState('')
  const [draftState, setDraftState] = useState(null)
  const [finalMatches, setFinalMatches] = useState(null) // { teams, matchups } | null
  const [initialLoading, setInitialLoading] = useState(true)

  // Tournament name (fetch-on-open, same as the Lobby's own Tournament
  // Settings dialog -- not on the Realtime publication, so this is not
  // live; harmless since it rarely changes mid-tournament).
  useEffect(() => {
    let cancelled = false
    fetchTournamentSettings()
      .then((s) => { if (!cancelled) setTournamentName(s.tournamentName || '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Live Draft State (Phase 6) -- mirrors whichever admin/developer is
  // currently running the Captain/Teammate draft.
  useEffect(() => {
    let cancelled = false
    fetchDraftState()
      .then((state) => { if (!cancelled) setDraftState(state) })
      .catch(() => {})

    const unsubscribe = subscribeDraftState((payload) => {
      if (payload.eventType === 'DELETE') { setDraftState(null); return }
      const row = payload.new
      if (!row || !row.state || typeof row.state !== 'object') { setDraftState(null); return }
      setDraftState({ ...row.state })
    })
    return () => { cancelled = true; unsubscribe() }
  }, [])

  // Final Matchups -- same table/channel the Draft Arena itself uses.
  // Ending the tournament (DELETE) sends every connected client, spectators
  // included, back to the Tournament Lobby -- same behavior as everywhere
  // else in the project (DEVLOG.md, Final Matchups section).
  useEffect(() => {
    let cancelled = false
    fetchFinalMatchups()
      .then((row) => { if (!cancelled && row) setFinalMatches(row) })
      .catch(() => {})

    const unsubscribe = subscribeFinalMatchups((payload) => {
      if (payload.eventType === 'DELETE') {
        setFinalMatches(null)
        ;(onExitToLobby || (() => {}))()
        return
      }
      const row = payload.new
      if (!row) return
      setFinalMatches({
        teams: Array.isArray(row.teams) ? row.teams : [],
        matchups: Array.isArray(row.matchups) ? row.matchups : [],
      })
    })
    return () => { cancelled = true; unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([fetchTournamentSettings(), fetchDraftState(), fetchFinalMatchups()]).then(() => {
      if (!cancelled) setInitialLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const stage = finalMatches ? 'final' : draftState && Array.isArray(draftState.teams) && draftState.teams.length > 0 ? 'drafting' : 'waiting'

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
    <div className="min-h-screen w-full bg-void text-ink-primary font-body flex flex-col lg:h-screen lg:overflow-hidden">
      {/* Orbitron font/scrollbar styling used by the reused DraftArena/
          FinalMatchupsStage bodies below, so they render pixel-identical
          to the admin's own Draft Arena (same .font-display, etc.). */}
      <GlobalStyle />
      <div className="w-full flex flex-col flex-1 lg:min-h-0 px-4 sm:px-5 lg:px-6 py-5 gap-5">
        {/* header -- no admin actions of any kind; a single compact back
            button, styled/positioned like the admin Draft Arena's own
            back button (top-left, small ghost button), instead of a full
            title bar, so the main Spectator UI gets the space back.
            Suppressed during the 'drafting' and 'final' stages: those two
            reused components (DraftArena / FinalMatchupsStage) each
            render this exact same button themselves, in their own exact
            position/style -- via showBackButton/backLabel below -- so
            reusing the admin's own markup guarantees a pixel-perfect
            match to their respective admin pages, rather than sitting in
            a separate row above with a different (Draft-Arena-teal)
            style than what Final Matchups actually uses. */}
        {stage !== 'drafting' && stage !== 'final' && (
          <header className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onExitToLobby}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border transition-all whitespace-nowrap"
              style={{ background: "rgba(0,245,212,0.05)", borderColor: "rgba(0,245,212,0.28)", color: "#7df3e1" }}
            >
              ← 返回锦标赛大厅
            </button>
          </header>
        )}

        {initialLoading ? (
          <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">加载中…</div>
        ) : stage === 'final' && finalMatches ? (
          <FinalMatchupsStage
            tournamentName={tournamentName}
            teams={finalMatches.teams}
            matchups={finalMatches.matchups}
            isStaff={false}
            onBack={onExitToLobby}
            showBackButton={true}
            backLabel="← 返回锦标赛大厅"
          />
        ) : stage === 'drafting' && draftArenaTournament ? (
          <DraftArena
            tournament={draftArenaTournament}
            setTournament={noop}
            onBack={onExitToLobby}
            onProceed={noop}
            tournamentName={tournamentName}
            isStaff={false}
            externalSelectedCaptainId={draftState?.selectedCaptainId ?? null}
            showBackButton={true}
            backLabel="← 返回锦标赛大厅"
          />
        ) : (
          <WaitingSpectatorView />
        )}
      </div>
    </div>
  )
}
