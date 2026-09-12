/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: '#06070F',
        panel: '#0E1020',
        'panel-alt': '#161A33',
        'panel-2': '#1B2040',
        'panel-line': '#2B3159',
        accent: {
          DEFAULT: '#7C5CFF',
          soft: '#A78BFA',
        },
        accent2: {
          DEFAULT: '#22E5FF',
        },
        hot: {
          DEFAULT: '#FF4FA3',
        },
        gold: {
          DEFAULT: '#FFC94A',
          soft: '#F3DFB0',
        },
        ink: {
          primary: '#F4F2FF',
          muted: '#928DBE',
          faint: '#4C4A79',
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
        'accent-gradient': 'linear-gradient(135deg, #7C5CFF 0%, #22E5FF 100%)',
        'hot-gradient': 'linear-gradient(135deg, #FF4FA3 0%, #FF8A5B 100%)',
        'gold-gradient': 'linear-gradient(135deg, #FFC94A 0%, #C9862B 100%)',
        'grid-lines':
          'linear-gradient(rgba(124,92,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(124,92,255,0.07) 1px, transparent 1px)',
      },
      boxShadow: {
        'accent-glow': '0 0 20px rgba(124,92,255,0.28), 0 0 60px rgba(34,229,255,0.10)',
        'accent-glow-lg': '0 0 40px rgba(124,92,255,0.4), 0 0 110px rgba(34,229,255,0.16)',
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
