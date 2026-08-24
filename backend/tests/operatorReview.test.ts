/**
 * backend/tests/operatorReview.test.ts
 *
 * A working data-center operator read this model in August 2026 and said four
 * things were wrong. Three of them were, and one was not. These tests hold the
 * three fixes and record what the fourth turned out to be.
 *
 *   1. Mechanical and electrical were charged twice.
 *   2. Maintenance ran at 1.5% of the build cost against his under 1%.
 *   3. Cooling overhead was set at 1.4, against 1.25 at his own facility.
 *   4. He suspected the discount rate was double counted in the running cost.
 *      It is not, and the test below proves the discounting is applied once.
 *      What was wrong nearby is that a property tax abatement ran for the whole
 *      life of the build instead of stopping in the year it ends.
 */

import { describe, it, expect } from 'vitest'
import { computeCapex } from '../src/engine/capex.js'
import { computeOpex, type OpexParams } from '../src/engine/opex.js'
import { computeFinance } from '../src/engine/finance.js'
import { ASSUMPTIONS, MAINTENANCE_RATE, DEFAULT_DESIGN_PUE } from '../src/engine/assumptions.js'

const CAPACITY = 10_000

const capexParams = {
  capacity_kw:              CAPACITY,
  land_cost_per_acre_usd:   55_000,
  construction_cost_per_kw: 9_540,
  incentive_usd:            0,
}

function opexParams(over: Partial<OpexParams> = {}): OpexParams {
  return {
    capacity_kw:             CAPACITY,
    design_pue:              DEFAULT_DESIGN_PUE,
    power_rate_usd_per_kwh:  0.038,
    water_rate_usd_per_kgal: 5.88,
    design_wue:              0.4,
    staff_cost_index:        0.96,
    tax_rate:                0.019,
    tax_abatement_years:     0,
    current_year:            1,
    capex_total_usd:         0,
    ...over,
  }
}

// ── 1. The build cost is not charged twice ────────────────────────────────────

describe('mechanical and electrical are inside the published build cost', () => {
  it('the total is land plus the build cost, with nothing added on top', () => {
    const c = computeCapex(capexParams)
    const acres = Math.max(5, (CAPACITY / 1000) * 1.2)
    expect(c.total_usd).toBe(acres * 55_000 + CAPACITY * 9_540)
  })

  it('switchgear and cooling plant are no longer separate lines', () => {
    const c = computeCapex(capexParams)
    expect(c.electrical_usd).toBe(0)
    expect(c.cooling_usd).toBe(0)
    expect(c.it_fitout_usd).toBe(0)
  })

  it('what the build cost leaves out is written down and cites the index that says so', () => {
    const scope = ASSUMPTIONS.find(a => a.key === 'build_cost_scope')!
    expect(scope).toBeDefined()
    expect(scope.method).toMatch(/active IT equipment/i)
    expect(scope.method).toMatch(/professional fees/i)
    expect(scope.source_url).toContain('methodology')
  })
})

// ── 2. Maintenance ────────────────────────────────────────────────────────────

describe('maintenance', () => {
  it('runs at 1.0% of the build cost, not 1.5%', () => {
    expect(MAINTENANCE_RATE).toBe(0.010)
    const o = computeOpex(opexParams({ capex_total_usd: 100_000_000 }))
    expect(o.maintenance_usd).toBe(1_000_000)
  })

  it('says it is an assumption rather than borrowing a source it does not have', () => {
    const m = ASSUMPTIONS.find(a => a.key === 'maintenance_rate')!
    expect(m.basis).toBe('assumed')
    expect(m.source_url).toBe('')
    expect(m.method.length).toBeGreaterThan(80)
  })
})

// ── 3. Cooling overhead ───────────────────────────────────────────────────────

describe('cooling overhead', () => {
  it('defaults to 1.25', () => {
    expect(DEFAULT_DESIGN_PUE).toBe(1.25)
  })

  it('is described as a design target and names what running fleets actually average', () => {
    const p = ASSUMPTIONS.find(a => a.key === 'design_pue')!
    expect(p.basis).toBe('assumed')
    expect(p.method).toMatch(/1\.54/)
    expect(p.method).toMatch(/1\.44/)
    expect(p.source_url).toContain('uptimeinstitute')
  })
})

