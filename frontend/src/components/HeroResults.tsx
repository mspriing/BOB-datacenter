import { useMemo } from 'react'
import { ArrowRight } from 'lucide-react'
import { SiteRow } from './SiteRow'
import { COVERAGE, PROJECT } from '../data/project'
import { DEFAULT_SITES } from '../data/defaultSites'
import {
  priceSite, rank, flipMultiplier, applyProjections, PROJECTION_DRIVERS,
  type ProjectParams,
} from '../lib/engine'
import { usd } from '../lib/format'
import type { Route } from '../lib/routes'

const P: ProjectParams = {
  capacityKw: PROJECT.capacityMw * 1000, pue: PROJECT.pue,
  lifetimeYears: PROJECT.lifetimeYears, discountRate: PROJECT.discountRate, designWue: 0.4,
}

/** The drivers the fragility panel reports on, most fragile first once measured. */
const FRAGILITY = PROJECTION_DRIVERS.map(driver => driver.key)

/**
 * The page the pull-back lands on, built as the product rather than drawn as a
 * picture of it.
 *
 * This matters more than it looks. The generated last frame of the video reads
 * "Northgate AI Campus" and "Lauddnn County, Viiginis" because a video model
 * invents type it cannot spell. Every figure here is the engine's own output for
 * the three sites shipped with the repo, run locally at load. It is an
 * illustrative offline demo only; submitted comparisons use the backend and
 * never read these values.
 *
 * It is also live. The rows and the button are real controls that open the real
 * screen, so the hero is not a trailer for the product, it is the product at a
 * smaller size.
 */
