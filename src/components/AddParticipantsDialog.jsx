import { useEffect, useMemo, useState } from 'react'
import { fetchUsers } from '../lib/adminApi.js'
import { addParticipants } from '../lib/tournamentApi.js'

// 添加参赛选手 (Tournament Lobby, Admin/Developer-only) -- lets staff
// manually add any already-registered account straight onto the roster,
// instead of waiting for that person to click 参加比赛 themselves. A
// sibling modal to TournamentSettingsDialog.jsx (same fixed-backdrop shell,
// same "fetch on open" approach -- `accounts` has no bearing on this
// dialog's own lifecycle, so there's no reason to keep a Realtime
// subscription open just for the few seconds this is up), not a page.
//
// Avatar/GenderIcon/RoleBadge below are deliberate verbatim duplicates of
// TournamentLobby.jsx's/AdminDashboard.jsx's own copies (down to the
// exact classes/paths), the same "kept as an exact duplicate, not a
// shared import" convention this page's own `trash` icon already
// documents -- this project's per-file components are allowed to drift
// independently on purpose, even when pixel-identical today.
function Avatar({ src, alt, size = 'w-9 h-9' }) {
  return (
    <div className={`${size} rounded-md bg-panel-alt border border-panel-line overflow-hidden flex items-center justify-center shrink-0`}>
      {src ? (
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 text-ink-muted">
          <circle cx="12" cy="8" r="3.4" />
          <path d="M4.5 20c1.2-3.8 4.2-5.8 7.5-5.8s6.3 2 7.5 5.8" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
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

const ROLE_LABEL = { captain: '队长', player: '队员' }

// Rounded-rectangle badge for 角色 (tournament_role) -- **shape reverted,
// by explicit report:** this was briefly a `rounded-full` pill with a
// glow (see the still-there history in git/prior DEVLOG entries for why),
// but a follow-up explicit request asked for a rounded rectangle instead
// -- `rounded-md`, the same corner radius every other badge in this app
// (this dialog's own `Avatar`, both `RoleBadge` source pages, `StatCard`,
// etc.) already uses, rather than the one-off pill shape. Kept the
// `w-fit`/`justify-center` fix from that pill era (still needed: as a
// direct grid child it still stretches to fill its column without it,
// regardless of corner radius) and the `#00A2E8` captain accent/
// border-only-for-队员 choices, just square-cornered now.
//
// **`justify-self-end`/`text-right` added then removed, both by explicit
// report:** briefly pinned the badge (and the 角色 header label above it)
// to the column's right edge, matching 已选择 N 人's right-aligned
// position two rows up -- reverted on a follow-up request back to the
// column's natural left edge, the same side every other column (头像/
// 昵称/性别) already aligns to, so 角色 doesn't stand out as the one
// right-aligned column in an otherwise left-aligned table.
// Pill shape (`rounded-full`) again, by explicit request extending the
// change to every 角色 badge app-wide (Section 8, "参赛名单's
// RoleBadge/StatusBadge"). This specific badge has now gone rounded-md ->
// rounded-full -> rounded-md -> rounded-full across four separate explicit
// requests (its own entry above has the full history) -- the `w-fit`/
// `justify-center` grid-stretch fix and the #00A2E8 tint/glow from that
// history stay exactly as they were; only the corner radius changed again.
function RoleBadge({ role }) {
  if (!role) {
    return <span className="inline-flex items-center justify-center w-fit px-2.5 py-1 rounded-full text-xs text-ink-faint">—</span>
  }
  const isCaptain = role === 'captain'
  return (
    <span
      className={`inline-flex items-center justify-center w-fit gap-1 px-2.5 py-1 rounded-full text-xs border ${
        isCaptain
          ? 'bg-[#00A2E8]/10 border-[#00A2E8]/60 text-[#00A2E8] shadow-[0_0_10px_-2px_rgba(0,162,232,0.6)]'
          : 'bg-panel-alt text-ink-muted border-panel-line'
      }`}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

function SearchIcon(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.6-4.6" strokeLinecap="round" />
    </svg>
  )
}

// existingParticipantIds: Set of account ids already on the roster --
// those rows render checked-off/disabled rather than being filtered out
// entirely, so the admin can still see (and understand why they can't
// re-add) someone who already joined. is_temp accounts are excluded
// outright, not just disabled: those exist solely for 创建临时玩家/
// 移除临时玩家 (DEVLOG.md Section 7) and are always already joined the
// moment they're created anyway, so this dialog has nothing useful to add
// for them.
export default function AddParticipantsDialog({ existingParticipantIds, onClose, onAdded }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchUsers()
      .then((data) => {
        if (cancelled) return
        setUsers(data.filter((u) => !u.is_temp))
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

  // Real-time filter by 昵称 (display name), same contains/lowercase match
  // Admin Dashboard's own 已注册用户 search already uses.
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.display_name.toLowerCase().includes(q))
  }, [users, search])

  function toggle(id) {
    if (existingParticipantIds.has(id)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectableFilteredIds = useMemo(
    () => filteredUsers.filter((u) => !existingParticipantIds.has(u.id)).map((u) => u.id),
    [filteredUsers, existingParticipantIds]
  )
  const allFilteredSelected = selectableFilteredIds.length > 0 && selectableFilteredIds.every((id) => selected.has(id))

  function toggleSelectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        selectableFilteredIds.forEach((id) => next.delete(id))
      } else {
        selectableFilteredIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  async function handleSubmit() {
    if (selected.size === 0) return
    setSubmitting(true)
    setError(null)
    try {
      await addParticipants(Array.from(selected))
      onAdded?.(selected.size)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={submitting ? undefined : onClose} />
      <div className="relative w-full max-w-[400px] max-h-[85vh] flex flex-col bg-panel/95 backdrop-blur-md border border-accent/20 shadow-accent-glow rounded-2xl px-6 py-6 light-glow-card">
        <h3 className="font-display text-base font-semibold tracking-wide text-ink-primary mb-1 shrink-0">添加参赛选手</h3>
        <p className="text-xs text-ink-muted mb-4 shrink-0">从已注册用户中选择要加入本次锦标赛的选手，可多选。</p>

        <div className="relative shrink-0 mb-3">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按昵称搜索"
            className="w-full bg-panel-2/60 border border-panel-line rounded-lg pl-10 pr-3 py-2.5 text-sm text-ink-primary placeholder-ink-faint outline-none transition focus:border-accent2/60 focus:bg-panel-2 focus:shadow-accent-glow"
          />
        </div>

        <div className="flex items-center justify-between mb-2 shrink-0">
          <button
            type="button"
            onClick={toggleSelectAllFiltered}
            disabled={selectableFilteredIds.length === 0}
            className="text-xs text-accent2 hover:text-ink-primary transition disabled:opacity-40 disabled:pointer-events-none"
          >
            {allFilteredSelected ? '取消全选' : '全选当前结果'}
          </button>
          <span className="text-xs text-ink-muted">
            已选择 <span className="text-ink-primary font-semibold tabular-nums">{selected.size}</span> 人
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-auto -mx-1 px-1">
          {loading ? (
            <p className="text-xs text-ink-muted py-8 text-center">加载中…</p>
          ) : filteredUsers.length === 0 ? (
            <p className="text-xs text-ink-faint py-8 text-center">未找到匹配的用户</p>
          ) : (
            <div>
              {/* Header row: same "muted text, bottom border" language as
                  the main roster table's <thead> (TournamentLobby.jsx),
                  just as a grid row instead of a <table> row -- this
                  dialog needs a leading checkbox column the roster table
                  doesn't have, so a fixed-width CSS grid template keeps
                  every column pinned under its header without needing
                  <table>/<colgroup> to do it. */}
              <div className="sticky top-0 z-10 bg-panel/95 backdrop-blur-sm grid grid-cols-[36px_48px_130px_60px_72px] items-center py-2.5 text-xs text-ink-muted border-b border-panel-line">
                <span />
                <span className="font-medium">头像</span>
                <span className="font-medium">昵称</span>
                <span className="font-medium">性别</span>
                <span className="font-medium">角色</span>
              </div>
              {filteredUsers.map((u) => {
                const alreadyIn = existingParticipantIds.has(u.id)
                const isSelected = selected.has(u.id)
                const checked = alreadyIn || isSelected
                return (
                  <div
                    key={u.id}
                    onClick={() => toggle(u.id)}
                    className={`grid grid-cols-[36px_48px_130px_60px_72px] items-center py-2.5 border-b border-panel-line/35 transition ${
                      alreadyIn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-panel-alt/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={alreadyIn}
                      onChange={() => toggle(u.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-panel-line text-accent2 accent-accent2 disabled:cursor-not-allowed"
                    />
                    <Avatar src={u.avatar_url} alt={`${u.display_name} 的头像`} />
                    <span className="min-w-0 text-sm text-ink-primary font-medium truncate pr-2">
                      {u.display_name}
                      {alreadyIn && <span className="text-ink-faint font-normal text-xs"> （已参赛）</span>}
                    </span>
                    <GenderIcon gender={u.gender} />
                    <RoleBadge role={u.tournament_role} />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-danger mt-3 shrink-0">{error}</p>}

        <div className="flex gap-3 pt-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg border border-panel-line text-sm text-ink-muted hover:text-ink-primary hover:border-ink-muted transition disabled:opacity-60 disabled:pointer-events-none"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selected.size === 0}
            className="btn-primary flex-1 text-sm py-2.5"
          >
            {submitting ? '添加中…' : selected.size > 0 ? `添加 ${selected.size} 人` : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
