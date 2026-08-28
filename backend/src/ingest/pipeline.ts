#!/usr/bin/env tsx
/**
 * backend/src/ingest/pipeline.ts
 *
 * Parcel ingest pipeline for the LEEPR data-center site-selection tool.
 * Takes a CountyConfig and produces:
 *   data/parcels/<county>.geojson   — FeatureCollection for the map
 *   data/parcels/<county>.rows.json — flat array for the repository
 *   data/parcels/<county>.meta.json — provenance and coverage metadata
 *
 * Run via: npm run ingest:parcels
 *
 * Re-runnable: raw pages are cached under data/raw/<county>/;
 * output is deterministic given the same cache (sorted by parcel_id,
 * coordinates rounded to 6dp, monetary values to whole dollars).
 *
 * INVARIANT: this file contains no county literals.  All county-specific
 * values (endpoints, thresholds, field names, tariffs, state codes) come
 * from the CountyConfig passed to runIngest().
 *
 * See docs/work-orders/07-parcel-ingest-repair.md for rationale.
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as turf from '@turf/turf'
import Flatbush from 'flatbush'
import type { CountyConfig } from './countyConfig.js'
import type { ParcelRow } from '../parcel/repository.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const ROOT       = resolve(__dirname, '../../..')   // backend/src/ingest → repo root
const DATA_DIR   = resolve(ROOT, 'data')

// ── Logging helpers ────────────────────────────────────────────────────────────

function log(msg: string)  { console.log(`  ${msg}`) }
function warn(msg: string) { console.warn(`  ⚠  ${msg}`) }

// ── GeoJSON types (minimal) ────────────────────────────────────────────────────

interface Polygon     { type: 'Polygon';     coordinates: number[][][] }
interface MultiPolygon{ type: 'MultiPolygon'; coordinates: number[][][][] }
type Geometry = Polygon | MultiPolygon | null

interface Feature {
  type: 'Feature'
  geometry: Geometry
  properties: Record<string, unknown>
}

interface FeatureCollection {
  type: 'FeatureCollection'
  features: Feature[]
}

// ── Driver-value shape (same as data/regions.json) ────────────────────────────

interface DriverValue {
  value:         number | null
  low?:          number | null
  high?:         number | null
  basis:         'sourced' | 'modeled' | 'assumed'
  source_url:    string
  last_verified: string
  method?:       string
}

// ── ArcGIS paged fetch ────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.json()
}

interface ArcGISResponse {
  features?:              Array<{ geometry: unknown; attributes: Record<string, unknown> }>
  exceededTransferLimit?: boolean
  error?:                 { message: string }
  name?:                  string   // layer descriptor field
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Cache-aware fetch. An ArcGIS error body is never written to the cache and a
 * cached error is never replayed: these services fail intermittently, and
 * caching a transient failure turns one bad minute into a permanently broken
 * pipeline that no amount of re-running can fix.
 */
async function cachedFetchJSON(rawDir: string, url: string, filename: string): Promise<unknown> {
  mkdirSync(rawDir, { recursive: true })
  const p = resolve(rawDir, filename)
  if (existsSync(p)) {
    const cached = JSON.parse(readFileSync(p, 'utf-8'))
    if (!(cached && typeof cached === 'object' && 'error' in cached)) {
      log(`[cache] ${filename}`)
      return cached
    }
    log(`[cache] ${filename} held an error response — refetching`)
  }
  log(`[fetch] ${url}`)
  const data = await fetchJSON(url)
  if (!(data && typeof data === 'object' && 'error' in (data as object))) {
    writeFileSync(p, JSON.stringify(data))
  }
  return data
}

/**
 * Page through an ArcGIS FeatureServer/MapServer query endpoint.
 * Returns all features across pages.
 * On ArcGIS error, throws so the caller can handle as gap or fatal.
 */
async function arcgisFetchAll(
  rawDir:      string,
  serviceUrl:  string,
  params:      Record<string, string>,
  cachePrefix: string,
): Promise<Array<{ geometry: unknown; attributes: Record<string, unknown> }>> {
  // Both BCAD and FEMA answer "Error performing query operation" intermittently
  // when a page carries too much geometry — measured: BCAD at 1000 records with
  // outFields=* fails, the identical request at 100 succeeds three times out of
  // three. The failure is size-related, not a bad query, so step the page size
  // down and retry rather than treating it as a dead source. Once a size works
  // it is kept for the remaining pages, so the cost is paid once per run.
  const MAX_PAGE = 1000
  const MIN_PAGE = 50
  const all: Array<{ geometry: unknown; attributes: Record<string, unknown> }> = []
  let offset   = 0
  let page     = 0
  let pageSize = MAX_PAGE

  while (true) {
    let data: ArcGISResponse | null = null
    let attempt = pageSize
    let lastError = ''

    while (attempt >= MIN_PAGE) {
      const qs = new URLSearchParams({
        f:                 'json',
        outFields:         '*',
        returnGeometry:    'true',
        outSR:             '4326',
        ...params,
        resultOffset:      String(offset),
        resultRecordCount: String(attempt),
      })
      const url      = `${serviceUrl}/query?${qs}`
      const filename = `${cachePrefix}-o${offset}-n${attempt}.json`
      const d        = await cachedFetchJSON(rawDir, url, filename) as ArcGISResponse

      if (!d.error) { data = d; break }

      lastError = d.error.message
      warn(`  offset ${offset} failed at page size ${attempt} (${lastError}) — halving`)
      attempt = Math.floor(attempt / 2)
      await sleep(500)
    }

    if (!data) {
      throw new Error(
        `ArcGIS error at ${serviceUrl}: ${lastError} — still failing at page size ${MIN_PAGE}`)
    }

    pageSize = attempt              // stick with the size that worked
    const features = data.features ?? []
    all.push(...features)
    log(`  page ${page} (offset ${offset}, size ${attempt}): ${features.length} features (total ${all.length})`)

    if (!data.exceededTransferLimit || features.length === 0) break
    offset += features.length       // advance by what came back, not what was asked for
    page++
  }

  return all
}

