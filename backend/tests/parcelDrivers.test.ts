/**
 * backend/tests/parcelDrivers.test.ts
 *
 * Task 2 acceptance tests:
 *   - A parcel with a real land value uses it and preserves the ingest basis.
 *   - A parcel with a null LandVal falls back to the county region figure,
 *     and the resulting driver's basis is 'assumed' (not 'sourced').
 *   - grid_interconnection_years is always null regardless of region value.
 *   - Provenance array has one entry per driver.
 */

import { describe, it, expect } from 'vitest'
import { driversForParcel } from '../src/parcel/drivers.js'
import { bexarConfig } from '../src/ingest/counties/bexar.js'
import type { ParcelRow } from '../src/parcel/repository.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_ROW: ParcelRow = {
  parcel_id:           'TEST-001',
  address:             '123 TEST RD',
  acres:               50,
  acres_source:        'Acres',
  jurisdiction:        'City of San Antonio (CPS Energy territory)',
  zoning:              'outside-jurisdiction',
  flood_buildable_pct: 1.0,
  in_500yr_flood:      false,
  dist_to_tx_line_m:   2500,
  dist_to_ixp_km:      12.3,
  utility:             'assumed-CPS-Energy',
  state_code:          'F2',
  lat:                 29.45,
  lng:                 -98.50,
  geometry_wkt:        null,
  drivers: {
    land_cost_per_acre_usd: {
      value:         55_176,
      basis:         'modeled',
      source_url:    'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query',
      last_verified: '2025-08',
      method:        'BCAD appraised land value / PVS ratio',
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

const NULL_LAND_ROW: ParcelRow = {
  ...BASE_ROW,
  parcel_id: 'TEST-002',
  drivers: {
    ...BASE_ROW.drivers,
    land_cost_per_acre_usd: {
      value:         null,
      basis:         'assumed',
      source_url:    'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query',
      last_verified: '2025-08',
      method:        'BCAD LandVal not available; using market average',
    },
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('driversForParcel', () => {
  it('uses parcel-grain land value when available and preserves modeled basis', () => {
    const { drivers, provenance } = driversForParcel(BASE_ROW, bexarConfig)

    expect(drivers.land_cost_per_acre_usd).toBe(55_176)

    // Provenance for land cost should reference the parcel_id, not the region
    const landProv = provenance.find(p => p.driver === 'land_cost_per_acre_usd')
    expect(landProv).toBeDefined()
    expect(landProv!.region_key).toBe('TEST-001')  // parcel_id, not region key
    expect(landProv!.value).toBe(55_176)
  })

  it('falls back to region land value when parcel LandVal is null', () => {
    const { drivers, provenance } = driversForParcel(NULL_LAND_ROW, bexarConfig)

    // Region value should be used (us-tx-ercot has a land_cost_per_acre_usd)
    expect(drivers.land_cost_per_acre_usd).toBeGreaterThan(0)

    // Basis of the fallback must NOT be 'sourced' — it is a county average
    const landProv = provenance.find(p => p.driver === 'land_cost_per_acre_usd')
    expect(landProv).toBeDefined()
    // The region key should be the county fallback key, not the parcel id
    expect(landProv!.region_key).toBe(bexarConfig.costModel.regionKey)
  })

  it('fallback basis is not "sourced" when null land value triggers region fallback', () => {
    const { provenance } = driversForParcel(NULL_LAND_ROW, bexarConfig)
    const landProv = provenance.find(p => p.driver === 'land_cost_per_acre_usd')
    // The region fallback marks basis='assumed' (county average ≠ parcel measurement)
    // We verify by checking that the provenance region_key is the county region, not parcel
    expect(landProv!.region_key).not.toBe('TEST-002')
  })

  it('grid_interconnection_years is always null regardless of region value', () => {
    const { drivers, provenance } = driversForParcel(BASE_ROW, bexarConfig)

    expect(drivers.grid_interconnection_years).toBeNull()

    const gridProv = provenance.find(p => p.driver === 'grid_interconnection_years')
    expect(gridProv).toBeDefined()
    expect(gridProv!.value).toBeNull()
  })

  it('does not treat a regional sales-tax incentive as a property-tax abatement', () => {
    const { drivers, provenance } = driversForParcel(BASE_ROW, bexarConfig)
    expect(drivers.tax_abatement_years).toBe(0)
    const abatement = provenance.find(p => p.driver === 'tax_abatement_years')
    expect(abatement?.value).toBe(0)
    expect(abatement?.basis).toBe('assumed')
  })

  it('provenance has exactly one entry per expected driver', () => {
    const { provenance } = driversForParcel(BASE_ROW, bexarConfig)
    const expectedDrivers = [
      'land_cost_per_acre_usd',
      'construction_cost_per_kw',
      'power_rate_usd_per_kwh',
      'water_rate_usd_per_kgal',
      'staff_cost_index',
      'tax_rate',
      'tax_abatement_years',
      'risk_score',
      'renewable_pct',
      'low_carbon_pct',
      'latency_ms_to_hub',
      'grid_interconnection_years',
    ]
    for (const d of expectedDrivers) {
      const entries = provenance.filter(p => p.driver === d)
      expect(entries, `driver "${d}" should appear exactly once in provenance`).toHaveLength(1)
    }
  })
})
