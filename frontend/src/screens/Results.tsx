import { useState } from 'react'
import { AlertTriangle, ArrowLeft, Leaf, Shield, Gauge } from 'lucide-react'
import {
  Card, FoldCard, StatTile, Counter, CostCaseToggle, Rule, Chip,
} from '../components/Primitives'
import { usd } from '../lib/format'
import type { EstimateOutput, EstimateProject } from '../lib/api'
import type { Route } from '../lib/routes'

type CostCase = 'low' | 'base' | 'high'
type SiteOutput = EstimateOutput['sites'][string]

const DRIVER_NAMES: Record<string, string> = {
  construction_cost_per_kw: 'construction cost',
  power_rate_usd_per_kwh: 'power rate',
  land_cost_per_acre_usd: 'land cost',
  staff_cost_index: 'staffing index',
  risk_score: 'hazard risk',
  renewable_pct: 'renewable share',
  latency_ms_to_hub: 'latency to hub',
}

function moneyM(value: number) {
  return `$${(Math.abs(value) / 1e6).toFixed(2)}M`
}

function Breakdown({ site }: { site: SiteOutput }) {
  const capex = [
    ['Land', site.capex.land_usd],
    ['Construction', site.capex.construction_usd],
    ['Electrical (included in construction)', site.capex.electrical_usd],
    ['Cooling (included in construction)', site.capex.cooling_usd],
    ['IT fit-out (not priced)', site.capex.it_fitout_usd],
  ] as const
  const usage = [
    ['Power', site.opex_annual.power_usd],
    ['Water', site.opex_annual.water_usd],
  ] as const
  const fixed = [
    ['Staff', site.opex_annual.staff_usd],
    ['Maintenance', site.opex_annual.maintenance_usd],
    ['Property tax', site.opex_annual.taxes_usd],
    ['Connectivity', site.opex_annual.connectivity_usd],
  ] as const

  const rows = (items: ReadonlyArray<readonly [string, number]>) => items.map(([label, value]) => (
    <div key={label} className="flex items-center justify-between gap-4 text-[13.5px]">
      <span className="text-mid">{label}</span>
      <span className="num font-medium text-ink2">{moneyM(value)}</span>
    </div>
  ))

  return (
    <div className="grid gap-4 border-t border-[var(--line2)] p-5 md:grid-cols-3">
      <div>
        <p className="label-xs mb-2.5">CapEx · fixed upfront</p>
        <div className="space-y-1.5">{rows(capex)}</div>
        <div className="mt-2 flex items-center justify-between border-t border-[var(--line2)] pt-2 text-[13.5px] font-semibold">
          <span>Total CapEx</span><span className="num">{moneyM(site.capex.total_usd)}</span>
        </div>
      </div>
      <div>
        <p className="label-xs mb-2.5">OpEx · usage-linked annual</p>
        <div className="space-y-1.5">{rows(usage)}</div>
      </div>
      <div>
        <p className="label-xs mb-2.5">OpEx · fixed/modelled annual</p>
        <div className="space-y-1.5">{rows(fixed)}</div>
        <div className="mt-2 flex items-center justify-between border-t border-[var(--line2)] pt-2 text-[13.5px] font-semibold">
          <span>Total annual OpEx</span><span className="num">{moneyM(site.opex_annual.total_usd)}</span>
        </div>
      </div>
    </div>
  )
}

