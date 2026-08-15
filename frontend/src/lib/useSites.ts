import { useMemo } from 'react'
import { US_REGIONS } from '../data/usRegions'
import { DEFAULT_SITES, type NamedSite } from '../data/defaultSites'
import { driversFor } from './engine'

/** The keys the picker starts on, so the worked example still reproduces. */
export const DEFAULT_SITE_KEYS = DEFAULT_SITES.map(s => s.key)

/**
 * A region key becomes a priceable site. Published sites carry their own
 * figures; everything else is priced off the regional dataset.
 */
function siteFor(key: string): NamedSite | null {
  const published = DEFAULT_SITES.find(s => s.key === key)
  if (published) return published

  const r = US_REGIONS.find(x => x.key === key)
  if (!r) return null
  return {
    key: r.key,
    label: r.label.replace(/,\s*[A-Z]{2}$/, ''),
    place: r.label,
    base: driversFor(r),
  }
}

/**
 * The candidate set. Pinned metros win, because pinning is the more specific
 * gesture; otherwise whatever the setup picker holds. Both are resolved the
 * same way, so a site selected in the picker prices exactly as it would if it
 * had been pinned on the map.
 */
export function useSites(pinned: string[], selected: string[] = DEFAULT_SITE_KEYS):
  { sites: NamedSite[]; fromPins: boolean } {
  return useMemo(() => {
    if (pinned.length >= 2) {
      const sites = pinned.map(siteFor).filter((s): s is NamedSite => !!s)
      if (sites.length >= 2) return { sites, fromPins: true }
    }
    const sites = selected.map(siteFor).filter((s): s is NamedSite => !!s)
    if (sites.length >= 2) return { sites, fromPins: false }
    return { sites: DEFAULT_SITES, fromPins: false }
  }, [pinned, selected])
}
