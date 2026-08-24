/**
 * backend/tests/parcelCost.test.ts
 *
 * Task 3 acceptance tests — each component independently:
 *   - A parcel on top of a transmission line (dist=0) adds no spur cost
 *     but still applies the substation allowance.
 *   - A flat parcel adds no extra earthwork beyond the flat rate.
 *   - fiberCapex with null distance returns 0 (gap, not invented).
 *   - entitlementCost varies correctly by zoning status.
 *   - siteworkCost scales linearly with acres.
 *   - computeParcelCapex sums components correctly.
 */

import { describe, it, expect } from 'vitest'
import {
  interconnectCapex,
  fiberCapex,
  entitlementCost,
  entitlementMonths,
  siteworkCost,
  landCost,
  computeParcelCapex,
} from '../src/parcel/cost.js'
import { bexarConfig } from '../src/ingest/counties/bexar.js'
import type { ParcelRow } from '../src/parcel/repository.js'

const cm = bexarConfig.costModel

// ── interconnectCapex ─────────────────────────────────────────────────────────

describe('interconnectCapex', () => {
  it('dist=0: spur cost is 0, substation allowance still applied', () => {
    const result = interconnectCapex(0, 8000, cm)
    expect(result).toBe(cm.substationAllowanceUsd)   // no spur, just substation
  })

  it('dist=1000m: cost = 1000 * spurPerM + substationAllowance', () => {
    const expected = Math.round(1000 * cm.txSpurCostPerMeterUsd + cm.substationAllowanceUsd)
    expect(interconnectCapex(1000, 8000, cm)).toBe(expected)
  })

  it('null dist: uses maxDistM as conservative fallback', () => {
    const withNull  = interconnectCapex(null, 8000, cm)
    const withMax   = interconnectCapex(8000, 8000, cm)
    expect(withNull).toBe(withMax)
  })

  it('is greater than or equal to substationAllowanceUsd for any non-negative dist', () => {
    for (const d of [0, 100, 1000, 5000, 8000]) {
      expect(interconnectCapex(d, 8000, cm)).toBeGreaterThanOrEqual(cm.substationAllowanceUsd)
    }
  })
})

// ── fiberCapex ────────────────────────────────────────────────────────────────

describe('fiberCapex', () => {
  it('null distance returns 0 (gap — do not invent a distance)', () => {
    expect(fiberCapex(null, cm)).toBe(0)
  })

  it('dist=0 km returns 0 (parcel at IXP facility)', () => {
    expect(fiberCapex(0, cm)).toBe(0)
  })

  it('dist=10 km: cost = 10000m * fiberPerMeter', () => {
    const expected = Math.round(10_000 * cm.fiberConduitPerMeterUsd)
    expect(fiberCapex(10, cm)).toBe(expected)
  })

  it('scales linearly', () => {
    const cost1 = fiberCapex(5, cm)
    const cost2 = fiberCapex(10, cm)
    expect(cost2).toBe(cost1 * 2)
  })
})

// ── entitlementCost ───────────────────────────────────────────────────────────

describe('entitlementCost', () => {
  it('industrial zoning (6 months) < outside-jurisdiction (10 months)', () => {
    const landVal  = 5_000_000
    const dr       = 0.08
    const costInd  = entitlementCost(landVal, 'industrial',           dr, cm)
    const costOJ   = entitlementCost(landVal, 'outside-jurisdiction', dr, cm)
    expect(costInd).toBeLessThan(costOJ)
  })

  it('zero land cost → zero entitlement cost', () => {
    expect(entitlementCost(0, 'industrial', 0.08, cm)).toBe(0)
  })

  it('unknown zoning tag falls back to default (longest timeline)', () => {
    const landVal = 5_000_000
    const dr = 0.08
    const costDefault  = entitlementCost(landVal, 'rezoning-needed', dr, cm)
    const costIndustrial = entitlementCost(landVal, 'industrial', dr, cm)
    expect(costDefault).toBeGreaterThan(costIndustrial)
  })

  it('matches manual formula: months × landVal × rate / 12', () => {
    const landVal = 10_000_000
    const dr = 0.08
    const months = entitlementMonths('outside-jurisdiction', cm)
    const expected = Math.round(months * landVal * dr / 12)
    expect(entitlementCost(landVal, 'outside-jurisdiction', dr, cm)).toBe(expected)
  })
})

