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
 * Payback exists only when the caller supplies a revenue assumption. This model
 * prices costs; what a site earns is a commercial judgement no public dataset
 * carries, so revenue arrives as an input rather than a lookup:
 *
 *   annual_revenue = capacity_kw × revenue_per_kw_month × 12 × occupancy_pct
 *   net_annual     = annual_revenue − opex year 1
 *   payback_years  = capex.total_usd ÷ net_annual
 *
 * Without revenue, or when net annual cash is not positive, payback stays null
 * rather than becoming a misleading CapEx/OpEx ratio. A site whose running cost
 * exceeds its revenue has no payback, and a negative one is not a figure worth
 * showing anyone.
 *
 * npv_usd is untouched by any of this. It remains a cost NPV, and revenue is
 * reported beside it rather than folded into it.
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
  land_cost_low?:           number
  land_cost_high?:          number
  water_rate_low?:          number
  water_rate_high?:         number
  staff_cost_index_low?:    number
  staff_cost_index_high?:   number
  tax_rate_low?:            number
  tax_rate_high?:           number

  /** The reader's own revenue assumption. Absent means no payback figure. */
  revenue_per_kw_month?:    number
  /** Share of capacity earning revenue, 0 to 1. Defaults to 0.85. */
  occupancy_pct?:           number
}

export interface FinanceResult {
  capex_per_kw:          number
  lifetime_cost_per_kw:  number
  npv_usd:               number
  /** Years the build is priced over, so a reader knows what the NPV covers. */
  lifetime_years:        number
  /** Null unless the caller supplied revenue that clears annual operating cost. */
  payback_years:         number | null
  annual_revenue_usd:    number | null
  net_annual_usd:        number | null
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
  capexBasis: number,
  r: number,
  years: number,
): number {
  let npv = 0
  for (let year = 1; year <= years; year++) {
    const yearly = computeOpex({ ...opexParams, current_year: year, capex_total_usd: capexBasis })
    npv += yearly.total_usd / Math.pow(1 + r, year)
  }
  return npv
}

/** Total-cost NPV: the build cost, plus every year of running cost discounted. */
function totalNPV(
  netCapexTotal: number,
  grossCapexBasis: number,
  opexParams: OpexParams,
  r: number,
  years: number,
): number {
  return -(netCapexTotal + npvOpexStream(opexParams, grossCapexBasis, r, years))
}

function grossCapex(capex: CapexResult): number {
  return capex.land_usd
    + capex.construction_usd
    + capex.electrical_usd
    + capex.cooling_usd
    + capex.it_fitout_usd
}

/** Scenario NPV: recompute capex + opex with patched params, then NPV. */
function scenarioNPV(
  capexParams: CapexParams,
  opexParams: OpexParams,
  r: number,
  years: number,
): number {
  const cap = computeCapex(capexParams)
  return totalNPV(cap.total_usd, grossCapex(cap), opexParams, r, years)
}

export function computeFinance(p: FinanceParams): FinanceResult {
  const r     = p.discount_rate
  const years = p.lifetime_years

  const baseNPV = totalNPV(p.capex.total_usd, grossCapex(p.capex), p.opexParamsBase, r, years)
  const levelized = Math.abs(baseNPV) / p.capacity_kw

  // ── Low scenario: cheapest supported value for every priced cost driver ────
  const lowCapexParams: CapexParams = {
    ...p.capexParamsBase,
    construction_cost_per_kw: p.construction_cost_low,
    land_cost_per_acre_usd: p.land_cost_low ?? p.capexParamsBase.land_cost_per_acre_usd,
  }
  const lowOpexParams: OpexParams = {
    ...p.opexParamsBase,
    power_rate_usd_per_kwh: p.power_rate_low,
    water_rate_usd_per_kgal: p.water_rate_low ?? p.opexParamsBase.water_rate_usd_per_kgal,
    staff_cost_index: p.staff_cost_index_low ?? p.opexParamsBase.staff_cost_index,
    tax_rate: p.tax_rate_low ?? p.opexParamsBase.tax_rate,
  }
  const lowNPV = scenarioNPV(lowCapexParams, lowOpexParams, r, years)

  // ── High scenario: highest supported value for every priced cost driver ────
  const highCapexParams: CapexParams = {
    ...p.capexParamsBase,
    construction_cost_per_kw: p.construction_cost_high,
    land_cost_per_acre_usd: p.land_cost_high ?? p.capexParamsBase.land_cost_per_acre_usd,
  }
  const highOpexParams: OpexParams = {
    ...p.opexParamsBase,
    power_rate_usd_per_kwh: p.power_rate_high,
    water_rate_usd_per_kgal: p.water_rate_high ?? p.opexParamsBase.water_rate_usd_per_kgal,
    staff_cost_index: p.staff_cost_index_high ?? p.opexParamsBase.staff_cost_index,
    tax_rate: p.tax_rate_high ?? p.opexParamsBase.tax_rate,
  }
  const highNPV = scenarioNPV(highCapexParams, highOpexParams, r, years)

  // ── Revenue, if the caller supplied one ───────────────────────────────────
  //
  // Year-1 opex is the basis, matching the year the revenue figure describes.
  // Payback is withheld rather than approximated whenever it would be negative
  // or infinite: a site that does not cover its running cost has no payback,
  // and reporting one would be worse than reporting nothing.
  const rate = p.revenue_per_kw_month ?? 0
  const occupancy = p.occupancy_pct ?? 0.85
  const hasRevenue = rate > 0

  const annualRevenue = hasRevenue ? p.capacity_kw * rate * 12 * occupancy : null
  const netAnnual = annualRevenue === null ? null : annualRevenue - p.opexBase.total_usd
  const payback = netAnnual !== null && netAnnual > 0
    ? round2(p.capex.total_usd / netAnnual)
    : null

  return {
    capex_per_kw:          round2(p.capex.total_usd / p.capacity_kw),
    lifetime_cost_per_kw:  round2(levelized),
    npv_usd:               round2(baseNPV),
    lifetime_years:        years,
    payback_years:         payback,
    annual_revenue_usd:    annualRevenue === null ? null : round2(annualRevenue),
    net_annual_usd:        netAnnual === null ? null : round2(netAnnual),
    ranges: {
      low:  { npv_usd: round2(lowNPV),  lifetime_per_kw: round2(Math.abs(lowNPV)  / p.capacity_kw) },
      base: { npv_usd: round2(baseNPV), lifetime_per_kw: round2(levelized) },
      high: { npv_usd: round2(highNPV), lifetime_per_kw: round2(Math.abs(highNPV) / p.capacity_kw) },
    },
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
