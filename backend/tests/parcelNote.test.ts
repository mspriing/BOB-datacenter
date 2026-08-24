/**
 * backend/tests/parcelNote.test.ts
 *
 * The note is written from driver data, never parcel identity, and every number
 * in it must appear in the estimate.
 */

import { describe, it, expect, vi } from 'vitest'
import { buildFallbackNote, everyNumberIsTraceable, parcelNote } from '../src/llm/parcelNote.js'
import { estimateParcel, scoreAll, type ParcelProject } from '../src/parcel/score.js'
import type { ParcelRow } from '../src/parcel/repository.js'
import { bexarConfig } from '../src/ingest/counties/bexar.js'

function row(id: string, acres = 85): ParcelRow {
  return {
    parcel_id: id, address: `${id} TEST RD`, acres, acres_source: 'Acres',
    jurisdiction: 'unincorporated', zoning: 'outside-jurisdiction',
    flood_buildable_pct: 1, in_500yr_flood: false,
    dist_to_tx_line_m: 1500, dist_to_ixp_km: 9,
    utility: 'assumed-CPS-Energy', state_code: 'F2',
    lat: 29.4, lng: -98.6, geometry_wkt: null,
    drivers: {
      land_cost_per_acre_usd: { value: 30_000, basis: 'modeled', source_url: 't', last_verified: '2026-08' },
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

const estimate = () => ({
  ...estimateParcel(row('p1'), PROJECT, bexarConfig),
  rank: 1,
  weighted_score: 0.75,
})

describe('the deterministic note', () => {
  it('names the dominant cost and flags assumed drivers', () => {
    const text = buildFallbackNote(estimate())
    expect(text).toMatch(/per kW/)
    expect(text.toLowerCase()).toMatch(/assumed|source/)
    expect(text.split('.').filter(s => s.trim()).length).toBeGreaterThanOrEqual(2)
  })

  it('says nothing about the owner, address or neighbourhood', () => {
    const text = buildFallbackNote(estimate()).toLowerCase()
    for (const banned of ['owner', 'neighbourhood', 'neighborhood', 'test rd', 'address']) {
      expect(text).not.toContain(banned)
    }
  })

  it('uses only numbers that appear in the estimate', () => {
    const e = estimate()
    expect(everyNumberIsTraceable(buildFallbackNote(e), e)).toBe(true)
  })
})

describe('the number guard', () => {
  it('rejects prose carrying a figure the estimate does not contain', () => {
    const e = estimate()
    expect(everyNumberIsTraceable('Lifetime cost is $88,888,888 per kW.', e)).toBe(false)
  })

  it('accepts prose with no numbers at all', () => {
    expect(everyNumberIsTraceable('Land dominates the capital cost here.', estimate())).toBe(true)
  })
})

describe('generation policy', () => {
  it('returns the deterministic note with no credentials present', async () => {
    const n = await parcelNote(estimate(), { forceFallback: true, skipCache: true })
    expect(n.source).toBe('fallback')
    expect(n.text.length).toBeGreaterThan(20)
  })

  it('is never generated for a whole result set', async () => {
    // Scoring 50 parcels must not produce a single note. Notes are on demand for
    // the parcel being viewed; batching 3,046 of them is the failure this guards.
    const spy = vi.fn(buildFallbackNote)
    const rows = Array.from({ length: 50 }, (_, i) => row(`p${i}`))
    scoreAll(rows, PROJECT, bexarConfig)
    expect(spy).not.toHaveBeenCalled()
  })
})
