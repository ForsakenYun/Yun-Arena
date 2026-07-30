import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchTournamentSettings, draftRoundCount, generateSnakeDraft } from '../lib/tournamentApi.js'

/* ---------- inline icons (kept consistent with TournamentLobby.jsx) ---------- */
const Icon = {
  flag: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M6 3.5v17" strokeLinecap="round" />
      <path d="M6 4.5c2-1 4-1 6 0s4 1 6 0v9c-2 1-4 1-6 0s-4-1-6 0v-9Z" strokeLinejoin="round" />
    </svg>
  ),
  layers: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8 12 3.5Z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M3.5 12.5L12 17l8.5-4.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M3.5 16.5L12 21l8.5-4.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  arrowLeft: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M19 12H5" strokeLinecap="round" />
      <path d="M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  arrowRight: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M5 12h14" strokeLinecap="round" />
      <path d="M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  undo: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M7 8H4V5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 14.5A8 8 0 1 0 6.8 6.8L4 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

// Chinese ordinal labels for round numbers 1-20 (playersPerTeam is capped
// at 20 by save_tournament_settings' p_players_per_team validation --
// Section 16 -- so draftRoundCount(playersPerTeam) never exceeds 19).
const CN_ROUND = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九']

function roundLabel(n) {
  return `第${CN_ROUND[n] ?? n}轮`
}

// Phase 5 -- Draft System Top Bar. Everything in this file is layout only:
// the tournament name and draft order are read from the already-saved
// Tournament Settings (Section 16) purely to size/populate the UI
// realistically, but the stage, current turn, and progress line are all
// static placeholders -- see DEVLOG.md Section 23. No captain/team
// assignment, turn order, or player-selection logic exists yet.
export default function DraftArena({ onExitToLobby }) {
  const [settings, setSettings] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => {
    fetchTournamentSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [])

  function showToast(msg) {
    clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }

  const tournamentName = settings?.tournamentName || '锦标赛'
  const teamCount = settings?.teamCount ?? 8
  const playersPerTeam = settings?.playersPerTeam ?? 5
  const totalRounds = draftRoundCount(playersPerTeam)

  // Prefer the admin's actually-saved order (Section 16, Draft Order
  // Settings); fall back to the same default Snake Draft generator the
  // settings dialog uses so this still renders something sensible before
  // anyone has ever saved a custom order.
  const rounds = useMemo(() => {
    if (Array.isArray(settings?.draftOrder) && settings.draftOrder.length > 0) return settings.draftOrder
    return generateSnakeDraft(teamCount, playersPerTeam)
  }, [settings, teamCount, playersPerTeam])

  return (
    <div className="min-h-screen w-full bg-void text-ink-primary font-body flex flex-col lg:h-screen lg:overflow-hidden">
      <div className="w-full flex flex-col flex-1 lg:min-h-0 px-4 sm:px-5 lg:px-6 py-5 gap-5">
        {/* ---------- Top Bar: one complete dashboard section ---------- */}
        <header className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow shrink-0 flex flex-col gap-5 px-5 py-5 sm:px-6">
          {/* main row: left controls / center status / right action */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
            {/* left area -- temporary dev controls */}
            <div className="lg:col-span-3 flex flex-row lg:flex-col gap-2.5 order-2 lg:order-1">
              <button
                type="button"
                onClick={onExitToLobby}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-dashed border-panel-line text-xs text-ink-faint hover:text-ink-muted hover:border-ink-faint transition"
                title="临时开发按钮，后续阶段将移除"
              >
                <Icon.arrowLeft className="w-3.5 h-3.5" />
                返回锦标赛大厅
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-panel-line text-xs text-ink-faint opacity-60 cursor-not-allowed"
                title="选人逻辑上线后启用"
              >
                <Icon.undo className="w-3.5 h-3.5" />
                撤销上一次选择
              </button>
            </div>

            {/* center area -- tournament name, stage, current turn, progress */}
            <div className="lg:col-span-6 order-1 lg:order-2 flex flex-col items-center text-center gap-2 min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                <Icon.flag className="w-3.5 h-3.5 text-teal" />
                <span className="truncate max-w-[70vw] sm:max-w-none">{tournamentName}</span>
              </div>

              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal/10 border border-teal/40 text-teal text-xs font-medium tracking-wide">
                <Icon.layers className="w-3.5 h-3.5" />
                队长顺位阶段
              </span>

              <p className="text-xs text-ink-muted">
                第1轮，共{totalRounds}轮
              </p>

              <p className="font-display text-lg sm:text-xl font-semibold tracking-wide text-ink-primary">
                当前轮到 <span className="text-teal">一号队 队长 LongDD</span>
              </p>
            </div>

            {/* right area -- future action */}
            <div className="lg:col-span-3 order-3 flex justify-center lg:justify-end">
              <button
                type="button"
                onClick={() => showToast('该功能将在后续阶段开放，敬请期待')}
                className="inline-flex items-center gap-2 bg-teal text-void font-semibold tracking-wide text-sm px-4 py-2.5 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99]"
              >
                进入最终对阵
                <Icon.arrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* draft order -- part of the Top Bar, one horizontal strip */}
          <div className="border-t border-panel-line pt-4">
            <p className="text-[11px] text-ink-muted mb-2.5">
              完整选秀顺序 · 共{totalRounds}轮 {teamCount * totalRounds} 个选人顺位
            </p>
            <div className="overflow-x-auto pb-1">
              <div className="flex items-center gap-5 w-max">
                {rounds.map((round, ri) => (
                  <div key={ri} className="flex items-center gap-2.5 shrink-0">
                    <span className="text-xs text-ink-muted font-medium shrink-0">{roundLabel(ri + 1)}</span>
                    <div className="flex items-center gap-1.5">
                      {round.map((teamNumber, pi) => {
                        const isFirst = ri === 0 && pi === 0
                        return (
                          <span
                            key={pi}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-semibold tabular-nums border ${
                              isFirst
                                ? 'bg-teal text-void border-teal shadow-teal-glow'
                                : 'bg-panel-alt text-ink-muted border-panel-line'
                            }`}
                          >
                            {teamNumber}
                          </span>
                        )
                      })}
                    </div>
                    {ri < rounds.length - 1 && <span className="w-px h-5 bg-panel-line ml-2.5" />}
                  </div>
                ))}
                {rounds.length === 0 && <span className="text-xs text-ink-faint">暂无选秀顺序，请先在锦标赛设置中配置</span>}
              </div>
            </div>
          </div>

          {/* bottom area -- reserved for future draft progress visualization */}
          <div className="h-1.5 rounded-full bg-panel-alt overflow-hidden">
            <div className="h-full w-0 rounded-full bg-teal shadow-teal-glow" />
          </div>
        </header>

        {/* draft arena body -- future Phase 5 parts land here */}
        <section className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow flex-1 lg:min-h-0 flex items-center justify-center px-5 py-10">
          <p className="text-sm text-ink-faint text-center max-w-md">
            选秀台正在建设中，后续阶段将在此处逐步添加队长分配、选秀顺序执行与选人功能。
          </p>
        </section>
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-panel-alt border border-teal/40 shadow-teal-glow text-ink-primary text-xs px-4 py-3 rounded-lg flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-teal" />
          {toast}
        </div>
      )}
    </div>
  )
}
