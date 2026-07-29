#!/usr/bin/env tsx
/**
 * backend/src/scripts/ingest.ts
 *
 * Re-runnable data ingest: fetches six machine-readable drivers and writes
 * them into data/regions.json with correct provenance.
 *
 * Run from backend/:  npm run ingest
 *
 * Idempotent: running twice produces the same file.
 * Never overwrites a value whose basis is "sourced" and whose source_url
 * is not one of this script's own sources — those are hand-collected values.
 *
 * Pass EIA API key as EIA_API_KEY env var (free at https://www.eia.gov/opendata/).
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
// @ts-ignore — xlsx ships CommonJS types
import * as XLSXImport from 'xlsx'
// xlsx ships CommonJS; under ESM the real module lands on .default
const XLSX = (XLSXImport as any).default ?? XLSXImport
// @ts-ignore — adm-zip ships CommonJS types
import AdmZip from 'adm-zip'

// ── Path setup ────────────────────────────────────────────────────────────────

const __dirname   = dirname(fileURLToPath(import.meta.url))
const ROOT        = resolve(__dirname, '../../..')  // backend/src/scripts → repo root
const DATA_DIR    = resolve(ROOT, 'data')
const RAW_DIR     = resolve(DATA_DIR, 'raw')
const REGIONS_PATH = resolve(DATA_DIR, 'regions.json')

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverValue {
  value:          number | null
  low?:           number | null
  high?:          number | null
  source_url:     string
  last_verified:  string
  basis:          'sourced' | 'modeled' | 'assumed'
  method?:        string | null
}

interface Region {
  label:                      string
  precision:                  'state' | 'metro' | 'international'
  parent_state?:              string
  power_rate_usd_per_kwh:     DriverValue
  water_rate_usd_per_kgal:    DriverValue
  land_cost_per_acre_usd:     DriverValue
  construction_cost_per_kw:   DriverValue
  construction_cost_per_mw:   DriverValue
  staff_cost_index:            DriverValue
  tax_rate:                    DriverValue
  tax_abatement_years:         DriverValue
  incentive_usd_per_kw:        DriverValue
  risk_score:                  DriverValue
  renewable_pct:               DriverValue
  low_carbon_pct:              DriverValue
  latency_ms_to_hub:           DriverValue
  grid_interconnection_years:  DriverValue
}

type RegionsFile = Record<string, Region>

// ── Globals ───────────────────────────────────────────────────────────────────

const EIA_KEY = process.env.EIA_API_KEY ?? ''
const TODAY   = new Date().toISOString().slice(0, 7) // "YYYY-MM"

let written = 0
let skipped = 0

// ── Helpers ───────────────────────────────────────────────────────────────────

const loadRegions = (): RegionsFile => JSON.parse(readFileSync(REGIONS_PATH, 'utf-8'))
const saveRegions = (d: RegionsFile) => writeFileSync(REGIONS_PATH, JSON.stringify(d, null, 2))

async function fetchJSON(url: string): Promise<any> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.json()
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.text()
}

async function cachedFetch(url: string, filename: string): Promise<Buffer> {
  mkdirSync(RAW_DIR, { recursive: true })
  const p = resolve(RAW_DIR, filename)
  if (existsSync(p)) { console.log(`    [cache] ${filename}`); return readFileSync(p) }
  console.log(`    [fetch] ${url}`)
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  writeFileSync(p, buf)
  return buf
}

/**
 * Fetch the EUR/USD exchange rate from the ECB daily reference rates XML.
 * Result is cached to data/raw/ keyed by date so a second run on the same day
 * is free.  On failure, falls back to 1.09 and logs a warning.
 *
 * ECB source: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
 * The XML contains a Cube element per currency, e.g.:
 *   <Cube currency='USD' rate='1.0923'/>
 */
