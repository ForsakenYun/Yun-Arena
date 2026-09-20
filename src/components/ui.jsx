/* ════════════════════════════════════════════════════════════════════════
   SHARED UI PRIMITIVES — the common anatomy behind every "person" or
   "team" surface in the product (Lobby's roster, Admin's user table,
   Draft Arena's team grid and player pool). Different pages need
   different densities (a compact list row vs. a large draft-pool card),
   but they're built from the same pieces: a consistent tile shell,
   the same badge/pill shape, the same stat-chip shape. That shared
   vocabulary — not shared colors — is what makes these surfaces read as
   one product.
   ════════════════════════════════════════════════════════════════════════ */

export function Badge({ tone = 'neutral', children, className = '' }) {
  const tones = {
    neutral: 'bg-panel-alt text-ink-muted border-panel-line',
    accent: 'bg-accent/10 text-accent2 border-accent/30',
    gold: 'bg-gold/10 text-gold border-gold/35',
    success: 'bg-success/10 text-success border-success/35',
    danger: 'bg-danger/10 text-danger border-danger/35',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-heading font-semibold tracking-wide border ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function StatChip({ label, value, tone = 'accent' }) {
  const toneText = { accent: 'text-accent2', gold: 'text-gold', neutral: 'text-ink-primary' }
  return (
    <div className="flex flex-col items-center justify-center rounded-md bg-void/40 border border-panel-line py-1">
      <span className={`text-xs font-display font-bold leading-none ${toneText[tone] || toneText.accent}`}>{value}</span>
      <span className="text-[8px] text-ink-faint tracking-wide mt-0.5 leading-none">{label}</span>
    </div>
  )
}

export function LiveDot({ active }) {
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-success animate-pulseGlow' : 'bg-ink-faint'}`} />
}

/* Dense horizontal row — Admin's user table, Lobby's roster. */
export function TileRow({ leading, title, subtitle, badges, trailing, onClick, className = '' }) {
  const interactive = !!onClick
  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent transition ${
        interactive ? 'cursor-pointer hover:bg-accent/5 hover:border-panel-line' : 'hover:bg-panel-alt/40'
      } ${className}`}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-ink-primary font-medium truncate">{title}</span>
          {badges}
        </div>
        {subtitle && <div className="text-xs text-ink-muted truncate mt-0.5">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 flex items-center gap-2">{trailing}</div>}
    </div>
  )
}

/* Card tile shell — Draft Arena's team panels / pool cards. Selection,
   activity, and disabled states are shared visual states applied to one
   consistent shape rather than each card type inventing its own. */
export function TileCard({ active, selected, disabled, assignable, onClick, className = '', style, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative text-left rounded-xl border transition-all duration-200 ${
        disabled ? 'opacity-40 cursor-not-allowed' : onClick ? 'cursor-pointer hover:-translate-y-0.5' : ''
      } ${className}`}
      style={{
        background: 'linear-gradient(160deg, rgba(22,26,51,0.92), rgba(14,16,32,0.96))',
        borderColor: selected
          ? 'rgba(124,92,255,0.75)'
          : active
          ? 'rgba(34,229,255,0.6)'
          : assignable
          ? 'rgba(47,232,166,0.55)'
          : 'rgba(43,49,89,0.7)',
        boxShadow: selected
          ? '0 0 0 3px rgba(124,92,255,0.22), 0 0 24px rgba(124,92,255,0.3)'
          : active
          ? '0 0 0 2px rgba(34,229,255,0.18), 0 0 22px rgba(34,229,255,0.22)'
          : assignable
          ? '0 0 16px rgba(47,232,166,0.18)'
          : '0 8px 20px rgba(4,3,15,0.35)',
        ...style,
      }}
    >
      {children}
    </button>
  )
}
