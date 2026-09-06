import { useState } from 'react'
import AppBackground from './AppBackground.jsx'

/* ════════════════════════════════════════════════════════════════════════
   APP SHELL — the one piece of chrome every full page in the product now
   mounts through: brand mark, primary navigation, and the account/session
   control. This is what makes Lobby / Admin / Spectator / Draft Arena /
   Final Matchups read as one product instead of five separately-designed
   screens — they're not just wearing the same colors, they're literally
   rendering the same header component.

   Two modes:
   - full nav (`nav` prop present): Lobby + Admin. Tab-style primary nav,
     underline on the active section, "观赛" always reachable.
   - minimal (`nav` omitted): Spectator / Draft Arena / Final Matchups —
     these are focused "flow" states, not places you browse to, so instead
     of nav tabs they get a single contextual back/exit action. Spectator
     additionally passes `viewerMode` to strip the account chip entirely,
     since a spectator's job is to watch, not administrate.
   ════════════════════════════════════════════════════════════════════════ */

const NAV_ICONS = {
  lobby: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M6 3.5v17" strokeLinecap="round" />
      <path d="M6 4.5c2-1 4-1 6 0s4 1 6 0v9c-2 1-4 1-6 0s-4-1-6 0v-9Z" strokeLinejoin="round" />
    </svg>
  ),
  admin: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 3.5l7 2.6v5.4c0 4.3-2.9 7.9-7 9-4.1-1.1-7-4.7-7-9V6.1l7-2.6Z" strokeLinejoin="round" />
      <path d="M9 12l2.2 2.2L15.5 9.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  spectate: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  logout: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M9.5 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4h3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 16l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 12H9.8" strokeLinecap="round" />
    </svg>
  ),
  chevron: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  back: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

function NavTab({ icon, label, active, onClick }) {
  const IconCmp = NAV_ICONS[icon]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 h-full text-sm font-heading font-semibold tracking-wide transition-colors ${
        active ? 'text-ink-primary' : 'text-ink-muted hover:text-ink-primary'
      }`}
    >
      <IconCmp className="w-4 h-4" />
      {label}
      <span
        className={`absolute left-3 right-3 bottom-0 h-[2.5px] rounded-full bg-accent-gradient transition-opacity ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </button>
  )
}

function AccountChip({ account, onLogout }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-full border border-panel-line bg-panel-alt/60 hover:border-accent2/40 transition"
      >
        <div className="w-7 h-7 rounded-full overflow-hidden bg-panel-alt border border-panel-line flex items-center justify-center shrink-0">
          {account.avatar_url ? (
            <img src={account.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[11px] font-bold text-ink-muted">{account.display_name?.[0]}</span>
          )}
        </div>
        <span className="text-sm text-ink-primary font-medium max-w-[9rem] truncate">{account.display_name}</span>
        <NAV_ICONS.chevron className={`w-3.5 h-3.5 text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-20 w-44 bg-panel/95 backdrop-blur-md border border-panel-line rounded-xl shadow-card-lift overflow-hidden py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onLogout()
              }}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs text-ink-muted hover:text-danger hover:bg-danger/5 transition"
            >
              <NAV_ICONS.logout className="w-4 h-4" />
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function AppShell({
  account,
  section,
  nav,
  onNavigate,
  onLogout,
  backAction,
  backLabel = '返回',
  title,
  viewerMode = false,
  bgVariant = 'default',
  children,
}) {
  return (
    <div className="min-h-screen w-full text-ink-primary font-body flex flex-col lg:h-screen lg:overflow-hidden">
      <AppBackground variant={bgVariant} />

      <div className="shrink-0 h-16 border-b border-panel-line/80 bg-void/40 backdrop-blur-md flex items-center px-4 sm:px-6 gap-4">
        {/* brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="w-8 h-8 rounded-lg bg-accent-gradient flex items-center justify-center shadow-accent-glow rotate-3 shrink-0">
            <span className="font-display font-black text-void text-xs -rotate-3">秀</span>
          </span>
          <span className="font-display font-bold text-sm tracking-[0.1em] text-ink-primary hidden sm:inline">选秀台</span>
        </div>

        <div className="w-px h-6 bg-panel-line shrink-0" />

        {nav ? (
          <nav className="flex items-stretch h-full flex-1 min-w-0">
            {nav.map((item) => (
              <NavTab
                key={item.key}
                icon={item.icon}
                label={item.label}
                active={section === item.key}
                onClick={() => onNavigate(item.key)}
              />
            ))}
          </nav>
        ) : (
          <div className="flex-1 min-w-0 flex items-center gap-3">
            {backAction && (
              <button
                type="button"
                onClick={backAction}
                className="shrink-0 flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary transition font-heading font-medium"
              >
                <NAV_ICONS.back className="w-4 h-4" />
                {backLabel}
              </button>
            )}
            {title && (
              <>
                <span className="w-px h-5 bg-panel-line shrink-0" />
                <span className="text-sm font-display font-bold text-gradient truncate">{title}</span>
              </>
            )}
          </div>
        )}

        {!viewerMode && account && (
          <div className="shrink-0">
            <AccountChip account={account} onLogout={onLogout} />
          </div>
        )}
      </div>

      <div className="flex-1 lg:min-h-0 flex flex-col">{children}</div>
    </div>
  )
}