async function fetchECBEurUsd(): Promise<{ rate: number; date: string }> {
  const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'
  const FALLBACK = { rate: 1.09, date: 'fallback' }

  let xml: string
  try {
    // Cache file is date-stamped so it is re-fetched when the date changes.
    const buf = await cachedFetch(ECB_URL, `ecb-eurusd-${TODAY}.xml`)
    xml = buf.toString('utf-8')
  } catch (e: any) {
    console.log(`  ⚠  ECB EUR/USD fetch failed: ${e.message}; using fallback ${FALLBACK.rate}`)
    return FALLBACK
  }

  // Extract the date from <Cube time='YYYY-MM-DD'>
  const dateMatch = xml.match(/time=['"]([\d-]+)['"]/)
  const rateDate  = dateMatch?.[1] ?? TODAY

  // Extract USD rate from <Cube currency='USD' rate='...'/>
  const rateMatch = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/) ??
                    xml.match(/rate=['"]([0-9.]+)['"]\s+currency=['"]USD['"]/)
  if (!rateMatch) {
    console.log(`  ⚠  ECB XML: could not parse USD rate; using fallback ${FALLBACK.rate}`)
    return { ...FALLBACK, date: rateDate }
  }

  const rate = parseFloat(rateMatch[1])
  if (isNaN(rate) || rate <= 0) {
    console.log(`  ⚠  ECB XML: invalid rate value "${rateMatch[1]}"; using fallback ${FALLBACK.rate}`)
    return { ...FALLBACK, date: rateDate }
  }

  console.log(`    ECB EUR/USD: ${rate} (date ${rateDate})`)
  return { rate, date: rateDate }
}

/**
 * Skip only when the field is already "sourced" from a *different* hand-collected
 * source that is not one of our own URLs.
 */
function shouldSkip(driver: DriverValue, ourUrl: string): boolean {
  return driver.basis === 'sourced' && driver.source_url !== ourUrl
}

function write(
  region:     Region,
  field:      keyof Region,
  value:      number | null,
  low:        number | null,
  high:       number | null,
  source_url: string,
  basis:      'sourced' | 'modeled',
  method?:    string,
): void {
  const d = region[field] as DriverValue
  if (shouldSkip(d, source_url)) { skipped++; return }
  d.value         = value
  d.low           = low
  d.high          = high
  d.source_url    = source_url
  d.last_verified = TODAY
  d.basis         = basis
  if (method !== undefined) d.method = method ?? null
  written++
}

// ── State lookups ─────────────────────────────────────────────────────────────

// us-{suffix} → EIA 2-letter postal code
const STATE_SUFFIX_TO_EIA: Record<string, string> = {
  al:'AL',ak:'AK',az:'AZ',ar:'AR',ca:'CA',co:'CO',ct:'CT',de:'DE',
  fl:'FL',ga:'GA',hi:'HI',id:'ID',il:'IL',in:'IN',ia:'IA',ks:'KS',
  ky:'KY',la:'LA',me:'ME',md:'MD',ma:'MA',mi:'MI',mn:'MN',ms:'MS',
  mo:'MO',mt:'MT',ne:'NE',nv:'NV',nh:'NH',nj:'NJ',nm:'NM',ny:'NY',
  nc:'NC',nd:'ND',oh:'OH',ok:'OK',or:'OR',pa:'PA',ri:'RI',sc:'SC',
  sd:'SD',tn:'TN',tx:'TX',ut:'UT',vt:'VT',va:'VA',wa:'WA',wv:'WV',
  wi:'WI',wy:'WY',
}

// ── 3a. US power rates — EIA Retail Sales API ─────────────────────────────────

async function ingestUSPowerRates(regions: RegionsFile): Promise<void> {
  if (!EIA_KEY) { console.log('  ⚠  EIA_API_KEY not set — skipping US power rates'); return }

  // Source URL recorded without the real API key
  const SOURCE = 'https://api.eia.gov/v2/electricity/retail-sales/data?data[]=price&facets[sectorid][]=IND&frequency=annual&api_key=KEY'
  const statePrices: Record<string, { value: number; prev: number }> = {}

  for (const [suffix, eiaCode] of Object.entries(STATE_SUFFIX_TO_EIA)) {
    const key = `us-${suffix}`
    if (!regions[key]) continue
    const url =
      `https://api.eia.gov/v2/electricity/retail-sales/data` +
      `?data[]=price&facets[sectorid][]=IND&facets[stateid][]=${eiaCode}` +
      `&frequency=annual&sort[0][column]=period&sort[0][direction]=desc&length=3&api_key=${EIA_KEY}`
    try {
      const json = await fetchJSON(url)
      const rows: Array<{period: string; price: number}> = json?.response?.data ?? []
      if (rows.length < 2) { console.log(`    ⚠  ${key}: <2 rows from EIA`); continue }
      const sorted = rows.sort((a, b) => b.period.localeCompare(a.period))
      // EIA reports cents/kWh; divide by 100 for $/kWh
      const value = sorted[0].price / 100
      const prev  = sorted[1].price / 100
      statePrices[suffix] = { value, prev }
      write(regions[key], 'power_rate_usd_per_kwh', value, Math.min(value,prev), Math.max(value,prev), SOURCE, 'sourced')
    } catch (e: any) {
      console.log(`    ⚠  ${key} EIA power: ${e.message}`)
    }
  }

  // Metros: inherit parent state, basis modeled
  for (const [key, region] of Object.entries(regions)) {
    if (region.precision !== 'metro' || !key.startsWith('us-') || !region.parent_state) continue
    const sp = statePrices[region.parent_state.slice(3)]
    if (!sp) continue
    write(region, 'power_rate_usd_per_kwh', sp.value, Math.min(sp.value, sp.prev), Math.max(sp.value, sp.prev),
      SOURCE, 'modeled', 'state average; no metro-level industrial rate is published by EIA')
  }
}

// ── 3b. US renewable_pct + low_carbon_pct — EIA bulk generation XLS ───────────
//
// Source: https://www.eia.gov/electricity/data/state/annual_generation_state.xls
// Sheet: "Net_Generation_1990-2024 Final" (or similar)
// Real structure discovered on first run:
//   Row 0: title text (to skip)
//   Row 1: ["YEAR","STATE","TYPE OF PRODUCER","ENERGY SOURCE","GENERATION (Megawatthours)",...]
//   Row 2+: data
// Using XLSX header:1 to skip the title row, then treat row 1 as column headers.

async function ingestUSGenerationMix(regions: RegionsFile): Promise<void> {
  const SOURCE = 'https://www.eia.gov/electricity/data/state/annual_generation_state.xls'
  let buf: Buffer
  try {
    buf = await cachedFetch(SOURCE, 'eia-annual-generation-state.xls')
  } catch (e: any) {
    console.log(`  ⚠  EIA generation fetch failed: ${e.message}`); return
  }

  let wb: any
  try { wb = XLSX.read(buf, { type: 'buffer' }) }
  catch (e: any) { console.log(`  ⚠  EIA XLS parse failed: ${e.message}`); return }

  // Read raw rows with integer header (1-indexed arrays)
  const sheetName = wb.SheetNames[0]
  const rawRows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, header: 1 })

  // Row 0 is the title, row 1 is the real header
  if (rawRows.length < 3) { console.log('  ⚠  EIA XLS too few rows'); return }

  const headerRow: string[] = rawRows[1].map((h: any) => String(h ?? '').trim())
  console.log(`    EIA XLS headers (row 1): ${headerRow.join(', ')}`)

  const yearIdx   = headerRow.findIndex(h => /^YEAR$/i.test(h))
  const stateIdx  = headerRow.findIndex(h => /^STATE$/i.test(h))
  const typeIdx   = headerRow.findIndex(h => /TYPE OF PRODUCER/i.test(h))
  const srcIdx    = headerRow.findIndex(h => /ENERGY SOURCE/i.test(h))
  const genIdx    = headerRow.findIndex(h => /GENERATION/i.test(h))

  if ([yearIdx, stateIdx, typeIdx, srcIdx, genIdx].includes(-1)) {
    console.log(`  ⚠  EIA XLS: missing columns (year=${yearIdx} state=${stateIdx} type=${typeIdx} src=${srcIdx} gen=${genIdx})`)
    return
  }

  // Find max year in data (rows 2+)
  const dataRows = rawRows.slice(2)
  const years = dataRows.map(r => Number(r[yearIdx])).filter(n => !isNaN(n) && n > 1900)
  const maxYear = Math.max(...years)
  console.log(`    EIA XLS: using year ${maxYear}, ${dataRows.length} data rows`)

  // Accumulate generation by state → source
  const byState: Record<string, Record<string, number>> = {}
  for (const row of dataRows) {
    if (Number(row[yearIdx]) !== maxYear) continue
    if (!/total electric power industry/i.test(String(row[typeIdx] ?? ''))) continue
    const state = String(row[stateIdx] ?? '').toUpperCase().trim()
    const src   = String(row[srcIdx]   ?? '').toLowerCase().trim()
    const gen   = Number(row[genIdx])
    if (!state || isNaN(gen)) continue
    // Skip the "Total" energy-source row — it is the sum of all individual fuel
    // rows and including it would double-count the denominator.
    if (/^total$/i.test(src)) continue
    if (!byState[state]) byState[state] = {}
    byState[state][src] = (byState[state][src] ?? 0) + gen
  }

  // EIA energy source names (exact, lowercased)
  const RENEWABLES = ['hydroelectric conventional', 'wind', 'solar', 'geothermal',
                      'wood and wood derived fuels', 'other biomass']
  const NUCLEAR = ['nuclear']

  for (const [suffix, eiaCode] of Object.entries(STATE_SUFFIX_TO_EIA)) {
    const key = `us-${suffix}`
    if (!regions[key]) continue
    const sd = byState[eiaCode]
    if (!sd) continue
    const total   = Object.values(sd).reduce((a, b) => a + b, 0)
    if (total <= 0) continue
    const renew   = RENEWABLES.reduce((s, k) => s + (sd[k] ?? 0), 0)
    const nuclear = NUCLEAR.reduce((s, k) => s + (sd[k] ?? 0), 0)

    write(regions[key], 'renewable_pct', renew / total, null, null, SOURCE, 'modeled',
      `sum of hydro + wind + solar + geothermal + biomass ÷ total net generation; year ${maxYear}`)
    write(regions[key], 'low_carbon_pct', (renew + nuclear) / total, null, null, SOURCE, 'modeled',
      `renewable share + nuclear ÷ total net generation; year ${maxYear}`)
  }

  // Metros: inherit parent state value.
  // When a metro's renewable_pct is protected (hand-sourced from a different URL),
  // do NOT overwrite it — and do NOT blindly copy the parent's low_carbon_pct either,
  // because that would produce a low_carbon share lower than the region's own renewable
  // share (two values from different sources at different vintages).
  // Instead, derive low_carbon_pct as the region's own renewable_pct + the parent
  // state's nuclear share (= parent.low_carbon_pct − parent.renewable_pct).  This is
  // physically consistent: the nuclear that runs on the same state grid still reaches
  // the metro, and using the parent nuclear share is the best available proxy.
  for (const [key, region] of Object.entries(regions)) {
    if (region.precision !== 'metro' || !key.startsWith('us-') || !region.parent_state) continue
    const parent = regions[region.parent_state]
    if (!parent) continue

    const renewProtected = shouldSkip(region.renewable_pct, SOURCE)

    // renewable_pct: only write if not already protected
    if (!renewProtected) {
      const pv = parent.renewable_pct.value
      if (pv !== null)
        write(region, 'renewable_pct', pv, null, null, SOURCE, 'modeled',
          `state-level value (no metro breakdown); ${parent.renewable_pct.method ?? ''}`.trim())
    }

    // low_carbon_pct:
    if (renewProtected) {
      // Region has a hand-sourced renewable_pct from a non-script URL.
      // Derive low_carbon_pct = region.renewable_pct + parent nuclear share, so that
      // low_carbon_pct ≥ renewable_pct is guaranteed.
      const ownRen = region.renewable_pct.value
      const parentLc  = parent.low_carbon_pct.value
      const parentRen = parent.renewable_pct.value
      if (ownRen !== null && parentLc !== null && parentRen !== null) {
        const parentNuclear = parentLc - parentRen
        const lc = Math.min(1, ownRen + Math.max(0, parentNuclear))
        write(region, 'low_carbon_pct', lc, null, null, SOURCE, 'modeled',
          `region renewable_pct is hand-sourced; low_carbon_pct = own renewable_pct (${ownRen.toFixed(4)}) + ` +
          `parent state nuclear share (${Math.max(0, parentNuclear).toFixed(4)}); ` +
          `parent nuclear derived from parent low_carbon_pct − parent renewable_pct; ` +
          `${parent.low_carbon_pct.method ?? ''}`.trim())
      }
    } else {
      const pv = parent.low_carbon_pct.value
      if (pv !== null)
        write(region, 'low_carbon_pct', pv, null, null, SOURCE, 'modeled',
          `state-level value (no metro breakdown); ${parent.low_carbon_pct.method ?? ''}`.trim())
    }
  }
}

// ── 3c. International power rates — Eurostat nrg_pc_205 ───────────────────────
//
// TSV header: freq,siec,nrg_cons,unit,tax,currency,geo\TIME_PERIOD [tab] dates...
// Dimension indices: 0=freq 1=siec 2=nrg_cons 3=unit 4=tax 5=currency 6=geo
// We want: nrg_cons=MWH_GE150000, tax=X_TAX, currency=EUR
// Unit in this file is KWH, so values are already EUR/kWh (no MWh→kWh conversion).
// UK remains as "UK" in this dataset (post-Brexit rows still present).
//
// IMPORTANT accuracy note (bidding-zone caveat, encoded in method strings):
// Sweden (se-lulea): national SE mix is ~40% hydro + ~30% nuclear, but SE1 bidding
// zone (Luleå) is overwhelmingly hydro+wind with essentially no nuclear. The national
// figure overstates low-carbon and understates the renewable/nuclear split.
// Norway (no-oslo): NO1 (Oslo) is ~98% hydro — very close to national average.
const SE_CAVEAT = 'Sweden national mix; SE1 zone (Luleå) is overwhelmingly hydro+wind with no nuclear — national figure overstates low-carbon share'
const NO_CAVEAT = 'Norway national mix; NO1 zone (Oslo) is ~98% hydro, close to national average; bidding-zone caveat noted'

// Map our keys → Eurostat geo code
const EUROSTAT_GEO: Record<string, string> = {
  'ie-dublin': 'IE', 'nl-amsterdam': 'NL', 'de-frankfurt': 'DE',
  'uk-slough': 'UK', 'fr-paris': 'FR', 'se-lulea': 'SE', 'no-oslo': 'NO',
  // SG, JP, IN, BR, MX, CA have no Eurostat row — left null
}

async function ingestInternationalPowerRates(regions: RegionsFile): Promise<void> {
  const SOURCE = 'https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/nrg_pc_205?format=TSV&compressed=false'
  let tsv: string
  try {
    console.log('    Fetching Eurostat nrg_pc_205...')
    tsv = await fetchText(SOURCE)
  } catch (e: any) { console.log(`  ⚠  Eurostat fetch failed: ${e.message}`); return }

  const lines = tsv.split('\n')
  if (lines.length < 2) { console.log('  ⚠  Eurostat TSV empty'); return }

  // Parse: dim string is "S,E7000,MWH_GE150000,KWH,X_TAX,EUR,IE"
  // Split on comma → [freq,siec,nrg_cons,unit,tax,currency,geo]
  const priceByGeo: Record<string, number> = {}

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t')
    if (!cells[0]) continue
    const dims = cells[0].split(',')
    if (dims.length < 7) continue
    const nrgCons = dims[2]?.trim()
    const unit    = dims[3]?.trim()
    const tax     = dims[4]?.trim()
    const currency= dims[5]?.trim()
    const geo     = dims[6]?.trim().toUpperCase()

    if (nrgCons !== 'MWH_GE150000') continue
    if (tax !== 'X_TAX') continue
    if (currency !== 'EUR') continue
    if (!Object.values(EUROSTAT_GEO).includes(geo)) continue

    // Values are EUR/kWh already (unit=KWH). Find most recent non-null from right.
    for (let t = cells.length - 1; t >= 1; t--) {
      const raw = cells[t]?.trim().replace(/[^0-9.]/g, '')
      if (!raw) continue
      const val = parseFloat(raw)
      if (!isNaN(val) && val > 0) { priceByGeo[geo] = val; break }
    }
  }

  console.log(`    Eurostat prices found for: ${Object.keys(priceByGeo).join(', ')}`)
  console.log(`    NOTE: SG, JP, IN, BR, MX, CA have no Eurostat row — left null for manual entry`)

  // EUR/kWh → USD/kWh using ECB daily reference rate
  const { rate: EUR_TO_USD, date: rateDate } = await fetchECBEurUsd()

  for (const [key, geo] of Object.entries(EUROSTAT_GEO)) {
    const region = regions[key]
    if (!region) continue
    const eurKwh = priceByGeo[geo]
    if (eurKwh == null) { console.log(`    ⚠  No Eurostat price for ${key} (${geo})`); continue }
    write(region, 'power_rate_usd_per_kwh', eurKwh * EUR_TO_USD, null, null, SOURCE, 'sourced',
      `Eurostat nrg_pc_205 MWH_GE150000 X_TAX EUR; converted at EUR/USD ${EUR_TO_USD} (ECB reference rate ${rateDate})`)
  }
}

