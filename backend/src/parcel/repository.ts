/**
 * backend/src/parcel/repository.ts
 *
 * The ONLY module that reads parcel files.
 * All other backend code that needs parcel data goes through this interface.
 *
 * File-backed implementation reads data/parcels/<county>.rows.json.
 * PostGIS arrives at county two behind the same interface — one new
 * implementation, zero rewrites of callers.
 *
 * Invariant (acceptance test):
 *   grep -rn "parcels/.*\.geojson\|rows\.json" backend/src --include=*.ts
 *   must match only repository.ts and the ingest pipeline.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR  = resolve(__dirname, '../../../data/parcels')

// ── Public types ───────────────────────────────────────────────────────────────

export interface DriverValue {
  value:         number | null
  low?:          number | null
  high?:         number | null
  basis:         'sourced' | 'modeled' | 'assumed'
  source_url:    string
  last_verified: string
  method?:       string
}

export interface ParcelRow {
  parcel_id:         string
  address:           string
  acres:             number | null
  acres_source:      'Acres' | 'LglAcres'
  jurisdiction:      string
  zoning:            string
  flood_buildable_pct: number | null   // 1 = fully buildable; null = no flood data
  in_500yr_flood:    boolean
  dist_to_tx_line_m: number | null
  dist_to_ixp_km:    number | null
  utility:           string
  state_code:        string
  lat:               number | null
  lng:               number | null
  geometry_wkt:      string | null
  drivers:           Record<string, DriverValue>
}

export interface BboxQuery {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

// ── Repository interface ───────────────────────────────────────────────────────

export interface ParcelRepository {
  /** Return all parcels for the county. */
  listParcels(county: string): ParcelRow[]

  /** Return a single parcel by ID, or null if not found. */
  getParcel(county: string, parcelId: string): ParcelRow | null

  /** Return all parcels whose centroid falls inside the bbox. */
  queryByBbox(county: string, bbox: BboxQuery): ParcelRow[]
}

// ── File-backed implementation ────────────────────────────────────────────────

/** Cache so we only read + parse once per county per process lifetime. */
const _cache: Map<string, ParcelRow[]> = new Map()

/**
 * A county id becomes a filesystem path, so it is validated here rather than
 * trusted. The routes already reject unknown counties against a registry, but
 * this module is a public interface: any later caller — a script, the criteria
 * parser, a second route — could pass a value straight from a request. A county
 * of "../../../etc/passwd" would otherwise escape DATA_DIR entirely.
 *
 * Lowercase letters, digits and hyphens are enough for every county id we use.
 */
const COUNTY_ID = /^[a-z0-9-]+$/

function loadCounty(county: string): ParcelRow[] {
  if (_cache.has(county)) return _cache.get(county)!
  if (!COUNTY_ID.test(county)) {
    throw new Error(`invalid county id: ${JSON.stringify(county)}`)
  }
  const path = resolve(DATA_DIR, `${county}.rows.json`)
  // Belt and braces: even a regex-clean id must land inside the data directory.
  if (!path.startsWith(DATA_DIR)) {
    throw new Error(`county id escapes the data directory: ${JSON.stringify(county)}`)
  }
  const rows: ParcelRow[] = JSON.parse(readFileSync(path, 'utf-8'))
  const deduped = oneRowPerParcel(rows)
  _cache.set(county, deduped)
  return deduped
}

/** Coordinate pairs in a WKT ring, counted cheaply. Null geometry counts zero. */
function vertexCount(wkt: string | null): number {
  if (!wkt) return 0
  let n = 0
  for (let i = 0; i < wkt.length; i++) if (wkt.charCodeAt(i) === 44 /* , */) n++
  return n
}

/**
 * One row per parcel id.
 *
 * The Bexar file carries 3,046 rows for 3,040 distinct parcels. Three of the
 * six repeats are byte-identical, which is the county service returning the
 * same feature twice. The other three share an id and an acreage but carry
 * different rings: a multi-part parcel arrives as one feature per part, and
 * each part is stamped with the whole parcel's acreage.
 *
 * Left alone that counted six plots twice in the headline, entered them twice
 * in the ranking, and for the multi-part ones measured the distance to
 * transmission from a fragment rather than from the parcel. The row with the
 * most vertices is the main body, and its centroid is the one worth measuring
 * from, so that is the row kept.
 *
 * This lives here rather than in the ingest because this module is the only
 * way parcel data reaches the rest of the backend, so a stale data file or a
 * future county with the same habit is covered without a re-run.
 */
export function oneRowPerParcel(rows: ParcelRow[]): ParcelRow[] {
  const best = new Map<string, ParcelRow>()
  for (const r of rows) {
    const held = best.get(r.parcel_id)
    if (!held || vertexCount(r.geometry_wkt) > vertexCount(held.geometry_wkt)) {
      best.set(r.parcel_id, r)
    }
  }
  // Map preserves insertion order, so the file's order survives for the rows
  // that were never duplicated, which keeps every downstream sort stable.
  return [...best.values()]
}

export const fileRepository: ParcelRepository = {
  listParcels(county) {
    return loadCounty(county)
  },

  getParcel(county, parcelId) {
    return loadCounty(county).find(r => r.parcel_id === parcelId) ?? null
  },

  queryByBbox(county, bbox) {
    return loadCounty(county).filter(r => {
      if (r.lng === null || r.lat === null) return false
      return (
        r.lng >= bbox.minLng && r.lng <= bbox.maxLng &&
        r.lat >= bbox.minLat && r.lat <= bbox.maxLat
      )
    })
  },
}

/** Default export — the active implementation. Swap for PostGIS here. */
export const parcelRepository: ParcelRepository = fileRepository
