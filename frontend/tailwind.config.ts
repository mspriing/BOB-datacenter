/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono:  ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        ibm: {
          blue:    '#0f62fe',
          'blue-dark': '#0043ce',
          'blue-light': '#4589ff',
          teal:    '#009d9a',
          cyan:    '#1192e8',
          green:   '#198038',
          yellow:  '#f1c21b',
          orange:  '#ff832b',
          red:     '#da1e28',
          cool: {
            10:  '#f2f4f8',
            20:  '#dde1e7',
            30:  '#c1c7cd',
            40:  '#a2a9b0',
            50:  '#878d96',
            60:  '#697077',
            70:  '#4d5358',
            80:  '#343a3f',
            90:  '#21272a',
            100: '#121619',
          },
        },
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.06)',
        'card-hover': '0 4px 16px 0 rgba(0,0,0,.14), 0 0 0 1px rgba(0,0,0,.06)',
        'winner': '0 0 0 2px #0f62fe, 0 4px 20px 0 rgba(15,98,254,.22)',
      },
    },
  },
  plugins: [],
}
