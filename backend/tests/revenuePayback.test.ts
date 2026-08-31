/**
 * backend/tests/revenuePayback.test.ts
 *
 * Payback exists only when the reader supplies a revenue assumption.
 *
 * The engine prices costs. What a site earns is a commercial judgement no
 * public dataset carries, so revenue arrives as an input and payback is
 * withheld rather than approximated whenever that input is missing or does not
 * clear the running cost.
 */

import { describe, it, expect } from 'vitest'
import { computeCapex } from '../src/engine/capex.js'
import { computeOpex } from '../src/engine/opex.js'
import { computeFinance } from '../src/engine/finance.js'

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
  design_wue:              0.4,
  staff_cost_index:        1.35,
  tax_rate:                0.022,
  tax_abatement_years:     0,
  current_year:            1,
  capex_total_usd:         capex.total_usd,
}
const opex = computeOpex(opexParams)

const base = {
  lifetime_years: 15,
  discount_rate: 0.08,
  capacity_kw: 10_000,
  capex,
  opexBase: opex,
  opexParamsBase: opexParams,
  capexParamsBase: capexParams,
  power_rate_low: 0.018,
  power_rate_high: 0.036,
  construction_cost_low: 9_100,
  construction_cost_high: 12_000,
}

describe('payback without revenue', () => {
  it('stays null when no revenue is supplied', () => {
    const f = computeFinance(base)
    expect(f.payback_years).toBeNull()
    expect(f.annual_revenue_usd).toBeNull()
    expect(f.net_annual_usd).toBeNull()
  })

  it('stays null when revenue is zero', () => {
    const f = computeFinance({ ...base, revenue_per_kw_month: 0 })
    expect(f.payback_years).toBeNull()
  })
})

describe('payback with revenue', () => {
  it('computes revenue from capacity, rate, twelve months and occupancy', () => {
    const f = computeFinance({ ...base, revenue_per_kw_month: 150, occupancy_pct: 0.9 })
    // 10,000 kW × $150 × 12 months × 0.9 = $16,200,000
    expect(f.annual_revenue_usd).toBeCloseTo(16_200_000, 0)
  })

  it('defaults occupancy to 0.85 when it is not given', () => {
    const f = computeFinance({ ...base, revenue_per_kw_month: 150 })
    // 10,000 × 150 × 12 × 0.85 = $15,300,000
    expect(f.annual_revenue_usd).toBeCloseTo(15_300_000, 0)
  })

  it('nets off the year one operating cost and pays back the capital', () => {
    const f = computeFinance({ ...base, revenue_per_kw_month: 150, occupancy_pct: 0.9 })
    expect(f.net_annual_usd).toBeCloseTo(16_200_000 - opex.total_usd, 0)
    expect(f.payback_years).toBeCloseTo(capex.total_usd / (16_200_000 - opex.total_usd), 1)
    expect(f.payback_years).toBeGreaterThan(0)
  })

  it('a richer site pays back sooner than a leaner one', () => {
    const lean = computeFinance({ ...base, revenue_per_kw_month: 120 })
    const rich = computeFinance({ ...base, revenue_per_kw_month: 200 })
    expect(rich.payback_years!).toBeLessThan(lean.payback_years!)
  })
})

describe('payback is withheld rather than approximated', () => {
  it('is null when revenue does not cover the running cost', () => {
    // A dollar per kW per month cannot clear a year of operating cost.
    const f = computeFinance({ ...base, revenue_per_kw_month: 1 })
    expect(f.net_annual_usd).toBeLessThan(0)
    expect(f.payback_years).toBeNull()
  })

  it('never returns a negative payback', () => {
    for (const rate of [0.5, 1, 5, 10, 25]) {
      const f = computeFinance({ ...base, revenue_per_kw_month: rate })
      if (f.payback_years !== null) expect(f.payback_years).toBeGreaterThan(0)
    }
  })
})

describe('revenue does not touch the cost NPV', () => {
  it('leaves npv_usd and lifetime cost per kW unchanged', () => {
    const without = computeFinance(base)
    const withRevenue = computeFinance({ ...base, revenue_per_kw_month: 150 })
    expect(withRevenue.npv_usd).toBe(without.npv_usd)
    expect(withRevenue.lifetime_cost_per_kw).toBe(without.lifetime_cost_per_kw)
  })
})
