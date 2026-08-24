/**
 * Project-level assumptions — every constant the cost engine uses that is not
 * read from data/regions.json.
 *
 * Why this file exists. The whole claim of this product is that each figure
 * says where it came from. Regional drivers have said so since work order 3.
 * These constants never did: they sat as bare numbers in capex.ts and opex.ts,
 * with a code comment at best, and they move the answer as much as the regional
 * data does. Maintenance alone was worth about $1.7M a year on a 10 MW build.
 *
 * Each entry carries the same four things a regional driver carries: what it
 * is, whether it is sourced, modeled or assumed, where it came from, and the
 * working behind it. They are published in the estimate response so a reader
 * can see them beside the regional numbers rather than having to read the code.
 *
 * Reviewed 2026-08-24 against a working data-center operator's figures for a
 * facility he runs, and against published industry benchmarks. Where the two
 * agreed, the value moved; where only the operator had a figure, the entry says
 * so and stays labeled as an assumption rather than borrowing someone's name.
 */

export type Basis = 'sourced' | 'modeled' | 'assumed'

export interface Assumption {
  /** Machine name, matching the key. */
  key:           string
  /** What a reader would call it. */
  label:         string
  value:         number
  unit:          string
  basis:         Basis
  source_url:    string
  last_verified: string
  /** How the figure was arrived at, and what it does not cover. */
  method:        string
}

// ── Land sizing ───────────────────────────────────────────────────────────────

export const ACRES_PER_MW = 1.2
export const MIN_ACRES    = 5

// ── Maintenance ───────────────────────────────────────────────────────────────

/**
 * Annual facility maintenance as a share of the build cost.
 *
 * Was 1.5% with no source behind it. A working operator reviewing this model
 * put his own facility under 1%, and no free published series for this ratio
 * was found, so the figure moves to 1.0% and stays labeled as an assumption.
 * On a 10 MW build the change is worth about $570K a year.
 */
export const MAINTENANCE_RATE = 0.010

// ── Staffing and connectivity ────────────────────────────────────────────────

export const BASE_STAFF_COST_PER_KW   = 280
export const BASE_CONNECTIVITY_PER_KW = 60

// ── Cooling overhead ─────────────────────────────────────────────────────────

/**
 * The default cooling overhead a new build is designed to. Not an average of
 * what exists: Uptime Institute's 2025 survey puts the industry at 1.54 and
 * facilities of 20 MW and above at 1.44. Those are running fleets, most of them
 * a decade old. 1.25 is what a new air-cooled build is designed to reach, and
 * it matches a facility a working operator runs today.
 */
export const DEFAULT_DESIGN_PUE = 1.25

// ── The published table ───────────────────────────────────────────────────────

export const ASSUMPTIONS: Assumption[] = [
  {
    key:   'design_pue',
    label: 'Cooling overhead a new build is designed to',
    value: DEFAULT_DESIGN_PUE,
    unit:  'ratio of total site power to equipment power',
    basis: 'assumed',
    source_url:    'https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/2025.Annual.Survey.Report.pdf',
    last_verified: '2026-08-24',
    method:
      'A design target, not an average. Uptime Institute\'s 2025 Global Data Center Survey reports a ' +
      'weighted average of 1.54 across the industry, and 1.44 for facilities of 20 MW and above. Those ' +
      'describe fleets already running. 1.25 is the figure a new air-cooled build is designed to reach, ' +
      'and it is what a working operator reported for a facility of this size in August 2026. It is set ' +
      'on the Setup screen and can be changed there.',
  },
  {
    key:   'maintenance_rate',
    label: 'Annual maintenance, as a share of the build cost',
    value: MAINTENANCE_RATE,
    unit:  'share of build cost per year',
    basis: 'assumed',
    source_url:    '',
    last_verified: '2026-08-24',
    method:
      'Planned and corrective maintenance on the building and its mechanical and electrical plant, ' +
      'charged as a share of what the building cost. It was 1.5% here with nothing behind it. A working ' +
      'data-center operator reviewing this model in August 2026 reported under 1% at his own facility. ' +
      'No free published series exists for this ratio, so the figure is 1.0% and stays an assumption ' +
      'rather than borrowing a name it did not come from.',
  },
  {
    key:   'staff_cost_per_kw',
    label: 'Operations staffing at the national median',
    value: BASE_STAFF_COST_PER_KW,
    unit:  'USD per kW of equipment load per year',
    basis: 'assumed',
    source_url:    '',
    last_verified: '2026-08-24',
    method:
      'Fully loaded operations pay for a facility at the national median, before the regional staff cost ' +
      'index moves it. The index itself is sourced per region from the Bureau of Labor Statistics; this ' +
      'baseline is not, and no free per-kW staffing series was found to replace it.',
  },
  {
    key:   'connectivity_per_kw',
    label: 'Network connectivity',
    value: BASE_CONNECTIVITY_PER_KW,
    unit:  'USD per kW of equipment load per year',
    basis: 'assumed',
    source_url:    '',
    last_verified: '2026-08-24',
    method:
      'Diverse fibre routes and dark fibre, spread evenly across the year. A flat figure, so it does not ' +
      'move with how far the site sits from a carrier hotel. Distance to an internet exchange is priced ' +
      'separately at parcel grain.',
  },
  {
    key:   'acres_per_mw',
    label: 'Land a campus needs',
    value: ACRES_PER_MW,
    unit:  'acres per MW of equipment load',
    basis: 'assumed',
    source_url:    '',
    last_verified: '2026-08-24',
    method:
      'Campus land per megawatt, with a floor of ' + MIN_ACRES + ' acres. It sizes the land line when ' +
      'comparing regions. When comparing parcels the whole parcel is charged instead, because a seller ' +
      'will not split twelve acres off an eighty-acre listing.',
  },
  {
    key:   'build_cost_scope',
    label: 'What the build cost covers',
    value: 0,
    unit:  'note',
    basis: 'sourced',
    source_url:    'https://reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/methodology',
    last_verified: '2026-08-24',
    method:
      'The cost to build per kW is a published construction index figure. It covers shell and core, ' +
      'architectural fit-out and finishes, mechanical and electrical fit-out and equipment, contractor ' +
      'preliminaries, margin and contingency. It does not cover land, which this model prices separately, ' +
      'and it does not cover active IT equipment, utility connection works, abnormal groundworks or ' +
      'professional fees, none of which this model prices at all. A total here will therefore sit below ' +
      'an all-in figure an owner would quote for the same build.',
  },
]
