import { useMemo } from 'react'
import { ArrowRight, Zap } from 'lucide-react'
import { Card, Reveal, Counter } from '../components/Primitives'
import { COVERAGE } from '../data/project'
import { DEFAULT_SITES } from '../data/defaultSites'
import { US_METROS } from '../data/usRegions'
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

export function Home({ go }: { go: (r: Route) => void }) {
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
      <section className="pt-6 pb-2 sm:pt-12">
        <div className="grid items-start gap-8 lg:grid-cols-[1.15fr_.85fr] lg:gap-12">
          <div>
            <p className="label-xs mb-4">Data center siting</p>
            <h1 className="mb-5 text-[clamp(2.25rem,1.6rem+3vw,3.9rem)] font-semibold text-ink">
              Choose a data center site with the whole 15 years priced in.
            </h1>
            <p className="mb-8 max-w-[60ch] text-[clamp(1.0625rem,1rem+.3vw,1.3125rem)] leading-[1.6] text-mid">
              Start on the map or name candidates yourself. The engine prices build, power,
              staff and hazard exposure for every region, adds land, water and tax wherever a
              published figure exists, ranks the set against your projections, then shows
              exactly what would have to change for that ranking to flip.
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              <button className="btn btn-primary" onClick={() => go('map')}>
                Open the map
                <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
              </button>
              <button className="btn btn-quiet" onClick={() => go('results')}>
                See a finished comparison
              </button>
            </div>
            <p className="mt-4 text-[13.5px] text-mid">Takes about a minute. You do not need an account.</p>
          </div>

          <Reveal delay={0.1}>
            <Card title="A worked example" note="10 MW, 15 years">
              <div className="p-5">
                <p className="mb-4 text-[15px] leading-[1.65] text-ink2">
                  In the run below, the cheapest site loses. {short(eg.cheapest.label)} prices at{' '}
                  <b className="num font-semibold text-ink">{usd(eg.cheapest.lifetimePerKw)}</b> per kW
                  against {short(eg.leader.label)}&rsquo;s{' '}
                  <b className="num font-semibold text-ink">{usd(eg.leader.lifetimePerKw)}</b> and
                  still finishes second. A {eg.hazard?.toFixed(1)} hazard score and a{' '}
                  {eg.renewable}% renewable grid outweigh a {eg.premium.toFixed(1)}% cost premium.
                </p>
                <div className="rounded-[11px] border border-line bg-card2 p-4">
                  <p className="label-xs mb-2">The number worth remembering</p>
                  <p className="text-[15px] leading-[1.6] text-ink2">
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
              </div>
            </Card>
          </Reveal>
        </div>
      </section>

      <Reveal className="mt-14">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { n: COVERAGE.regions, label: 'Regions covered', d: '50 states, one ERCOT zone, 12 metros, 14 international' },
            { n: COVERAGE.drivers, label: 'Cost drivers per site', d: 'Land, build, power, water, staff, tax and more' },
            { n: COVERAGE.sourced, label: 'Values traced to a named source', d: 'Each one names its dataset and the month it was checked' },
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
      </Reveal>

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
                cheaper site. So the wait is priced here as a driver of its own, alongside the tariff.
              </p>
            </div>
            <div className="space-y-2.5">
              {DEFAULT_SITES.map(s => (
                <div key={s.key}
                  className="flex items-center gap-4 rounded-[11px] border border-line bg-white/80 px-4 py-3.5">
                  <Zap size={17} strokeWidth={2} className="shrink-0 text-blue" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-ink">{s.label}</div>
                    <div className="truncate text-[13px] text-mid">{s.place}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-[19px] font-semibold leading-none text-ink">
                      {s.base.gridWaitYears}
                    </div>
                    <div className="text-[12px] text-mid">years to connect</div>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-[13px] leading-[1.55] text-mid">
                Interconnection wait is the thirteenth driver in the dataset. These three
                figures are placeholders until the queue pull lands.
              </p>
            </div>
          </div>
        </Card>
      </Reveal>

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
                distance to your users or cost to build. The {US_METROS.length} metros
                carrying the deepest driver coverage are marked. Pin three and the comparison
                builds itself.
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
    </>
  )
}
