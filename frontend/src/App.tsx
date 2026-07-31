import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Logo } from './components/Primitives'
import { Footer } from './components/Footer'
import { useReducedMotion } from './lib/useReducedMotion'
import { isRoute, type Route } from './lib/routes'
import { DEFAULT_WEIGHTS, type Projections, type Weights } from './lib/engine'

import { fetchEstimate, type EstimateOutput } from './lib/api'
import { PROJECT } from './data/project'
import { useSites } from './lib/useSites'

import { Home } from './screens/Home'
import { Setup } from './screens/Setup'
import { Running } from './screens/Running'
import { Results } from './screens/Results'
import { MapScreen } from './screens/MapScreen'
import { DocPage } from './pages/DocPage'

const NAV: Array<{ id: Route; label: string }> = [
  { id: 'home', label: 'Start' },
  { id: 'map', label: 'Map' },
  { id: 'setup', label: 'Set up' },
  { id: 'results', label: 'Results' },
]

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

  const { sites: candidateSites } = useSites(pinned)

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
        weights: {
          total_cost: weights.cost, risk: weights.risk,
          sustainability: weights.clean, latency: weights.distance,
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
            aria-label="Site Decision Copilot, back to the start">
            <Logo />
            <span>
              <span className="block text-[15px] font-semibold tracking-[-.01em] text-ink">
                Site Decision Copilot
              </span>
              <span className="block text-[13px] text-mid">
                Whole life cost for data center sites
              </span>
            </span>
          </button>
          <nav aria-label="Screens"
            className="flex items-center gap-1.5 rounded-full border border-line bg-white/80 p-1 shadow-[var(--shadow-sm)]">
            {NAV.map(n => {
              const active = route === n.id || (route === 'running' && n.id === 'results')
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
          <AnimatePresence mode="wait">
            <motion.div key={route}
              initial={reduced ? undefined : { opacity: 0, y: 10 }}
              animate={reduced ? undefined : { opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.26, ease: [0.2, 0.8, 0.3, 1] }}>
              {route === 'home' && <Home go={go} />}
              {route === 'map' && (
                <MapScreen pinned={pinned} onTogglePin={togglePin}
                  onClear={() => setPinned([])} go={go} />
              )}
              {route === 'setup' && (
                <Setup projections={projections} setProjections={setProjections}
                  pinned={pinned} run={run} go={go} />
              )}
              {route === 'running' && (
                <Running done={() => go('results')} pending={serverPending}
                  slow={serverSlow} error={serverError} retry={run} />
              )}
              {route === 'results' && (
                <Results projections={projections} setProjections={setProjections}
                  weights={weights} setWeights={setWeights} pinned={pinned} go={go}
                  server={server} serverError={serverError} />
              )}
              {isDoc && <DocPage route={route} go={go} />}
            </motion.div>
          </AnimatePresence>
        </main>

        <Footer go={go} />
      </div>
    </Tooltip.Provider>
  )
}
