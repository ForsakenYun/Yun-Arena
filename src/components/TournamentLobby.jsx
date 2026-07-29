import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchLobby, subscribeLobby, joinTournament, leaveTournament, removeParticipant, rollTournamentNumbers, clearTournament, isOnline } from '../lib/tournamentApi.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import TournamentSettingsDialog from './TournamentSettingsDialog.jsx'

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
        isCaptain ? 'bg-teal/10 text-teal border-teal/40' : 'bg-panel-alt text-ink-muted border-panel-line'
      }`}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

function StatusBadge({ online }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
        online ? 'bg-teal/10 text-teal border-teal/40' : 'bg-panel-alt text-ink-muted border-panel-line'
      }`}
    >
      <span>{online ? '🟢' : '🔴'}</span>
      {online ? '在线' : '离线'}
    </span>
  )
}

function StatCard({ icon, label, value }) {
  const IconCmp = Icon[icon]
  return (
    <div className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-5 py-5 flex items-center gap-4">
      <span className="w-11 h-11 rounded-xl bg-teal/10 border border-teal/40 flex items-center justify-center shrink-0">
        <IconCmp className="w-5 h-5 text-teal" />
      </span>
      <div className="leading-tight">
        <p className="text-2xl font-display font-semibold text-ink-primary">{value}</p>
        <p className="text-xs text-ink-muted mt-0.5">{label}</p>
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

  // Initial load + realtime sync (Section: real-time synchronization).
  useEffect(() => {
    loadLobby()
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

  // Phase 5 -- Draft System (Section 11, Roadmap) has now started. This is
  // still a temporary wire-up for development: it just jumps straight into
  // the Draft Arena with no captain/team assignment or draft logic behind
  // it yet -- see DraftArena.jsx and its Phase 5 scope note.
  function handleStartTournament() {
    window.location.hash = 'draft'
  }

  return (
    <div className="min-h-screen w-full bg-void text-ink-primary font-body flex flex-col lg:h-screen lg:overflow-hidden">
      <div className="w-full flex flex-col flex-1 lg:min-h-0 px-4 sm:px-5 lg:px-6 py-5 gap-5">
        {/* header */}
        <header className="flex items-center justify-between gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-teal/10 border border-teal/40 flex items-center justify-center shadow-teal-glow">
              <Icon.flag className="w-5 h-5 text-teal" />
            </span>
            <div>
              <h1 className="font-display text-xl font-semibold tracking-wide text-ink-primary">锦标赛大厅</h1>
              <p className="text-xs text-ink-muted">选秀台 · 锦标赛参赛</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isStaff && (
              <button
                type="button"
                onClick={onOpenAdmin}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-teal/40 text-teal text-sm font-medium tracking-wide hover:bg-teal/10 hover:shadow-teal-glow transition"
              >
                <Icon.dashboard className="w-4 h-4" />
                管理后台
              </button>
            )}
            <div className="flex items-center gap-3 bg-panel border border-teal/15 rounded-xl pl-2.5 pr-2 py-2">
              <Avatar src={account.avatar_url} alt={`${account.display_name} 的头像`} size="w-8 h-8" />
              <div className="leading-tight">
                <p className="text-xs text-ink-muted">当前登录</p>
                <p className="text-sm text-ink-primary font-medium">{account.display_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmingLogout(true)}
                className="inline-flex items-center gap-1.5 ml-2 pl-3 border-l border-panel-line text-xs text-ink-muted hover:text-danger transition"
              >
                <Icon.logout className="w-4 h-4" />
                退出登录
              </button>
            </div>
          </div>
        </header>

        {/* stats + join/leave: side by side on desktop instead of stacked */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 shrink-0">
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon="users" label="参赛总人数" value={stats.total} />
            <StatCard icon="crown" label="在线队长" value={stats.onlineCaptains} />
            <StatCard icon="bolt" label="在线队员" value={stats.onlinePlayers} />
          </div>

          {/* join / leave */}
          <section className="lg:col-span-5 bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-5 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold tracking-wide text-ink-primary mb-1">
                {joined ? '你已加入锦标赛' : '尚未加入锦标赛'}
              </h2>
              <p className="text-xs text-ink-muted leading-relaxed">
                {joined
                  ? '断开连接不会让你退出比赛，只有点击“退出比赛”才会永久移除参赛资格。'
                  : '点击“参加比赛”加入本次锦标赛，实时同步到所有在线用户。'}
              </p>
            </div>
            {joined ? (
              <button
                type="button"
                onClick={handleLeave}
                className="inline-flex items-center justify-center gap-2 shrink-0 bg-danger text-void font-semibold tracking-wide text-sm px-6 py-3 rounded-lg transition hover:brightness-110 active:scale-[0.99]"
              >
                <Icon.door className="w-4 h-4" />
                退出比赛
              </button>
            ) : (
              <button
                type="button"
                onClick={handleJoin}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 shrink-0 bg-teal text-void font-semibold tracking-wide text-sm px-6 py-3 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
              >
                <Icon.flag className="w-4 h-4" />
                {busy ? '处理中…' : '参加比赛'}
              </button>
            )}
          </section>
        </div>

        {/* admin/developer tournament controls */}
        {isStaff && (
          <div className="flex items-center gap-3 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-teal/40 text-teal text-sm font-medium tracking-wide hover:bg-teal/10 hover:shadow-teal-glow transition"
            >
              <Icon.gear className="w-4 h-4" />
              锦标赛设置
            </button>
            <button
              type="button"
              onClick={handleRoll}
              disabled={rolling}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-teal/40 text-teal text-sm font-medium tracking-wide hover:bg-teal/10 hover:shadow-teal-glow transition disabled:opacity-60 disabled:pointer-events-none"
            >
              <Icon.dice className="w-4 h-4" />
              {rolling ? '摇号中…' : '随机摇号'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-danger/40 text-danger text-sm font-medium tracking-wide hover:bg-danger/10 transition"
            >
              <Icon.sweep className="w-4 h-4" />
              清空参赛名单
            </button>
            <button
              type="button"
              onClick={handleStartTournament}
              className="inline-flex items-center gap-2 bg-teal text-void font-semibold tracking-wide text-sm px-4 py-2.5 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99]"
            >
              <Icon.play className="w-4 h-4" />
              开始比赛
            </button>
          </div>
        )}

        {/* participant list — fills remaining height on desktop; only this area scrolls */}
        <section className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow flex flex-col lg:flex-1 lg:min-h-0 overflow-hidden">
          <div className="px-5 pt-6 pb-4 sm:px-6 shrink-0 flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold tracking-wide text-ink-primary">参赛玩家</h2>
            <span className="text-xs text-ink-muted">{participants.length} 人参赛</span>
          </div>

          <div className="flex-1 lg:min-h-0 overflow-y-auto px-5 pb-6 sm:px-6">
            <div className="rounded-xl border border-panel-line overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-panel-alt text-ink-muted text-xs uppercase tracking-wide">
                    <th className="sticky top-0 z-10 bg-panel-alt text-left font-medium px-4 py-3">头像</th>
                    <th className="sticky top-0 z-10 bg-panel-alt text-left font-medium px-4 py-3">昵称</th>
                    <th className="sticky top-0 z-10 bg-panel-alt text-left font-medium px-4 py-3">性别</th>
                    <th className="sticky top-0 z-10 bg-panel-alt text-left font-medium px-4 py-3">抽签号</th>
                    <th className="sticky top-0 z-10 bg-panel-alt text-left font-medium px-4 py-3">身份</th>
                    <th className="sticky top-0 z-10 bg-panel-alt text-left font-medium px-4 py-3">加入时间</th>
                    <th className="sticky top-0 z-10 bg-panel-alt text-left font-medium px-4 py-3">状态</th>
                    {isStaff && <th className="sticky top-0 z-10 bg-panel-alt text-left font-medium px-4 py-3">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedParticipants.map((p) => (
                    <tr key={p.accountId} className="border-t border-panel-line hover:bg-panel-alt/60 transition">
                      <td className="px-4 py-3">
                        <Avatar src={p.avatarUrl} alt={`${p.displayName} 的头像`} />
                      </td>
                      <td className="px-4 py-3 text-ink-primary">
                        {p.displayName}
                        {p.accountId === account.id && <span className="ml-2 text-[11px] text-teal">（我）</span>}
                      </td>
                      <td className="px-4 py-3">
                        <GenderIcon gender={p.gender} />
                      </td>
                      <td className="px-4 py-3">
                        {p.rollNumber != null ? (
                          <span className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded-lg bg-teal/10 border border-teal/40 text-teal text-xs font-semibold tabular-nums">
                            {p.rollNumber}
                          </span>
                        ) : (
                          <span className="text-ink-faint text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={p.tournamentRole} />
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{formatDateTime(p.joinedAt)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge online={isOnline(p.lastSeenAt, now)} />
                      </td>
                      {isStaff && (
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setRemovingParticipant(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-panel-line text-xs text-ink-muted hover:text-danger hover:border-danger/40 transition"
                          >
                            <Icon.userMinus className="w-3.5 h-3.5" />
                            移除
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {participants.length === 0 && (
                    <tr>
                      <td colSpan={isStaff ? 8 : 7} className="px-4 py-8 text-center text-ink-faint text-xs">
                        暂无玩家参赛，成为第一个参赛的人吧
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-panel-alt border border-teal/40 shadow-teal-glow text-ink-primary text-xs px-4 py-3 rounded-lg flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-teal" />
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

      {showSettings && (
        <TournamentSettingsDialog
          onClose={() => setShowSettings(false)}
          onSaved={() => showToast('锦标赛设置已保存')}
        />
      )}
    </div>
  )
}
