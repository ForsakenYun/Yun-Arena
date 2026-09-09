import { useEffect, useMemo, useState } from 'react'
import {
  fetchTournamentSettings,
  fetchDraftState,
  subscribeDraftState,
  fetchFinalMatchups,
  subscribeFinalMatchups,
} from '../lib/tournamentApi.js'
import { DraftArena, FinalMatchupsStage, GlobalStyle } from './DraftArena.jsx'
import AppShell from './AppShell.jsx'

/* ════════════════════════════════════════════════════════════════════════
   SPECTATOR PAGE — a read-only window onto the live tournament, built on
   the exact same public/Realtime backend as everything else in this
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
         broadcast this page renders.
   Only a thin identity/exit strip (this file's own header) is unique to
   this page, in the main app's Tailwind accent theme (Section 3).

   ---------------------------------------------------------------------
   Sync layer -- rebuilt to mirror the Draft page's own, already-reliable
   Final Matchups sync (see DraftArenaPage's `tournament_matches` effect
   in DraftArena.jsx) for BOTH tables it reads, via `useLiveRow` below:
     - fetch once immediately on mount (fast first paint)
     - subscribe via Realtime for the rest of this page's life
     - on any non-SUBSCRIBED channel status, tear the channel down and
       reconnect shortly after (Supabase's client retries the underlying
       socket on its own, but a channel that lived through a long
       backgrounded tab or a rough network patch can come back reporting
       CHANNEL_ERROR/TIMED_OUT without ever cleanly re-subscribing --
       silently stuck on stale data with nothing on screen indicating a
       problem)
     - on every fresh SUBSCRIBED (the first connect *and* every later
       reconnect), re-fetch once via the same plain REST read the initial
       load uses, so anything that happened while disconnected is never
       silently lost
     - PLUS a low-frequency REST reconciliation poll (~4s) alongside all
       of the above. This page originally shipped without one, on the
       (reasonable-looking, but incomplete) theory that mirroring the
       Draft page's realtime-only pattern would be enough. It isn't, for
       this page specifically: Supabase Realtime has a documented,
       still-open platform gap where a channel reports SUBSCRIBED before
       its backend replication listener has actually finished starting
       up, silently dropping every event for that channel's remaining
       lifetime with no error to react to (see the comment on `pollMs` in
       useLiveRow below for sources). A passive, possibly long-idle
       listener -- exactly what the Spectator Page is, sitting on
       "waiting" until an admin happens to start a draft -- is precisely
       the scenario that gap bites. The poll is a bounded worst-case
       latency guarantee sitting alongside Realtime, which still applies
       everything instantly when it does arrive; it is not a replacement
       for the above, and it is not "unnecessary" complexity re-added out
       of caution -- it's the standard mitigation for a specific, named
       external limitation this page cannot avoid any other way.

   The one thing this page must never do: turn a partial/malformed
   realtime payload into "nothing is happening" (i.e. wipe good state
   back to the waiting placeholder). `tournament_matches` already guarded
   against this for its `teams` column (Postgres's logical replication
   can omit an unchanged, TOASTed jsonb column from a change payload);
   `tournament_draft_state`'s `state` column is exactly the same shape of
   risk (a single, only-ever-growing jsonb blob), so the merge function
   below applies the same rule: keep whatever good state is already on
   screen unless the event is a genuine DELETE (draft state cleared /
   Final Matchups reached / tournament ended -- the only real "stop
   showing this" signals) or a fully-formed row.

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

/* ---------- shared live-singleton-row sync (see header comment above) ---------- */
// One small hook, used identically for tournament_draft_state and
// tournament_matches -- the same fetch/subscribe/reconnect shape
// DraftArenaPage already relies on for tournament_matches, just factored
// out so both tables in this file share one implementation instead of two
// hand-copied effects that could drift apart.
//
// `mergeRow(prev, row)` decides what a realtime INSERT/UPDATE event does
// to the current value -- this is where "never wipe good state on a
// partial payload" lives; a plain REST fetch (initial load + the
// refetch-on-resubscribe below) is always a complete row, so those are
// applied directly, never through mergeRow. `onDelete` (optional) fires
// once per genuine DELETE event, for callers that need to react to it
// (e.g. leaving the page), in addition to the row itself being cleared.
// `pollMs` (optional): a low-frequency REST reconciliation fetch running
// alongside the realtime subscription above -- NOT a replacement for it,
// and not "unnecessary" polling. It exists specifically because of a
// documented, still-open Supabase Realtime platform gap: the client's
// 'SUBSCRIBED' status fires as soon as the WebSocket channel joins, but
// the backend's actual logical-replication listener for that channel
// finishes initializing separately and can take several seconds --worse
// on a connection that's been sitting idle, which describes a Spectator
// tab opened before a draft starts almost exactly. Any change to the
// table inside that window is silently dropped, permanently, for that
// channel's remaining lifetime -- no error, no close event, nothing this
// hook (or any purely-event-driven client) could ever react to on its
// own (see github.com/supabase/supabase-js#1599, closed "not planned" as
// an accepted platform limitation, plus independent reports of the exact
// same "subscribes fine, zero events delivered until the page is
// reloaded" symptom in supabase/ssr#122 and supabase/realtime#370). A
// realtime event, when it does arrive, still applies instantly through
// `mergeRow` above -- this poll only bounds the worst case for whenever
// it doesn't.
function useLiveRow(fetchFn, subscribeFn, mergeRow, onDelete, pollMs = 4000) {
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe = null
    let retryTimer = null

    function connect() {
      unsubscribe = subscribeFn(
        (payload) => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            setData(null)
            onDelete?.()
            return
          }
          setData((prev) => mergeRow(prev, payload.new))
        },
        (status) => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') {
            fetchFn()
              .then((row) => { if (!cancelled) setData(row) })
              .catch((err) => console.error('[spectator sync] refetch-on-subscribe failed:', err))
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.error(`[spectator sync] realtime channel ${status.toLowerCase()}, reconnecting in 2s…`)
            unsubscribe?.()
            unsubscribe = null
            if (!cancelled) retryTimer = setTimeout(connect, 2000)
          }
        }
      )
    }

    // Immediate initial read (fast first paint, before the realtime
    // channel has necessarily finished subscribing yet) -- the same
    // 'SUBSCRIBED' handler above will also fire this once the channel
    // itself connects, so nothing that happened in between is missed.
    fetchFn()
      .then((row) => { if (!cancelled) setData(row) })
      .catch((err) => console.error('[spectator sync] initial fetch failed:', err))
    connect()

    // See the comment on `pollMs` above -- this is the actual mitigation
    // for a channel that's silently stopped delivering events. A plain
    // REST read is always the complete row, so it's applied directly,
    // same as the initial load and every refetch-on-resubscribe above.
    const pollTimer = pollMs
      ? setInterval(() => {
          fetchFn()
            .then((row) => { if (!cancelled) setData(row) })
            .catch(() => {})
        }, pollMs)
      : null

    // The other common trigger for the same platform gap: a backgrounded
    // tab's realtime connection going quiet, then the tab regaining focus
    // long after. Reconcile immediately instead of waiting out the poll
    // interval.
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      fetchFn()
        .then((row) => { if (!cancelled) setData(row) })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (pollTimer) clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return data
}

