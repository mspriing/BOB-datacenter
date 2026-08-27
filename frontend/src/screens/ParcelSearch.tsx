import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ArrowLeft, MapPin, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, Explain, Chip, Rule } from '../components/Primitives'
import { CriteriaBox } from '../components/CriteriaBox'
import { ParcelMap, PARCEL_SHADE, type ParcelShadeKey } from '../components/map/ParcelMap'
import { fetchParcels, type ParcelSummary, type ParcelQuery, type SortBy } from '../lib/parcelApi'
import { usd } from '../lib/format'
import type { Route } from '../lib/routes'

/**
 * Every view on this screen reads one state object.
 *
 * This is deliberate. The region tool's worst defect was a candidate picker
 * that wrote to state living inside the screen while the run read a different
 * source, so changing a region changed the dropdown and nothing else. Filter
 * rail, map and list all derive from `query` here, and nothing derives from
 * anything else.
 */
const DEFAULT_QUERY: ParcelQuery = {
  county: 'bexar',
  min_acres: 25,
  page: 1,
  per_page: 50,
  sort_by: 'rank',
}

const SORTS: Array<{ key: SortBy; label: string }> = [
  { key: 'rank',                 label: 'Best fit' },
  { key: 'lifetime_cost_per_kw', label: 'Cheapest lifetime' },
  { key: 'land_cost_per_acre',   label: 'Cheapest land' },
  { key: 'acres',                label: 'Largest' },
]

function NumberFilter({ label, hint, value, onChange, placeholder, suffix }: {
  label: string; hint: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder: string
  suffix?: string
}) {
  return (
    <label className="block">
      <span className="label-xs mb-1.5 block">
        <Explain text={hint}>{label}</Explain>
      </span>
      <div className="flex items-center gap-2">
        <input
          className="field"
          inputMode="numeric"
          placeholder={placeholder}
          value={value ?? ''}
          onChange={e => {
            const raw = e.target.value.trim()
            if (raw === '') return onChange(undefined)
            const n = Number(raw.replace(/[^0-9.]/g, ''))
            onChange(Number.isFinite(n) ? n : undefined)
          }} />
        {suffix && <span className="shrink-0 text-[13px] text-mid">{suffix}</span>}
      </div>
    </label>
  )
}

