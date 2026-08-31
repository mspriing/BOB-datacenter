import { useMemo } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { RotateCcw } from 'lucide-react'
import {
  PROJECTION_DRIVERS, applyProjections, priceSite, rank, flipMultiplier,
  type ProjectParams, type Projections, type ProjectionKey, type SiteDrivers,
} from '../lib/engine'
import { Card, Explain } from './Primitives'

const MIN_MULT = 0.6
const MAX_MULT = 2.0
const pos = (m: number) => ((m - MIN_MULT) / (MAX_MULT - MIN_MULT)) * 100

export interface ProjectionSite { key: string; label: string; place: string; base: SiteDrivers }

/**
 * Replaces the old "what matters to you" percentage weights.
 *
 * Each slider sits at the site's published figure and moves to whatever you
 * think that figure will be. The tick on the track is the point where the
 * ranking changes hands, so the sensitivity analysis and the control are the
 * same object rather than two panels that have to be read against each other.
 */
export function ProjectionSliders({
  sites, project, projections, onChange, onReset,
}: {
  sites: ProjectionSite[]
  project: ProjectParams
  projections: Projections
  onChange: (next: Projections) => void
  onReset: () => void
}) {
  const build = useMemo(() => (over?: { key: string; driver: ProjectionKey; mult: number }) => {
    const priced = sites.map(s => {
      const p = { ...(projections[s.key] ?? {}) }
      if (over && over.key === s.key) p[over.driver] = over.mult
      return priceSite(s.key, s.label, s.place, project, applyProjections(s.base, p))
    })
    return rank(priced)
  }, [sites, project, projections])

  const current = build()
  const leader = current[0]

  /** Where this one slider changes the winner, searched in both directions. */
  const flipFor = (key: string, driver: ProjectionKey): number | null => {
    const f = (lo: number, hi: number) =>
      flipMultiplier(m => build({ key, driver, mult: m }), key, lo, hi)
    const up = f(1, MAX_MULT)
    if (up !== null) return up
    const down = f(1, MIN_MULT)
    return down
  }

  const setMult = (key: string, driver: ProjectionKey, mult: number) =>
    onChange({ ...projections, [key]: { ...(projections[key] ?? {}), [driver]: mult } })

  const anyMoved = Object.values(projections).some(p =>
    Object.values(p ?? {}).some(v => v !== undefined && Math.abs(v - 1) > 0.001))

  return (
    <Card
      title="Your projections"
      note={anyMoved
        ? <button onClick={onReset} className="inline-flex items-center gap-1.5 text-[13px] text-mid transition-colors hover:text-blued">
            <RotateCcw size={12} strokeWidth={2.2} aria-hidden />Back to today&rsquo;s figures
          </button>
        : "Centred on today’s figures"}>
      <div className="space-y-6 p-5">
        <p className="text-[14px] leading-[1.6] text-mid">
          Each slider starts at the figure the dataset carries for that region, published
          where one exists and modeled where it does not. Move it to whatever you think the
          number will be over the {project.lifetimeYears} years.
        </p>

        {/* What the two marks on every track mean. Asked for directly: the red
            line was doing the most important job on screen and explaining itself
            to nobody. */}
        <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-[10px] border border-line bg-card2 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-[12.5px] leading-[1.4] text-mid">
            <span aria-hidden className="inline-block h-[13px] w-px shrink-0 bg-[#98A3B0]" />
            today&rsquo;s figure
          </span>
          <span className="flex items-center gap-2 text-[12.5px] leading-[1.4] text-mid">
            <span aria-hidden className="inline-block h-[13px] w-[2px] shrink-0 rounded-[1px] bg-[#C22F2F]" />
            past here the ranking changes hands
          </span>
        </div>

        {PROJECTION_DRIVERS.map(d => (
          <div key={d.key}>
            <p className="label-xs mb-3">
              <Explain text={d.help}>{d.name}</Explain>
            </p>
            <div className="space-y-4">
              {sites.map(s => {
                const mult = projections[s.key]?.[d.key] ?? 1
                const baseVal = s.base[d.key]
                const flip = flipFor(s.key, d.key)
                const moved = Math.abs(mult - 1) > 0.001
                const past = flip !== null && (flip > 1 ? mult >= flip : mult <= flip)
                return (
                  <div key={s.key}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="text-[14px] text-ink2">{s.label.replace(/,.*$/, '')}</span>
                      <span className="flex items-baseline gap-2">
                        <span className={`num text-[14px] font-semibold ${moved ? 'text-blued' : 'text-ink2'}`}>
                          {d.fmt(baseVal * mult)}
                        </span>
                        {moved && (
                          <span className={`num text-[12.5px] font-semibold
                            ${mult > 1 ? 'text-bad' : 'text-ok'}`}>
                            {mult > 1 ? '+' : ''}{((mult - 1) * 100).toFixed(0)}%
                          </span>
                        )}
                      </span>
                    </div>

                    <Slider.Root
                      value={[mult]} min={MIN_MULT} max={MAX_MULT} step={0.01}
                      onValueChange={v => setMult(s.key, d.key, v[0])}
                      aria-label={`${d.name} at ${s.label}`}
                      className="relative flex h-6 w-full touch-none select-none items-center">
                      <Slider.Track className="relative h-[5px] w-full grow rounded-full bg-card2
                                               shadow-[inset_0_1px_2px_rgba(15,23,32,.08)]">
                        <Slider.Range className="absolute h-full rounded-full bg-[linear-gradient(90deg,var(--blue),var(--blue-l))]" />
                        {/* today's figure */}
                        <span aria-hidden
                          className="absolute top-[-4px] h-[13px] w-px bg-[#98A3B0]"
                          style={{ left: `${pos(1)}%` }} />
                        {/* where the ranking changes hands */}
                        {flip !== null && flip > MIN_MULT && flip < MAX_MULT && (
                          <span aria-hidden
                            className="absolute top-[-5px] h-[15px] w-[2px] rounded-[1px] bg-[#C22F2F]"
                            style={{ left: `${pos(flip)}%` }} />
                        )}
                      </Slider.Track>
                      <Slider.Thumb className="block h-[20px] w-[20px] cursor-grab rounded-full bg-white
                        shadow-[0_2px_7px_rgba(15,23,32,.28),0_0_0_1px_rgba(15,23,32,.09)]
                        transition-transform hover:scale-110 focus-visible:scale-110 active:cursor-grabbing" />
                    </Slider.Root>

                    <p className="mt-1 text-[12.5px] leading-[1.5] text-mid">
                      {flip === null
                        ? 'No change in the order anywhere in this range'
                        : past
                          ? <span className="font-semibold text-bad">
                              Past the point where the order changes. {leader.label.replace(/,.*$/, '')} now leads.
                            </span>
                          : <>Order changes at{' '}
                              <span className="num font-semibold text-ink2">{d.fmt(baseVal * flip)}</span>
                              {', '}
                              <span className="num">{flip > 1 ? '+' : ''}{((flip - 1) * 100).toFixed(1)}%</span>
                            </>}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div className="border-t border-[var(--line2)] pt-4">
          <p className="text-[13.5px] leading-[1.6] text-mid">
            These sliders are forecasts rather than preference settings. Every cost figure on
            the results page is recomputed from the numbers above, so the ranking follows your
            view of the world rather than a weighting you had to invent. Hazard risk, clean
            power and distance to your users hold steady, since your forecast does not move them.
          </p>
        </div>
      </div>
    </Card>
  )
}
