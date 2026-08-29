/**
 * Weighted-score ranker — pure function, no I/O, no LLM.
 *
 * Scoring:
 *   1. Normalise each dimension to [0,1] across the submitted sites.
 *      - total_cost:     higher cost → lower score  (inverted)
 *      - risk:           higher risk → lower score   (inverted)
 *      - sustainability: higher renewable% → higher score
 *      - latency:        lower ms → higher score     (inverted)
 *   2. Per site, sum only the weights for dimensions that are non-null, then
 *      normalise those weights to sum to 1.0 so the score stays on [0,1].
 *      A null dimension is recorded in data_gaps by the caller (index.ts).
 *   3. Sort descending → rank 1 = best.
 *
 * Edge case: if all sites have identical value for a dimension, that
 * dimension contributes 0.5 to every site (neutral).
 */

export interface RankInput {
  site_id:       string
  npv_usd:       number         // negative cost NPV — more negative = more expensive
  risk_score:    number | null  // 0=best, 10=worst; null = excluded from this site's score
  renewable_pct: number | null  // 0–1;              null = excluded from this site's score
  latency_ms:    number | null  //                   null = excluded from this site's score
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
function normalise(values: (number | null)[], higherIsBetter: boolean): (number | null)[] {
  const nonNull = values.filter((v): v is number => v !== null)
  if (nonNull.length === 0) return values.map(() => null)
  const min = Math.min(...nonNull)
  const max = Math.max(...nonNull)
  return values.map((v) => {
    if (v === null) return null
    if (max === min) return 0.5
    const norm = (v - min) / (max - min)   // 0 = worst raw, 1 = best raw
    return higherIsBetter ? norm : 1 - norm
  })
}

export function rankSites(sites: RankInput[], weights?: Partial<Weights>): RankResult[] {
  const w: Weights = { ...DEFAULT_WEIGHTS, ...weights }

  const npvs         = sites.map((s) => s.npv_usd)        // always non-null
  const risks        = sites.map((s) => s.risk_score)
  const renewables   = sites.map((s) => s.renewable_pct)
  const latencies    = sites.map((s) => s.latency_ms)

  // cost: npv_usd is negative; larger (less negative) = cheaper = better
  const costScores     = normalise(npvs,       true)   // higher npv (less negative) → higher score
  const riskScores     = normalise(risks,       false)  // lower risk → higher score
  const sustainScores  = normalise(renewables,  true)   // more renewables → higher score
  const latencyScores  = normalise(latencies,   false)  // lower latency → higher score

  const scored = sites.map((site, i) => {
    // Build a list of (weight, score) pairs for non-null dimensions only.
    const dims: Array<{ weight: number; score: number }> = []

    // cost is always present (npv_usd is never null)
    dims.push({ weight: w.total_cost, score: costScores[i] as number })

    if (riskScores[i]    !== null) dims.push({ weight: w.risk,           score: riskScores[i]   as number })
    if (sustainScores[i] !== null) dims.push({ weight: w.sustainability,  score: sustainScores[i] as number })
    if (latencyScores[i] !== null) dims.push({ weight: w.latency,         score: latencyScores[i] as number })

    const totalWeight = dims.reduce((s, d) => s + d.weight, 0)
    const rawScore    = dims.reduce((s, d) => s + d.weight * d.score, 0)
    // Renormalise to keep the score on [0,1]
    const score = totalWeight > 0 ? rawScore / totalWeight : 0.5

    return {
      site_id:        site.site_id,
      raw_score:      score,
    }
  })

  // Sort on full precision. Rounding before sorting can reverse two close
  // candidates by falling back to their input order.
  scored.sort((a, b) => b.raw_score - a.raw_score)

  return scored.map((s, i) => ({
    site_id: s.site_id,
    weighted_score: Math.round(s.raw_score * 1000) / 1000,
    rank: i + 1,
  }))
}
