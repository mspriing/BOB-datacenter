/**
 * Route-equivalence tests.
 *
 * Asserts that POST /api/estimate and POST /estimate return identical results
 * for the same input, so the /api prefix added for the deployed frontend cannot
 * silently break without a test failure.
 *
 * Also asserts GET /health and GET /api/health both return 200.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { app } from '../src/server.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

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

afterAll(() => {
  server.close()
})

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return { status: res.status, json }
}

async function get(path: string): Promise<{ status: number }> {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status }
}

// ── Minimal valid estimate input ──────────────────────────────────────────────

const minimalInput = {
  project: {
    name: 'Route equivalence test',
    capacity_kw: 10_000,
    design_pue: 1.4,
    lifetime_years: 15,
    discount_rate: 0.08,
  },
  sites: [
    { site_id: 'nova',  label: 'Northern Virginia', region_key: 'us-va-northern' },
    { site_id: 'ercot', label: 'Texas ERCOT',        region_key: 'us-tx-ercot'    },
  ],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('route equivalence: /api prefix', () => {
  it('GET /health and GET /api/health both return 200', async () => {
    const bare = await get('/health')
    const api  = await get('/api/health')
    expect(bare.status).toBe(200)
    expect(api.status).toBe(200)
  })

  it('POST /api/estimate returns 200 with the same ranking as POST /estimate', async () => {
    const [bare, api] = await Promise.all([
      post('/estimate',     minimalInput),
      post('/api/estimate', minimalInput),
    ])
    expect(bare.status).toBe(200)
    expect(api.status).toBe(200)

    const bareOut = bare.json as { ranking: string[] }
    const apiOut  = api.json  as { ranking: string[] }
    // Rankings must be identical — same deterministic engine, same input.
    expect(apiOut.ranking).toEqual(bareOut.ranking)
  })
})