// ── 3c. International generation mix — OWID ───────────────────────────────────

const OWID_COUNTRY: Record<string, string> = {
  'ie-dublin': 'Ireland', 'nl-amsterdam': 'Netherlands', 'de-frankfurt': 'Germany',
  'uk-slough': 'United Kingdom', 'fr-paris': 'France', 'se-lulea': 'Sweden',
  'no-oslo': 'Norway', 'sg-singapore': 'Singapore', 'jp-tokyo': 'Japan',
  'in-mumbai': 'India', 'br-sao-paulo': 'Brazil', 'mx-queretaro': 'Mexico',
  'ca-toronto': 'Canada',
}

async function ingestInternationalGenerationMix(regions: RegionsFile): Promise<void> {
  const SOURCE = 'https://owid-public.owid.io/data/energy/owid-energy-data.csv'
  let csv: string
  try {
    console.log('    Fetching OWID energy data...')
    csv = await fetchText(SOURCE)
  } catch (e: any) { console.log(`  ⚠  OWID fetch failed: ${e.message}`); return }

  const lines = csv.split('\n')
  if (lines.length < 2) { console.log('  ⚠  OWID CSV empty'); return }

  const headers     = lines[0].split(',')
  const countryIdx  = headers.indexOf('country')
  const yearIdx     = headers.indexOf('year')
  const renewIdx    = headers.indexOf('renewables_share_elec')
  const lcIdx       = headers.indexOf('low_carbon_share_elec')

  if (countryIdx < 0 || yearIdx < 0) { console.log('  ⚠  OWID: no country/year'); return }

  const best: Record<string, { year: number; ren: number|null; lc: number|null }> = {}
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    const country = c[countryIdx]?.trim()
    const year    = parseInt(c[yearIdx])
    if (!country || isNaN(year)) continue
    const ren = renewIdx >= 0 ? parseFloat(c[renewIdx]) : NaN
    const lc  = lcIdx   >= 0 ? parseFloat(c[lcIdx])    : NaN
    const ex  = best[country]
    if (!ex || year > ex.year)
      best[country] = { year, ren: isNaN(ren)?null:ren/100, lc: isNaN(lc)?null:lc/100 }
  }

  for (const [key, name] of Object.entries(OWID_COUNTRY)) {
    const region = regions[key]
    if (!region) continue
    const d = best[name]
    if (!d) { console.log(`    ⚠  OWID: no row for ${name}`); continue }

    const caveat = key === 'se-lulea' ? `; ${SE_CAVEAT}` : key === 'no-oslo' ? `; ${NO_CAVEAT}` : ''

    if (d.ren !== null)
      write(region, 'renewable_pct', d.ren, null, null, SOURCE, 'modeled',
        `OWID renewables_share_elec; most recent year ${d.year}; country-level figure${caveat}`)
    if (d.lc !== null)
      write(region, 'low_carbon_pct', d.lc, null, null, SOURCE, 'modeled',
        `OWID low_carbon_share_elec; most recent year ${d.year}; country-level figure${caveat}`)
  }
}

