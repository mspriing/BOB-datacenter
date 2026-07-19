/**
 * Financial calculations — pure function, no I/O, no LLM.
 *
 * NPV  = −CapEx − Σ(OpEx_y / (1+r)^y)   for y = 1..lifetime_years
 *         (negative because it's a cost NPV — lower is better)
 *
 * Levelized cost per kW = |NPV| / capacity_kw
 *
 * Payback: year when cumulative avoided annual cost vs. worst-ranked
 * alternative exceeds CapEx delta. For a single-site absolute measure,
 * we use: payback_years = capex / annual_opex (simple payback on opex only).
 *
 * Ranges (low/high) come from the dataset's low/high power-rate and
 * construction-cost bands, recomputed at the scenario boundary.
 */

import type { CapexResult } from './capex.js'
import type { OpexResult } from './opex.js'
import { computeCapex, type CapexParams } from './capex.js'
import { computeOpex, type OpexParams } from './opex.js'

export interface FinanceParams {
  lifetime_years:   number
  discount_rate:    number    // WACC, decimal
  capacity_kw:      number
  capex:            CapexResult
  // Year-1 opex at base scenario
  opexBase:         OpexResult
  // For range computation — scenario-boundary param patches
  opexParamsBase:   OpexParams
  capexParamsBase:  CapexParams
  // low/high bound values from dataset
  power_rate_low:   number
  power_rate_high:  number
  construction_cost_low:  number
  construction_cost_high: number
  incentive_usd:    number
}

export interface FinanceResult {
  levelized_cost_per_kw: number
  npv_usd:               number
  payback_years:         number
  ranges: {
    low:  { npv_usd: number; levelized_per_kw: number }
    base: { npv_usd: number; levelized_per_kw: number }
    high: { npv_usd: number; levelized_per_kw: number }
  }
}

/** Discount a stream of equal annual payments over lifetime_years. */
function npvOpexStream(annualOpex: number, r: number, years: number): number {
  if (r === 0) return annualOpex * years
  return annualOpex * (1 - Math.pow(1 + r, -years)) / r
}

/** Compute total-cost NPV for a given capex and constant annual opex. */
function totalNPV(capexTotal: number, annualOpex: number, r: number, years: number): number {
  return -(capexTotal + npvOpexStream(annualOpex, r, years))
}

/** Scenario NPV: recompute capex + opex with patched params, then NPV. */
function scenarioNPV(
  capexParams: CapexParams,
  opexParams: OpexParams,
  r: number,
  years: number,
): number {
  const cap  = computeCapex(capexParams)
  const opex = computeOpex({ ...opexParams, capex_total_usd: cap.total_usd })
  return totalNPV(cap.total_usd, opex.total_usd, r, years)
}

export function computeFinance(p: FinanceParams): FinanceResult {
  const r     = p.discount_rate
  const years = p.lifetime_years

  const baseNPV = totalNPV(p.capex.total_usd, p.opexBase.total_usd, r, years)
  const levelized = Math.abs(baseNPV) / p.capacity_kw

  // Simple payback = capex ÷ annual opex
  const payback = p.opexBase.total_usd > 0
    ? p.capex.total_usd / p.opexBase.total_usd
    : 0

  // ── Low scenario: cheapest power + cheapest construction ───────────────────
  const lowCapexParams: CapexParams = {
    ...p.capexParamsBase,
    construction_cost_per_kw: p.construction_cost_low,
  }
  const lowOpexParams: OpexParams = {
    ...p.opexParamsBase,
    power_rate_usd_per_kwh: p.power_rate_low,
  }
  const lowNPV = scenarioNPV(lowCapexParams, lowOpexParams, r, years)

  // ── High scenario: most expensive power + most expensive construction ──────
  const highCapexParams: CapexParams = {
    ...p.capexParamsBase,
    construction_cost_per_kw: p.construction_cost_high,
  }
  const highOpexParams: OpexParams = {
    ...p.opexParamsBase,
    power_rate_usd_per_kwh: p.power_rate_high,
  }
  const highNPV = scenarioNPV(highCapexParams, highOpexParams, r, years)

  return {
    levelized_cost_per_kw: round2(levelized),
    npv_usd:               round2(baseNPV),
    payback_years:         round1(payback),
    ranges: {
      low:  { npv_usd: round2(lowNPV),  levelized_per_kw: round2(Math.abs(lowNPV)  / p.capacity_kw) },
      base: { npv_usd: round2(baseNPV), levelized_per_kw: round2(levelized) },
      high: { npv_usd: round2(highNPV), levelized_per_kw: round2(Math.abs(highNPV) / p.capacity_kw) },
    },
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
function round1(n: number): number { return Math.round(n * 10)  / 10  }
