/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          main: '#252526',
          pane: '#1E1E1E',
        },
        primary: '#D2B48C',
        muted: '#A68A61',
        accent: {
          yellow: '#FDFD96',
          green: '#77DD77',
          red: '#FF6961',
        }
      }
    },
  },
  plugins: [],
}