// ── 3d. US risk scores — FEMA NRI (ArcGIS mirror) ────────────────────────────
//
// Real column names from inspecting the downloaded file:
//   "State-County FIPS Code"   → county FIPS, pad-start to 5 digits
//   "State FIPS Code"          → 2-digit state FIPS (string)
//   "Population (2020)"        → population weight
//   "National Risk Index - Score - Composite"  → 0–100 composite score (use Score, not Value)
//
// NOTE: US uses FEMA NRI; international uses ThinkHazard. These are different
// frameworks on different scales. The ranking normalises them as if comparable —
// FEMA is far richer for US counties and the trade-off is worth making, but the
// difference must be stated rather than hidden. Caveat in every method string.
const FEMA_CAVEAT =
  'FEMA NRI (US) and ThinkHazard (international) are different frameworks on different scales; ' +
  'normalised into one column — comparability is approximate'

const SUFFIX_TO_FIPS: Record<string, string> = {
  al:'01',ak:'02',az:'04',ar:'05',ca:'06',co:'08',ct:'09',de:'10',
  fl:'12',ga:'13',hi:'15',id:'16',il:'17',in:'18',ia:'19',ks:'20',
  ky:'21',la:'22',me:'23',md:'24',ma:'25',mi:'26',mn:'27',ms:'28',
  mo:'29',mt:'30',ne:'31',nv:'32',nh:'33',nj:'34',nm:'35',ny:'36',
  nc:'37',nd:'38',oh:'39',ok:'40',or:'41',pa:'42',ri:'44',sc:'45',
  sd:'46',tn:'47',tx:'48',ut:'49',vt:'50',va:'51',wa:'53',wv:'54',
  wi:'55',wy:'56',
}

const METRO_COUNTY_FIPS: Record<string, string> = {
  'us-va-northern':      '51107',  // Loudoun County, VA
  'us-tx-dfw':           '48113',  // Dallas County, TX
  'us-az-phoenix':       '04013',  // Maricopa County, AZ
  'us-ga-atlanta':       '13121',  // Fulton County, GA
  'us-oh-columbus':      '39049',  // Franklin County, OH
  'us-il-chicago':       '17031',  // Cook County, IL
  'us-ut-salt-lake-city':'49035',  // Salt Lake County, UT
  'us-tx-san-antonio':   '48029',  // Bexar County, TX
  'us-or-portland':      '41051',  // Multnomah County, OR
  'us-ne-omaha':         '31055',  // Douglas County, NE
  'us-ia-des-moines':    '19153',  // Polk County, IA
  'us-nv-reno':          '32031',  // Washoe County, NV
}

