/**
 * backend/tests/parseCriteria.test.ts
 *
 * The deterministic matcher is the path that runs — watsonx credentials are
 * disabled — so it is tested as the primary implementation, not as a fallback.
 */

import { describe, it, expect } from 'vitest'
import { parseCriteria, parseCriteriaFallback, validateParsed } from '../src/llm/parseCriteria.js'

describe('deterministic criteria matcher', () => {
  it('reads three criteria out of one sentence', () => {
    const r = parseCriteriaFallback(
      'at least 50 acres, within 5 km of transmission, and no flood risk')
    expect(r.filters.min_acres).toBe(50)
    expect(r.filters.max_dist_tx_m).toBe(5_000)
    expect(r.filters.exclude_flood).toBe(true)
  })

  it('converts miles to metres', () => {
    const r = parseCriteriaFallback('within 3 miles of the grid')
    expect(r.filters.max_dist_tx_m).toBeCloseTo(3 * 1609.344, 0)
  })

  it('reads a land price ceiling with a k suffix', () => {
    const r = parseCriteriaFallback('under $20k per acre')
    expect(r.filters.max_land_cost_per_acre).toBe(20_000)
  })

  it('reads the suffix form of acreage', () => {
    const r = parseCriteriaFallback('200+ acres near power')
    expect(r.filters.min_acres).toBe(200)
  })

  it('shifts weights when cost is emphasised', () => {
    const r = parseCriteriaFallback('cheapest option, at least 30 acres')
    expect(r.weights.total_cost).toBeGreaterThan(0.5)
    expect(r.filters.min_acres).toBe(30)
  })

  it('understands a plain request to favor cost', () => {
    const r = parseCriteriaFallback('Favor cost')
    expect(r.weights.total_cost).toBe(0.70)
    expect(r.unparsed).toEqual([])
  })

  it('reports an unsupported criterion rather than dropping it silently', () => {
    const r = parseCriteriaFallback('at least 40 acres and existing water rights')
    expect(r.filters.min_acres).toBe(40)
    expect(r.unparsed.join(' ')).toMatch(/water/i)
  })

  it('produces usable filters with no credentials present', async () => {
    const r = await parseCriteria('at least 100 acres within 2 km of transmission',
      { forceFallback: true })
    expect(r.source).toBe('fallback')
    expect(r.filters.min_acres).toBe(100)
    expect(r.filters.max_dist_tx_m).toBe(2_000)
  })
})

describe('validation drops what the vocabulary does not contain', () => {
  it('rejects an invented filter key and names it', () => {
    const { filters, rejected } = validateParsed({
      filters: { min_acres: 50, has_water_rights: true, max_slope_deg: 5 },
    })
    expect(filters.min_acres).toBe(50)
    expect(rejected).toContain('has_water_rights')
    expect(rejected).toContain('max_slope_deg')
    expect(Object.keys(filters)).toEqual(['min_acres'])
  })

  it('rejects out-of-range weights', () => {
    const { weights, rejected } = validateParsed({
      weights: { total_cost: 0.6, risk: 4, made_up: 0.2 },
    })
    expect(weights.total_cost).toBe(0.6)
    expect(rejected).toContain('risk')
    expect(rejected).toContain('made_up')
  })

  it('rejects a negative number', () => {
    const { filters, rejected } = validateParsed({ filters: { min_acres: -10 } })
    expect(filters.min_acres).toBeUndefined()
    expect(rejected).toContain('min_acres')
  })
})
