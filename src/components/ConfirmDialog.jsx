// Shared confirm dialog used by both the Admin Dashboard (logout) and the
// Tournament Lobby (logout, leave tournament, admin removal). Visually
// modeled on AdminDashboard.jsx's local ConfirmDeleteModal so every "are you
// sure?" prompt in the project looks the same -- this file just makes that
// shape reusable outside AdminDashboard.jsx instead of redesigning it.
const Icon = {
  alert: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 4.2l9 15.6H3l9-15.6Z" strokeLinejoin="round" />
      <path d="M12 10v3.6" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
}

const TONE_STYLES = {
  danger: {
    iconWrap: 'bg-danger/10 border-danger/30 text-danger',
    panel: 'border-danger/25 shadow-[0_0_20px_rgba(255,84,112,0.15)]',
    confirmBtn: 'bg-danger text-void hover:brightness-110',
  },
  neutral: {
    iconWrap: 'bg-teal/10 border-teal/40 text-teal',
    panel: 'border-teal/15 shadow-teal-glow',
    confirmBtn: 'bg-teal text-void hover:shadow-teal-glow-lg hover:brightness-110',
  },
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'danger',
  busy = false,
  onCancel,
  onConfirm,
}) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.danger

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className={`relative w-full max-w-sm bg-panel border rounded-2xl px-6 py-6 ${styles.panel}`}>
        <div className="flex items-start gap-3 mb-5">
          <span className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${styles.iconWrap}`}>
            <Icon.alert className="w-4.5 h-4.5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-primary mb-1">{title}</h3>
            <p className="text-xs text-ink-muted leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-panel-line text-sm text-ink-muted hover:text-ink-primary hover:border-ink-muted transition disabled:opacity-60 disabled:pointer-events-none"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 font-semibold tracking-wide text-sm py-2.5 rounded-lg transition active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none ${styles.confirmBtn}`}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
