/**
 * backend/tests/parcelUnpriced.test.ts
 *
 * The parcel tool used to turn a missing cost into a zero cost. A parcel nobody
 * had priced therefore looked free, and cost carries half the weight in the
 * ranking, so it won. The region engine had the identical defect and it was
 * fixed in a225bc2; these tests hold the same line at parcel grain.
 *
 * Also covered here: every figure this engine works out for itself now says so.
 * Five parcel capex components and the land total shipped with no basis at all,
 * which left arithmetic looking the same as a published record.
 *
 * Each test below fails on the code as it was merged.
 */

import { describe, it, expect } from 'vitest'
import { driversForParcel } from '../src/parcel/drivers.js'
import { estimateParcel, scoreAll, rerank, _clearScoreCache, _cacheSize,
         type ParcelProject, type ParcelResult } from '../src/parcel/score.js'
import { bexarConfig } from '../src/ingest/counties/bexar.js'
import type { ParcelRow } from '../src/parcel/repository.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT: ParcelProject = {
  capacity_kw:    10_000,
  design_pue:     1.25,
  design_wue:     0.4,
  lifetime_years: 15,
  discount_rate:  0.08,
}

function row(overrides: Partial<ParcelRow> = {}): ParcelRow {
  return {
    parcel_id:           'TEST-PRICED',
    address:             '1 TEST RD',
    acres:               60,
    acres_source:        'Acres',
    jurisdiction:        'City of San Antonio (CPS Energy territory)',
    zoning:              'outside-jurisdiction',
    flood_buildable_pct: 1.0,
    in_500yr_flood:      false,
    dist_to_tx_line_m:   2_000,
    dist_to_ixp_km:      10,
    utility:             'assumed-CPS-Energy',
    state_code:          'F2',
    lat:                 29.45,
    lng:                 -98.50,
    geometry_wkt:        null,
    drivers: {
      land_cost_per_acre_usd: {
        value:         60_000,
        basis:         'modeled',
        source_url:    'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query',
        last_verified: '2025-08',
      },
      power_rate_usd_per_kwh: {
        value:         0.0385,
        basis:         'sourced',
        source_url:    'https://www.cpsenergy.com/content/dam/doc/rates/LG.pdf',
        last_verified: '2024-03',
      },
    },
    ...overrides,
  } as ParcelRow
}

/**
 * A parcel with no land price anywhere. The county fallback is knocked out by
 * pointing the config at a region key that carries no land figure, which is the
 * state every county starts in before anyone collects the data.
 */
const CONFIG_WITHOUT_LAND = {
  ...bexarConfig,
  costModel: { ...bexarConfig.costModel, regionKey: 'us-ak' },
}

// ── The zero-coercion defect ──────────────────────────────────────────────────

describe('a parcel with no land price is named, not priced at zero', () => {
  it('driversForParcel keeps the missing land price as null and lists it', () => {
    const unpriced = row({ parcel_id: 'TEST-NO-LAND', drivers: {} as ParcelRow['drivers'] })
    const { drivers, missing_cost_drivers } = driversForParcel(unpriced, CONFIG_WITHOUT_LAND)

    expect(drivers.land_cost_per_acre_usd).toBeNull()
    expect(missing_cost_drivers).toContain('land_cost_per_acre_usd')
  })

  it('estimateParcel publishes no total for it', () => {
    const unpriced = row({ parcel_id: 'TEST-NO-LAND', drivers: {} as ParcelRow['drivers'] })
    const e = estimateParcel(unpriced, PROJECT, CONFIG_WITHOUT_LAND)

    expect(e.finance).toBeNull()
    expect(e.capex).toBeNull()
    expect(e.opex_annual).toBeNull()
    expect(e.parcel_capex).toBeNull()
    expect(e.unevaluable?.missing_drivers).toContain('land_cost_per_acre_usd')
  })

  it('nothing in the county is ranked when the cost drivers are missing', () => {
    _clearScoreCache()
    const ranked = scoreAll(
      [row({ parcel_id: 'A' }), row({ parcel_id: 'B' })],
      PROJECT,
      CONFIG_WITHOUT_LAND,
    )
    for (const e of ranked) {
      expect(e.rank).toBe(0)
      expect(e.finance).toBeNull()
      expect(e.unevaluable).not.toBeNull()
    }
  })

  it('an unpriced parcel sorts below a priced one and never takes rank 1', () => {
    _clearScoreCache()
    const priced: ParcelResult = {
      ...estimateParcel(row({ parcel_id: 'TEST-PRICED' }), PROJECT, bexarConfig),
      rank: 0, weighted_score: 0,
    } as ParcelResult
    const unpriced: ParcelResult = {
      ...estimateParcel(row({ parcel_id: 'TEST-NO-LAND' }), PROJECT, CONFIG_WITHOUT_LAND),
      rank: 0, weighted_score: 0,
    } as ParcelResult

    // Unpriced first in the input, so a sort that ignores the distinction
    // leaves it first in the output.
    const ranked = rerank([unpriced, priced], {})

    expect(ranked[0].parcel_id).toBe('TEST-PRICED')
    expect(ranked[0].rank).toBe(1)
    expect(ranked[1].parcel_id).toBe('TEST-NO-LAND')
    expect(ranked[1].rank).toBe(0)
    expect(ranked[1].finance).toBeNull()
  })
})

// ── Basis on every figure this engine works out ───────────────────────────────

describe('each figure the engine derives says it was derived', () => {
  const e = estimateParcel(row(), PROJECT, bexarConfig)
  const byDriver = (name: string) => e.provenance.find(p => p.driver === name)!

  it.each([
    'interconnect_capex_usd',
    'fiber_capex_usd',
    'entitlement_cost_usd',
    'sitework_usd',
    'land_cost_usd',
  ])('%s carries basis modeled and a method', (driver) => {
    const item = byDriver(driver)
    expect(item).toBeDefined()
    expect(item.basis).toBe('modeled')
    expect(item.method).toBeTruthy()
  })

  it('the land total does not read as something the appraisal district published', () => {
    const item = byDriver('land_cost_usd')
    expect(item.basis).toBe('modeled')
    expect(item.method).toMatch(/derived here, not published/i)
  })

  it('grid_interconnection_years carries the basis field even though it has no value', () => {
    const item = byDriver('grid_interconnection_years')
    expect(item.value).toBeNull()
    expect('basis' in item).toBe(true)
    expect(item.basis).toBeNull()
  })

  it('the modeled land figure is counted as modeled, not as a guess', () => {
    // Six modeled figures: the parcel land price per acre, and the five totals
    // the engine works out from it.
    expect(e.confidence.modeled).toBeGreaterThanOrEqual(6)
  })
})

// ── Cache ceiling ─────────────────────────────────────────────────────────────

describe('the cost cache has a ceiling', () => {
  it('a caller varying the discount rate cannot grow it without limit', () => {
    _clearScoreCache()
    const r = row()
    for (let i = 0; i < 40; i++) {
      scoreAll([r], { ...PROJECT, discount_rate: 0.05 + i / 1000 }, bexarConfig)
    }
    expect(_cacheSize()).toBeLessThanOrEqual(8)
  })
})
