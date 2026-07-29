/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: '#060A10',
        panel: '#0D141C',
        'panel-alt': '#121B26',
        'panel-line': '#1B2733',
        teal: {
          DEFAULT: '#2DFFD1',
          dim: '#14A88C',
          deep: '#0B6B5A',
        },
        ink: {
          primary: '#E8F6F3',
          muted: '#5C7A78',
          faint: '#3A4E4D',
        },
        danger: '#FF5470',
      },
      fontFamily: {
        display: ['Rajdhani', 'Noto Sans SC', 'sans-serif'],
        body: ['Noto Sans SC', 'sans-serif'],
        mono: ['Chakra Petch', 'Noto Sans SC', 'monospace'],
      },
      boxShadow: {
        'teal-glow': '0 0 20px rgba(45,255,209,0.25), 0 0 60px rgba(45,255,209,0.08)',
        'teal-glow-lg': '0 0 40px rgba(45,255,209,0.35), 0 0 100px rgba(45,255,209,0.12)',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: 0.5 },
          '50%': { opacity: 1 },
        },
        drift: {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '120px 120px' },
        },
      },
      animation: {
        scanline: 'scanline 4s linear infinite',
        pulseGlow: 'pulseGlow 2.4s ease-in-out infinite',
        drift: 'drift 12s linear infinite',
      },
    },
  },
  plugins: [],
}
