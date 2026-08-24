import { motion } from 'framer-motion'
import { Chip, Rule } from './Primitives'
import { usd } from '../lib/format'
import type { SiteResult } from '../lib/engine'

export function SiteRow({ site, rank, perKw, winner, lifetimeYears = 15 }: {
  site: SiteResult; rank: number; perKw: number; winner: boolean; lifetimeYears?: number
}) {
  // Three segments, not five. Switchgear and cooling plant used to be their own
  // slices, charged on top of the cost to build. The published build cost per kW
  // already covers mechanical and electrical work, so they were counted twice.
  const parts = [
    { label: 'Cost to build', usdM: site.capex.construction / 1e6, color: '#0F62FE' },
    { label: 'Land', usdM: site.capex.land / 1e6, color: '#8A73C4' },
    { label: `Running cost over ${lifetimeYears} years`, usdM: site.opexNpv / 1e6, color: '#B9C4D0' },
  ]
  const total = parts.reduce((a, p) => a + p.usdM, 0)
  const marker = ((perKw - site.rangeLow) / (site.rangeHigh - site.rangeLow)) * 100
  const renewablePctInt = site.drivers.renewablePct === null ? null : Math.round(site.drivers.renewablePct * 100)

  return (
    <motion.article layout transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      className={`row-sweep relative grid grid-cols-[38px_1fr] gap-x-4 gap-y-4 border-b
        border-[var(--line2)] p-5 transition-colors last:border-b-0
        hover:bg-[rgba(228,238,255,.42)] lg:grid-cols-[38px_1fr_210px] lg:gap-5
        ${winner ? 'bg-[linear-gradient(95deg,rgba(228,238,255,.72),rgba(255,255,255,0)_66%)]' : ''}`}>
      {winner && (
        <span aria-hidden className="absolute bottom-0 left-0 top-0 w-[3px]
          bg-[linear-gradient(180deg,#0F62FE,#00A3B8)]" />
      )}
      <div className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px]
        text-[15px] font-bold transition-transform
        ${winner
          ? 'border border-transparent bg-[linear-gradient(135deg,#0F62FE,#0043CE)] text-white shadow-[0_3px_10px_-3px_rgba(15,98,254,.55)]'
          : 'border border-line bg-card2 text-mid'}`}>{rank}</div>

      <div className="min-w-0">
        <h4 className="mb-1 flex flex-wrap items-center gap-2 text-[18px] font-semibold tracking-[-.01em] text-ink">
          {site.label}
          {winner && <Chip>Recommended</Chip>}
          {renewablePctInt !== null && renewablePctInt > 60 && (
            <Chip tone="green">{renewablePctInt}% renewable</Chip>
          )}
        </h4>
        <p className="mb-3.5 text-[13.5px] text-mid">
          {site.place}
          {site.drivers.riskScore !== null && <><Rule />hazard {site.drivers.riskScore.toFixed(1)}</>}
          {site.drivers.latencyMs !== null && <><Rule />{site.drivers.latencyMs < 1
            ? site.drivers.latencyMs.toFixed(1) : Math.round(site.drivers.latencyMs)} ms to hub</>}
        </p>
        <div className="mb-2.5 flex h-[8px] overflow-hidden rounded-full bg-card2
                        shadow-[inset_0_1px_2px_rgba(15,23,32,.07)]">
          {parts.map(p => (
            <motion.i key={p.label} className="block h-full" style={{ background: p.color }}
              initial={{ width: 0 }} animate={{ width: `${(p.usdM / total) * 100}%` }}
              transition={{ duration: 0.65, ease: [0.2, 0.8, 0.3, 1] }} />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-mid">
          {parts.map(p => (
            <li key={p.label} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-[9px] w-[9px] rounded-[2px]"
                style={{ background: p.color }} />
              {p.label} <span className="num text-ink2">${p.usdM.toFixed(1)}M</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="lg:text-right">
        <div className="num text-[22px] font-semibold tracking-[-.02em] text-ink">
          {usd(perKw)}<span className="ml-1 text-[13px] font-medium text-mid">per kW</span>
        </div>
        <div className="num mt-1 text-[13px] text-mid">
          Build ${(site.capex.total / 1e6).toFixed(1)}M, running ${(site.opexYear1.total / 1e6).toFixed(2)}M a year
        </div>
        <div className="relative mt-3 h-[5px] rounded-full bg-card2 shadow-[inset_0_1px_2px_rgba(15,23,32,.07)]">
          <span aria-hidden className="absolute inset-0 rounded-full
            bg-[linear-gradient(90deg,rgba(15,98,254,.24),rgba(0,163,184,.5))]"
            style={{ opacity: winner ? 1 : 0.5 }} />
          <motion.span aria-hidden
            className="absolute top-[-3px] h-[11px] w-[3px] -translate-x-1/2 rounded-[2px] bg-ink
                       shadow-[0_1px_3px_rgba(0,0,0,.3)]"
            animate={{ left: `${Math.max(2, Math.min(98, marker))}%` }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }} />
        </div>
        <div className="mt-1.5 flex justify-between gap-2 text-[12px] text-mid">
          <span className="num">{usd(site.rangeLow)}</span>
          <span className="num">{usd(site.rangeHigh)}</span>
        </div>
      </div>
    </motion.article>
  )
}