export function ParcelSearch({ onOpenParcel, go }: {
  onOpenParcel: (id: string) => void
  go: (r: Route) => void
}) {
  const [query, setQuery] = useState<ParcelQuery>(DEFAULT_QUERY)
  const [shade, setShade] = useState<ParcelShadeKey>('lifetime_cost_per_kw')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [parcels, setParcels] = useState<ParcelSummary[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Set when the parcel service did not answer and the screen is reading the
   * recorded snapshot instead. It carries the date the snapshot was taken,
   * which the page prints, because a figure whose age is not stated is a figure
   * nobody can check.
   */
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null)

  /** Unfiltered count, fetched once, so a filter can say what it removed. */
  const [baseline, setBaseline] = useState<number | null>(null)

  const runToken = useRef(0)

  const patch = useCallback((p: Partial<ParcelQuery>) => {
    // Any filter change resets to page 1: staying on page 4 of a result set that
    // no longer has four pages is how a list silently goes blank.
    setQuery(q => ({ ...q, ...p, page: p.page ?? 1 }))
  }, [])

  // Debounced fetch — typing in a number field should not fire a request per keystroke.
  useEffect(() => {
    const token = ++runToken.current
    setLoading(true)
    const t = setTimeout(async () => {
      const r = await fetchParcels(query)
      if (token !== runToken.current) return
      setLoading(false)
      if (r.error || !r.data) { setError(r.error ?? 'No response'); setParcels([]); setTotal(0); return }
      setError(null)
      setSnapshotDate(r.offline ? r.capturedAt ?? 'an earlier run' : null)
      setParcels(r.data.parcels)
      setTotal(r.data.total)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    fetchParcels({ county: 'bexar', per_page: 1 }).then(r => {
      if (r.data) setBaseline(r.data.total)
    })
  }, [])

  const removed = useMemo(
    () => (baseline !== null && total !== null ? baseline - total : null),
    [baseline, total])

  const activeFilters = [
    query.min_acres !== undefined && `${query.min_acres}+ acres`,
    query.max_land_cost_per_acre !== undefined && `land under ${usd(query.max_land_cost_per_acre)}/ac`,
    query.max_dist_tx_m !== undefined && `within ${(query.max_dist_tx_m / 1000).toFixed(1)} km of transmission`,
    query.exclude_flood && 'no flood exposure',
  ].filter(Boolean) as string[]

  return (
    <section className="pt-6 sm:pt-10">
      <div className="mb-7">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button onClick={() => go('setup')} className="pill text-[13px]">
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />
            Back to the build
          </button>
          <p className="label-xs">Step two of two<Rule />Bexar County, Texas</p>
        </div>
        <h1 className="mb-3 max-w-[26ch] text-[clamp(1.875rem,1.4rem+2.2vw,3.25rem)]
          font-semibold leading-[1.08] tracking-[-.02em] text-ink">
          Every parcel worth pricing, ranked before you call a broker.
        </h1>
        <p className="max-w-[68ch] text-[17px] leading-[1.65] text-mid">
          Candidate parcels are priced on the whole build: land, reaching the transmission
          line, reaching fiber, leveling the ground and getting through entitlement, rather than just
          the asking price. Filter to what you can actually use, then open one to see what
          each figure rests on.
        </p>

        {snapshotDate && (
          <div className="mt-5 flex items-start gap-3 rounded-[11px] border border-[#E4D2A8]
            bg-[#FBF3E2] px-4 py-3">
            <AlertTriangle size={16} strokeWidth={2.2} className="mt-[3px] shrink-0 text-gold" aria-hidden />
            <p className="text-[13.5px] leading-[1.6] text-gold">
              The parcel service did not answer, so this page is reading a recording of its
              replies from {snapshotDate}. Those figures are what it returned that day, priced
              on the default build. The order is the one it gave for the whole county, and the
              number beside each entry counts down the set your filters left. Open a row and
              you get the estimate as it stood then rather than a fresh one.
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[320px_1fr] lg:items-start">
        {/* ── Filter rail ───────────────────────────────────────────────── */}
        <div className="space-y-3.5 lg:sticky lg:top-4">
          {/* Applying merges onto the same `query` the rail writes to, so the
              sentence and the controls can never disagree about what is set. */}
          <CriteriaBox onApply={f => patch(f)} />

          <Card title="Narrow the set"
            note={total === null ? 'counting' : `${total.toLocaleString('en-US')} match`}>
            <div className="space-y-4 p-5">
              <NumberFilter label="Smallest site" hint="A 10 MW campus needs roughly 12 acres at 1.2 acres per megawatt, so 25 is a working floor with room for setbacks."
                value={query.min_acres} onChange={v => patch({ min_acres: v })}
                placeholder="25" suffix="acres" />

              <NumberFilter label="Most per acre" hint="Land price is modeled from the appraisal district's land value, not a sale price. Texas does not publish sale prices."
                value={query.max_land_cost_per_acre} onChange={v => patch({ max_land_cost_per_acre: v })}
                placeholder="any" suffix="$ / acre" />

              <NumberFilter label="Furthest from transmission" hint="Straight-line distance to the nearest line of 138 kV or above. Every metre is spur you pay to build."
                value={query.max_dist_tx_m === undefined ? undefined : query.max_dist_tx_m / 1000}
                onChange={v => patch({ max_dist_tx_m: v === undefined ? undefined : v * 1000 })}
                placeholder="any" suffix="km" />

              <label className="flex items-start gap-2.5">
                <input type="checkbox" className="mt-[3px]"
                  checked={query.exclude_flood ?? false}
                  onChange={e => patch({ exclude_flood: e.target.checked || undefined })} />
                <span className="text-[14px] leading-[1.5] text-ink2">
                  <Explain text="Drops parcels with more than a quarter of their area inside a 100-year flood zone.">
                    Exclude flood-exposed parcels
                  </Explain>
                </span>
              </label>

              {removed !== null && removed > 0 && (
                <p className="text-[13px] leading-[1.5] text-mid">
                  Your filters remove {removed.toLocaleString('en-US')} of{' '}
                  {baseline?.toLocaleString('en-US')} candidates.
                </p>
              )}

              {activeFilters.length > 0 && (
                <button onClick={() => setQuery(DEFAULT_QUERY)}
                  className="link-inline text-[13.5px]">Reset filters</button>
              )}
            </div>
          </Card>

          <Card title="Shade the map by">
            <div className="flex flex-wrap gap-2 p-5">
              {PARCEL_SHADE.map(d => (
                <button key={d.key} onClick={() => setShade(d.key)}
                  aria-pressed={shade === d.key}
                  className={`min-h-[32px] rounded-full px-3 text-[13px] font-medium transition-colors
                    ${shade === d.key ? 'bg-bluex font-semibold text-blued' : 'text-mid hover:bg-card2 hover:text-ink2'}`}>
                  {d.name}
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* ── Map + list ────────────────────────────────────────────────── */}
        <div className="space-y-3.5">
          <Card>
            <div className="p-4 sm:p-5">
              <ParcelMap parcels={parcels} shade={shade} selectedId={selectedId}
                onSelect={setSelectedId} className="h-[440px]" />
            </div>
          </Card>

          <Card title="Ranked candidates"
            note={
              <div className="flex items-center gap-2">
                {loading && <Loader2 size={13} className="animate-spin text-mid" aria-hidden />}
                <select className="field h-[30px] py-0 text-[13px]" value={query.sort_by}
                  onChange={e => patch({ sort_by: e.target.value as SortBy })}>
                  {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            }>
            {error ? (
              <div className="flex items-start gap-3 p-5">
                <AlertTriangle size={17} strokeWidth={2.2} className="mt-[2px] shrink-0 text-bad" aria-hidden />
                <div className="text-[14px] leading-[1.6] text-mid">
                  <p className="font-semibold text-ink2">Could not load parcels</p>
                  <p>{error}</p>
                  <p className="mt-1.5">
                    If the ingest has not been run, there is no parcel layer to read yet.
                  </p>
                </div>
              </div>
            ) : parcels.length === 0 && !loading ? (
              <div className="p-5">
                <p className="text-[14px] leading-[1.6] text-mid">
                  No parcel matches every filter. Loosen the tightest one, usually the
                  distance to transmission.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--line2)]">
                {parcels.map((p, i) => {
                  const isSel = p.parcel_id === selectedId
                  return (
                    <div key={p.parcel_id}
                      onMouseEnter={() => setSelectedId(p.parcel_id)}
                      className={`flex items-start gap-3 p-4 transition-colors ${isSel ? 'bg-bluex' : ''}`}>
                      <span className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[9px]
                                       text-[13.5px] font-bold
                                       ${i === 0 && query.page === 1
                                         ? 'bg-[linear-gradient(135deg,#0F62FE,#0043CE)] text-white'
                                         : 'border border-line bg-card2 text-mid'}`}>
                        {(query.page! - 1) * query.per_page! + i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex flex-wrap items-center gap-2">
                          <span className="text-[14.5px] font-medium text-ink">{p.address}</span>
                          {i === 0 && query.page === 1 && p.rank === 1 && <Chip>Best fit</Chip>}
                          {p.unevaluable !== null && <Chip tone="grey">Not priced</Chip>}
                          {p.zoning === 'outside-jurisdiction' && <Chip tone="grey">No zoning</Chip>}
                        </div>
                        <div className="num text-[13px] text-mid">
                          {p.acres === null ? 'acreage unknown' : `${Math.round(p.acres)} ac`}
                          <Rule />
                          {p.lifetime_cost_per_kw === null
                            ? 'no price yet'
                            : `${usd(p.lifetime_cost_per_kw)} per kW`}
                          <Rule />
                          {p.land_cost_per_acre_usd === null
                            ? 'land price not collected'
                            : `${usd(p.land_cost_per_acre_usd)} per acre`}
                          {p.dist_to_tx_line_m !== null && (
                            <><Rule />{(p.dist_to_tx_line_m / 1000).toFixed(1)} km to grid</>
                          )}
                        </div>
                      </div>
                      <button onClick={() => onOpenParcel(p.parcel_id)}
                        className="pill shrink-0 text-[13px]">
                        Open
                        <ArrowRight size={14} strokeWidth={2.4} aria-hidden />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {total !== null && total > (query.per_page ?? 50) && (
              <div className="flex items-center justify-between border-t border-[var(--line2)] p-4">
                <button className="pill text-[13px]" disabled={(query.page ?? 1) <= 1}
                  onClick={() => patch({ page: (query.page ?? 1) - 1 })}>Previous</button>
                <span className="text-[13px] text-mid">
                  Page {query.page} of {Math.ceil(total / (query.per_page ?? 50))}
                </span>
                <button className="pill text-[13px]"
                  disabled={(query.page ?? 1) >= Math.ceil(total / (query.per_page ?? 50))}
                  onClick={() => patch({ page: (query.page ?? 1) + 1 })}>Next</button>
              </div>
            )}
          </Card>

          <p className="flex items-start gap-2 text-[13px] leading-[1.55] text-mid">
            <MapPin size={14} strokeWidth={2} className="mt-[2px] shrink-0 text-blue" aria-hidden />
            Land price is modeled from appraisal-district land value divided by the Texas
            Comptroller appraisal ratio. Texas does not publish sale prices, so this is a model,
            not a market quote.
          </p>
        </div>
      </div>
    </section>
  )
}
