import { useMemo, useState, type MouseEvent } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Pin, PinOff } from 'lucide-react'
import { MAP_VIEWBOX, STATE_SHAPES } from '../../data/geo'
import { US_REGIONS, US_METROS, type UsRegion } from '../../data/usRegions'
import { Explain } from '../Primitives'

/** Drivers with coverage good enough to shade a whole country by. */
export const SHADE_DRIVERS = [
  { key: 'power_rate_usd_per_kwh', name: 'Power price', unit: '$/kWh',
    lowIsGood: true, fmt: (v: number) => '$' + v.toFixed(4),
    help: 'Industrial retail electricity rate. Lower is cheaper to run.' },
  { key: 'staff_cost_index', name: 'Staff cost', unit: 'index',
    lowIsGood: true, fmt: (v: number) => v.toFixed(2),
    help: 'Local fully loaded operations pay against the national median. 1.00 is the median.' },
  { key: 'risk_score', name: 'Hazard risk', unit: '1 to 10',
    lowIsGood: true, fmt: (v: number) => v.toFixed(1),
    help: 'Natural hazard exposure scored 1 to 10. Lower is calmer.' },
  { key: 'renewable_pct', name: 'Clean power', unit: 'share',
    lowIsGood: false, fmt: (v: number) => Math.round(v * 100) + '%',
    help: 'Share of local generation that comes from renewables. Higher is cleaner.' },
  { key: 'latency_ms_to_hub', name: 'Distance to users', unit: 'ms',
    lowIsGood: true, fmt: (v: number) => (v < 1 ? v.toFixed(1) : Math.round(v)) + ' ms',
    help: 'Round trip to the nearest major interconnection hub. Lower is closer.' },
  { key: 'construction_cost_per_kw', name: 'Cost to build', unit: '$/kW',
    lowIsGood: true, fmt: (v: number) => '$' + Math.round(v).toLocaleString('en-US'),
    help: 'What one kilowatt of capacity costs to put in the ground.' },
] as const

export type ShadeKey = typeof SHADE_DRIVERS[number]['key']

// Blue ramp, light to dark. Every step clears 4.5:1 against the white stroke
// and carries no text, so the ramp is decoration over a hover readout.
const RAMP = Array.from({ length: 8 }, (_, i) => `var(--ramp-${i})`)
const NO_DATA = 'var(--map-no-data)'

function ramp(t: number) {
  const i = Math.min(RAMP.length - 1, Math.max(0, Math.round(t * (RAMP.length - 1))))
  return RAMP[i]
}

