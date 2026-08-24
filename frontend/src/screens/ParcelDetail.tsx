import { useEffect, useState } from 'react'
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, Explain, Chip, StatTile, Counter, Rule } from '../components/Primitives'
import { fetchParcel } from '../lib/parcelApi'
import { usd } from '../lib/format'

/** Shape as the API actually returns it — keys are `driver` and `region_key`. */
interface ProvenanceRow {
  region_key: string
  driver: string
  value: number | string | null
  basis?: 'sourced' | 'modeled' | 'assumed' | null
  source_url: string
  last_verified: string
  method?: string
}

/** Gaps are objects, not strings. */
interface GapRow { driver: string; reason: string }

interface ParcelEstimate {
  parcel_id: string
  address: string
  county: string
  acres: number | null
  zoning: string
  flood_buildable_pct: number | null
  parcel_capex: {
    interconnect_capex_usd: number
    fiber_capex_usd: number
    entitlement_cost_usd: number
    sitework_usd: number
    land_cost_usd: number
    total_usd: number
  }
  capex: {
    land_usd: number
    construction_usd: number
    electrical_usd: number
    cooling_usd: number
    it_fitout_usd: number
    total_usd: number
  }
  finance: {
    capex_per_kw: number
    lifetime_cost_per_kw: number
    npv_usd: number
    payback_years: number
  }
  provenance: ProvenanceRow[]
  gaps: GapRow[]
  parcel_note?: string
  parcel_note_source?: 'watsonx' | 'fallback' | 'cache'
  rank: number
  weighted_score: number
}

const BASIS_TONE: Record<string, 'blue' | 'green' | 'grey'> = {
  sourced: 'green', modeled: 'blue', assumed: 'grey',
}

function Row({ label, value, hint, muted = false }: {
  label: string; value: string; hint?: string; muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className={`text-[14px] ${muted ? 'text-mid' : 'text-ink2'}`}>
        {hint ? <Explain text={hint}>{label}</Explain> : label}
      </span>
      <span className={`num shrink-0 text-[14px] font-semibold ${muted ? 'text-mid' : 'text-ink'}`}>{value}</span>
    </div>
  )
}

