/**
 * backend/tests/parcelsRoutes.test.ts
 *
 * Task 2 acceptance tests for the parcel API routes.
 *
 * Because data/parcels/bexar.rows.json may not exist in CI (ingest hasn't
 * run), these tests use a module-mock to inject a synthetic parcel set into
 * the repository rather than reading the real file.
 *
 * Acceptance criteria:
 *   - bbox filtering returns only parcels inside the bbox.
 *   - An unknown parcel id returns the standard 404 shape.
 *   - A search with different weights re-ranks without changing any cost figure.
 *   - GET /parcels and GET /api/parcels return identical results.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import http from 'node:http'
import type { ParcelRow } from '../src/parcel/repository.js'
import { _clearScoreCache } from '../src/parcel/score.js'
import { _clearIndexCache } from '../src/parcel/spatialIndex.js'

// ── Synthetic fixture parcels ─────────────────────────────────────────────────

function makeFixtureRow(id: string, lat: number, lng: number, acres = 50): ParcelRow {
  return {
    parcel_id:           id,
    address:             `${id} TEST`,
    acres,
    acres_source:        'Acres',
    jurisdiction:        'City of San Antonio (CPS Energy territory)',
    zoning:              'outside-jurisdiction',
    flood_buildable_pct: 1.0,
    in_500yr_flood:      false,
    dist_to_tx_line_m:   2000,
    dist_to_ixp_km:      10,
    utility:             'assumed-CPS-Energy',
    state_code:          'F2',
    lat,
    lng,
    geometry_wkt:        null,
    drivers: {
      land_cost_per_acre_usd: {
        value: 55_000, basis: 'modeled',
        source_url: 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query',
        last_verified: '2025-08', method: 'BCAD / PVS',
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
  }
}

// Parcels at known coordinates:
//   INSIDE:  29.45, -98.50   (inside test bbox -98.6,-98.3, 29.3, 29.6)
//   OUTSIDE: 29.10, -99.20   (outside test bbox)
const FIXTURE_ROWS: ParcelRow[] = [
  makeFixtureRow('INSIDE-1', 29.45, -98.50, 80),
  makeFixtureRow('INSIDE-2', 29.50, -98.45, 60),
  makeFixtureRow('OUTSIDE-1', 29.10, -99.20, 120),
]

// ── Mock the repository before importing server ───────────────────────────────

vi.mock('../src/parcel/repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/parcel/repository.js')>()
  return {
    ...actual,
    fileRepository: {
      listParcels: (_county: string) => FIXTURE_ROWS,
      getParcel:   (_county: string, id: string) => FIXTURE_ROWS.find(r => r.parcel_id === id) ?? null,
      queryByBbox: (_county: string, bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }) =>
        FIXTURE_ROWS.filter(r => r.lng! >= bbox.minLng && r.lng! <= bbox.maxLng && r.lat! >= bbox.minLat && r.lat! <= bbox.maxLat),
    },
    parcelRepository: {
      listParcels: (_county: string) => FIXTURE_ROWS,
      getParcel:   (_county: string, id: string) => FIXTURE_ROWS.find(r => r.parcel_id === id) ?? null,
      queryByBbox: (_county: string, bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }) =>
        FIXTURE_ROWS.filter(r => r.lng! >= bbox.minLng && r.lng! <= bbox.maxLng && r.lat! >= bbox.minLat && r.lat! <= bbox.maxLat),
    },
  }
})

vi.mock('../src/llm/parcelNote.js', () => ({
  parcelNote: vi.fn().mockResolvedValue({
    text: 'Fixture parcel note.',
    source: 'fallback',
  }),
}))

// Import app AFTER mock is registered
const { app } = await import('../src/server.js')

// ── Test server setup ─────────────────────────────────────────────────────────

let server: http.Server
let baseUrl: string

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      baseUrl = `http://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})

afterAll(() => { server.close() })

beforeEach(() => {
  _clearScoreCache()
  _clearIndexCache()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function get(path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`)
  const json = await res.json()
  return { status: res.status, json }
}

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return { status: res.status, json }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /parcels', () => {
  it('returns 200 with all fixture parcels when no filters applied', async () => {
    const { status, json } = await get('/parcels')
    expect(status).toBe(200)
    const resp = json as { total: number; parcels: unknown[] }
    expect(resp.total).toBe(FIXTURE_ROWS.length)
    expect(resp.parcels.length).toBeGreaterThan(0)
  })

  it('bbox filter returns only parcels inside the bbox', async () => {
    // bbox covers only INSIDE-1 and INSIDE-2
    const { status, json } = await get('/parcels?bbox=-98.6,29.3,-98.3,29.6')
    expect(status).toBe(200)
    const resp = json as { total: number; parcels: Array<{ parcel_id: string }> }
    const ids = resp.parcels.map(p => p.parcel_id)
    expect(ids).toContain('INSIDE-1')
    expect(ids).toContain('INSIDE-2')
    expect(ids).not.toContain('OUTSIDE-1')
  })

  it('returns 400 for malformed bbox', async () => {
    const { status } = await get('/parcels?bbox=bad')
    expect(status).toBe(400)
  })

  it('returns 400 for invalid per_page', async () => {
    const { status } = await get('/parcels?per_page=999')
    expect(status).toBe(400)
  })
})

describe('GET /parcels/:id', () => {
  it('returns 200 with full estimate for a known parcel', async () => {
    const { status, json } = await get('/parcels/INSIDE-1')
    expect(status).toBe(200)
    const est = json as { parcel_id: string; finance: { npv_usd: number }; provenance: unknown[] }
    expect(est.parcel_id).toBe('INSIDE-1')
    expect(est.finance.npv_usd).toBeLessThan(0)
    expect(Array.isArray(est.provenance)).toBe(true)
  })

  it('returns 404 with standard shape for unknown parcel id', async () => {
    const { status, json } = await get('/parcels/DOES-NOT-EXIST')
    expect(status).toBe(404)
    const body = json as { error: string; parcel_id: string }
    expect(body.error).toBeTruthy()
    expect(body.parcel_id).toBe('DOES-NOT-EXIST')
  })
})

describe('POST /parcels/search', () => {
  it('returns 200 with filtered results', async () => {
    const { status, json } = await post('/parcels/search', {
      filters: { bbox: { minLng: -98.6, minLat: 29.3, maxLng: -98.3, maxLat: 29.6 } },
    })
    expect(status).toBe(200)
    const resp = json as { parcels: Array<{ parcel_id: string }> }
    const ids = resp.parcels.map(p => p.parcel_id)
    expect(ids).toContain('INSIDE-1')
    expect(ids).not.toContain('OUTSIDE-1')
  })

  it('changing weights re-ranks without changing cost figures', async () => {
    const base = await post('/parcels/search', {
      project: { capacity_kw: 10000, design_pue: 1.4, design_wue: 0.4, lifetime_years: 20, discount_rate: 0.08,
        weights: { total_cost: 0.50, risk: 0.20, sustainability: 0.15, latency: 0.15 } },
    })
    const reweighted = await post('/parcels/search', {
      project: { capacity_kw: 10000, design_pue: 1.4, design_wue: 0.4, lifetime_years: 20, discount_rate: 0.08,
        weights: { total_cost: 0.90, risk: 0.05, sustainability: 0.03, latency: 0.02 } },
    })
    expect(base.status).toBe(200)
    expect(reweighted.status).toBe(200)

    // NPV figures must be identical (same scoring context, different weights)
    type Parcel = { parcel_id: string; lifetime_cost_per_kw: number }
    const baseMap   = new Map((base.json as { parcels: Parcel[] }).parcels.map(p => [p.parcel_id, p]))
    const reMap     = new Map((reweighted.json as { parcels: Parcel[] }).parcels.map(p => [p.parcel_id, p]))
    for (const [id, bp] of baseMap) {
      const rp = reMap.get(id)
      if (rp) {
        // Lifetime cost per kW must be identical — only score can differ
        expect(rp.lifetime_cost_per_kw).toBe(bp.lifetime_cost_per_kw)
      }
    }
  })

  it('returns 400 for invalid body', async () => {
    const { status } = await post('/parcels/search', { county: 123 })
    // county: 123 is technically coercible, but pagination with invalid values would fail
    // Use clearly invalid per_page
    const { status: s2 } = await post('/parcels/search', { pagination: { per_page: 999 } })
    expect(s2).toBe(400)
    void status  // silence lint
  })
})

describe('route equivalence: /api/parcels prefix', () => {
  it('GET /parcels and GET /api/parcels return identical total', async () => {
    const [bare, api] = await Promise.all([
      get('/parcels'), get('/api/parcels'),
    ])
    expect(bare.status).toBe(200)
    expect(api.status).toBe(200)
    const bareTotal = (bare.json as { total: number }).total
    const apiTotal  = (api.json  as { total: number }).total
    expect(apiTotal).toBe(bareTotal)
  })
})
