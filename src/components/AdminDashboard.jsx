import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchUsers,
  subscribeUsers,
  editUser,
  deleteUser,
  promoteUser,
  demoteUser,
  fetchInviteCodes,
  subscribeInviteEvents,
  createInviteCode,
  deleteInviteCode,
} from '../lib/adminApi.js'

/* ---------- inline icons (kept consistent with AuthPage.jsx) ---------- */
const Icon = {
  user: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.5 20c1.2-3.8 4.2-5.8 7.5-5.8s6.3 2 7.5 5.8" strokeLinecap="round" />
    </svg>
  ),
  lock: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="1.6" />
      <path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" strokeLinecap="round" />
    </svg>
  ),
  eye: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  ),
  eyeOff: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M3 3l18 18" strokeLinecap="round" />
      <path d="M10.6 5.7A10.6 10.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.8 15.8 0 0 1-3.4 4.2M6.6 6.8C4 8.5 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.2 0 2.3-.2 3.3-.6" strokeLinecap="round" />
      <path d="M9.9 10a2.8 2.8 0 0 0 4 4" strokeLinecap="round" />
    </svg>
  ),
  tag: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M11 4.5H6A1.5 1.5 0 0 0 4.5 6v5l8.6 8.6a1.5 1.5 0 0 0 2.12 0l4.38-4.38a1.5 1.5 0 0 0 0-2.12L11 4.5Z" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  ticket: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M3.5 9a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V13a2 2 0 0 1 0-4V7.5A1.5 1.5 0 0 0 19 6H5a1.5 1.5 0 0 0-1.5 1.5V9Z" strokeLinejoin="round" />
      <path d="M9.5 6.5v11" strokeDasharray="2.2 2.2" strokeLinecap="round" />
    </svg>
  ),
  search: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.6-4.6" strokeLinecap="round" />
    </svg>
  ),
  edit: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M4 20l.9-3.7L16.6 4.6a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3L7.7 19.1 4 20Z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M14.8 6.4l2.8 2.8" strokeLinecap="round" />
    </svg>
  ),
  trash: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M5 7h14M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M7.5 7l.7 11.2A1.6 1.6 0 0 0 9.8 19.7h4.4a1.6 1.6 0 0 0 1.6-1.5L16.5 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  copy: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="9" y="9" width="11" height="11" rx="1.6" />
      <path d="M15 9V5.6A1.6 1.6 0 0 0 13.4 4H5.6A1.6 1.6 0 0 0 4 5.6v7.8A1.6 1.6 0 0 0 5.6 15H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  plus: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  x: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" />
    </svg>
  ),
  shield: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 3.5l7 2.6v5.4c0 4.3-2.9 7.9-7 9-4.1-1.1-7-4.7-7-9V6.1l7-2.6Z" strokeLinejoin="round" />
      <path d="M9 12l2.2 2.2L15.5 9.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  alert: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 4.2l9 15.6H3l9-15.6Z" strokeLinejoin="round" />
      <path d="M12 10v3.6" strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  logout: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M9.5 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4h3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 16l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 12H9.8" strokeLinecap="round" />
    </svg>
  ),
  promote: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 19V6" strokeLinecap="round" />
      <path d="M6.5 11.5L12 6l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  demote: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 5v13" strokeLinecap="round" />
      <path d="M6.5 12.5L12 18l5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  flag: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M6 3.5v17" strokeLinecap="round" />
      <path d="M6 4.5c2-1 4-1 6 0s4 1 6 0v9c-2 1-4 1-6 0s-4-1-6 0v-9Z" strokeLinejoin="round" />
    </svg>
  ),
}

const ROLE_LABEL = { captain: '队长', player: '队员' }
const PERMISSION_LABEL = { developer: '开发者', admin: '管理员', user: '普通用户' }

