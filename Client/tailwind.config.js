/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Cairo Homes palette — coolors.co/e9cfc2-fee8e2-2f5d58
        ch: {
          pine: '#2f5d58',
          'pine-dark': '#1e3f3b',
          'pine-50': '#eef4f3',
          'pine-100': '#d6e5e2',
          blush: '#e9cfc2',
          rose: '#fee8e2',
          clay: '#b5725a',
          'clay-dark': '#8a4f3a',
          muted: '#5e7470',
          ivory: '#fdf6f2',
          sand: '#f6e6de',
          surface: '#fcf5f1',
          fog: '#f3f6f5',
          teal: '#3d7a73',
          ink: '#10211f',
          line: 'rgba(47, 93, 88, 0.14)',
        },
        primary: {
          50: '#eef4f3',
          100: '#d6e5e2',
          200: '#b0cdc8',
          300: '#84afa8',
          400: '#5a8d86',
          500: '#3f756e',
          600: '#2f5d58',
          700: '#274e4a',
          800: '#1f3f3c',
          900: '#183230',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', '"Reem Kufi"', 'Georgia', 'serif'],
        brand: ['"Marcellus"', '"Fraunces"', 'Georgia', 'serif'],
        sans: ['"Manrope"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        num: ['"Manrope"', 'system-ui', 'sans-serif'],
        'arabic-display': ['"Reem Kufi"', '"IBM Plex Sans Arabic"', 'sans-serif'],
      },
      letterSpacing: {
        royal: '0.08em',
        'royal-wide': '0.22em',
      },
      lineHeight: {
        royal: '1.7',
      },
      maxWidth: {
        ch: '1320px',
      },
      borderRadius: {
        arch: '999px 999px 1.25rem 1.25rem',
      },
      transitionTimingFunction: {
        ch: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
