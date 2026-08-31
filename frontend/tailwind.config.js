module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:'var(--bg)', card:'var(--card)', card2:'var(--card2)',
        line:'var(--line)', line2:'var(--line2)',
        ink:'var(--ink)', ink2:'var(--ink2)', mid:'var(--mid)', dim:'var(--dim)',
        onaccent:'var(--on-accent)',
        blue:'var(--blue)', bluel:'var(--blue-l)', bluex:'var(--blue-x)', blued:'var(--blue-d)',
        cyan:'var(--cyan)', ok:'var(--ok)', okd:'var(--ok-d)', warn:'var(--warn)',
        bad:'var(--bad)', gold:'var(--gold)',
      },
      fontFamily: {
        sans:['IBM Plex Sans','system-ui','-apple-system','Segoe UI','sans-serif'],
        mono:['IBM Plex Mono','ui-monospace','monospace'],
      },
    },
  },
  plugins: [],
}
