/**
 * Sensitivity / flip-point analysis — pure function, no I/O, no LLM.
 *
 * For each cost driver we ask: at what value does the driver of the
 * current #1 site need to change so that it loses rank-1 in the FULL
 * N-site weighted ranking?
 *
 * Algorithm (binary search):
 *   - Vary the driver for the target (rank-1) site from its current value
 *     outward.
 *   - At each trial value, recompute NPV for the target site and re-run
 *     rankSites() with ALL submitted sites.
 *   - When the target site's rank drops from 1, the flip has occurred.
 *   - Bisect to ±1e-6 (or ±0.01 for $/kW) precision.
 *
 * Why full-N-site ranking, not pairwise?
 *   A site can be rank-1 in a 3-site comparison but lose in a 2-site
 *   head-to-head with rank-2. For example, Nordic Hydro's non-cost
 *   advantages (risk, renewables) look weaker in pairwise against ERCOT
 *   because the 50% cost weight dominates when NOVA is absent.  The old
 *   code also searched only on raw NPV (ignoring risk/latency/renewables
 *   entirely), causing the binary search to converge at the current value
 *   (0% change) whenever rank-1's cost NPV was already worse.
 *
 * Returns top-5 sensitivity items sorted by smallest pct_change (most fragile).
 * Drivers that never cause a flip within the search range are emitted with
 * stable=true and pct_change equal to the search-boundary %.
 */

import { computeCapex, type CapexParams } from './capex.js'
import { computeOpex, type OpexParams } from './opex.js'
import { rankSites, type RankInput, type Weights } from './rank.js'

export interface SensitivitySiteParams {
  site_id:        string
  capexParams:    CapexParams
  opexParams:     OpexParams
  discount_rate:  number
  lifetime_years: number
  /** Non-cost scoring inputs (unchanged across driver sweeps). */
  risk_score:     number
  renewable_pct:  number
  latency_ms:     number
}

export interface SensitivityItem {
  driver:         string
  current_value:  number
  flip_value:     number
  pct_change:     number
  affected_sites: string[]
  /** True when no weighted-score flip occurs within the search range. */
  stable?:        boolean
}

// ── NPV helper ────────────────────────────────────────────────────────────────

/** Cost-only NPV for a site (negative number; more negative = more expensive). */
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

// ── Full-N-site ranking helper ────────────────────────────────────────────────

/**
 * Build RankInput[] for all sites, with the target site's NPV patched.
 * Returns true if the target site still holds rank-1 in the full ranking.
 */
function targetHoldsRank1(
  target:    SensitivitySiteParams,
  allSites:  SensitivitySiteParams[],
  targetNPV: number,
  baseNPVs:  Map<string, number>,
  weights:   Partial<Weights>,
): boolean {
  const rankInputs: RankInput[] = allSites.map((s) => ({
    site_id:       s.site_id,
    npv_usd:       s.site_id === target.site_id ? targetNPV : baseNPVs.get(s.site_id)!,
    risk_score:    s.risk_score,
    renewable_pct: s.renewable_pct,
    latency_ms:    s.latency_ms,
  }))
  const ranked = rankSites(rankInputs, weights)
  return ranked[0].site_id === target.site_id
}

// ── Power-rate flip search ────────────────────────────────────────────────────

/**
 * Binary-search the power rate for `target` at which it loses rank-1
 * in the full N-site weighted ranking.
 *
 * searchUp=true → raise target's power rate (site becomes more expensive)
 *
 * Returns { flip_value, stable } where stable=true means no flip found.
 */
function findFlipPower(
  target:   SensitivitySiteParams,
  allSites: SensitivitySiteParams[],
  baseNPVs: Map<string, number>,
  weights:  Partial<Weights>,
): { flip_value: number; stable: boolean } {
  const currentRate = target.opexParams.power_rate_usd_per_kwh
  const hi = currentRate * 3.0

  // Verify target holds rank-1 at current values (sanity — should always be true)
  const currentNPV = baseNPVs.get(target.site_id)!
  if (!targetHoldsRank1(target, allSites, currentNPV, baseNPVs, weights)) {
    // Shouldn't happen if caller passes the actual rank-1 site
    return { flip_value: currentRate, stable: true }
  }

  // Check whether a flip occurs at the search boundary (3× power rate)
  const npvAtHi = siteNPV(
    target.capexParams,
    { ...target.opexParams, power_rate_usd_per_kwh: hi },
    target.discount_rate,
    target.lifetime_years,
  )
  if (targetHoldsRank1(target, allSites, npvAtHi, baseNPVs, weights)) {
    // No flip within 3× current rate — report as stable
    return { flip_value: hi, stable: true }
  }

  // Binary search between currentRate and hi
  let left  = currentRate
  let right = hi

  for (let i = 0; i < 64; i++) {
    const mid = (left + right) / 2
    const npvMid = siteNPV(
      target.capexParams,
      { ...target.opexParams, power_rate_usd_per_kwh: mid },
      target.discount_rate,
      target.lifetime_years,
    )
    if (targetHoldsRank1(target, allSites, npvMid, baseNPVs, weights)) {
      left = mid   // still rank-1 — flip is at higher rate
    } else {
      right = mid  // flip has occurred — tighten from above
    }
    if (right - left < 1e-7) break
  }

  return { flip_value: (left + right) / 2, stable: false }
}

