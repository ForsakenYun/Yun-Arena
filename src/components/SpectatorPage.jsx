import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchTournamentSettings,
  fetchDraftState,
  fetchFinalMatchups,
} from '../lib/tournamentApi.js'
import { DraftArena, FinalMatchupsStage, GlobalStyle } from './DraftArena.jsx'
import AppShell from './AppShell.jsx'

/* ════════════════════════════════════════════════════════════════════════
   SPECTATOR PAGE — a read-only window onto the live tournament, built on
   the exact same public Supabase backend as everything else in this
   project (Section 6, DEVLOG.md): no separate data source, no fake/demo
   data.

   Concept, deliberately simple: Admin/Draft page controls the tournament
   and writes its state to Supabase (tournament_draft_state /
   tournament_matches); this page only ever reads those two tables and
   renders whatever is currently in them. It never writes anything.

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
         data this page renders.
   Only a thin identity/exit strip (this file's own header) is unique to
   this page, in the main app's Tailwind accent theme (Section 3).

   ---------------------------------------------------------------------
   Sync mechanism — rebuilt from scratch (this file's second full rework).
   The first two attempts kept Supabase Realtime (`postgres_changes`) as
   the delivery mechanism and tried to patch around specific failure
   modes: oversized payloads, stale/duplicate channels, a "premature
   SUBSCRIBED" race. None of those actually fixed the reported symptom:
   an already-open Spectator tab simply never receives a single live
   event, for the entire session, no matter what the Admin does --
   confirmed by testing that a plain REST read always shows the correct,
   current state, but the realtime channel sitting next to it never
   fires. That is consistent with a documented, still-open Supabase
   Realtime platform gap where a channel reports "subscribed" without its
   backend replication listener ever actually becoming live for that
   session (github.com/supabase/supabase-js#1599, closed "not planned";
   the identical symptom independently reported in supabase/ssr#122 and
   supabase/realtime#370) -- not something fixable from this file no
   matter how the subscription/reconnect logic around it is written.

   So this page no longer uses Realtime at all. The mechanism is now the
   simplest thing that is actually guaranteed to work, because it's the
   exact operation already confirmed reliable: a plain REST read of
   tournament_draft_state / tournament_matches, repeated on a short
   interval (`POLL_MS` below) for as long as this page stays open, via
   `usePolledRow`. Every tick fully replaces whatever was on screen with
   the fresh row -- there is no partial/malformed-payload merging to
   reason about anymore, because a REST read is always the complete,
   current row, never a delta.

     Admin changes state → written to Supabase (unchanged -- Section 6c)
       → next poll tick on this page reads it → this page re-renders.

   Worst-case staleness is bounded by `POLL_MS`, not indefinite the way a
   silently-dead realtime channel was. `tournament_matches` is still used
   exactly as before by the Admin's own Draft Arena (DraftArena.jsx's own
   `subscribeFinalMatchups` effect there is untouched) -- this rework only
   replaces how THIS page gets data, nothing else.

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

// How often this page re-reads the two tables it renders. Short enough to
// feel live for a drafting spectacle, long enough to stay cheap -- both
// rows are small (see tournament_draft_state/tournament_draft_history's
// split in schema.sql), so this is two lightweight REST reads every
// POLL_MS for as long as a spectator keeps this page open.
const POLL_MS = 1500

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
      <span className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center shadow-accent-glow">
        <Icon.eye className="w-7 h-7 text-accent" />
      </span>
      <h2 className="font-display text-lg font-semibold text-ink-primary">选秀尚未开始</h2>
      <p className="text-sm text-ink-muted max-w-sm">
        请等待管理员开始选秀，队长分配、队员选秀与最终对阵将在开始后自动在此实时更新。
      </p>
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint mt-1">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulseGlow" />
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

/* ---------- the actual sync mechanism ---------- */
// Repeatedly re-reads `fetchFn` (a plain REST read -- fetchDraftState or
// fetchFinalMatchups, both already used elsewhere in this project) on a
// fixed interval for as long as the calling component stays mounted.
// Every tick's result fully replaces the previous value -- a REST read is
// always the complete current row, so there's nothing to merge.
// `onDisappear` (optional) fires the one time a previously-present row is
// found gone on a later tick (used below so ending the tournament still
// sends the Spectator back to the Lobby, same as it always has).
function usePolledRow(fetchFn, onDisappear) {
  const [data, setData] = useState(null)
  const hadRowRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    function tick() {
      fetchFn()
        .then((row) => {
          if (cancelled) return
          if (hadRowRef.current && !row) onDisappear?.()
          hadRowRef.current = !!row
          setData(row)
        })
        .catch((err) => console.error('[spectator sync] poll failed:', err))
    }

    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return data
}

/* ---------- top-level page ---------- */
export default function SpectatorPage({ onExitToLobby }) {
  const [tournamentName, setTournamentName] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)

  // Tournament name -- fetched once on open, same as the Lobby's own
  // Tournament Settings dialog. Rarely changes mid-tournament, so this
  // one stays a single fetch rather than joining the poll above.
  useEffect(() => {
    let cancelled = false
    fetchTournamentSettings()
      .then((s) => { if (!cancelled) setTournamentName(s.tournamentName || '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Live Draft State -- mirrors whichever admin/developer is currently
  // running the Captain/Teammate draft.
  const draftState = usePolledRow(fetchDraftState)

  // Final Matchups -- same table the Draft Arena itself reads/writes.
  // Ending the tournament deletes this row; the next poll tick notices it
  // just disappeared and sends every Spectator back to the Lobby, same as
  // before.
  const finalMatches = usePolledRow(fetchFinalMatchups, onExitToLobby)

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
    <AppShell
      account={null}
      viewerMode
      backAction={onExitToLobby}
      backLabel="返回锦标赛大厅"
      title={tournamentName ? `${tournamentName} · 观赛` : '观赛'}
      bgVariant="default"
    >
      {/* Orbitron font/scrollbar styling used by the reused DraftArena/
          FinalMatchupsStage bodies below, so they render pixel-identical
          to the admin's own Draft Arena (same .font-display, etc.). */}
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
        <WaitingSpectatorView />
      )}
    </AppShell>
  )
}
