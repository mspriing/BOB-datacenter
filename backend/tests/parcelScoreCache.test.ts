/**
 * backend/tests/parcelScoreCache.test.ts
 *
 * Regression: scoreAll must honour the rows it is given on a WARM cache.
 *
 * The cost cache was a flat array keyed by county+project, so the `rows`
 * argument was used on the cold run and ignored on every call after it. Each
 * filtered request got the whole county back, which made the filter rail look
 * wired up and do nothing — the API returned 3,046 parcels for min_acres=1000.
 *
 * The existing route tests never caught it because they clear the cache between
 * cases, so they only ever exercised the cold path. These tests deliberately do
 * not clear between the two calls.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { scoreAll, _clearScoreCache, type ParcelProject } from '../src/parcel/score.js'
import type { ParcelRow } from '../src/parcel/repository.js'
import { bexarConfig } from '../src/ingest/counties/bexar.js'

function row(id: string, acres: number): ParcelRow {
  return {
    parcel_id: id,
    address: `${id} TEST RD`,
    acres,
    acres_source: 'Acres',
    jurisdiction: 'unincorporated',
    zoning: 'outside-jurisdiction',
    flood_buildable_pct: 1,
    in_500yr_flood: false,
    dist_to_tx_line_m: 1500,
    dist_to_ixp_km: 12,
    utility: 'assumed-CPS-Energy',
    state_code: 'F2',
    lat: 29.4,
    lng: -98.6,
    geometry_wkt: null,
    drivers: {
      land_cost_per_acre_usd: {
        value: 30_000, basis: 'modeled', source_url: 'test', last_verified: '2026-08',
      },
      power_rate_usd_per_kwh: {
        value: 0.0385, basis: 'sourced', source_url: 'test', last_verified: '2026-08',
      },
      water_rate_usd_per_kgal: {
        value: 7.51, basis: 'sourced', source_url: 'test', last_verified: '2026-08',
      },
      grid_interconnection_years: {
        value: null, basis: 'assumed', source_url: 'test', last_verified: '2026-08',
      },
    },
  }
}

const PROJECT: ParcelProject = {
  capacity_kw: 10_000,
  design_pue: 1.4,
  design_wue: 0.4,
  lifetime_years: 20,
  discount_rate: 0.08,
}

describe('scoreAll — warm cache honours the row set', () => {
  beforeEach(() => { _clearScoreCache() })

  it('returns only the rows it was given after the cache is warm', () => {
    const all = [row('a', 30), row('b', 200), row('c', 1200)]

    const cold = scoreAll(all, PROJECT, bexarConfig)
    expect(cold).toHaveLength(3)

    // Warm call with a subset — this is what a filtered request does.
    const subset = scoreAll([all[2]], PROJECT, bexarConfig)
    expect(subset).toHaveLength(1)
    expect(subset[0].parcel_id).toBe('c')
  })

  it('ranks within the requested subset, so rank 1 is best among matches', () => {
    const all = [row('a', 30), row('b', 200), row('c', 1200)]
    scoreAll(all, PROJECT, bexarConfig)

    const subset = scoreAll([all[1], all[2]], PROJECT, bexarConfig)
    expect(subset.map(e => e.rank).sort()).toEqual([1, 2])
    expect(subset).toHaveLength(2)
  })

  it('prices a parcel not seen on the cold run', () => {
    scoreAll([row('a', 30)], PROJECT, bexarConfig)

    const later = scoreAll([row('a', 30), row('z', 500)], PROJECT, bexarConfig)
    expect(later).toHaveLength(2)
    expect(later.map(e => e.parcel_id).sort()).toEqual(['a', 'z'])
    for (const e of later) expect(e.finance.lifetime_cost_per_kw).toBeGreaterThan(0)
  })
})