async function ingestUSRiskScores(regions: RegionsFile): Promise<void> {
  const SOURCE = 'https://hub.arcgis.com/api/download/v1/items/39485e8035d446a5bff03259508ae355/csv?redirect=true&layers=0'
  let buf: Buffer
  try { buf = await cachedFetch(SOURCE, 'nri-counties.csv') }
  catch (e: any) { console.log(`  ⚠  FEMA NRI download: ${e.message}`); return }

  const lines = buf.toString('utf-8').split('\n')
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
  console.log(`    NRI first 10 cols: ${headers.slice(0,10).join(' | ')}`)

  // Use exact column names discovered on first run
  const fipsCol = headers.indexOf('State-County FIPS Code')
  const scoreCol= headers.indexOf('National Risk Index - Score - Composite')
  const popCol  = headers.indexOf('Population (2020)')
  const sfipsCol= headers.indexOf('State FIPS Code')

  console.log(`    FIPS=${fipsCol} Score=${scoreCol} Pop=${popCol} StateFIPS=${sfipsCol}`)

  if (fipsCol < 0 || scoreCol < 0) {
    console.log('  ⚠  FEMA NRI: required columns not found; skipping')
    return
  }

  type Row = { fips: string; stateFips: string; score: number; pop: number }
  const rows: Row[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',').map(s => s.replace(/^"|"$/g,'').trim())
    const rawFips  = c[fipsCol] ?? ''
    const score    = parseFloat(c[scoreCol])
    const pop      = popCol >= 0 ? parseFloat(c[popCol]) : 1
    const stateFips = sfipsCol >= 0 ? (c[sfipsCol] ?? '').padStart(2,'0') : rawFips.slice(0,2)
    const fips = rawFips.padStart(5,'0')
    if (!fips || isNaN(score)) continue
    rows.push({ fips, stateFips, score, pop: isNaN(pop)||pop<=0 ? 1 : pop })
  }
  console.log(`    Parsed ${rows.length} FEMA county rows`)

  const byFips = new Map(rows.map(r => [r.fips, r]))

  // NRI Score is 0–100 (composite); rescale to 0–10
  const rescale = (n: number) => Math.round(Math.min(10, n / 10) * 100) / 100

  // States: population-weighted mean
  for (const [suffix, stateFips] of Object.entries(SUFFIX_TO_FIPS)) {
    const key = `us-${suffix}`
    if (!regions[key]) continue
    const counties = rows.filter(r => r.stateFips === stateFips)
    if (counties.length === 0) continue
    const totalPop = counties.reduce((s,c) => s + c.pop, 0)
    const wavg     = counties.reduce((s,c) => s + c.score * c.pop, 0) / totalPop
    write(regions[key], 'risk_score', rescale(wavg), null, null, SOURCE, 'sourced',
      `FEMA NRI Score composite; pop-weighted mean of ${counties.length} counties; rescaled /10; ${FEMA_CAVEAT}`)
  }

  // Metros: single representative county
  for (const [key, fips] of Object.entries(METRO_COUNTY_FIPS)) {
    if (!regions[key]) continue
    const row = byFips.get(fips)
    if (!row) { console.log(`    ⚠  ${key}: county ${fips} not found`); continue }
    write(regions[key], 'risk_score', rescale(row.score), null, null, SOURCE, 'sourced',
      `FEMA NRI Score composite; county FIPS ${fips}; rescaled /10; ${FEMA_CAVEAT}`)
  }
}

// ── 3d. International risk scores — ThinkHazard ───────────────────────────────
//
// Real JSON structure discovered on first run:
//   Direct array: [{hazardtype:{mnemonic:"FL",...}, hazardlevel:{mnemonic:"VLO",...}},...]
//   Keys are "hazardtype" and "hazardlevel" (not nested under "hazards").
//   Level mnemonics: "VLO","LOW","MED","HIG","no-data" (lowercase for no-data).
//   Hazard type mnemonics: 2-letter codes (FL, EQ, TS, CY, WF, EH, UF, CF, etc.)
//   Water scarcity mnemonic: "DG" — exclude from average.

const TH_MNEMONIC_TO_SCORE: Record<string, number> = {
  VLO: 0, LOW: 3.3, MED: 6.7, HIG: 10,
}

// Hazard type 2-letter codes to include (excludes DG=water scarcity)
const TH_INCLUDE = new Set(['EQ','FL','UF','CF','TS','CY','WF','EH'])

const THINKHAZARD_CODES: Record<string, number> = {
  'ie-dublin': 1587, 'nl-amsterdam': 2165, 'de-frankfurt': 1314,
  'uk-slough': 40096, 'fr-paris': 16280, 'se-lulea': 2795,
  'no-oslo': 23413, 'sg-singapore': 2660, 'jp-tokyo': 1690,
  'in-mumbai': 70184, 'br-sao-paulo': 11543, 'mx-queretaro': 20804,
  'ca-toronto': 12686,
}

async function ingestInternationalRiskScores(regions: RegionsFile): Promise<void> {
  for (const [key, code] of Object.entries(THINKHAZARD_CODES)) {
    const region = regions[key]
    if (!region) continue
    const url = `https://www.thinkhazard.org/en/report/${code}.json`
    try {
      const json = await fetchJSON(url)
      // Response is a direct array of hazard objects
      const hazards: any[] = Array.isArray(json) ? json : (json?.hazards ?? json?.data ?? [])

      const scores: number[] = []
      for (const h of hazards) {
        const mnemonic = String(h?.hazardtype?.mnemonic ?? '').toUpperCase()
        const level    = String(h?.hazardlevel?.mnemonic ?? '').toUpperCase()
        if (!TH_INCLUDE.has(mnemonic)) continue          // skip water scarcity etc.
        if (level === 'NO-DATA' || level === 'NO_DATA') continue // null → exclude
        const score = TH_MNEMONIC_TO_SCORE[level]
        if (score !== undefined) scores.push(score)
      }

      if (scores.length === 0) { console.log(`    ⚠  ${key}: no scoreable hazards`); continue }

      const avg = scores.reduce((a,b) => a+b,0) / scores.length
      write(region, 'risk_score', Math.round(avg*100)/100, null, null, url, 'modeled',
        `ThinkHazard mean of ${scores.length} hazards (EQ FL UF CF TS CY WF EH); ` +
        `VLO=0 LOW=3.3 MED=6.7 HIG=10; no-data excluded; ${FEMA_CAVEAT}`)
    } catch (e: any) {
      console.log(`    ⚠  ${key} ThinkHazard: ${e.message}`)
    }
  }
}

// ── 3e. US staff costs — BLS OES May 2025 ─────────────────────────────────────
//
// Real structure discovered on first run:
//   ZIP entry: oesm25st/state_M2025_dl.xlsx
//   Columns: AREA, AREA_TITLE, PRIM_STATE, OCC_CODE, OCC_TITLE, A_MEAN, ...
//   PRIM_STATE is the 2-letter postal code for filtering.
//
// International: left null — only 1-digit ISCO major groups available, no
// city-level occupation code source exists. Will be filled manually.

const BLS_SOC = ['15-1244', '47-2111', '49-9071']

