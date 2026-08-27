/**
 * backend/src/parcel/geometry.ts
 *
 * Parcel outlines, small enough to send.
 *
 * The map drew a dot per parcel because a dot is all the API sent. A dot tells
 * you a parcel is somewhere near a point; it does not tell you the shape of the
 * plot, which is most of what a siting reader is looking at. A 30 acre square
 * and a 30 acre roadside ribbon price the same here and build very differently.
 *
 * The ingest already stores the outline as WKT. Two things stop it going
 * straight out over the wire: it is a string the browser would have to parse,
 * and the longest one in Bexar is 95 kB on its own. So it is parsed here into
 * GeoJSON, thinned, and rounded.
 */
import { simplify } from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'

/** Six decimal places is about 0.1 m at this latitude, well past what a map needs. */
const PRECISION = 6

/**
 * Thinning tolerance in degrees. About 2 m. Parcel boundaries are surveyed to
 * the foot, and at any zoom this map reaches, two metres is inside one pixel.
 */
const TOLERANCE = 0.00002

function round(n: number): number {
  const f = 10 ** PRECISION
  return Math.round(n * f) / f
}

/**
 * WKT POLYGON to rings. The county service emits one shape per feature with an
 * optional set of holes, always in `POLYGON((x y, x y), (x y, x y))` form.
 * Anything it cannot read returns null rather than a half-built shape.
 */
export function parseWktPolygon(wkt: string | null): Position[][] | null {
  if (!wkt) return null
  const head = wkt.trimStart().slice(0, 8).toUpperCase()
  if (!head.startsWith('POLYGON')) return null

  const open = wkt.indexOf('(')
  const close = wkt.lastIndexOf(')')
  if (open === -1 || close <= open) return null

  const body = wkt.slice(open + 1, close)
  const rings: Position[][] = []
  // Split on ring boundaries: ")" then optional spaces, a comma, spaces, "(".
  for (const chunk of body.split(/\)\s*,\s*\(/)) {
    const coords: Position[] = []
    for (const pair of chunk.replace(/[()]/g, '').split(',')) {
      const [x, y] = pair.trim().split(/\s+/)
      const lng = Number(x)
      const lat = Number(y)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
      coords.push([round(lng), round(lat)])
    }
    // A ring needs four positions with the first repeated at the end.
    if (coords.length < 4) continue
    const [fx, fy] = coords[0]
    const [lx, ly] = coords[coords.length - 1]
    if (fx !== lx || fy !== ly) coords.push([fx, fy])
    rings.push(coords)
  }
  return rings.length ? rings : null
}

/**
 * The outline a map can draw, or null when the ingest has no usable shape.
 * Thinning runs only on rings dense enough to be worth it, because simplify on
 * a four point square costs more than it saves.
 */
export function parcelOutline(wkt: string | null): Polygon | null {
  const rings = parseWktPolygon(wkt)
  if (!rings) return null

  const raw: Polygon = { type: 'Polygon', coordinates: rings }
  const points = rings.reduce((n, r) => n + r.length, 0)
  if (points <= 12) return raw

  try {
    const thinned = simplify(
      { type: 'Feature', properties: {}, geometry: raw } as Feature<Polygon>,
      { tolerance: TOLERANCE, highQuality: false, mutate: true },
    )
    const g = thinned.geometry
    // simplify can eat a ring down past the four positions a polygon needs.
    const kept = g.coordinates.filter(r => r.length >= 4)
    if (!kept.length) return raw
    return {
      type: 'Polygon',
      coordinates: kept.map(r => r.map(([x, y]) => [round(x as number), round(y as number)])),
    }
  } catch {
    return raw
  }
}
