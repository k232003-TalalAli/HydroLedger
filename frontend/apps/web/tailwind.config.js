/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        border: 'var(--border)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '4px',
        btn: '2px',
      },
      letterSpacing: {
        label: '0.12em',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-critical': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255, 196, 0, 0.55)' },
          '50%': { boxShadow: '0 0 0 4px rgba(255, 196, 0, 0)' },
        },
        'value-flash': {
          '0%': { color: 'var(--accent)' },
          '100%': { color: 'var(--text)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        'pulse-critical': 'pulse-critical 1.4s ease-in-out infinite',
        'value-flash': 'value-flash 150ms ease-out',
      },
    },
  },
  plugins: [],
};
