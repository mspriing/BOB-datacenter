import { useMemo, useState } from 'react'
import { ArrowRight, MapPin, AlertTriangle } from 'lucide-react'
import { Card, Field } from '../components/Primitives'
import { ProjectionSliders } from '../components/ProjectionSliders'
import { PROJECT } from '../data/project'
import { US_REGIONS } from '../data/usRegions'
import { DEFAULT_SITES } from '../data/defaultSites'
import { useSites } from '../lib/useSites'
import type { Projections, ProjectParams } from '../lib/engine'
import type { Route } from '../lib/routes'

const P: ProjectParams = {
  capacityKw: PROJECT.capacityMw * 1000, pue: PROJECT.pue,
  lifetimeYears: PROJECT.lifetimeYears, discountRate: PROJECT.discountRate, designWue: 0.4,
}

export function Setup({ projections, setProjections, pinned, run, go }: {
  projections: Projections
  setProjections: (p: Projections) => void
  pinned: string[]
  run: () => void
  go: (r: Route) => void
}) {
  const { sites, fromPins } = useSites(pinned)
  const [freeText, setFreeText] = useState('')

  // Every selectable region, the published three first so the default set reads
  // in the order the worked example uses.
  const options = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ key: string; label: string }> = []
    for (const s of DEFAULT_SITES) { out.push({ key: s.key, label: `${s.label}, ${s.place}` }); seen.add(s.key) }
    for (const r of US_REGIONS) if (!seen.has(r.key)) out.push({ key: r.key, label: r.label })
    return out
  }, [])

  const [chosen, setChosen] = useState<string[]>(() => sites.map(s => s.key))
  const active = fromPins ? sites.map(s => s.key) : chosen

  // The duplicate guard. A region already in the set cannot be picked again,
  // which is the defect that had one site compared against itself.
  const duplicates = active.filter((k, i) => active.indexOf(k) !== i)

  const setSlot = (i: number, key: string) =>
    setChosen(c => c.map((v, j) => (j === i ? key : v)))

  return (
    <section className="pt-6 sm:pt-10">
      <div className="mb-8 max-w-[62ch]">
        <p className="label-xs mb-3">Step one of two</p>
        <h1 className="mb-3 text-[clamp(1.875rem,1.5rem+1.6vw,2.75rem)] font-semibold text-ink">
          Describe the build and the places you are weighing up.
        </h1>
        <p className="text-[17px] leading-[1.65] text-mid">
          Defaults come from a typical 10 MW campus, so you can change only what you know
          and run the comparison.
        </p>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="space-y-3.5">
          <Card title="The build">
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Project name" defaultValue={PROJECT.name}
                explain="Your label for this comparison. It appears on the results and changes nothing in the maths." />
              <Field label="IT load, megawatts" defaultValue="10"
                explain="The power your servers themselves draw, before any cooling overhead. It is the number capacity is normally quoted in, so a 10 MW campus draws more than 10 MW at the meter." />
              <Field label="Cooling overhead" defaultValue="1.4"
                explain="Power usage effectiveness. Total site power divided by the power your equipment draws. 1.4 means 40 percent goes to cooling and electrical losses. Lower is more efficient, and 1.2 is very good." />
              <Field label="Years to model" defaultValue="15"
                explain="How far ahead to price. Running cost is summed across this many years and discounted back, so a longer horizon puts more weight on power and staff and less on the build." />
              <Field label="Discount rate" defaultValue="8%"
                explain="What future money is worth to you today. A dollar of running cost in year 15 counts for less than one spent now, and a higher rate discounts it harder, which favours cheap-to-build sites." />
              <Field label="Water use per kWh" defaultValue="0.4 L"
                explain="Litres of water your cooling design consumes per kilowatt hour of cooling energy. This is a choice you make in the design rather than a property of the region, which is why it sits here and not in the regional data." />
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
        </div>

        <div className="space-y-3.5 lg:sticky lg:top-4">
          <ProjectionSliders
            sites={sites} project={P} projections={projections}
            onChange={setProjections} onReset={() => setProjections({})} />
          <button className="btn btn-primary w-full" onClick={run} disabled={duplicates.length > 0}
            style={duplicates.length > 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            Run the comparison
            <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  )
}
