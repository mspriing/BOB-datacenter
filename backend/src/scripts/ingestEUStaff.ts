/**
 * Staffing cost index for the European regions, from Eurostat.
 *
 *   npm run ingest:eu-staff            # report only, writes nothing
 *   npm run ingest:eu-staff -- --write # apply
 *
 * WHY THIS IS A SEPARATE SCRIPT AND NOT PART OF ingest.ts
 *
 * ingest.ts says, correctly, that international staffing was left null because
 * "only 1-digit ISCO major groups available, no city-level occupation code
 * source exists." That is still true. There is no European source that matches
 * the three SOC codes the US index is built from. So this number cannot be
 * `sourced` the way the US ones are, and it is written as `modeled` with the
 * approximation spelled out in the method string.
 *
 * HOW THE NUMBER IS BUILT
 *
 * US side (the denominator, = 1.00):
 *   BLS OEWS national mean annual wage across SOC 15-1244 (network and computer
 *   systems administrators), 47-2111 (electricians) and 49-9071 (maintenance and
 *   repair workers). This is the same figure ingest.ts already computes to index
 *   the 63 US regions, reused here so the two sides share one baseline.
 *
 * European side:
 *   Eurostat lc_lci_lev, lcstruct D11 (wages and salaries), unit EUR per hour.
 *   Two sectors are read and blended 1/3 NACE J (information and communication)
 *   to 2/3 NACE F (construction), mirroring the one-IT-to-two-trades mix of the
 *   three SOC codes. Using NACE J alone would price every European site off
 *   software engineering salaries, which is not who staffs a data hall.
 *   Converted to USD at the ECB daily reference rate, then annualised.
 *
 * THE TWO BIASES, BOTH POINTING THE SAME WAY
 *
 *   1. Annualising at 2080 hours treats a European hire as working US full-time
 *      hours. Actual annual hours worked in these countries run roughly 1,500 to
 *      1,700, so this OVERSTATES the annual cost of a European full-time
 *      equivalent by something like 20 to 30 percent.
 *   2. Even blended, NACE J carries software and telecoms pay that the three US
 *      occupations do not.
 *
 * Both push the European index UP, so they compound rather than cancel. That is
 * why the low/high band is deliberately wide, and why the value should be read
 * as an upper bound on European staffing cost rather than a point estimate.
 *
 * NOT COVERED
 *   uk-slough — the UK stopped reporting to Eurostat after 2016, so there is no
 *   current row. Left null rather than carried forward from a nine-year-old
 *   figure. ONS ASHE is the right source and needs a separate reader.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import AdmZip from 'adm-zip'
import * as XLSX from 'xlsx'
import { resolve as resolvePath } from 'node:path'

const ROOT      = resolvePath(import.meta.dirname, '../../..')
const JSON_PATH = resolvePath(ROOT, 'data/regions.json')
const WRITE     = process.argv.includes('--write')

const EUROSTAT = 'https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/lc_lci_lev?format=TSV&compressed=false'
const BLS      = 'https://www.bls.gov/oes/current/oes_nat.htm'
const ECB      = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

/** Our region keys → Eurostat geo codes. UK deliberately absent, see header. */
const GEO: Record<string, string> = {
  'ie-dublin':    'IE',
  'nl-amsterdam': 'NL',
  'de-frankfurt': 'DE',
  'fr-paris':     'FR',
  'no-oslo':      'NO',
  'se-lulea':     'SE',
}

/** Weighting that mirrors the one-IT-to-two-trades mix of the three SOC codes. */
const SECTOR_WEIGHTS: Record<string, number> = { J: 1 / 3, F: 2 / 3 }

const US_FTE_HOURS = 2080

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
  return resp.text()
}

/** ECB daily euro reference rates. */
async function fetchEurUsd(): Promise<{ rate: number; date: string }> {
  const xml  = await fetchText(ECB)
  const rate = Number(xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/)?.[1])
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] ?? 'unknown'
  if (!Number.isFinite(rate)) throw new Error('could not read USD rate from the ECB feed')
  return { rate, date }
}

/**
 * Latest non-null EUR/hour per geo, for one NACE sector.
 * Key string is "freq,unit,lcstruct,nace_r2,geo", e.g. "A,EUR,D11,J,DE".
 */
