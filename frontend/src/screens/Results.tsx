import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Lightbulb, Shield, Leaf, Gauge, SlidersHorizontal, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Card, FoldCard, StatTile, Counter, CostCaseToggle, Rule, Explain,
} from '../components/Primitives'
import { SiteRow } from '../components/SiteRow'
import { ProjectionSliders } from '../components/ProjectionSliders'
import { PROJECT, COVERAGE } from '../data/project'
import { useSites } from '../lib/useSites'
import {
  applyProjections, priceSite, rank, flipMultiplier, PROJECTION_DRIVERS,
  type ProjectParams, type Projections, type Weights,
} from '../lib/engine'
import { usd } from '../lib/format'
import type { EstimateOutput } from '../lib/api'
import type { Route } from '../lib/routes'

const P: ProjectParams = {
  capacityKw: PROJECT.capacityMw * 1000, pue: PROJECT.pue,
  lifetimeYears: PROJECT.lifetimeYears, discountRate: PROJECT.discountRate, designWue: 0.4,
}


export function Results({ projections, setProjections, pinned, chosen, go, server, serverError }: {
  projections: Projections
  setProjections: (p: Projections) => void
  weights: Weights
  setWeights: (w: Weights) => void
  pinned: string[]
  chosen: string[]
  go: (r: Route) => void
  /** The server's run. Null when it failed or has not returned. */
  server: EstimateOutput | null
  serverError: string | null
}) {
  const [costCase, setCostCase] = useState('base')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { sites, source: siteSource } = useSites(pinned, chosen)

  const build = useMemo(() => (over?: { key: string; driver: any; mult: number }) => {
    const priced = sites.map(s => {
      const p = { ...(projections[s.key] ?? {}) }
      if (over && over.key === s.key) p[over.driver as keyof typeof p] = over.mult
      return priceSite(s.key, s.label, s.place, P, applyProjections(s.base, p))
    })
    return rank(priced)
  }, [sites, projections])

  const ranked = build()
  const leader = ranked[0]
  const second = ranked[1] ?? ranked[0]
  const cheapest = [...ranked].sort((a, b) => a.lifetimePerKw - b.lifetimePerKw)[0]

  const perKw = (s: typeof leader) =>
    costCase === 'low' ? s.rangeLow : costCase === 'high' ? s.rangeHigh : s.lifetimePerKw

  const premiumPct = ((leader.lifetimePerKw - cheapest.lifetimePerKw) / cheapest.lifetimePerKw) * 100
  const gapUsdM = (leader.npvTotal - cheapest.npvTotal) / 1e6

  const fragility = useMemo(() => PROJECTION_DRIVERS.map(d => {
    const up = flipMultiplier(m => build({ key: leader.key, driver: d.key, mult: m }), leader.key, 1, 4)
    return {
      driver: d.name,
      short: d.short,
      unit: d.unit,
      pct: up === null ? null : (up - 1) * 100,
      from: d.fmt(leader.drivers[d.key]),
      to: up === null ? null : d.fmt(leader.drivers[d.key] * up),
    }
  }).sort((a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity)), [leader, build])

  const mostFragile = fragility.find(f => f.pct !== null)

  // Provenance is never synthesised in the browser. If the server did not
  // answer, the table says so rather than showing a plausible-looking fixture.
  const provenance = server?.data_provenance ?? []
  const sourcedCount = server
    ? server.confidence.sourced
    : null
  const short = (s: string) => s.replace(/,.*$/, '')

  // Count how many projection multipliers have moved away from 1.0
  const movedCount = useMemo(() =>
    Object.values(projections).reduce((total, p) => {
      if (!p) return total
      return total + Object.values(p).filter(v => v !== undefined && Math.abs((v as number) - 1) > 0.001).length
    }, 0),
  [projections])

  return (
    <div className="space-y-3 pt-6">
      {/* 0. Where these numbers came from */}
      <div className={`flex flex-wrap items-start gap-2.5 rounded-[11px] border px-4 py-3 text-[13.5px] leading-[1.6]
        ${server ? 'border-line bg-white/70 text-mid' : 'border-[rgba(138,82,0,.3)] bg-[rgba(255,248,235,.9)] text-[#6B4300]'}`}>
        {server ? (
          <>
            <span className="font-semibold text-ink2">Priced by the engine</span>
            <Rule />
            <span>engine {server.engine_version}</span>
            <Rule />
            <span>{server.data_provenance.length} figures with a source</span>
            {movedCount > 0 && (
              <>
                <Rule />
                <span className="font-semibold text-blued">
                  showing your projections, recalculated in the browser
                </span>
              </>
            )}
          </>
        ) : (
          <span>
            {serverError ?? 'The engine has not answered yet.'} The figures below are the browser&rsquo;s
            own mirror of the engine, which is close but is not the published result. Run the
            comparison again to price this on the server.
          </span>
        )}
      </div>

      {/* 1. Hero card */}
      <Card weave>
        <div className="p-6 sm:p-8">
          <div className="mb-3.5 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-[linear-gradient(135deg,#0F62FE,#0043CE)] px-3 py-[5px]
              text-[12px] font-bold uppercase tracking-[.1em] text-white
              shadow-[0_3px_10px_-3px_rgba(15,98,254,.55)]">Recommended</span>
            <span className="text-[14px] text-mid">
              {PROJECT.name}<Rule />{PROJECT.capacityMw} MW<Rule />{PROJECT.lifetimeYears} years
              {siteSource === 'pins' && <><Rule />from your pinned set</>}
            </span>
          </div>
          <h1 key={leader.key}
            className="route-enter mb-1.5 bg-[linear-gradient(120deg,#0F1720_30%,#2B4A7E)] bg-clip-text
                       text-[clamp(2.25rem,1.7rem+2.6vw,3.375rem)] font-semibold text-transparent">
            {leader.label}
          </h1>
          <p className="mb-7 text-[15px] text-mid">{leader.place}</p>
          {/* Stat row: single bordered container with internal dividers */}
          <div className="grid grid-cols-2 divide-x divide-y lg:grid-cols-4 lg:divide-y-0
            divide-[var(--line2)] overflow-hidden rounded-[11px] border border-line bg-white/60">
            <StatTile bare label="Lifetime cost per kW"
              explain="Everything the site costs across all 15 years, land, build, power, staff, water and tax, brought back to today&rsquo;s money and divided by capacity. This is not the build cost."
              value={<Counter to={perKw(leader)} prefix="$" />}
              foot={`${costCase === 'base' ? 'Expected case' : costCase === 'low' ? 'Optimistic case' : 'Cautious case'}, ${usd(leader.rangeLow)} to ${usd(leader.rangeHigh)}`} />
            <StatTile bare label="Total cost in today&rsquo;s money"
              value={<><Counter to={leader.npvTotal / 1e6} prefix="$" decimals={1} />M</>}
              foot={gapUsdM > 0.05 ? `$${gapUsdM.toFixed(1)}M more than the cheapest site` : 'Cheapest in the set'} />
            <StatTile bare label="Score against the set"
              explain="How the site ranks once cost, hazard risk, clean power and distance to your users are put on the same scale."
              value={<Counter to={leader.score} decimals={3} />}
              foot={ranked.length > 1 ? `Next best is ${short(second.label)} at ${second.score.toFixed(3)}` : 'Only one site in the set'} />
            <StatTile bare label="Years of running cost to equal the build"
              value={<><Counter to={leader.opexYearsToEqualCapex} decimals={1} /> yrs</>}
              foot="Build cost divided by one year of running cost" />
          </div>
        </div>
      </Card>

      {/* 2. How solid is this pick */}
      <div className="flex flex-wrap items-start gap-4 rounded-[12px] border border-[rgba(138,101,22,.3)]
        bg-[linear-gradient(100deg,rgba(255,246,229,.94),rgba(255,255,255,.86))] p-5
        shadow-[var(--shadow-lg)] sm:flex-nowrap">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]
          bg-[linear-gradient(135deg,#E09A2B,#C06A12)] shadow-[0_3px_9px_-3px_rgba(192,106,18,.6)]">
          <Lightbulb size={16} strokeWidth={2.4} className="text-white" aria-hidden />
        </div>
        <div>
          <p className="mb-1 text-[12px] font-bold uppercase tracking-[.1em] text-gold">
            How solid is this pick?
          </p>
          <p className="max-w-[86ch] text-[15.5px] leading-[1.65] text-[#5C4310]">
            {mostFragile && mostFragile.pct !== null ? (
              <>
                {leader.label} stops winning once its {mostFragile.short} reaches{' '}
                <b className="num font-semibold text-[#3A2A06]">{mostFragile.to}{mostFragile.unit ? ' ' + mostFragile.unit : ''}</b>, which is{' '}
                <b className="num font-semibold text-[#3A2A06]">{mostFragile.pct.toFixed(1)}%</b>{' '}
                above today&rsquo;s {mostFragile.from}. At that point {short(second.label)} takes
                first place. Every other driver is more forgiving, and the sliders mark the
                crossing point on each track.
              </>
            ) : (
              <>{leader.label} holds first place across the whole range these sliders cover. No
                single driver moves far enough by itself to change the order.</>
            )}
          </p>
        </div>
      </div>

      {/* 3. Sticky control bar */}
      <div className="sticky top-0 z-30 -mx-4 flex items-center justify-between gap-4
        border-b border-white/90 bg-white/[.82] px-4 py-3 backdrop-blur-[18px] backdrop-saturate-[160%]
        shadow-[var(--shadow-lg)] sm:-mx-7 sm:px-7">
        <CostCaseToggle value={costCase} onChange={setCostCase} />
        <button
          className="btn btn-quiet relative flex items-center gap-2 text-[14px]"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog">
          <SlidersHorizontal size={15} strokeWidth={2.2} aria-hidden />
          Adjust projections
          {movedCount > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full
              bg-[linear-gradient(135deg,#0F62FE,#0043CE)] px-1 text-[11px] font-bold text-white
              shadow-[0_2px_6px_-2px_rgba(15,98,254,.6)]">
              {movedCount}
            </span>
          )}
        </button>
      </div>

      {/* 4+5. Ranked sites and engine conclusion — merged into one card */}
      <section className="g">
        <header className="panel-head">
          <h3>All {ranked.length} sites, ranked</h3>
        </header>
        <div className="relative z-[2]">
          {ranked.map((s, i) => (
            <SiteRow key={s.key} site={s} rank={i + 1} perKw={perKw(s)} winner={i === 0} />
          ))}
        </div>
        <div className="border-t border-[var(--line2)]">
          <header className="panel-head">
            <h3>What the engine concluded</h3>
            <span className="panel-note">Calculated first, then written up. No language model wrote any of it.</span>
          </header>
          <div className="relative z-[2] p-6">
            <div className="space-y-4 text-[16px] leading-[1.75] text-ink2">
              <p>
                <b className="font-semibold text-ink">
                  {leader.label} finishes first while costing {premiumPct.toFixed(1)}% more than
                  the cheapest option.
                </b>{' '}
                {short(cheapest.label)} prices at {usd(cheapest.lifetimePerKw)} per kW against{' '}
                {short(leader.label)}&rsquo;s {usd(leader.lifetimePerKw)}, a difference of $
                {gapUsdM.toFixed(1)}M in today&rsquo;s money across {PROJECT.lifetimeYears} years.
                The ranking still favors {short(leader.label)} because hazard risk, clean power
                and distance to your users are scored alongside cost rather than folded into it.
              </p>
              <p>
                The gap is almost entirely in the build. {short(leader.label)} builds at{' '}
                <b className="num font-semibold text-ink">
                  {usd(leader.drivers.constructionPerKw)} per kW
                </b>{' '}
                against {short(cheapest.label)}&rsquo;s {usd(cheapest.drivers.constructionPerKw)}.
                Some of that comes back through power. {short(leader.label)} pays $
                {leader.drivers.powerRate.toFixed(3)} per kWh and spends $
                {(leader.powerAnnual / 1e6).toFixed(2)}M a year on electricity, where{' '}
                {short(cheapest.label)} runs up ${(cheapest.powerAnnual / 1e6).toFixed(2)}M.
              </p>
              {ranked.length > 2 && (
                <p>
                  <b className="font-semibold text-ink">
                    {ranked[ranked.length - 1].label} finishes last.
                  </b>{' '}
                  Its ${(ranked[ranked.length - 1].opexYear1.total / 1e6).toFixed(2)}M of annual
                  running cost is{' '}
                  {(((ranked[ranked.length - 1].opexYear1.total / leader.opexYear1.total) - 1) * 100).toFixed(0)}%
                  above {short(leader.label)}&rsquo;s, driven by $
                  {(ranked[ranked.length - 1].opexYear1.power / 1e6).toFixed(2)}M of power and $
                  {(ranked[ranked.length - 1].opexYear1.taxes / 1e6).toFixed(2)}M in property tax.
                </p>
              )}
              {server && server.data_gaps.length > 0 && (
                <p className="text-[15px] leading-[1.65] text-warn">
                  {server.data_gaps.length} driver{server.data_gaps.length === 1 ? '' : 's'} had no
                  published value for this set and {server.data_gaps.length === 1 ? 'was' : 'were'} left
                  out of the score rather than filled with a benchmark.
                </p>
              )}
            </div>
            {server && (
              <div className="mt-6 flex items-start gap-3 border-t border-[var(--line2)] pt-5">
                <p className="text-[13.5px] leading-[1.55] text-mid">
                  The figures above recalculate in your browser as you move the projections. The
                  source table below comes from the server&rsquo;s own run.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 6. What would have to change + Things cost cannot tell you — side by side */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="What would have to change" note="Most fragile first">
          <div className="space-y-4 p-5">
            {fragility.map(f => (
              <div key={f.driver}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[14.5px] font-medium text-ink2">{f.driver}</span>
                  <span className={`num text-[14.5px] font-bold
                    ${f.pct === null ? 'text-mid' : f.pct < 15 ? 'text-bad' : f.pct < 50 ? 'text-warn' : 'text-ok'}`}>
                    {f.pct === null ? 'holds' : `+${f.pct.toFixed(1)}%`}
                  </span>
                </div>
                <div className="h-[8px] overflow-hidden rounded-full bg-card2
                                shadow-[inset_0_1px_2px_rgba(15,23,32,.08)]">
                  <motion.div className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: f.pct === null ? '100%' : `${Math.min(f.pct, 100)}%` }}
                    transition={{ duration: 0.7, ease: [0.2, 0.8, 0.3, 1] }}
                    style={{ background: f.pct === null ? '#C8D0DA'
                      : f.pct < 15 ? 'linear-gradient(90deg,#C22F2F,#EE6A55)'
                      : f.pct < 50 ? 'linear-gradient(90deg,#9A5E00,#E0A03B)'
                      : 'linear-gradient(90deg,#0B7A4B,#48C08A)' }} />
                </div>
                <p className="mt-1.5 text-[13px] text-mid">
                  {f.pct === null
                    ? 'No change in the order, even at four times the current figure'
                    : `${f.from} rising to ${f.to} swaps first and second place`}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="The things cost cannot tell you">
          <div className="space-y-5 p-5">
            {[
              { icon: <Shield size={15} strokeWidth={2.2} aria-hidden />, label: 'Risk of disruption',
                hint: 'Natural hazard exposure scored 1 to 10. Lower is calmer.',
                get: (s: typeof leader) => s.drivers.riskScore, max: 10,
                good: (v: number) => v < 3, fmt: (v: number) => v.toFixed(1) },
              { icon: <Leaf size={15} strokeWidth={2.2} aria-hidden />, label: 'Clean power on the grid',
                hint: 'Share of local generation that comes from renewables.',
                get: (s: typeof leader) => s.drivers.renewablePct === null ? null : s.drivers.renewablePct * 100,
                max: 100, good: (v: number) => v > 60, fmt: (v: number) => `${Math.round(v)}%` },
              { icon: <Gauge size={15} strokeWidth={2.2} aria-hidden />, label: 'Distance to your users',
                hint: 'Round trip to the nearest major hub. Lower is closer.',
                get: (s: typeof leader) => s.drivers.latencyMs, max: 50,
                good: (v: number) => v < 10, fmt: (v: number) => `${v < 1 ? v.toFixed(1) : Math.round(v)} ms` },
            ].map(row => (
              <div key={row.label}>
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="text-blue">{row.icon}</span>
                  <span className="text-[14.5px] font-medium text-ink2">
                    <Explain text={row.hint}>{row.label}</Explain>
                  </span>
                </div>
                <div className="space-y-2">
                  {ranked.map(s => {
                    const v = row.get(s)
                    return (
                      <div key={s.key} className="flex items-center gap-3">
                        <span className="w-[110px] shrink-0 text-[13px] leading-[1.3] text-mid">
                          {short(s.label)}
                        </span>
                        <div className="h-[7px] min-w-[24px] flex-1 overflow-hidden rounded-full bg-card2
                                        shadow-[inset_0_1px_2px_rgba(15,23,32,.07)]">
                          {v !== null && (
                            <motion.div className="h-full rounded-full"
                              style={{ background: row.good(v) ? '#0B7A4B' : '#7B93B0' }}
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, (v / row.max) * 100)}%` }}
                              transition={{ duration: 0.6, ease: [0.2, 0.8, 0.3, 1] }} />
                          )}
                        </div>
                        <span className="num w-[54px] shrink-0 text-right text-[13px] font-semibold text-ink2">
                          {v === null ? 'no data' : row.fmt(v)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 7. Where every number came from */}
      <FoldCard title="Where every number came from"
        note={sourcedCount !== null
          ? `${sourcedCount} of the values behind this run are traced to a named source`
          : 'Unavailable — the engine did not answer'}>
        <div className="p-5 pb-2">
          <p className="mb-4 max-w-[76ch] text-[15px] leading-[1.65] text-mid">
            This run reads {COVERAGE.drivers} cost drivers for each site. Values marked{' '}
            <b className="font-semibold text-ink2">sourced</b> come straight from a public
            dataset with a date attached. Values marked{' '}
            <b className="font-semibold text-ink2">modeled</b> were derived from a sourced
            figure, and the derivation sits alongside them on{' '}
            <button onClick={() => go('sources')} className="link-inline">the sources page</button>.
          </p>
        </div>
        {provenance.length === 0 ? (
          <div className="px-5 pb-5">
            <p className="rounded-[10px] border border-line bg-card2 px-4 py-3 text-[14px] leading-[1.6] text-ink2">
              The provenance of every driver is held by the engine, not by this page, and the
              engine did not answer on this run. Rather than show you a list this page made up,
              it is showing you nothing. Run the comparison again to load it.
            </p>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                {['Site', 'Driver', 'Value', 'Basis', 'Source', 'Checked'].map(h => (
                  <th key={h} className="border-y border-[var(--line2)] bg-card2 px-5 py-2.5
                    text-left text-[11px] font-bold uppercase tracking-[.09em] text-dim">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {provenance.map((r, i) => {
                const host = (() => {
                  try { return new URL(r.source_url).hostname.replace(/^www\./, '') }
                  catch { return r.source_url }
                })()
                return (
                <tr key={i} className="transition-colors hover:bg-[rgba(228,238,255,.5)]">
                  <td className="num border-b border-[var(--line2)] px-5 py-3 text-mid">{r.region_key}</td>
                  <td className="border-b border-[var(--line2)] px-5 py-3 text-ink2">{r.driver}</td>
                  <td className="num border-b border-[var(--line2)] px-5 py-3 text-ink2">
                    {r.value === null
                      ? <span className="text-warn">not found</span>
                      : r.value.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                  </td>
                  <td className="border-b border-[var(--line2)] px-5 py-3">
                    <span className={`rounded-full px-2 py-[2px] text-[11.5px] font-semibold
                      ${r.basis === 'sourced' ? 'bg-[#D7F0E2] text-okd'
                        : r.basis === 'assumed' ? 'bg-[#FBEED2] text-gold' : 'bg-bluex text-blued'}`}>
                      {r.basis ?? 'unstated'}
                    </span>
                  </td>
                  <td className="border-b border-[var(--line2)] px-5 py-3">
                    <a href={r.source_url} className="link-inline" target="_blank" rel="noreferrer">
                      {host}
                    </a>
                  </td>
                  <td className="num border-b border-[var(--line2)] px-5 py-3 text-mid">{r.last_verified}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
      </FoldCard>

      {/* Projection sliders drawer */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(15,23,32,.28)] backdrop-blur-[2px]" />
          <Dialog.Content
            className="drawer-content fixed bottom-0 right-0 top-0 z-50 w-full overflow-y-auto
              bg-white/[.96] shadow-[var(--shadow-lg)] backdrop-blur-[24px] sm:w-[420px]">
            <Dialog.Title className="sr-only">Projection sliders</Dialog.Title>
            <div className="flex items-center justify-between border-b border-[var(--line2)] px-5 py-4">
              <span className="text-[13px] font-bold uppercase tracking-[.1em] text-ink2">
                Your projections
              </span>
              <Dialog.Close asChild>
                <button className="rounded-[8px] p-1.5 text-mid transition-colors hover:bg-card2 hover:text-ink"
                  aria-label="Close projections">
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <div className="p-4">
              <ProjectionSliders sites={sites} project={P} projections={projections}
                onChange={setProjections} onReset={() => setProjections({})} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
