/**
 * backend/src/parcel/spatialIndex.ts
 *
 * Flatbush-backed spatial index for fast bbox queries over parcel centroids.
 *
 * Rule: reads through repository only.
 * Rule: one index per county, built once and cached for the process lifetime.
 *
 * flatbush stores bounding boxes. A point centroid is inserted as a
 * degenerate box [lng, lat, lng, lat].
 */

import Flatbush from 'flatbush'
import type { ParcelRow } from './repository.js'

interface ParcelIndex {
  index:   Flatbush
  rows:    ParcelRow[]   // parallel array — index position i → rows[i]
}

const _cache: Map<string, ParcelIndex> = new Map()

/**
 * Build (or return cached) Flatbush index for a county's loaded rows.
 * @param countyId - e.g. 'bexar'
 * @param rows     - all loaded rows for this county
 */
export function getOrBuildIndex(countyId: string, rows: ParcelRow[]): ParcelIndex {
  if (_cache.has(countyId)) return _cache.get(countyId)!

  // Filter to only rows with valid centroid before building — Flatbush requires
  // a known count up front and cannot be built with null coordinates.
  const indexable = rows.filter(r => r.lat !== null && r.lng !== null)

  const fb = new Flatbush(indexable.length)
  for (const r of indexable) {
    fb.add(r.lng!, r.lat!, r.lng!, r.lat!)
  }
  fb.finish()

  const idx: ParcelIndex = { index: fb, rows: indexable }
  _cache.set(countyId, idx)
  return idx
}

/**
 * Return rows whose centroids fall inside the given bounding box.
 * Flatbush returns candidate indices; we verify with an exact containment
 * check (Flatbush is exact for point-in-bbox, but be defensive).
 */
export function queryBbox(
  pi: ParcelIndex,
  minLng: number, minLat: number,
  maxLng: number, maxLat: number,
): ParcelRow[] {
  const candidates = pi.index.search(minLng, minLat, maxLng, maxLat)
  return candidates
    .map(i => pi.rows[i])
    .filter(r =>
      r.lng! >= minLng && r.lng! <= maxLng &&
      r.lat! >= minLat && r.lat! <= maxLat
    )
}

/** Clear cache — for testing only. */
export function _clearIndexCache(): void {
  _cache.clear()
}