// ── 4. The discount rate is applied once ──────────────────────────────────────

describe('the discount rate', () => {
  it('is applied exactly once, so the total matches a hand-worked annuity', () => {
    const capex = computeCapex(capexParams)
    const params = opexParams({ capex_total_usd: capex.total_usd })
    const year1 = computeOpex(params)

    const finance = computeFinance({
      lifetime_years:  15,
      discount_rate:   0.08,
      capacity_kw:     CAPACITY,
      capex,
      opexBase:        year1,
      opexParamsBase:  params,
      capexParamsBase: capexParams,
      power_rate_low:  0.028,
      power_rate_high: 0.055,
      construction_cost_low:  7_400,
      construction_cost_high: 9_400,
      incentive_usd:   0,
    })

    // No abatement here, so every year carries the same running cost and the
    // whole stream collapses to an ordinary annuity. Worked by hand:
    //   factor = (1 - 1.08^-15) / 0.08
    const factor = (1 - Math.pow(1.08, -15)) / 0.08
    const byHand = -(capex.total_usd + year1.total_usd * factor)

    expect(finance.npv_usd).toBeCloseTo(byHand, 0)
  })
})

// ── The defect that was actually there ────────────────────────────────────────

describe('a tax abatement stops in the year it ends', () => {
  const capex = computeCapex(capexParams)

  function npvWithAbatement(years: number): number {
    const params = opexParams({ capex_total_usd: capex.total_usd, tax_abatement_years: years })
    return computeFinance({
      lifetime_years:  15,
      discount_rate:   0.08,
      capacity_kw:     CAPACITY,
      capex,
      opexBase:        computeOpex(params),
      opexParamsBase:  params,
      capexParamsBase: capexParams,
      power_rate_low:  0.028,
      power_rate_high: 0.055,
      construction_cost_low:  7_400,
      construction_cost_high: 9_400,
      incentive_usd:   0,
    }).npv_usd
  }

  it('a ten-year abatement on a fifteen-year build costs more than a fifteen-year one', () => {
    const ten     = npvWithAbatement(10)
    const fifteen = npvWithAbatement(15)
    // Both are negative; the ten-year case pays tax in years 11 to 15.
    expect(Math.abs(ten)).toBeGreaterThan(Math.abs(fifteen))
  })

  it('the five taxed years are worth about three and a half million in today\'s money', () => {
    const annualTax = capex.total_usd * 0.019
    const gap = Math.abs(npvWithAbatement(10)) - Math.abs(npvWithAbatement(15))
    // A ten-year abatement covers years 1 to 10, so tax falls in years 11 to 15.
    let expected = 0
    for (let y = 11; y <= 15; y++) expected += annualTax / Math.pow(1.08, y)
    expect(gap).toBeCloseTo(expected, 0)
  })

  it('an abatement of one year is not the same as an abatement of fifteen', () => {
    expect(Math.abs(npvWithAbatement(1))).toBeGreaterThan(Math.abs(npvWithAbatement(15)) + 1_000_000)
  })

  it('no abatement at all is the most expensive of the three', () => {
    expect(Math.abs(npvWithAbatement(0))).toBeGreaterThan(Math.abs(npvWithAbatement(10)))
  })
})

// ── Every project-level figure is published ───────────────────────────────────

describe('the assumptions are published, not buried in the code', () => {
  it('each one carries a basis, a date and its working', () => {
    expect(ASSUMPTIONS.length).toBeGreaterThanOrEqual(6)
    for (const a of ASSUMPTIONS) {
      expect(['sourced', 'modeled', 'assumed']).toContain(a.basis)
      expect(a.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(a.method.length).toBeGreaterThan(40)
      expect(a.label.length).toBeGreaterThan(0)
    }
  })

  it('anything calling itself sourced carries a link', () => {
    for (const a of ASSUMPTIONS) {
      if (a.basis === 'sourced') expect(a.source_url).toMatch(/^https:\/\//)
    }
  })
})
