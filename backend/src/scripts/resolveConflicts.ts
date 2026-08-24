/**
 * Resolve the thirty places where data/regions.json and the July collection in
 * data/manual-drivers.csv disagree, and bring two grid regions onto the same
 * construction cost basis as everywhere else.
 *
 *   npm run resolve:conflicts            # report only, writes nothing
 *   npm run resolve:conflicts -- --write # apply
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * `npm run ingest:manual` is insert-only on purpose: it fills empty cells and
 * refuses to overwrite, because two sources disagreeing is a question for a
 * person rather than something a script should settle. That was right, and it
 * left thirty cells parked since 31 July.
 *
 * Reading them one at a time, they are not two sources disagreeing. On one side
 * are the round numbers hand-typed into the six published demo regions when the
 * project started: land at $85,000 an acre, a tax rate of 0.048, 0.055, 0.055.
 * On the other is the collection, every row carrying a county tax levy, an
 * appraisal district, a published listing set or a construction cost index,
 * with a URL and a method. A placeholder losing to research is not a judgement
 * call on a product whose claim is that each figure says where it came from.
 *
 * Two of them were doing real damage:
 *
 *   Northern Virginia's tax rate read 0.06 against Loudoun County's own
 *   published 0.0081, about seven times too high. Property tax is what produced
 *   its $5.8M a year line and its last place.
 *
 *   Northern Virginia's land read $420,000 an acre against $4.4M, ten times too
 *   low, in the market where land is the whole story.
 *
 * Those two point in opposite directions, which is exactly why neither could be
 * fixed on its own.
 *
 * ── What this script will not do ──────────────────────────────────────────────
 *
 * It only touches cells named below. It never invents a value, never fills an
 * empty cell (that is ingest:manual's job), and never writes a figure without
 * carrying the source, the date and the method across with it. Re-running it
 * changes nothing the second time.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

const ROOT      = resolvePath(import.meta.dirname, '../../..')
const CSV_PATH  = resolvePath(ROOT, 'data/manual-drivers.csv')
const JSON_PATH = resolvePath(ROOT, 'data/regions.json')
const WRITE     = process.argv.includes('--write')

/**
 * Drivers where the collection wins over the value already in regions.json.
 *
 * Every row of the collection for these four drivers carries a primary source:
 * a county or state tax authority for the rate and the abatement, a published
 * listing set or appraisal record for land, and the construction cost index for
 * the build cost. The values they replace are round numbers with no method.
 */
const COLLECTION_WINS = new Set([
  'construction_cost_per_kw',
  'land_cost_per_acre_usd',
  'tax_rate',
  'tax_abatement_years',
  'water_rate_usd_per_kgal',
])

/**
 * Two regions that are grid zones rather than cities, so no cost index covers
 * them by name and the collection has no row for either.
 *
 * Both were left on an older source with no method string while every
 * neighbouring region moved onto the construction cost index. Each is derived
 * the same way the dataset already derives Des Moines, Omaha, Reno, Salt Lake
 * City and Lulea: adopt the nearest covered market unadjusted and say so.
 */
const DERIVED_BUILD_COST: Array<{
  region: string
  value:  number
  low:    number
  high:   number
  method: string
}> = [
  {
    region: 'us-tx-ercot',
    value:  9540,
    low:    9540,
    high:   9540,
    method:
      'ERCOT is a grid zone, not a market in the Turner & Townsend Data Centre Construction Cost Index ' +
      '2025-2026 (9th edition). Derivation, nearest covered market in the same construction cost region: ' +
      "adopted T&T's 'Dallas' row = US$9.54/W x 1000 = 9540 USD per kW, unadjusted. Dallas is T&T's only " +
      'Texas market and is already used the same way for the Dallas-Fort Worth metro and for San Antonio. ' +
      'Replaces 8200 USD per kW, which came from a general construction cost article with no method ' +
      'recorded and sat about 14 percent below the index while every neighbouring Texas region used it.',
  },
  {
    region: 'eu-nordic-hydro',
    value:  12295,
    low:    12024,
    high:   12414,
    method:
      'The Nordic hydro zone is a bidding zone, not a market in the Turner & Townsend Data Centre ' +
      "Construction Cost Index 2025-2026 (9th edition). Derivation: adopted T&T's 'Stockholm' row = " +
      'US$12.2947/W x 1000 = 12295 USD per kW, unadjusted, which is exactly how se-lulea is already ' +
      'derived in this dataset. low and high are the bracketing covered Nordic markets rather than a ' +
      'source disagreement: low = Copenhagen US$12.0239/W (12024), high = Oslo US$12.4143/W (12414). ' +
      'Replaces 10200 USD per kW, which came from a general construction cost article with no method ' +
      'recorded and left this region and se-lulea, the same physical place, 2095 USD per kW apart.',
  },
]

