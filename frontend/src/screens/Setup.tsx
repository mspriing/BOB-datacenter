import { useMemo } from 'react'
import { ArrowRight, MapPin, AlertTriangle } from 'lucide-react'
import { Card, FoldCard, Field } from '../components/Primitives'
import { COVERAGE } from '../data/project'
import { ALL_REGIONS } from '../lib/useSites'
import { gapsFor } from '../lib/engine'
import { DEFAULT_SITES } from '../data/defaultSites'
import { useSites } from '../lib/useSites'
import type { EstimateProject, SiteSetup } from '../lib/api'
import type { Route } from '../lib/routes'

export function Setup({
  project, setProject, siteSetup, setSiteSetup,
  pinned, chosen, setChosen, zoom, setZoom, run, go,
}: {
  project: EstimateProject
  setProject: React.Dispatch<React.SetStateAction<EstimateProject>>
  siteSetup: SiteSetup
  setSiteSetup: React.Dispatch<React.SetStateAction<SiteSetup>>
  pinned: string[]
  chosen: string[]
  setChosen: (f: (c: string[]) => string[]) => void
  zoom: 'regions' | 'parcels'
  setZoom: (z: 'regions' | 'parcels') => void
  run: () => void
  go: (r: Route) => void
}) {
  const atParcelGrain = zoom === 'parcels'
  const { sites, source } = useSites(pinned, chosen)
  const fromPins = source === 'pins'

  // Every selectable region, the published three first so the default set reads
  // in the order the worked example uses.
  const options = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ key: string; label: string }> = []
    for (const s of DEFAULT_SITES) { out.push({ key: s.key, label: `${s.label}, ${s.place}` }); seen.add(s.key) }
    for (const r of ALL_REGIONS) if (!seen.has(r.key)) out.push({ key: r.key, label: r.label })
    return out
  }, [])

  const active = fromPins ? sites.map(s => s.key) : chosen

  // A region the dataset has not finished pricing must say so here, before the
  // run, not afterwards. The backend keeps sites with missing cost drivers out
  // of the ranking, and the results screen reports them as unevaluable.
  const PLAIN: Record<string, string> = {
    power_rate_usd_per_kwh: 'power price',
    construction_cost_per_kw: 'cost to build',
    staff_cost_index: 'staff cost',
    land_cost_per_acre_usd: 'land price',
    tax_rate: 'tax rate',
    water_rate_usd_per_kgal: 'water price',
    risk_score: 'hazard exposure',
    renewable_pct: 'renewable share',
    latency_ms_to_hub: 'network distance',
    grid_interconnection_years: 'grid wait',
  }
  const thin = active
    .map(k => {
      const r = ALL_REGIONS.find(x => x.key === k)
      if (!r) return null
      const missing = gapsFor(r).map(g => PLAIN[g] ?? g)
      return missing.length ? { label: r.label, missing } : null
    })
    .filter((x): x is { label: string; missing: string[] } => !!x)


  // The duplicate guard. A region already in the set cannot be picked again,
  // which is the defect that had one site compared against itself.
  const duplicates = active.filter((k, i) => active.indexOf(k) !== i)

  const setSlot = (i: number, key: string) =>
    setChosen(c => c.map((v, j) => (j === i ? key : v)))

  const patchProject = <K extends keyof EstimateProject>(key: K, value: EstimateProject[K]) =>
    setProject(current => ({ ...current, [key]: value }))

  const patchSite = (key: string, patch: Partial<SiteSetup[string]>) =>
    setSiteSetup(current => ({
      ...current,
      [key]: {
        label: current[key]?.label ?? sites.find(site => site.key === key)?.label ?? key,
        free_text: current[key]?.free_text ?? '',
        ...patch,
      },
    }))

  const validProject =
    project.name.trim().length > 0
    && project.capacity_kw >= 100 && project.capacity_kw <= 500_000
    && project.lifetime_years >= 5 && project.lifetime_years <= 40
    && Number.isInteger(project.lifetime_years)
    && project.design_pue >= 1 && project.design_pue <= 3
    && (project.design_wue ?? 0.4) >= 0 && (project.design_wue ?? 0.4) <= 2.5
    && project.discount_rate >= 0.01 && project.discount_rate <= 0.30
    && sites.every(site => (siteSetup[site.key]?.label ?? site.label).trim().length > 0)

  return (
    <section className="setup-flow pt-6 sm:pt-10">
      <div className="mb-8">
        <h1 className="mb-4 max-w-[26ch] text-[clamp(1.875rem,1.4rem+2.2vw,3.25rem)]
          font-semibold leading-[1.08] tracking-[-.02em] text-ink">
          Set up your comparison
        </h1>
        <p className="max-w-[62ch] text-[17px] leading-[1.65] text-mid">
          First choose how closely to look: whole markets against each other, or individual parcels
          inside one county. Then describe the build you are pricing. Every field below arrives
          filled in with a figure a mid-size campus would use, so change what you know, leave the
          rest, and run it.
        </p>
      </div>

      <div className="space-y-3.5">
          {/* The zoom choice, first on the page.

              Parcels used to be a fifth tab sitting beside this screen, which
              made it look like a different tool rather than a closer look at
              the same question. Folding it in fixed that, but it landed third,
              under six boxes the page itself tells the reader to leave alone.
              It is the only control here that changes what the rest of the page
              shows, so it opens the page. */}
          <Card title="How close do you want to look?"
            note={`The same ${project.lifetime_years} years get priced whichever you pick`}>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {([
                {
                  id: 'regions' as const,
                  head: 'Compare regions',
                  body: 'Two to four markets against each other, priced on published regional figures. Use this to decide where.',
                  foot: `${COVERAGE.priceable} regions carry what a ranking needs`,
                },
                {
                  id: 'parcels' as const,
                  head: 'Compare parcels in one county',
                  body: 'Individual plots priced on the whole build: land, reaching the transmission line, reaching fiber, leveling the ground and getting through entitlement. Bexar County, Texas is the pilot county, with more markets to follow. Use this once you know roughly where.',
                  foot: `${COVERAGE.parcels.toLocaleString('en-US')} candidate parcels in the pilot county`,
                },
              ]).map(o => {
                const on = zoom === o.id
                return (
                  <button key={o.id} type="button" onClick={() => setZoom(o.id)}
                    aria-pressed={on}
                    className={`rounded-[12px] border border-l-[3px] p-4 text-left transition-colors
                      ${on
                        ? 'border-blue bg-bluex shadow-[var(--shadow-sm)]'
                        : 'border-line bg-[var(--soft-surface)] hover:bg-card2'}`}>
                    <div className="mb-1 text-[15px] font-semibold text-ink">
                      {o.head}
                    </div>
                    <div className="mb-2 text-[13.5px] leading-[1.55] text-mid">{o.body}</div>
                    <div className="text-[12.5px] text-mid">{o.foot}</div>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Everything from here down is what the depth choice decided. It is
              keyed on that choice so React replaces it rather than patching it,
              and the entry animation makes the swap read as caused by the click
              above rather than as the page redrawing itself. */}
          <div key={zoom} className="swap-enter space-y-3.5">
          <Card title="The build" note="What you are putting up, and for how long">
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Field label="Project name" value={project.name}
                onChange={value => patchProject('name', value)}
                hint="Your label for this comparison. It appears on the results and changes nothing in the arithmetic."
                explain="Your label for this comparison. It appears on the results and changes nothing in the arithmetic." />
              <label className="block">
                <span className="mb-1.5 block text-[15px] font-medium text-ink2">
                  How much power the servers draw
                </span>
                <div className="flex items-center gap-2">
                  <input className="field num" type="number" min={0.1} max={500} step={0.1}
                    value={project.capacity_kw / 1000}
                    onChange={event => patchProject('capacity_kw', Number(event.target.value) * 1000)} />
                  <span className="text-[13px] text-mid">MW</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.5] text-mid">
                  Server load before cooling and electrical overhead. Accepted range: 0.1–500 MW.
                </p>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[15px] font-medium text-ink2">
                  How many years to price
                </span>
                <input className="field num" type="number" min={5} max={40} step={1}
                  value={project.lifetime_years}
                  onChange={event => patchProject('lifetime_years', Number(event.target.value))} />
                <p className="mt-1.5 text-[13px] leading-[1.5] text-mid">
                  The engine accepts whole planning lives from 5 to 40 years.
                </p>
              </label>
            </div>
          </Card>

          {/* Folded. The card's own note told the reader to leave it alone, and
              it still took a third of the screen doing so. Closed by default,
              one line away, and the note now says what opening it is for. */}
          <FoldCard title="Three assumptions worth understanding"
            note="Filled in already. Open it if you have a reason to change one">
            <div className="grid gap-5 p-5 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-[15px] font-medium text-ink2">Cooling overhead (PUE)</span>
                <input className="field num" type="number" min={1} max={3} step={0.01}
                  value={project.design_pue}
                  onChange={event => patchProject('design_pue', Number(event.target.value))} />
                <p className="mt-1.5 text-[13px] leading-[1.5] text-mid">
                  Total facility power divided by server power. Accepted range: 1.0–3.0.
                </p>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[15px] font-medium text-ink2">Discount rate</span>
                <div className="flex items-center gap-2">
                  <input className="field num" type="number" min={1} max={30} step={0.1}
                    value={project.discount_rate * 100}
                    onChange={event => patchProject('discount_rate', Number(event.target.value) / 100)} />
                  <span className="text-[13px] text-mid">%</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.5] text-mid">
                  Used to discount each future year. Accepted range: 1–30%.
                </p>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[15px] font-medium text-ink2">Water use (WUE)</span>
                <div className="flex items-center gap-2">
                  <input className="field num" type="number" min={0} max={2.5} step={0.1}
                    value={project.design_wue ?? 0.4}
                    onChange={event => patchProject('design_wue', Number(event.target.value))} />
                  <span className="text-[13px] text-mid">L/kWh</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.5] text-mid">
                  Litres of water per kWh of cooling energy. Accepted range: 0–2.5.
                </p>
              </label>
            </div>
          </FoldCard>


          {atParcelGrain ? (
            <Card title="The county" note="Bexar County, Texas — pilot county">
              <div className="p-5">
                <p className="max-w-[70ch] text-[15px] leading-[1.65] text-ink2">
                  San Antonio sits inside ERCOT, where a large load can be energized faster than in
                  most US markets, and its appraisal district publishes parcel level land values.
                  That combination is what makes a county this size worth pricing plot by plot.
                </p>
                <p className="mt-3 max-w-[70ch] text-[13.5px] leading-[1.55] text-mid">
                  The build you described above carries through. You will filter by size, land
                  price, distance to transmission and flood exposure on the next screen, and every
                  parcel is ranked against the same four things a region comparison uses.
                </p>
              </div>
            </Card>
          ) : (
          <Card title="The candidate sites"
            note={fromPins
              ? <span className="flex items-center gap-1.5"><MapPin size={13} strokeWidth={2.2} aria-hidden />From your pins</span>
              : `${active.length} of up to 4`}>
            {fromPins ? (
              <div className="divide-y divide-[var(--line2)]">
                {sites.map((s, i) => (
                  <div key={s.key} className="flex items-center gap-4 p-5">
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center
                                     rounded-[10px] border border-line bg-card2 text-[15px] font-bold text-mid">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <label className="block">
                        <span className="label-xs mb-1.5 block">Your name for it</span>
                        <input className="field" value={siteSetup[s.key]?.label ?? s.label}
                          onChange={event => patchSite(s.key, { label: event.target.value })} />
                      </label>
                      <div className="text-[13px] text-mid">{s.place}</div>
                    </div>
                  </div>
                ))}
                <div className="p-5">
                  <button onClick={() => go('map')} className="link-inline text-[14px]">
                    Change the pinned set on the map
                  </button>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[var(--line2)]">
                {chosen.map((key, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-4 p-5">
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center
                                     rounded-[10px] border border-line bg-card2 text-[15px] font-bold text-mid">
                      {i + 1}
                    </span>
                    <label className="min-w-[220px] flex-1">
                      <span className="label-xs mb-1.5 block">Region</span>
                      <select className="field" value={key} onChange={e => setSlot(i, e.target.value)}>
                        {options.map(o => (
                          <option key={o.key} value={o.key}
                            disabled={o.key !== key && active.includes(o.key)}>
                            {o.label}{o.key !== key && active.includes(o.key) ? '  (already chosen)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-[150px] flex-1">
                      <span className="label-xs mb-1.5 block">Your name for it</span>
                      <input className="field"
                        value={siteSetup[key]?.label ?? options.find(o => o.key === key)?.label.replace(/,.*$/, '') ?? key}
                        onChange={event => patchSite(key, { label: event.target.value })} />
                    </label>
                    {chosen.length > 2 && (
                      <button onClick={() => setChosen(c => c.filter((_, j) => j !== i))}
                        className="pill text-[13px]">Remove</button>
                    )}
                  </div>
                ))}
                {/* The map is reached from here rather than from the top bar.
                    Without this link a reader with nothing pinned had no way to
                    open it at all once it stopped being a tab. */}
                <div className="flex flex-wrap items-center gap-3 p-5">
                  {chosen.length < 4 && (
                    <button className="pill text-[13.5px]"
                      onClick={() => {
                        const next = options.find(o => !active.includes(o.key))
                        if (next) setChosen(c => [...c, next.key])
                      }}>
                      Add another site
                    </button>
                  )}
                  <button onClick={() => go('map')} className="link-inline text-[14px]">
                    Pick them on the map instead
                  </button>
                </div>
              </div>
            )}
          </Card>
          )}

          {!atParcelGrain && duplicates.length > 0 && (
            <div className="flex items-start gap-3 rounded-[12px] border border-[var(--error-border)]
                            bg-[var(--error-surface)] p-4">
              <AlertTriangle size={17} strokeWidth={2.2} className="mt-[2px] shrink-0 text-bad" aria-hidden />
              <p className="text-[14px] leading-[1.6] text-[var(--error-ink)]">
                The same region appears twice in the candidate set. Pick a different one before
                running, otherwise the comparison would score a site against itself.
              </p>
            </div>
          )}

          {!atParcelGrain && thin.length > 0 && (
            <div className="flex items-start gap-3 rounded-[12px] border border-[var(--warn-border)]
                            bg-[var(--warn-surface)] p-4">
              <AlertTriangle size={17} strokeWidth={2.2} className="mt-[2px] shrink-0 text-[var(--warn)]" aria-hidden />
              <div className="text-[14px] leading-[1.6] text-[var(--warn-ink)]">
                <p className="mb-1.5">
                  These places are missing context that is shown with the result but is not used
                  as a free or zero-cost input. The comparison still runs on the available drivers.
                </p>
                <ul className="mb-2 list-disc pl-5">
                  {thin.map(t => (
                    <li key={t.label}>{t.label}: no {t.missing.join(', no ')}</li>
                  ))}
                </ul>
                {/* Named rather than left as a shrug. The grid wait is missing because
                    neither operator publishes one, which is a different thing from
                    nobody having looked, and a reader deciding on a site deserves to
                    know which it is. */}
                <p className="text-[13.5px] leading-[1.55]">
                  Grid wait is shown as an unresolved decision risk, not included in the cost or
                  ranking, because neither ERCOT nor Svenska kraftnat publishes a connection time
                  in years.{' '}
                  <button onClick={() => go('known-gaps')} className="link-inline">
                    What was checked
                  </button>
                </p>
              </div>
            </div>
          )}

          {!atParcelGrain && (
            <FoldCard title="Anything else you know"
              note="Optional site-specific quotes, abatements or figures">
              <div className="divide-y divide-[var(--line2)]">
                {sites.map(site => (
                  <label key={site.key} className="block p-5">
                    <span className="mb-1.5 block text-[15px] font-medium text-ink2">
                      {siteSetup[site.key]?.label || site.label}
                    </span>
                    <textarea className="field font-normal"
                      value={siteSetup[site.key]?.free_text ?? ''}
                      onChange={event => patchSite(site.key, { free_text: event.target.value })}
                      placeholder="Five-year property-tax abatement offered; quoted construction cost is $10,400 per kW." />
                  </label>
                ))}
                <p className="p-5 text-[13.5px] leading-[1.55] text-mid">
                  Each note is sent as that site&rsquo;s <span className="num">free_text</span>.
                  The backend validates any parsed figure before it reaches the deterministic engine.
                </p>
              </div>
            </FoldCard>
          )}

          </div>

        <Card weave className="sticky bottom-2 z-20 sm:static">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <p className="max-w-[52ch] text-[13.5px] leading-[1.55] text-mid">
              {atParcelGrain
                ? `Bexar County parcels, priced across ${project.lifetime_years} years.`
                : `${active.length} regions, priced across ${project.lifetime_years} years.`}{' '}
              The run happens on the server, which is where the sources, the gaps and the wording
              come from.
            </p>
            <button className="btn btn-primary w-full sm:w-auto" onClick={run}
              disabled={!validProject || (!atParcelGrain && duplicates.length > 0)}
              style={!validProject || (!atParcelGrain && duplicates.length > 0)
                ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
              {atParcelGrain ? 'Look at the parcels' : 'Run the comparison'}
              <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
            </button>
          </div>
        </Card>
      </div>
    </section>
  )
}