function formatExpiry(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isExpired(iso) {
  if (!iso) return false
  return new Date(iso).getTime() < Date.now()
}

/* ---------- shared bits ---------- */
function Field({ icon, ...props }) {
  const IconCmp = Icon[icon]
  return (
    <div className="relative">
      {IconCmp && <IconCmp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />}
      <input
        {...props}
        className={`w-full bg-panel-alt border border-panel-line rounded-lg ${IconCmp ? 'pl-10' : 'pl-3'} pr-3 py-2.5 text-sm text-ink-primary placeholder-ink-faint outline-none transition focus:border-teal focus:shadow-teal-glow`}
      />
    </div>
  )
}

function PasswordField({ icon, visible, onToggle, ...props }) {
  const IconCmp = Icon[icon]
  return (
    <div className="relative">
      <IconCmp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className="w-full bg-panel-alt border border-panel-line rounded-lg pl-10 pr-10 py-2.5 text-sm text-ink-primary placeholder-ink-faint outline-none transition focus:border-teal focus:shadow-teal-glow"
      />
      <button
        type="button"
        onClick={onToggle}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-teal transition"
        aria-label={visible ? '隐藏密码' : '显示密码'}
      >
        {visible ? <Icon.eyeOff className="w-4 h-4" /> : <Icon.eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

function RoleToggle({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[
        { value: 'captain', label: '队长' },
        { value: 'player', label: '队员' },
      ].map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center justify-center py-2.5 rounded-lg border text-sm cursor-pointer select-none transition ${
            value === opt.value
              ? 'bg-teal/10 border-teal text-teal shadow-teal-glow'
              : 'bg-panel-alt border-panel-line text-ink-muted hover:text-ink-primary'
          }`}
        >
          <input
            type="radio"
            name="edit-role"
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
          />
          {opt.label}
        </label>
      ))}
    </div>
  )
}

function Avatar({ src, alt, size = 'w-8 h-8' }) {
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
        isCaptain
          ? 'bg-teal/10 text-teal border-teal/40'
          : 'bg-panel-alt text-ink-muted border-panel-line'
      }`}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

function PermissionBadge({ role }) {
  const styles = {
    developer: 'bg-teal text-void border-teal shadow-teal-glow font-semibold',
    admin: 'bg-teal/10 text-teal border-teal/40',
    user: 'bg-panel-alt text-ink-muted border-panel-line',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border ${styles[role] || styles.user}`}>
      {PERMISSION_LABEL[role] || PERMISSION_LABEL.user}
    </span>
  )
}

/* ---------- modal shell ---------- */
function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full ${wide ? 'max-w-lg' : 'max-w-sm'} bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-6 py-6 sm:px-7 sm:py-7 max-h-[88vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-display font-semibold tracking-wide text-ink-primary">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-teal transition"
            aria-label="关闭"
          >
            <Icon.x className="w-4.5 h-4.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ---------- edit user modal ---------- */
function EditUserModal({ user, onClose, onSave, saving }) {
  const [form, setForm] = useState({
    username: user.username,
    displayName: user.display_name,
    password: '',
    role: user.tournament_role,
  })
  const [showPw, setShowPw] = useState(false)

  function submit(e) {
    e.preventDefault()
    onSave({
      id: user.id,
      username: form.username,
      displayName: form.displayName,
      password: form.password,
      tournamentRole: form.role,
    })
  }

  return (
    <ModalShell title="编辑用户" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs text-ink-muted">用户名</label>
          <Field
            icon="user"
            type="text"
            maxLength={20}
            pattern="[A-Za-z0-9]+"
            title="仅支持字母和数字，不含空格"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs text-ink-muted">昵称</label>
          <Field
            icon="tag"
            type="text"
            maxLength={20}
            pattern="[A-Za-z0-9\u4e00-\u9fa5 ]+"
            title="支持中文、英文、数字和空格"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs text-ink-muted">密码</label>
          <PasswordField
            icon="lock"
            visible={showPw}
            onToggle={() => setShowPw((v) => !v)}
            placeholder="留空则不修改密码"
            maxLength={20}
            pattern="[A-Za-z0-9]*"
            title="仅支持字母和数字，不含空格"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs text-ink-muted">身份</label>
          <RoleToggle value={form.role} onChange={(role) => setForm((f) => ({ ...f, role }))} />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-panel-line text-sm text-ink-muted hover:text-ink-primary hover:border-ink-muted transition"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-teal text-void font-semibold tracking-wide text-sm py-2.5 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
          >
            {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

/* ---------- delete confirm modal (generic) ---------- */
function ConfirmDeleteModal({ title, description, onCancel, onConfirm, confirming }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-panel border border-danger/25 rounded-2xl px-6 py-6 shadow-[0_0_20px_rgba(255,84,112,0.15)]">
        <div className="flex items-start gap-3 mb-5">
          <span className="w-9 h-9 rounded-full bg-danger/10 border border-danger/30 flex items-center justify-center shrink-0">
            <Icon.alert className="w-4.5 h-4.5 text-danger" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-primary mb-1">{title}</h3>
            <p className="text-xs text-ink-muted leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-panel-line text-sm text-ink-muted hover:text-ink-primary hover:border-ink-muted transition"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="flex-1 bg-danger text-void font-semibold tracking-wide text-sm py-2.5 rounded-lg transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
          >
            {confirming ? '处理中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- create invite code modal ---------- */
const EXPIRY_OPTIONS = [
  { value: 'never', label: '永不过期' },
  { value: '1d', label: '1 天后' },
  { value: '2d', label: '2 天后' },
  { value: '3d', label: '3 天后' },
  { value: 'custom', label: '自定义' },
]

function CreateInviteModal({ onClose, onCreate, creating }) {
  const [maxUses, setMaxUses] = useState(1)
  const [expiryMode, setExpiryMode] = useState('never')
  const [customExpiry, setCustomExpiry] = useState('')

  function computeExpiresAt() {
    if (expiryMode === 'never') return null
    if (expiryMode === 'custom') return customExpiry ? new Date(customExpiry).toISOString() : null
    const days = { '1d': 1, '2d': 2, '3d': 3 }[expiryMode]
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString()
  }

  function submit(e) {
    e.preventDefault()
    const uses = Math.max(1, Number(maxUses) || 1)
    onCreate({ maxUses: uses, expiresAt: computeExpiresAt() })
  }

  return (
    <ModalShell title="生成邀请码" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs text-ink-muted">最大使用次数</label>
          <Field
            type="number"
            min={1}
            step={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            required
          />
          <p className="text-[11px] text-ink-faint">默认值为 1，可修改为任意正整数</p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs text-ink-muted">过期时间（可选）</label>
          <div className="grid grid-cols-3 gap-2">
            {EXPIRY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center justify-center text-center py-2 rounded-lg border text-xs cursor-pointer select-none transition ${
                  expiryMode === opt.value
                    ? 'bg-teal/10 border-teal text-teal shadow-teal-glow'
                    : 'bg-panel-alt border-panel-line text-ink-muted hover:text-ink-primary'
                }`}
              >
                <input
                  type="radio"
                  name="expiry-mode"
                  value={opt.value}
                  checked={expiryMode === opt.value}
                  onChange={() => setExpiryMode(opt.value)}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
          {expiryMode === 'custom' && (
            <Field
              type="datetime-local"
              value={customExpiry}
              onChange={(e) => setCustomExpiry(e.target.value)}
              required
            />
          )}
          <p className="text-[11px] text-ink-faint">默认永不过期，可选择固定天数或自定义到期时间</p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-panel-line text-sm text-ink-muted hover:text-ink-primary hover:border-ink-muted transition"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={creating}
            className="flex-1 bg-teal text-void font-semibold tracking-wide text-sm py-2.5 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
          >
            {creating ? '生成中…' : '生成邀请码'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function InviteCodeCell({ code, revealed, onReveal }) {
  const mask = code.replace(/[^-]/g, '•')
  return (
    <div className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-2 font-mono tracking-wider text-teal">
        <Icon.ticket className="w-3.5 h-3.5" />
        {revealed ? code : mask}
      </span>
      {!revealed && (
        <button
          type="button"
          onClick={onReveal}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-panel-line text-[11px] text-ink-muted hover:text-teal hover:border-teal/40 transition"
        >
          <Icon.eye className="w-3 h-3" />
          显示
        </button>
      )}
    </div>
  )
}

/* ---------- dashboard tabs ---------- */
// Config-driven tab list. To add a future tab (Tournament Management,
// Draft Settings, System Settings, Statistics, ...), add an entry here
// with a unique id/label/icon and render its section content in
// AdminDashboard below, guarded by `activeTab === '<id>'`. No changes to
// TabNav or the page layout are needed.
const DASHBOARD_TABS = [
  { id: 'users', label: '已注册用户', icon: 'user' },
  { id: 'invites', label: '邀请码管理', icon: 'ticket' },
]

function TabNav({ tabs, activeTab, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto bg-panel border border-teal/15 rounded-xl p-1.5">
      {tabs.map((tab) => {
        const TabIcon = Icon[tab.icon]
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`inline-flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium tracking-wide transition ${
              isActive
                ? 'bg-teal/10 text-teal border border-teal/40 shadow-teal-glow'
                : 'text-ink-muted border border-transparent hover:text-ink-primary hover:bg-panel-alt'
            }`}
          >
            {TabIcon && <TabIcon className="w-4 h-4" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- main dashboard ---------- */
export default function AdminDashboard({ account, onLogout, onOpenLobby }) {
  const isDeveloper = account.permission_role === 'developer'

  const [users, setUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [search, setSearch] = useState('')
  const [editingUser, setEditingUser] = useState(null)
  const [deletingUser, setDeletingUser] = useState(null)
  const [deletingInvite, setDeletingInvite] = useState(null)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [revealedInvites, setRevealedInvites] = useState(() => new Set())
  const [activeTab, setActiveTab] = useState(DASHBOARD_TABS[0].id)
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)
  const toastTimer = useRef(null)

  function showToast(msg) {
    clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }

  function loadUsers() {
    fetchUsers()
      .then(setUsers)
      .catch((err) => showToast(err.message))
  }

  function loadInvites() {
    fetchInviteCodes()
      .then(setInvites)
      .catch((err) => showToast(err.message))
  }

  // Initial load + realtime subscriptions. Users sync directly via
  // postgres_changes on `accounts`. Invite codes never travel over
  // realtime themselves — a `sync_events` doorbell tells us to re-fetch
  // the (permission-checked) list instead.
  useEffect(() => {
    loadUsers()
    loadInvites()
    const unsubUsers = subscribeUsers(() => loadUsers())
    const unsubInvites = subscribeInviteEvents(() => loadInvites())
    return () => {
      unsubUsers()
      unsubInvites()
    }
  }, [])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.display_name.toLowerCase().includes(q))
  }, [users, search])

  async function saveUser(payload) {
    setBusy(true)
    try {
      await editUser(payload)
      setEditingUser(null)
      showToast('用户信息已更新')
      loadUsers()
    } catch (err) {
      showToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDeleteUser() {
    setBusy(true)
    try {
      await deleteUser(deletingUser.id)
      setDeletingUser(null)
      showToast('用户已删除')
      loadUsers()
    } catch (err) {
      showToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Permission-role actions — Developer-only (Section 10, DEVLOG). These
  // only ever touch permission_role, never the tournament role (队长/队员).
  async function handlePromote(user) {
    try {
      await promoteUser(user.id)
      showToast(`${user.display_name} 已提升为管理员`)
      loadUsers()
    } catch (err) {
      showToast(err.message)
    }
  }

  async function handleDemote(user) {
    try {
      await demoteUser(user.id)
      showToast(`${user.display_name} 已降级为普通用户`)
      loadUsers()
    } catch (err) {
      showToast(err.message)
    }
  }

  async function handleCreateInvite({ maxUses, expiresAt }) {
    setBusy(true)
    try {
      await createInviteCode({ maxUses, expiresAt })
      setCreatingInvite(false)
      showToast('邀请码已生成')
      loadInvites()
    } catch (err) {
      showToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  function revealInvite(id) {
    setRevealedInvites((set) => new Set(set).add(id))
  }

  async function confirmDeleteInvite() {
    setBusy(true)
    try {
      await deleteInviteCode(deletingInvite.id)
      setDeletingInvite(null)
      showToast('邀请码已删除')
      loadInvites()
    } catch (err) {
      showToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  function copyInvite(code) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(() => {})
    }
    showToast(`已复制邀请码 ${code}`)
  }

  return (
    <div className="min-h-screen w-full bg-void text-ink-primary font-body px-5 py-8 sm:px-8 lg:px-12">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* header */}
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-teal/10 border border-teal/40 flex items-center justify-center shadow-teal-glow">
              <Icon.shield className="w-5 h-5 text-teal" />
            </span>
            <div>
              <h1 className="font-display text-xl font-semibold tracking-wide text-ink-primary">管理后台</h1>
              <p className="text-xs text-ink-muted">选秀台 · 管理员控制面板</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenLobby}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-teal/40 text-teal text-sm font-medium tracking-wide hover:bg-teal/10 hover:shadow-teal-glow transition"
            >
              <Icon.flag className="w-4 h-4" />
              锦标赛大厅
            </button>
            <div className="flex items-center gap-3 bg-panel border border-teal/15 rounded-xl pl-2.5 pr-2 py-2">
              <Avatar
                src={account.avatar_url}
                alt={`${account.display_name} 的头像`}
                size="w-8 h-8"
              />
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

        {/* tab navigation */}
        <TabNav tabs={DASHBOARD_TABS} activeTab={activeTab} onChange={setActiveTab} />

        {/* registered users */}
        {activeTab === 'users' && (
        <section className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-5 py-6 sm:px-6 sm:py-7">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
            <h2 className="font-display text-base font-semibold tracking-wide text-ink-primary">已注册用户</h2>
            <div className="w-full sm:w-64">
              <Field
                icon="search"
                type="text"
                placeholder="按昵称搜索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-panel-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-panel-alt text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left font-medium px-4 py-3">用户名</th>
                  <th className="text-left font-medium px-4 py-3">头像</th>
                  <th className="text-left font-medium px-4 py-3">昵称</th>
                  <th className="text-left font-medium px-4 py-3">身份</th>
                  <th className="text-left font-medium px-4 py-3">角色</th>
                  <th className="text-right font-medium px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-t border-panel-line hover:bg-panel-alt/60 transition">
                    <td className="px-4 py-3 text-ink-primary">{u.username}</td>
                    <td className="px-4 py-3">
                      <Avatar src={u.avatar_url} alt={`${u.display_name} 的头像`} />
                    </td>
                    <td className="px-4 py-3 text-ink-primary">{u.display_name}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.tournament_role} />
                    </td>
                    <td className="px-4 py-3">
                      <PermissionBadge role={u.permission_role} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2 flex-wrap">
                        {isDeveloper && u.permission_role === 'user' && (
                          <button
                            type="button"
                            onClick={() => handlePromote(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-panel-line text-xs text-ink-muted hover:text-teal hover:border-teal/40 transition"
                          >
                            <Icon.promote className="w-3.5 h-3.5" />
                            提升为管理员
                          </button>
                        )}
                        {isDeveloper && u.permission_role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => handleDemote(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-panel-line text-xs text-ink-muted hover:text-danger hover:border-danger/40 transition"
                          >
                            <Icon.demote className="w-3.5 h-3.5" />
                            降级为普通用户
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingUser(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-panel-line text-xs text-ink-muted hover:text-teal hover:border-teal/40 transition"
                        >
                          <Icon.edit className="w-3.5 h-3.5" />
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingUser(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-panel-line text-xs text-ink-muted hover:text-danger hover:border-danger/40 transition"
                        >
                          <Icon.trash className="w-3.5 h-3.5" />
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink-faint text-xs">
                      未找到匹配的用户
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {/* invite code management */}
        {activeTab === 'invites' && (
        <section className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-5 py-6 sm:px-6 sm:py-7">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="font-display text-base font-semibold tracking-wide text-ink-primary">邀请码管理</h2>
            <button
              type="button"
              onClick={() => setCreatingInvite(true)}
              className="inline-flex items-center gap-1.5 bg-teal text-void font-semibold text-xs tracking-wide px-3.5 py-2 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99]"
            >
              <Icon.plus className="w-3.5 h-3.5" />
              生成邀请码
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-panel-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-panel-alt text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left font-medium px-4 py-3">邀请码</th>
                  <th className="text-left font-medium px-4 py-3">使用情况</th>
                  <th className="text-left font-medium px-4 py-3">过期时间</th>
                  <th className="text-right font-medium px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const expired = isExpired(inv.expires_at)
                  return (
                    <tr key={inv.id} className="border-t border-panel-line hover:bg-panel-alt/60 transition">
                      <td className="px-4 py-3">
                        <InviteCodeCell
                          code={inv.code}
                          revealed={revealedInvites.has(inv.id)}
                          onReveal={() => revealInvite(inv.id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-ink-primary font-mono">
                        {inv.used_count} / {inv.max_uses}
                      </td>
                      <td className="px-4 py-3">
                        {inv.expires_at ? (
                          <span className={expired ? 'text-danger' : 'text-ink-primary'}>
                            {formatExpiry(inv.expires_at)}
                            {expired && <span className="ml-1.5 text-[11px]">（已过期）</span>}
                          </span>
                        ) : (
                          <span className="text-ink-muted">永不过期</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => copyInvite(inv.code)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-panel-line text-xs text-ink-muted hover:text-teal hover:border-teal/40 transition"
                          >
                            <Icon.copy className="w-3.5 h-3.5" />
                            复制
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingInvite(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-panel-line text-xs text-ink-muted hover:text-danger hover:border-danger/40 transition"
                          >
                            <Icon.trash className="w-3.5 h-3.5" />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {invites.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-ink-faint text-xs">
                      暂无邀请码，点击右上角生成
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        )}
      </div>

      {/* modals */}
      {editingUser && (
        <EditUserModal user={editingUser} onClose={() => setEditingUser(null)} onSave={saveUser} saving={busy} />
      )}
      {deletingUser && (
        <ConfirmDeleteModal
          title="删除用户"
          description={`确定要删除用户「${deletingUser.username}」吗？此操作暂不可撤销。`}
          onCancel={() => setDeletingUser(null)}
          onConfirm={confirmDeleteUser}
          confirming={busy}
        />
      )}
      {creatingInvite && (
        <CreateInviteModal onClose={() => setCreatingInvite(false)} onCreate={handleCreateInvite} creating={busy} />
      )}
      {deletingInvite && (
        <ConfirmDeleteModal
          title="删除邀请码"
          description={`确定要删除邀请码「${deletingInvite.code}」吗？此操作暂不可撤销。`}
          onCancel={() => setDeletingInvite(null)}
          onConfirm={confirmDeleteInvite}
          confirming={busy}
        />
      )}

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