async function ingestUSStaffCosts(regions: RegionsFile): Promise<void> {
  const SOURCE = 'https://www.bls.gov/oes/special-requests/oesm25st.zip'
  let zipBuf: Buffer
  try { zipBuf = await cachedFetch(SOURCE, 'oesm25st.zip') }
  catch (e: any) { console.log(`  ⚠  BLS state OES download: ${e.message}`); return }

  let rows: any[]
  try {
    const zip   = new AdmZip(zipBuf)
    // Actual entry is "oesm25st/state_M2025_dl.xlsx"
    const entry = zip.getEntries().find(e =>
      e.entryName.endsWith('.xlsx') || e.entryName.endsWith('.xls')
    )
    if (!entry) {
      console.log(`    ⚠  BLS ZIP: no xlsx entry; entries: ${zip.getEntries().map(e=>e.entryName).join(', ')}`)
      return
    }
    console.log(`    BLS entry: ${entry.entryName}`)
    const wb = XLSX.read(entry.getData(), { type: 'buffer' })
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
  } catch (e: any) { console.log(`  ⚠  BLS parse: ${e.message}`); return }

  if (!rows.length) { console.log('  ⚠  BLS: empty sheet'); return }
  console.log(`    BLS columns: ${Object.keys(rows[0]).join(', ')}`)

  // Build state → SOC → annual mean wage
  const stateWages: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const soc   = String(r['OCC_CODE'] ?? '').trim()
    const state = String(r['PRIM_STATE'] ?? '').trim().toUpperCase()
    const wage  = parseFloat(String(r['A_MEAN'] ?? '').replace(/[^0-9.]/g,''))
    if (!BLS_SOC.includes(soc) || !state || isNaN(wage)) continue
    if (!stateWages[state]) stateWages[state] = {}
    stateWages[state][soc] = wage
  }

  // National mean per SOC (average across states present)
  const natWages: Record<string, number[]> = {}
  for (const sd of Object.values(stateWages))
    for (const [soc, w] of Object.entries(sd)) {
      if (!natWages[soc]) natWages[soc] = []
      natWages[soc].push(w)
    }
  const natMeans = Object.fromEntries(
    Object.entries(natWages).map(([soc, ws]) => [soc, ws.reduce((a,b)=>a+b,0)/ws.length])
  )
  const natAvg = Object.values(natMeans).reduce((a,b)=>a+b,0) / Math.max(1, Object.values(natMeans).length)
  console.log(`    BLS national avg wage (mean of 3 SOC means): $${Math.round(natAvg)}`)

  for (const [suffix, eiaCode] of Object.entries(STATE_SUFFIX_TO_EIA)) {
    const key = `us-${suffix}`
    if (!regions[key]) continue
    const sd = stateWages[eiaCode]
    if (!sd) continue
    const present = BLS_SOC.filter(s => sd[s] !== undefined)
    if (!present.length) continue
    const meanWage = present.reduce((s,soc)=>s+sd[soc],0) / present.length
    const index    = meanWage / natAvg
    const missing  = BLS_SOC.filter(s => !present.includes(s))
    const note     = missing.length ? `; SOC ${missing.join(',')} absent from state file` : ''
    write(regions[key], 'staff_cost_index', Math.round(index*1000)/1000, null, null, SOURCE, 'sourced',
      `mean annual wage for SOC ${present.join(',')} indexed to national avg 1.00${note}`)
  }

  // Metros: inherit parent state
  for (const [key, region] of Object.entries(regions)) {
    if (region.precision !== 'metro' || !key.startsWith('us-') || !region.parent_state) continue
    const parent = regions[region.parent_state]
    if (!parent || parent.staff_cost_index.value === null) continue
    write(region, 'staff_cost_index', parent.staff_cost_index.value, null, null, SOURCE, 'modeled',
      `state-level index; metro OES available but state used for consistency; ${parent.staff_cost_index.method ?? ''}`)
  }
}

// ── 3f. US grid interconnection — LBNL queue data ────────────────────────────
//
// Real structure discovered on first run:
//   Sheet: "03. Complete Queue Data"
//   Headers in row 0: q_id, q_status, q_date, prop_date, on_date, wd_date, ia_date,
//                     IA_phase_raw, IA_phase_clean, county, state, fips_code, poi_name,
//                     region, project_name, utility, entity, developer, cluster,
//                     service, project_type, type_1, type_2, type_3, type_clean,
//                     mw_1, mw_2, mw_3, q_year, ...
//   q_date and on_date are Excel date serials.
//   "region" is the ISO/RTO name.
//
// NOTE: GENERATOR interconnection queue, not load. They correlate (both reflect
// transmission scarcity) but are different measurements. Stated in every method string.
const LBNL_CAVEAT =
  'generator interconnection queue duration used as proxy for load connection wait; ' +
  'LBNL does not publish load queue data'

// State → primary ISO/RTO (Texas uses ERCOT as simplification)
const STATE_TO_ISO: Record<string, string> = {
  ct:'ISO-NE',ma:'ISO-NE',me:'ISO-NE',nh:'ISO-NE',ri:'ISO-NE',vt:'ISO-NE',
  ny:'NYISO',
  nj:'PJM',pa:'PJM',md:'PJM',de:'PJM',va:'PJM',wv:'PJM',oh:'PJM',in:'PJM',mi:'PJM',
  il:'MISO',wi:'MISO',mn:'MISO',ia:'MISO',mo:'MISO',nd:'MISO',sd:'MISO',
  mt:'MISO',ky:'MISO',ar:'MISO',ms:'MISO',la:'MISO',
  tx:'ERCOT',  // NOTE: TX also covers SPP+MISO; ERCOT used as simplification
  ks:'SPP',ok:'SPP',ne:'SPP',
  ca:'CAISO',
  or:'WECC',wa:'WECC',id:'WECC',nv:'WECC',az:'WECC',ut:'WECC',co:'WECC',nm:'WECC',wy:'WECC',
  // HI, AK: no ISO; leave null
}