export function ParcelDetail({ parcelId, onBack }: { parcelId: string; onBack: () => void }) {
  const [est, setEst] = useState<ParcelEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setEst(null); setError(null)
    fetchParcel(parcelId).then(r => {
      if (!live) return
      if (r.error || !r.data) setError(r.error ?? 'No response')
      else setEst(r.data as ParcelEstimate)
    })
    return () => { live = false }
  }, [parcelId])

  if (error) {
    return (
      <section className="pt-6 sm:pt-10">
        <button onClick={onBack} className="link-inline mb-4 text-[14px]">
          <ArrowLeft size={14} strokeWidth={2.4} aria-hidden /> Back to the search
        </button>
        <Card title="Could not load this parcel">
          <div className="flex items-start gap-3 p-5">
            <AlertTriangle size={17} strokeWidth={2.2} className="mt-[2px] shrink-0 text-bad" aria-hidden />
            <p className="text-[14px] leading-[1.6] text-mid">{error}</p>
          </div>
        </Card>
      </section>
    )
  }

  if (!est) {
    return (
      <section className="flex min-h-[50vh] items-center justify-center">
        <Loader2 size={22} className="animate-spin text-mid" aria-hidden />
      </section>
    )
  }

  const pc = est.parcel_capex
  const cx = est.capex

  // Land is charged for the whole parcel, because a seller will not split off
  // only the acreage a campus needs. The figure a region-level comparison would
  // have used is shown beside it so the difference is visible rather than
  // buried in the total.
  const wholeParcelLand = cx.land_usd
  const campusAcres     = 12   // engine rule: ~1.2 acres per MW, 10 MW default
  const perAcre         = est.acres ? wholeParcelLand / est.acres : null

  return (
    <section className="pt-6 sm:pt-10">
      <button onClick={onBack} className="link-inline mb-4 text-[14px]">
        <ArrowLeft size={14} strokeWidth={2.4} aria-hidden /> Back to the search
      </button>

      <div className="mb-7 max-w-[68ch]">
        <p className="label-xs mb-3">Parcel {est.parcel_id} · {est.county}</p>
        <h1 className="mb-3 text-[clamp(1.5rem,1.2rem+1.4vw,2.25rem)] font-semibold text-ink">
          {est.address}
        </h1>
        <div className="num flex flex-wrap items-center gap-x-1 text-[14px] text-mid">
          {est.acres === null ? 'acreage unknown' : `${Math.round(est.acres)} acres`}
          <Rule />
          rank {est.rank}
          <Rule />
          score {est.weighted_score.toFixed(3)}
          {est.zoning === 'outside-jurisdiction' && (
            <span className="ml-2"><Chip tone="grey">Outside city zoning</Chip></span>
          )}
        </div>
      </div>

      <div className="mb-3.5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Lifetime cost per kW"
          value={<Counter to={est.finance.lifetime_cost_per_kw} prefix="$" />}
          explain="Whole-life cost divided by IT capacity, discounted." />
        <StatTile label="Build cost per kW"
          value={<Counter to={est.finance.capex_per_kw} prefix="$" />}
          explain="Capital cost divided by IT capacity." />
        <StatTile label="Total in today's money"
          value={<><Counter to={Math.abs(est.finance.npv_usd) / 1e6} prefix="$" decimals={1} />M</>}
          explain="Net present value of the whole build and its running cost." />
        <StatTile label="Payback"
          value={<><Counter to={est.finance.payback_years} decimals={1} /> yrs</>}
          explain="Years of running cost to equal the build." />
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="space-y-3.5">
          {est.parcel_note && (
            <div className="flex items-start gap-3 rounded-[12px] border border-line bg-white p-4">
              <span className="mt-[1px] flex h-[26px] w-[26px] shrink-0 items-center justify-center
                               rounded-[8px] bg-[linear-gradient(135deg,#0F62FE,#0043CE)]
                               text-[11px] font-bold text-white">
                {est.parcel_note_source === 'watsonx' ? 'wx' : '≡'}
              </span>
              <div>
                <p className="text-[14.5px] leading-[1.6] text-ink2">{est.parcel_note}</p>
                <p className="mt-1.5 text-[12.5px] text-mid">
                  {est.parcel_note_source === 'watsonx'
                    ? 'Written by watsonx Granite from the figures below. The model quotes them and never computes one.'
                    : 'Written by the deterministic template, because watsonx credentials were not available on this run. Every figure is the engine’s.'}
                </p>
              </div>
            </div>
          )}

          <Card title="What this site costs to reach"
            note="The costs a region-level view cannot see">
            <div className="divide-y divide-[var(--line2)] px-5 py-2">
              <Row label="Reaching the transmission line"
                hint="Spur from the nearest line of 138 kV or above, plus a substation allowance."
                value={usd(pc.interconnect_capex_usd)} />
              <Row label="Reaching fiber"
                hint="Conduit to the nearest interconnection facility."
                value={usd(pc.fiber_capex_usd)} />
              <Row label="Getting through entitlement"
                hint="Carrying cost on the land while permissions are obtained."
                value={usd(pc.entitlement_cost_usd)} />
              <Row label="Levelling the ground"
                hint="Earthwork from the parcel's mean slope."
                value={usd(pc.sitework_usd)} />
            </div>
          </Card>

          <Card title="The whole build">
            <div className="divide-y divide-[var(--line2)] px-5 py-2">
              <Row label="Land, whole parcel"
                hint="The full acreage at this parcel's modeled price. A seller will not usually split off only the acreage a campus needs, so acquisition is priced for the whole thing."
                value={usd(wholeParcelLand)} />
              <Row label="Construction" value={usd(cx.construction_usd)} />
              <Row label="Electrical" value={usd(cx.electrical_usd)} />
              <Row label="Cooling" value={usd(cx.cooling_usd)} />
              <Row label="IT fit-out" value={usd(cx.it_fitout_usd)} />
              <Row label="Site-specific costs above"
                value={usd(pc.interconnect_capex_usd + pc.fiber_capex_usd + pc.entitlement_cost_usd + pc.sitework_usd)}
                muted />
              <div className="flex items-baseline justify-between gap-4 border-t border-line py-3">
                <span className="text-[15px] font-semibold text-ink">Total capital cost</span>
                <span className="num text-[16px] font-bold text-ink">{usd(cx.total_usd)}</span>
              </div>
            </div>
          </Card>

          {est.acres !== null && perAcre !== null && (
            <div className="flex items-start gap-3 rounded-[12px] border border-line bg-card2 p-4">
              <AlertTriangle size={17} strokeWidth={2.2} className="mt-[2px] shrink-0 text-blue" aria-hidden />
              <p className="text-[13.5px] leading-[1.6] text-mid">
                <span className="font-semibold text-ink2">The whole parcel is priced, not just
                the footprint.</span> A 10 MW campus occupies roughly {campusAcres} acres, but this
                listing is {Math.round(est.acres)}, and a seller will not usually split it. The
                total charges all {Math.round(est.acres)} acres at {usd(perAcre)} each. A
                region-level comparison would have counted only the footprint, which is why a
                large cheap parcel can rank worse here than its price per acre suggests.
              </p>
            </div>
          )}

          <Card title="Where every figure comes from"
            note={`${est.provenance.length} figures`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--line2)] text-mid">
                    <th className="px-5 py-2.5 font-medium">Figure</th>
                    <th className="px-3 py-2.5 font-medium">Value</th>
                    <th className="px-3 py-2.5 font-medium">Basis</th>
                    <th className="px-5 py-2.5 font-medium">Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {est.provenance.map((p, i) => {
                    const name = (p.driver ?? 'unknown').replace(/_/g, ' ')
                    // A figure carried from the county dataset rather than measured
                    // on this parcel says so, so a reader is never left thinking a
                    // regional average was surveyed here.
                    const fromCounty = p.region_key !== est.parcel_id
                    return (
                      <tr key={`${p.driver}-${i}`} className="border-b border-[var(--line2)] last:border-0">
                        <td className="px-5 py-2.5 text-ink2">
                          {p.method ? <Explain text={p.method}>{name}</Explain> : name}
                          {fromCounty && (
                            <span className="ml-1.5 text-[11.5px] text-mid">county figure</span>
                          )}
                        </td>
                        <td className="num px-3 py-2.5 text-ink2">
                          {p.value === null || p.value === undefined ? 'no figure' : String(p.value)}
                        </td>
                        <td className="px-3 py-2.5">
                          {p.basis
                            ? <Chip tone={BASIS_TONE[p.basis] ?? 'grey'}>{p.basis}</Chip>
                            : <span className="text-[12.5px] text-mid">none</span>}
                        </td>
                        <td className="px-5 py-2.5 text-mid">{p.last_verified || 'not dated'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-3.5 lg:sticky lg:top-4">
          <Card title="What is missing here"
            note={est.gaps.length === 0 ? 'Nothing flagged' : `${est.gaps.length} gap${est.gaps.length === 1 ? '' : 's'}`}>
            <div className="space-y-3 p-5">
              {est.gaps.length === 0 ? (
                <p className="text-[13.5px] leading-[1.55] text-mid">
                  Every driver in the ranking carries a figure for this parcel.
                </p>
              ) : (
                est.gaps.map(g => (
                  <p key={g.driver} className="text-[13.5px] leading-[1.55] text-mid">
                    <span className="font-semibold text-ink2">
                      {(g.driver ?? 'unknown').replace(/_/g, ' ')}
                    </span>{' '}
                    has no figure. {g.reason}
                  </p>
                ))
              )}
              <p className="border-t border-[var(--line2)] pt-3 text-[13px] leading-[1.55] text-mid">
                Interconnection wait is a placeholder everywhere. ERCOT publishes the large-load
                queue only as PDFs, and in 2026 that wait dominates siting economics, so it is
                marked assumed rather than modeled from something weaker.
              </p>
            </div>
          </Card>

          {est.flood_buildable_pct !== null && est.flood_buildable_pct < 1 && (
            <Card title="Flood exposure">
              <div className="p-5">
                <p className="text-[13.5px] leading-[1.55] text-mid">
                  {Math.round((1 - est.flood_buildable_pct) * 100)}% of this parcel sits inside a
                  mapped flood zone, so the buildable area is smaller than the acreage suggests.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </section>
  )
}
