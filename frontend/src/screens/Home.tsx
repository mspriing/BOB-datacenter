import { useMemo, useState } from 'react'
import { ArrowRight, Zap } from 'lucide-react'
import { Card, Reveal, Counter } from '../components/Primitives'
import { HeroPullback } from '../components/HeroPullback'
import { COVERAGE } from '../data/project'
import { DEFAULT_SITES } from '../data/defaultSites'
import { US_METROS } from '../data/usRegions'
import { INTL_REGIONS } from '../data/intlRegions'
import type { Route } from '../lib/routes'
import { PROJECT } from '../data/project'
import {
  priceSite, rank, flipMultiplier, applyProjections, PROJECTION_DRIVERS,
  type ProjectParams,
} from '../lib/engine'
import { usd } from '../lib/format'

const P: ProjectParams = {
  capacityKw: PROJECT.capacityMw * 1000, pue: PROJECT.pue,
  lifetimeYears: PROJECT.lifetimeYears, discountRate: PROJECT.discountRate, designWue: 0.4,
}

// The interconnection panel reads the dataset rather than a hand-typed fixture.
// These three carry basis 'sourced' with a named grid operator behind each one,
// which is the whole point of showing them.
const QUEUE_KEYS = ['ca-toronto', 'fr-paris', 'nl-amsterdam'] as const

