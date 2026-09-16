import { useState } from 'react'
import AppBackground from './AppBackground.jsx'

// DARK_THEME_LOCK_STYLE re-declares every CSS variable the Theme Switcher
// exposes (index.css's `[data-theme='light']` overrides these; see
// tailwind.config.js's void/panel/panel-alt/panel-2/panel-line/ink.*/
// accent* tokens) back to their dark values. Since CSS custom properties
// inherit through the DOM tree (not through layout), spreading this
// object into any element's inline `style` re-scopes every themed class
// nested inside it back to dark, regardless of what `[data-theme]` is set
// to further up the tree.
//
// As of the Theme Switcher's light-mode rollout, AuthPage.jsx (applied
// directly to its own root element, no wrapper needed there) is the only
// consumer: the login/register screen renders before any account --
// and therefore any saved theme preference -- exists, so it has no
// legitimate light/dark choice to reflect. It's the brand's front door
// and always renders dark on purpose, even if a previous guest session
// left `light` sitting in localStorage.
//
// Draft Arena / Final Matchups and the Spectator Page (DraftArena.jsx's
// DraftArenaPage and SpectatorPage.jsx) used to opt out via this same
// mechanism too, wrapped in DraftVisualLock below -- DEVLOG Section 3's
// "Draft Arena and the Spectator Page are one system" rule required
// removing that lock from *both* files together, not just one, once
// theme-following was extended to them (see DEVLOG Sections 3/8/9). They
// now follow the ambient theme like every other page instead; only
// their gold/Cinzel-Orbitron brand fonts and neon glow colors stay
// fixed (as literal hex in DraftArena.jsx, not CSS variables).
export const DARK_THEME_LOCK_STYLE = {
  '--color-void': '6 7 15',
  '--color-panel': '14 16 32',
  '--color-panel-alt': '22 26 51',
  '--color-panel-2': '27 32 64',
  '--color-panel-line': '43 49 89',
  '--color-ink-primary': '244 242 255',
  '--color-ink-muted': '146 141 190',
  '--color-ink-faint': '76 74 121',
  '--color-accent': '124 92 255',
  '--color-accent-hover': '167 139 250',
  '--color-accent-soft': '46 38 92',
  '--color-accent2': '34 229 255',
  '--bg-vignette': 'rgba(6, 7, 15, 0.55)',
}

// DraftVisualLock wraps DARK_THEME_LOCK_STYLE in a `display: contents`
// element, for dropping the lock in the middle of an existing flex
// layout (e.g. AppShell's children slot) without adding a box that would
// disturb that layout -- AuthPage doesn't need this wrapper since it
// applies DARK_THEME_LOCK_STYLE directly to its own real root element
// instead (see AuthPage.jsx). Currently unused (see the note above on
// DARK_THEME_LOCK_STYLE for why) but kept available: any future
// screen that legitimately needs a hard dark-lock inside an existing
// layout, the way Draft Arena/Spectator Page used to, can reach for
// this instead of re-inventing it.
export function DraftVisualLock({ children }) {
  return (
    <div className="contents" style={DARK_THEME_LOCK_STYLE}>
      {children}
    </div>
  )
}

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

   Draft Arena / Final Matchups' own body content (not this header) opts
   out of the Theme Switcher -- see DraftVisualLock above.
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
  // Theme Switcher (Step 1): the dropdown item shows the icon for the
  // theme you'd *switch to*, not the one currently active -- sun while
  // on dark (switch to light), moon while on light (switch to dark).
  sun: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <path
        d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"
        strokeLinecap="round"
      />
    </svg>
  ),
  moon: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a6.7 6.7 0 0 0 10.2 10.2Z" strokeLinejoin="round" />
    </svg>
  ),
}

function NavTab({ icon, label, active, onClick, theme }) {
  const IconCmp = NAV_ICONS[icon]
  const isLight = theme === 'light'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 h-full text-sm font-heading font-semibold tracking-wide transition-colors ${
        active
          ? isLight
            ? // Cyber-Teal light identity: bold teal label sitting cleanly
              // on the header surface -- no background wash behind it, just
              // the subtle text color/weight change plus the crisp
              // bottom-line indicator below.
              'text-accent font-bold'
            : 'text-ink-primary'
          : isLight
          ? 'text-ink-muted hover:text-ink-primary hover:bg-panel-2/50'
          : 'text-ink-muted hover:text-ink-primary'
      }`}
    >
      <IconCmp className="w-4 h-4" />
      {label}
      {isLight ? (
        // Solid indicator bar instead of dark's soft gradient glow -- flat
        // and crisp reads better against a light bar than a glow that has
        // nothing dark to glow against. Dark-neutral (ink-primary, ~
        // #0f172a) rather than the teal accent used elsewhere in this
        // component, so the line reads as a crisp structural marker
        // distinct from the accent-colored label above it.
        <span
          className={`absolute left-3 right-3 bottom-0 h-[2.5px] rounded-md bg-ink-primary transition-opacity ${
            active ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : (
        <span
          className={`absolute left-3 right-3 bottom-0 h-[2.5px] rounded-md bg-accent-gradient transition-opacity ${
            active ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </button>
  )
}

function AccountChip({ account, onLogout, theme = 'dark', onThemeChange }) {
  const [open, setOpen] = useState(false)
  const isLight = theme === 'light'
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-lg border border-panel-line bg-panel-alt/60 hover:border-accent2/40 transition"
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
            {onThemeChange && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onThemeChange(isLight ? 'dark' : 'light')
                  }}
                  className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs text-ink-muted hover:text-ink-primary hover:bg-panel-alt/60 transition"
                >
                  {isLight ? <NAV_ICONS.moon className="w-4 h-4" /> : <NAV_ICONS.sun className="w-4 h-4" />}
                  {isLight ? '暗色模式' : '亮色模式'}
                </button>
                <div className="h-px bg-panel-line mx-1.5 my-1" />
              </>
            )}
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
  theme,
  onThemeChange,
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

      {/* relative + z-20: the account dropdown below is positioned
          relative to this bar and already carries its own z-20, but that
          only orders it *within* this bar's own stacking context. This
          bar's `backdrop-blur-md` creates a stacking context of its own
          with z-index:auto (i.e. painted like z-index:0), so without an
          explicit z-index here it loses to *any* later-in-DOM page
          content that forms its own stacking context too (e.g. the
          overlapping tournament-card stack, which also uses
          backdrop-blur) -- ties at z-index:auto go to whichever comes
          later in the document, which is always the page content, never
          the header above it. An explicit z-20 here settles that tie in
          the header's favor so the dropdown -- and the whole bar -- reliably
          paints over ordinary page content on every page, while staying
          below the real full-screen modals (z-30 and up). */}
      <div
        className={`shrink-0 h-16 border-b ${
          theme === 'light' ? 'border-panel-line' : 'border-panel-line/80'
        } bg-void/40 backdrop-blur-md flex items-center px-4 sm:px-6 gap-4 relative z-20`}
      >
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
                theme={theme}
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
                <span className="text-sm font-display font-bold text-ink-primary truncate">{title}</span>
              </>
            )}
          </div>
        )}

        {!viewerMode && account && (
          <div className="shrink-0">
            <AccountChip account={account} onLogout={onLogout} theme={theme} onThemeChange={onThemeChange} />
          </div>
        )}
      </div>

      <div className="flex-1 lg:min-h-0 flex flex-col">{children}</div>
    </div>
  )
}
