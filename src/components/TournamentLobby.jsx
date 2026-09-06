import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchLobby,
  subscribeLobby,
  joinTournament,
  leaveTournament,
  removeParticipant,
  rollTournamentNumbers,
  clearTournament,
  isOnline,
  fetchTournamentSettings,
  createTempParticipants,
  removeTempParticipants,
} from '../lib/tournamentApi.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import TournamentSettingsDialog from './TournamentSettingsDialog.jsx'
import AppShell from './AppShell.jsx'
import { TileRow, Badge, LiveDot } from './ui.jsx'

/* ---------- inline icons (kept consistent with AuthPage.jsx / AdminDashboard.jsx) ---------- */
const Icon = {
  user: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.5 20c1.2-3.8 4.2-5.8 7.5-5.8s6.3 2 7.5 5.8" strokeLinecap="round" />
    </svg>
  ),
  logout: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M9.5 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4h3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 16l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 12H9.8" strokeLinecap="round" />
    </svg>
  ),
  flag: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M6 3.5v17" strokeLinecap="round" />
      <path d="M6 4.5c2-1 4-1 6 0s4 1 6 0v9c-2 1-4 1-6 0s-4-1-6 0v-9Z" strokeLinejoin="round" />
    </svg>
  ),
  users: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M2.8 19c1-3.2 3.3-4.8 5.7-4.8s4.7 1.6 5.7 4.8" strokeLinecap="round" />
      <path d="M15 8.3a2.6 2.6 0 1 1 3-2.6" strokeLinecap="round" />
      <path d="M15.5 14.4c2 .3 3.5 1.7 4.3 4.3" strokeLinecap="round" />
    </svg>
  ),
  crown: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M4 18h16" strokeLinecap="round" />
      <path d="M4.5 18l-1.3-9 5 3.3L12 6l3.8 6.3 5-3.3-1.3 9Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  bolt: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M13 3.5L5.5 13.5h5.2L10.5 20.5l7.8-10.4h-5.4L13 3.5Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  door: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M14.5 4H8a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 8 20h6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12H10.3" strokeLinecap="round" />
      <path d="M14.5 8.5L10.3 12l4.2 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  dashboard: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="4" y="4" width="7" height="7" rx="1.3" />
      <rect x="13" y="4" width="7" height="4.5" rx="1.3" />
      <rect x="13" y="11.5" width="7" height="8.5" rx="1.3" />
      <rect x="4" y="13.5" width="7" height="6.5" rx="1.3" />
    </svg>
  ),
  userMinus: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.3 19c1-3.1 3.1-4.7 5.7-4.7s4.7 1.6 5.7 4.7" strokeLinecap="round" />
      <path d="M15.5 10h6" strokeLinecap="round" />
    </svg>
  ),
  userPlus: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.3 19c1-3.1 3.1-4.7 5.7-4.7s4.7 1.6 5.7 4.7" strokeLinecap="round" />
      <path d="M18.5 7v6M15.5 10h6" strokeLinecap="round" />
    </svg>
  ),
  alert: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 4.2l9 15.6H3l9-15.6Z" strokeLinejoin="round" />
      <path d="M12 10v3.6" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  dice: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.3" cy="8.3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="8.3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.3" cy="15.7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="15.7" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  sweep: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M5 7h14" strokeLinecap="round" />
      <path d="M7 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5L17 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 7V4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5V7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  gear: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3.5v2.1M12 18.4v2.1M20.5 12h-2.1M5.6 12H3.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5M17.7 17.7l-1.5-1.5M7.8 7.8L6.3 6.3"
        strokeLinecap="round"
      />
    </svg>
  ),
  play: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M7 5.3v13.4a1 1 0 0 0 1.5.87l11-6.7a1 1 0 0 0 0-1.74l-11-6.7A1 1 0 0 0 7 5.3Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  eye: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
}