// ── Geometry helpers ───────────────────────────────────────────────────────────

function toGeoJSONGeometry(g: unknown): Geometry {
  if (!g || typeof g !== 'object') return null
  const geom = g as Record<string, unknown>
  if (geom.rings) {
    return { type: 'Polygon', coordinates: geom.rings as number[][][] }
  }
  if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
    return geom as unknown as Geometry
  }
  return null
}

function geometryCentroid(g: Geometry): [number, number] | null {
  if (!g) return null
  try {
    const feat = turf.centroid({ type: 'Feature', geometry: g as GeoJSON.Geometry, properties: {} })
    return feat.geometry.coordinates as [number, number]
  } catch {
    return null
  }
}

/**
 * Minimum perpendicular distance from a point to the nearest segment in a
 * set of polyline features, in metres.  Uses turf.nearestPointOnLine for
 * true segment distance, not vertex distance.
 */
function minDistToLines(
  pt: [number, number],
  lines: Array<{ geometry: Geometry; voltageKv: number; paths: number[][][] }>,
): number {
  const turfPt = turf.point(pt)
  let min = Infinity
  for (const ln of lines) {
    if (!ln.paths) continue
    for (const path of ln.paths) {
      if (path.length < 2) continue
      try {
        const line = turf.lineString(path)
        const snap = turf.nearestPointOnLine(line, turfPt, { units: 'meters' })
        const d = snap.properties.dist ?? Infinity
        if (d < min) min = d
      } catch { /* skip malformed paths */ }
    }
  }
  return min
}

/**
 * Returns the fraction of the parcel polygon that is NOT in any of the
 * given flood polygons.  Returns null when no flood data is available.
 * Returns 1.0 (fully buildable) when the parcel has no overlap.
 */
/**
 * Bounding boxes for the flood polygons, indexed once.
 *
 * Without this, working out a parcel's flood exposure meant a full polygon
 * intersection against every flood polygon in the county — roughly 8,000 of
 * them, for each of ~7,500 parcels. That is 60 million turf.intersect calls and
 * the run never finished. The bug was invisible until FEMA started answering:
 * while that source was failing the whole stage was skipped.
 *
 * Nearly every pair is disjoint, and a bounding-box test rejects those for
 * almost nothing. Only genuine candidates reach the expensive geometry.
 */
interface FloodIndex { index: Flatbush; geoms: Geometry[] }

function buildFloodIndex(floodGeoms: Geometry[]): FloodIndex | null {
  const geoms = floodGeoms.filter((g): g is NonNullable<Geometry> => !!g)
  if (geoms.length === 0) return null

  const index = new Flatbush(geoms.length)
  for (const g of geoms) {
    try {
      const [minX, minY, maxX, maxY] =
        turf.bbox({ type: 'Feature', geometry: g as GeoJSON.Geometry, properties: {} })
      index.add(minX, minY, maxX, maxY)
    } catch {
      // A geometry turf cannot box still needs a slot, or the index and the
      // array fall out of alignment and every later lookup returns the wrong
      // polygon. An empty box simply never matches.
      index.add(0, 0, 0, 0)
    }
  }
  index.finish()
  return { index, geoms }
}

function floodBuildablePct(
  parcelGeom: Geometry,
  flood:      FloodIndex | null,
): number | null {
  if (!flood || !parcelGeom) return null

  try {
    const parcelFeat = { type: 'Feature', geometry: parcelGeom, properties: {} } as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
    const parcelArea = turf.area(parcelFeat)
    if (parcelArea === 0) return null

    const [minX, minY, maxX, maxY] = turf.bbox(parcelFeat)
    const candidates = flood.index.search(minX, minY, maxX, maxY)

    let affectedArea = 0
    for (const i of candidates) {
      const fg = flood.geoms[i]
      if (!fg) continue
      try {
        const floodFeat = { type: 'Feature', geometry: fg, properties: {} } as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
        const inter = turf.intersect(turf.featureCollection([parcelFeat, floodFeat]))
        if (inter) affectedArea += turf.area(inter)
      } catch { /* non-overlapping or geometry error */ }
    }

    const pct = 1 - affectedArea / parcelArea
    return Math.max(0, Math.min(1, pct))
  } catch {
    return null
  }
}

// Round coordinate to 6 decimal places
function r6(n: number): number { return Math.round(n * 1e6) / 1e6 }

// Round money to whole dollars
function rMoney(n: number): number { return Math.round(n) }

// ── WKT helper ────────────────────────────────────────────────────────────────

function toWkt(g: Geometry): string | null {
  if (!g) return null
  if (g.type === 'Polygon') {
    const rings = g.coordinates.map(ring =>
      ring.map(([x, y]) => `${r6(x)} ${r6(y)}`).join(', ')
    ).map(r => `(${r})`).join(', ')
    return `POLYGON(${rings})`
  }
  if (g.type === 'MultiPolygon') {
    const polys = g.coordinates.map(poly =>
      poly.map(ring =>
        ring.map(([x, y]) => `${r6(x)} ${r6(y)}`).join(', ')
      ).map(r => `(${r})`).join(', ')
    ).map(p => `(${p})`).join(', ')
    return `MULTIPOLYGON(${polys})`
  }
  return null
}

