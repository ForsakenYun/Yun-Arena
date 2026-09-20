import { useState } from 'react'
import { editUser } from '../lib/adminApi.js'
import { uploadAvatar } from '../lib/auth.js'

// 编辑参赛选手 (Tournament Lobby, Admin/Developer-only) -- the same
// "编辑用户" form Admin Dashboard's `EditUserModal` already offers, opened
// straight from the 操作 column on this page's own roster instead of
// staff having to go find the same account over in 管理后台. Same fields,
// same `edit_user` RPC (`editUser`, `adminApi.js` -- reused directly, not
// re-wrapped, since it's already a thin, permission-checked call), same
// developer-account protection (enforced server-side in `edit_user`
// regardless of what this dialog shows; `TournamentLobby.jsx` hides the
// 编辑 button itself for developer-owned rows when the viewer isn't a
// developer, the same convenience-only guard `AdminDashboard.jsx` already
// applies to its own 编辑 button).
//
// A sibling modal to `TournamentSettingsDialog.jsx`/`AddParticipantsDialog.jsx`
// (same fixed-backdrop shell), not `AdminDashboard.jsx`'s own `ModalShell` --
// every dialog opened from Tournament Lobby builds its own shell rather than
// importing one from another page, the same "not a shared import" reasoning
// `AddParticipantsDialog.jsx` already documents for its own duplicated
// pieces. `Field`/`PasswordField`/`RoleToggle`/`GenderToggle` and the icons
// below are deliberate verbatim duplicates of `AdminDashboard.jsx`'s own
// copies for the same reason.
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
      <path
        d="M10.6 5.7A10.6 10.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.8 15.8 0 0 1-3.4 4.2M6.6 6.8C4 8.5 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.2 0 2.3-.2 3.3-.6"
        strokeLinecap="round"
      />
      <path d="M9.9 10a2.8 2.8 0 0 0 4 4" strokeLinecap="round" />
    </svg>
  ),
  tag: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M11 4.5H6A1.5 1.5 0 0 0 4.5 6v5l8.6 8.6a1.5 1.5 0 0 0 2.12 0l4.38-4.38a1.5 1.5 0 0 0 0-2.12L11 4.5Z" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  camera: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-1.8h7l1 1.8h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  ),
  x: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" />
    </svg>
  ),
}

function Field({ icon, ...props }) {
  const IconCmp = Icon[icon]
  return (
    <div className="relative">
      {IconCmp && <IconCmp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />}
      <input
        {...props}
        className={`w-full bg-panel-2/60 border border-panel-line rounded-lg ${IconCmp ? 'pl-10' : 'pl-3'} pr-3 py-2.5 text-sm text-ink-primary placeholder-ink-faint outline-none transition focus:border-accent2/60 focus:bg-panel-2 focus:shadow-accent-glow`}
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
        className="w-full bg-panel-2/60 border border-panel-line rounded-lg pl-10 pr-10 py-2.5 text-sm text-ink-primary placeholder-ink-faint outline-none transition focus:border-accent2/60 focus:bg-panel-2 focus:shadow-accent-glow"
      />
      <button
        type="button"
        onClick={onToggle}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-accent2 transition"
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
              ? 'bg-accent/10 border-accent text-accent shadow-accent-glow'
              : 'bg-panel-alt border-panel-line text-ink-muted hover:text-ink-primary'
          }`}
        >
          <input
            type="radio"
            name="edit-participant-role"
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

function GenderToggle({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[
        { value: 'male', label: '男生' },
        { value: 'female', label: '女生' },
      ].map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center justify-center py-2.5 rounded-lg border text-sm cursor-pointer select-none transition ${
            value === opt.value
              ? 'bg-accent/10 border-accent text-accent shadow-accent-glow'
              : 'bg-panel-alt border-panel-line text-ink-muted hover:text-ink-primary'
          }`}
        >
          <input
            type="radio"
            name="edit-participant-gender"
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
            required
          />
          {opt.label}
        </label>
      ))}
    </div>
  )
}

// participant: one row from `fetchLobby()` (tournamentApi.js) -- camelCase
// (accountId/displayName/tournamentRole/...), not the raw snake_case
// `accounts` row AdminDashboard's own EditUserModal takes, since this
// dialog is fed straight from the Lobby's own roster state rather than a
// fresh `fetchUsers()` call.
export default function EditParticipantDialog({ participant, onClose, onSaved }) {
  const [form, setForm] = useState({
    username: participant.username,
    displayName: participant.displayName,
    password: '',
    role: participant.tournamentRole,
    gender: participant.gender,
  })
  const [showPw, setShowPw] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState(participant.avatarUrl)
  const [avatarFile, setAvatarFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  async function submit(e) {
    e.preventDefault()
    if (uploading || saving) return
    setError(null)
    try {
      let avatarUrl = null // null = leave the existing avatar unchanged
      if (avatarFile) {
        setUploading(true)
        avatarUrl = await uploadAvatar(avatarFile)
      }
      setUploading(false)
      setSaving(true)
      await editUser({
        id: participant.accountId,
        username: form.username,
        displayName: form.displayName,
        password: form.password,
        tournamentRole: form.role,
        gender: form.gender,
        avatarUrl,
      })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={saving || uploading ? undefined : onClose} />
      <div className="relative w-full max-w-lg max-h-[88vh] overflow-y-auto bg-panel/95 backdrop-blur-md border border-accent/20 shadow-accent-glow rounded-2xl px-6 py-6 sm:px-7 sm:py-7 light-glow-card">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-display font-semibold tracking-wide text-ink-primary">编辑参赛选手</h3>
          <button type="button" onClick={onClose} className="text-ink-muted hover:text-accent2 transition" aria-label="关闭">
            <Icon.x className="w-4.5 h-4.5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-col items-center gap-2 pb-1">
            <label className="relative cursor-pointer group">
              <div className="w-20 h-20 rounded-xl bg-panel-alt border border-panel-line overflow-hidden flex items-center justify-center transition group-hover:border-accent2/60 group-hover:shadow-accent-glow">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="头像预览" className="w-full h-full object-cover" />
                ) : (
                  <Icon.user className="w-8 h-8 text-ink-muted" />
                )}
              </div>
              <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-accent-gradient flex items-center justify-center border-2 border-panel shadow-accent-glow">
                <Icon.camera className="w-3 h-3 text-void" />
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </label>
            <span className="text-[11px] text-ink-faint">点击上传或更换头像</span>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs text-ink-muted">账号</label>
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
            <label className="block text-xs text-ink-muted">角色</label>
            <RoleToggle value={form.role} onChange={(role) => setForm((f) => ({ ...f, role }))} />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs text-ink-muted">性别</label>
            <GenderToggle value={form.gender} onChange={(gender) => setForm((f) => ({ ...f, gender }))} />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || uploading}
              className="flex-1 py-2.5 rounded-lg border border-panel-line text-sm text-ink-muted hover:text-ink-primary hover:border-ink-muted transition disabled:opacity-60 disabled:pointer-events-none"
            >
              取消
            </button>
            <button type="submit" disabled={uploading || saving} className="btn-primary flex-1 text-sm py-2.5">
              {uploading ? '上传头像中…' : saving ? '保存中…' : '保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