const ROLE_LABEL = { captain: '队长', player: '队员' }

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function GenderIcon({ gender, className = 'w-4 h-4' }) {
  if (gender === 'male') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`${className} text-sky-400`} aria-label="男生">
        <circle cx="10" cy="14" r="6" />
        <path d="M14.3 9.7L21 3M21 3h-5.5M21 3v5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (gender === 'female') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`${className} text-pink-400`} aria-label="女生">
        <circle cx="12" cy="9" r="6.5" />
        <path d="M12 15.5V22M8.5 19h7" strokeLinecap="round" />
      </svg>
    )
  }
  return <span className="text-ink-faint text-xs">—</span>
}

function Avatar({ src, alt, size = 'w-9 h-9' }) {
  return (
    <div className={`${size} rounded-md bg-panel-alt border border-panel-line overflow-hidden flex items-center justify-center shrink-0`}>
      {src ? (
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      ) : (
        <Icon.user className="w-4 h-4 text-ink-muted" />
      )}
    </div>
  )
}

function RoleBadge({ role }) {
  if (!role) {
    return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs text-ink-faint">—</span>
  }
  const isCaptain = role === 'captain'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border ${
        isCaptain ? 'bg-gold/10 text-gold border-gold/40' : 'bg-panel-alt text-ink-muted border-panel-line'
      }`}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

function StatusDot({ online }) {
  return (
    <span
      className={`block w-2.5 h-2.5 rounded-full border-2 border-panel ${online ? 'bg-success animate-pulseGlow' : 'bg-ink-faint'}`}
      title={online ? '在线' : '离线'}
    />
  )
}

function RailStat({ icon, label, value }) {
  const IconCmp = Icon[icon]
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg bg-panel-alt/60 border border-panel-line py-3">
      <IconCmp className="w-4 h-4 text-accent2" />
      <span className="text-lg font-display font-bold text-ink-primary leading-none tabular-nums">{value}</span>
      <span className="text-[10px] text-ink-muted leading-none">{label}</span>
    </div>
  )
}

function RailAction({ icon, label, onClick, disabled, tone = 'default', title }) {
  const IconCmp = Icon[icon]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none ${
        tone === 'danger'
          ? 'border-panel-line text-ink-muted hover:text-danger hover:border-danger/40 hover:bg-danger/5'
          : 'border-panel-line text-ink-muted hover:text-ink-primary hover:border-accent2/40 hover:bg-accent/5'
      }`}
    >
      <IconCmp className="w-4 h-4 shrink-0" />
      {label}
    </button>
  )
}

function StatusBadge({ online }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
        online ? 'bg-success/10 text-success border-success/40' : 'bg-panel-alt text-ink-muted border-panel-line'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-success animate-pulseGlow' : 'bg-ink-faint'}`} />
      {online ? '在线' : '离线'}
    </span>
  )
}

function StatCard({ icon, label, value }) {
  const IconCmp = Icon[icon]
  return (
    <div className="accent-frame shadow-accent-glow">
      <div className="bg-panel/90 backdrop-blur-sm rounded-[calc(1rem-1px)] px-5 py-5 flex items-center gap-4">
        <span className="w-11 h-11 rounded-xl bg-accent-gradient flex items-center justify-center shrink-0 shadow-accent-glow">
          <IconCmp className="w-5 h-5 text-void" />
        </span>
        <div className="leading-tight">
          <p className="text-2xl font-display font-bold text-ink-primary tabular-nums">{value}</p>
          <p className="text-xs text-ink-muted mt-0.5">{label}</p>
        </div>
      </div>
    </div>
  )
}

// Shown when 开始比赛 is clicked but the joined-participant counts don't
// exactly match what the current Tournament Settings require (Phase 5 --
// Tournament Participant Synchronization). Purely informational/blocking
// -- there's nothing to "confirm" here, just one dismiss button -- so this
// is its own small component rather than reusing ConfirmDialog, which is
// shaped around a confirm/cancel action pair.
function StartValidationRow({ label, current, required }) {
  const ok = current === required
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-panel-alt border border-panel-line">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums">
        <span className={ok ? 'text-success' : 'text-danger'}>{current}</span>
        <span className="text-ink-faint"> / {required}</span>
      </span>
    </div>
  )
}

