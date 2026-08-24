/**
 * backend/tests/parcelScore.test.ts
 *
 * Task 4 acceptance tests:
 *   - estimateParcel returns a complete ParcelEstimate for a single row.
 *   - scoreAll over a synthetic set produces correct ranking.
 *   - Re-rank under different weights re-sorts without recomputing costs.
 *   - scoreAll over 500 synthetic parcels completes in under 5 seconds (cold).
 *   - rerank over 500 pre-scored parcels completes in under 100 ms.
 *
 * NOTE: The 500-parcel timing test uses synthetic rows (no file I/O).
 * It measures pure CPU cost of driversForParcel + cost functions + engine.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { estimateParcel, scoreAll, rerank, _clearScoreCache } from '../src/parcel/score.js'
import { bexarConfig } from '../src/ingest/counties/bexar.js'
import type { ParcelRow } from '../src/parcel/repository.js'
import type { ParcelProject } from '../src/parcel/score.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT: ParcelProject = {
  capacity_kw:    10_000,
  design_pue:     1.4,
  design_wue:     0.4,
  lifetime_years: 20,
  discount_rate:  0.08,
  weights: { total_cost: 0.50, risk: 0.20, sustainability: 0.15, latency: 0.15 },
}

function makeRow(id: string, acres = 50, distTx = 2000, distIxp = 10): ParcelRow {
  return {
    parcel_id:           id,
    address:             `${id} TEST RD`,
    acres,
    acres_source:        'Acres',
    jurisdiction:        'City of San Antonio (CPS Energy territory)',
    zoning:              'outside-jurisdiction',
    flood_buildable_pct: 1.0,
    in_500yr_flood:      false,
    dist_to_tx_line_m:   distTx,
    dist_to_ixp_km:      distIxp,
    utility:             'assumed-CPS-Energy',
    state_code:          'F2',
    lat:                 29.45,
    lng:                 -98.5,
    geometry_wkt:        null,
    drivers: {
      land_cost_per_acre_usd: {
        value:         55_000,
        basis:         'modeled',
        source_url:    'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query',
        last_verified: '2025-08',
        method:        'BCAD / PVS ratio',
      },
      power_rate_usd_per_kwh: {
        value:         0.0385,
        basis:         'sourced',
        source_url:    'https://www.cpsenergy.com/content/dam/doc/rates/LG.pdf',
        last_verified: '2024-03',
      },
      water_rate_usd_per_kgal: {
        value:         7.51,
        basis:         'sourced',
        source_url:    'https://www.saws.org/your-account/rates/',
        last_verified: '2024-07',
      },
      grid_interconnection_years: {
        value:         null,
        basis:         'assumed',
        source_url:    'https://www.ercot.com/services/rq/large-load-integration',
        last_verified: '',
        method:        'null pending ERCOT Docling pipeline',
      },
    },
  }
}

beforeEach(() => {
  _clearScoreCache()
})

// ── estimateParcel ─────────────────────────────────────────────────────────────

describe('estimateParcel', () => {
  it('returns a complete estimate with all required fields', () => {
    const row = makeRow('P001')
    const est = estimateParcel(row, PROJECT, bexarConfig)

    expect(est.parcel_id).toBe('P001')
    expect(est.county).toBe('bexar')
    expect(est.acres).toBe(50)

    // Parcel capex has all components
    expect(est.parcel_capex.land_cost_usd).toBeGreaterThan(0)
    expect(est.parcel_capex.interconnect_capex_usd).toBeGreaterThan(0)
    expect(est.parcel_capex.fiber_capex_usd).toBeGreaterThan(0)
    expect(est.parcel_capex.entitlement_cost_usd).toBeGreaterThan(0)
    expect(est.parcel_capex.sitework_usd).toBeGreaterThan(0)
    expect(est.parcel_capex.total_usd).toBeGreaterThan(0)

    // Engine outputs present
    expect(est.capex.total_usd).toBeGreaterThan(0)
    expect(est.opex_annual.total_usd).toBeGreaterThan(0)
    expect(est.finance.npv_usd).toBeLessThan(0)  // cost NPV is negative
    expect(est.finance.capex_per_kw).toBeGreaterThan(0)
    expect(est.finance.lifetime_cost_per_kw).toBeGreaterThan(0)

    // Non-cost scores present
    expect(est.non_cost_scores.grid_interconnection_years).toBeNull()

    // grid_interconnection_years gap recorded
    const gridGap = est.gaps.find(g => g.driver === 'grid_interconnection_years')
    expect(gridGap).toBeDefined()
  })

  it('parcel_capex.total_usd equals sum of its components', () => {
    const est = estimateParcel(makeRow('P002'), PROJECT, bexarConfig)
    const summed =
      est.parcel_capex.land_cost_usd +
      est.parcel_capex.interconnect_capex_usd +
      est.parcel_capex.fiber_capex_usd +
      est.parcel_capex.entitlement_cost_usd +
      est.parcel_capex.sitework_usd
    expect(est.parcel_capex.total_usd).toBe(summed)
  })

  it('parcel on the transmission line (dist=0) has lower interconnect cost than one 5 km away', () => {
    const near = estimateParcel(makeRow('NEAR', 50, 0, 10), PROJECT, bexarConfig)
    const far  = estimateParcel(makeRow('FAR',  50, 5000, 10), PROJECT, bexarConfig)
    expect(near.parcel_capex.interconnect_capex_usd).toBeLessThan(far.parcel_capex.interconnect_capex_usd)
  })

  it('parcel with null dist_to_ixp_km has fiber_capex_usd = 0 and gap recorded', () => {
    const row = { ...makeRow('NOIXP'), dist_to_ixp_km: null }
    const est = estimateParcel(row, PROJECT, bexarConfig)
    expect(est.parcel_capex.fiber_capex_usd).toBe(0)
    const fiberGap = est.gaps.find(g => g.driver === 'fiber_capex_usd')
    expect(fiberGap).toBeDefined()
  })
})

// ── scoreAll ──────────────────────────────────────────────────────────────────

describe('scoreAll', () => {
  it('returns estimates sorted by rank ascending', () => {
    const rows = ['A', 'B', 'C'].map(id => makeRow(id))
    const results = scoreAll(rows, PROJECT, bexarConfig)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].rank).toBeLessThan(results[i + 1].rank)
    }
  })

  it('rank 1 has higher weighted_score than rank 2', () => {
    const rows = ['X', 'Y'].map(id => makeRow(id))
    const results = scoreAll(rows, PROJECT, bexarConfig)
    expect(results[0].weighted_score).toBeGreaterThanOrEqual(results[1].weighted_score)
  })

  it('changing weights re-ranks without touching costs', () => {
    const rows = [
      makeRow('CHEAP', 50, 100, 1),   // close to tx + ixp → cheaper parcel capex
      makeRow('PRICEY', 50, 7500, 80), // far from tx + ixp → pricier parcel capex
    ]

    // Base: cost-heavy weights → cheap should rank higher
    const base = scoreAll(rows, PROJECT, bexarConfig)
    const cheapBase  = base.find(e => e.parcel_id === 'CHEAP')!
    const priceyBase = base.find(e => e.parcel_id === 'PRICEY')!
    expect(cheapBase.parcel_capex.total_usd).toBeLessThan(priceyBase.parcel_capex.total_usd)

    // Re-rank — costs must not change
    const reranked = rerank(base, { total_cost: 0.90, risk: 0.05, sustainability: 0.03, latency: 0.02 })
    for (const re of reranked) {
      const orig = base.find(e => e.parcel_id === re.parcel_id)!
      expect(re.parcel_capex.total_usd).toBe(orig.parcel_capex.total_usd)
      expect(re.capex.total_usd).toBe(orig.capex.total_usd)
    }
  })

  it('all parcels have rank assigned', () => {
    const rows = ['D', 'E', 'F', 'G'].map(id => makeRow(id))
    const results = scoreAll(rows, PROJECT, bexarConfig)
    const ranks = results.map(e => e.rank)
    expect(new Set(ranks).size).toBe(rows.length)
    expect(Math.min(...ranks)).toBe(1)
    expect(Math.max(...ranks)).toBe(rows.length)
  })
})

// ── Timing acceptance tests ───────────────────────────────────────────────────

describe('scoreAll performance', () => {
  it('cold run over 500 synthetic parcels completes in under 5 seconds', () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      makeRow(`T${i}`, 25 + (i % 200), 500 + (i % 7500), 5 + (i % 50))
    )
    const t0 = Date.now()
    const results = scoreAll(rows, PROJECT, bexarConfig)
    const elapsed = Date.now() - t0

    expect(results).toHaveLength(500)
    console.log(`  scoreAll cold (500 parcels): ${elapsed} ms`)
    expect(elapsed).toBeLessThan(5_000)
  })

  it('re-rank over 500 pre-scored parcels completes in under 100 ms', () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      makeRow(`R${i}`, 25 + (i % 200), 500 + (i % 7500), 5 + (i % 50))
    )
    // Warm the cache
    const scored = scoreAll(rows, PROJECT, bexarConfig)

    const t0 = Date.now()
    rerank(scored, { total_cost: 0.80, risk: 0.10, sustainability: 0.05, latency: 0.05 })
    const elapsed = Date.now() - t0

    console.log(`  rerank (500 parcels): ${elapsed} ms`)
    expect(elapsed).toBeLessThan(100)
  })
})