export function Home({ go }: { go: (r: Route) => void }) {
  // The worked example starts closed. It used to sit beside the headline, where
  // it asked a first-time reader to follow a three-site comparison before they
  // had seen what the tool looks like.
  const [showExample, setShowExample] = useState(false)

  // Computed from the same engine the results page runs, so the worked example
  // cannot drift away from the run it is describing.
  const eg = useMemo(() => {
    const build = (over?: { key: string; driver: any; mult: number }) =>
      rank(DEFAULT_SITES.map(s =>
        priceSite(s.key, s.label, s.place, P,
          applyProjections(s.base, over && over.key === s.key ? { [over.driver]: over.mult } : undefined))))
    const ranked = build()
    const leader = ranked[0]
    const cheapest = [...ranked].sort((a, b) => a.lifetimePerKw - b.lifetimePerKw)[0]
    const flip = (k: string) => {
      const d = PROJECTION_DRIVERS.find(x => x.key === k)!
      const m = flipMultiplier(mm => build({ key: leader.key, driver: k, mult: mm }), leader.key, 1, 4)
      return m === null ? null : { pct: (m - 1) * 100, at: d.fmt(leader.drivers[d.key] * m) }
    }
    return {
      leader, cheapest,
      premium: ((leader.lifetimePerKw - cheapest.lifetimePerKw) / cheapest.lifetimePerKw) * 100,
      renewable: leader.drivers.renewablePct === null ? null : Math.round(leader.drivers.renewablePct * 100),
      hazard: leader.drivers.riskScore,
      buildFlip: flip('constructionPerKw'),
      powerFlip: flip('powerRate'),
    }
  }, [])

  const short = (x: string) => x.replace(/,.*$/, '')

  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="pt-6 pb-2 sm:pt-12">
        {/* The headline runs the full width. It used to sit in a narrow column
            with a card beside it, and once the card moved down the page the
            right of the screen was empty. */}
        <p className="label-xs mb-4">Data center siting</p>
        <h1 className="mb-6 max-w-[27ch] text-[clamp(2.25rem,1.4rem+3.6vw,4.25rem)]
          font-semibold leading-[1.06] tracking-[-.02em] text-ink">
          The cheapest site to buy is rarely the cheapest site to run.
        </h1>
        <div className="max-w-[62ch]">
          <p className="mb-8 text-[clamp(1.0625rem,1rem+.3vw,1.3125rem)] leading-[1.6] text-mid">
            leepr prices fifteen years for each place you are weighing: build, power, staff,
            water, hazard and the wait to connect. Then it names the single figure that would
            put a different one first.
          </p>
          {/* Into the flow, rather than sideways into the map. The map is one of
              the two ways to name regions, and that choice is made on setup. */}
          <button className="btn btn-primary" onClick={() => go('setup')}>
            Start the comparison
            <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
          </button>
          <p className="mt-4 text-[13.5px] text-mid">Takes about a minute. You do not need an account.</p>
        </div>
      </section>

      {/* ── What the tool looks like ───────────────────────────────────────── */}
      <Reveal className="mt-10">
        <figure className="m-0">
          <HeroPullback go={go} />
          <figcaption className="mt-3 text-[13.5px] leading-[1.55] text-mid">
            One continuous shot, from a rack of servers out to the county and back down onto the answer.
            The page it lands on is the product, not a picture of it: those figures come from the engine
            at load, and the rows open the full run.
          </figcaption>
        </figure>
      </Reveal>

      {/* ── What it does, for the reader who kept scrolling ─────────────────
          The hero used to carry this as a four-line paragraph above the
          button, which asked a first-time reader to finish an explanation
          before they were allowed to start. The headline, one line and the
          button are the whole of the opening now; anyone who wants the detail
          before committing a minute finds it here, under the shot. */}
      <Reveal className="mt-14">
        <Card>
          <div className="p-6 sm:p-8">
            <p className="label-xs mb-3">What it actually does</p>
            <h2 className="mb-6 max-w-[34ch] text-[clamp(1.375rem,1.15rem+1vw,1.875rem)]
              font-semibold leading-[1.15] tracking-[-.01em] text-ink">
              Three things, in the order you meet them.
            </h2>
            <div className="grid gap-6 sm:grid-cols-3 sm:gap-8">
              {[
                ['Prices the whole build',
                 'Cost to build, power, staff and hazard exposure for each region that carries them, with land, water and tax added wherever a published value exists.'],
                ['Ranks against your own assumptions',
                 'Move a driver and the order re-sorts while you watch, so the ranking answers the project you are running rather than a fixed scenario.'],
                ['Names what would flip it',
                 'The smallest move in a single driver that puts a different place first, given as a percentage and as the number it lands on.'],
              ].map(([head, body], i) => (
                <div key={head}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="num text-[12px] font-bold text-dim">{i + 1}</span>
                    <span className="text-[15px] font-semibold text-ink">{head}</span>
                  </div>
                  <p className="text-[14.5px] leading-[1.65] text-mid">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </Reveal>

      {/* ── The insight ────────────────────────────────────────────────────── */}
      <Reveal className="mt-14">
        <Card weave>
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_1fr] lg:gap-12">
            <div>
              <p className="label-xs mb-3">The constraint that is not price</p>
              <h2 className="mb-4 text-[clamp(1.5rem,1.25rem+1.1vw,2.125rem)] font-semibold text-ink">
                In 2026 the binding question is whether you can get power at all.
              </h2>
              <p className="max-w-[58ch] text-[16px] leading-[1.7] text-mid">
                Siting models usually compare the price of electricity. That was the right
                question a decade ago. Today the queue to connect a large load to the grid runs
                years long, and it varies more between regions than the tariff does. A site
                that is two cents cheaper per kWh and four years slower to energize is not the
                cheaper site. So the wait is priced here as a separate driver, alongside the tariff.
              </p>
            </div>
            <div className="space-y-2.5">
              {QUEUE_KEYS.map(key => {
                const r = INTL_REGIONS.find(x => x.key === key)
                const cell = r?.drivers['grid_interconnection_years']
                if (!r || !cell) return null
                const [city, country] = r.label.split(/,\s*/)
                return (
                  <div key={key}
                    className="flex items-center gap-4 rounded-[11px] border border-line bg-white/80 px-4 py-3.5">
                    <Zap size={17} strokeWidth={2} className="shrink-0 text-blue" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium text-ink">{city}</div>
                      <div className="truncate text-[13px] text-mid">{country ?? ''}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-[19px] font-semibold leading-none text-ink">
                        {cell.v}
                      </div>
                      <div className="text-[12px] text-mid">years to connect</div>
                    </div>
                  </div>
                )
              })}
              <p className="pt-1 text-[13px] leading-[1.55] text-mid">
                Interconnection wait is the thirteenth driver in the dataset. These three figures
                come from the grid operators that publish them, which are IESO, RTE and TenneT.
                Amsterdam runs slowest because a Dutch court upheld a refusal of a new 70 MW
                connection.
              </p>
            </div>
          </div>
        </Card>
      </Reveal>

      {/* ── Where to start ─────────────────────────────────────────────────── */}
      <Reveal className="mt-14">
        <Card weave>
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_1fr] lg:gap-12">
            <div>
              <p className="label-xs mb-3">Where to start</p>
              <h2 className="mb-4 text-[clamp(1.5rem,1.25rem+1.1vw,2.125rem)] font-semibold text-ink">
                The map narrows the field before you commit to a shortlist.
              </h2>
              <p className="mb-6 max-w-[58ch] text-[16px] leading-[1.7] text-mid">
                Shade the country by power price, staff cost, hazard risk, clean power,
                distance to your users or cost to build. Pinning is limited to {US_METROS.length} metros
                because a site cannot be ranked without land price, cost to build, power price and
                staffing cost together, and those are the US regions carrying all four today. Pin
                three and the comparison builds itself.
              </p>
              <button className="btn btn-primary" onClick={() => go('map')}>
                Open the map
                <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
              </button>
            </div>
            <div className="space-y-2.5">
              {[
                ['Shade by any driver', 'One question at a time, across every region that has a figure for it.'],
                ['Pin up to three', 'The panel prices each one and lays out what cost alone will not tell you.'],
                ['Carry them forward', 'The pinned set becomes the candidate list on the setup screen.'],
              ].map(([h, b]) => (
                <div key={h} className="rounded-[11px] border border-line bg-white/80 px-4 py-3.5">
                  <div className="text-[15px] font-medium text-ink">{h}</div>
                  <div className="mt-0.5 text-[13.5px] leading-[1.55] text-mid">{b}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </Reveal>

      {/* ── What is behind the numbers ─────────────────────────────────────── */}
      <Reveal className="mt-14">
        <p className="label-xs mb-3">What is behind the numbers</p>
        <h2 className="mb-4 max-w-[46ch] text-[clamp(1.5rem,1.25rem+1.1vw,2.125rem)] font-semibold text-ink">
          Where a figure came from travels with it.
        </h2>
        <p className="mb-6 max-w-[62ch] text-[16px] leading-[1.7] text-mid">
          Each value carries the address it was read from, the month it was checked, and whether it
          was published at that address, worked out from something that was, or assumed. The gaps
          are shown for the same reason: a region missing a cost driver is left out of the ranking
          and named, rather than being scored as though the missing cost were zero.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: COVERAGE.regions, label: 'Regions covered', d: '50 states, one ERCOT zone, 12 metros, 14 international' },
            { n: COVERAGE.sourced, label: 'Values read from a source', d: 'Each names the address and the month it was checked' },
            { n: COVERAGE.modeled, label: 'Values worked out from one', d: 'Each carries the arithmetic that produced it' },
            { n: COVERAGE.empty, label: 'Cells nobody has filled yet', d: 'Listed on the gaps page instead of being guessed' },
          ].map(t => (
            <div key={t.label} className="stat-tile">
              <div className="mb-1.5 text-[30px] font-semibold leading-none tracking-[-.03em] text-ink">
                <Counter to={t.n} />
              </div>
              <div className="text-[14px] font-medium text-ink2">{t.label}</div>
              <div className="mt-1 text-[13px] text-mid">{t.d}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[13.5px] leading-[1.55] text-mid">
          {COVERAGE.priceable} of the {COVERAGE.regions} regions carry the four drivers a ranking
          needs. The rest can be shaded on the map and read one driver at a time, and they stay out
          of any comparison until the missing figures are collected.
        </p>
      </Reveal>

      {/* ── The worked example, behind its own button ──────────────────────── */}
      <Reveal className="mt-14">
        {!showExample && (
          <div className="rounded-[14px] border border-line bg-white/70 p-6 text-center sm:p-8">
            <h2 className="mb-2 text-[clamp(1.25rem,1.1rem+.6vw,1.6rem)] font-semibold text-ink">
              Want to see one finished first?
            </h2>
            <p className="mx-auto mb-5 max-w-[52ch] text-[15.5px] leading-[1.65] text-mid">
              A three-site comparison already run. It ends on the sentence that says which input is
              worth checking before anyone commits money.
            </p>
            <button className="btn btn-primary" onClick={() => setShowExample(true)}>
              See a finished comparison
              <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
            </button>
          </div>
        )}

        {showExample && (
          <Card title="A worked example" note={`${PROJECT.capacityMw} MW, ${PROJECT.lifetimeYears} years`}>
            <div className="p-5 sm:p-6">
              <p className="mb-4 max-w-[70ch] text-[15.5px] leading-[1.7] text-ink2">
                In the run below, the cheapest site loses. {short(eg.cheapest.label)} prices at{' '}
                <b className="num font-semibold text-ink">{usd(eg.cheapest.lifetimePerKw)}</b> per kW
                against {short(eg.leader.label)}&rsquo;s{' '}
                <b className="num font-semibold text-ink">{usd(eg.leader.lifetimePerKw)}</b> and
                still finishes second. A {eg.hazard?.toFixed(1)} hazard score and a{' '}
                {eg.renewable}% renewable grid outweigh a {eg.premium.toFixed(1)}% cost premium.
              </p>
              <div className="rounded-[11px] border border-line bg-card2 p-4">
                <p className="label-xs mb-2">The number worth remembering</p>
                <p className="max-w-[70ch] text-[15px] leading-[1.6] text-ink2">
                  {eg.buildFlip ? (
                    <>
                      {short(eg.leader.label)} stops winning the moment its build cost rises{' '}
                      <b className="num font-semibold text-ink">{eg.buildFlip.pct.toFixed(1)}%</b>.{' '}
                      {eg.powerFlip
                        ? <>Its power price would have to rise{' '}
                            <b className="num font-semibold text-ink">{eg.powerFlip.pct.toFixed(1)}%</b>{' '}
                            to do the same damage. The build estimate is more fragile than the
                            energy contract.</>
                        : <>Its power price never moves the order at all. The build estimate is
                            the fragile figure here.</>}
                    </>
                  ) : (
                    <>{short(eg.leader.label)} holds first place across the whole range these
                      sliders cover.</>
                  )}
                </p>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button className="btn btn-primary" onClick={() => go('results')}>
                  Open the full comparison
                  <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
                </button>
                <button className="btn btn-quiet" onClick={() => setShowExample(false)}>
                  Hide this
                </button>
              </div>
            </div>
          </Card>
        )}
      </Reveal>
    </>
  )
}
