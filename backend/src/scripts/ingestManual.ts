/**
 * Merge the hand-collected driver values in data/manual-drivers.csv into
 * data/regions.json.
 *
 *   npm run ingest:manual            # report only, writes nothing
 *   npm run ingest:manual -- --write # apply the merge
 *
 * The CSV is the output of the July 2026 collection workbook: one row per
 * (region_key, driver), each carrying its own source_url, last_verified and
 * basis. Those values were collected and then never reached the engine,
 * because nothing read this file.
 *
 * Merge policy, deliberately conservative:
 *   - A row only fills a cell whose value is currently null.
 *   - A row that disagrees with a value already in regions.json is NOT applied.
 *     It is reported as a conflict for a human to resolve, because the two
 *     numbers came from two different sources and silently preferring either
 *     one would destroy the provenance this product is built on.
 *   - Rows with status 'gap' are skipped; a documented gap is a finding, not
 *     a value.
 *
 * Re-runnable. Running it twice changes nothing the second time.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

const ROOT       = resolvePath(import.meta.dirname, '../../..')
const CSV_PATH   = resolvePath(ROOT, 'data/manual-drivers.csv')
const JSON_PATH  = resolvePath(ROOT, 'data/regions.json')
const WRITE      = process.argv.includes('--write')

/** Drivers in the CSV that the engine does not read. Skipped, not an error. */
const NOT_IN_SCHEMA = new Set(['incentive_tier', 'water_rate_reclaimed_usd_per_kgal'])

interface Row {
  region_key: string
  driver:     string
  value:      string
  low:        string
  high:       string
  source_url: string
  last_verified: string
  basis:      string
  notes:      string
  status:     string
}

/** RFC 4180 parser — the notes column contains commas, quotes and newlines. */
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

const csv     = parseCsv(readFileSync(CSV_PATH, 'utf8'))
const regions = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as Record<string, Record<string, any>>

const applied:      string[] = []
const conflicts:    string[] = []
const alreadyThere: string[] = []
const skipped:      string[] = []

for (const row of csv) {
  const { region_key, driver, status } = row

  if (status !== 'filled')        { skipped.push(`${region_key}/${driver}: status=${status}`); continue }
  if (NOT_IN_SCHEMA.has(driver))  { skipped.push(`${region_key}/${driver}: not a driver the engine reads`); continue }

  const region = regions[region_key]
  if (!region)                    { skipped.push(`${region_key}: no such region in regions.json`); continue }

  const cell = region[driver]
  if (!cell || typeof cell !== 'object') { skipped.push(`${region_key}/${driver}: no such driver in regions.json`); continue }

  const value = num(row.value)
  if (value === null)             { skipped.push(`${region_key}/${driver}: no numeric value in the CSV`); continue }

  if (cell.value !== null && cell.value !== undefined) {
    if (Math.abs(cell.value - value) < Math.abs(cell.value) * 1e-6) alreadyThere.push(`${region_key}/${driver}`)
    else conflicts.push(`${region_key}/${driver}: regions.json has ${cell.value}, the CSV has ${value} (${row.source_url})`)
    continue
  }

  cell.value         = value
  cell.low           = num(row.low)
  cell.high          = num(row.high)
  cell.source_url    = row.source_url    || cell.source_url
  cell.last_verified = row.last_verified || cell.last_verified
  cell.basis         = row.basis         || cell.basis
  if (row.notes) cell.method = row.notes

  applied.push(`${region_key}/${driver} = ${value}`)
}

const CORE = [
  'construction_cost_per_kw',
  'power_rate_usd_per_kwh',
  'land_cost_per_acre_usd',
  'staff_cost_index',
  'risk_score',
  'renewable_pct',
] as const

const priceable = Object.keys(regions).filter((k) =>
  CORE.every((c) => regions[k][c] && regions[k][c].value !== null && regions[k][c].value !== undefined))

console.log(`Read ${csv.length} rows from data/manual-drivers.csv\n`)
console.log(`  values merged in          ${applied.length}`)
console.log(`  already matched           ${alreadyThere.length}`)
console.log(`  conflicts left alone      ${conflicts.length}`)
console.log(`  skipped                   ${skipped.length}`)
console.log(`\n  regions with all six core drivers, after this merge: ${priceable.length} of ${Object.keys(regions).length}`)

if (conflicts.length) {
  console.log('\nCONFLICTS — nothing was overwritten. Each needs a human to pick a source:')
  for (const c of conflicts) console.log(`  ${c}`)
}

if (WRITE) {
  writeFileSync(JSON_PATH, JSON.stringify(regions, null, 2) + '\n')
  console.log('\nWrote data/regions.json.')
} else {
  console.log('\nReport only. Nothing was written. Re-run with --write to apply.')
}