const BUILD_COST_SOURCE =
  'https://reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/data-centre-cost-trends'

// ── CSV parsing (same RFC 4180 reader as ingestManual.ts) ─────────────────────

interface Row {
  region_key: string; driver: string; value: string; low: string; high: string
  source_url: string; last_verified: string; basis: string; notes: string; status: string
}

function parseCsv(text: string): Row[] {
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      record.push(field); field = ''
    } else if (ch === '\n') {
      record.push(field); field = ''
      rows.push(record); record = []
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record) }

  const header = rows.shift()
  if (!header) return []
  return rows
    .filter((r) => r.length >= header.length && r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])) as unknown as Row)
}

const num = (s: string): number | null => {
  if (!s || s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ── Apply ─────────────────────────────────────────────────────────────────────

const csv     = parseCsv(readFileSync(CSV_PATH, 'utf8'))
const regions = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as Record<string, Record<string, any>>

const changes:   string[] = []
const unchanged: string[] = []
const leftAlone: string[] = []

for (const row of csv) {
  const { region_key, driver, status } = row
  if (status !== 'filled') continue

  const cell = regions[region_key]?.[driver]
  if (!cell || typeof cell !== 'object') continue

  const value = num(row.value)
  if (value === null) continue
  if (cell.value === null || cell.value === undefined) continue   // ingest:manual's job

  const same = Math.abs(cell.value - value) < Math.abs(cell.value || 1) * 1e-6
  if (same) { unchanged.push(`${region_key}/${driver}`); continue }

  if (!COLLECTION_WINS.has(driver)) {
    leftAlone.push(`${region_key}/${driver}: ${cell.value} kept over ${value}`)
    continue
  }

  changes.push(`${region_key}/${driver}: ${cell.value} -> ${value}  [${row.basis}]  ${row.source_url.split(' ')[0]}`)

  cell.value         = value
  cell.low           = num(row.low)
  cell.high          = num(row.high)
  cell.source_url    = row.source_url    || cell.source_url
  cell.last_verified = row.last_verified || cell.last_verified
  cell.basis         = row.basis         || cell.basis
  if (row.notes) cell.method = row.notes
}

for (const d of DERIVED_BUILD_COST) {
  const cell = regions[d.region]?.construction_cost_per_kw
  if (!cell) continue
  if (cell.value === d.value) { unchanged.push(`${d.region}/construction_cost_per_kw`); continue }
  changes.push(`${d.region}/construction_cost_per_kw: ${cell.value} -> ${d.value}  [modeled]  ${BUILD_COST_SOURCE}`)
  cell.value         = d.value
  cell.low           = d.low
  cell.high          = d.high
  cell.source_url    = BUILD_COST_SOURCE
  cell.last_verified = '2025'
  cell.basis         = 'modeled'
  cell.method        = d.method
}

// ── Report ────────────────────────────────────────────────────────────────────

const CORE = [
  'construction_cost_per_kw',
  'power_rate_usd_per_kwh',
  'land_cost_per_acre_usd',
  'staff_cost_index',
] as const

const priceable = Object.keys(regions).filter((k) =>
  CORE.every((c) => regions[k][c] && regions[k][c].value !== null && regions[k][c].value !== undefined))

console.log(`  values replaced by the collection or a derivation  ${changes.length}`)
console.log(`  already agreed                                     ${unchanged.length}`)
console.log(`  disagreed but left alone                           ${leftAlone.length}`)
console.log(`\n  regions that can be priced after this: ${priceable.length} of ${Object.keys(regions).length}\n`)

for (const c of changes) console.log(`  ${c}`)
if (leftAlone.length) {
  console.log('\nLeft alone, because this script only resolves the drivers named in it:')
  for (const c of leftAlone) console.log(`  ${c}`)
}

if (WRITE) {
  writeFileSync(JSON_PATH, JSON.stringify(regions, null, 2) + '\n')
  console.log('\nWrote data/regions.json.')
} else {
  console.log('\nReport only. Nothing was written. Re-run with --write to apply.')
}
