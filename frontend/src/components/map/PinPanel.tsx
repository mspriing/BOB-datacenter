import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, Leaf, Gauge, X, MapPin, Clock } from 'lucide-react'
import { US_REGIONS } from '../../data/usRegions'
import { PROJECT } from '../../data/project'
import { driversFor, gapsFor, priceSite, rank, type ProjectParams } from '../../lib/engine'
import { Card, Explain, Chip, Rule } from '../Primitives'
import { usd } from '../../lib/format'

const P: ProjectParams = {
  capacityKw: PROJECT.capacityMw * 1000,
  pue: PROJECT.pue,
  lifetimeYears: PROJECT.lifetimeYears,
  discountRate: PROJECT.discountRate,
  designWue: 0.4,
}

/** The comparison worth surfacing: the three things a cost figure hides. */
function CompareBars({ icon, label, hint, rows, fmt }: {
  icon: React.ReactNode; label: string; hint: string
  rows: Array<{ name: string; v: number | null; max: number; good: boolean }>
  fmt: (n: number) => string
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-blue">{icon}</span>
        <span className="text-[14.5px] font-medium text-ink2">
          <Explain text={hint}>{label}</Explain>
        </span>
      </div>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.name} className="flex items-center gap-3">
            <span className="w-[104px] shrink-0 text-[13px] leading-[1.3] text-mid">{r.name}</span>
            <div className="h-[7px] min-w-[24px] flex-1 overflow-hidden rounded-full bg-card2
                            shadow-[inset_0_1px_2px_rgba(15,23,32,.07)]">
              {r.v !== null && (
                <motion.div className="h-full rounded-full"
                  style={{ background: r.good ? 'var(--ok)' : 'var(--marker)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (r.v / r.max) * 100)}%` }}
                  transition={{ duration: 0.6, ease: [0.2, 0.8, 0.3, 1] }} />
              )}
            </div>
            <span className="num w-[54px] shrink-0 text-right text-[13px] font-semibold text-ink2">
              {r.v === null ? 'no data' : fmt(r.v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PinPanel({ pinned, onUnpin, onClear }: {
  pinned: string[]; onUnpin: (k: string) => void; onClear: () => void
}) {
  const regions = useMemo(
    () => pinned.map(k => US_REGIONS.find(r => r.key === k)!).filter(Boolean),
    [pinned])

  const ranked = useMemo(() => {
    if (regions.length < 1) return []
    const priced = regions.map(r =>
      priceSite(r.key, r.label, r.parentState ?? '', P, driversFor(r)))
    return rank(priced)
  }, [regions])

  const gaps = useMemo(() => {
    const out: Array<{ label: string; missing: string[] }> = []
    for (const r of regions) {
      const g = gapsFor(r)
      if (g.length) out.push({ label: r.label, missing: g })
    }
    return out
  }, [regions])

  if (regions.length === 0) {
    return (
      <Card title="Pinned comparison" note="Nothing pinned yet">
        <div className="p-5">
          <div className="flex items-start gap-3 rounded-[11px] border border-line bg-card2 p-4">
            <MapPin size={17} strokeWidth={2} className="mt-[2px] shrink-0 text-blue" aria-hidden />
            <p className="text-[14px] leading-[1.6] text-mid">
              Pick up to three metros on the map. This panel prices each one on the full
              fifteen years and lays out the three things a cost figure hides.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  const cheapest = [...ranked].sort((a, b) => a.lifetimePerKw - b.lifetimePerKw)[0]
  const short = (s: string) => s.replace(/,.*$/, '')

  return (
    <div className="space-y-3.5">
      <Card title="Pinned comparison"
        note={<button onClick={onClear} className="text-[13px] text-mid transition-colors hover:text-blued">Clear all</button>}>
        <div className="divide-y divide-[var(--line2)]">
          <AnimatePresence initial={false}>
            {ranked.map((s, i) => (
              <motion.div key={s.key} layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                className="relative flex items-start gap-3 p-4">
                <span className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[9px]
                                 text-[13.5px] font-bold
                                 ${i === 0
                                   ? 'bg-[linear-gradient(135deg,var(--blue),var(--blue-d))] text-onaccent shadow-[0_3px_9px_-3px_rgba(15,98,254,.55)]'
                                   : 'border border-line bg-card2 text-mid'}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-[15.5px] font-semibold text-ink">{s.label}</span>
                    {i === 0 && <Chip>Best fit</Chip>}
                  </div>
                  <div className="num text-[13px] text-mid">
                    {usd(s.lifetimePerKw)} per kW
                    <Rule />
                    score {s.score.toFixed(3)}
                  </div>
                </div>
                <button onClick={() => onUnpin(s.key)} aria-label={`Unpin ${s.label}`}
                  className="shrink-0 rounded-[7px] p-1.5 text-mid transition-colors hover:bg-card2 hover:text-bad">
                  <X size={15} strokeWidth={2.2} aria-hidden />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {ranked.length > 1 && (
          <div className="border-t border-[var(--line2)] p-4">
            <p className="text-[13.5px] leading-[1.6] text-mid">
              <span className="font-semibold text-ink2">{short(ranked[0].label)}</span> leads.{' '}
              {ranked[0].key === cheapest.key
                ? 'It is also the cheapest of the pinned set.'
                : <>It costs {usd(ranked[0].lifetimePerKw - cheapest.lifetimePerKw)} per kW more
                   than {short(cheapest.label)} and still finishes first.</>}
            </p>
          </div>
        )}
      </Card>

      <Card title="The things cost cannot tell you">
        <div className="space-y-5 p-5">
          <CompareBars
            icon={<Shield size={15} strokeWidth={2.2} aria-hidden />}
            label="Risk of disruption" hint="Natural hazard exposure scored 1 to 10. Lower is calmer."
            rows={ranked.map(s => ({ name: short(s.label), v: s.drivers.riskScore, max: 10, good: (s.drivers.riskScore ?? 9) < 3 }))}
            fmt={v => v.toFixed(1)} />
          <CompareBars
            icon={<Leaf size={15} strokeWidth={2.2} aria-hidden />}
            label="Clean power on the grid" hint="Share of local generation that comes from renewables."
            rows={ranked.map(s => ({ name: short(s.label), v: s.drivers.renewablePct === null ? null : s.drivers.renewablePct * 100, max: 100, good: (s.drivers.renewablePct ?? 0) > 0.6 }))}
            fmt={v => `${Math.round(v)}%`} />
          <CompareBars
            icon={<Gauge size={15} strokeWidth={2.2} aria-hidden />}
            label="Distance to your users" hint="Round trip to the nearest major hub. Lower is closer."
            rows={ranked.map(s => ({ name: short(s.label), v: s.drivers.latencyMs, max: 50, good: (s.drivers.latencyMs ?? 99) < 10 }))}
            fmt={v => `${v < 1 ? v.toFixed(1) : Math.round(v)} ms`} />
          <CompareBars
            icon={<Clock size={15} strokeWidth={2.2} aria-hidden />}
            label="Years to get connected" hint="Wait to energize a large load on the local grid. Shown only where a grid operator publishes it."
            rows={ranked.map(s => ({ name: short(s.label), v: s.drivers.gridWaitYears, max: 8, good: (s.drivers.gridWaitYears ?? 9) < 3 }))}
            fmt={v => `${v.toFixed(1)} yr`} />
        </div>
      </Card>

      {gaps.length > 0 && (
        <Card title="What is missing here" note="Read the ranking with this in mind">
          <div className="space-y-2.5 p-5">
            {gaps.map(g => (
              <p key={g.label} className="text-[13.5px] leading-[1.55] text-mid">
                <span className="font-semibold text-ink2">{g.label}</span> has no figure for{' '}
                {g.missing.map(m => m.replace(/_/g, ' ').replace(/ usd.*$/, '').replace(/ per kw$/, '')).join(', ')}.
                Those drivers are left out of its score rather than guessed.
              </p>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
