/**
 * Unit tests for the deterministic cost/ranking engine.
 * Uses the 3 hero sites (Northern Virginia, Texas ERCOT, Nordic Hydro)
 * as fixture inputs.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { computeCapex }    from '../src/engine/capex.js'
import { computeOpex }     from '../src/engine/opex.js'
import { computeFinance }  from '../src/engine/finance.js'
import { rankSites }       from '../src/engine/rank.js'
import { computeSensitivity } from '../src/engine/sensitivity.js'
import { runEngine }        from '../src/engine/index.js'
import { _resetRegionsCache } from '../src/regions.js'

// ── capex.ts ─────────────────────────────────────────────────────────────────
describe('computeCapex', () => {
  it('sums land + shell + electrical + cooling + fitout minus incentive', () => {
    const result = computeCapex({
      capacity_kw:              10_000,
      land_cost_per_acre_usd:   420_000,
      construction_cost_per_kw: 9_100,
      incentive_usd:            500_000,
    })
    // land: max(5, 10×1.2) = 12 acres × $420k = $5,040,000
    expect(result.land_usd).toBe(5_040_000)
    // shell: 10,000 × $9,100 = $91,000,000
    expect(result.construction_usd).toBe(91_000_000)
    // electrical: 10,000 × $550 = $5,500,000
    expect(result.electrical_usd).toBe(5_500_000)
    // cooling: 10,000 × $400 = $4,000,000
    expect(result.cooling_usd).toBe(4_000_000)
    // fitout: 10,000 × $200 = $2,000,000
    expect(result.it_fitout_usd).toBe(2_000_000)
    // total = sum − incentive
    const gross = 5_040_000 + 91_000_000 + 5_500_000 + 4_000_000 + 2_000_000
    expect(result.total_usd).toBe(gross - 500_000)
  })

  it('uses minimum 5-acre land parcel for small sites', () => {
    const result = computeCapex({
      capacity_kw:              200,
      land_cost_per_acre_usd:   100_000,
      construction_cost_per_kw: 8_000,
      incentive_usd:            0,
    })
    // 200kW / 1000 × 1.2 = 0.24 acres → use minimum 5
    expect(result.land_usd).toBe(500_000)
  })

  it('total is never negative (large incentive clamped)', () => {
    const result = computeCapex({
      capacity_kw:              1_000,
      land_cost_per_acre_usd:   50_000,
      construction_cost_per_kw: 8_000,
      incentive_usd:            999_999_999,
    })
    expect(result.total_usd).toBeGreaterThanOrEqual(0)
  })
})

// ── opex.ts ───────────────────────────────────────────────────────────────────
describe('computeOpex', () => {
  const baseParams = {
    capacity_kw:             10_000,
    design_pue:              1.4,
    power_rate_usd_per_kwh:  0.038,
    water_rate_usd_per_kgal: 3.20,
    wue:                     1.6,
    staff_cost_index:        0.96,
    tax_rate:                0.019,
    tax_abatement_years:     10,
    current_year:            1,
    capex_total_usd:         100_000_000,
  }

  it('computes power cost = capacity × PUE × 8760 × rate', () => {
    const r = computeOpex(baseParams)
    const expected = 10_000 * 1.4 * 8_760 * 0.038
    expect(r.power_usd).toBeCloseTo(expected, 0)
  })

  it('suppresses property tax during abatement years', () => {
    const r = computeOpex({ ...baseParams, current_year: 5, tax_abatement_years: 10 })
    expect(r.taxes_usd).toBe(0)
  })

  it('charges property tax after abatement expires', () => {
    const r = computeOpex({ ...baseParams, current_year: 11, tax_abatement_years: 10 })
    expect(r.taxes_usd).toBeGreaterThan(0)
    expect(r.taxes_usd).toBeCloseTo(100_000_000 * 0.019, 0)
  })

  it('total equals sum of components', () => {
    const r = computeOpex(baseParams)
    const sum = r.power_usd + r.water_usd + r.staff_usd + r.maintenance_usd + r.taxes_usd + r.connectivity_usd
    expect(r.total_usd).toBeCloseTo(sum, 1)
  })

  it('Nordic hydro WUE 1.03 produces near-zero water cost vs Texas WUE 1.6', () => {
    const nordicWater = computeOpex({ ...baseParams, wue: 1.03, water_rate_usd_per_kgal: 1.10 }).water_usd
    const texasWater  = computeOpex({ ...baseParams, wue: 1.6,  water_rate_usd_per_kgal: 3.20 }).water_usd
    expect(nordicWater).toBeLessThan(texasWater)
  })
})

// ── finance.ts ────────────────────────────────────────────────────────────────
describe('computeFinance', () => {
  const capexParams = {
    capacity_kw:              10_000,
    land_cost_per_acre_usd:   18_000,
    construction_cost_per_kw: 10_200,
    incentive_usd:            300_000,
  }
  const capex = computeCapex(capexParams)
  const opexParams = {
    capacity_kw:             10_000,
    design_pue:              1.4,
    power_rate_usd_per_kwh:  0.024,
    water_rate_usd_per_kgal: 1.10,
    wue:                     1.03,
    staff_cost_index:        1.35,
    tax_rate:                0.022,
    tax_abatement_years:     0,
    current_year:            1,
    capex_total_usd:         capex.total_usd,
  }
  const opex = computeOpex(opexParams)

  it('npv_usd is negative (cost NPV)', () => {
    const f = computeFinance({
      lifetime_years: 15, discount_rate: 0.08,
      capacity_kw: 10_000,
      capex, opexBase: opex,
      opexParamsBase: opexParams, capexParamsBase: capexParams,
      power_rate_low: 0.018, power_rate_high: 0.036,
      construction_cost_low: 9_100, construction_cost_high: 12_000,
      incentive_usd: 300_000,
    })
    expect(f.npv_usd).toBeLessThan(0)
  })

  it('low scenario NPV is less negative than high scenario', () => {
    const f = computeFinance({
      lifetime_years: 15, discount_rate: 0.08,
      capacity_kw: 10_000,
      capex, opexBase: opex,
      opexParamsBase: opexParams, capexParamsBase: capexParams,
      power_rate_low: 0.018, power_rate_high: 0.036,
      construction_cost_low: 9_100, construction_cost_high: 12_000,
      incentive_usd: 300_000,
    })
    // low = cheaper → less negative NPV
    expect(f.ranges.low.npv_usd).toBeGreaterThan(f.ranges.high.npv_usd)
  })

  it('levelized cost per kW = |NPV| / capacity_kw', () => {
    const f = computeFinance({
      lifetime_years: 15, discount_rate: 0.08,
      capacity_kw: 10_000,
      capex, opexBase: opex,
      opexParamsBase: opexParams, capexParamsBase: capexParams,
      power_rate_low: 0.018, power_rate_high: 0.036,
      construction_cost_low: 9_100, construction_cost_high: 12_000,
      incentive_usd: 300_000,
    })
    expect(f.levelized_cost_per_kw).toBeCloseTo(Math.abs(f.npv_usd) / 10_000, 0)
  })
})

// ── rank.ts ───────────────────────────────────────────────────────────────────
describe('rankSites', () => {
  it('lower NPV (more negative = more expensive) gets lower rank', () => {
    const result = rankSites([
      { site_id: 'expensive', npv_usd: -500_000_000, risk_score: 3, renewable_pct: 0.5, latency_ms: 10 },
      { site_id: 'cheap',     npv_usd: -100_000_000, risk_score: 3, renewable_pct: 0.5, latency_ms: 10 },
    ])
    const cheapRank = result.find(r => r.site_id === 'cheap')!.rank
    expect(cheapRank).toBe(1)
  })

  it('returns scores between 0 and 1', () => {
    const result = rankSites([
      { site_id: 'A', npv_usd: -200_000_000, risk_score: 2, renewable_pct: 0.9, latency_ms: 5 },
      { site_id: 'B', npv_usd: -300_000_000, risk_score: 6, renewable_pct: 0.2, latency_ms: 30 },
      { site_id: 'C', npv_usd: -250_000_000, risk_score: 4, renewable_pct: 0.5, latency_ms: 15 },
    ])
    for (const r of result) {
      expect(r.weighted_score).toBeGreaterThanOrEqual(0)
      expect(r.weighted_score).toBeLessThanOrEqual(1)
    }
  })

  it('all-equal dimension scores 0.5', () => {
    const result = rankSites([
      { site_id: 'A', npv_usd: -100, risk_score: 5, renewable_pct: 0.5, latency_ms: 10 },
      { site_id: 'B', npv_usd: -100, risk_score: 5, renewable_pct: 0.5, latency_ms: 10 },
    ])
    for (const r of result) {
      expect(r.weighted_score).toBeCloseTo(0.5, 5)
    }
  })
})

// ── sensitivity.ts ────────────────────────────────────────────────────────────
describe('computeSensitivity', () => {
  // Nordic (cheap power) should be rank-1; NOVA (expensive power) rank-2
  const nordicCapex = {
    capacity_kw:              10_000,
    land_cost_per_acre_usd:   18_000,
    construction_cost_per_kw: 10_200,
    incentive_usd:            300_000,
  }
  const novaCapex = {
    capacity_kw:              10_000,
    land_cost_per_acre_usd:   420_000,
    construction_cost_per_kw: 9_100,
    incentive_usd:            500_000,
  }
  const nordicOpex = {
    capacity_kw: 10_000, design_pue: 1.4,
    power_rate_usd_per_kwh: 0.024, water_rate_usd_per_kgal: 1.10, wue: 1.03,
    staff_cost_index: 1.35, tax_rate: 0.022, tax_abatement_years: 0,
    current_year: 1, capex_total_usd: computeCapex(nordicCapex).total_usd,
  }
  const novaOpex = {
    capacity_kw: 10_000, design_pue: 1.4,
    power_rate_usd_per_kwh: 0.068, water_rate_usd_per_kgal: 5.20, wue: 1.4,
    staff_cost_index: 1.18, tax_rate: 0.060, tax_abatement_years: 0,
    current_year: 1, capex_total_usd: computeCapex(novaCapex).total_usd,
  }

  it('returns at least one sensitivity item', () => {
    const items = computeSensitivity(
      { site_id: 'nordic', capexParams: nordicCapex, opexParams: nordicOpex, discount_rate: 0.08, lifetime_years: 15 },
      { site_id: 'nova',   capexParams: novaCapex,   opexParams: novaOpex,   discount_rate: 0.08, lifetime_years: 15 },
    )
    expect(items.length).toBeGreaterThan(0)
  })

  it('flip_value > current_value when searching up', () => {
    const items = computeSensitivity(
      { site_id: 'nordic', capexParams: nordicCapex, opexParams: nordicOpex, discount_rate: 0.08, lifetime_years: 15 },
      { site_id: 'nova',   capexParams: novaCapex,   opexParams: novaOpex,   discount_rate: 0.08, lifetime_years: 15 },
    )
    const powerItem = items.find(i => i.driver === 'power_rate_usd_per_kwh')
    if (powerItem) {
      expect(powerItem.flip_value).toBeGreaterThan(powerItem.current_value)
    }
  })

  it('pct_change is positive', () => {
    const items = computeSensitivity(
      { site_id: 'nordic', capexParams: nordicCapex, opexParams: nordicOpex, discount_rate: 0.08, lifetime_years: 15 },
      { site_id: 'nova',   capexParams: novaCapex,   opexParams: novaOpex,   discount_rate: 0.08, lifetime_years: 15 },
    )
    for (const item of items) {
      expect(item.pct_change).toBeGreaterThanOrEqual(0)
    }
  })
})

// ── runEngine integration — hero 3-site fixture ───────────────────────────────
// All runEngine calls use forceFallback:true so tests never need LLM credentials.
describe('runEngine (hero sites fixture)', () => {
  beforeEach(() => { _resetRegionsCache() })

  const input = {
    request_id: '00000000-0000-0000-0000-000000000001',
    project: {
      name: 'Hero Sites Test',
      capacity_kw: 10_000,
      design_pue: 1.4,
      lifetime_years: 15,
      discount_rate: 0.08,
    },
    sites: [
      { site_id: 'nova',   label: 'Northern Virginia', region_key: 'us-va-northern' },
      { site_id: 'ercot',  label: 'Texas ERCOT',        region_key: 'us-tx-ercot'    },
      { site_id: 'nordic', label: 'Nordic Hydro',        region_key: 'eu-nordic-hydro' },
    ],
  }
  const opts = { forceFallback: true, skipCache: true }

  it('returns a result with engine_version 0.2.0', async () => {
    const out = await runEngine(input, opts)
    expect(out.engine_version).toBe('0.2.0')
  })

  it('ranking array contains all 3 site IDs', async () => {
    const out = await runEngine(input, opts)
    expect(out.ranking).toHaveLength(3)
    expect(out.ranking).toContain('nova')
    expect(out.ranking).toContain('ercot')
    expect(out.ranking).toContain('nordic')
  })

  it('Nordic Hydro is ranked #1 (cheapest total cost)', async () => {
    // Nordic has by far the lowest power rate ($0.024 vs $0.068 VA / $0.038 TX)
    // Under default weights (50% cost) it should win.
    const out = await runEngine(input, opts)
    expect(out.sites['nordic'].rank).toBe(1)
  })

  it('each site has positive CapEx components', async () => {
    const out = await runEngine(input, opts)
    for (const sid of out.ranking) {
      const c = out.sites[sid].capex
      expect(c.land_usd).toBeGreaterThan(0)
      expect(c.construction_usd).toBeGreaterThan(0)
      expect(c.total_usd).toBeGreaterThan(0)
    }
  })

  it('each site has positive annual OpEx components', async () => {
    const out = await runEngine(input, opts)
    for (const sid of out.ranking) {
      const o = out.sites[sid].opex_annual
      expect(o.power_usd).toBeGreaterThan(0)
      expect(o.total_usd).toBeGreaterThan(0)
    }
  })

  it('npv_usd is negative for all sites', async () => {
    const out = await runEngine(input, opts)
    for (const sid of out.ranking) {
      expect(out.sites[sid].finance.npv_usd).toBeLessThan(0)
    }
  })

  it('low scenario NPV > high scenario NPV (less negative = cheaper)', async () => {
    const out = await runEngine(input, opts)
    for (const sid of out.ranking) {
      const r = out.sites[sid].finance.ranges
      expect(r.low.npv_usd).toBeGreaterThan(r.high.npv_usd)
    }
  })

  it('weighted_score in [0,1] for all sites', async () => {
    const out = await runEngine(input, opts)
    for (const sid of out.ranking) {
      expect(out.sites[sid].weighted_score).toBeGreaterThanOrEqual(0)
      expect(out.sites[sid].weighted_score).toBeLessThanOrEqual(1)
    }
  })

  it('sensitivity has at least one item', async () => {
    const out = await runEngine(input, opts)
    expect(out.sensitivity.length).toBeGreaterThan(0)
  })

  it('flip_sentence is a non-empty string', async () => {
    const out = await runEngine(input, opts)
    expect(typeof out.flip_sentence).toBe('string')
    expect(out.flip_sentence.length).toBeGreaterThan(10)
  })

  it('data_provenance has one entry per (region_key, driver)', async () => {
    const out = await runEngine(input, opts)
    const keys = out.data_provenance.map(p => `${p.region_key}::${p.driver}`)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)   // no duplicates
  })

  it('Texas ERCOT power bill is lower than Northern Virginia power bill', async () => {
    const out = await runEngine(input, opts)
    expect(out.sites['ercot'].opex_annual.power_usd).toBeLessThan(out.sites['nova'].opex_annual.power_usd)
  })

  it('overrides supersede region values', async () => {
    const inputWithOverride = {
      ...input,
      sites: input.sites.map(s =>
        s.site_id === 'ercot'
          ? { ...s, overrides: { power_rate_usd_per_kwh: 0.001 } }
          : s
      ),
    }
    const out = await runEngine(inputWithOverride, opts)
    // ERCOT with near-zero power cost should easily be rank-1
    expect(out.sites['ercot'].rank).toBe(1)
  })
})
