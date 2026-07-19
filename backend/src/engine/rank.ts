/**
 * Weighted-score ranker — pure function, no I/O, no LLM.
 *
 * Scoring:
 *   1. Normalise each dimension to [0,1] across the submitted sites.
 *      - total_cost:     higher cost → lower score  (inverted)
 *      - risk:           higher risk → lower score   (inverted)
 *      - sustainability: higher renewable% → higher score
 *      - latency:        lower ms → higher score     (inverted)
 *   2. Apply weights, sum to produce weighted_score.
 *   3. Sort descending → rank 1 = best.
 *
 * Edge case: if all sites have identical value for a dimension, that
 * dimension contributes 0.5 to every site (neutral).
 */

export interface RankInput {
  site_id:       string
  npv_usd:       number  // negative cost NPV — more negative = more expensive
  risk_score:    number  // 0=best, 10=worst
  renewable_pct: number  // 0–1
  latency_ms:    number
}

export interface Weights {
  total_cost:     number
  risk:           number
  sustainability: number
  latency:        number
}

export interface RankResult {
  site_id:        string
  rank:           number
  weighted_score: number
}

const DEFAULT_WEIGHTS: Weights = {
  total_cost:     0.50,
  risk:           0.20,
  sustainability: 0.15,
  latency:        0.15,
}

/** Linear normalise array to [0,1]. Returns 0.5 for all-equal arrays. */
function normalise(values: number[], higherIsBetter: boolean): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return values.map(() => 0.5)
  return values.map((v) => {
    const norm = (v - min) / (max - min)   // 0 = worst raw, 1 = best raw
    return higherIsBetter ? norm : 1 - norm
  })
}

export function rankSites(sites: RankInput[], weights?: Partial<Weights>): RankResult[] {
  const w: Weights = { ...DEFAULT_WEIGHTS, ...weights }

  const npvs         = sites.map((s) => s.npv_usd)       // more negative = worse
  const risks        = sites.map((s) => s.risk_score)
  const renewables   = sites.map((s) => s.renewable_pct)
  const latencies    = sites.map((s) => s.latency_ms)

  // cost: npv_usd is negative; larger (less negative) = cheaper = better
  const costScores        = normalise(npvs,       true)   // higher npv (less negative) → higher score
  const riskScores        = normalise(risks,       false)  // lower risk → higher score
  const sustainScores     = normalise(renewables,  true)   // more renewables → higher score
  const latencyScores     = normalise(latencies,   false)  // lower latency → higher score

  const scored = sites.map((site, i) => {
    const score =
      w.total_cost     * costScores[i]    +
      w.risk           * riskScores[i]    +
      w.sustainability * sustainScores[i] +
      w.latency        * latencyScores[i]

    return {
      site_id:        site.site_id,
      weighted_score: Math.round(score * 1000) / 1000,
    }
  })

  // Sort descending by score
  scored.sort((a, b) => b.weighted_score - a.weighted_score)

  return scored.map((s, i) => ({ ...s, rank: i + 1 }))
}