async function ingestUSGridInterconnection(regions: RegionsFile): Promise<void> {
  const SOURCE = 'https://emp.lbl.gov/sites/default/files/2026-05/LBNL_Ix_Queue_Data_File_thru2025.xlsx'
  let buf: Buffer
  try { buf = await cachedFetch(SOURCE, 'LBNL_Ix_Queue_Data_File_thru2025.xlsx') }
  catch (e: any) { console.log(`  ⚠  LBNL download: ${e.message}`); return }

  let wb: any
  try { wb = XLSX.read(buf, { type: 'buffer', sheets: '03. Complete Queue Data' }) }
  catch (e: any) { console.log(`  ⚠  LBNL parse: ${e.message}`); return }

  const ws = wb.Sheets['03. Complete Queue Data']
  if (!ws) { console.log('  ⚠  LBNL: sheet "03. Complete Queue Data" not found'); return }

  // Parse with header:1 to get raw arrays.
  // Row 0 is the sheet title "RETURN TO CONTENTS"; row 1 is the real header.
  const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 })
  if (rawRows.length < 3) { console.log('  ⚠  LBNL: empty sheet'); return }

  const headers: string[] = rawRows[1].map((h: any) => String(h ?? '').trim())
  console.log(`    LBNL cols (first 20): ${headers.slice(0,20).join(', ')}`)

  const qDateIdx  = headers.indexOf('q_date')
  const onDateIdx = headers.indexOf('on_date')
  const regionIdx = headers.indexOf('region')
  const statusIdx = headers.indexOf('q_status')

  console.log(`    q_date=${qDateIdx} on_date=${onDateIdx} region=${regionIdx} status=${statusIdx}`)

  if (qDateIdx < 0 || onDateIdx < 0 || regionIdx < 0) {
    console.log('  ⚠  LBNL: required columns not found'); return
  }

  // Accumulate durations by ISO/RTO
  const isoYears: Record<string, number[]> = {}

  for (let i = 2; i < rawRows.length; i++) {
    const row = rawRows[i]
    const iso   = String(row[regionIdx] ?? '').trim().toUpperCase()
    const qRaw  = row[qDateIdx]
    const onRaw = row[onDateIdx]
    if (!iso || qRaw == null || onRaw == null) continue

    // Parse XLSX date serials (numbers) or string dates.
    // Excel serial = days since 1899-12-30 (epoch 25569 = 1970-01-01).
    let qYear: number | null = null
    let onYear: number | null = null

    const serialToFracYear = (serial: number): number => {
      const ms = (serial - 25569) * 86400 * 1000
      const d  = new Date(ms)
      return d.getUTCFullYear() + d.getUTCMonth() / 12
    }

    if (typeof qRaw === 'number' && typeof onRaw === 'number') {
      qYear  = serialToFracYear(qRaw)
      onYear = serialToFracYear(onRaw)
    } else {
      const qd  = new Date(String(qRaw))
      const ond = new Date(String(onRaw))
      if (!isNaN(qd.getTime()) && !isNaN(ond.getTime())) {
        qYear  = qd.getFullYear()  + qd.getMonth()  / 12
        onYear = ond.getFullYear() + ond.getMonth() / 12
      }
    }

    if (qYear === null || onYear === null) continue
    const years = onYear - qYear
    if (years <= 0 || years > 20) continue  // sanity filter

    if (!isoYears[iso]) isoYears[iso] = []
    isoYears[iso].push(years)
  }

  // Compute medians
  const isoMedian: Record<string, number> = {}
  for (const [iso, vals] of Object.entries(isoYears)) {
    vals.sort((a,b) => a-b)
    const mid = Math.floor(vals.length / 2)
    isoMedian[iso] = vals.length % 2 === 0 ? (vals[mid-1]+vals[mid])/2 : vals[mid]
  }
  console.log(`    LBNL medians: ${Object.entries(isoMedian).map(([k,v])=>`${k}=${v.toFixed(1)}y`).join(' ')}`)

  for (const [suffix] of Object.entries(STATE_SUFFIX_TO_EIA)) {
    const key = `us-${suffix}`
    if (!regions[key]) continue
    const isoKey = STATE_TO_ISO[suffix]
    if (!isoKey) continue

    // Fuzzy match ISO name (LBNL uses full names like "ISO-NE", "MISO", "ERCOT")
    const matchKey = Object.keys(isoMedian).find(k =>
      k.includes(isoKey) || isoKey.includes(k) ||
      k.replace(/[-\s]/g,'').includes(isoKey.replace(/[-\s]/g,''))
    )
    const median = matchKey != null ? isoMedian[matchKey] : null

    const txNote = suffix === 'tx' ? '; TX spans ERCOT/SPP/MISO; ERCOT used as simplification' : ''
    write(regions[key], 'grid_interconnection_years',
      median != null ? Math.round(median*10)/10 : null,
      null, null, SOURCE, 'modeled',
      `${LBNL_CAVEAT}; ${isoKey} median queue duration${txNote}`)
  }

  // Metros: inherit parent state
  for (const [key, region] of Object.entries(regions)) {
    if (region.precision !== 'metro' || !key.startsWith('us-') || !region.parent_state) continue
    const parent = regions[region.parent_state]
    if (!parent || parent.grid_interconnection_years.value === null) continue
    write(region, 'grid_interconnection_years',
      parent.grid_interconnection_years.value, null, null, SOURCE, 'modeled',
      `inherited from ${region.parent_state}; ${LBNL_CAVEAT}`)
  }
}

// ── 3g. Latency — computed from PeeringDB IXP coordinates + calibration ───────
//
// Calibration source: Azure inter-region median RTT table
//   https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/refs/heads/main/articles/networking/azure-network-latency.md
// Fitted slopes:
//   intra-continental: 1.4 ms / 100 km round-trip + 1.0 ms intercept
//   trans-oceanic:     3.2 ms / 100 km round-trip + 8.0 ms intercept
// (Real figure is ~1.4 ms/100 km, meaningfully worse than the common 1 ms/100 km
// rule which assumes a straight path that does not exist.)
//
// IXP coordinates: derived from PeeringDB (join ix → ixfac → fac for lat/lon).
// Major IXPs are hardcoded below for stability (PeeringDB is the authoritative source;
// these were queried on 2026-07-27 filtering by net_count ≥ 100).
//
// Do NOT use Azure Sweden Central as a proxy for Luleå: it is in Gävle (~700 km south).
// Luleå's whole trade-off is cheap hydro at the cost of distance from peering, and
// the model must show that penalty rather than hide it.
//
// Floor of 0.3 ms applied where the site is itself inside a major IXP metro.
const IXP_FLOOR_METROS = new Set([
  'us-va-northern', 'us-tx-dfw', 'us-il-chicago', 'us-ga-atlanta', 'us-az-phoenix'
])

// Major IXPs with coordinates (PeeringDB-derived, stable set)
const MAJOR_IXP = [
  { name: 'Equinix Ashburn (DC)',  lat: 38.9, lon: -77.5,  cont: 'NA' },
  { name: 'DE-CIX Frankfurt',     lat: 50.1, lon:  8.7,   cont: 'EU' },
  { name: 'AMS-IX Amsterdam',     lat: 52.4, lon:  4.9,   cont: 'EU' },
  { name: 'LINX London',          lat: 51.5, lon: -0.1,   cont: 'EU' },
  { name: 'SFINX Paris',          lat: 48.9, lon:  2.3,   cont: 'EU' },
  { name: 'Equinix Dallas',       lat: 32.8, lon: -96.8,  cont: 'NA' },
  { name: 'Any2 Los Angeles',     lat: 34.0, lon:-118.2,  cont: 'NA' },
  { name: 'Equinix Atlanta',      lat: 33.7, lon: -84.4,  cont: 'NA' },
  { name: 'Equinix Chicago',      lat: 41.9, lon: -87.6,  cont: 'NA' },
  { name: 'TORIX Toronto',        lat: 43.6, lon: -79.4,  cont: 'NA' },
  { name: 'SGIX Singapore',       lat:  1.3, lon: 103.8,  cont: 'AS' },
  { name: 'JPIX Tokyo',           lat: 35.7, lon: 139.7,  cont: 'AS' },
  { name: 'NETNOD Stockholm',     lat: 59.3, lon:  18.1,  cont: 'EU' },
  { name: 'NIX Oslo',             lat: 59.9, lon:  10.7,  cont: 'EU' },
  { name: 'IX.br São Paulo',      lat:-23.5, lon: -46.6,  cont: 'SA' },
  { name: 'DE-CIX Mumbai',        lat: 19.1, lon:  72.9,  cont: 'AS' },
  { name: 'MEX-IX Mexico City',   lat: 19.4, lon: -99.1,  cont: 'NA' },
]

