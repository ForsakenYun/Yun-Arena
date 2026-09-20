/** @type {import('tailwindcss').Config} */

// Theme Switcher (Step 2): turns a CSS-variable name holding a space-
// separated "R G B" triple (see index.css) into a Tailwind color function
// that supports the `/opacity` modifier -- e.g. `bg-panel-line/60` compiles
// to `rgb(var(--color-panel-line) / 0.6)`. This is the classic Tailwind
// pattern for themeable colors; a version of Tailwind's own `color-mix()`
// opacity trick (added in 3.4) only fires for ad-hoc arbitrary-value
// classes like `bg-[--x]/50`, not for named `theme.colors` entries whose
// value is a plain `var(--x)` string -- those silently don't get an
// opacity-modified utility generated at all, which would've broken every
// `panel-line/NN`, `panel-alt/NN`, `ink-muted/NN`, etc. usage across the
// app the moment these six tokens moved to CSS variables.
function withOpacityValue(variableName) {
  return ({ opacityValue }) =>
    opacityValue === undefined ? `rgb(var(${variableName}))` : `rgb(var(${variableName}) / ${opacityValue})`
}

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Theme Switcher: no component in the app used Tailwind's `dark:` variant
  // before now -- theming instead runs entirely through the CSS-variable
  // tokens above, keyed off the `data-theme` attribute App.jsx sets on
  // <html> (see index.css / App.jsx). This wires `dark:` to that same
  // attribute (`data-theme="dark"`) rather than Tailwind's default
  // `prefers-color-scheme` media query, so a `dark:` class actually follows
  // the app's own saved theme instead of the OS setting. Safe to add: it
  // only takes effect where `dark:` is explicitly used, which today is just
  // the 队长 (Captain) badge in TournamentLobby.jsx/AdminDashboard.jsx.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // These six tokens used to be literal hex values. They now read
        // from CSS variables defined in index.css (`:root` = dark
        // defaults, `[data-theme='light']` = overrides, set on <html> by
        // App.jsx) via withOpacityValue above, so every existing
        // `bg-panel`, `text-ink-muted`, `border-panel-line/60`, etc.
        // class across the app follows the active theme automatically --
        // no per-component changes needed.
        void: withOpacityValue('--color-void'),
        panel: withOpacityValue('--color-panel'),
        'panel-alt': withOpacityValue('--color-panel-alt'),
        'panel-2': withOpacityValue('--color-panel-2'),
        'panel-line': withOpacityValue('--color-panel-line'),
        accent: {
          DEFAULT: withOpacityValue('--color-accent'),
          hover: withOpacityValue('--color-accent-hover'),
          soft: withOpacityValue('--color-accent-soft'),
        },
        accent2: {
          DEFAULT: withOpacityValue('--color-accent2'),
        },
        hot: {
          DEFAULT: '#FF4FA3',
        },
        gold: {
          DEFAULT: '#FFC94A',
          soft: '#F3DFB0',
        },
        ink: {
          primary: withOpacityValue('--color-ink-primary'),
          muted: withOpacityValue('--color-ink-muted'),
          faint: withOpacityValue('--color-ink-faint'),
        },
        danger: '#FF4D6D',
        success: '#2FE8A6',
      },
      fontFamily: {
        display: ['Orbitron', 'Rajdhani', 'Noto Sans SC', 'sans-serif'],
        heading: ['Rajdhani', 'Noto Sans SC', 'sans-serif'],
        body: ['Noto Sans SC', 'sans-serif'],
        mono: ['Chakra Petch', 'Noto Sans SC', 'monospace'],
        crown: ['Cinzel', 'serif'],
      },
      backgroundImage: {
        // Button/CTA gradient, by explicit request: this used to read
        // --color-accent/--color-accent2 directly, so it went
        // purple->cyan in dark mode but a flat, single-stop teal in
        // light mode (Cyber-Teal light identity sets both of those
        // variables to the same teal -- see index.css). Now reads two
        // dedicated variables (--color-accent-grad-from/-to, index.css's
        // :root block) that are deliberately *not* re-declared under
        // [data-theme='light'], so every bg-accent-gradient consumer --
        // .btn-primary and therefore every button built on it, plus the
        // AuthPage login/register toggle, Admin Dashboard's role chips/
        // avatar badges, brand marks -- renders the same violet->cyan
        // gradient in both themes now. --color-accent/--color-accent2
        // themselves are untouched and still theme-following (teal in
        // light mode) for their other, non-gradient uses (text-accent2,
        // border-accent/40, etc.) -- only the gradient fill changed.
        'accent-gradient': 'linear-gradient(135deg, rgb(var(--color-accent-grad-from)) 0%, rgb(var(--color-accent-grad-to)) 100%)',
        'hot-gradient': 'linear-gradient(135deg, #FF4FA3 0%, #FF8A5B 100%)',
        'gold-gradient': 'linear-gradient(135deg, #FFC94A 0%, #C9862B 100%)',
        'grid-lines':
          'linear-gradient(rgba(124,92,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(124,92,255,0.07) 1px, transparent 1px)',
      },
      boxShadow: {
        'accent-glow': '0 0 20px rgb(var(--color-accent) / 0.28), 0 0 60px rgb(var(--color-accent2) / 0.10)',
        'accent-glow-lg': '0 0 40px rgb(var(--color-accent) / 0.4), 0 0 110px rgb(var(--color-accent2) / 0.16)',
        'hot-glow': '0 0 20px rgba(255,79,163,0.3), 0 0 55px rgba(255,79,163,0.12)',
        'gold-glow': '0 0 24px rgba(255,201,74,0.35), 0 0 70px rgba(255,201,74,0.12)',
        'card-lift': '0 20px 45px -18px rgba(4,3,15,0.7)',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: 0.5 },
          '50%': { opacity: 1 },
        },
        drift: {
          '0%, 100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(2%,-3%,0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        pulseGlow: 'pulseGlow 2.4s ease-in-out infinite',
        drift: 'drift 14s ease-in-out infinite',
        shimmer: 'shimmer 2.6s linear infinite',
      },
    },
  },
  plugins: [],
}
