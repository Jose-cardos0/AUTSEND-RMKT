/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      letterSpacing: {
        tight: '-0.015em',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(24px, -18px) scale(1.03)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        float: 'float 20s ease-in-out infinite',
        'float-slow': 'float 28s ease-in-out infinite',
        'fade-in': 'fade-in 0.5s ease-out forwards',
        'fade-in-up': 'fade-in-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        shimmer: 'shimmer 2.5s ease-in-out infinite',
      },
      colors: {
        surface: {
          50: '#f8f9fb',
          100: '#f1f3f6',
          200: '#e2e5ea',
          300: '#cdd1d9',
          400: '#9ca3af',
        },
        primary: {
          50: '#eff1fe',
          100: '#e0e4fd',
          200: '#c7cefb',
          300: '#a4aff8',
          400: '#7c85f3',
          500: '#5b5eeb',
          600: '#4a46de',
          700: '#3f39c4',
          800: '#3530a0',
        },
        accent: {
          50: '#fef7ee',
          100: '#fdead7',
          200: '#f9cfae',
          500: '#ee8b2f',
          600: '#df7118',
        },
      },
      boxShadow: {
        'soft': '0 4px 24px -4px rgba(91, 94, 235, 0.10), 0 2px 8px -2px rgba(0, 0, 0, 0.05)',
        'card': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
        'glow': '0 0 20px -4px rgba(91, 94, 235, 0.15)',
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
      },
    },
  },
  plugins: [],
}
