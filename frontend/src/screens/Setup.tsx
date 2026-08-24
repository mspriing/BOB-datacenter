import { useMemo, useState } from 'react'
import { ArrowRight, MapPin, AlertTriangle } from 'lucide-react'
import { Card, Field } from '../components/Primitives'
import { ProjectionSliders } from '../components/ProjectionSliders'
import { PROJECT } from '../data/project'
import { ALL_REGIONS } from '../lib/useSites'
import { gapsFor } from '../lib/engine'
import { DEFAULT_SITES } from '../data/defaultSites'
import { useSites } from '../lib/useSites'
import type { Projections, ProjectParams } from '../lib/engine'
import type { Route } from '../lib/routes'

const P: ProjectParams = {
  capacityKw: PROJECT.capacityMw * 1000, pue: PROJECT.pue,
  lifetimeYears: PROJECT.lifetimeYears, discountRate: PROJECT.discountRate, designWue: 0.4,
}

export function Setup({ projections, setProjections, pinned, chosen, setChosen, run, go }: {
  projections: Projections
  setProjections: (p: Projections) => void
  pinned: string[]
  chosen: string[]
  setChosen: (f: (c: string[]) => string[]) => void
  run: () => void
  go: (r: Route) => void
}) {
  const { sites, source } = useSites(pinned, chosen)
  const fromPins = source === 'pins'
  const [freeText, setFreeText] = useState('')

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
  // run, not afterwards. The browser's preview reads a missing cost as zero,
  // which would quietly flatter an unpriced market into first place.
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

  return (
    <section className="pt-6 sm:pt-10">
      <div className="mb-8">
        <p className="label-xs mb-3">Step one of two</p>
        <h1 className="mb-4 max-w-[26ch] text-[clamp(1.875rem,1.4rem+2.2vw,3.25rem)]
          font-semibold leading-[1.08] tracking-[-.02em] text-ink">
          Describe the build and the places you are weighing up.
        </h1>
        <p className="max-w-[62ch] text-[17px] leading-[1.65] text-mid">
          Every box below is already filled in with a figure a mid-size campus would use, and each
          one says what a normal value looks like. Change what you know, leave the rest, and run it.
        </p>
      </div>

      <div className="space-y-3.5">
          <Card title="The build" note="What you are putting up, and for how long">
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Field label="Project name" defaultValue={PROJECT.name}
                hint="Your label for this comparison. It appears on the results and changes nothing in the arithmetic."
                explain="Your label for this comparison. It appears on the results and changes nothing in the arithmetic." />
              <Field label="How much power the servers draw" defaultValue="10 MW"
                hint="10 MW is a mid-size campus. This is the servers alone, before anything spent on cooling them."
                explain="Capacity is normally quoted this way, so a 10 MW campus pulls more than 10 MW at the meter once cooling is added." />
              <Field label="How many years to price" defaultValue="15"
                hint="15 years is the usual planning life. A longer horizon puts more weight on power and staff and less on the build."
                explain="Running cost is added up across this many years and brought back to today's money." />
            </div>
          </Card>

          <Card title="Three assumptions worth understanding"
            note="Filled in already. Change one only if you have a reason to">
            <div className="grid gap-5 p-5 sm:grid-cols-3">
              <Field label="Cooling overhead" defaultValue="1.25"
                hint="Total site power divided by what the servers draw. 1.25 means a quarter again goes to cooling and electrical losses. A new build aims for about that. Running data centers average 1.54, and those above 20 MW average 1.44."
                explain="Known in the industry as PUE. Lower is better, and it multiplies the electricity bill directly." />
              <Field label="Discount rate" defaultValue="8%"
                hint="What money in the future is worth to you today. A dollar of running cost in year 15 counts for less than one spent now. 8% is a common starting point. A higher rate favors sites that are cheap to build. A lower one favors sites that are cheap to run."
                explain="The rate used to bring every future year of running cost back to today's money." />
              <Field label="Water your cooling uses" defaultValue="0.4 L per kWh"
                hint="Liters of water for each kilowatt hour of cooling. 0.4 is a normal design figure. Air cooled runs lower and evaporative runs higher. It is a choice in the design rather than something the region decides, which is why it sits here."
                explain="Multiplied by the local water tariff to give the annual water bill." />
            </div>
          </Card>

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
                      <div className="text-[15px] font-medium text-ink">{s.label}</div>
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
                        defaultValue={options.find(o => o.key === key)?.label.replace(/,.*$/, '')} />
                    </label>
                    {chosen.length > 2 && (
                      <button onClick={() => setChosen(c => c.filter((_, j) => j !== i))}
                        className="pill text-[13px]">Remove</button>
                    )}
                  </div>
                ))}
                {chosen.length < 4 && (
                  <div className="p-5">
                    <button className="pill text-[13.5px]"
                      onClick={() => {
                        const next = options.find(o => !active.includes(o.key))
                        if (next) setChosen(c => [...c, next.key])
                      }}>
                      Add another site
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>

          {duplicates.length > 0 && (
            <div className="flex items-start gap-3 rounded-[12px] border border-[rgba(194,47,47,.3)]
                            bg-[rgba(255,240,240,.9)] p-4">
              <AlertTriangle size={17} strokeWidth={2.2} className="mt-[2px] shrink-0 text-bad" aria-hidden />
              <p className="text-[14px] leading-[1.6] text-[#7A1D1D]">
                The same region appears twice in the candidate set. Pick a different one before
                running, otherwise the comparison would score a site against itself.
              </p>
            </div>
          )}

          {thin.length > 0 && (
            <div className="flex items-start gap-3 rounded-[12px] border border-[rgba(138,82,0,.28)]
                            bg-[rgba(255,249,238,.9)] p-4">
              <AlertTriangle size={17} strokeWidth={2.2} className="mt-[2px] shrink-0 text-[var(--warn)]" aria-hidden />
              <div className="text-[14px] leading-[1.6] text-[#5C3A00]">
                <p className="mb-1.5">
                  Some figures for these places have not been collected yet. The comparison still
                  runs, though the ranking stays partial until they land.
                </p>
                <ul className="list-disc pl-5">
                  {thin.map(t => (
                    <li key={t.label}>{t.label}: missing {t.missing.join(', ')}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <Card title="Anything else you know" note="Optional">
            <div className="p-5">
              <label className="block">
                <span className="mb-1.5 block text-[15px] font-medium text-ink2">
                  Write it in plain sentences
                </span>
                <textarea className="field font-normal" value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder="Loudoun has a five year tax abatement on the table. Sweden quoted us 10,400 per kW last month, not 10,200." />
              </label>
              <p className="mt-2 text-[13.5px] leading-[1.55] text-mid">
                The tool pulls any figures out of what you write and shows them back to you before
                pricing starts. It never infers a number by itself, and it will not move a site to
                a region already in the set.
              </p>
            </div>
          </Card>

        {/* The projections used to ride a tall sticky rail beside a shorter
            column, which left the page ending on two different lines. They sit
            full width below the thing they act on instead. */}
        <ProjectionSliders
          sites={sites} project={P} projections={projections}
          onChange={setProjections} onReset={() => setProjections({})} />

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px]
                        border border-line bg-white/80 px-5 py-4">
          <p className="max-w-[52ch] text-[13.5px] leading-[1.55] text-mid">
            {active.length} sites, priced across {PROJECT.lifetimeYears} years. The run happens on
            the server, which is where the sources, the gaps and the wording come from.
          </p>
          <button className="btn btn-primary" onClick={run} disabled={duplicates.length > 0}
            style={duplicates.length > 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            Run the comparison
            <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  )
}
