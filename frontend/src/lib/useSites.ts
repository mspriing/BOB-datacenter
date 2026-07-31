import { useMemo } from 'react'
import { US_REGIONS } from '../data/usRegions'
import { DEFAULT_SITES, type NamedSite } from '../data/defaultSites'
import { driversFor } from './engine'

/**
 * The candidate set. Pinned metros win; otherwise the three published sites,
 * so the worked example on the home page still reproduces.
 */
export function useSites(pinned: string[]): { sites: NamedSite[]; fromPins: boolean } {
  return useMemo(() => {
    if (pinned.length >= 2) {
      const sites = pinned
        .map(k => US_REGIONS.find(r => r.key === k))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map(r => ({
          key: r.key,
          label: r.label.replace(/,\s*[A-Z]{2}$/, ''),
          place: r.label,
          base: driversFor(r),
        }))
      if (sites.length >= 2) return { sites, fromPins: true }
    }
    return { sites: DEFAULT_SITES, fromPins: false }
  }, [pinned])
}
