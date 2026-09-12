import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchTournamentSettings,
  saveTournamentSettings,
  draftRoundCount,
  generateSnakeDraft,
  formatDraftRoundInput,
  parseDraftRound,
  validateDraftRound,
} from '../lib/tournamentApi.js'

// The Tournament Settings dialog for the Tournament Lobby. Not a page, not
// an Admin Dashboard tab -- this is the entire "Tournament Configuration"
// feature now (see DEVLOG.md Section 7, Tournament Settings). It always
// loads and saves the one singleton row in public.tournament_settings, so
// reopening it later shows whatever was saved last time.
//
// Draft Order Settings (see DEVLOG.md Section 7, Draft Order Settings)
// extends this same dialog: captains are assigned manually and never
// appear in the draft order, so there are always exactly
// playersPerTeam - 1 rounds, each a permutation of 1..teamCount. This is
// configuration only -- the Draft System itself is a future phase and
// will simply follow whatever order is saved here.
export default function TournamentSettingsDialog({ onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tournamentName, setTournamentName] = useState('')
  const [teamCount, setTeamCount] = useState('')
  const [playersPerTeam, setPlayersPerTeam] = useState('')
  const [roundTexts, setRoundTexts] = useState([])

  // Tracks the team/player-count "shape" the current roundTexts were
  // generated for, so the Snake Draft default only regenerates when the
  // admin actually changes Number of Teams or Players Per Team -- not on
  // every render, and not the moment the loaded (possibly custom) order
  // first appears.
  const shapeRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetchTournamentSettings()
      .then((s) => {
        if (cancelled) return
        setTournamentName(s.tournamentName)
        setTeamCount(String(s.teamCount))
        setPlayersPerTeam(String(s.playersPerTeam))
        const rounds =
          s.draftOrder && s.draftOrder.length === draftRoundCount(s.playersPerTeam)
            ? s.draftOrder
            : generateSnakeDraft(s.teamCount, s.playersPerTeam)
        setRoundTexts(rounds.map((round) => round.join(' ')))
        shapeRef.current = `${s.teamCount}:${s.playersPerTeam}`
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const teamCountNum = Number(teamCount)
  const playersPerTeamNum = Number(playersPerTeam)
  const teamCountValid = Number.isInteger(teamCountNum) && teamCountNum >= 2 && teamCountNum <= 128
  const playersPerTeamValid = Number.isInteger(playersPerTeamNum) && playersPerTeamNum >= 1 && playersPerTeamNum <= 20
  const rounds = playersPerTeamValid ? draftRoundCount(playersPerTeamNum) : 0

  // Regenerating the Snake Draft default used to live in a useEffect keyed
  // on [teamCountNum, playersPerTeamNum, ...]. That runs a render *after*
  // the input's onChange already committed the new teamCount, so for one
  // frame teamCountNum reflected the new value while roundTexts still held
  // the old (now-mismatched) rounds -- exactly the window where
  // roundErrors briefly validated old text against the new team count and
  // flashed red. Doing the regeneration synchronously inside the same
  // change handler that updates teamCount/playersPerTeam, in the same
  // event (same React batch), means there is no render where the two are
  // out of sync -- the fix is removing the race, not hiding its output.
  function maybeRegenerate(nextTeamCount, nextPlayersPerTeam) {
    const tc = Number(nextTeamCount)
    const ppt = Number(nextPlayersPerTeam)
    const tcValid = Number.isInteger(tc) && tc >= 2 && tc <= 128
    const pptValid = Number.isInteger(ppt) && ppt >= 1 && ppt <= 20
    if (!tcValid || !pptValid) return
    const shapeKey = `${tc}:${ppt}`
    if (shapeRef.current === shapeKey) return
    shapeRef.current = shapeKey
    const fresh = generateSnakeDraft(tc, ppt)
    setRoundTexts(fresh.map((round) => round.join(' ')))
  }

  function handleTeamCountChange(value) {
    setTeamCount(value)
    maybeRegenerate(value, playersPerTeam)
  }

  function handlePlayersPerTeamChange(value) {
    setPlayersPerTeam(value)
    maybeRegenerate(teamCount, value)
  }

  const roundErrors = useMemo(() => {
    if (!teamCountValid) return roundTexts.map(() => null)
    return roundTexts.map((text) => validateDraftRound(parseDraftRound(text), teamCountNum))
  }, [roundTexts, teamCountValid, teamCountNum])

  const hasRoundErrors = teamCountValid && roundErrors.some((msg) => msg !== null)
  const canSave = !saving && teamCountValid && playersPerTeamValid && !hasRoundErrors

  function handleRoundChange(index, rawValue) {
    const formatted = teamCountValid ? formatDraftRoundInput(rawValue, teamCountNum) : rawValue
    setRoundTexts((prev) => prev.map((text, i) => (i === index ? formatted : text)))
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const draftOrder = roundTexts.slice(0, rounds).map((text) => parseDraftRound(text))
      const saved = await saveTournamentSettings({
        tournamentName,
        teamCount: teamCountNum,
        playersPerTeam: playersPerTeamNum,
        draftOrder,
      })
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const totalDrafted = teamCountValid && playersPerTeamValid ? teamCountNum * (playersPerTeamNum - 1) : null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={saving ? undefined : onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-panel border border-teal/15 shadow-teal-glow rounded-2xl px-6 py-6">
        <h3 className="font-display text-base font-semibold tracking-wide text-ink-primary mb-5 shrink-0">锦标赛设置</h3>

        {loading ? (
          <p className="text-xs text-ink-muted py-8 text-center">加载中…</p>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col min-h-0 flex-1">
            <div className="space-y-4 overflow-y-auto pr-1 -mr-1">
              <div>
                <label className="block text-xs text-ink-muted mb-1.5">锦标赛名称</label>
                <input
                  type="text"
                  value={tournamentName}
                  onChange={(e) => setTournamentName(e.target.value)}
                  maxLength={60}
                  required
                  placeholder="请输入锦标赛名称"
                  className="w-full bg-panel-alt border border-panel-line rounded-lg px-3 py-2.5 text-sm text-ink-primary placeholder:text-ink-faint focus:outline-none focus:border-teal/50 transition"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-ink-muted mb-1.5">队伍数量</label>
                  <input
                    type="number"
                    min={2}
                    max={128}
                    value={teamCount}
                    onChange={(e) => handleTeamCountChange(e.target.value)}
                    required
                    className="w-full bg-panel-alt border border-panel-line rounded-lg px-3 py-2.5 text-sm text-ink-primary focus:outline-none focus:border-teal/50 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs text-ink-muted mb-1.5">每队人数</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={playersPerTeam}
                    onChange={(e) => handlePlayersPerTeamChange(e.target.value)}
                    required
                    className="w-full bg-panel-alt border border-panel-line rounded-lg px-3 py-2.5 text-sm text-ink-primary focus:outline-none focus:border-teal/50 transition"
                  />
                </div>
              </div>

              <div className="border-t border-panel-line pt-4">
                <h4 className="text-sm font-medium text-ink-primary mb-1">选秀顺序设置</h4>
                {teamCountValid && playersPerTeamValid ? (
                  <p className="text-xs text-ink-muted mb-3">
                    队长由管理员手动指定，不参与选秀。共 {rounds} 轮，每轮 {teamCountNum} 支队伍，共选 {totalDrafted} 名球员。默认按蛇形顺序排列，可自由编辑，用空格分隔队伍编号。
                  </p>
                ) : (
                  <p className="text-xs text-ink-muted mb-3">请先填写有效的队伍数量与每队人数。</p>
                )}

                {teamCountValid && playersPerTeamValid && rounds === 0 && (
                  <p className="text-xs text-ink-faint">每队仅 1 人（队长），无需选秀顺序。</p>
                )}

                {teamCountValid && playersPerTeamValid && rounds > 0 && (
                  <div className="space-y-3">
                    {roundTexts.slice(0, rounds).map((text, index) => (
                      <div key={index}>
                        <label className="block text-xs text-ink-muted mb-1.5">第 {index + 1} 轮</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={text}
                          onChange={(e) => handleRoundChange(index, e.target.value)}
                          className={`w-full bg-panel-alt border rounded-lg px-3 py-2.5 text-sm text-ink-primary tabular-nums focus:outline-none transition ${
                            roundErrors[index] ? 'border-danger/50 focus:border-danger' : 'border-panel-line focus:border-teal/50'
                          }`}
                        />
                        {roundErrors[index] && <p className="text-xs text-danger mt-1">{roundErrors[index]}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && <p className="text-xs text-danger">{error}</p>}
            </div>

            <div className="flex gap-3 pt-4 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 py-2.5 rounded-lg border border-panel-line text-sm text-ink-muted hover:text-ink-primary hover:border-ink-muted transition disabled:opacity-60 disabled:pointer-events-none"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="flex-1 bg-teal text-void font-semibold tracking-wide text-sm py-2.5 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
