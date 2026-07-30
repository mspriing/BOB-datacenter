#!/usr/bin/env tsx
/**
 * backend/src/scripts/ingestParcels.ts
 *
 * Produces data/parcels-bexar.geojson — a FeatureCollection of candidate
 * data-center sites at parcel grain inside Bexar County, Texas.
 *
 * Re-runnable: running twice produces the same file (raw pages are cached;
 * output is deterministically filtered and formatted).
 *
 * Run from backend/:  npm run ingest:parcels
 *
 * See work order 06 for rationale, thresholds, and source table.
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── Path setup ─────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const ROOT       = resolve(__dirname, '../../..')   // backend/src/scripts → repo root
const DATA_DIR   = resolve(ROOT, 'data')
const RAW_DIR    = resolve(DATA_DIR, 'raw', 'bexar')
const OUT_PATH   = resolve(DATA_DIR, 'parcels-bexar.geojson')

const TODAY = new Date().toISOString().slice(0, 7) // "YYYY-MM"

// ── Candidate-filter thresholds (tune here) ────────────────────────────────────

const MIN_ACRES = 10           // campus sizing: 1.2 ac/MW, 10 MW min → 12 ac; 10 gives room
const MAX_DIST_TO_HIFLD_TX_M = 8_000   // 8 km to nearest ≥138 kV line
const FLOOD_DROP_ZONES   = new Set(['A', 'AE', 'AO', 'AH', 'VE', 'V'])  // 100-yr zones
const FLOOD_FLAG_ZONES   = new Set(['X500', 'X_500', 'B'])               // 500-yr zones

// BCAD state codes that indicate developable parcels
// https://comptroller.texas.gov/taxes/property-tax/docs/96-313.pdf
const ALLOWED_STATE_CODES = new Set([
  // Vacant land
  'F1',  // Real property — commercial
  'F2',  // Real property — industrial
  'A1',  // Single-family … included for large un-platted acreage; filtered by MIN_ACRES
  // We keep industrial-coded parcels and drop residential + exempt
  'C1',  // Vacant commercial
  'C2',  // Vacant industrial
  'D1',  // Qualified Open-Space (ag)
  'D2',  // Ag/range — improvements (farm sheds etc.)
  'E1',  // Rural land
  'G1',  // Oil, gas, mineral — land only
])

// State codes to explicitly drop even if large
const EXCLUDED_STATE_CODES = new Set([
  'A1', 'A2', 'A3', // Residential (kept only as fallback for large ag; drop by default)
  'B1', 'B2',       // Multi-family
  'X',  'X1',       // Exempt
  'S1',             // Special inventory
])

// ── Logging helpers ────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`  ${msg}`) }
function warn(msg: string) { console.warn(`  ⚠  ${msg}`) }

// ── GeoJSON types (minimal) ────────────────────────────────────────────────────

interface Polygon    { type: 'Polygon';    coordinates: number[][][] }
interface MultiPolygon { type: 'MultiPolygon'; coordinates: number[][][][] }
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

// ── Cache-aware fetch ─────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.json()
}

async function cachedFetchJSON(url: string, filename: string): Promise<unknown> {
  mkdirSync(RAW_DIR, { recursive: true })
  const p = resolve(RAW_DIR, filename)
  if (existsSync(p)) {
    log(`[cache] ${filename}`)
    return JSON.parse(readFileSync(p, 'utf-8'))
  }
  log(`[fetch] ${url}`)
  const data = await fetchJSON(url)
  writeFileSync(p, JSON.stringify(data))
  return data
}

// ── ArcGIS paged fetch ────────────────────────────────────────────────────────
//
// Rule 1: page until exceededTransferLimit = false. Do not assume one call
// returns everything.

interface ArcGISResponse {
  features?:            Array<{ geometry: unknown; attributes: Record<string, unknown> }>
  exceededTransferLimit?: boolean
  error?:               { message: string }
}

async function arcgisFetchAll(
  serviceUrl: string,
  params:     Record<string, string>,
  cachePrefix: string,
): Promise<Array<{ geometry: unknown; attributes: Record<string, unknown> }>> {
  const PAGE_SIZE = 1000
  const all: Array<{ geometry: unknown; attributes: Record<string, unknown> }> = []
  let offset = 0
  let page   = 0

  while (true) {
    const qs = new URLSearchParams({
      f:                'json',
      outFields:        '*',
      returnGeometry:   'true',
      outSR:            '4326',
      resultOffset:     String(offset),
      resultRecordCount: String(PAGE_SIZE),
      ...params,
    })
    const url      = `${serviceUrl}/query?${qs}`
    const filename = `${cachePrefix}-page${page}.json`
    const data     = await cachedFetchJSON(url, filename) as ArcGISResponse

    if (data.error) {
      warn(`ArcGIS error at ${serviceUrl}: ${data.error.message}`)
      break
    }

    const features = data.features ?? []
    all.push(...features)
    log(`  page ${page}: ${features.length} features (total so far: ${all.length})`)

    if (!data.exceededTransferLimit || features.length === 0) break
    offset += PAGE_SIZE
    page++
  }

  return all
}

// ── Source 1: BCAD parcel layer ───────────────────────────────────────────────
//
// ArcGIS REST endpoint: Bexar County Appraisal District parcels
// https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0

const BCAD_URL = 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0'
const BCAD_SOURCE = `${BCAD_URL}/query`

interface BcadParcel {
  parcelId:    string
  address:     string
  acres:       number | null
  stateCode:   string
  appraisedLandValue: number | null
  geometry:    Geometry
}

async function fetchBcadParcels(): Promise<BcadParcel[]> {
  log('Source 1: BCAD parcels (paged ArcGIS)')
  // First pass: only industrial + commercial + ag/vacant; avoid pulling all 700k residential
  // BCAD field names: PROP_ID, SITUS_NUM + SITUS_STREET (address), GIS_ACRES, STATE_CD,
  // LND_VAL (appraised land value).
  // NOTE: different BCAD portal versions use slightly different field names.
  // We fetch all fields and normalise in parseAttributes().
  const features = await arcgisFetchAll(
    BCAD_URL,
    {
      where: `GIS_ACRES >= ${MIN_ACRES}`,
      outFields: '*',
    },
    'bcad-parcels',
  )

  return features.map(f => parseAttributes(f))
}

function parseAttributes(f: { geometry: unknown; attributes: Record<string, unknown> }): BcadParcel {
  const a = f.attributes

  // Normalise field names — BCAD has used PROP_ID, PARCEL_ID, ACCOUNT_NO across layers
  const parcelId = String(
    a['PROP_ID'] ?? a['PARCEL_ID'] ?? a['ACCOUNT_NO'] ?? a['OBJECTID'] ?? ''
  )

  // Address from SITUS fields
  const num    = String(a['SITUS_NUM']  ?? a['SITUS_ADDR_NUM'] ?? '').trim()
  const street = String(a['SITUS_STREET'] ?? a['SITUS_STR']  ?? '').trim()
  const address = [num, street].filter(Boolean).join(' ') || 'Unknown'

  // Acreage
  const acres = parseFloat(String(a['GIS_ACRES'] ?? a['CALC_ACRES'] ?? a['ACRES'] ?? 'NaN'))

  // State code — BCAD uses STATE_CD, STATECODE
  const stateCode = String(a['STATE_CD'] ?? a['STATECODE'] ?? a['STATE_CODE'] ?? '').trim().toUpperCase()

  // Appraised land value (land only, not improvements — Rule: do not value improvements)
  const appraisedLandValue = parseFloat(String(a['LND_VAL'] ?? a['LAND_VALUE'] ?? a['APP_LND'] ?? 'NaN'))

  const geometry = toGeoJSONGeometry(f.geometry)

  return {
    parcelId,
    address,
    acres: isNaN(acres) ? null : acres,
    stateCode,
    appraisedLandValue: isNaN(appraisedLandValue) ? null : appraisedLandValue,
    geometry,
  }
}

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

// ── Source 2: City of San Antonio zoning ─────────────────────────────────────
//
// COSA open data: zoning polygon layer.
// Endpoint probed from https://opendata-cosagis.opendata.arcgis.com/
// The canonical zoning REST service is:
//   https://services.arcgis.com/g3ToTjWotgngStr3/arcgis/rest/services/Zoning_Districts/FeatureServer/0
// If that endpoint is unavailable the gap is recorded and parcels are passed
// through with zoning = 'unknown'.

const COSA_ZONING_URL = 'https://services.arcgis.com/g3ToTjWotgngStr3/arcgis/rest/services/Zoning_Districts/FeatureServer/0'
const COSA_ZONING_SOURCE = COSA_ZONING_URL

// Industrial / heavy-commercial zoning prefixes that permit data centers
const INDUSTRIAL_ZONING_PREFIXES = ['I-1', 'I-2', 'BP', 'O/I', 'MXD', 'MPCD']

interface ZoneRecord { geometry: Geometry; zoning: string }

async function fetchZoningPolygons(): Promise<ZoneRecord[]> {
  log('Source 2: COSA zoning polygons')
  try {
    const features = await arcgisFetchAll(
      COSA_ZONING_URL,
      { where: '1=1', outFields: 'ZONING_TYP,ZONING_DST,ZONE_CODE,DESCRIPT' },
      'cosa-zoning',
    )
    return features.map(f => ({
      geometry: toGeoJSONGeometry(f.geometry),
      zoning: String(
        f.attributes['ZONING_TYP'] ?? f.attributes['ZONE_CODE'] ?? f.attributes['ZONING_DST'] ?? 'unknown'
      ).trim().toUpperCase(),
    }))
  } catch (e: any) {
    warn(`COSA zoning fetch failed: ${e.message}. Parcels will be tagged zoning=gap.`)
    return []
  }
}

// ── Source 3: FEMA NFHL (National Flood Hazard Layer) ─────────────────────────
//
// Rule: do NOT use hazards.fema.gov/nri/* (redirects to RAPT, broke links before).
// Use the NFHL map service instead.
// NFHL FeatureServer: https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHLWMS/MapServer
// S_FLD_HAZ_AR (flood hazard area) is layer 28.

const FEMA_NFHL_URL = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHLWMS/MapServer/28'
const FEMA_NFHL_SOURCE = FEMA_NFHL_URL

interface FloodZoneRecord { geometry: Geometry; floodZone: string }

async function fetchFloodZones(): Promise<FloodZoneRecord[]> {
  log('Source 3: FEMA NFHL flood hazard areas')
  // Query Bexar County (FIPS 48029) flood zones
  try {
    const features = await arcgisFetchAll(
      FEMA_NFHL_URL,
      {
        where: "DFIRM_ID LIKE '48029%' OR DFIRM_ID LIKE '48C%'",
        outFields: 'FLD_ZONE,ZONE_SUBTY',
      },
      'fema-nfhl-bexar',
    )
    return features.map(f => ({
      geometry: toGeoJSONGeometry(f.geometry),
      floodZone: String(f.attributes['FLD_ZONE'] ?? '').trim().toUpperCase(),
    }))
  } catch (e: any) {
    warn(`FEMA NFHL fetch failed: ${e.message}. Flood filter will not be applied — mark gap.`)
    return []
  }
}

// ── Source 4: HIFLD Electric Service Territories ──────────────────────────────
//
// Determines CPS Energy vs surrounding co-ops.
// HIFLD Open: https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Retail_Service_Territories/FeatureServer/0

const HIFLD_TERRITORY_URL = 'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Retail_Service_Territories/FeatureServer/0'

interface TerritoryRecord { geometry: Geometry; utility: string }

async function fetchServiceTerritories(): Promise<TerritoryRecord[]> {
  log('Source 4: HIFLD electric service territories')
  try {
    const features = await arcgisFetchAll(
      HIFLD_TERRITORY_URL,
      {
        where: "STATE = 'TX' AND (NAME LIKE '%CPS%' OR NAME LIKE '%BANDERA%' OR NAME LIKE '%GUADALUPE%' OR NAME LIKE '%PEDERNALES%')",
        outFields: 'NAME,HOLDING_CO',
      },
      'hifld-territories-bexar',
    )
    return features.map(f => ({
      geometry: toGeoJSONGeometry(f.geometry),
      utility: String(f.attributes['NAME'] ?? '').trim(),
    }))
  } catch (e: any) {
    warn(`HIFLD service territories fetch failed: ${e.message}. Territory will be assumed CPS Energy.`)
    return []
  }
}

// ── Source 6: HIFLD Transmission Lines ───────────────────────────────────────
//
// "Electric Power Transmission Lines" — voltage class is kept as an attribute.
// Distance to a line of 138 kV or above is the siting signal.

const HIFLD_LINES_URL = 'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0'

interface TransLineRecord {
  geometry: Geometry
  voltageKv: number
  coordinates: number[][] // flattened line vertices [[lng,lat], ...]
}

async function fetchTransmissionLines(): Promise<TransLineRecord[]> {
  log('Source 6: HIFLD transmission lines (≥138 kV, near Bexar County)')
  // Bexar County approximate bounding box: -99.5, 29.0, -97.9, 30.0
  try {
    const features = await arcgisFetchAll(
      HIFLD_LINES_URL,
      {
        where: "VOLTAGE >= 138 AND STATE_1 = 'TX'",
        outFields: 'VOLTAGE,VOLT_CLASS,TYPE',
        geometryType:   'esriGeometryEnvelope',
        geometry:       '-99.5,29.0,-97.9,30.0',
        spatialRel:     'esriSpatialRelIntersects',
        inSR:           '4326',
      },
      'hifld-tx-lines-138kv',
    )
    return features.map(f => {
      const v = parseFloat(String(f.attributes['VOLTAGE'] ?? '0'))
      const coords = extractLineCoords(f.geometry)
      return { geometry: toGeoJSONGeometry(f.geometry), voltageKv: isNaN(v) ? 0 : v, coordinates: coords }
    })
  } catch (e: any) {
    warn(`HIFLD transmission lines fetch failed: ${e.message}. Transmission filter will not be applied.`)
    return []
  }
}

function extractLineCoords(g: unknown): number[][] {
  if (!g || typeof g !== 'object') return []
  const geom = g as Record<string, unknown>
  // ArcGIS polyline: { paths: [[[x,y],...]] }
  if (Array.isArray(geom.paths)) {
    return (geom.paths as number[][][]).flat()
  }
  return []
}

// ── Source 9: PeeringDB fiber/IXP ─────────────────────────────────────────────
//
// PeeringDB public API — facilities in San Antonio, TX.

const PEERINGDB_SOURCE = 'https://www.peeringdb.com/api/fac?city=San Antonio&state=TX&country=US'

interface IxpFacility { name: string; lat: number; lon: number }

async function fetchIxpFacilities(): Promise<IxpFacility[]> {
  log('Source 9: PeeringDB IXP/colocation facilities in San Antonio')
  try {
    const data = await cachedFetchJSON(PEERINGDB_SOURCE, 'peeringdb-sanantonio.json') as any
    const facs: IxpFacility[] = (data?.data ?? []).map((d: any) => ({
      name: String(d.name ?? ''),
      lat:  parseFloat(String(d.latitude  ?? 'NaN')),
      lon:  parseFloat(String(d.longitude ?? 'NaN')),
    })).filter((f: IxpFacility) => !isNaN(f.lat) && !isNaN(f.lon))
    log(`  ${facs.length} PeeringDB facilities found`)
    return facs
  } catch (e: any) {
    warn(`PeeringDB fetch failed: ${e.message}. Fiber proximity will be assumed.`)
    return []
  }
}

// ── Source 10: Texas Comptroller Property Value Study ─────────────────────────
//
// Bexar CAD level-of-appraisal ratio for category F1 (commercial real property).
// 2024 PVS study. If F1 ratio unavailable, fall back to county aggregate.
// https://comptroller.texas.gov/taxes/property-tax/pvs/pvs-2024-summary.php
//
// The study publishes ratios per appraisal district per category.
// Bexar CAD codes: F1=Commercial real property, F2=Industrial real property.
// 2024 study values (hand-sourced from the published PDF):
//   F1 level-of-appraisal ratio: 0.93
//   F2 level-of-appraisal ratio: 0.91 (used for industrial parcels)
//   County aggregate ratio:      0.94
//
// These are NOT fetched programmatically — the Comptroller publishes PDFs.
// Docling (IBM tool) would be needed to parse them at run time; the values
// below are hand-read from the 2024 study and carry basis='modeled' + method.

const PVS_RATIOS: Record<string, { ratio: number; category: string }> = {
  'F1': { ratio: 0.93, category: 'F1 (Commercial real property)' },
  'F2': { ratio: 0.91, category: 'F2 (Industrial real property)' },
  'D1': { ratio: 0.85, category: 'D1 (Open-space ag land)' },
  '__aggregate__': { ratio: 0.94, category: 'Bexar CAD aggregate (all categories)' },
}
const PVS_YEAR   = '2024'
const PVS_SOURCE = 'https://comptroller.texas.gov/taxes/property-tax/pvs/pvs-2024-summary.php'

function pvsCategoryForStateCode(stateCode: string): string {
  if (stateCode.startsWith('F1')) return 'F1'
  if (stateCode.startsWith('F2') || stateCode.startsWith('C2')) return 'F2'
  if (stateCode.startsWith('D'))  return 'D1'
  return '__aggregate__'
}

// ── Geometry helpers (simple point-in-polygon & distance) ──────────────────────

/** Return the centroid of a polygon's outer ring (first ring, first path). */
function polygonCentroid(coords: number[][][]): [number, number] {
  const ring = coords[0] ?? []
  if (ring.length === 0) return [0, 0]
  let lng = 0, lat = 0
  for (const [x, y] of ring) { lng += x; lat += y }
  return [lng / ring.length, lat / ring.length]
}

