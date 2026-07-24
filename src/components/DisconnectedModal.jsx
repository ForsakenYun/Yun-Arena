const Icon = {
  wifiOff: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M3 3l18 18" strokeLinecap="round" />
      <path d="M8.5 8.9A10.4 10.4 0 0 1 12 8.3c3.6 0 6.8 1.5 9 4M4.8 12.1A10.3 10.3 0 0 1 8 10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.8 15.3A5.8 5.8 0 0 1 12 13.6c1.2 0 2.4.3 3.4.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="19" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  refresh: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4v4.5h-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20v-4.5h4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

export default function DisconnectedModal({ onReconnect }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-void/85 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-panel border border-teal/15 rounded-2xl shadow-teal-glow px-7 py-8 text-center">
        <span className="mx-auto w-12 h-12 rounded-full bg-danger/10 border border-danger/30 flex items-center justify-center mb-4">
          <Icon.wifiOff className="w-6 h-6 text-danger" />
        </span>
        <h3 className="text-base font-display font-semibold tracking-wide text-ink-primary mb-2">
          网络连接已断开
        </h3>
        <p className="text-xs text-ink-muted leading-relaxed mb-6">
          正在尝试重新连接…
        </p>
        <button
          type="button"
          onClick={onReconnect}
          className="inline-flex items-center gap-2 bg-teal text-void font-semibold tracking-wide text-sm px-5 py-2.5 rounded-lg transition hover:shadow-teal-glow-lg hover:brightness-110 active:scale-[0.99]"
        >
          <Icon.refresh className="w-4 h-4" />
          重新连接
        </button>
      </div>
    </div>
  )
}
