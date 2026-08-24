/**
 * backend/src/parcel/score.ts
 *
 * estimateParcel(row, project, county)  → ParcelEstimate
 * scoreAll(rows, project, county)       → ParcelEstimate[] (sorted by rank)
 *
 * Composition rule: parcel CapEx components are added on top of the engine.
 * backend/src/engine/ is NOT modified. We build CapexParams from the combined
 * land + parcel capex total and pass it through the existing engine functions.
 *
 * Caching rule: scoreAll computes costs once and caches by (county, project).
 * Re-ranking under different weights re-sorts the cached array and does NOT
 * recompute costs. Weights change the composite score only — never the cost.
 *
 * Rule: grid_interconnection_years is always null (see drivers.ts).
 * Rule: no LLM calls, no I/O beyond drivers.ts / repository.ts.
 */

import { computeCapex, type CapexParams } from '../engine/capex.js'
import { computeOpex, type OpexParams } from '../engine/opex.js'
import { computeFinance } from '../engine/finance.js'
import { rankSites, type RankInput, type Weights } from '../engine/rank.js'
import { driversForParcel } from './drivers.js'
import { computeParcelCapex } from './cost.js'
import type { ParcelRow } from './repository.js'
import type { CountyConfig } from '../ingest/countyConfig.js'
import type { CapexResult } from '../engine/capex.js'
import type { OpexResult } from '../engine/opex.js'
import type { FinanceResult } from '../engine/finance.js'
import type { ProvenanceItem } from '../schemas/output.js'
import type { ParcelCapex } from './cost.js'

// ── Public types ───────────────────────────────────────────────────────────────

export interface ParcelProject {
  capacity_kw:    number
  design_pue:     number
  design_wue:     number   // default 0.4
  lifetime_years: number
  discount_rate:  number
  weights?: Partial<Weights>
}

export interface ParcelEstimate {
  // Identity
  parcel_id:           string
  address:             string
  county:              string
  acres:               number | null
  zoning:              string
  flood_buildable_pct: number | null

  // Parcel-specific capex
  parcel_capex: ParcelCapex

  // Engine outputs
  capex:       CapexResult
  opex_annual: OpexResult
  finance:     FinanceResult

  // Ranking (filled by scoreAll after all estimates are computed)
  rank:           number
  weighted_score: number
  non_cost_scores: {
    risk_score:                 number | null
    renewable_pct:              number | null
    low_carbon_pct:             number | null
    latency_ms:                 number | null
    grid_interconnection_years: null
  }

