/**
 * backend/tests/parcelLandBasis.test.ts
 *
 * Land is charged for the WHOLE parcel, not the acreage a campus of this size
 * needs. A seller will not split 12 acres off an 85-acre listing, and this tool
 * prices acquisition.
 *
 * The engine still sizes land its own way for the region tool; the parcel layer
 * charges the difference through the incentive offset, so backend/src/engine/
 * stays untouched.
 */

import { describe, it, expect } from 'vitest'
import { estimateParcel, type ParcelProject } from '../src/parcel/score.js'
import type { ParcelRow } from '../src/parcel/repository.js'
import { bexarConfig } from '../src/ingest/counties/bexar.js'

const PER_ACRE = 40_000

function row(acres: number): ParcelRow {
  return {
    parcel_id: `p-${acres}`,
    address: 'TEST RD',
    acres,
    acres_source: 'Acres',
    jurisdiction: 'unincorporated',
    zoning: 'outside-jurisdiction',
    flood_buildable_pct: 1,
    in_500yr_flood: false,
    dist_to_tx_line_m: 1000,
    dist_to_ixp_km: 10,
    utility: 'assumed-CPS-Energy',
    state_code: 'F2',
    lat: 29.4, lng: -98.6,
    geometry_wkt: null,
    drivers: {
      land_cost_per_acre_usd: { value: PER_ACRE, basis: 'modeled', source_url: 't', last_verified: '2026-08' },
      power_rate_usd_per_kwh: { value: 0.0385, basis: 'sourced', source_url: 't', last_verified: '2026-08' },
      water_rate_usd_per_kgal: { value: 7.51, basis: 'sourced', source_url: 't', last_verified: '2026-08' },
      grid_interconnection_years: { value: null, basis: 'assumed', source_url: 't', last_verified: '2026-08' },
    },
  }
}

const PROJECT: ParcelProject = {
  capacity_kw: 10_000, design_pue: 1.4, design_wue: 0.4,
  lifetime_years: 20, discount_rate: 0.08,
}

describe('land is charged for the whole parcel', () => {
  it('reports land equal to acres x price per acre', () => {
    const e = estimateParcel(row(85), PROJECT, bexarConfig)
    expect(e.capex.land_usd).toBeCloseTo(85 * PER_ACRE, 0)
    expect(e.parcel_capex.land_cost_usd).toBeCloseTo(85 * PER_ACRE, 0)
  })

  it('keeps the printed components summing to the total', () => {
    const e = estimateParcel(row(85), PROJECT, bexarConfig)
    const parts =
      e.capex.land_usd + e.capex.construction_usd + e.capex.electrical_usd +
      e.capex.cooling_usd + e.capex.it_fitout_usd
    const extras =
      e.parcel_capex.interconnect_capex_usd + e.parcel_capex.fiber_capex_usd +
      e.parcel_capex.entitlement_cost_usd + e.parcel_capex.sitework_usd

    expect(e.capex.total_usd).toBeCloseTo(parts + extras, 0)
  })

  it('makes a larger parcel cost more at the same price per acre', () => {
    const small = estimateParcel(row(30), PROJECT, bexarConfig)
    const large = estimateParcel(row(300), PROJECT, bexarConfig)

    // Under the old basis both charged 12 acres, so these were equal — which is
    // exactly the behaviour this test exists to prevent coming back.
    expect(large.capex.land_usd).toBeGreaterThan(small.capex.land_usd)
    expect(large.capex.total_usd).toBeGreaterThan(small.capex.total_usd)
    expect(large.finance.lifetime_cost_per_kw).toBeGreaterThan(small.finance.lifetime_cost_per_kw)
  })
})