// ── Driver builder ─────────────────────────────────────────────────────────────

function driverValue(
  value:      number | null,
  basis:      DriverValue['basis'],
  source_url: string,
  last_verified: string,
  method?:    string,
  low?:       number | null,
  high?:      number | null,
): DriverValue {
  const d: DriverValue = { value, basis, source_url, last_verified }
  if (low  !== undefined) d.low  = low
  if (high !== undefined) d.high = high
  if (method) d.method = method
  return d
}

// ── Source record ──────────────────────────────────────────────────────────────

interface SourceRecord {
  url:        string
  probeResult:'ok' | 'gap' | 'error'
  fetchDate:  string
  error?:     string
}

// ── Main pipeline ──────────────────────────────────────────────────────────────

export async function runIngest(cfg: CountyConfig): Promise<void> {
  const RAW_DIR  = resolve(DATA_DIR, 'raw', cfg.id)
  const OUT_DIR  = resolve(DATA_DIR, 'parcels')
  const TODAY    = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD

  mkdirSync(RAW_DIR, { recursive: true })
  mkdirSync(OUT_DIR, { recursive: true })

  console.log(`\n=== ingest pipeline — ${cfg.name} ===\n`)

  const sourceRecords: SourceRecord[] = []
  const gaps: Array<{ source: string; urlsTried: string[]; probedDate: string; outcome: string; note?: string }> = []

  // ── Source 1: BCAD (or county equivalent) parcel layer ────────────────────
  console.log('Fetching sources...')
  log(`Source 1: ${cfg.parcelSource.url}`)

  interface RawParcel {
    parcelId:          string
    address:           string
    acres:             number | null
    acresSource:       'Acres' | 'LglAcres'
    stateCode:         string
    appraisedLandValue:number | null
    owner:             string
    exemptCodes:       string
    geometry:          Geometry
  }

  let rawParcels: RawParcel[] = []
  try {
    const features = await arcgisFetchAll(
      RAW_DIR,
      cfg.parcelSource.url,
      {
        // Filter server-side on state code and acreage only — LandVal > 0 causes error on this service
        where:      `${cfg.parcelSource.acresField} >= ${cfg.minAcres}`,
        outFields:  '*',
      },
      cfg.parcelSource.cachePrefix,
    )

    // PRINT RAW COUNT BEFORE ANY FILTERING — a silent zero can never look valid
    console.log(`\n  Raw fetched from ${cfg.id} parcel layer: ${features.length} records`)

    rawParcels = features.map(f => {
      const a = f.attributes
      const parcelId = String(
        a[cfg.parcelSource.idField] ?? a['OBJECTID'] ?? ''
      )
      const address = String(a[cfg.parcelSource.addressField] ?? '').trim() || 'Unknown'

      // Acreage — primary field then fallback
      const acresPrimary = parseFloat(String(a[cfg.parcelSource.acresField] ?? 'NaN'))
      const acresFallback = parseFloat(String(a[cfg.parcelSource.acresFallback] ?? 'NaN'))
      const acres = isNaN(acresPrimary) ? (isNaN(acresFallback) ? null : acresFallback) : acresPrimary
      const acresSource = (!isNaN(acresPrimary)
        ? cfg.parcelSource.acresField
        : cfg.parcelSource.acresFallback) as 'Acres' | 'LglAcres'

      const stateCode = String(a[cfg.parcelSource.stateCodeField] ?? '').trim().toUpperCase()
      const landVal = parseFloat(String(a[cfg.parcelSource.landValField] ?? 'NaN'))

      return {
        parcelId,
        address,
        acres,
        acresSource,
        stateCode,
        appraisedLandValue: isNaN(landVal) || landVal <= 0 ? null : landVal,
        owner:       String(a[cfg.parcelSource.ownerField] ?? '').trim(),
        exemptCodes: String(a[cfg.parcelSource.exemptField] ?? '').trim().toUpperCase(),
        geometry: toGeoJSONGeometry(f.geometry),
      }
    })

    sourceRecords.push({
      url:        cfg.parcelSource.url,
      probeResult:'ok',
      fetchDate:  TODAY,
    })
  } catch (e: any) {
    warn(`Parcel fetch failed: ${e.message}`)
    sourceRecords.push({ url: cfg.parcelSource.url, probeResult: 'error', fetchDate: TODAY, error: e.message })
  }

  // ── Source 2: Zoning ───────────────────────────────────────────────────────
  log('Source 2: zoning polygons')
  interface ZoneRecord { geometry: Geometry; zoning: string }
  let zones: ZoneRecord[] = []

  if (cfg.zoningSource) {
    try {
      const features = await arcgisFetchAll(
        RAW_DIR,
        cfg.zoningSource.url,
        { where: '1=1', outFields: cfg.zoningSource.codeField },
        cfg.zoningSource.cachePrefix,
      )
      zones = features.map(f => ({
        geometry: toGeoJSONGeometry(f.geometry),
        zoning: String(f.attributes[cfg.zoningSource!.codeField] ?? 'unknown').trim().toUpperCase(),
      }))
      sourceRecords.push({ url: cfg.zoningSource.url, probeResult: 'ok', fetchDate: TODAY })
    } catch (e: any) {
      warn(`Zoning fetch failed: ${e.message}. Parcels will be tagged zoning=gap.`)
      sourceRecords.push({ url: cfg.zoningSource.url, probeResult: 'error', fetchDate: TODAY, error: e.message })
    }
  } else {
    // Record gap
    const gap = cfg.zoningGap!
    warn(`Zoning: gap — ${gap.outcome}`)
    sourceRecords.push({ url: gap.urlsTried[0], probeResult: 'gap', fetchDate: TODAY, error: gap.outcome })
    gaps.push({ source: 'zoning', ...gap })
  }

  // ── Source 3: FEMA NFHL flood hazard zones ────────────────────────────────
  log('Source 3: FEMA NFHL flood hazard zones')
  interface FloodZoneRecord { geometry: Geometry; floodZone: string }
  let floods: FloodZoneRecord[] = []

  // Verify layer name before querying
  let femaLayerVerified = false
  try {
    const descriptor = await cachedFetchJSON(
      RAW_DIR,
      `${cfg.floodSource.url}?f=json`,
      `${cfg.floodSource.cachePrefix}-descriptor.json`,
    ) as ArcGISResponse
    const actualName = descriptor.name ?? ''
    if (actualName !== cfg.floodSource.expectedLayerName) {
      throw new Error(
        `FEMA layer name mismatch: expected "${cfg.floodSource.expectedLayerName}", ` +
        `got "${actualName}". FEMA may have renumbered layers. Update floodSource.url.`
      )
    }
    femaLayerVerified = true
  } catch (e: any) {
    warn(`FEMA layer verification failed: ${e.message}`)
  }

  if (femaLayerVerified) {
    try {
      const features = await arcgisFetchAll(
        RAW_DIR,
        cfg.floodSource.url,
        { where: cfg.floodSource.whereClause, outFields: 'FLD_ZONE,ZONE_SUBTY' },
        cfg.floodSource.cachePrefix,
      )
      floods = features.map(f => ({
        geometry:  toGeoJSONGeometry(f.geometry),
        floodZone: String(f.attributes['FLD_ZONE'] ?? '').trim().toUpperCase(),
      }))
      sourceRecords.push({ url: cfg.floodSource.url, probeResult: 'ok', fetchDate: TODAY })
      log(`  ${floods.length} flood zone features fetched`)
    } catch (e: any) {
      warn(`FEMA NFHL fetch failed: ${e.message}. Flood filter will not be applied.`)
      sourceRecords.push({ url: cfg.floodSource.url, probeResult: 'error', fetchDate: TODAY, error: e.message })
    }
  }

  // ── Source 4: Service territories ─────────────────────────────────────────
  log('Source 4: electric service territories')
  interface TerritoryRecord { geometry: Geometry; utility: string }
  let utilities: TerritoryRecord[] = []

  if (cfg.territorySource) {
    try {
      const features = await arcgisFetchAll(
        RAW_DIR,
        cfg.territorySource.url,
        { where: cfg.territorySource.whereClause, outFields: cfg.territorySource.nameField },
        cfg.territorySource.cachePrefix,
      )
      utilities = features.map(f => ({
        geometry: toGeoJSONGeometry(f.geometry),
        utility:  String(f.attributes[cfg.territorySource!.nameField] ?? '').trim(),
      }))
      sourceRecords.push({ url: cfg.territorySource.url, probeResult: 'ok', fetchDate: TODAY })
    } catch (e: any) {
      warn(`Territory fetch failed: ${e.message}.`)
      sourceRecords.push({ url: cfg.territorySource.url, probeResult: 'error', fetchDate: TODAY, error: e.message })
    }
  } else {
    const gap = cfg.territoryGap!
    warn(`Service territories: gap — ${gap.outcome}`)
    sourceRecords.push({ url: gap.urlsTried[0], probeResult: 'gap', fetchDate: TODAY, error: gap.outcome })
    gaps.push({ source: 'service-territories', ...gap })
  }

  // ── Source 5: HIFLD transmission lines ────────────────────────────────────
  log('Source 5: transmission lines')
  interface TransLineRecord {
    geometry: Geometry
    voltageKv: number
    paths: number[][][]
  }
  let txLines: TransLineRecord[] = []

  try {
    const features = await arcgisFetchAll(
      RAW_DIR,
      cfg.transmissionSource.url,
      {
        where:        cfg.transmissionSource.whereClause,
        outFields:    `${cfg.transmissionSource.voltageField},VOLT_CLASS,TYPE`,
        geometryType: 'esriGeometryEnvelope',
        geometry:     `${cfg.bbox.minLng},${cfg.bbox.minLat},${cfg.bbox.maxLng},${cfg.bbox.maxLat}`,
        spatialRel:   'esriSpatialRelIntersects',
        inSR:         '4326',
      },
      cfg.transmissionSource.cachePrefix,
    )
    txLines = features.map(f => {
      const v = parseFloat(String(f.attributes[cfg.transmissionSource.voltageField] ?? '0'))
      const geom = f.geometry as Record<string, unknown>
      const paths: number[][][] = Array.isArray(geom?.paths) ? geom.paths as number[][][] : []
      return {
        geometry:  toGeoJSONGeometry(f.geometry),
        voltageKv: isNaN(v) ? 0 : v,
        paths,
      }
    })
    sourceRecords.push({ url: cfg.transmissionSource.url, probeResult: 'ok', fetchDate: TODAY })
    log(`  ${txLines.length} transmission line features fetched`)
  } catch (e: any) {
    warn(`Transmission lines fetch failed: ${e.message}.`)
    sourceRecords.push({ url: cfg.transmissionSource.url, probeResult: 'error', fetchDate: TODAY, error: e.message })
  }

  // ── Source 6: PeeringDB ───────────────────────────────────────────────────
  log('Source 6: PeeringDB IXP facilities')
  interface IxpFacility { name: string; lat: number; lon: number }
  let ixps: IxpFacility[] = []

  try {
    const data = await cachedFetchJSON(RAW_DIR, cfg.peeringDbUrl, 'peeringdb-facilities.json') as any
    ixps = (data?.data ?? []).map((d: any) => ({
      name: String(d.name ?? ''),
      lat:  parseFloat(String(d.latitude  ?? 'NaN')),
      lon:  parseFloat(String(d.longitude ?? 'NaN')),
    })).filter((f: IxpFacility) => !isNaN(f.lat) && !isNaN(f.lon))
    sourceRecords.push({ url: cfg.peeringDbUrl, probeResult: 'ok', fetchDate: TODAY })
    log(`  ${ixps.length} PeeringDB facilities found`)
  } catch (e: any) {
    warn(`PeeringDB fetch failed: ${e.message}.`)
    sourceRecords.push({ url: cfg.peeringDbUrl, probeResult: 'error', fetchDate: TODAY, error: e.message })
  }

  // ── Data availability flags ────────────────────────────────────────────────
  const hasZoning  = zones.length  > 0
  const hasFlood   = floods.length > 0
  const hasLines   = txLines.length > 0

  // ── Funnel ────────────────────────────────────────────────────────────────
  console.log(`\n── Funnel ──────────────────────────────────────────────────────`)
  console.log(`  Raw ${cfg.id} parcels fetched (pre-filter): ${rawParcels.length}`)

  // Stage 1: Acreage filter (already applied server-side, verify client-side)
  const afterAcres = rawParcels.filter(p => (p.acres ?? 0) >= cfg.minAcres)
  console.log(`  After acreage >= ${cfg.minAcres} ac:  ${afterAcres.length}  (dropped ${rawParcels.length - afterAcres.length})`)

  // Stage 2: Institutional ownership.
  //
  // A city park carries the same land-use code as any other open land, so the
  // code alone cannot tell them apart. The tax exemption can: EX-* means the
  // owner is a government body, a school or a charity, and none of that is for
  // sale. These parcels also carry nominal appraised values, so without this
  // stage they sort to the top of the ranking and are the first thing a reader
  // sees. Owner-name matching runs behind it as a second net.
  const isInstitutional = (p: RawParcel): boolean => {
    for (const pre of cfg.parcelSource.institutionalExemptPrefixes) {
      if (p.exemptCodes.includes(pre)) return true
    }
    const owner = p.owner.toUpperCase()
    return cfg.parcelSource.governmentOwnerPatterns.some(g => owner.includes(g))
  }
  /**
   * A homestead or veteran exemption means somebody lives on the land. It stays
   * a candidate — it is privately owned and can be bought — but a reader should
   * know they would be negotiating with a family, not a landholding company.
   */
  const isOccupied = (p: RawParcel): boolean =>
    cfg.parcelSource.occupancyExemptPrefixes.some(pre =>
      p.exemptCodes.split(',').map(c => c.trim()).includes(pre))

  const afterInstitutional = afterAcres.filter(p => !isInstitutional(p))
  console.log(`  After institutional owners:     ${afterInstitutional.length}  (dropped ${afterAcres.length - afterInstitutional.length})`)

  // Stage 3: Priceable land.
  //
  // A parcel whose land the data cannot price is not a cheap parcel. Routed to
  // its own list rather than discarded, so the omission stays visible — the
  // same reasoning as UnevaluableSite for regions.
  const unpriceable: Array<{ parcel: RawParcel; reason: string }> = []
  const afterLandVal = afterInstitutional.filter(p => {
    if (p.appraisedLandValue === null) {
      unpriceable.push({ parcel: p, reason: 'no appraised land value published' })
      return false
    }
    const perAcre = p.acres && p.acres > 0 ? p.appraisedLandValue / p.acres : 0
    if (perAcre < cfg.parcelSource.minLandValuePerAcre) {
      unpriceable.push({
        parcel: p,
        reason: `appraised land value of $${Math.round(perAcre)} per acre is below the ` +
                `$${cfg.parcelSource.minLandValuePerAcre} plausibility floor for this county`,
      })
      return false
    }
    return true
  })
  console.log(`  After priceable land:           ${afterLandVal.length}  (dropped ${afterInstitutional.length - afterLandVal.length} to the unpriceable list)`)

  // Stage 3: Land use state code filter
  const afterLandUse = afterLandVal.filter(p => {
    if (!p.stateCode) return false
    for (const exc of cfg.parcelSource.excludedStateCodes) {
      if (p.stateCode.startsWith(exc)) return false
    }
    for (const inc of cfg.parcelSource.allowedStateCodes) {
      if (p.stateCode.startsWith(inc)) return true
    }
    return false
  })
  console.log(`  After land-use state code:      ${afterLandUse.length}  (dropped ${afterLandVal.length - afterLandUse.length})`)

  // Stage 4: Flood — drop if > floodDropPct of parcel area in 100-yr SFHA
  //
  // The zone lists and their spatial indexes are built once. They used to be
  // rebuilt inside the per-parcel loop, which meant re-filtering every flood
  // record in the county — thousands of them — for each parcel, on top of the
  // intersection cost.
  const dropZoneGeoms = floods
    .filter(fz => cfg.floodSource.dropZones.has(fz.floodZone) && fz.geometry)
    .map(fz => fz.geometry!)
  const flagZoneGeoms = floods
    .filter(fz => cfg.floodSource.flagZones.has(fz.floodZone.replace('_', '')) && fz.geometry)
    .map(fz => fz.geometry!)

  const dropIndex = buildFloodIndex(dropZoneGeoms)
  const flagIndex = buildFloodIndex(flagZoneGeoms)
  if (hasFlood) {
    log(`flood zones indexed: ${dropZoneGeoms.length} drop, ${flagZoneGeoms.length} flag`)
  }

  const afterFlood: typeof afterLandUse = []
  for (const p of afterLandUse) {
    if (!hasFlood) { afterFlood.push(p); continue }
    const centroid = geometryCentroid(p.geometry)
    if (!centroid) { afterFlood.push(p); continue }

    if (!dropIndex) { afterFlood.push(p); continue }

    const buildablePct = floodBuildablePct(p.geometry, dropIndex)
    if (buildablePct === null) { afterFlood.push(p); continue }

    // Drop if more than floodDropPct of parcel is in 100-yr zone
    if ((1 - buildablePct) <= cfg.floodDropPct) {
      afterFlood.push(p)
    }
  }
  console.log(`  After flood filter (>${Math.round(cfg.floodDropPct * 100)}% 100-yr drop): ${afterFlood.length}  (dropped ${afterLandUse.length - afterFlood.length})`)

  // Stage 5: Transmission proximity
  //
  // Distance is computed once per parcel and kept, because the output loop
  // needs the same number. It used to be recomputed there, so every parcel
  // paid for a scan of every transmission line twice — the slowest thing in
  // the run, and it scales with the acreage floor.
  const txDistanceByParcel = new Map<string, number>()
  const afterTx: typeof afterFlood = []
  for (const p of afterFlood) {
    if (!hasLines) { afterTx.push(p); continue }
    const centroid = geometryCentroid(p.geometry)
    if (!centroid) continue
    const d = minDistToLines(centroid, txLines)
    txDistanceByParcel.set(p.parcelId, d)
    if (d <= cfg.maxDistToTxLineM) afterTx.push(p)
  }
  console.log(`  After transmission (≤${cfg.maxDistToTxLineM/1000}km ≥${cfg.transmissionSource.minKv}kV): ${afterTx.length}  (dropped ${afterFlood.length - afterTx.length})`)
  console.log(`  ═══════════════════════════════════════════════════════`)
  console.log(`  CANDIDATE PARCELS: ${afterTx.length}`)

  if (!hasZoning) warn('Zoning: gap — parcels tagged based on jurisdiction (unincorporated = outside-jurisdiction).')
  if (!hasFlood)  warn('Flood: data unavailable — flood filter not applied.')
  if (!hasLines)  warn('Transmission lines: data unavailable — proximity filter not applied.')

  const funnel = {
    raw:          rawParcels.length,
    afterAcres:   afterAcres.length,
    afterInstitutional: afterInstitutional.length,
    unpriceable:  unpriceable.length,
    afterLandVal: afterLandVal.length,
    afterLandUse: afterLandUse.length,
    afterFlood:   afterFlood.length,
    afterTx:      afterTx.length,
    candidates:   afterTx.length,
  }

  // ── Build features ────────────────────────────────────────────────────────
  console.log('\nBuilding output features...')

  type ZoningTag = 'industrial' | 'outside-limits' | 'outside-jurisdiction' | 'unknown-gap' | 'rejected'

  function zoningTag(centroid: [number, number]): ZoningTag {
    // No zoning source = gap or outside-jurisdiction
    if (!hasZoning) {
      // Texas counties have no zoning authority — unincorporated is outside-jurisdiction
      return cfg.zoningSource === null ? 'outside-jurisdiction' : 'unknown-gap'
    }
    for (const z of zones) {
      if (!z.geometry) continue
      try {
        const pt = turf.point(centroid)
        const poly = { type: 'Feature', geometry: z.geometry, properties: {} } as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
        if (turf.booleanPointInPolygon(pt, poly)) {
          const prefix = cfg.industrialZoningPrefixes.find(p => z.zoning.startsWith(p))
          return prefix ? 'industrial' : 'rejected'
        }
      } catch { continue }
    }
    return 'outside-limits'
  }

  function utilityTag(centroid: [number, number]): string {
    if (utilities.length === 0) return cfg.defaultUtility
    for (const t of utilities) {
      if (!t.geometry) continue
      try {
        const pt   = turf.point(centroid)
        const poly = { type: 'Feature', geometry: t.geometry, properties: {} } as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
        if (turf.booleanPointInPolygon(pt, poly)) return t.utility
      } catch { continue }
    }
    return cfg.defaultUtility
  }

  function pvsCategoryForStateCode(sc: string): string {
    if (sc.startsWith('F1')) return 'F1'
    if (sc.startsWith('F2') || sc.startsWith('C2')) return 'F2'
    if (sc.startsWith('D'))  return 'D1'
    return '__aggregate__'
  }

  const geojsonFeatures: Feature[] = []
  const rows: ParcelRow[] = []

  for (const p of afterTx) {
    const centroid = geometryCentroid(p.geometry)
    if (!centroid) continue

    // ── Zoning ─────────────────────────────────────────────────────────────
    const zoning = zoningTag(centroid)

    // ── Utility ────────────────────────────────────────────────────────────
    const utility = utilityTag(centroid)

    // ── Flood buildable fraction ───────────────────────────────────────────
    let buildablePct: number | null = null
    let in500yr = false
    if (hasFlood) {
      buildablePct = dropIndex ? floodBuildablePct(p.geometry, dropIndex) : 1.0

      if (flagIndex) {
        // 500-yr flag: a centroid test is enough for a flag, since it does not
        // drop the parcel. The index narrows it to the few polygons whose box
        // contains the point rather than testing every one.
        const pt = turf.point(centroid)
        for (const i of flagIndex.index.search(centroid[0], centroid[1], centroid[0], centroid[1])) {
          const fg = flagIndex.geoms[i]
          if (!fg) continue
          try {
            const poly = { type: 'Feature', geometry: fg, properties: {} } as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
            if (turf.booleanPointInPolygon(pt, poly)) { in500yr = true; break }
          } catch { /* skip */ }
        }
      }
    }

    // ── Transmission distance ──────────────────────────────────────────────
    const cachedTxDist  = txDistanceByParcel.get(p.parcelId)
    const distToTxLineM = cachedTxDist === undefined ? null : Math.round(cachedTxDist)

    // ── IXP proximity ──────────────────────────────────────────────────────
    let distToIxpKm: number | null = null
    if (ixps.length > 0) {
      let best = Infinity
      for (const ixp of ixps) {
        const d = turf.distance(turf.point(centroid), turf.point([ixp.lon, ixp.lat]), { units: 'kilometers' })
        if (d < best) best = d
      }
      distToIxpKm = Math.round(best * 10) / 10
    }

    // ── Land cost driver ───────────────────────────────────────────────────
    const pvsCategory = pvsCategoryForStateCode(p.stateCode)
    const { ratio: pvsRatio, category: pvsCatLabel } = cfg.pvsRatios[pvsCategory]
    let landCostDriver: DriverValue

    if (p.appraisedLandValue !== null && (p.acres ?? 0) > 0) {
      const appraisedPerAcre = p.appraisedLandValue / p.acres!
      const modeledPerAcre   = appraisedPerAcre / pvsRatio
      landCostDriver = driverValue(
        rMoney(modeledPerAcre),
        'modeled',
        `${cfg.parcelSource.url}/query`,
        // last_verified = fetch date from cache (deterministic)
        TODAY,
        `BCAD appraised land value per acre (${TODAY}), divided by Texas Comptroller PVS ` +
        `level-of-appraisal ratio for ${cfg.name} category ${pvsCatLabel}, ` +
        `PVS year ${cfg.pvsYear}; ratio = ${pvsRatio}. ` +
        `Land value only — improvements excluded. ` +
        `Texas non-disclosure state; sale prices not public.`,
        rMoney(modeledPerAcre * 0.80),
        rMoney(modeledPerAcre * 1.20),
      )
    } else {
      landCostDriver = driverValue(
        55_000,
        'assumed',
        `${cfg.parcelSource.url}/query`,
        TODAY,
        `BCAD LandVal not available for parcel ${p.parcelId}; ` +
        `using San Antonio industrial land market average of $55,000/acre from ` +
        `us-tx-ercot baseline (${TODAY}). Replace when BCAD record is complete.`,
      )
    }

    // ── Power rate driver ──────────────────────────────────────────────────
    const powerRateDriver = driverValue(
      cfg.powerRate.valueUsdPerKwh,
      'sourced',
      cfg.powerRate.source_url,
      cfg.powerRate.last_verified,
      cfg.powerRate.method,
      cfg.powerRate.low,
      cfg.powerRate.high,
    )

    // ── Water rate driver ──────────────────────────────────────────────────
    const waterRateDriver = driverValue(
      cfg.waterRate.valueUsdPerKgal,
      'sourced',
      cfg.waterRate.source_url,
      cfg.waterRate.last_verified,
      cfg.waterRate.method,
      cfg.waterRate.low,
      cfg.waterRate.high,
    )

    // ── ERCOT interconnection — explicit gap ──────────────────────────────
    const ercotIxDriver = driverValue(
      null,
      'assumed',
      'https://www.ercot.com/services/rq/large-load-integration',
      TODAY,
      `ERCOT large-load interconnection queue wait time. ` +
      `Queue data is published as PDFs at the source URL and requires Docling ` +
      `(IBM tool) to parse programmatically. Placeholder null — replace by running ` +
      `the Docling pipeline against the latest ERCOT TAC board report PDF.`,
    )

    const drivers: Record<string, DriverValue> = {
      land_cost_per_acre_usd:     landCostDriver,
      power_rate_usd_per_kwh:     powerRateDriver,
      water_rate_usd_per_kgal:    waterRateDriver,
      grid_interconnection_years: ercotIxDriver,
    }

    // Round coordinates in geometry
    const roundGeom = (g: Geometry): Geometry => {
      if (!g) return null
      if (g.type === 'Polygon') {
        return { type: 'Polygon', coordinates: g.coordinates.map(ring => ring.map(([x, y]) => [r6(x), r6(y)])) }
      }
      return {
        type: 'MultiPolygon',
        coordinates: (g as MultiPolygon).coordinates.map(poly => poly.map(ring => ring.map(([x, y]) => [r6(x), r6(y)])))
      }
    }
    const roundedGeom = roundGeom(p.geometry)

    const jurisdiction = utility.includes(cfg.primaryUtility.match)
      ? cfg.primaryUtility.jurisdictionLabel
      : utility

    // GeoJSON feature
    geojsonFeatures.push({
      type: 'Feature',
      geometry: roundedGeom,
      properties: {
        parcel_id:           p.parcelId,
        address:             p.address,
        acres:               p.acres,
        acres_source:        p.acresSource,
        jurisdiction,
        zoning,
        flood_buildable_pct: buildablePct !== null ? Math.round(buildablePct * 1000) / 1000 : null,
        in_500yr_flood:      in500yr,
        dist_to_tx_line_m:   distToTxLineM,
        dist_to_ixp_km:      distToIxpKm,
        utility,
        state_code:          p.stateCode,
        owner:               p.owner,
        occupied:            isOccupied(p),
        exempt_codes:        p.exemptCodes,
        drivers,
      },
    })

    // Flat row for repository
    rows.push({
      parcel_id:           p.parcelId,
      address:             p.address,
      acres:               p.acres,
      acres_source:        p.acresSource,
      jurisdiction,
      zoning,
      flood_buildable_pct: buildablePct !== null ? Math.round(buildablePct * 1000) / 1000 : null,
      in_500yr_flood:      in500yr,
      dist_to_tx_line_m:   distToTxLineM,
      dist_to_ixp_km:      distToIxpKm,
      utility,
      state_code:          p.stateCode,
      owner:               p.owner,
      occupied:            isOccupied(p),
      exempt_codes:        p.exemptCodes,
      lat:                 r6(centroid[1]),
      lng:                 r6(centroid[0]),
      geometry_wkt:        toWkt(roundedGeom),
      drivers,
    })
  }

  // ── Sort deterministically by parcel_id ──────────────────────────────────
  geojsonFeatures.sort((a, b) =>
    String(a.properties.parcel_id).localeCompare(String(b.properties.parcel_id))
  )
  rows.sort((a, b) => a.parcel_id.localeCompare(b.parcel_id))

  // ── Write output ──────────────────────────────────────────────────────────
  const geojsonPath = resolve(OUT_DIR, `${cfg.outputKey}.geojson`)
  const rowsPath    = resolve(OUT_DIR, `${cfg.outputKey}.rows.json`)
  const metaPath    = resolve(OUT_DIR, `${cfg.outputKey}.meta.json`)

  const fc: FeatureCollection = { type: 'FeatureCollection', features: geojsonFeatures }
  writeFileSync(geojsonPath, JSON.stringify(fc, null, 2))
  writeFileSync(rowsPath,    JSON.stringify(rows, null, 2))
  console.log(`\n✓ Wrote ${geojsonFeatures.length} candidate parcels to ${geojsonPath}`)
  console.log(`✓ Wrote ${rows.length} rows to ${rowsPath}`)

  // Parcels the data could not price. Kept and published rather than dropped,
  // so the set that was left out of the ranking can be read and argued with.
  const unpriceablePath = resolve(OUT_DIR, `${cfg.outputKey}.unpriceable.json`)
  const unpriceableOut = unpriceable
    .map(u => ({
      parcel_id:  u.parcel.parcelId,
      address:    u.parcel.address,
      acres:      u.parcel.acres,
      state_code: u.parcel.stateCode,
      owner:      u.parcel.owner,
      appraised_land_value: u.parcel.appraisedLandValue,
      reason:     u.reason,
    }))
    .sort((a, b) => a.parcel_id.localeCompare(b.parcel_id))
  writeFileSync(unpriceablePath, JSON.stringify(unpriceableOut, null, 2))
  console.log(`✓ Wrote ${unpriceableOut.length} unpriceable parcels to ${unpriceablePath}`)

  // ── Coverage table ────────────────────────────────────────────────────────
  const driverNames = ['land_cost_per_acre_usd', 'power_rate_usd_per_kwh', 'water_rate_usd_per_kgal', 'grid_interconnection_years']
  const driverCoverage: Record<string, { sourced: number; modeled: number; assumed: number; missing: number }> = {}
  for (const drv of driverNames) {
    let sourced = 0, modeled = 0, assumed = 0, missing = 0
    for (const f of geojsonFeatures) {
      const d = (f.properties.drivers as Record<string, DriverValue>)[drv]
      if (!d || d.value === null) { missing++; continue }
      if (d.basis === 'sourced')       sourced++
      else if (d.basis === 'modeled')  modeled++
      else                             assumed++
    }
    driverCoverage[drv] = { sourced, modeled, assumed, missing }
  }

  if (geojsonFeatures.length > 0) {
    console.log('\n── Driver coverage table ───────────────────────────────────────')
    const header = 'Driver'.padEnd(36) + 'Sourced'.padStart(8) + 'Modeled'.padStart(8) + 'Assumed'.padStart(8) + 'Missing'.padStart(8)
    console.log('  ' + header)
    console.log('  ' + '-'.repeat(header.length))
    for (const drv of driverNames) {
      const { sourced, modeled, assumed, missing } = driverCoverage[drv]
      console.log('  ' +
        drv.padEnd(36) +
        String(sourced).padStart(8) +
        String(modeled).padStart(8) +
        String(assumed).padStart(8) +
        String(missing).padStart(8)
      )
    }
  }

  // Gap list
  if (gaps.length > 0) {
    console.log('\n── Gap sources ─────────────────────────────────────────────────')
    for (const g of gaps) {
      console.log(`  GAP [${g.source}]: ${g.outcome}`)
      console.log(`    URLs tried (${g.probedDate}):`)
      for (const u of g.urlsTried) console.log(`      ${u}`)
    }
  }
  if (!hasZoning)  console.log('\n  NOTE: Zoning data unavailable — gap recorded in meta file')
  if (!hasFlood)   console.log('  NOTE: Flood data unavailable — flood filter skipped')
  if (!hasLines)   console.log('  NOTE: Transmission line data unavailable — proximity filter skipped')
  console.log('\n  NOTE: grid_interconnection_years is null pending ERCOT Docling pipeline')

  // ── Meta file ─────────────────────────────────────────────────────────────
  const meta = {
    runTimestamp:  new Date().toISOString(),
    countyId:      cfg.id,
    countyName:    cfg.name,
    sources:       sourceRecords,
    funnel,
    driverCoverage,
    gaps,
    notes: [
      'land_cost_per_acre_usd: modeled — BCAD appraised value ÷ Texas Comptroller PVS ratio. ' +
      'Texas is a non-disclosure state; this is NOT a market price.',
      'grid_interconnection_years: null — requires ERCOT Docling PDF pipeline; see source_url.',
    ],
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  console.log(`✓ Wrote meta to ${metaPath}`)
  console.log('\n=== ingest pipeline complete ===\n')
}