  // Provenance + gaps (Task 5 fills these fully; stub here)
  provenance: ProvenanceItem[]
  gaps:       Array<{ driver: string; reason: string }>
  confidence: { sourced: number; modeled: number; assumed: number; missing: number }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

/**
 * scoreAll cache key = county id + stable JSON of project params (weights excluded).
 * Weights are excluded because re-ranking under different weights must reuse the
 * same cost calculations — only the ranking step changes.
 */
interface CostKey { countyId: string; project: Omit<ParcelProject, 'weights'> }

/**
 * Keyed by parcel id inside each project key, not stored as one flat array.
 *
 * It was an array, and scoreAll returned the whole of it on every call after the
 * first — so the `rows` argument was honoured on the cold run and silently
 * discarded thereafter. Every filtered request got all 3,046 parcels back, which
 * made the entire filter rail look wired-up and do nothing. Keying by parcel id
 * keeps the "compute once, re-rank cheaply" intent while letting a caller ask
 * for a subset.
 */
type CachedCosts = Map<string, Map<string, Omit<ParcelEstimate, 'rank' | 'weighted_score'>>>

const _costsCache: CachedCosts = new Map()

function makeCostKey(countyId: string, project: ParcelProject): string {
  const { weights: _w, ...base } = project
  const key: CostKey = { countyId, project: base }
  return JSON.stringify(key)
}

// ── estimateParcel ─────────────────────────────────────────────────────────────

/**
 * Compute a full ParcelEstimate for one parcel.
 * Pure: no caching, no side effects. Called by scoreAll or directly in tests.
 */
export function estimateParcel(
  row:     ParcelRow,
  project: ParcelProject,
  county:  CountyConfig,
): Omit<ParcelEstimate, 'rank' | 'weighted_score'> {
  // ── Resolve drivers ────────────────────────────────────────────────────────
  const { drivers, provenance } = driversForParcel(row, county)

  // ── Parcel-specific capex ──────────────────────────────────────────────────
  const parcelCapex = computeParcelCapex(
    row,
    drivers.land_cost_per_acre_usd,
    project.discount_rate,
    county.maxDistToTxLineM,
    county.costModel,
  )

  // ── Engine capex ──────────────────────────────────────────────────────────
  // The engine sizes land by what a campus of this capacity needs — about 1.2
  // acres per megawatt, so 12 acres for a 10 MW build — and charges that many
  // acres at the parcel's price. That is the right question for comparing
  // regions and the wrong one for buying a parcel: a seller will not split 12
  // acres off an 85-acre listing. This tool prices acquisition, so the whole
  // parcel is charged.
  //
  // Both adjustments ride the same lever Bob used for the site-specific costs —
  // a negative incentive adds cost — which keeps backend/src/engine/ untouched
  // and the region tool's arithmetic exactly as it was.
  //
  //   parcel extra    = interconnect + fibre + entitlement + sitework
  //   land shortfall  = whole-parcel land − the acreage the engine charged for
  //   offset          = incentive − parcel_extra − land_shortfall
  //
  // The engine's own land figure is read back from a first pass rather than
  // recomputed here, so the acreage rule stays owned by the engine.
  const parcelExtra =
    parcelCapex.interconnect_capex_usd +
    parcelCapex.fiber_capex_usd +
    parcelCapex.entitlement_cost_usd +
    parcelCapex.sitework_usd

  const baseParams: CapexParams = {
    capacity_kw:              project.capacity_kw,
    land_cost_per_acre_usd:   drivers.land_cost_per_acre_usd,
    construction_cost_per_kw: drivers.construction_cost_per_kw,
    incentive_usd:            drivers.incentive_usd - parcelExtra,
  }

  const firstPass     = computeCapex(baseParams)
  const landShortfall = parcelCapex.land_cost_usd - firstPass.land_usd

  const capexParams: CapexParams = {
    ...baseParams,
    incentive_usd: drivers.incentive_usd - parcelExtra - landShortfall,
  }

  // Report the land line as what is actually being bought, so the printed
  // components still sum to the total.
  const rawCapex = computeCapex(capexParams)
  const capex    = { ...rawCapex, land_usd: parcelCapex.land_cost_usd }

  // ── Engine opex ────────────────────────────────────────────────────────────
  const opexParams: OpexParams = {
    capacity_kw:             project.capacity_kw,
    design_pue:              project.design_pue,
    power_rate_usd_per_kwh:  drivers.power_rate_usd_per_kwh,
    water_rate_usd_per_kgal: drivers.water_rate_usd_per_kgal,
    design_wue:              project.design_wue,
    staff_cost_index:         drivers.staff_cost_index,
    tax_rate:                 drivers.tax_rate,
    tax_abatement_years:      drivers.tax_abatement_years,
    current_year:             1,
    capex_total_usd:          capex.total_usd,
  }
  const opexYear1 = computeOpex(opexParams)

  // ── Finance ────────────────────────────────────────────────────────────────
  const finance = computeFinance({
    lifetime_years:          project.lifetime_years,
    discount_rate:           project.discount_rate,
    capacity_kw:             project.capacity_kw,
    capex,
    opexBase:                opexYear1,
    opexParamsBase:          opexParams,
    capexParamsBase:         capexParams,
    power_rate_low:          drivers.power_rate_low,
    power_rate_high:         drivers.power_rate_high,
    construction_cost_low:   drivers.construction_cost_low,
    construction_cost_high:  drivers.construction_cost_high,
    incentive_usd:           0,  // parcel extra already baked into capexParams.incentive_usd
  })

  // ── Parcel capex provenance (one entry per component) ─────────────────────
  // These are not in the driver adapter — they are outputs of computeParcelCapex,
  // which uses CountyConfig.costModel constants as inputs.
  const costModelSource = county.costModel.costModelSource
  const costModelDate   = county.costModel.costModelLastReviewed

  provenance.push({
    region_key:    row.parcel_id,
    driver:        'interconnect_capex_usd',
    value:         parcelCapex.interconnect_capex_usd,
    source_url:    costModelSource,
    last_verified: costModelDate,
  })
  provenance.push({
    region_key:    row.parcel_id,
    driver:        'fiber_capex_usd',
    value:         row.dist_to_ixp_km !== null ? parcelCapex.fiber_capex_usd : null,
    source_url:    costModelSource,
    last_verified: costModelDate,
  })
  provenance.push({
    region_key:    row.parcel_id,
    driver:        'entitlement_cost_usd',
    value:         parcelCapex.entitlement_cost_usd,
    source_url:    costModelSource,
    last_verified: costModelDate,
  })
  provenance.push({
    region_key:    row.parcel_id,
    driver:        'sitework_usd',
    value:         parcelCapex.sitework_usd,
    source_url:    costModelSource,
    last_verified: costModelDate,
  })
  provenance.push({
    region_key:    row.parcel_id,
    driver:        'land_cost_usd',
    value:         parcelCapex.land_cost_usd,
    source_url:    `${county.parcelSource.url}/query`,
    last_verified: costModelDate,
  })

  // ── Gaps ───────────────────────────────────────────────────────────────────
  const gaps: ParcelEstimate['gaps'] = []
  if (drivers.grid_interconnection_years === null) {
    gaps.push({
      driver: 'grid_interconnection_years',
      reason: 'ERCOT queue data requires Docling PDF pipeline; value is null until populated',
    })
  }
  if (row.dist_to_ixp_km === null) {
    gaps.push({ driver: 'fiber_capex_usd', reason: 'PeeringDB distance unavailable; fiber capex set to 0' })
  }
  if (row.dist_to_tx_line_m === null) {
    gaps.push({ driver: 'interconnect_capex_usd', reason: 'Transmission line distance unavailable; using county max distance as fallback' })
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  const confidence = { sourced: 0, modeled: 0, assumed: 0, missing: 0 }
  for (const p of provenance) {
    // Look up basis from the original parcel driver if it exists
    const rowDriver = row.drivers[p.driver]
    if (p.value === null) {
      confidence.missing++
    } else if (p.region_key === row.parcel_id && rowDriver) {
      // Parcel-grain figure — use the basis from the ingest row
      if (rowDriver.basis === 'sourced')      confidence.sourced++
      else if (rowDriver.basis === 'modeled') confidence.modeled++
      else                                    confidence.assumed++
    } else {
      // Region fallback — always assumed
      confidence.assumed++
    }
  }

  return {
    parcel_id:           row.parcel_id,
    address:             row.address,
    county:              county.id,
    acres:               row.acres,
    zoning:              row.zoning,
    flood_buildable_pct: row.flood_buildable_pct,
    parcel_capex:        parcelCapex,
    capex,
    opex_annual:         opexYear1,
    finance,
    non_cost_scores: {
      risk_score:                 drivers.risk_score,
      renewable_pct:              drivers.renewable_pct,
      low_carbon_pct:             drivers.low_carbon_pct,
      latency_ms:                 drivers.latency_ms,
      grid_interconnection_years: null,
    },
    provenance,
    gaps,
    confidence,
  }
}

// ── scoreAll ──────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: Weights = {
  total_cost:     0.50,
  risk:           0.20,
  sustainability: 0.15,
  latency:        0.15,
}

/**
 * Score all parcels in a county.
 *
 * First call (cold): computes all estimates, caches costs, ranks.
 * Subsequent calls with the same county+project but different weights:
 *   re-sorts the cached array (re-rank only, no cost recompute).
 *
 * @returns sorted array of ParcelEstimate, rank 1 = best.
 */
export function scoreAll(
  rows:    ParcelRow[],
  project: ParcelProject,
  county:  CountyConfig,
): ParcelEstimate[] {
  const cacheKey = makeCostKey(county.id, project)

  // ── Cost cache, per parcel ───────────────────────────────────────────────
  // Compute only what this call actually asks for and has not been priced yet.
  // Ranking then runs over the requested set, so rank 1 means best among the
  // parcels that matched the filters rather than best in the county.
  let byId = _costsCache.get(cacheKey)
  if (!byId) { byId = new Map(); _costsCache.set(cacheKey, byId) }

  const cached = rows.map(row => {
    const hit = byId!.get(row.parcel_id)
    if (hit) return hit
    const fresh = estimateParcel(row, project, county)
    byId!.set(row.parcel_id, fresh)
    return fresh
  })

  // ── Rank (re-sort over cached costs — weights only affect ranking) ────────
  const w: Weights = { ...DEFAULT_WEIGHTS, ...(project.weights ?? {}) }

  const rankInputs: RankInput[] = cached.map(e => ({
    site_id:       e.parcel_id,
    npv_usd:       e.finance.npv_usd,
    risk_score:    e.non_cost_scores.risk_score,
    renewable_pct: e.non_cost_scores.renewable_pct,
    latency_ms:    e.non_cost_scores.latency_ms,
  }))

  const ranks = rankSites(rankInputs, w)
  const rankMap = new Map(ranks.map(r => [r.site_id, r]))

  return cached
    .map(e => {
      const r = rankMap.get(e.parcel_id)!
      return {
        ...e,
        rank:           r.rank,
        weighted_score: r.weighted_score,
      }
    })
    .sort((a, b) => a.rank - b.rank)
}

/**
 * Re-rank an already-scored set under new weights without recomputing costs.
 * Called when the user changes criteria weights — must complete in <100 ms.
 */
export function rerank(
  estimates: ParcelEstimate[],
  weights:   Partial<Weights>,
): ParcelEstimate[] {
  const w: Weights = { ...DEFAULT_WEIGHTS, ...weights }

  const rankInputs: RankInput[] = estimates.map(e => ({
    site_id:       e.parcel_id,
    npv_usd:       e.finance.npv_usd,
    risk_score:    e.non_cost_scores.risk_score,
    renewable_pct: e.non_cost_scores.renewable_pct,
    latency_ms:    e.non_cost_scores.latency_ms,
  }))

  const ranks = rankSites(rankInputs, w)
  const rankMap = new Map(ranks.map(r => [r.site_id, r]))

  return estimates
    .map(e => ({
      ...e,
      rank:           rankMap.get(e.parcel_id)!.rank,
      weighted_score: rankMap.get(e.parcel_id)!.weighted_score,
    }))
    .sort((a, b) => a.rank - b.rank)
}

/** Clear the internal cache — for testing only. */
export function _clearScoreCache(): void {
  _costsCache.clear()
}
