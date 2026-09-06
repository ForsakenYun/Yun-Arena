// Shared decorative background layer -- the "Aurora Circuit" visual
// identity used behind every full page (Auth, Tournament Lobby, Admin
// Dashboard, Spectator Page, Draft Arena). Purely cosmetic / pointer-events
// none: never affects layout, data, or interaction. Rendered as the first
// child of each page's root container so normal DOM stacking order puts
// real content above it without needing z-index tricks.
export default function AppBackground({ variant = 'default' }) {
  const isGold = variant === 'gold'
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden select-none" aria-hidden="true">
      {/* base grid */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(124,92,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(124,92,255,0.07) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(ellipse 80% 65% at 50% 0%, black 40%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 65% at 50% 0%, black 40%, transparent 85%)',
        }}
      />
      {/* glow orbs */}
      {isGold ? (
        <>
          <div className="absolute -top-32 left-1/4 w-[620px] h-[620px] rounded-full bg-gold/20 blur-[150px] animate-drift" />
          <div className="absolute bottom-0 right-0 w-[480px] h-[480px] rounded-full bg-hot/10 blur-[150px] animate-drift" style={{ animationDelay: '-6s' }} />
        </>
      ) : (
        <>
          <div className="absolute -top-40 -left-32 w-[600px] h-[600px] rounded-full bg-accent/25 blur-[150px] animate-drift" />
          <div className="absolute -bottom-48 -right-24 w-[560px] h-[560px] rounded-full bg-accent2/15 blur-[150px] animate-drift" style={{ animationDelay: '-7s' }} />
          <div className="absolute top-1/3 right-1/4 w-[360px] h-[360px] rounded-full bg-hot/10 blur-[130px] animate-drift" style={{ animationDelay: '-3s' }} />
        </>
      )}
      {/* vignette to keep edges/corners moody */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 90% 80% at 50% 30%, transparent 40%, rgba(6,7,15,0.55) 100%)' }}
      />
      {/* fine grain */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
          backgroundSize: '3px 3px',
        }}
      />
    </div>
  )
}