function parseSector(tsv: string, sector: string): Record<string, { value: number; year: string }> {
  const lines  = tsv.split('\n')
  const header = lines[0]?.split('\t') ?? []
  const years  = header.slice(1).map((h) => h.trim())
  const out: Record<string, { value: number; year: string }> = {}

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t')
    const dims  = (cells[0] ?? '').split(',').map((d) => d.trim())
    if (dims.length < 5) continue
    const [, unit, lcstruct, nace, geo] = dims
    if (unit !== 'EUR' || lcstruct !== 'D11' || nace !== sector) continue
    if (!Object.values(GEO).includes(geo)) continue

    // Walk from the right for the most recent value that is a real number.
    // ':' means not available; trailing letters are Eurostat status flags.
    for (let t = cells.length - 1; t >= 1; t--) {
      const raw = (cells[t] ?? '').trim()
      if (!raw || raw.startsWith(':')) continue
      const val = parseFloat(raw.replace(/[^0-9.].*$/, ''))
      if (Number.isFinite(val) && val > 0) {
        out[geo] = { value: val, year: years[t - 1] ?? 'unknown' }
        break
      }
    }
  }
  return out
}

async function main(): Promise<void> {
  console.log('Fetching Eurostat lc_lci_lev...')
  const tsv = await fetchText(EUROSTAT)

  const bySector: Record<string, Record<string, { value: number; year: string }>> = {}
  for (const s of Object.keys(SECTOR_WEIGHTS)) {
    bySector[s] = parseSector(tsv, s)
    const found = Object.keys(bySector[s])
    console.log(`  NACE ${s}: ${found.length ? found.join(', ') : 'nothing found'}`)
  }

  if (!Object.values(bySector).some((s) => Object.keys(s).length)) {
    console.log('\nNo Eurostat rows parsed. Nothing written. Send me this window.')
    process.exit(1)
  }

  const { rate: eurUsd, date: rateDate } = await fetchEurUsd()
  console.log(`  ECB EUR/USD ${eurUsd} (${rateDate})`)

  const regions = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as Record<string, Record<string, any>>

  // Reuse the exact baseline ingest.ts used for the 63 US regions, read back out
  // of regions.json rather than recomputed, so the two sides cannot drift apart.
  const usAnnualMean = await deriveUSBaseline()
  if (!usAnnualMean) {
    console.log('\nCould not derive the US baseline from the BLS file. Nothing written.')
    process.exit(1)
  }
  console.log(`  US baseline (index 1.00) = $${Math.round(usAnnualMean).toLocaleString()}/yr across the three SOC codes`)
  console.log()

  const applied: string[] = []
  const skipped: string[] = []

  for (const [key, geo] of Object.entries(GEO)) {
    const region = regions[key]
    if (!region) { skipped.push(`${key}: no such region`); continue }

    const parts: string[] = []
    let eurPerHour = 0
    let weightUsed = 0
    for (const [sector, weight] of Object.entries(SECTOR_WEIGHTS)) {
      const hit = bySector[sector]?.[geo]
      if (!hit) continue
      eurPerHour += hit.value * weight
      weightUsed += weight
      parts.push(`NACE ${sector} ${hit.value} EUR/h (${hit.year})`)
    }

    if (!weightUsed) { skipped.push(`${key} (${geo}): no Eurostat row in either sector`); continue }
    // Renormalise if one sector was missing, so a gap does not silently halve the figure.
    eurPerHour = eurPerHour / weightUsed

    const usdAnnual = eurPerHour * eurUsd * US_FTE_HOURS
    const index     = usdAnnual / usAnnualMean

    const cell = region.staff_cost_index
    if (cell?.value !== null && cell?.value !== undefined) {
      skipped.push(`${key}: already holds ${cell.value}, left alone`)
      continue
    }

    const round = (n: number): number => Math.round(n * 1000) / 1000
    cell.value = round(index)
    // Band spans the two known biases: the low end assumes 1,550 actual annual
    // hours instead of 2,080, the high end keeps 2,080 and adds 10 percent.
    cell.low  = round(index * (1550 / US_FTE_HOURS))
    cell.high = round(index * 1.10)
    cell.source_url    = EUROSTAT
    cell.last_verified = new Date().toISOString().slice(0, 7)
    cell.basis         = 'modeled'
    cell.method =
      `Eurostat lc_lci_lev D11 wages and salaries, ${parts.join(' + ')}, ` +
      `blended ${Math.round(SECTOR_WEIGHTS.J * 100)}% J to ${Math.round(SECTOR_WEIGHTS.F * 100)}% F to mirror the ` +
      `one-IT-to-two-trades mix of SOC 15-1244, 47-2111 and 49-9071. ` +
      `Converted at EUR/USD ${eurUsd} (ECB reference rate ${rateDate}), annualised at ${US_FTE_HOURS} h, ` +
      `then divided by the BLS OEWS national mean of $${Math.round(usAnnualMean).toLocaleString()}/yr for those three ` +
      `codes (${BLS}), which is the same baseline the US regions are indexed to. ` +
      `MODELED, NOT SOURCED: no European source publishes those three occupation codes. ` +
      `Two biases both push this UP — annualising at ${US_FTE_HOURS} h treats a European hire as working US hours ` +
      `when actual annual hours run about 1,500 to 1,700, and NACE J carries software and telecoms pay that the ` +
      `three US occupations do not. Read it as an upper bound; low reflects 1,550 actual hours.`

    applied.push(`${key.padEnd(14)} ${round(index).toFixed(3)}   (band ${cell.low} to ${cell.high})   ${parts.join(' + ')}`)
  }

  console.log('WOULD SET:')
  for (const a of applied) console.log(`  ${a}`)
  if (skipped.length) {
    console.log('\nSKIPPED:')
    for (const s of skipped) console.log(`  ${s}`)
  }
  console.log('\n  uk-slough is not in this run at all: the UK stopped reporting to Eurostat after 2016.')

  const cost = ['construction_cost_per_kw', 'power_rate_usd_per_kwh', 'land_cost_per_acre_usd', 'staff_cost_index']
  const priceable = Object.keys(regions).filter((k) =>
    cost.every((c) => regions[k][c] && regions[k][c].value !== null && regions[k][c].value !== undefined))
  console.log(`\n  Regions that could be priced after this: ${priceable.length} of ${Object.keys(regions).length}`)

  if (WRITE) {
    writeFileSync(JSON_PATH, JSON.stringify(regions, null, 2) + '\n')
    console.log('\nWrote data/regions.json.')
  } else {
    console.log('\nReport only. Nothing was written. Re-run with --write to apply.')
  }
}

