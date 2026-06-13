/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/**/*.{html,ts,tsx}'
  ],
  darkMode: ['selector', ':root:not(.light)'],
  theme: {
    extend: {
      colors: {
        nndd: {
          bg: 'rgb(var(--nndd-bg) / <alpha-value>)',
          panel: 'rgb(var(--nndd-panel) / <alpha-value>)',
          border: 'rgb(var(--nndd-border) / <alpha-value>)',
          accent: 'rgb(var(--nndd-accent) / <alpha-value>)',
          text: 'rgb(var(--nndd-text) / <alpha-value>)',
          subtext: 'rgb(var(--nndd-subtext) / <alpha-value>)'
        }
      },
      fontFamily: {
        sans: ['"Yu Gothic UI"', '"Meiryo UI"', '"MS UI Gothic"', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