export function HeroResults({ go, active }: { go: (r: Route) => void; active: boolean }) {
  const model = useMemo(() => {
    const build = (over?: { key: string; driver: string; mult: number }) =>
      rank(DEFAULT_SITES.map(s =>
        priceSite(s.key, s.label, s.place, P,
          applyProjections(s.base, over && over.key === s.key ? { [over.driver]: over.mult } : undefined))))

    const ranked = build()
    const leader = ranked[0]
    const second = ranked[1]

    const flips = FRAGILITY.map(k => {
      const d = PROJECTION_DRIVERS.find(x => x.key === k)
      if (!d) return null
      const m = flipMultiplier(mm => build({ key: leader.key, driver: k, mult: mm }), leader.key, 1, 4)
      const raw = leader.drivers[d.key as keyof typeof leader.drivers]
      return {
        key: k,
        label: d.name,
        pct: m === null ? null : (m - 1) * 100,
        at: m === null || typeof raw !== 'number' ? null : d.fmt(raw * m),
      }
    }).filter(Boolean) as { key: string; label: string; pct: number | null; at: string | null }[]

    // Most fragile first is the whole point of the panel: the driver that needs
    // the smallest move to change the answer belongs at the top.
    flips.sort((a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity))
    return { ranked, leader, second, flips }
  }, [])

  const { ranked, leader, second, flips } = model
  const tightest = flips.find(f => f.pct !== null)

  // Everything animates in on the same curve the video hands over on. Held at
  // zero until the shot is done, so the page does not assemble behind it.
  const step = (i: number) => ({
    transition: 'opacity .5s cubic-bezier(.16,1,.3,1), transform .5s cubic-bezier(.16,1,.3,1)',
    transitionDelay: active ? `${i * 90}ms` : '0ms',
    opacity: active ? 1 : 0,
    transform: active ? 'none' : 'translateY(14px)',
  })

  return (
    <div className="bg-bg p-3 sm:p-4">
      {/* top bar */}
      <div style={step(0)}
        className="mb-3 flex items-center justify-between rounded-[11px] border border-line bg-white px-4 py-2.5">
        <span>
          <span className="text-[17px] font-semibold tracking-[-.02em] text-ink">leepr</span>
          <span className="ml-2 rounded-full bg-card2 px-2 py-1 text-[10px] font-bold uppercase tracking-[.07em] text-mid">
            Offline example
          </span>
        </span>
        <div className="flex gap-1.5">
          {/* The same three steps the real bar shows, in the same order. A
              miniature that disagrees with the thing it stands for is worse
              than no miniature. */}
          {['Start', 'Set up', 'Results'].map(t => (
            <span key={t}
              className={`rounded-full px-3 py-1 text-[12px] font-medium ${
                t === 'Results' ? 'bg-blue-x text-blue-d' : 'text-mid'}`}>{t}</span>
          ))}
        </div>
      </div>

      {/* recommended */}
      <div style={step(1)}
        className="mb-3 grid gap-4 rounded-[13px] border border-line bg-white p-4 lg:grid-cols-[1fr_auto]">
        <div>
          <span className="mb-2 inline-block rounded-full bg-blue-x px-2.5 py-1 text-[11px]
            font-semibold tracking-[.04em] text-blue-d">RECOMMENDED</span>
          <h3 className="text-[clamp(1.5rem,1.1rem+1.4vw,2.25rem)] font-semibold leading-tight tracking-[-.02em] text-ink">
            {leader.label}
          </h3>
          <p className="mt-0.5 text-[13.5px] text-mid">{leader.place}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Lifetime cost per kW', usd(leader.lifetimePerKw)],
            ['Total in today’s money', `$${(leader.npvTotal / 1e6).toFixed(1)}M`],
            ['Score against the set', leader.score.toFixed(3)],
            ['Cost to build', `$${(leader.capex.construction / 1e6).toFixed(1)}M`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[9px] bg-card2 px-3 py-2">
              <div className="text-[10.5px] uppercase tracking-[.08em] text-dim">{k}</div>
              <div className="num mt-0.5 text-[17px] font-semibold text-ink">{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* the fragility sentence, in words */}
      {tightest && (
        <div style={step(2)}
          className="mb-3 flex items-start gap-3 rounded-[11px] border border-[#E4D2A8] bg-[#FBF3E2] px-4 py-3">
          <span aria-hidden className="mt-[3px] block h-[26px] w-[3px] shrink-0 rounded-[2px] bg-[#C8A24A]" />
          <p className="text-[13.5px] leading-[1.55] text-gold">
            {leader.label} stops winning once its {tightest.label.toLowerCase()} reaches{' '}
            <b>{tightest.at}</b>, which is <b>{tightest.pct!.toFixed(1)}%</b> above the figure used here.
            At that point {second.label} takes first place.
          </p>
        </div>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[1.55fr_1fr]">
        {/* the ranked set, through the real row */}
        <div style={step(3)} className="overflow-hidden rounded-[13px] border border-line bg-white">
          {ranked.map((s, i) => (
            <SiteRow key={s.key} site={s} rank={i + 1} perKw={s.lifetimePerKw} winner={i === 0}
              lifetimeYears={PROJECT.lifetimeYears} />
          ))}
        </div>

        {/* what would have to change */}
        <div style={step(4)} className="self-start rounded-[13px] border border-line bg-white p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h4 className="text-[15px] font-semibold text-ink">What would have to change</h4>
            <span className="text-[12px] text-mid">Most fragile first</span>
          </div>
          <div className="space-y-2.5">
            {flips.map(f => {
              const pct = f.pct
              const tone = pct === null ? 'bg-ok' : pct < 5 ? 'bg-bad' : pct < 25 ? 'bg-warn' : 'bg-ok'
              const width = pct === null ? 100 : Math.max(6, Math.min(100, (pct / 150) * 100))
              return (
                <div key={f.key}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span>
                      <span className="block text-[13px] font-medium text-ink2">{f.label}</span>
                      {f.at && (
                        <span className="num mt-0.5 block text-[11.5px] text-mid">
                          reaches {f.at}
                        </span>
                      )}
                    </span>
                    <span className={`num text-[13px] font-semibold ${
                      pct === null ? 'text-mid' : pct < 5 ? 'text-bad' : pct < 25 ? 'text-warn' : 'text-ok'}`}>
                      {pct === null ? 'holds' : `+${pct.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="h-[6px] overflow-hidden rounded-full bg-card2">
                    <i className={`block h-full rounded-full ${tone}`}
                      style={{
                        width: active ? `${width}%` : '0%',
                        transition: 'width .7s cubic-bezier(.16,1,.3,1)',
                        transitionDelay: active ? '520ms' : '0ms',
                      }} />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-3 border-t border-[var(--line2)] pt-3 text-[12px] leading-[1.5] text-mid">
            The smallest move in a single driver that puts a different site first.
          </p>
        </div>
      </div>

      {/* coverage */}
      <div style={step(5)} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [COVERAGE.regions, 'regions covered'],
          [COVERAGE.cells, 'figures published'],
          [COVERAGE.sourced, 'sourced from a named publisher'],
          [COVERAGE.priceable, 'rankable today'],
        ].map(([n, l]) => (
          <div key={l as string} className="rounded-[11px] border border-line bg-white px-3.5 py-2.5">
            <div className="num text-[20px] font-semibold leading-none text-ink">
              {(n as number).toLocaleString()}
            </div>
            <div className="mt-1 text-[12px] text-mid">{l as string}</div>
          </div>
        ))}
      </div>

      <div style={step(6)} className="mt-3 flex justify-end">
        {/* btn-quiet, because btn-ghost is not a class this stylesheet defines.
            It rendered as a bare .btn: no background, no border, no shadow, so
            the one action on the hero did not read as a button at all. */}
        <button className="btn btn-quiet text-[13.5px]" onClick={() => go('results')}>
          Open the full run
          <ArrowRight size={15} strokeWidth={2.4} aria-hidden />
        </button>
      </div>
    </div>
  )
}
