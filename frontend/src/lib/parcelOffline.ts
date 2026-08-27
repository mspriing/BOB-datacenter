/**
 * What the parcel screens read when the parcel service does not answer.
 *
 * api.ts sets the rule this file has to live inside: anything a user is asked
 * to trust as a published fact comes from the server or it is not shown. So
 * this is not a second engine and it does not compute anything. It is a
 * recording of the server's own replies, captured on the date stamped in the
 * snapshot file, replayed when the request fails.
 *
 * Two things follow from that, and both are said on screen rather than hidden:
 *
 *   1. The figures are as old as the capture date. They are the server's
 *      output for the default project parameters, not for whatever parameters
 *      the user has since set.
 *   2. Ranking is the server's ranking of the whole county. The live service
 *      re-normalizes the score across whatever set the filters leave, so a
 *      filtered list here keeps the county order and renumbers down it. Order
 *      is the server's; the numbers beside the rows are positions in the
 *      filtered list.
 *
 * Filtering, sorting and paging mirror backend/src/routes/parcels.ts, including
 * the rule that a parcel missing the figure being sorted on goes to the end of
 * the list in either direction.
 */
import snapshot from '../data/parcelSnapshot.json'
import details from '../data/parcelDetailSnapshot.json'
import type { ParcelSummary, ParcelListResponse, ParcelQuery } from './parcelApi'

const ROWS = snapshot.parcels as unknown as ParcelSummary[]
const DETAILS = details.parcels as unknown as Record<string, unknown>

/** The date the replies in the snapshot were recorded, for the on-screen note. */
export const SNAPSHOT_DATE = snapshot.captured_at as string
export const SNAPSHOT_TOTAL = snapshot.total as number

function missingLast(
  av: number | null | undefined,
  bv: number | null | undefined,
  compare: (x: number, y: number) => number,
): number {
  const a = typeof av === 'number' && Number.isFinite(av) ? av : null
  const b = typeof bv === 'number' && Number.isFinite(bv) ? bv : null
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return compare(a, b)
}

export function offlineParcels(q: ParcelQuery): ParcelListResponse {
  let rows = ROWS

  if (q.min_acres !== undefined)
    rows = rows.filter(r => r.acres !== null && r.acres >= q.min_acres!)
  if (q.max_acres !== undefined)
    rows = rows.filter(r => r.acres !== null && r.acres <= q.max_acres!)
  if (q.max_land_cost_per_acre !== undefined)
    rows = rows.filter(r => r.land_cost_per_acre_usd !== null
      && r.land_cost_per_acre_usd <= q.max_land_cost_per_acre!)
  if (q.max_dist_tx_m !== undefined)
    rows = rows.filter(r => r.dist_to_tx_line_m !== null
      && r.dist_to_tx_line_m <= q.max_dist_tx_m!)
  if (q.exclude_flood)
    rows = rows.filter(r => r.flood_buildable_pct === null || r.flood_buildable_pct >= 1.0)

  const sorted = [...rows].sort((a, b) => {
    switch (q.sort_by) {
      case 'acres':
        return missingLast(a.acres, b.acres, (x, y) => y - x)
      case 'lifetime_cost_per_kw':
        return missingLast(a.lifetime_cost_per_kw, b.lifetime_cost_per_kw, (x, y) => x - y)
      case 'land_cost_per_acre':
        return missingLast(a.land_cost_per_acre_usd, b.land_cost_per_acre_usd, (x, y) => x - y)
      default: {
        // Rank 0 means the parcel could not be priced, so it sorts last.
        if (a.rank === 0 && b.rank === 0) return 0
        if (a.rank === 0) return 1
        if (b.rank === 0) return -1
        return a.rank - b.rank
      }
    }
  })

  // Renumber down the filtered list, which is what the live service does after
  // it re-scores. Parcels it could not price keep rank 0 and stay unranked.
  const renumbered = sorted.map((r, i) => ({ ...r, rank: r.rank === 0 ? 0 : i + 1 }))

  const page = q.page ?? 1
  const perPage = q.per_page ?? 50
  return {
    county: q.county ?? 'bexar',
    total: renumbered.length,
    page,
    per_page: perPage,
    parcels: renumbered.slice((page - 1) * perPage, page * perPage),
  }
}

/**
 * The snapshot holds the full estimate for the parcels that sit at the top of
 * each of the four sorts the screen offers, which is what a reader can reach
 * without changing a filter. Anything else returns null and the detail screen
 * says the full estimate needs the live service.
 */
export function offlineParcel(id: string): unknown | null {
  return DETAILS[id] ?? null
}
