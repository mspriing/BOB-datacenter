/**
 * backend/tests/parcelDuplicates.test.ts
 *
 * A parcel that appears twice is still one parcel.
 *
 * The Bexar ingest wrote 3,046 rows for 3,040 distinct ids. Three repeats are
 * byte-identical features the county service returned twice. The other three
 * share an id and an acreage while carrying different rings, because a
 * multi-part parcel arrives as one feature per part and every part is stamped
 * with the whole parcel's acreage.
 *
 * Left in, those six were counted twice in the headline and ranked twice in the
 * list, and the multi-part ones could be measured to the transmission line from
 * a fragment instead of from the body of the parcel.
 */

import { describe, it, expect } from 'vitest'
import { fileRepository, oneRowPerParcel, type ParcelRow } from '../src/parcel/repository.js'

function row(over: Partial<ParcelRow>): ParcelRow {
  return {
    parcel_id: 'x', address: 'A', acres: 30, acres_source: 'Acres',
    jurisdiction: '', zoning: 'outside-jurisdiction',
    flood_buildable_pct: null, in_500yr_flood: false,
    dist_to_tx_line_m: 100, dist_to_ixp_km: 1,
    utility: '', state_code: 'E1', lat: 29, lng: -98,
    geometry_wkt: null, drivers: {}, ...over,
  }
}

describe('one row per parcel', () => {
  it('keeps a single row when the same id appears twice', () => {
    const out = oneRowPerParcel([row({ parcel_id: 'a' }), row({ parcel_id: 'a' })])
    expect(out).toHaveLength(1)
  })

  it('keeps the part with the most vertices, which is the body of the parcel', () => {
    const fragment = row({ parcel_id: 'a', geometry_wkt: 'POLYGON((0 0,1 0,0 0))', dist_to_tx_line_m: 1804 })
    const body = row({ parcel_id: 'a', geometry_wkt: 'POLYGON((0 0,1 0,1 1,0 1,2 2,3 3,0 0))', dist_to_tx_line_m: 1743 })
    expect(oneRowPerParcel([fragment, body])[0].dist_to_tx_line_m).toBe(1743)
    // Order in the file must not decide which row wins.
    expect(oneRowPerParcel([body, fragment])[0].dist_to_tx_line_m).toBe(1743)
  })

  it('leaves rows that were never duplicated in the order the file had them', () => {
    const out = oneRowPerParcel([row({ parcel_id: 'a' }), row({ parcel_id: 'b' }), row({ parcel_id: 'c' })])
    expect(out.map(r => r.parcel_id)).toEqual(['a', 'b', 'c'])
  })

  it('hands the rest of the backend a Bexar set with no id twice over', () => {
    const rows = fileRepository.listParcels('bexar')
    const ids = new Set(rows.map(r => r.parcel_id))
    expect(ids.size).toBe(rows.length)
    expect(rows).toHaveLength(3040)
  })

  it('drops only the repeats, so every distinct parcel survives', () => {
    const rows = fileRepository.listParcels('bexar')
    for (const id of ['1264011', '351390', '700741', '1060569', '159352', '323221']) {
      expect(rows.filter(r => r.parcel_id === id)).toHaveLength(1)
    }
  })
})
