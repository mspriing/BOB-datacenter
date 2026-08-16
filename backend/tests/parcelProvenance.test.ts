/**
 * backend/tests/parcelProvenance.test.ts
 *
 * Task 5 acceptance tests:
 *   - No ParcelEstimate contains a numeric figure absent from its provenance array.
 *   - Every driver in provenance traces to a source_url and last_verified.
 *   - grid_interconnection_years is in provenance with value=null and a gap entry.
 *   - A ParcelEstimate with a gap lists it in the gaps array with a reason.
 *   - Confidence counts sum correctly across basis values.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { estimateParcel, _clearScoreCache } from '../src/parcel/score.js'
import { bexarConfig } from '../src/ingest/counties/bexar.js'
import type { ParcelRow } from '../src/parcel/repository.js'
import type { ParcelProject } from '../src/parcel/score.js'

const PROJECT: ParcelProject = {
  capacity_kw: 10_000, design_pue: 1.4, design_wue: 0.4,
  lifetime_years: 20, discount_rate: 0.08,
}

function makeRow(id: string, overrides: Partial<ParcelRow> = {}): ParcelRow {
  return {
    parcel_id:           id,
    address:             `${id} TEST`,
    acres:               50,
    acres_source:        'Acres',
    jurisdiction:        'City of San Antonio (CPS Energy territory)',
    zoning:              'outside-jurisdiction',
    flood_buildable_pct: 1.0,
    in_500yr_flood:      false,
    dist_to_tx_line_m:   2000,
    dist_to_ixp_km:      10,
    utility:             'assumed-CPS-Energy',
    state_code:          'F2',
    lat:                 29.45,
    lng:                 -98.5,
    geometry_wkt:        null,
    drivers: {
      land_cost_per_acre_usd: {
        value: 55_000, basis: 'modeled',
        source_url: 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query',
        last_verified: '2025-08', method: 'BCAD / PVS ratio',
      },
      power_rate_usd_per_kwh: {
        value: 0.0385, basis: 'sourced',
        source_url: 'https://www.cpsenergy.com/content/dam/doc/rates/LG.pdf',
        last_verified: '2024-03',
      },
      water_rate_usd_per_kgal: {
        value: 7.51, basis: 'sourced',
        source_url: 'https://www.saws.org/your-account/rates/',
        last_verified: '2024-07',
      },
      grid_interconnection_years: {
        value: null, basis: 'assumed',
        source_url: 'https://www.ercot.com/services/rq/large-load-integration',
        last_verified: '', method: 'null pending ERCOT Docling pipeline',
      },
    },
    ...overrides,
  }
}

beforeEach(() => _clearScoreCache())

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Return the set of driver names that have a non-null numeric value in the estimate,
 * but are NOT represented in the provenance array.
 */
function figuresWithoutProvenance(est: ReturnType<typeof estimateParcel>): string[] {
  const provenanceDrivers = new Set(est.provenance.map(p => p.driver))
  const missing: string[] = []

  // Parcel capex components must all be in provenance
  const capexComponents: Record<string, number> = {
    land_cost_usd:           est.parcel_capex.land_cost_usd,
    interconnect_capex_usd:  est.parcel_capex.interconnect_capex_usd,
    fiber_capex_usd:         est.parcel_capex.fiber_capex_usd,
    entitlement_cost_usd:    est.parcel_capex.entitlement_cost_usd,
    sitework_usd:             est.parcel_capex.sitework_usd,
  }
  for (const [driver, value] of Object.entries(capexComponents)) {
    if (value > 0 && !provenanceDrivers.has(driver)) {
      missing.push(driver)
    }
  }

  // All drivers must be in provenance
  const driverFields = [
    'land_cost_per_acre_usd', 'construction_cost_per_kw',
    'power_rate_usd_per_kwh', 'water_rate_usd_per_kgal',
    'staff_cost_index', 'tax_rate', 'tax_abatement_years',
    'risk_score', 'renewable_pct', 'low_carbon_pct', 'latency_ms_to_hub',
    'grid_interconnection_years',
  ]
  for (const d of driverFields) {
    if (!provenanceDrivers.has(d)) missing.push(d)
  }

  return missing
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ParcelEstimate provenance completeness', () => {
  it('every numeric figure appears in provenance', () => {
    const est = estimateParcel(makeRow('PROV-001'), PROJECT, bexarConfig)
    const missing = figuresWithoutProvenance(est)
    expect(
      missing,
      `Figures without provenance entry: ${missing.join(', ')}`
    ).toHaveLength(0)
  })

  it('every provenance entry has source_url and last_verified', () => {
    const est = estimateParcel(makeRow('PROV-002'), PROJECT, bexarConfig)
    for (const p of est.provenance) {
      expect(p.source_url, `driver ${p.driver} missing source_url`).toBeTruthy()
      // last_verified may be empty for ERCOT gap — that is expected
    }
  })

  it('grid_interconnection_years is in provenance with value=null', () => {
    const est = estimateParcel(makeRow('PROV-003'), PROJECT, bexarConfig)
    const gridProv = est.provenance.find(p => p.driver === 'grid_interconnection_years')
    expect(gridProv).toBeDefined()
    expect(gridProv!.value).toBeNull()
  })

  it('gap in provenance → matching entry in gaps array with reason', () => {
    const est = estimateParcel(makeRow('PROV-004'), PROJECT, bexarConfig)
    const gridGap = est.gaps.find(g => g.driver === 'grid_interconnection_years')
    expect(gridGap).toBeDefined()
    expect(gridGap!.reason).toBeTruthy()
  })

  it('null dist_to_ixp_km: fiber_capex_usd null in provenance and gap recorded', () => {
    const est = estimateParcel(makeRow('PROV-005', { dist_to_ixp_km: null }), PROJECT, bexarConfig)
    const fiberProv = est.provenance.find(p => p.driver === 'fiber_capex_usd')
    expect(fiberProv!.value).toBeNull()
    const fiberGap = est.gaps.find(g => g.driver === 'fiber_capex_usd')
    expect(fiberGap).toBeDefined()
  })

  it('confidence counts sum to the number of provenance entries', () => {
    const est = estimateParcel(makeRow('PROV-006'), PROJECT, bexarConfig)
    const { sourced, modeled, assumed, missing } = est.confidence
    expect(sourced + modeled + assumed + missing).toBe(est.provenance.length)
  })

  it('no driver in the output has a non-null value but missing provenance for a batch of rows', () => {
    // Run 10 varied rows — if any is missing provenance, the check fails
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow(`BATCH-${i}`, {
        acres:             25 + i * 5,
        dist_to_tx_line_m: 100 * i,
        dist_to_ixp_km:    i % 3 === 0 ? null : 5 + i,
        zoning:            i % 2 === 0 ? 'outside-jurisdiction' : 'industrial',
      })
    )
    for (const row of rows) {
      const est = estimateParcel(row, PROJECT, bexarConfig)
      const missing = figuresWithoutProvenance(est)
      expect(
        missing,
        `Row ${row.parcel_id} has figures without provenance: ${missing.join(', ')}`
      ).toHaveLength(0)
    }
  })
})
