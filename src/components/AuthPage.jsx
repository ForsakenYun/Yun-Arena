import { useEffect, useState, useRef } from 'react'
import { login, register, uploadAvatar } from '../lib/auth.js'

/* ---------- inline icons (no external icon package needed) ---------- */
const Icon = {
  user: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.5 20c1.2-3.8 4.2-5.8 7.5-5.8s6.3 2 7.5 5.8" strokeLinecap="round" />
    </svg>
  ),
  mail: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.6" />
      <path d="M4.5 7l7.5 6 7.5-6" strokeLinecap="round" strokeLinejoin="round" />
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
  ticket: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M3.5 9a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V13a2 2 0 0 1 0-4V7.5A1.5 1.5 0 0 0 19 6H5a1.5 1.5 0 0 0-1.5 1.5V9Z" strokeLinejoin="round" />
      <path d="M9.5 6.5v11" strokeDasharray="2.2 2.2" strokeLinecap="round" />
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
}

function Field({ icon, ...props }) {
  const IconCmp = Icon[icon]
  return (
    <div className="relative">
      <IconCmp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
      <input
        {...props}
        className="w-full bg-panel-alt border border-panel-line rounded-lg pl-10 pr-3 py-2.5 text-sm text-ink-primary placeholder-ink-faint outline-none transition focus:border-teal focus:shadow-teal-glow"
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

export default function AuthPage({ onLoggedIn, initialMessage }) {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [showPw, setShowPw] = useState(false)
  const [showPw2, setShowPw2] = useState(false)
  const [role, setRole] = useState('')
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [avatarFile, setAvatarFile] = useState(null)
  const [toast, setToast] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const toastTimer = useRef(null)

  function showToast(msg) {
    clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }

  useEffect(() => {
    if (initialMessage) showToast(initialMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    const url = URL.createObjectURL(file)
    setAvatarPreview(url)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    const data = new FormData(e.target)

    if (mode === 'login') {
      const username = data.get('username')?.trim()
      const password = data.get('password')?.trim()
      setSubmitting(true)
      try {
        const account = await login({ username, password })
        onLoggedIn(account)
      } catch (err) {
        showToast(err.message || '用户名或密码错误')
      } finally {
        setSubmitting(false)
      }
      return
    }

    // registration
    const inviteCode = data.get('inviteCode')?.trim()
    const displayName = data.get('displayName')?.trim()
    const username = data.get('username')?.trim()
    const password = data.get('password')?.trim()
    const confirmPassword = data.get('confirmPassword')?.trim()

    if (!role) {
      showToast('请选择身份')
      return
    }
    if (password !== confirmPassword) {
      showToast('两次输入的密码不一致')
      return
    }

    setSubmitting(true)
    try {
      let avatarUrl = null
      if (avatarFile) {
        avatarUrl = await uploadAvatar(avatarFile)
      }
      const account = await register({
        inviteCode,
        username,
        password,
        displayName,
        tournamentRole: role,
        avatarUrl,
      })
      showToast('注册成功，请登录')
      switchMode('login')
      void account
    } catch (err) {
      showToast(err.message || '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode(next) {
    if (next === mode) return
    setMode(next)
    setShowPw(false)
    setShowPw2(false)
    setRole('')
    setAvatarPreview(null)
    setAvatarFile(null)
  }

  return (
    <div className="min-h-screen w-full bg-void text-ink-primary font-body flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-7 py-8 sm:px-8 sm:py-9">
          {/* tab switcher */}
          <div className="flex bg-panel-alt border border-panel-line rounded-full p-1 mb-7">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 py-2 rounded-full text-sm font-medium tracking-wide transition ${
                mode === 'login'
                  ? 'bg-teal/10 text-teal border border-teal/40'
                  : 'text-ink-muted hover:text-ink-primary'
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 py-2 rounded-full text-sm font-medium tracking-wide transition ${
                mode === 'register'
                  ? 'bg-teal/10 text-teal border border-teal/40'
                  : 'text-ink-muted hover:text-ink-primary'
              }`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'login' ? (
              <>
                <div className="space-y-1.5">
                  <label className="block text-xs text-ink-muted">用户名</label>
                  <Field icon="user" type="text" name="username" placeholder="请输入用户名" required />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-ink-muted">密码</label>
                  <PasswordField
                    icon="lock"
                    name="password"
                    visible={showPw}
                    onToggle={() => setShowPw((v) => !v)}
                    placeholder="请输入密码"
                    required
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col items-center gap-2 pb-1">
                  <label className="relative cursor-pointer group">
                    <div className="w-20 h-20 rounded-lg bg-panel-alt border border-panel-line overflow-hidden flex items-center justify-center transition group-hover:border-teal">
                      {avatarPreview ? (
                        <img src={avatarPreview} alt="头像预览" className="w-full h-full object-cover" />
                      ) : (
                        <Icon.user className="w-8 h-8 text-ink-muted" />
                      )}
                    </div>
                    <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-teal flex items-center justify-center border-2 border-panel">
                      <Icon.camera className="w-3 h-3 text-void" />
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                  </label>
                  <span className="text-[11px] text-ink-faint">点击上传头像（选填，默认使用系统头像）</span>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs text-ink-muted">邀请码</label>
                  <Field icon="ticket" type="text" name="inviteCode" placeholder="请输入邀请码" required />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs text-ink-muted">昵称</label>
                  <Field
                    icon="tag"
                    type="text"
                    name="displayName"
                    placeholder="设置你的显示昵称"
                    maxLength={20}
                    pattern="[A-Za-z0-9\u4e00-\u9fa5 ]+"
                    title="支持中文、英文、数字和空格"
                    required
                  />
                  <p className="text-[11px] text-ink-faint">显示在网站中的名称，最多 20 个字符，支持中文</p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs text-ink-muted">身份</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { value: 'captain', label: '队长' },
                      { value: 'player', label: '队员' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex items-center justify-center py-2.5 rounded-lg border text-sm cursor-pointer select-none transition ${
                          role === opt.value
                            ? 'bg-teal/10 border-teal text-teal shadow-teal-glow'
                            : 'bg-panel-alt border-panel-line text-ink-muted hover:text-ink-primary'
                        }`}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={opt.value}
                          checked={role === opt.value}
                          onChange={() => setRole(opt.value)}
                          className="sr-only"
                          required
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs text-ink-muted">用户名</label>
                  <Field
                    icon="user"
                    type="text"
                    name="username"
                    placeholder="设置你的用户名"
                    maxLength={20}
                    pattern="[A-Za-z0-9]+"
                    title="仅支持字母和数字，不含空格"
                    required
                  />
                  <p className="text-[11px] text-ink-faint">仅支持字母和数字，不支持符号和空格，最多 20 位</p>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-ink-muted">密码</label>
                  <PasswordField
                    icon="lock"
                    name="password"
                    visible={showPw}
                    onToggle={() => setShowPw((v) => !v)}
                    placeholder="设置你的密码"
                    maxLength={20}
                    pattern="[A-Za-z0-9]+"
                    title="仅支持字母和数字，不含空格"
                    required
                  />
                  <p className="text-[11px] text-ink-faint">仅支持字母和数字，不支持符号和空格，最多 20 位</p>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-ink-muted">确认密码</label>
                  <PasswordField
                    icon="lock"
                    name="confirmPassword"
                    visible={showPw2}
                    onToggle={() => setShowPw2((v) => !v)}
                    placeholder="请再次输入密码"
                    maxLength={20}
                    pattern="[A-Za-z0-9]+"
                    title="仅支持字母和数字，不含空格"
                    required
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 bg-teal text-void font-semibold tracking-wide text-sm py-3 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none"
            >
              {submitting ? '请稍候…' : mode === 'login' ? '登录' : '立即注册'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-ink-muted">
            {mode === 'login' ? (
              <>
                还没有账号？
                <button onClick={() => switchMode('register')} className="text-teal hover:underline ml-1">
                  立即注册
                </button>
              </>
            ) : (
              <>
                已有账号？
                <button onClick={() => switchMode('login')} className="text-teal hover:underline ml-1">
                  返回登录
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-20 bg-panel-alt border border-teal/40 shadow-teal-glow text-ink-primary text-xs px-4 py-3 rounded-lg flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-teal" />
          {toast}
        </div>
      )}
    </div>
  )
}
