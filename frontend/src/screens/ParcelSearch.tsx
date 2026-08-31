import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ArrowLeft, MapPin, AlertTriangle, Info, Loader2 } from 'lucide-react'
import { Card, Explain, Chip, Rule } from '../components/Primitives'
import { CriteriaBox } from '../components/CriteriaBox'
import { ParcelMap, PARCEL_SHADE, type ParcelShadeKey } from '../components/map/ParcelMap'
import { fetchParcelMap, fetchParcels, type ParcelSummary, type ParcelQuery, type SortBy } from '../lib/parcelApi'
import type { EstimateProject } from '../lib/api'
import { usd } from '../lib/format'
import { quantileScale, rampColor } from '../lib/ramp'
import { useReducedMotion } from '../lib/useReducedMotion'
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

export function ParcelSearch({ project, onOpenParcel, go }: {
  project: EstimateProject
  onOpenParcel: (id: string) => void
  go: (r: Route) => void
}) {
  const defaultQuery = useMemo<ParcelQuery>(() => ({
    county: 'bexar',
    min_acres: 25,
    page: 1,
    per_page: 50,
    sort_by: 'rank',
    capacity_kw: project.capacity_kw,
    design_pue: project.design_pue,
    design_wue: project.design_wue,
    lifetime_years: project.lifetime_years,
    discount_rate: project.discount_rate,
  }), [project])
  const [query, setQuery] = useState<ParcelQuery>(defaultQuery)
  const [shade, setShade] = useState<ParcelShadeKey>('lifetime_cost_per_kw')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const reducedMotion = useReducedMotion()

  const [parcels, setParcels] = useState<ParcelSummary[]>([])
  const [mapParcels, setMapParcels] = useState<ParcelSummary[]>([])
  const [mapTotal, setMapTotal] = useState<number | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** The recorded snapshot's capture date, shown whenever that fallback is in use. */
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null)

  /** Unfiltered count, fetched once, so a filter can say what it removed. */
  const [baseline, setBaseline] = useState<number | null>(null)

  const runToken = useRef(0)

  const patch = useCallback((p: Partial<ParcelQuery>) => {
    // Any filter change resets to page 1: staying on page 4 of a filtered list that
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

  const mapQuery = useMemo<ParcelQuery>(() => ({
    county: query.county,
    min_acres: query.min_acres,
    max_acres: query.max_acres,
    max_land_cost_per_acre: query.max_land_cost_per_acre,
    max_dist_tx_m: query.max_dist_tx_m,
    exclude_flood: query.exclude_flood,
    capacity_kw: query.capacity_kw,
    design_pue: query.design_pue,
    design_wue: query.design_wue,
    lifetime_years: query.lifetime_years,
    discount_rate: query.discount_rate,
    weights: query.weights,
    sort_by: query.sort_by,
  }), [
    query.county, query.min_acres, query.max_acres, query.max_land_cost_per_acre,
    query.max_dist_tx_m, query.exclude_flood, query.capacity_kw, query.design_pue,
    query.design_wue, query.lifetime_years, query.discount_rate, query.weights,
    query.sort_by,
  ])

  const mapToken = useRef(0)
  useEffect(() => {
    const token = ++mapToken.current
    fetchParcelMap(mapQuery).then(r => {
      if (token !== mapToken.current || r.error || !r.data) return
      setMapParcels(r.data.parcels)
      setMapTotal(r.data.total)
    })
  }, [mapQuery])

  useEffect(() => {
    fetchParcels({
      county: 'bexar',
      per_page: 1,
      capacity_kw: project.capacity_kw,
      design_pue: project.design_pue,
      design_wue: project.design_wue,
      lifetime_years: project.lifetime_years,
      discount_rate: project.discount_rate,
    }).then(r => {
      if (r.data) setBaseline(r.data.total)
    })
  }, [project])

  const removed = useMemo(
    () => (baseline !== null && total !== null ? baseline - total : null),
    [baseline, total])

  const activeWeightLabel = query.weights && Object.keys(query.weights).length > 0
    ? `ranking: ${Object.entries(query.weights)
        .map(([key, value]) => `${key.replace('total_cost', 'cost')} ${Math.round((value ?? 0) * 100)}%`)
        .join(', ')}`
    : false

  const activeFilters = [
    query.min_acres !== undefined && `${query.min_acres}+ acres`,
    query.max_acres !== undefined && `at most ${query.max_acres} acres`,
    query.max_land_cost_per_acre !== undefined && `land under ${usd(query.max_land_cost_per_acre)}/ac`,
    query.max_dist_tx_m !== undefined && `within ${(query.max_dist_tx_m / 1000).toFixed(1)} km of transmission`,
    query.exclude_flood && 'no known flood overlap',
    activeWeightLabel,
  ].filter(Boolean) as string[]

  const recordedDate = snapshotDate
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${snapshotDate}T00:00:00Z`))
    : null

  const scoreScale = useMemo(() => quantileScale(
    mapParcels.map(parcel => parcel.weighted_score).filter(Number.isFinite),
    false,
  ), [mapParcels])
  const missingFloodCount = useMemo(
    () => mapParcels.filter(parcel => parcel.flood_buildable_pct === null).length,
    [mapParcels],
  )
  const rankOne = useMemo(
    () => mapParcels.reduce<ParcelSummary | null>((best, parcel) => {
      if (parcel.rank <= 0) return best
      return !best || parcel.rank < best.rank ? parcel : best
    }, null),
    [mapParcels],
  )
  const displayedTopScoreTies = useMemo(
    () => rankOne
      ? mapParcels.filter(parcel => parcel.weighted_score === rankOne.weighted_score).length
      : 0,
    [mapParcels, rankOne],
  )

  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const selectParcel = useCallback((id: string) => {
    setSelectedId(id)
    const index = mapParcels.findIndex(parcel => parcel.parcel_id === id)
    if (index < 0) return
    const perPage = query.per_page ?? 50
    const page = Math.floor(index / perPage) + 1
    if (page !== (query.page ?? 1)) patch({ page })
  }, [mapParcels, patch, query.page, query.per_page])

  useEffect(() => {
    if (!selectedId || !parcels.some(parcel => parcel.parcel_id === selectedId)) return
    requestAnimationFrame(() => {
      rowRefs.current.get(selectedId)?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      })
    })
  }, [parcels, selectedId, reducedMotion])

  return (
    <section className="pt-6 sm:pt-10">
      <div className="mb-7">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button onClick={() => go('setup')} className="pill text-[13px]">
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />
            Back to the build
          </button>
          <p className="label-xs">Step two of three<Rule />Bexar County, Texas</p>
        </div>
        <h1 className="mb-3 max-w-[26ch] text-[clamp(1.875rem,1.4rem+2.2vw,3.25rem)]
          font-semibold leading-[1.08] tracking-[-.02em] text-ink">
          Bexar County parcels, priced and ranked before you call a broker.
        </h1>
        <p className="max-w-[68ch] text-[17px] leading-[1.65] text-mid">
          Candidate parcels are priced on the whole build: land, reaching the transmission
          line, reaching fiber, leveling the ground and getting through entitlement, rather than just
          the asking price. Filter to what you can actually use, then open one to see what
          each figure rests on.
        </p>

        {snapshotDate && (
          <div className="mt-5 rounded-[11px] border border-line bg-card2 px-4 py-3">
            <div className="flex items-start gap-3">
              <Info size={16} strokeWidth={2.2} className="mt-[3px] shrink-0 text-mid" aria-hidden />
              <p className="text-[13.5px] leading-[1.6] text-ink2">
                Reading the recorded run from {recordedDate}. All{' '}
                {(baseline ?? total)?.toLocaleString('en-US') ?? 'recorded'} Bexar parcels,
                priced on the default build, exactly as the server returned them that day.
                Set your own capacity and lifetime and the live service reprices them.
              </p>
            </div>
            <details className="ml-7 mt-2 text-[12.5px] leading-[1.55] text-mid">
              <summary className="w-fit cursor-pointer font-medium text-ink2">What this means</summary>
              <p className="mt-1.5 max-w-[76ch]">
                The figures use the default build rather than the values currently entered.
                The ranking keeps the whole county&apos;s recorded order, then renumbers the
                parcels left by your filters.
                {query.weights && Object.keys(query.weights).length > 0
                  ? ' Custom ranking weights require the live service and are not recalculated in this recording.'
                  : ''}
              </p>
            </details>
          </div>
        )}

        {rankOne && (
          <Card weave className="mt-5 border-l-[3px] !border-l-blue"
            title="Best-ranked match for these filters"
            note={snapshotDate ? 'First in this filtered list' : `Engine rank ${rankOne.rank}`}>
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[20px] font-semibold text-ink">{rankOne.address}</span>
                  <Chip>Best fit</Chip>
                </div>
                <p className="num mt-1 text-[13.5px] text-mid">
                  Parcel {rankOne.parcel_id}
                  <Rule />
                  {rankOne.acres === null ? 'acreage unknown' : `${Math.round(rankOne.acres)} acres`}
                  <Rule />
                  {rankOne.lifetime_cost_per_kw === null
                    ? 'not priced'
                    : `${usd(rankOne.lifetime_cost_per_kw)} lifetime cost per kW`}
                </p>
              </div>
              <button className="btn btn-primary" onClick={() => onOpenParcel(rankOne.parcel_id)}>
                Open this parcel
                <ArrowRight size={15} strokeWidth={2.3} aria-hidden />
              </button>
            </div>
          </Card>
        )}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[320px_1fr] lg:items-start">
        {/* ── Filter rail ───────────────────────────────────────────────── */}
        <div className="space-y-3.5 lg:sticky lg:top-4">
          {/* Applying merges onto the same `query` the rail writes to, so the
              sentence and the controls can never disagree about what is set. */}
          <CriteriaBox onApply={(filters, weights) => patch({ ...filters, weights, sort_by: 'rank' })} />

          <Card title="Narrow the set"
            note={total === null ? 'counting' : `${total.toLocaleString('en-US')} match`}>
            <div className="space-y-4 p-5">
              <NumberFilter label="Smallest site" hint="A 10 MW campus needs roughly 12 acres at 1.2 acres per megawatt, so 25 is a working floor with room for setbacks."
                value={query.min_acres} onChange={v => patch({ min_acres: v })}
                placeholder="25" suffix="acres" />

              <NumberFilter label="Largest site" hint="Use this when a maximum parcel size or acquisition envelope matters."
                value={query.max_acres} onChange={v => patch({ max_acres: v })}
                placeholder="any" suffix="acres" />

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
                  <Explain text="Drops parcels with published flood geometry showing any overlap. Parcels without flood coverage remain in the list and are identified as unknown.">
                    Exclude known flood overlap
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
                <div className="flex flex-wrap gap-2">
                  {activeFilters.map(filter => (
                    <span key={filter} className="rounded-full border border-line bg-card2 px-2.5 py-1 text-[12.5px] text-ink2">
                      {filter}
                    </span>
                  ))}
                </div>
              )}

              {activeFilters.length > 0 && (
                <button onClick={() => setQuery(defaultQuery)}
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
          <Card weave title="Parcel map"
            note={`${mapTotal?.toLocaleString('en-US') ?? '…'} parcels`}>
            <div className="p-4 sm:p-5">
              <ParcelMap parcels={mapParcels} shade={shade} selectedId={previewId ?? selectedId}
                onSelect={selectParcel} className="h-[440px]" />
              <p className="mt-3 text-[13px] leading-[1.55] text-mid">
                Showing all {mapTotal?.toLocaleString('en-US') ?? 'matching'} parcels that match
                your filters. Zoom in to see each plot&apos;s real outline; click one to open it.
              </p>
            </div>
          </Card>

          <Card weave title="Ranked candidates"
            note={
              <div className="flex items-center gap-2">
                {loading && <Loader2 size={13} className="animate-spin text-mid" aria-hidden />}
                <select className="field h-[30px] py-0 text-[13px]" value={query.sort_by}
                  onChange={e => patch({ sort_by: e.target.value as SortBy })}>
                  {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            }>
            {(missingFloodCount > 0 || displayedTopScoreTies > 1) && (
              <div className="flex items-start gap-2.5 border-b border-[var(--line2)] bg-card2 px-4 py-3">
                <Info size={15} strokeWidth={2.1} className="mt-[2px] shrink-0 text-mid" aria-hidden />
                <p className="text-[12.5px] leading-[1.55] text-mid">
                  {missingFloodCount > 0 && (
                    <>
                      Flood coverage is unavailable for{' '}
                      {missingFloodCount.toLocaleString('en-US')} matching parcel
                      {missingFloodCount === 1 ? '' : 's'}; unknown parcels remain included.
                    </>
                  )}
                  {missingFloodCount > 0 && displayedTopScoreTies > 1 && ' '}
                  {displayedTopScoreTies > 1 && (
                    <>
                      {displayedTopScoreTies.toLocaleString('en-US')} parcels share the displayed
                      top score; the engine uses full precision to order close matches.
                    </>
                  )}
                </p>
              </div>
            )}
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
                  const isBestFit = p.rank === 1
                  const displayRank = (query.page! - 1) * query.per_page! + i + 1
                  const isTopThree = displayRank <= 3
                  const floodOverlap = p.flood_buildable_pct === null
                    ? null
                    : Math.round((1 - p.flood_buildable_pct) * 100)
                  return (
                    <div key={p.parcel_id}
                      ref={node => {
                        if (node) rowRefs.current.set(p.parcel_id, node)
                        else rowRefs.current.delete(p.parcel_id)
                      }}
                      onMouseEnter={() => setPreviewId(p.parcel_id)}
                      onMouseLeave={() => setPreviewId(null)}
                      onClick={() => setSelectedId(p.parcel_id)}
                      className={`flex items-start gap-3 p-4 transition-colors
                        ${isBestFit ? 'border-l-[3px] border-l-blue' : ''}
                        ${isSel ? 'bg-bluex' : ''}`}>
                      <span className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[9px]
                                       text-[13.5px] font-bold
                                       ${isTopThree
                                         ? 'bg-blue text-onaccent'
                                         : 'border border-line bg-card2 text-mid'}`}>
                        {displayRank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex flex-wrap items-center gap-2">
                          <span className="text-[14.5px] font-medium text-ink">{p.address}</span>
                          {isBestFit && <Chip>Best fit</Chip>}
                          {p.unevaluable !== null && <Chip tone="grey">Not priced</Chip>}
                          {floodOverlap === null
                            ? null
                            : floodOverlap === 0
                              ? <Chip tone="ok">Outside flood zone</Chip>
                              : <Chip tone={floodOverlap <= 25 ? 'warn' : 'bad'}>
                                  {floodOverlap}% flood overlap
                                </Chip>}
                        </div>
                        <div className="mb-1.5 max-w-[280px]">
                          <p className="num truncate text-[11.5px] text-mid">Parcel {p.parcel_id}</p>
                          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line" aria-hidden>
                            <span className="block h-full rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(5, p.weighted_score * 100))}%`,
                                backgroundColor: rampColor(scoreScale(p.weighted_score)),
                              }} />
                          </span>
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