function StartValidationDialog({ result, onClose }) {
  const { requiredTotal, requiredCaptains, requiredPlayers, currentTotal, currentCaptains, currentPlayers } = result

  const corrections = []
  if (currentCaptains < requiredCaptains) corrections.push(`还需要 ${requiredCaptains - currentCaptains} 名队长`)
  if (currentCaptains > requiredCaptains) corrections.push(`队长人数超出 ${currentCaptains - requiredCaptains} 人，请移除多余的队长`)
  if (currentPlayers < requiredPlayers) corrections.push(`还需要 ${requiredPlayers - currentPlayers} 名队员`)
  if (currentPlayers > requiredPlayers) corrections.push(`队员人数超出 ${currentPlayers - requiredPlayers} 人，请移除多余的队员`)
  if (corrections.length === 0 && currentTotal !== requiredTotal) {
    corrections.push('参赛总人数与队长、队员人数之和不一致，请检查是否有身份异常的参赛者')
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-panel/95 backdrop-blur-md border border-danger/25 shadow-[0_0_28px_rgba(255,77,109,0.18)] rounded-2xl px-6 py-6">
        <div className="flex items-start gap-3 mb-5">
          <span className="w-9 h-9 rounded-full border flex items-center justify-center shrink-0 bg-danger/10 border-danger/30 text-danger">
            <Icon.alert className="w-4.5 h-4.5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-primary mb-1">锦标赛尚未满足开始条件</h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              参赛人数与身份分配需要与当前锦标赛设置完全一致，才能开始比赛。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 mb-4">
          <StartValidationRow label="参赛总人数" current={currentTotal} required={requiredTotal} />
          <StartValidationRow label="队长人数" current={currentCaptains} required={requiredCaptains} />
          <StartValidationRow label="队员人数" current={currentPlayers} required={requiredPlayers} />
        </div>

        {corrections.length > 0 && (
          <div className="mb-5 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5">
            <p className="text-[11px] font-medium text-danger mb-1.5">需要修正：</p>
            <ul className="space-y-1">
              {corrections.map((c, i) => (
                <li key={i} className="text-xs text-ink-muted flex items-start gap-1.5">
                  <span className="text-danger mt-0.5">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-lg border border-panel-line text-sm text-ink-muted hover:text-ink-primary hover:border-ink-muted transition"
        >
          知道了
        </button>
      </div>
    </div>
  )
}

export default function TournamentLobby({ account, onLogout, onOpenAdmin }) {
  const isStaff = account.permission_role === 'admin' || account.permission_role === 'developer'

  const [participants, setParticipants] = useState([])
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [removingParticipant, setRemovingParticipant] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState(null)
  const [creatingTemp, setCreatingTemp] = useState(false)
  const [confirmingRemoveTemp, setConfirmingRemoveTemp] = useState(false)
  const [removingTemp, setRemovingTemp] = useState(false)
  const [startValidation, setStartValidation] = useState(null)
  const toastTimer = useRef(null)

  function showToast(msg) {
    clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }

  function loadLobby() {
    fetchLobby()
      .then(setParticipants)
      .catch((err) => showToast(err.message))
  }

  // Tournament Settings (锦标赛设置) drive both the Create Temporary
  // Players counts and the 开始比赛 validation below -- fetched on mount
  // and again whenever the settings dialog saves, same "fetch on open /
  // on change" approach already used for the Draft Arena (Section 8).
  // Not on the Realtime publication (Section 7), so this is not live.
  function loadSettings() {
    fetchTournamentSettings()
      .then(setSettings)
      .catch((err) => showToast(err.message))
  }

  // Initial load + realtime sync (Section: real-time synchronization).
  useEffect(() => {
    loadLobby()
    loadSettings()
    const unsubscribe = subscribeLobby(() => loadLobby())
    return unsubscribe
  }, [])

  // Presence has no server push for the mere passage of time -- a closed
  // tab just stops refreshing last_seen_at. Re-evaluate Online/Disconnected
  // locally on a short timer so a gone-quiet player flips to 🔴 on its own.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 3000)
    return () => clearInterval(id)
  }, [])

  const myEntry = useMemo(() => participants.find((p) => p.accountId === account.id), [participants, account.id])
  const joined = !!myEntry

  // Once a roll has happened, the list re-sorts itself highest-first so
  // admins can read off the top rolls at a glance. Participants who join
  // after that roll have no number yet (see tournamentApi.js) and sort to
  // the bottom, below every numbered row. Before any roll has ever
  // happened, nobody has a number, so the list stays in its normal
  // join-order.
  const sortedParticipants = useMemo(() => {
    const hasRoll = participants.some((p) => p.rollNumber != null)
    if (!hasRoll) return participants
    return [...participants].sort((a, b) => {
      if (a.rollNumber == null && b.rollNumber == null) return 0
      if (a.rollNumber == null) return 1
      if (b.rollNumber == null) return -1
      return b.rollNumber - a.rollNumber
    })
  }, [participants])

  const stats = useMemo(() => {
    let onlineCaptains = 0
    let onlinePlayers = 0
    for (const p of participants) {
      if (!isOnline(p.lastSeenAt, now)) continue
      if (p.tournamentRole === 'captain') onlineCaptains += 1
      else if (p.tournamentRole === 'player') onlinePlayers += 1
    }
    return {
      total: participants.length,
      onlineCaptains,
      onlinePlayers,
    }
  }, [participants, now])

  // Phase 5 -- Tournament Participant Synchronization. Required counts are
  // always derived live from the current Tournament Settings, never
  // hardcoded: requiredCaptains == Number of Teams (the Draft System needs
  // an exact 1:1 captain-to-team match, Section 8), requiredPlayers ==
  // Number of Teams × (Players per Team − 1) (the captain fills the
  // remaining roster seat), requiredTotal == their sum. Used by both
  // "Create Temporary Players" (below) and the 开始比赛 validation.
  const requirement = useMemo(() => {
    const teamCount = settings?.teamCount ?? 0
    const playersPerTeam = settings?.playersPerTeam ?? 0
    const requiredCaptains = Math.max(0, teamCount)
    const requiredPlayers = Math.max(0, teamCount * Math.max(0, playersPerTeam - 1))
    return { teamCount, playersPerTeam, requiredCaptains, requiredPlayers, requiredTotal: requiredCaptains + requiredPlayers }
  }, [settings])

  // Current joined counts by Tournament Role (队长/队员), regardless of
  // online status -- participation, not presence (Section 7).
  const roleCounts = useMemo(() => {
    let captains = 0
    let players = 0
    for (const p of participants) {
      if (p.tournamentRole === 'captain') captains += 1
      else if (p.tournamentRole === 'player') players += 1
    }
    return { captains, players, total: participants.length }
  }, [participants])

  async function handleJoin() {
    setBusy(true)
    try {
      await joinTournament()
      showToast('已加入锦标赛')
      loadLobby()
    } catch (err) {
      showToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  function handleLeave() {
    setConfirmingLeave(true)
  }

  async function confirmLeave() {
    setLeaving(true)
    try {
      await leaveTournament()
      showToast('已退出锦标赛')
      setConfirmingLeave(false)
      loadLobby()
    } catch (err) {
      showToast(err.message)
    } finally {
      setLeaving(false)
    }
  }

  async function confirmLogout() {
    setLoggingOut(true)
    try {
      await onLogout()
    } catch (err) {
      setLoggingOut(false)
      showToast(err.message)
    }
  }

  async function confirmRemoveParticipant() {
    if (!removingParticipant) return
    setRemoving(true)
    try {
      await removeParticipant(removingParticipant.accountId)
      showToast(`已将「${removingParticipant.displayName}」移出锦标赛`)
      setRemovingParticipant(null)
      loadLobby()
    } catch (err) {
      showToast(err.message)
    } finally {
      setRemoving(false)
    }
  }

  async function handleRoll() {
    setRolling(true)
    try {
      await rollTournamentNumbers()
      showToast('摇号完成')
      loadLobby()
    } catch (err) {
      showToast(err.message)
    } finally {
      setRolling(false)
    }
  }

  function handleClear() {
    setConfirmingClear(true)
  }

  async function confirmClear() {
    setClearing(true)
    try {
      await clearTournament()
      showToast('参赛名单已清空')
      setConfirmingClear(false)
      loadLobby()
    } catch (err) {
      showToast(err.message)
    } finally {
      setClearing(false)
    }
  }

  // Phase 5 -- Temporary Testing Buttons. Dev/testing-only: generates real
  // accounts (captain/player split + total sized to the current Tournament
  // Settings, per requirement above) and auto-joins them to the
  // tournament, so 开始比赛 can be exercised before registration is fully
  // rolled out. Requires settings to be loaded so the counts are correct.
  async function handleCreateTempPlayers() {
    if (!settings) {
      showToast('锦标赛设置加载中，请稍候再试')
      return
    }
    setCreatingTemp(true)
    try {
      await createTempParticipants(requirement.requiredCaptains, requirement.requiredPlayers)
      showToast(`已创建 ${requirement.requiredCaptains} 名临时队长与 ${requirement.requiredPlayers} 名临时队员`)
      loadLobby()
    } catch (err) {
      showToast(err.message)
    } finally {
      setCreatingTemp(false)
    }
  }

  function handleRemoveTempPlayers() {
    setConfirmingRemoveTemp(true)
  }

  async function confirmRemoveTempPlayers() {
    setRemovingTemp(true)
    try {
      await removeTempParticipants()
      showToast('已移除所有临时测试用户')
      setConfirmingRemoveTemp(false)
      loadLobby()
    } catch (err) {
      showToast(err.message)
    } finally {
      setRemovingTemp(false)
    }
  }

  // Phase 5 -- Draft System (Section 2, Roadmap) has now started.
  // 开始比赛 now validates the joined roster against the current
  // Tournament Settings (Section: Tournament Participant Synchronization)
  // before ever navigating to the Draft Arena: the total joined count,
  // captain count, and player count must each exactly match what the
  // settings require (captains == team count exactly -- the Draft System
  // needs a 1:1 captain-to-team match). Any mismatch blocks navigation and
  // shows StartValidationDialog with the full breakdown instead.
  function handleStartTournament() {
    if (!settings) {
      showToast('锦标赛设置加载中，请稍候再试')
      return
    }
    const { requiredCaptains, requiredPlayers, requiredTotal } = requirement
    const { captains: currentCaptains, players: currentPlayers, total: currentTotal } = roleCounts
    const valid = currentTotal === requiredTotal && currentCaptains === requiredCaptains && currentPlayers === requiredPlayers
    if (!valid) {
      setStartValidation({ requiredTotal, requiredCaptains, requiredPlayers, currentTotal, currentCaptains, currentPlayers })
      return
    }
    window.location.hash = 'draft'
  }

  const nav = [
    { key: 'lobby', icon: 'lobby', label: '锦标赛大厅' },
    ...(isStaff ? [{ key: 'admin', icon: 'admin', label: '管理后台' }] : []),
    { key: 'spectate', icon: 'spectate', label: '观赛' },
  ]

  function handleNavigate(key) {
    if (key === 'admin') return onOpenAdmin?.()
    window.location.hash = key
  }

  return (
    <AppShell
      account={account}
      section="lobby"
      nav={nav}
      onNavigate={handleNavigate}
      onLogout={() => setConfirmingLogout(true)}
    >
      <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-5 p-4 sm:p-5 lg:p-6 overflow-y-auto lg:overflow-hidden">
        {/* ═══ MAIN: roster ═══ */}
        <section className="flex-1 lg:min-h-0 flex flex-col glass-panel border-accent/15 overflow-hidden">
          <div className="px-5 pt-5 pb-4 shrink-0 flex items-center justify-between gap-3 border-b border-panel-line">
            <div>
              <h1 className="font-display text-lg font-bold tracking-wide text-ink-primary">参赛名单</h1>
              <p className="text-xs text-ink-muted mt-0.5">实时同步 · {participants.length} 人已加入</p>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-xs text-ink-muted">
              <span className="flex items-center gap-1.5"><LiveDot active /> {stats.onlineCaptains + stats.onlinePlayers} 人在线</span>
            </div>
          </div>

          <div className="flex-1 lg:min-h-0 overflow-y-auto px-3 py-2">
            {sortedParticipants.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center text-ink-faint text-sm gap-2">
                <Icon.users className="w-8 h-8 opacity-40" />
                暂无玩家参赛，成为第一个参赛的人吧
              </div>
            )}
            {sortedParticipants.map((p) => (
              <TileRow
                key={p.accountId}
                leading={
                  <div className="relative">
                    <Avatar src={p.avatarUrl} alt={`${p.displayName} 的头像`} size="w-9 h-9" />
                    <span className="absolute -bottom-0.5 -right-0.5"><StatusDot online={isOnline(p.lastSeenAt, now)} /></span>
                  </div>
                }
                title={
                  <>
                    {p.displayName}
                    {p.accountId === account.id && <span className="text-accent2 font-normal">（我）</span>}
                  </>
                }
                subtitle={formatDateTime(p.joinedAt)}
                badges={
                  <span className="flex items-center gap-1.5 shrink-0">
                    <GenderIcon gender={p.gender} className="w-3.5 h-3.5" />
                    <RoleBadge role={p.tournamentRole} />
                  </span>
                }
                trailing={
                  <>
                    {p.rollNumber != null ? (
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded-md bg-accent-gradient text-void text-xs font-bold font-mono shadow-accent-glow">
                        {p.rollNumber}
                      </span>
                    ) : (
                      <span className="text-ink-faint text-xs w-8 text-center">—</span>
                    )}
                    {isStaff && (
                      <button
                        type="button"
                        onClick={() => setRemovingParticipant(p)}
                        className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-panel-line text-xs text-ink-muted hover:text-danger hover:border-danger/40 transition"
                      >
                        <Icon.userMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                }
              />
            ))}
          </div>
        </section>

        {/* ═══ RIGHT RAIL: status + actions, the tournament's control panel ═══ */}
        <aside className="lg:w-[340px] shrink-0 flex flex-col gap-4 lg:overflow-y-auto lg:pr-1">
          {/* join/leave — the single most important action for a non-staff visitor */}
          <div className="accent-frame shadow-accent-glow shrink-0">
            <div className="bg-panel/90 backdrop-blur-sm rounded-[calc(1rem-1px)] px-5 py-5">
              <div className="flex items-center gap-2 mb-1.5">
                <LiveDot active={joined} />
                <h2 className="font-display text-sm font-bold tracking-wide text-ink-primary">
                  {joined ? '你已加入锦标赛' : '尚未加入锦标赛'}
                </h2>
              </div>
              <p className="text-xs text-ink-muted leading-relaxed mb-4">
                {joined
                  ? '断开连接不会让你退出比赛，只有点击下方按钮才会永久移除参赛资格。'
                  : '点击下方按钮加入本次锦标赛，实时同步到所有在线用户。'}
              </p>
              {joined ? (
                <button type="button" onClick={handleLeave} className="btn-danger w-full bg-danger/10 py-2.5 text-sm">
                  <Icon.door className="w-4 h-4" />
                  退出比赛
                </button>
              ) : (
                <button type="button" onClick={handleJoin} disabled={busy} className="btn-primary w-full py-2.5 text-sm">
                  <Icon.flag className="w-4 h-4" />
                  {busy ? '处理中…' : '参加比赛'}
                </button>
              )}
            </div>
          </div>

          {/* live stats */}
          <div className="glass-panel border-panel-line px-4 py-4 shrink-0">
            <p className="eyebrow mb-3">实时统计</p>
            <div className="grid grid-cols-3 gap-2">
              <RailStat icon="users" label="总人数" value={stats.total} />
              <RailStat icon="crown" label="在线队长" value={stats.onlineCaptains} />
              <RailStat icon="bolt" label="在线队员" value={stats.onlinePlayers} />
            </div>
          </div>

          {/* staff control panel */}
          {isStaff && (
            <div className="glass-panel border-panel-line px-4 py-4 flex-1 lg:min-h-0 flex flex-col shrink-0">
              <p className="eyebrow mb-3">赛事管理</p>
              <div className="flex flex-col gap-1.5">
                <RailAction icon="gear" label="锦标赛设置" onClick={() => setShowSettings(true)} />
                <RailAction icon="dice" label={rolling ? '摇号中…' : '随机摇号'} onClick={handleRoll} disabled={rolling} />
                <RailAction icon="userPlus" label={creatingTemp ? '创建中…' : '创建临时玩家'} onClick={handleCreateTempPlayers} disabled={creatingTemp || !settings} title="开发测试用：根据当前锦标赛设置自动生成并加入临时队长与队员" />
                <RailAction icon="userMinus" label="移除临时玩家" onClick={handleRemoveTempPlayers} tone="danger" title="开发测试用：移除所有由“创建临时玩家”生成的测试用户" />
                <RailAction icon="sweep" label="清空参赛名单" onClick={handleClear} tone="danger" />
              </div>
              <button type="button" onClick={handleStartTournament} className="btn-primary w-full py-3 text-sm mt-4">
                <Icon.play className="w-4 h-4" />
                开始比赛
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-panel-alt/95 backdrop-blur border border-accent2/40 shadow-accent-glow text-ink-primary text-xs px-4 py-3 rounded-lg flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-pulseGlow" />
          {toast}
        </div>
      )}

      {confirmingLogout && (
        <ConfirmDialog
          title="确认退出登录"
          message="确定要退出登录吗？"
          confirmLabel="确认退出"
          tone="neutral"
          busy={loggingOut}
          onCancel={() => setConfirmingLogout(false)}
          onConfirm={confirmLogout}
        />
      )}

      {confirmingLeave && (
        <ConfirmDialog
          title="确认离开比赛"
          message="确定要离开本次比赛吗？"
          confirmLabel="确认离开"
          tone="danger"
          busy={leaving}
          onCancel={() => setConfirmingLeave(false)}
          onConfirm={confirmLeave}
        />
      )}

      {removingParticipant && (
        <ConfirmDialog
          title="移除参赛者"
          message={`确定要将「${removingParticipant.displayName}」移出本次锦标赛吗？该玩家可以随时重新点击“参加比赛”加入。`}
          confirmLabel="确认移除"
          tone="danger"
          busy={removing}
          onCancel={() => setRemovingParticipant(null)}
          onConfirm={confirmRemoveParticipant}
        />
      )}

      {confirmingClear && (
        <ConfirmDialog
          title="确认清空参赛名单"
          message="确定要移除所有已参加比赛的玩家吗？"
          confirmLabel="确认清空"
          tone="danger"
          busy={clearing}
          onCancel={() => setConfirmingClear(false)}
          onConfirm={confirmClear}
        />
      )}

      {confirmingRemoveTemp && (
        <ConfirmDialog
          title="移除临时玩家"
          message="确定要移除所有由“创建临时玩家”生成的测试用户吗？这不会影响任何真实注册的账号。"
          confirmLabel="确认移除"
          tone="danger"
          busy={removingTemp}
          onCancel={() => setConfirmingRemoveTemp(false)}
          onConfirm={confirmRemoveTempPlayers}
        />
      )}

      {startValidation && (
        <StartValidationDialog result={startValidation} onClose={() => setStartValidation(null)} />
      )}

      {showSettings && (
        <TournamentSettingsDialog
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            showToast('锦标赛设置已保存')
            loadSettings()
          }}
        />
      )}
    </AppShell>
  )
}
