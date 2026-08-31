/**
 * Tests for revenue-driven payback in computeFinance.
 *
 * Rule from work order: revenue absent → payback_years null.
 * Worked example → expected payback. net_annual ≤ 0 → null.
 */

import { describe, it, expect } from 'vitest'
import { computeCapex } from '../src/engine/capex.js'
import { computeOpex } from '../src/engine/opex.js'
import { computeFinance, type FinanceParams } from '../src/engine/finance.js'

// ── Shared fixture ─────────────────────────────────────────────────────────────

const capexParams = {
  capacity_kw:              10_000,
  land_cost_per_acre_usd:   18_000,
  construction_cost_per_kw: 10_200,
  incentive_usd:            0,
}
const capex = computeCapex(capexParams)

const opexParams = {
  capacity_kw:             10_000,
  design_pue:              1.4,
  power_rate_usd_per_kwh:  0.05,
  water_rate_usd_per_kgal: 1.10,
  design_wue:              0.4,
  staff_cost_index:        1.0,
  tax_rate:                0.015,
  tax_abatement_years:     0,
  current_year:            1,
  capex_total_usd:         capex.total_usd,
}
const opex = computeOpex(opexParams)

function baseParams(overrides?: Partial<FinanceParams>): FinanceParams {
  return {
    lifetime_years:          20,
    discount_rate:           0.08,
    capacity_kw:             10_000,
    capex,
    opexBase:                opex,
    opexParamsBase:          opexParams,
    capexParamsBase:         capexParams,
    power_rate_low:          0.04,
    power_rate_high:         0.07,
    construction_cost_low:   9_000,
    construction_cost_high:  12_000,
    ...overrides,
  }
}

// ── Revenue absent ─────────────────────────────────────────────────────────────

describe('computeFinance — revenue absent', () => {
  it('payback_years is null when revenue_per_kw_month is not provided', () => {
    const f = computeFinance(baseParams())
    expect(f.payback_years).toBeNull()
  })

  it('annual_revenue_usd is null when revenue_per_kw_month is not provided', () => {
    const f = computeFinance(baseParams())
    expect(f.annual_revenue_usd).toBeNull()
  })

  it('net_annual_usd is null when revenue_per_kw_month is not provided', () => {
    const f = computeFinance(baseParams())
    expect(f.net_annual_usd).toBeNull()
  })

  it('payback_years is null when revenue_per_kw_month is 0', () => {
    const f = computeFinance(baseParams({ revenue_per_kw_month: 0 }))
    expect(f.payback_years).toBeNull()
  })
})

// ── Revenue present, worked example ───────────────────────────────────────────

describe('computeFinance — revenue worked example', () => {
  /**
   * Worked example:
   *   capacity_kw            = 10,000
   *   revenue_per_kw_month   = 150
   *   occupancy_pct          = 0.85
   *
   *   annual_revenue = 10,000 × 150 × 12 × 0.85 = 15,300,000
   *   opex_annual    = opex.total_usd  (computed above)
   *   net_annual     = 15,300,000 − opex.total_usd
   *   payback_years  = capex.total_usd ÷ net_annual
   */
  const revenue_per_kw_month = 150
  const occupancy_pct        = 0.85
  const annualRevenue        = 10_000 * revenue_per_kw_month * 12 * occupancy_pct
  const netAnnual            = annualRevenue - opex.total_usd
  const expectedPayback      = capex.total_usd / netAnnual

  it('annual_revenue_usd matches the formula', () => {
    const f = computeFinance(baseParams({ revenue_per_kw_month, occupancy_pct }))
    expect(f.annual_revenue_usd).toBeCloseTo(annualRevenue, 0)
  })

  it('net_annual_usd = annual_revenue − opex_annual.total_usd', () => {
    const f = computeFinance(baseParams({ revenue_per_kw_month, occupancy_pct }))
    expect(f.net_annual_usd).toBeCloseTo(netAnnual, 0)
  })

  it('payback_years = capex.total_usd ÷ net_annual', () => {
    const f = computeFinance(baseParams({ revenue_per_kw_month, occupancy_pct }))
    expect(f.payback_years).toBeCloseTo(expectedPayback, 1)
  })

  it('payback_years is a positive number when net_annual is positive', () => {
    const f = computeFinance(baseParams({ revenue_per_kw_month, occupancy_pct }))
    expect(typeof f.payback_years).toBe('number')
    expect(f.payback_years!).toBeGreaterThan(0)
  })

  it('npv_usd is unchanged (still a cost NPV, negative)', () => {
    const f = computeFinance(baseParams({ revenue_per_kw_month, occupancy_pct }))
    expect(f.npv_usd).toBeLessThan(0)
  })
})

// ── Revenue too low to cover opex (net_annual ≤ 0) ────────────────────────────

describe('computeFinance — net_annual at or below zero', () => {
  it('payback_years is null when revenue is very low (net_annual < 0)', () => {
    // Revenue at $1/kW/month is far below any realistic opex, so net_annual < 0.
    const f = computeFinance(baseParams({ revenue_per_kw_month: 1, occupancy_pct: 0.85 }))
    expect(f.annual_revenue_usd).not.toBeNull()
    expect(f.net_annual_usd).not.toBeNull()
    expect(f.net_annual_usd!).toBeLessThanOrEqual(0)
    expect(f.payback_years).toBeNull()
  })

  it('payback_years is null when occupancy is 0 (net_annual = -opex)', () => {
    const f = computeFinance(baseParams({ revenue_per_kw_month: 150, occupancy_pct: 0 }))
    // occupancy 0 → annual_revenue = 0 → net_annual = -opex < 0
    expect(f.annual_revenue_usd).toBeCloseTo(0, 0)
    expect(f.net_annual_usd!).toBeLessThan(0)
    expect(f.payback_years).toBeNull()
  })
})
