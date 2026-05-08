/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        clinical: {
          bg: 'var(--clinical-bg)',
          card: 'var(--clinical-card)',
          border: 'var(--clinical-border)',
          text: 'var(--clinical-text)',
          secondary: 'var(--clinical-secondary)',
          primary: 'var(--clinical-primary)',
        },
        data: {
          glucose: '#2563EB',
          target: '#10B981',
          hypo: '#EF4444',
          hyper: '#F59E0B',
          insulin: '#7C3AED',
          hr: '#F43F5E',
          pace: '#059669',
          load: '#D97706',
        }
      }
    },
  },
  plugins: [],
}