function geometryCentroid(g: Geometry): [number, number] | null {
  if (!g) return null
  if (g.type === 'Polygon')      return polygonCentroid(g.coordinates)
  if (g.type === 'MultiPolygon') return polygonCentroid(g.coordinates[0] ?? [[]])
  return null
}

/** Haversine distance in metres between two [lon, lat] points. */
function distanceM(a: [number, number], b: [number, number]): number {
  const R  = 6_371_000
  const φ1 = a[1] * Math.PI / 180
  const φ2 = b[1] * Math.PI / 180
  const Δφ = (b[1] - a[1]) * Math.PI / 180
  const Δλ = (b[0] - a[0]) * Math.PI / 180
  const x  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
}

/** Minimum distance from a point to any vertex in a set of line segments (metres). */
function minDistToLines(pt: [number, number], lines: TransLineRecord[]): number {
  let min = Infinity
  for (const ln of lines) {
    for (const [x, y] of ln.coordinates) {
      const d = distanceM(pt, [x, y])
      if (d < min) min = d
    }
  }
  return min
}

/** Point-in-polygon test (ray casting, lon/lat). */
function pointInPolygon(pt: [number, number], ring: number[][]): boolean {
  let inside = false
  const [px, py] = pt
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function pointInGeometry(pt: [number, number], g: Geometry): boolean {
  if (!g) return false
  if (g.type === 'Polygon') return g.coordinates.some((ring, i) => {
    const inRing = pointInPolygon(pt, ring)
    return i === 0 ? inRing : !inRing   // outer ring in, holes out
  })
  if (g.type === 'MultiPolygon') {
    return g.coordinates.some(poly => pointInGeometry(pt, { type: 'Polygon', coordinates: poly }))
  }
  return false
}

// ── Driver builder ─────────────────────────────────────────────────────────────

function driverValue(
  value: number | null,
  basis: DriverValue['basis'],
  source_url: string,
  method?: string,
  low?: number | null,
  high?: number | null,
): DriverValue {
  const d: DriverValue = { value, basis, source_url, last_verified: TODAY }
  if (low  !== undefined) d.low  = low
  if (high !== undefined) d.high = high
  if (method) d.method = method
  return d
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== ingestParcels.ts — Bexar County candidate parcel layer ===\n')

  // ── Fetch all sources in parallel where independent ──────────────────────────
  console.log('Fetching sources...')
  const [bcadRaw, zoningPolygons, floodZones, territories, txLines, ixpFacilities] =
    await Promise.allSettled([
      fetchBcadParcels(),
      fetchZoningPolygons(),
      fetchFloodZones(),
      fetchServiceTerritories(),
      fetchTransmissionLines(),
      fetchIxpFacilities(),
    ])

  const parcels       = bcadRaw.status        === 'fulfilled' ? bcadRaw.value        : []
  const zones         = zoningPolygons.status === 'fulfilled' ? zoningPolygons.value : []
  const floods        = floodZones.status     === 'fulfilled' ? floodZones.value     : []
  const utilities     = territories.status    === 'fulfilled' ? territories.value    : []
  const lines         = txLines.status        === 'fulfilled' ? txLines.value        : []
  const ixps          = ixpFacilities.status  === 'fulfilled' ? ixpFacilities.value  : []

  if (bcadRaw.status !== 'fulfilled')
    warn(`BCAD fetch failed: ${(bcadRaw as PromiseRejectedResult).reason}`)

  const hasZoning  = zones.length  > 0
  const hasFlood   = floods.length > 0
  const hasLines   = lines.length  > 0

  console.log(`\n── Funnel ──────────────────────────────────────────────────────`)
  console.log(`  Raw BCAD parcels fetched (pre-filter): ${parcels.length}`)

  // ── Stage 1: Acreage ≥ MIN_ACRES ─────────────────────────────────────────────
  const afterAcres = parcels.filter(p => (p.acres ?? 0) >= MIN_ACRES)
  console.log(`  After acreage ≥ ${MIN_ACRES} ac:          ${afterAcres.length}  (dropped ${parcels.length - afterAcres.length})`)

  // ── Stage 2: Land use — industrial / commercial / ag / vacant ─────────────────
  const afterLandUse = afterAcres.filter(p => {
    if (!p.stateCode) return false   // no state code = unknown, drop
    // Explicit exclude list wins
    for (const exc of EXCLUDED_STATE_CODES) if (p.stateCode.startsWith(exc)) return false
    // Allow list
    for (const inc of ALLOWED_STATE_CODES) if (p.stateCode.startsWith(inc)) return true
    return false
  })
  console.log(`  After land-use filter (F1/F2/C1/C2/D/E/G): ${afterLandUse.length}  (dropped ${afterAcres.length - afterLandUse.length})`)

  // ── Stage 3: Zoning ───────────────────────────────────────────────────────────
  // A parcel passes if:
  //   (a) zoning data unavailable (gap) → pass with flag
  //   (b) parcel is outside San Antonio city limits (zones list empty for that point) → pass
  //   (c) zoning prefix is in INDUSTRIAL_ZONING_PREFIXES
  type ZoningStatus = 'industrial' | 'outside-limits' | 'unknown-gap' | 'rejected'
  function zoningStatus(centroid: [number, number]): ZoningStatus {
    if (!hasZoning) return 'unknown-gap'
    // Find the zone polygon containing this centroid
    for (const z of zones) {
      if (!z.geometry) continue
      if (pointInGeometry(centroid, z.geometry)) {
        const prefix = INDUSTRIAL_ZONING_PREFIXES.find(p => z.zoning.startsWith(p))
        return prefix ? 'industrial' : 'rejected'
      }
    }
    // No city-limit polygon contained this point → outside limits
    return 'outside-limits'
  }

  const afterZoning: typeof afterLandUse = []
  for (const p of afterLandUse) {
    const centroid = geometryCentroid(p.geometry)
    if (!centroid) continue
    const zs = zoningStatus(centroid)
    if (zs !== 'rejected') afterZoning.push(p)
  }
  console.log(`  After zoning filter:               ${afterZoning.length}  (dropped ${afterLandUse.length - afterZoning.length})`)

  // ── Stage 4: Flood — drop 100-yr, flag 500-yr ─────────────────────────────────
  type FloodStatus = 'clear' | 'flag500' | 'drop100' | 'no-data'
  function floodStatus(centroid: [number, number]): FloodStatus {
    if (!hasFlood) return 'no-data'
    for (const fz of floods) {
      if (!fz.geometry) continue
      if (pointInGeometry(centroid, fz.geometry)) {
        const z = fz.floodZone
        if (FLOOD_DROP_ZONES.has(z))               return 'drop100'
        if (FLOOD_FLAG_ZONES.has(z.replace('_', ''))) return 'flag500'
      }
    }
    return 'clear'
  }

  const afterFlood: typeof afterZoning = []
  for (const p of afterZoning) {
    const centroid = geometryCentroid(p.geometry)
    if (!centroid) continue
    const fs = floodStatus(centroid)
    if (fs !== 'drop100') afterFlood.push(p)
  }
  console.log(`  After flood filter (drop 100-yr):  ${afterFlood.length}  (dropped ${afterZoning.length - afterFlood.length})`)

  // ── Stage 5: Transmission proximity ≤ 8 km of ≥138 kV ───────────────────────
  const afterTx: typeof afterFlood = []
  for (const p of afterFlood) {
    if (!hasLines) { afterTx.push(p); continue }  // no data → pass through
    const centroid = geometryCentroid(p.geometry)
    if (!centroid) continue
    const d = minDistToLines(centroid, lines)
    if (d <= MAX_DIST_TO_HIFLD_TX_M) afterTx.push(p)
  }
  console.log(`  After transmission filter (≤${MAX_DIST_TO_HIFLD_TX_M/1000}km ≥138kV): ${afterTx.length}  (dropped ${afterFlood.length - afterTx.length})`)
  console.log(`  ═══════════════════════════════════════════════════════`)
  console.log(`  CANDIDATE PARCELS: ${afterTx.length}`)

  if (!hasZoning)  warn('Zoning data unavailable — parcels passed without zoning check.')
  if (!hasFlood)   warn('Flood data unavailable — flood filter not applied.')
  if (!hasLines)   warn('Transmission line data unavailable — proximity filter not applied.')

  // ── Build GeoJSON features ────────────────────────────────────────────────────
  console.log('\nBuilding GeoJSON features...')

  const features: Feature[] = afterTx.map(p => {
    const centroid   = geometryCentroid(p.geometry) ?? [0, 0]
    const acres      = p.acres ?? 0

    // ── Zoning tag ──────────────────────────────────────────────────────────────
    let zoningTag = 'unknown'
    if (hasZoning) {
      for (const z of zones) {
        if (z.geometry && pointInGeometry(centroid, z.geometry)) { zoningTag = z.zoning; break }
      }
      if (zoningTag === 'unknown') zoningTag = 'outside-city-limits'
    } else {
      zoningTag = 'gap'
    }

    // ── Utility tag ─────────────────────────────────────────────────────────────
    let utilityTag = 'assumed-CPS-Energy'
    if (utilities.length > 0) {
      for (const t of utilities) {
        if (t.geometry && pointInGeometry(centroid, t.geometry)) { utilityTag = t.utility; break }
      }
    }

    // ── Flood flag ──────────────────────────────────────────────────────────────
    const fs = floodStatus(centroid)
    const inFloodFlag = fs === 'flag500'

    // ── Distance to nearest 138+ kV line (metres) ─────────────────────────────
    let distToTxLineM: number | null = null
    if (hasLines) {
      distToTxLineM = Math.round(minDistToLines(centroid, lines))
    }

    // ── PeeringDB fiber proximity (km to nearest IXP facility) ────────────────
    let distToIxpKm: number | null = null
    if (ixps.length > 0) {
      let best = Infinity
      for (const ixp of ixps) {
        const d = distanceM(centroid, [ixp.lon, ixp.lat]) / 1000
        if (d < best) best = d
      }
      distToIxpKm = Math.round(best * 10) / 10
    }

    // ── Land cost driver — appraised land value to modeled market value ────────
    //
    // Texas is a non-disclosure state. We use the PVS ratio:
    //   market ≈ appraised / PVS_ratio(category)
    //
    // Rule: never present appraised value as market value.
    // Rule: do not value improvements (data center demolishes what's there).
    const pvsCategory = pvsCategoryForStateCode(p.stateCode)
    const { ratio: pvsRatio, category: pvsCatLabel } = PVS_RATIOS[pvsCategory]
    let landCostDriver: DriverValue

    if (p.appraisedLandValue !== null && acres > 0) {
      const appraisedPerAcre = p.appraisedLandValue / acres
      const modeledPerAcre   = appraisedPerAcre / pvsRatio
      landCostDriver = driverValue(
        Math.round(modeledPerAcre),
        'modeled',
        BCAD_SOURCE,
        `BCAD appraised land value per acre (${TODAY}), divided by Texas Comptroller PVS ` +
        `level-of-appraisal ratio for Bexar CAD category ${pvsCatLabel}, ` +
        `PVS year ${PVS_YEAR}; ratio = ${pvsRatio}. ` +
        `Land value only — improvements excluded. ` +
        `Texas non-disclosure state; sale prices not public.`,
        Math.round(modeledPerAcre * 0.80),   // rough low: 20% below model
        Math.round(modeledPerAcre * 1.20),   // rough high: 20% above model
      )
    } else {
      // No appraised value in this BCAD record — record gap, use San Antonio market average
      landCostDriver = driverValue(
        55_000,   // $/acre — San Antonio industrial market average from us-tx-ercot baseline
        'assumed',
        BCAD_SOURCE,
        `BCAD appraised land value not available for parcel ${p.parcelId}; ` +
        `using San Antonio industrial land market average of $55,000/acre from ` +
        `us-tx-ercot baseline (${TODAY}). Replace when BCAD record is complete.`,
      )
    }

    // ── Power rate driver — CPS Energy large C&I tariff ───────────────────────
    //
    // CPS Energy Rate Schedule LG (Large General Service).
    // Published tariff (March 2024): demand charge $19.26/kW-mo + energy $0.03851/kWh
    // For a 10 MW data center at 8760 hours: effective blended ≈ $0.0385/kWh (energy only).
    // Full tariff at https://www.cpsenergy.com/content/dam/doc/rates/LG.pdf
    const cpsPowerRate = 0.0385  // $/kWh — CPS Energy Schedule LG energy charge (March 2024)
    const powerRateDriver = driverValue(
      cpsPowerRate,
      'sourced',
      'https://www.cpsenergy.com/content/dam/doc/rates/LG.pdf',
      undefined,
      0.033,
      0.045,
    )
    powerRateDriver.last_verified = '2024-03'

    // ── Water rate driver — SAWS ───────────────────────────────────────────────
    //
    // San Antonio Water System (SAWS) commercial rate (FY2024).
    // SAWS Uniform Rate Schedule, Tier 3+: $7.51/kgal for heavy commercial.
    // Source: https://www.saws.org/your-account/rates/
    const sawsWaterRate = 7.51   // $/kgal
    const waterRateDriver = driverValue(
      sawsWaterRate,
      'sourced',
      'https://www.saws.org/your-account/rates/',
      undefined,
      6.50,
      8.50,
    )
    waterRateDriver.last_verified = '2024-07'

    // ── ERCOT interconnection — placeholder (real queue PDF requires Docling) ──
    //
    // The work order notes that the ERCOT large-load queue is the binding
    // constraint in 2026 and that parsing it requires Docling (IBM tool).
    // The queue PDFs are at https://www.ercot.com/services/rq/large-load-integration
    // and the TAC / board reports. Docling is not available as a Node package;
    // the recommended path is a Python Docling subprocess or pre-processed JSON.
    // Until that pipeline exists, this driver is assumed with a flag to replace it.
    const ercotIxDriver = driverValue(
      null,
      'assumed',
      'https://www.ercot.com/services/rq/large-load-integration',
      `ERCOT large-load interconnection queue wait time for Bexar County parcels. ` +
      `Queue data is published as PDFs at the source URL and requires Docling ` +
      `(IBM tool) to parse programmatically. Placeholder null — replace by running ` +
      `the Docling pipeline against the latest ERCOT TAC board report PDF.`,
    )

    // ── Drivers object ─────────────────────────────────────────────────────────
    const drivers: Record<string, DriverValue> = {
      land_cost_per_acre_usd:   landCostDriver,
      power_rate_usd_per_kwh:   powerRateDriver,
      water_rate_usd_per_kgal:  waterRateDriver,
      grid_interconnection_years: ercotIxDriver,
    }

    return {
      type: 'Feature',
      geometry: p.geometry,
      properties: {
        parcel_id:          p.parcelId,
        address:            p.address,
        acres:              p.acres,
        jurisdiction:       utilityTag.includes('CPS') ? 'City of San Antonio (CPS Energy territory)' : utilityTag,
        zoning:             zoningTag,
        in_500yr_flood:     inFloodFlag,
        dist_to_tx_line_m:  distToTxLineM,
        dist_to_ixp_km:     distToIxpKm,
        utility:            utilityTag,
        state_code:         p.stateCode,
        drivers,
      },
    }
  })

  // ── Write output ──────────────────────────────────────────────────────────────
  const fc: FeatureCollection = { type: 'FeatureCollection', features }
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(fc, null, 2))
  console.log(`\n✓ Wrote ${features.length} candidate parcels to ${OUT_PATH}`)

  // ── Coverage table ────────────────────────────────────────────────────────────
  if (features.length > 0) {
    console.log('\n── Driver coverage table ───────────────────────────────────────')
    const drivers = ['land_cost_per_acre_usd', 'power_rate_usd_per_kwh', 'water_rate_usd_per_kgal', 'grid_interconnection_years']
    const header = 'Driver'.padEnd(36) + 'Sourced'.padStart(8) + 'Modeled'.padStart(8) + 'Assumed'.padStart(8) + 'Missing'.padStart(8)
    console.log('  ' + header)
    console.log('  ' + '-'.repeat(header.length))
    for (const drv of drivers) {
      let sourced = 0, modeled = 0, assumed = 0, missing = 0
      for (const f of features) {
        const d = (f.properties.drivers as Record<string, DriverValue>)[drv]
        if (!d || d.value === null) { missing++; continue }
        if (d.basis === 'sourced') sourced++
        else if (d.basis === 'modeled') modeled++
        else assumed++
      }
      console.log('  ' +
        drv.padEnd(36) +
        String(sourced).padStart(8) +
        String(modeled).padStart(8) +
        String(assumed).padStart(8) +
        String(missing).padStart(8)
      )
    }

    // Gap sources
    if (!hasZoning)  console.log('\n  GAP: COSA zoning polygons — endpoint unreachable; parcels unfiltered by zoning')
    if (!hasFlood)   console.log('  GAP: FEMA NFHL flood zones — endpoint unreachable; flood filter skipped')
    if (!hasLines)   console.log('  GAP: HIFLD transmission lines — endpoint unreachable; proximity filter skipped')
    if (ixps.length === 0) console.log('  GAP: PeeringDB — endpoint unreachable; IXP distances not computed')
    console.log('\n  NOTE: ERCOT large-load queue (grid_interconnection_years) requires Docling PDF')
    console.log('  pipeline to populate. See https://www.ercot.com/services/rq/large-load-integration')
  }

  console.log('\n=== ingestParcels.ts complete ===\n')
}

main().catch(err => {
  console.error('ingestParcels.ts fatal error:', err)
  process.exit(1)
})
