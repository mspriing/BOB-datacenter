/**
 * Financial calculations — pure function, no I/O, no LLM.
 *
 * NPV  = −CapEx − Σ(OpEx_y / (1+r)^y)   for y = 1..lifetime_years
 *         (negative because it's a cost NPV — lower is better)
 *
 * Lifetime cost per kW = |NPV| / capacity_kw
 *   (formerly "levelized cost per kW" — renamed because "levelized" conventionally
 *    means $/MWh, not $/kW; this figure is the whole-life cost divided by capacity)
 *
 * CapEx per kW = capex.total_usd / capacity_kw
 *   (construction cost intensity; comparable to published data-center build costs)
 *
 * There is no payback figure here, because a cost model has nothing to pay
 * back. What used to be called payback was capex divided by one year of running
 * cost, which gets smaller as a site gets more expensive to run. It is still
 * computed, under the same field name so nothing downstream breaks, and it is
 * described for what it is wherever a reader can see it.
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
  capex_per_kw:          number
  lifetime_cost_per_kw:  number
  npv_usd:               number
  /** Years the build is priced over, so a reader knows what the NPV covers. */
  lifetime_years:        number
  /**
   * Years of running cost that add up to the build cost. Not a payback, and
   * lower is not better. Kept under the old name so nothing downstream breaks;
   * no text a reader sees calls it payback.
   */
  payback_years:         number
  ranges: {
    low:  { npv_usd: number; lifetime_per_kw: number }
    base: { npv_usd: number; lifetime_per_kw: number }
    high: { npv_usd: number; lifetime_per_kw: number }
  }
}

/**
 * Discount the running cost year by year, recomputing each year's opex.
 *
 * It used to take year 1's opex and treat it as an annuity for the whole life.
 * Property tax is zero during an abatement, so a site with a ten-year abatement
 * on a fifteen-year build was handed fifteen years of zero property tax. Texas
 * ERCOT, one of the three published examples, has a ten-year abatement, so this
 * quietly removed about $3.3M of discounted tax from its total and flattered it
 * against every site without an abatement.
 *
 * Years run 1 to lifetime_years, each discounted at the end of its own year.
 * That is also what the browser-side copy of this engine has always done, which
 * is where the two came apart.
 */
export function npvOpexStream(
  opexParams: OpexParams,
  capexTotal: number,
  r: number,
  years: number,
): number {
  let npv = 0
  for (let year = 1; year <= years; year++) {
    const yearly = computeOpex({ ...opexParams, current_year: year, capex_total_usd: capexTotal })
    npv += yearly.total_usd / Math.pow(1 + r, year)
  }
  return npv
}

/** Total-cost NPV: the build cost, plus every year of running cost discounted. */
function totalNPV(
  capexTotal: number,
  opexParams: OpexParams,
  r: number,
  years: number,
): number {
  return -(capexTotal + npvOpexStream(opexParams, capexTotal, r, years))
}

/** Scenario NPV: recompute capex + opex with patched params, then NPV. */
function scenarioNPV(
  capexParams: CapexParams,
  opexParams: OpexParams,
  r: number,
  years: number,
): number {
  const cap = computeCapex(capexParams)
  return totalNPV(cap.total_usd, opexParams, r, years)
}

export function computeFinance(p: FinanceParams): FinanceResult {
  const r     = p.discount_rate
  const years = p.lifetime_years

  const baseNPV = totalNPV(p.capex.total_usd, p.opexParamsBase, r, years)
  const levelized = Math.abs(baseNPV) / p.capacity_kw

  // How many years of running cost add up to the build cost.
  //
  // This is not a payback and nothing here pays back: the model prices two ways
  // of spending money, not an investment that returns any. Lower is not better
  // either. A site with expensive power reaches its build cost in fewer years
  // precisely because it costs more to run. Northern Virginia scores 5.3 here
  // and comes last overall. Nothing a reader sees calls it payback any more.
  const opexYearsToEqualCapex = p.opexBase.total_usd > 0
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
    capex_per_kw:          round2(p.capex.total_usd / p.capacity_kw),
    lifetime_cost_per_kw:  round2(levelized),
    npv_usd:               round2(baseNPV),
    lifetime_years:        years,
    payback_years:         round1(opexYearsToEqualCapex),
    ranges: {
      low:  { npv_usd: round2(lowNPV),  lifetime_per_kw: round2(Math.abs(lowNPV)  / p.capacity_kw) },
      base: { npv_usd: round2(baseNPV), lifetime_per_kw: round2(levelized) },
      high: { npv_usd: round2(highNPV), lifetime_per_kw: round2(Math.abs(highNPV) / p.capacity_kw) },
    },
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
function round1(n: number): number { return Math.round(n * 10)  / 10  }
