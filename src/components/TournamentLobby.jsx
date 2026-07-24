import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchLobby, subscribeLobby, joinTournament, leaveTournament, isOnline } from '../lib/tournamentApi.js'

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
}

const ROLE_LABEL = { captain: '队长', player: '队员' }

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

  async function handleLeave() {
    setBusy(true)
    try {
      await leaveTournament()
      showToast('已退出锦标赛')
      loadLobby()
    } catch (err) {
      showToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-void text-ink-primary font-body px-5 py-8 sm:px-8 lg:px-12">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* header */}
        <header className="flex items-center justify-between gap-3 flex-wrap">
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
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 ml-2 pl-3 border-l border-panel-line text-xs text-ink-muted hover:text-danger transition"
              >
                <Icon.logout className="w-4 h-4" />
                退出登录
              </button>
            </div>
          </div>
        </header>

        {/* stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon="users" label="参赛总人数" value={stats.total} />
          <StatCard icon="crown" label="在线队长" value={stats.onlineCaptains} />
          <StatCard icon="bolt" label="在线队员" value={stats.onlinePlayers} />
        </div>

        {/* join / leave */}
        <section className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-5 py-6 sm:px-6 sm:py-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold tracking-wide text-ink-primary mb-1">
              {joined ? '你已加入锦标赛' : '尚未加入锦标赛'}
            </h2>
            <p className="text-xs text-ink-muted">
              {joined
                ? '断开连接不会让你退出比赛，只有点击“退出比赛”才会永久移除参赛资格。'
                : '点击“参加比赛”加入本次锦标赛，实时同步到所有在线用户。'}
            </p>
          </div>
          {joined ? (
            <button
              type="button"
              onClick={handleLeave}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 bg-danger text-void font-semibold tracking-wide text-sm px-6 py-3 rounded-lg transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
            >
              <Icon.door className="w-4 h-4" />
              {busy ? '处理中…' : '退出比赛'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 bg-teal text-void font-semibold tracking-wide text-sm px-6 py-3 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
            >
              <Icon.flag className="w-4 h-4" />
              {busy ? '处理中…' : '参加比赛'}
            </button>
          )}
        </section>

        {/* participant list */}
        <section className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-5 py-6 sm:px-6 sm:py-7">
          <h2 className="font-display text-base font-semibold tracking-wide text-ink-primary mb-5">参赛玩家</h2>

          <div className="overflow-x-auto rounded-xl border border-panel-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-panel-alt text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left font-medium px-4 py-3">头像</th>
                  <th className="text-left font-medium px-4 py-3">昵称</th>
                  <th className="text-left font-medium px-4 py-3">身份</th>
                  <th className="text-left font-medium px-4 py-3">加入时间</th>
                  <th className="text-left font-medium px-4 py-3">状态</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.accountId} className="border-t border-panel-line hover:bg-panel-alt/60 transition">
                    <td className="px-4 py-3">
                      <Avatar src={p.avatarUrl} alt={`${p.displayName} 的头像`} />
                    </td>
                    <td className="px-4 py-3 text-ink-primary">
                      {p.displayName}
                      {p.accountId === account.id && <span className="ml-2 text-[11px] text-teal">（我）</span>}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={p.tournamentRole} />
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{formatDateTime(p.joinedAt)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge online={isOnline(p.lastSeenAt, now)} />
                    </td>
                  </tr>
                ))}
                {participants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-ink-faint text-xs">
                      暂无玩家参赛，成为第一个参赛的人吧
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
    </div>
  )
}
