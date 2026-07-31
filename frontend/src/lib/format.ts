export const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
export const usdc = (n: number, d = 3) => '$' + n.toFixed(d)
export const pct = (n: number, d = 0) => `${n.toFixed(d)}%`
export const ms = (n: number) => `${n < 1 ? n.toFixed(1) : Math.round(n)} ms`