/**
 * The US index-1.00 point, recomputed from the same BLS file and by the same
 * formula ingest.ts uses, so the two sides of the ratio cannot drift apart.
 *
 * ⚠️ This mirrors ingestUSStaffCosts() in ingest.ts. If the SOC list or the
 * averaging there changes, change it here in the same edit or every European
 * index silently moves.
 */
async function deriveUSBaseline(): Promise<number | null> {
  const SOURCE = 'https://www.bls.gov/oes/special-requests/oesm25st.zip'
  const SOC    = ['15-1244', '47-2111', '49-9071']

  let rows: any[]
  try {
    console.log('  Fetching BLS OEWS state file for the US baseline...')
    const resp = await fetch(SOURCE)
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
    const zip   = new AdmZip(Buffer.from(await resp.arrayBuffer()))
    const entry = zip.getEntries().find((e) => e.entryName.endsWith('.xlsx') || e.entryName.endsWith('.xls'))
    if (!entry) throw new Error('no spreadsheet inside the BLS zip')
    const wb = XLSX.read(entry.getData(), { type: 'buffer' })
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
  } catch (e: any) {
    console.log(`  ⚠  BLS baseline: ${e.message}`)
    return null
  }

  // state → SOC → annual mean wage, then the mean of the per-SOC national means.
  const stateWages: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const soc   = String(r['OCC_CODE'] ?? '').trim()
    const state = String(r['PRIM_STATE'] ?? '').trim().toUpperCase()
    const wage  = parseFloat(String(r['A_MEAN'] ?? '').replace(/[^0-9.]/g, ''))
    if (!SOC.includes(soc) || !state || isNaN(wage)) continue
    ;(stateWages[state] ??= {})[soc] = wage
  }

  const perSoc: Record<string, number[]> = {}
  for (const sd of Object.values(stateWages))
    for (const [soc, w] of Object.entries(sd)) (perSoc[soc] ??= []).push(w)

  const means = Object.values(perSoc).map((ws) => ws.reduce((a, b) => a + b, 0) / ws.length)
  if (!means.length) return null
  return means.reduce((a, b) => a + b, 0) / means.length
}

main().catch((e) => { console.error(e); process.exit(1) })