// tournament_draft_state: an INSERT/UPDATE payload missing/malformed
// `state` (see the header comment's TOAST note) keeps whatever draft
// state is already on screen instead of snapping back to the waiting
// placeholder -- only a genuine DELETE (handled in useLiveRow itself)
// means "stop showing a draft."
function mergeDraftStateRow(prev, row) {
  if (!row || !row.state || typeof row.state !== 'object') return prev
  return { ...row.state, updatedAt: row.updated_at ?? null }
}

// tournament_matches: `teams` is snapshotted once by enter_final_matchups
// and never written again -- every later mutation (lock/pair/roll/
// remove/reset) only touches `matchups`. Postgres's logical replication
// can still omit that unchanged, TOASTed `teams` value from a
// matchups-only update payload, so keep whatever non-empty teams are
// already known instead of wiping the roster to nothing.
function mergeFinalMatchesRow(prev, row) {
  if (!row) return prev
  const incomingTeams = Array.isArray(row.teams) ? row.teams : []
  return {
    teams: incomingTeams.length > 0 ? incomingTeams : prev?.teams ?? [],
    matchups: Array.isArray(row.matchups) ? row.matchups : [],
  }
}

/* ---------- top-level page ---------- */
export default function SpectatorPage({ onExitToLobby }) {
  const [tournamentName, setTournamentName] = useState('')
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

  // Live Draft State -- mirrors whichever admin/developer is currently
  // running the Captain/Teammate draft. See the header comment above and
  // useLiveRow/mergeDraftStateRow for the sync guarantees.
  const draftState = useLiveRow(fetchDraftState, subscribeDraftState, mergeDraftStateRow)

  // Final Matchups -- same table/channel the Draft Arena itself uses.
  // Ending the tournament sends every connected client, spectators
  // included, back to the Tournament Lobby via the DELETE event below.
  const finalMatches = useLiveRow(fetchFinalMatchups, subscribeFinalMatchups, mergeFinalMatchesRow, onExitToLobby)

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
