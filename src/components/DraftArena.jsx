import { useEffect, useState } from 'react'
import { fetchTournamentSettings } from '../lib/tournamentApi.js'

/* ---------- inline icons (kept consistent with TournamentLobby.jsx) ---------- */
const Icon = {
  flag: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M6 3.5v17" strokeLinecap="round" />
      <path d="M6 4.5c2-1 4-1 6 0s4 1 6 0v9c-2 1-4 1-6 0s-4-1-6 0v-9Z" strokeLinejoin="round" />
    </svg>
  ),
  bolt: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M13 3.5L5.5 13.5h5.2L10.5 20.5l7.8-10.4h-5.4L13 3.5Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  arrowLeft: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M19 12H5" strokeLinecap="round" />
      <path d="M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

// Phase 5 -- Draft System Top Bar only. This page is the future home of the
// whole Draft System (captain assignment, draft order execution, player
// selection, undo, end draft), but only the top bar is implemented here --
// see DEVLOG.md Roadmap (Section 11) and the Phase 5 scope note at the
// bottom of this file. Later parts of Phase 5 will add sections below the
// top bar; the fixed-height app-frame shell here (matching TournamentLobby's
// Desktop UI Optimization pattern, Section 17) is built so that content can
// be added without reworking this shell.
export default function DraftArena({ onExitToLobby }) {
  const [tournamentName, setTournamentName] = useState('')

  useEffect(() => {
    fetchTournamentSettings()
      .then((settings) => setTournamentName(settings.tournamentName || '锦标赛'))
      .catch(() => setTournamentName('锦标赛'))
  }, [])

  return (
    <div className="min-h-screen w-full bg-void text-ink-primary font-body flex flex-col lg:h-screen lg:overflow-hidden">
      <div className="w-full flex flex-col flex-1 lg:min-h-0 px-4 sm:px-5 lg:px-6 py-5 gap-5">
        {/* top bar -- Tournament Name + Current Draft Status */}
        <header className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-5 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 shrink-0">
          <div className="flex items-center gap-3 shrink-0">
            <span className="w-10 h-10 rounded-xl bg-teal/10 border border-teal/40 flex items-center justify-center shadow-teal-glow shrink-0">
              <Icon.flag className="w-5 h-5 text-teal" />
            </span>
            <div className="leading-tight">
              <p className="text-xs text-ink-muted">当前锦标赛</p>
              <h1 className="font-display text-lg sm:text-xl font-semibold tracking-wide text-ink-primary truncate max-w-[60vw] sm:max-w-none">
                {tournamentName || '\u00A0'}
              </h1>
            </div>
          </div>

          <div className="hidden sm:block w-px self-stretch bg-panel-line shrink-0" />

          <div className="flex items-center gap-3 min-w-0 sm:flex-1">
            <span className="w-10 h-10 rounded-xl bg-teal/10 border border-teal/40 flex items-center justify-center shadow-teal-glow shrink-0">
              <Icon.bolt className="w-5 h-5 text-teal" />
            </span>
            <div className="leading-tight min-w-0">
              <p className="text-xs text-ink-muted">当前状态</p>
              <p className="font-display text-base sm:text-lg font-semibold tracking-wide text-teal truncate">
                队长顺位阶段
              </p>
            </div>
          </div>
        </header>

        {/* draft arena body -- future Phase 5 parts land here */}
        <section className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow flex-1 lg:min-h-0 flex items-center justify-center px-5 py-10">
          <p className="text-sm text-ink-faint text-center max-w-md">
            选秀台正在建设中，后续阶段将在此处逐步添加队长分配、选秀顺序与选人功能。
          </p>
        </section>
      </div>

      {/* temporary development-only return button -- Phase 5 will remove
          this once real Draft System navigation exists; deliberately
          styled as a small, out-of-the-way dev convenience rather than a
          permanent nav element, and kept clear of the top bar / body above. */}
      <div className="shrink-0 px-4 sm:px-5 lg:px-6 pb-4 flex justify-center sm:justify-start">
        <button
          type="button"
          onClick={onExitToLobby}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-panel-line text-[11px] text-ink-faint hover:text-ink-muted hover:border-ink-faint transition"
        >
          <Icon.arrowLeft className="w-3.5 h-3.5" />
          返回锦标赛大厅（开发用）
        </button>
      </div>
    </div>
  )
}
