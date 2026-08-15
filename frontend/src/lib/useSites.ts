import { useMemo } from 'react'
import { US_REGIONS } from '../data/usRegions'
import { INTL_REGIONS } from '../data/intlRegions'
import { DEFAULT_SITES, type NamedSite } from '../data/defaultSites'
import { driversFor } from './engine'

/**
 * Every region the picker can offer: the US snapshot plus the 14 international
 * markets. Before this existed the picker held US regions only, so no
 * combination a reader chose could include Singapore, Tokyo or Frankfurt even
 * though the engine has priced them since July.
 */
export const ALL_REGIONS = [...US_REGIONS, ...INTL_REGIONS]

/** A region key becomes a candidate site. Returns null for a key we do not hold. */
export function siteFor(key: string): NamedSite | null {
  const published = DEFAULT_SITES.find(s => s.key === key)
  if (published) return published
  const r = ALL_REGIONS.find(x => x.key === key)
  if (!r) return null
  return {
    key: r.key,
    label: r.label.replace(/,.*$/, ''),
    place: r.label,
    base: driversFor(r),
  }
}

export interface SiteSet {
  sites: NamedSite[]
  /** Where the set came from, so the UI can say so rather than switch silently. */
  source: 'pins' | 'chosen' | 'default'
  /** Keys that were asked for and could not be resolved. */
  dropped: string[]
}

/**
 * The candidate set. Map pins win when there are at least two, then whatever
 * the setup screen holds, then the three published sites so the worked example
 * on the home page still reproduces.
 */
export function useSites(pinned: string[], chosen: string[] = []): SiteSet {
  return useMemo(() => {
    const resolve = (keys: string[]) => {
      const sites: NamedSite[] = []
      const dropped: string[] = []
      for (const k of keys) {
        const s = siteFor(k)
        if (s && !sites.some(x => x.key === s.key)) sites.push(s)
        else if (!s) dropped.push(k)
      }
      return { sites, dropped }
    }

    if (pinned.length >= 2) {
      const { sites, dropped } = resolve(pinned)
      if (sites.length >= 2) return { sites, source: 'pins', dropped }
    }

    if (chosen.length >= 2) {
      const { sites, dropped } = resolve(chosen)
      if (sites.length >= 2) return { sites, source: 'chosen', dropped }
    }

    return { sites: DEFAULT_SITES, source: 'default', dropped: [] }
  }, [pinned, chosen])
}
