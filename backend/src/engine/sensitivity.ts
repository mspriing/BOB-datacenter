/**
 * Sensitivity / flip-point analysis — pure function, no I/O, no LLM.
 *
 * For each cost driver we ask: at what value does the power rate of the
 * current #1 site need to change so that it swaps rank with #2?
 *
 * Algorithm (binary search):
 *   - Vary power_rate for rank-1 site from current value upward (or downward)
 *   - At each trial value, recompute NPV for both #1 and #2
 *   - When NPV(#2) becomes less-negative than NPV(#1), the flip has occurred
 *   - Bisect to ±0.0001 precision
 *
 * Returns top-5 sensitivity items sorted by smallest pct_change (most fragile).
 */

import { computeCapex, type CapexParams } from './capex.js'
import { computeOpex, type OpexParams } from './opex.js'

export interface SensitivitySiteParams {
  site_id:    string
  capexParams: CapexParams
  opexParams:  OpexParams
  discount_rate: number
  lifetime_years: number
}

export interface SensitivityItem {
  driver:         string
  current_value:  number
  flip_value:     number
  pct_change:     number
  affected_sites: string[]
}

/** NPV cost for one site (negative number; lower = more expensive). */
function siteNPV(
  capexParams: CapexParams,
  opexParams: OpexParams,
  r: number,
  years: number,
): number {
  const cap  = computeCapex(capexParams)
  const opex = computeOpex({ ...opexParams, capex_total_usd: cap.total_usd })
  const annualOpex = opex.total_usd
  const opexNPV = r === 0
    ? annualOpex * years
    : annualOpex * (1 - Math.pow(1 + r, -years)) / r
  return -(cap.total_usd + opexNPV)
}

/**
 * Binary-search the power rate for `target` at which its NPV equals that of `other`.
 * Returns null if no flip found within ±200% of current value.
 */
function findFlipPower(
  target: SensitivitySiteParams,
  other:  SensitivitySiteParams,
  searchUp: boolean,
): number | null {
  const currentRate = target.opexParams.power_rate_usd_per_kwh
  const otherNPV    = siteNPV(other.capexParams, other.opexParams, other.discount_rate, other.lifetime_years)

  const lo = searchUp ? currentRate       : currentRate * 0.01
  const hi = searchUp ? currentRate * 3.0 : currentRate

  // Quick check: does a flip actually happen at the boundary?
  const npvAtBound = siteNPV(
    target.capexParams,
    { ...target.opexParams, power_rate_usd_per_kwh: (searchUp ? hi : lo) },
    target.discount_rate,
    target.lifetime_years,
  )
  // target starts cheaper; if it's still cheaper at the boundary, no flip
  if (searchUp && npvAtBound > otherNPV) return null
  if (!searchUp && npvAtBound < otherNPV) return null

  let left  = searchUp ? currentRate : lo
  let right = searchUp ? hi : currentRate

  for (let i = 0; i < 60; i++) {
    const mid = (left + right) / 2
    const npv = siteNPV(
      target.capexParams,
      { ...target.opexParams, power_rate_usd_per_kwh: mid },
      target.discount_rate,
      target.lifetime_years,
    )
    // npv is negative; otherNPV is negative
    // flip when target becomes more expensive (more negative) than other
    if (npv > otherNPV) {
      // target still cheaper at mid — flip is further along
      left = mid
    } else {
      right = mid
    }
    if (right - left < 1e-6) break
  }

  return (left + right) / 2
}

/**
 * Find the power-rate at which rank-1 and rank-2 swap (construction-cost flip).
 * Returns null if no flip is found.
 */
function findFlipConstruction(
  target: SensitivitySiteParams,
  other:  SensitivitySiteParams,
): number | null {
  const currentCost = target.capexParams.construction_cost_per_kw
  const otherNPV    = siteNPV(other.capexParams, other.opexParams, other.discount_rate, other.lifetime_years)

  const hi = currentCost * 3.0
  const npvAtHi = siteNPV(
    { ...target.capexParams, construction_cost_per_kw: hi },
    target.opexParams,
    target.discount_rate,
    target.lifetime_years,
  )
  if (npvAtHi > otherNPV) return null  // no flip even at 3× construction cost

  let left  = currentCost
  let right = hi

  for (let i = 0; i < 60; i++) {
    const mid = (left + right) / 2
    const npv = siteNPV(
      { ...target.capexParams, construction_cost_per_kw: mid },
      target.opexParams,
      target.discount_rate,
      target.lifetime_years,
    )
    if (npv > otherNPV) {
      left = mid
    } else {
      right = mid
    }
    if (right - left < 1e-4) break
  }

  return (left + right) / 2
}

export function computeSensitivity(
  rank1: SensitivitySiteParams,
  rank2: SensitivitySiteParams,
): SensitivityItem[] {
  const items: SensitivityItem[] = []

  // ── Driver 1: power rate of rank-1 site rising ────────────────────────────
  const powerFlip = findFlipPower(rank1, rank2, true)
  if (powerFlip !== null) {
    const current = rank1.opexParams.power_rate_usd_per_kwh
    items.push({
      driver:         'power_rate_usd_per_kwh',
      current_value:  round4(current),
      flip_value:     round4(powerFlip),
      pct_change:     round1(Math.abs((powerFlip - current) / current) * 100),
      affected_sites: [rank1.site_id, rank2.site_id],
    })
  }

  // ── Driver 2: power rate of rank-2 site falling ───────────────────────────
  const powerFlip2 = findFlipPower(rank2, rank1, false)
  if (powerFlip2 !== null) {
    const current = rank2.opexParams.power_rate_usd_per_kwh
    items.push({
      driver:         'power_rate_usd_per_kwh (rank-2 drop)',
      current_value:  round4(current),
      flip_value:     round4(powerFlip2),
      pct_change:     round1(Math.abs((powerFlip2 - current) / current) * 100),
      affected_sites: [rank1.site_id, rank2.site_id],
    })
  }

  // ── Driver 3: construction cost of rank-1 rising ──────────────────────────
  const constructFlip = findFlipConstruction(rank1, rank2)
  if (constructFlip !== null) {
    const current = rank1.capexParams.construction_cost_per_kw
    items.push({
      driver:         'construction_cost_per_kw',
      current_value:  round2(current),
      flip_value:     round2(constructFlip),
      pct_change:     round1(Math.abs((constructFlip - current) / current) * 100),
      affected_sites: [rank1.site_id, rank2.site_id],
    })
  }

  // Sort by smallest pct_change (most fragile flip first), cap at 5
  items.sort((a, b) => a.pct_change - b.pct_change)
  return items.slice(0, 5)
}

function round1(n: number): number { return Math.round(n * 10) / 10 }
function round2(n: number): number { return Math.round(n * 100) / 100 }
function round4(n: number): number { return Math.round(n * 10000) / 10000 }
