import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Logo } from './components/Primitives'
import { Footer } from './components/Footer'
import { useReducedMotion } from './lib/useReducedMotion'
import { isRoute, type Route } from './lib/routes'
import { DEFAULT_WEIGHTS, type Projections, type Weights } from './lib/engine'

import { fetchEstimate, type EstimateOutput } from './lib/api'
import { PROJECT } from './data/project'
import { DEFAULT_SITES } from './data/defaultSites'
import { useSites } from './lib/useSites'

import { Home } from './screens/Home'
import { Setup } from './screens/Setup'
import { Running } from './screens/Running'
import { Results } from './screens/Results'
import { MapScreen } from './screens/MapScreen'
import { ParcelSearch } from './screens/ParcelSearch'
import { ParcelDetail } from './screens/ParcelDetail'
import { DocPage } from './pages/DocPage'

// Parcels is deliberately absent. It is not a fifth thing you can do, it is
// how close you are looking at the same question, and that choice is made on
// the setup screen. Four peer tabs read as four steps while all four were
// clickable from the start, which is what put a reader on the results screen
// before anything had been run.
// Three steps, in the order they happen.
//
// The map used to sit here as a fourth peer, which is what made the bar read as
// a menu rather than a path: a reader saw "Map" and "Set up" side by side with
// no way to tell which came first, or that one lives inside the other. The map
// is one of the two ways to name the regions you are comparing, and that naming
// happens on the setup screen, so the map is reached from there and lights the
// setup step while you are on it. Same for the parcel screens, which are the
// other end of the same choice.
const NAV: Array<{ id: Route; label: string }> = [
  { id: 'home',    label: 'Start' },
  { id: 'setup',   label: 'Set up' },
  { id: 'results', label: 'Results' },
]

/** Which step in the bar a route belongs to. */
const STEP_OF: Partial<Record<Route, Route>> = {
  map: 'setup', parcels: 'setup', parcel: 'setup', running: 'results',
}

const DOC_ROUTES: Route[] = [
  'how-ranking-works', 'driver-meanings', 'cost-method', 'release-notes',
  'all-regions', 'the-drivers', 'sources', 'known-gaps',
  'request-region', 'report-figure', 'talk-to-team',
]

function readHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '')
  return isRoute(h) ? h : 'home'
}