// Representative coords for all our regions
const REGION_COORDS: Record<string, [number, number]> = {
  'us-va-northern':      [ 38.89, -77.49],
  'us-tx-ercot':         [ 30.20, -97.90],
  'eu-nordic-hydro':     [ 65.58,  22.15],   // Luleå, NOT Stockholm/Gävle
  'us-az-phoenix':       [ 33.45,-112.07],
  'us-tx-san-antonio':   [ 29.43, -98.49],
  'us-or-portland':      [ 45.52,-122.68],
  'us-oh-columbus':      [ 39.96, -82.99],
  'us-ga-atlanta':       [ 33.75, -84.39],
  'us-tx-dfw':           [ 32.78, -96.82],
  'us-il-chicago':       [ 41.88, -87.63],
  'us-ut-salt-lake-city':[ 40.76,-111.89],
  'us-ne-omaha':         [ 41.26, -95.94],
  'us-ia-des-moines':    [ 41.60, -93.62],
  'us-nv-reno':          [ 39.53,-119.81],
  'ie-dublin':           [ 53.33,  -6.25],
  'nl-amsterdam':        [ 52.37,   4.90],
  'de-frankfurt':        [ 50.11,   8.68],
  'uk-slough':           [ 51.51,  -0.60],
  'fr-paris':            [ 48.86,   2.35],
  'se-lulea':            [ 65.58,  22.15],   // same as eu-nordic-hydro
  'no-oslo':             [ 59.91,  10.75],
  'sg-singapore':        [  1.35, 103.82],
  'jp-tokyo':            [ 35.69, 139.69],
  'in-mumbai':           [ 19.08,  72.88],
  'br-sao-paulo':        [-23.55, -46.63],
  'mx-queretaro':        [ 20.59,-100.39],
  'ca-toronto':          [ 43.65, -79.38],
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function siteContinentFromCoords(lon: number, lat: number): string {
  if (lon >= -30 && lon <= 65  && lat >= 35) return 'EU'
  if (lon >= 65  && lon <= 180)              return 'AS'
  if (lat < -10)                             return 'SA'
  return 'NA'
}

async function ingestComputedLatency(regions: RegionsFile): Promise<void> {
  const SOURCE = 'https://www.peeringdb.com/api/'

  for (const [key, region] of Object.entries(regions)) {
    const coords = REGION_COORDS[key]
    if (!coords) continue
    const [lat, lon] = coords

    // Floor for major IXP metros
    if (IXP_FLOOR_METROS.has(key)) {
      write(region, 'latency_ms_to_hub', 0.3, null, null, SOURCE, 'modeled',
        'site is in a major IXP metro; floor of 0.3 ms applied; ' +
        'calibrated from Azure inter-region RTT; not Ookla/Cloudflare (consumer last-mile)')
      continue
    }

    // Find nearest IXP
    let minDist = Infinity, nearestIXP = MAJOR_IXP[0]
    for (const ixp of MAJOR_IXP) {
      const d = haversineKm(lat, lon, ixp.lat, ixp.lon)
      if (d < minDist) { minDist = d; nearestIXP = ixp }
    }

    const siteCont = siteContinentFromCoords(lon, lat)
    const transOceanic = siteCont !== nearestIXP.cont

    // Intra: 1.4 ms/100 km + 1 ms; trans: 3.2 ms/100 km + 8 ms
    const raw = transOceanic
      ? 8.0 + (3.2 / 100) * minDist
      : 1.0 + (1.4 / 100) * minDist
    const latency = Math.round(Math.max(0.3, raw) * 10) / 10

    write(region, 'latency_ms_to_hub', latency, null, null, SOURCE, 'modeled',
      `great-circle to nearest major IXP (${nearestIXP.name}, ${Math.round(minDist)} km); ` +
      `${transOceanic ? 'trans-oceanic 3.2ms/100km+8ms' : 'intra-continental 1.4ms/100km+1ms'}; ` +
      `calibrated from Azure inter-region RTT; not Ookla/Cloudflare/M-Lab (consumer last-mile)`)
  }
}

// ── Null counter ──────────────────────────────────────────────────────────────

function countNulls(regions: RegionsFile): number {
  const DRIVERS: Array<keyof Region> = [
    'power_rate_usd_per_kwh','water_rate_usd_per_kgal','land_cost_per_acre_usd',
    'construction_cost_per_kw','staff_cost_index','tax_rate','risk_score',
    'renewable_pct','low_carbon_pct','latency_ms_to_hub','grid_interconnection_years',
  ]
  let n = 0
  for (const r of Object.values(regions))
    for (const f of DRIVERS) if ((r[f] as DriverValue).value === null) n++
  return n
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== BOB-datacenter data ingest ===\n')

  const regions    = loadRegions()
  const nullBefore = countNulls(regions)

  console.log('\n[3a] US power rates (EIA)')
  await ingestUSPowerRates(regions)

  console.log('\n[3b] US generation mix (EIA bulk XLS)')
  await ingestUSGenerationMix(regions)

  console.log('\n[3c] International power rates (Eurostat)')
  await ingestInternationalPowerRates(regions)

  console.log('\n[3c] International generation mix (OWID)')
  await ingestInternationalGenerationMix(regions)

  console.log('\n[3d] US risk scores (FEMA NRI via ArcGIS)')
  await ingestUSRiskScores(regions)

  console.log('\n[3d] International risk scores (ThinkHazard)')
  await ingestInternationalRiskScores(regions)

  console.log('\n[3e] US staff costs (BLS OES May 2025)')
  await ingestUSStaffCosts(regions)
  console.log('\n[3e] International staff costs: left null — no city-level SOC source exists')

  console.log('\n[3f] US grid interconnection years (LBNL)')
  await ingestUSGridInterconnection(regions)
  console.log('\n[3f] International grid interconnection: left null — on manual list')

  console.log('\n[3g] Latency (PeeringDB coordinates + calibration)')
  await ingestComputedLatency(regions)

  saveRegions(regions)

  const nullAfter  = countNulls(regions)
  const total      = Object.keys(regions).length * 11

  console.log('\n=== Summary ===')
  console.log(`  Regions:        ${Object.keys(regions).length}`)
  console.log(`  Driver slots:   ${total}  (${Object.keys(regions).length} regions × 11 drivers)`)
  console.log(`  Written:        ${written}`)
  console.log(`  Skipped:        ${skipped}  (already sourced from elsewhere — not overwritten)`)
  console.log(`  Nulls before:   ${nullBefore}`)
  console.log(`  Nulls after:    ${nullAfter}`)
  console.log(`  Nulls filled:   ${nullBefore - nullAfter}`)
}

main().catch(err => {
  console.error('\n❌ Ingest failed:', err.message ?? err)
  process.exit(1)
})
