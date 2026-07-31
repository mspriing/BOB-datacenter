import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { UsMap, type ShadeKey } from '../components/map/UsMap'
import { PinPanel } from '../components/map/PinPanel'
import { Card } from '../components/Primitives'
import { US_METROS, US_STATES } from '../data/usRegions'
import type { Route } from '../lib/routes'

export function MapScreen({ pinned, onTogglePin, onClear, go }: {
  pinned: string[]; onTogglePin: (k: string) => void; onClear: () => void; go: (r: Route) => void
}) {
  const [shade, setShade] = useState<ShadeKey>('power_rate_usd_per_kwh')

  return (
    <section className="pt-6 sm:pt-10">
      <div className="mb-7 max-w-[68ch]">
        <p className="label-xs mb-3">United States coverage</p>
        <h1 className="mb-3 text-[clamp(1.875rem,1.5rem+1.6vw,2.75rem)] font-semibold text-ink">
          Find the places worth pricing before you price them.
        </h1>
        <p className="text-[17px] leading-[1.65] text-mid">
          Every state is shaded on the driver you pick. The {US_METROS.length} marked metros carry
          the deepest driver coverage, so those are the ones you can pin and compare. Pin up
          to three and the panel prices them on the whole {15} years.
        </p>
      </div>

      {/* Map — full width with overlay pin panel on desktop */}
      <div className="relative mb-3">
        <Card>
          <UsMap shade={shade} onShadeChange={setShade}
            pinned={pinned} onTogglePin={onTogglePin} maxPins={3} />
        </Card>

        {/* Desktop: pin panel overlaid on map, top right */}
        <div className="map-overlay absolute right-4 top-4 z-10 hidden w-[360px] max-h-[calc(100%-2rem)] overflow-y-auto lg:block">
          <PinPanel pinned={pinned} onUnpin={onTogglePin} onClear={onClear} />
          {pinned.length >= 2 && (
            <div className="mt-3">
              <button className="btn btn-primary w-full" onClick={() => go('setup')}>
                Take these into a full comparison
                <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: pin panel below map, full width */}
      <div className="mb-3 space-y-3 lg:hidden">
        <PinPanel pinned={pinned} onUnpin={onTogglePin} onClear={onClear} />
        {pinned.length >= 2 && (
          <button className="btn btn-primary w-full" onClick={() => go('setup')}>
            Take these into a full comparison
            <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
          </button>
        )}
      </div>

      {/* What the shading rests on — full width, three-column row */}
      <Card title="What the shading rests on">
        <div className="grid gap-5 p-5 text-[13.5px] leading-[1.6] text-mid sm:grid-cols-3">
          <p>
            Hazard risk is published for all {US_STATES.length + US_METROS.length} regions.
            Power price and staff cost are published for 57 of them and derived for the
            remaining six.
          </p>
          <p>
            Clean power, distance to users and cost to build are published for the metros
            and derived for the states. Derived figures are labelled on hover and the
            derivation is written out on the sources page.
          </p>
          <div className="flex flex-col gap-2.5">
            <p>
              Land price and property tax exist only for the {7} regions where a figure was
              published. They are left blank everywhere else rather than filled in with a guess.
            </p>
            <button onClick={() => go('known-gaps')} className="link-inline self-start">
              Read the full list of gaps
            </button>
          </div>
        </div>
      </Card>
    </section>
  )
}