export function Results({ project, server, serverError, go }: {
  project: EstimateProject
  server: EstimateOutput | null
  serverError: string | null
  go: (route: Route) => void
}) {
  const [costCase, setCostCase] = useState<CostCase>('base')

  if (!server) {
    const failed = serverError !== null
    return (
      <section className="pt-8">
        <Card title={failed ? 'The comparison did not finish' : 'Nothing to show yet'}>
          <div className="flex items-start gap-3 p-6">
            {failed && <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad" aria-hidden />}
            <div>
              <p className="text-[15px] leading-[1.65] text-ink2">
                {serverError ?? 'A comparison has not been run. Pick your sites and run it; the results land here.'}
              </p>
              <button className="btn btn-primary mt-4" onClick={() => go('setup')}>
                <ArrowLeft size={14} aria-hidden />Back to setup
              </button>
            </div>
          </div>
        </Card>
      </section>
    )
  }

  const ranked = server.ranking
    .map(siteId => ({ siteId, label: server.site_labels[siteId] ?? siteId, site: server.sites[siteId] }))
    .filter((entry): entry is { siteId: string; label: string; site: SiteOutput } => !!entry.site)
  const leader = ranked[0]

  if (!leader) {
    return (
      <section className="pt-8">
        <Card title="The backend returned no ranked sites">
          <div className="p-6 text-[15px] text-mid">
            Review the unevaluable sites and data gaps below, then choose candidates with enough cost data.
          </div>
        </Card>
      </section>
    )
  }

  const leaderRange = leader.site.finance.ranges[costCase]
  const cheapest = [...ranked].sort(
    (a, b) => a.site.finance.lifetime_cost_per_kw - b.site.finance.lifetime_cost_per_kw,
  )[0]
  const narrativeSource = server.narrative.source === 'watsonx'
    ? 'watsonx Granite, checked against engine figures'
    : server.narrative.source === 'cache'
      ? 'Reused checked explanation'
      : 'Deterministic explanation from engine output'

  return (
    <div className="space-y-3 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[11px] border border-line bg-[var(--soft-surface)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5 text-[13.5px] text-mid">
          <span className="font-semibold text-ink2">Authoritative backend estimate</span>
          <Rule /><span>engine {server.engine_version}</span>
          <Rule /><span>{new Date(server.generated_at).toLocaleString()}</span>
          <Rule /><span>{server.data_provenance.length} sourced or modelled inputs</span>
        </div>
        <button className="pill text-[13px]" onClick={() => go('setup')}>
          <ArrowLeft size={14} aria-hidden />Edit comparison
        </button>
      </div>

      <Card weave>
        <div className="p-6 sm:p-8">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Chip>Recommended</Chip>
            <span className="text-[14px] text-mid">
              {project.name}<Rule />{project.capacity_kw / 1000} MW<Rule />{project.lifetime_years} years
            </span>
          </div>
          <h1 className="mb-7 text-[clamp(2.25rem,1.7rem+2.6vw,3.375rem)] font-semibold tracking-[-.02em] text-ink">
            {leader.label}
          </h1>
          <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-[11px] border border-line bg-[var(--soft-surface)] lg:grid-cols-4 lg:divide-y-0 divide-[var(--line2)]">
            <StatTile bare label="Lifetime cost per kW"
              value={<Counter to={leaderRange.lifetime_per_kw} prefix="$" />}
              foot={`${costCase} case; backend range ${usd(leader.site.finance.ranges.low.lifetime_per_kw)}–${usd(leader.site.finance.ranges.high.lifetime_per_kw)}`} />
            <StatTile bare label="Build cost per kW"
              value={<Counter to={leader.site.finance.capex_per_kw} prefix="$" />}
              foot="Total backend CapEx divided by capacity" />
            <StatTile bare label="Cost NPV"
              value={<><Counter to={Math.abs(leaderRange.npv_usd) / 1e6} prefix="$" decimals={1} />M</>}
              foot="Backend cost NPV; shown as a positive cost" />
            <StatTile bare label="Payback"
              value={<span className="text-[19px]">Not applicable</span>}
              foot="A cost-only model has no revenue or investment return" />
          </div>
          {cheapest.siteId !== leader.siteId && (
            <p className="mt-5 border-l-[3px] border-l-blue bg-bluex px-4 py-3 text-[14px] leading-[1.6] text-ink2">
              <span className="font-semibold">{leader.label} wins the weighted decision, not
              the cost column alone.</span>{' '}
              {cheapest.label} has the lower engine-calculated lifetime cost at{' '}
              {usd(cheapest.site.finance.lifetime_cost_per_kw)} per kW. The weighted score also
              includes risk, clean power and network distance.
            </p>
          )}
        </div>
      </Card>

      <div className="sticky top-0 z-30 -mx-4 border-b border-[var(--glass-border)] bg-[var(--glass-fill)] px-4 py-3 backdrop-blur-[18px] sm:-mx-7 sm:px-7">
        <CostCaseToggle value={costCase} onChange={value => setCostCase(value as CostCase)} />
      </div>

      <Card weave title="Why this ranks first" note={narrativeSource}>
        <div className="space-y-4 p-6 text-[15.5px] leading-[1.7] text-ink2">
          <p>{server.narrative.recommendation}</p>
          <p className="border-l-[3px] border-l-blue bg-bluex px-4 py-3 font-medium text-ink">
            {server.flip_sentence}
          </p>
          {server.narrative.sensitivity_callouts.length > 0 && (
            <details className="rounded-[10px] border border-line bg-[var(--soft-surface)] px-4 py-3">
              <summary className="cursor-pointer text-[14px] font-semibold text-ink2">
                Cost-driver notes for every candidate
              </summary>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] text-mid">
                {server.narrative.sensitivity_callouts.map((item, index) => (
                  <li key={`${item.site_id}-${index}`}>{item.callout}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Card>

      <Card title={`All ${ranked.length} priced sites, ranked`}
        note="Order, scores and every financial value come from the backend response">
        <div className="divide-y divide-[var(--line2)]">
          {ranked.map(({ siteId, label, site }) => {
            const scenario = site.finance.ranges[costCase]
            return (
              <article key={siteId} className={site.rank === 1 ? 'border-l-[3px] border-l-blue' : ''}>
                <div className="grid gap-4 p-5 sm:grid-cols-[42px_1fr_auto] sm:items-center">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-[10px] text-[15px] font-bold
                    ${site.rank === 1 ? 'bg-blue text-onaccent' : 'border border-line bg-card2 text-mid'}`}>
                    {site.rank}
                  </span>
                  <div>
                    <h2 className="flex flex-wrap items-center gap-2 text-[18px] font-semibold text-ink">
                      {label}{site.rank === 1 && <Chip>Recommended</Chip>}
                    </h2>
                    <p className="mt-1 text-[13.5px] text-mid">
                      Score {site.weighted_score.toFixed(3)}
                      <Rule />CapEx {moneyM(site.capex.total_usd)}
                      <Rule />annual OpEx {moneyM(site.opex_annual.total_usd)}
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="num text-[22px] font-semibold text-ink">
                      {usd(scenario.lifetime_per_kw)} <span className="text-[13px] font-medium text-mid">per kW</span>
                    </p>
                    <p className="text-[12.5px] text-mid">
                      low {usd(site.finance.ranges.low.lifetime_per_kw)} · base {usd(site.finance.ranges.base.lifetime_per_kw)} · high {usd(site.finance.ranges.high.lifetime_per_kw)}
                    </p>
                    <p className="text-[12.5px] text-mid">
                      NPV low {moneyM(site.finance.ranges.low.npv_usd)} · base {moneyM(site.finance.ranges.base.npv_usd)} · high {moneyM(site.finance.ranges.high.npv_usd)}
                    </p>
                  </div>
                </div>
                <Breakdown site={site} />
              </article>
            )
          })}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { icon: Shield, label: 'Hazard risk', value: leader.site.non_cost_scores.risk_score?.toFixed(1) ?? 'No data' },
          { icon: Leaf, label: 'Renewable share', value: leader.site.non_cost_scores.renewable_pct === null ? 'No data' : `${Math.round(leader.site.non_cost_scores.renewable_pct * 100)}%` },
          { icon: Gauge, label: 'Latency to hub', value: leader.site.non_cost_scores.latency_ms === null ? 'No data' : `${leader.site.non_cost_scores.latency_ms} ms` },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <div className="flex items-center gap-3 p-5">
              <Icon size={17} className="text-blue" aria-hidden />
              <div><p className="label-xs">{label}</p><p className="num mt-1 font-semibold text-ink">{value}</p></div>
            </div>
          </Card>
        ))}
      </div>

      {(server.data_gaps.length > 0 || server.unevaluable.length > 0 || server.narrative.uncertainty_flags.length > 0) && (
        <Card title="Gaps and sites not included in the ranking">
          <div className="space-y-5 p-5">
            {server.unevaluable.length > 0 && (
              <div>
                <p className="label-xs mb-2">Unevaluable sites</p>
                <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink2">
                  {server.unevaluable.map(site => (
                    <li key={site.site_id}>{site.label}: missing {site.missing_drivers.map(driver => DRIVER_NAMES[driver] ?? driver).join(', ')}</li>
                  ))}
                </ul>
              </div>
            )}
            {server.data_gaps.length > 0 && (
              <div>
                <p className="label-xs mb-2">Data gaps</p>
                <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink2">
                  {server.data_gaps.map((gap, index) => (
                    <li key={`${gap.site_id}-${gap.driver}-${index}`}>
                      {server.site_labels[gap.site_id] ?? gap.site_id}: {DRIVER_NAMES[gap.driver] ?? gap.driver} — {gap.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {server.narrative.uncertainty_flags.length > 0 && (
              <div>
                <p className="label-xs mb-2">Narrative uncertainty flags</p>
                <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink2">
                  {server.narrative.uncertainty_flags.map((flag, index) => (
                    <li key={`${flag.site_id}-${flag.field}-${index}`}>{server.site_labels[flag.site_id] ?? flag.site_id}: {flag.field} — {flag.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {server.parsed_fields.length > 0 && (
        <Card title="Figures parsed from your site notes"
          note="These backend-validated values were used in the engine run">
          <div className="divide-y divide-[var(--line2)]">
            {server.parsed_fields.map((field, index) => (
              <div key={`${field.site_id}-${field.field}-${index}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="text-[14px] text-ink2">
                  {server.site_labels[field.site_id] ?? field.site_id}: {DRIVER_NAMES[field.field] ?? field.field}
                </span>
                <span className="num text-[13.5px] font-semibold text-ink">
                  {field.value.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                  {field.inferred ? ' · inferred by parser' : ' · stated explicitly'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <FoldCard title="Where every backend number came from"
        note={`${server.confidence.sourced} sourced, ${server.confidence.modeled} modeled, ${server.confidence.assumed} assumed, ${server.confidence.missing} missing`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr>
              {['Region', 'Driver', 'Value', 'Basis', 'Source', 'Checked'].map(head => (
                <th key={head} className="border-y border-[var(--line2)] bg-card2 px-5 py-2.5 text-left label-xs">{head}</th>
              ))}
            </tr></thead>
            <tbody>
              {server.data_provenance.map((item, index) => (
                <tr key={`${item.region_key}-${item.driver}-${index}`}>
                  <td className="border-b border-[var(--line2)] px-5 py-3">{item.region_key}</td>
                  <td className="border-b border-[var(--line2)] px-5 py-3">{item.driver}</td>
                  <td className="num border-b border-[var(--line2)] px-5 py-3">{item.value ?? 'not found'}</td>
                  <td className="border-b border-[var(--line2)] px-5 py-3">{item.basis ?? 'unstated'}</td>
                  <td className="border-b border-[var(--line2)] px-5 py-3">
                    {item.source_url ? <a className="link-inline" href={item.source_url} target="_blank" rel="noreferrer">Open source</a> : 'No public source'}
                  </td>
                  <td className="border-b border-[var(--line2)] px-5 py-3">{item.last_verified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FoldCard>

      <FoldCard title="Project-level engine assumptions" note={`${server.assumptions.length} published with this run`}>
        <div className="divide-y divide-[var(--line2)]">
          {server.assumptions.map(item => (
            <div key={item.key} className="p-5">
              <p className="font-semibold text-ink">{item.label}</p>
              <p className="num mt-1 text-[13.5px] text-mid">{item.value} {item.unit} · {item.basis} · checked {item.last_verified}</p>
              <p className="mt-2 text-[13.5px] leading-[1.55] text-ink2">{item.method}</p>
            </div>
          ))}
        </div>
      </FoldCard>
    </div>
  )
}