// ── siteworkCost ──────────────────────────────────────────────────────────────

describe('siteworkCost', () => {
  it('null acres returns 0 (gap — do not invent acreage)', () => {
    expect(siteworkCost(null, 'flat', cm)).toBe(0)
  })

  it('flat parcel: cost = acres × earthworkFlatUsdPerAcre', () => {
    const acres = 50
    expect(siteworkCost(acres, 'flat', cm)).toBe(Math.round(acres * cm.earthworkFlatUsdPerAcre))
  })

  it('steep costs more than rolling which costs more than flat per acre', () => {
    expect(siteworkCost(100, 'steep', cm)).toBeGreaterThan(siteworkCost(100, 'rolling', cm))
    expect(siteworkCost(100, 'rolling', cm)).toBeGreaterThan(siteworkCost(100, 'flat', cm))
  })

  it('scales linearly with acres', () => {
    expect(siteworkCost(100, 'flat', cm)).toBe(siteworkCost(50, 'flat', cm) * 2)
  })
})

// ── landCost ──────────────────────────────────────────────────────────────────

describe('landCost', () => {
  it('null acres returns 0', () => {
    expect(landCost(55_000, null)).toBe(0)
  })

  it('zero acres returns 0', () => {
    expect(landCost(55_000, 0)).toBe(0)
  })

  it('cost = perAcre × acres', () => {
    expect(landCost(55_000, 100)).toBe(5_500_000)
  })
})

// ── computeParcelCapex ────────────────────────────────────────────────────────

describe('computeParcelCapex', () => {
  const baseRow: ParcelRow = {
    parcel_id:           'COST-001',
    address:             '100 TEST',
    acres:               50,
    acres_source:        'Acres',
    jurisdiction:        'City of San Antonio (CPS Energy territory)',
    zoning:              'outside-jurisdiction',
    flood_buildable_pct: 1.0,
    in_500yr_flood:      false,
    dist_to_tx_line_m:   2000,
    dist_to_ixp_km:      8.0,
    utility:             'assumed-CPS-Energy',
    state_code:          'F2',
    lat:                 29.45,
    lng:                 -98.5,
    geometry_wkt:        null,
    drivers:             {},
  }

  it('total equals sum of components', () => {
    const result = computeParcelCapex(baseRow, 55_000, 0.08, 8000, cm)
    const summed =
      result.land_cost_usd +
      result.interconnect_capex_usd +
      result.fiber_capex_usd +
      result.entitlement_cost_usd +
      result.sitework_usd
    expect(result.total_usd).toBe(summed)
  })

  it('row with dist_to_tx_line_m=0 has interconnect = substationAllowanceUsd', () => {
    const row = { ...baseRow, dist_to_tx_line_m: 0 }
    const result = computeParcelCapex(row, 55_000, 0.08, 8000, cm)
    expect(result.interconnect_capex_usd).toBe(cm.substationAllowanceUsd)
  })

  it('row with null dist_to_ixp_km has fiber_capex_usd = 0', () => {
    const row = { ...baseRow, dist_to_ixp_km: null }
    const result = computeParcelCapex(row, 55_000, 0.08, 8000, cm)
    expect(result.fiber_capex_usd).toBe(0)
  })

  it('all components are non-negative', () => {
    const result = computeParcelCapex(baseRow, 55_000, 0.08, 8000, cm)
    expect(result.land_cost_usd).toBeGreaterThanOrEqual(0)
    expect(result.interconnect_capex_usd).toBeGreaterThanOrEqual(0)
    expect(result.fiber_capex_usd).toBeGreaterThanOrEqual(0)
    expect(result.entitlement_cost_usd).toBeGreaterThanOrEqual(0)
    expect(result.sitework_usd).toBeGreaterThanOrEqual(0)
    expect(result.total_usd).toBeGreaterThanOrEqual(0)
  })
})
