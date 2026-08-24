export type Route =
  | 'home' | 'setup' | 'running' | 'results' | 'map'
  | 'parcels' | 'parcel'
  | 'how-ranking-works' | 'driver-meanings' | 'cost-method' | 'release-notes'
  | 'all-regions' | 'the-drivers' | 'sources' | 'known-gaps'
  | 'request-region' | 'report-figure' | 'talk-to-team'

export const ROUTE_TITLES: Record<Route, string> = {
  home: 'Start', setup: 'Set up', running: 'Working', results: 'Results', map: 'Map',
  parcels: 'Parcels', parcel: 'Parcel',
  'how-ranking-works': 'How the ranking works',
  'driver-meanings': 'What each driver means',
  'cost-method': 'Cost method and formulas',
  'release-notes': 'Release notes',
  'all-regions': 'All 77 regions',
  'the-drivers': 'The 13 cost drivers',
  sources: 'Source list and dates',
  'known-gaps': 'Known gaps',
  'request-region': 'Request a region',
  'report-figure': 'Report a wrong figure',
  'talk-to-team': 'Talk to the team',
}

export const FOOTER_GROUPS: Array<{ heading: string; links: Array<{ to: Route; label: string }> }> = [
  { heading: 'The tool', links: [
    { to: 'how-ranking-works', label: 'How the ranking works' },
    { to: 'driver-meanings', label: 'What each driver means' },
    { to: 'cost-method', label: 'Cost method and formulas' },
    { to: 'release-notes', label: 'Release notes' },
  ]},
  { heading: 'Coverage', links: [
    { to: 'all-regions', label: 'All 77 regions' },
    { to: 'the-drivers', label: 'The 13 cost drivers' },
    { to: 'sources', label: 'Source list and dates' },
    { to: 'known-gaps', label: 'Known gaps' },
  ]},
  { heading: 'Get in touch', links: [
    { to: 'request-region', label: 'Request a region' },
    { to: 'report-figure', label: 'Report a wrong figure' },
    { to: 'talk-to-team', label: 'Talk to the team' },
  ]},
]

export const ALL_ROUTES = Object.keys(ROUTE_TITLES) as Route[]
export const isRoute = (s: string): s is Route => (ALL_ROUTES as string[]).includes(s)

/**
 * Where the contact pages send people. Deliberately a public issue tracker and
 * not a personal mailbox: this interface carries no individual's address.
 * Change in one place.
 */
export const CONTACT_URL = 'https://github.com/mspriing/BOB-datacenter/issues/new'
