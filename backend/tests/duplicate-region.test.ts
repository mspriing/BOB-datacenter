/**
 * Regression tests for the "one site compared against itself" defect.
 *
 * Reported symptom: a free-text description was entered on the setup screen and
 * the run came back with Texas ERCOT sitting where Nordic Hydro should have
 * been, so Texas ERCOT appeared twice and was ranked against itself.
 *
 * Two independent causes, both covered here:
 *   1. Nothing rejected a duplicate region_key at the API boundary.
 *   2. The free-text parser could return a region_key already in use, either
 *      from the model or from a first-wins substring match in the fallback.
 */

import { describe, it, expect } from 'vitest'
import { InputSchema } from '../src/schemas/input.js'
import { parseSiteDescription } from '../src/llm/parseInput.js'

const project = {
  name: 'Test campus',
  capacity_kw: 10_000,
  design_pue: 1.4,
  lifetime_years: 15,
  discount_rate: 0.08,
}

const site = (site_id: string, region_key: string, label = site_id) =>
  ({ site_id, label, region_key })

describe('InputSchema rejects a duplicated candidate', () => {
  it('rejects two sites on the same region_key', () => {
    const result = InputSchema.safeParse({
      project,
      sites: [site('a', 'us-tx-ercot'), site('b', 'us-tx-ercot')],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('different region_key')
    }
  })

  it('rejects two sites sharing a site_id', () => {
    const result = InputSchema.safeParse({
      project,
      sites: [site('a', 'us-tx-ercot'), site('a', 'us-va-northern')],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('different site_id')
    }
  })

  it('still accepts a set of genuinely distinct regions', () => {
    const result = InputSchema.safeParse({
      project,
      sites: [
        site('a', 'eu-nordic-hydro'),
        site('b', 'us-tx-ercot'),
        site('c', 'us-va-northern'),
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe('parseSiteDescription honours excludeRegionKeys', () => {
  it('will not return a region that another site already occupies', async () => {
    const text = 'This one is the Texas Hill Country / ERCOT (Hays County) site.'

    const free = await parseSiteDescription(text, { forceFallback: true })
    expect(free.region_key).toBe('us-tx-ercot')

    const blocked = await parseSiteDescription(text, {
      forceFallback: true,
      excludeRegionKeys: ['us-tx-ercot'],
    })
    expect(blocked.region_key).toBeNull()
    expect(blocked.inferred_fields).not.toContain('region_key')
  })

  it('still extracts numeric overrides when the region is excluded', async () => {
    const parsed = await parseSiteDescription(
      'Texas Hill Country / ERCOT (Hays County) quoted us $0.041 per kWh.',
      { forceFallback: true, excludeRegionKeys: ['us-tx-ercot'] },
    )
    expect(parsed.region_key).toBeNull()
    expect(parsed.overrides.power_rate_usd_per_kwh).toBeCloseTo(0.041)
  })

  it('prefers the longest matching label rather than whichever comes first', async () => {
    // "Northern Virginia (Loudoun County)" contains no other region label as a
    // substring, so the longest match is the only correct answer. Under the old
    // first-wins loop the result depended on object key order.
    const parsed = await parseSiteDescription(
      'We are looking at Northern Virginia (Loudoun County) for this one.',
      { forceFallback: true },
    )
    expect(parsed.region_key).toBe('us-va-northern')
  })
})