// ── Construction-cost flip search ─────────────────────────────────────────────

/**
 * Binary-search the construction cost for `target` at which it loses rank-1
 * in the full N-site weighted ranking. Searches upward only.
 */
function findFlipConstruction(
  target:   SensitivitySiteParams,
  allSites: SensitivitySiteParams[],
  baseNPVs: Map<string, number>,
  weights:  Partial<Weights>,
): { flip_value: number; stable: boolean } {
  const currentCost = target.capexParams.construction_cost_per_kw
  const hi = currentCost * 3.0

  const currentNPV = baseNPVs.get(target.site_id)!
  if (!targetHoldsRank1(target, allSites, currentNPV, baseNPVs, weights)) {
    return { flip_value: currentCost, stable: true }
  }

  const npvAtHi = siteNPV(
    { ...target.capexParams, construction_cost_per_kw: hi },
    target.opexParams,
    target.discount_rate,
    target.lifetime_years,
  )
  if (targetHoldsRank1(target, allSites, npvAtHi, baseNPVs, weights)) {
    return { flip_value: hi, stable: true }
  }

  let left  = currentCost
  let right = hi

  for (let i = 0; i < 64; i++) {
    const mid = (left + right) / 2
    const npvMid = siteNPV(
      { ...target.capexParams, construction_cost_per_kw: mid },
      target.opexParams,
      target.discount_rate,
      target.lifetime_years,
    )
    if (targetHoldsRank1(target, allSites, npvMid, baseNPVs, weights)) {
      left = mid   // still rank-1 — push boundary higher
    } else {
      right = mid  // flip has occurred — tighten from above
    }
    if (right - left < 0.01) break
  }

  return { flip_value: (left + right) / 2, stable: false }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute sensitivity items for the rank-1 site across all submitted sites.
 *
 * @param rank1    The rank-1 site parameters.
 * @param rank2    The rank-2 site (used for affected_sites label).
 * @param allSites ALL submitted sites (including rank1 and rank2); used for
 *                 full-N-site ranking at each trial value.
 * @param weights  Ranking weights (same weights used by the ranker).
 */
export function computeSensitivity(
  rank1:    SensitivitySiteParams,
  rank2:    SensitivitySiteParams,
  allSites: SensitivitySiteParams[] = [rank1, rank2],
  weights:  Partial<Weights> = {},
): SensitivityItem[] {
  // Pre-compute base NPVs for all sites (unchanged during sweep)
  const baseNPVs = new Map<string, number>()
  for (const s of allSites) {
    baseNPVs.set(s.site_id, siteNPV(s.capexParams, s.opexParams, s.discount_rate, s.lifetime_years))
  }

  const items: SensitivityItem[] = []

  // ── Driver 1: power rate of rank-1 site rising ────────────────────────────
  {
    const { flip_value, stable } = findFlipPower(rank1, allSites, baseNPVs, weights)
    const current = rank1.opexParams.power_rate_usd_per_kwh
    const pct     = round1(Math.abs((flip_value - current) / current) * 100)
    items.push({
      driver:         'power_rate_usd_per_kwh',
      current_value:  round4(current),
      flip_value:     round4(flip_value),
      pct_change:     pct,
      affected_sites: [rank1.site_id, rank2.site_id],
      ...(stable ? { stable: true } : {}),
    })
  }

  // ── Driver 2: construction cost of rank-1 rising ──────────────────────────
  {
    const { flip_value, stable } = findFlipConstruction(rank1, allSites, baseNPVs, weights)
    const current = rank1.capexParams.construction_cost_per_kw
    const pct     = round1(Math.abs((flip_value - current) / current) * 100)
    items.push({
      driver:         'construction_cost_per_kw',
      current_value:  round2(current),
      flip_value:     round2(flip_value),
      pct_change:     pct,
      affected_sites: [rank1.site_id, rank2.site_id],
      ...(stable ? { stable: true } : {}),
    })
  }

  // Sort: non-stable (real flips) first by smallest pct_change, then stable items
  items.sort((a, b) => {
    if (a.stable && !b.stable) return 1
    if (!a.stable && b.stable) return -1
    return a.pct_change - b.pct_change
  })

  return items.slice(0, 5)
}

function round1(n: number): number { return Math.round(n * 10) / 10 }
function round2(n: number): number { return Math.round(n * 100) / 100 }
function round4(n: number): number { return Math.round(n * 10000) / 10000 }