export function UsMap({
  shade, onShadeChange, pinned, onTogglePin, maxPins = 3,
}: {
  shade: ShadeKey
  onShadeChange: (k: ShadeKey) => void
  pinned: string[]
  onTogglePin: (key: string) => void
  maxPins?: number
}) {
  const [hover, setHover] = useState<string | null>(null)
  const driver = SHADE_DRIVERS.find(d => d.key === shade)!

  const byKey = useMemo(() => {
    const m = new Map<string, UsRegion>()
    for (const r of US_REGIONS) m.set(r.key, r)
    return m
  }, [])

  const { scale, min, max, covered } = useMemo(() => {
    const vals: number[] = []
    for (const r of US_REGIONS) {
      const d = r.drivers[shade]
      if (d) vals.push(d.v)
    }
    const sorted = [...vals].sort((a, b) => a - b)
    const lo = sorted[0], hi = sorted[sorted.length - 1]
    // Quantile rather than linear. Power price runs from $0.038 to $0.315, and a
    // linear ramp puts 90% of the country in the bottom two steps because Hawaii
    // stretches the top. Ranking by position spreads the country across the ramp,
    // which is what makes the map readable.
    return {
      min: lo, max: hi, covered: vals.length,
      scale: (v: number) => {
        if (hi === lo || sorted.length < 2) return 0.5
        let i = 0
        while (i < sorted.length && sorted[i] < v) i++
        const t = i / (sorted.length - 1)
        return driver.lowIsGood ? 1 - t : t
      },
    }
  }, [shade, driver])

  const fillFor = (regionKey: string | null) => {
    if (!regionKey) return NO_DATA
    const r = byKey.get(regionKey)
    const d = r?.drivers[shade]
    if (!d) return NO_DATA
    // invert so darker always reads as better
    return ramp(scale(d.v))
  }

  const readout = (r: UsRegion) => {
    const d = r.drivers[shade]
    return d ? driver.fmt(d.v) : 'no figure yet'
  }

  const pickNearestMetro = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 975
    const y = ((event.clientY - rect.top) / rect.height) * 610
    const radius = (22 / rect.width) * 975
    const nearest = US_METROS
      .map(metro => ({ metro, distance: Math.hypot(metro.x - x, metro.y - y) }))
      .sort((a, b) => a.distance - b.distance)[0]
    if (!nearest || nearest.distance > radius) return
    const isPinned = pinned.includes(nearest.metro.key)
    if (pinned.length < maxPins || isPinned) onTogglePin(nearest.metro.key)
  }

  return (
    <div>
      {/* driver selector */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line2)] px-5 py-3.5">
        <span className="label-xs mr-1">Shade by</span>
        {SHADE_DRIVERS.map(d => (
          <button key={d.key} onClick={() => onShadeChange(d.key)}
            aria-pressed={shade === d.key}
            className={`min-h-[32px] rounded-full px-3 text-[13px] font-medium transition-colors
              ${shade === d.key
                ? 'bg-bluex font-semibold text-blued'
                : 'text-mid hover:bg-card2 hover:text-ink2'}`}>
            {d.name}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[14px] text-ink2">
            <Explain text={driver.help}>{driver.name}</Explain>
            <span className="text-mid"> across {covered} regions</span>
          </p>
          <p className="text-[12.5px] text-mid">
            Click a marked metro to pin it. Up to {maxPins}.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-[11px] border border-line bg-[var(--soft-surface)]">
          <svg viewBox={MAP_VIEWBOX} className="block h-auto w-full" role="img"
            onClick={pickNearestMetro}
            aria-label={`Map of the United States shaded by ${driver.name}`}>
            <g>
              {STATE_SHAPES.map(s => {
                const r = s.regionKey ? byKey.get(s.regionKey) : null
                const isHover = hover === s.regionKey
                return (
                  <Tooltip.Root key={s.abbr} delayDuration={60}>
                    <Tooltip.Trigger asChild>
                      <path d={s.d} className="state-shape"
                        fill={isHover ? 'var(--blue)' : fillFor(s.regionKey)}
                        onMouseEnter={() => setHover(s.regionKey)}
                        onMouseLeave={() => setHover(null)}
                        tabIndex={0}
                        aria-label={`${s.name}, ${r ? readout(r) : 'no figure yet'}`} />
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content sideOffset={6} collisionPadding={12}
                        className="z-50 rounded-[9px] border border-line bg-card px-3 py-2
                                   text-[13px] leading-[1.45] text-ink2 shadow-[0_8px_26px_-10px_rgba(15,23,32,.3)]">
                        <span className="font-semibold text-ink">{s.name}</span>
                        <span className="mx-2 inline-block h-[10px] w-px translate-y-[1px] bg-line" />
                        <span className="num">{r ? readout(r) : 'no figure yet'}</span>
                        {r?.drivers[shade]?.basis === 'modeled' && (
                          <span className="ml-2 rounded-full bg-bluex px-1.5 py-[1px] text-[11px] font-semibold text-blued">
                            modeled
                          </span>
                        )}
                        <Tooltip.Arrow className="fill-card" width={10} height={4} />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                )
              })}
            </g>

            {/* metros, the pinnable set */}
            <g>
              {US_METROS.map(m => {
                const isPinned = pinned.includes(m.key)
                const full = pinned.length >= maxPins && !isPinned
                return (
                  <Tooltip.Root key={m.key} delayDuration={60}>
                    <Tooltip.Trigger asChild>
                      <g className="metro-dot"
                        tabIndex={0} role="button"
                        aria-pressed={isPinned}
                        aria-label={`${m.label}, ${readout(m)}${isPinned ? ', pinned' : full ? ', pin list full' : ''}`}
                        onKeyDown={e => {
                          if ((e.key === 'Enter' || e.key === ' ') && !full) { e.preventDefault(); onTogglePin(m.key) }
                        }}
                        style={{ opacity: full ? 0.45 : 1 }}>
                        <circle cx={m.x} cy={m.y} r={isPinned ? 9 : 6.5}
                          fill={isPinned ? 'var(--blue)' : 'var(--card)'}
                          stroke={isPinned ? 'var(--blue-d)' : 'var(--ink)'}
                          strokeWidth={isPinned ? 2.4 : 1.8} />
                        {isPinned && <circle cx={m.x} cy={m.y} r={3} fill="var(--card)" />}
                      </g>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content sideOffset={8} collisionPadding={12}
                        className="z-50 max-w-[250px] rounded-[9px] border border-line bg-card px-3 py-2
                                   text-[13px] leading-[1.45] text-ink2 shadow-[0_8px_26px_-10px_rgba(15,23,32,.3)]">
                        <div className="font-semibold text-ink">{m.label}</div>
                        <div className="num mt-0.5">{driver.name} {readout(m)}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-blued">
                          {isPinned ? <PinOff size={12} strokeWidth={2.2} aria-hidden />
                                    : <Pin size={12} strokeWidth={2.2} aria-hidden />}
                          {isPinned ? 'Click to unpin' : full ? `Unpin one first` : 'Click to pin'}
                        </div>
                        <Tooltip.Arrow className="fill-card" width={10} height={4} />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                )
              })}
            </g>
          </svg>
        </div>

        {/* legend */}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-mid">{driver.lowIsGood ? 'worse' : 'lower'}</span>
            <span className="flex overflow-hidden rounded-full border border-line" aria-hidden>
              {RAMP.map(c => <i key={c} className="block h-[10px] w-[20px]" style={{ background: c }} />)}
            </span>
            <span className="text-[12.5px] text-mid">{driver.lowIsGood ? 'better' : 'higher'}</span>
          </div>
          <span className="num text-[12.5px] text-mid">
            {driver.fmt(driver.lowIsGood ? max : min)} to {driver.fmt(driver.lowIsGood ? min : max)}
          </span>
          <span className="flex items-center gap-1.5 text-[12.5px] text-mid">
            <svg width="13" height="13" aria-hidden><circle cx="6.5" cy="6.5" r="5" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.8" /></svg>
            metro, deepest coverage
          </span>
          <span className="flex items-center gap-1.5 text-[12.5px] text-mid">
            <i className="inline-block h-[11px] w-[16px] rounded-[3px] border border-line" style={{ background: NO_DATA }} aria-hidden />
            no figure yet
          </span>
        </div>
      </div>
    </div>
  )
}