export default function App() {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? 'home' : readHash())
  const [projections, setProjections] = useState<Projections>({})
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS)
  const [pinned, setPinned] = useState<string[]>([])
  // The setup screen's candidate picks. This lives here, not inside Setup:
  // when Setup owned it the run never saw it and always priced the default three.
  const [chosen, setChosen] = useState<string[]>(() => DEFAULT_SITES.map(s => s.key))
  // Which parcel the detail screen is showing. Lives here for the same reason
  // `chosen` does: a screen that owns its own selection cannot survive a route
  // change, and every other view needs to read it.
  const [openParcel, setOpenParcel] = useState<string | null>(null)
  // How close the reader wants to look. Lives here so the choice survives a
  // route change, the same reason `chosen` does.
  const [zoom, setZoom] = useState<'regions' | 'parcels'>('regions')
  const reduced = useReducedMotion()


  const go = useCallback((r: Route) => {
    window.location.hash = '/' + r
    setRoute(r)
  }, [])

  // The authoritative run. The client engine drives the sliders; this is the
  // server's answer, and it owns provenance, gaps, confidence and the wording.
  const [server, setServer] = useState<EstimateOutput | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [serverSlow, setServerSlow] = useState(false)
  const [serverPending, setServerPending] = useState(false)
  const runToken = useRef(0)

  const { sites: candidateSites } = useSites(pinned, chosen)

  const run = useCallback(() => {
    const token = ++runToken.current
    setServer(null); setServerError(null); setServerSlow(false); setServerPending(true)
    go('running')
    fetchEstimate({
      project: {
        name: PROJECT.name,
        capacity_kw: PROJECT.capacityMw * 1000,
        design_pue: PROJECT.pue,
        design_wue: 0.4,
        lifetime_years: PROJECT.lifetimeYears,
        discount_rate: PROJECT.discountRate,
        // weights.cost/risk/clean/distance are integers (50,20,15,15); backend expects decimals.
        weights: {
          total_cost: weights.cost / 100, risk: weights.risk / 100,
          sustainability: weights.clean / 100, latency: weights.distance / 100,
        },
      },
      sites: candidateSites.map((s, i) => ({
        site_id: `site-${String.fromCharCode(65 + i)}`,
        label: s.label,
        region_key: s.key,
      })),
    }, () => { if (token === runToken.current) setServerSlow(true) })
      .then(r => {
        if (token !== runToken.current) return
        setServer(r.data); setServerError(r.error); setServerPending(false)
      })
  }, [candidateSites, weights, go])

  useEffect(() => {
    const on = () => setRoute(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [route])

  const togglePin = useCallback((key: string) => {
    setPinned(p => p.includes(key) ? p.filter(k => k !== key) : p.length >= 3 ? p : [...p, key])
  }, [])

  const isDoc = DOC_ROUTES.includes(route)

  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={300}>
      <div className="relative z-[1] mx-auto max-w-[1380px] px-4 pb-16 sm:px-7">
        <header className="flex flex-wrap items-center justify-between gap-4 py-5">
          <button className="flex items-center gap-3.5 text-left" onClick={() => go('home')}
            aria-label="leepr, back to the start">
            <Logo />
            <span>
              <span className="block text-[15px] font-semibold tracking-[-.01em] text-ink">
                leepr
              </span>
              <span className="block text-[13px] text-mid">
                Whole life cost for data center sites
              </span>
            </span>
          </button>
          <nav aria-label="Screens"
            className="flex items-center gap-1.5 rounded-full border border-line bg-white/80 p-1 shadow-[var(--shadow-sm)]">
            {NAV.map(n => {
              const active = (STEP_OF[route] ?? route) === n.id
              return (
                <button key={n.id} onClick={() => go(n.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative min-h-[36px] rounded-full px-4 text-[13.5px] font-medium transition-colors
                    ${active ? 'text-blued' : 'text-mid hover:text-ink2'}`}>
                  {active && (
                    <motion.span layoutId="navpill" className="absolute inset-0 rounded-full bg-bluex"
                      transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
                  )}
                  <span className="relative">{n.label}</span>
                </button>
              )
            })}
          </nav>
        </header>

        <main>
          {/*
            The screen wrapper is a plain element on purpose. It used to be an
            AnimatePresence in mode="wait", and on the deployed build the enter
            animation never ran: each new screen mounted holding its `initial`
            style of opacity 0, so changing route left the previous screen on
            screen and the new one invisible. A page transition is not worth a
            navigation that silently does nothing. Individual components keep
            their own motion; only the route swap is unanimated.
          */}
          <div key={route} className={reduced ? undefined : 'route-enter'}>
              {route === 'home' && <Home go={go} />}
              {route === 'map' && (
                <MapScreen pinned={pinned} onTogglePin={togglePin}
                  onClear={() => setPinned([])} go={go} />
              )}
              {route === 'setup' && (
                <Setup projections={projections} setProjections={setProjections}
                  pinned={pinned} chosen={chosen} setChosen={setChosen}
                  zoom={zoom} setZoom={setZoom}
                  run={() => (zoom === 'parcels' ? go('parcels') : run())} go={go} />
              )}
              {route === 'running' && (
                <Running done={() => go('results')} pending={serverPending}
                  slow={serverSlow} error={serverError} retry={run} />
              )}
              {route === 'results' && (
                <Results projections={projections} setProjections={setProjections}
                  weights={weights} setWeights={setWeights} pinned={pinned} chosen={chosen} go={go}
                  server={server} serverError={serverError} />
              )}
              {route === 'parcels' && (
                <ParcelSearch go={go} onOpenParcel={id => { setOpenParcel(id); go('parcel') }} />
              )}
              {route === 'parcel' && openParcel && (
                <ParcelDetail parcelId={openParcel} onBack={() => go('parcels')} />
              )}
              {route === 'parcel' && !openParcel && (
                <ParcelSearch go={go} onOpenParcel={id => { setOpenParcel(id); go('parcel') }} />
              )}
              {isDoc && <DocPage route={route} go={go} />}
          </div>
        </main>

        <Footer go={go} />
      </div>
    </Tooltip.Provider>
  )
}
