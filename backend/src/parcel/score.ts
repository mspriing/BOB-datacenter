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

/** Everything a parcel carries whether or not it could be priced. */
export interface ParcelEstimateBase {
  // Identity
  parcel_id:           string
  address:             string
  county:              string
  acres:               number | null
  zoning:              string
  flood_buildable_pct: number | null

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

  // Provenance + gaps
  provenance: ProvenanceItem[]
  gaps:       Array<{ driver: string; reason: string }>
  confidence: { sourced: number; modeled: number; assumed: number; missing: number }
}

/** A parcel that carried every cost driver and therefore has a total. */
export interface ParcelEstimate extends ParcelEstimateBase {
  parcel_capex: ParcelCapex
  capex:        CapexResult
  opex_annual:  OpexResult
  finance:      FinanceResult
  unevaluable:  null
}

/**
 * A parcel that is missing at least one cost driver. It carries no total at
 * all, because the alternative is a total built out of zeros standing in for
 * numbers nobody has collected, which makes the least known parcel look like
 * the cheapest one.
 */
export interface UnpricedParcel extends ParcelEstimateBase {
  parcel_capex: null
  capex:        null
  opex_annual:  null
  finance:      null
  unevaluable:  { missing_drivers: string[] }
}

export type ParcelResult = ParcelEstimate | UnpricedParcel

/**
 * The same two shapes before ranking. Written as a union of two Omits rather
 * than one Omit of the union, because Omit over a union flattens it and the
 * priced / unpriced distinction is lost to every caller downstream.
 */
export type ParcelDraft =
  | Omit<ParcelEstimate, 'rank' | 'weighted_score'>
  | Omit<UnpricedParcel, 'rank' | 'weighted_score'>

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
 * discarded thereafter. Every filtered request got all 3,040 parcels back, which
 * made the entire filter rail look wired-up and do nothing. Keying by parcel id
 * keeps the "compute once, re-rank cheaply" intent while letting a caller ask
 * for a subset.
 */
type CachedCosts = Map<string, Map<string, ParcelDraft>>

const _costsCache: CachedCosts = new Map()

/**
 * The cache is keyed on five numbers a caller supplies, so a client that nudges
 * the discount rate mints a fresh Map on every request and nothing ever leaves.
 * Two ceilings, both crude on purpose:
 *   MAX_PROJECT_KEYS   how many distinct project shapes are held at once
 *   MAX_PARCELS_PER_KEY how many priced parcels one shape may hold
 * Eviction is least-recently-used, tracked by re-inserting a key on every read,
 * which is enough for a request-scoped cache and needs no extra bookkeeping.
 */
const MAX_PROJECT_KEYS    = 8
const MAX_PARCELS_PER_KEY = 25_000

function touch(key: string): Map<string, ParcelDraft> {
  const existing = _costsCache.get(key)
  if (existing) {
    // Re-insert so this key becomes the newest in iteration order.
    _costsCache.delete(key)
    _costsCache.set(key, existing)
    return existing
  }
  const fresh = new Map<string, ParcelDraft>()
  _costsCache.set(key, fresh)
  while (_costsCache.size > MAX_PROJECT_KEYS) {
    const oldest = _costsCache.keys().next().value
    if (oldest === undefined) break
    _costsCache.delete(oldest)
  }
  return fresh
}

function remember(
  byId:  Map<string, ParcelDraft>,
  id:    string,
  value: ParcelDraft,
): void {
  if (byId.size >= MAX_PARCELS_PER_KEY) {
    const oldest = byId.keys().next().value
    if (oldest !== undefined) byId.delete(oldest)
  }
  byId.set(id, value)
}

function makeCostKey(countyId: string, project: ParcelProject): string {
  const { weights: _w, ...base } = project
  const key: CostKey = { countyId, project: base }
  return JSON.stringify(key)
}

// ── Confidence ────────────────────────────────────────────────────────────────

/**
 * Tally how many of a parcel's figures are sourced, modeled, assumed or absent.
 *
 * Every provenance item now states its own basis, so this reads that field
 * first. It used to fall through to 'assumed' for anything that was not a
 * parcel-grain driver, which quietly filed the five modeled capex figures, the
 * land figure among them, as guesses. Modeled and assumed are not the same
 * claim: one is arithmetic with its working shown, the other is a number
 * somebody picked.
 */
function countConfidence(
  provenance: ProvenanceItem[],
  row:        ParcelRow,
): { sourced: number; modeled: number; assumed: number; missing: number } {
  const confidence = { sourced: 0, modeled: 0, assumed: 0, missing: 0 }
  for (const p of provenance) {
    if (p.value === null) { confidence.missing++; continue }
    const basis = p.basis ?? row.drivers[p.driver]?.basis ?? 'assumed'
    if (basis === 'sourced')      confidence.sourced++
    else if (basis === 'modeled') confidence.modeled++
    else                          confidence.assumed++
  }
  return confidence
}


/**
 * Attach a rank without flattening the priced / unpriced distinction. Spreading
 * the union directly widens every field back to "or null", which is exactly the
 * information this change exists to keep.
 */
function withRank(
  e:              ParcelDraft,
  rank:           number,
  weighted_score: number,
): ParcelResult {
  return e.finance === null
    ? { ...(e as Omit<UnpricedParcel, 'rank' | 'weighted_score'>), rank, weighted_score }
    : { ...(e as Omit<ParcelEstimate, 'rank' | 'weighted_score'>), rank, weighted_score }
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
): ParcelDraft {
  // ── Resolve drivers ────────────────────────────────────────────────────────
  const { drivers, provenance, missing_cost_drivers } = driversForParcel(row, county)

  // A parcel missing any cost driver is named and left unpriced. Coalescing the
  // gap to 0 further down would have made it the cheapest parcel in the county
  // and handed it rank 1.
  if (missing_cost_drivers.length > 0) {
    return {
      parcel_id:           row.parcel_id,
      address:             row.address,
      county:              county.id,
      acres:               row.acres,
      zoning:              row.zoning,
      flood_buildable_pct: row.flood_buildable_pct,
      parcel_capex:        null,
      capex:               null,
      opex_annual:         null,
      finance:             null,
      unevaluable:         { missing_drivers: missing_cost_drivers },
      non_cost_scores: {
        risk_score:                 drivers.risk_score,
        renewable_pct:              drivers.renewable_pct,
        low_carbon_pct:             drivers.low_carbon_pct,
        latency_ms:                 drivers.latency_ms,
        grid_interconnection_years: null,
      },
      provenance,
      gaps: missing_cost_drivers.map((driver) => ({
        driver,
        reason: 'no value at parcel or county level, so this parcel cannot be priced',
      })),
      confidence: countConfidence(provenance, row),
    }
  }

  // Past this point every cost driver holds a number.
  const landCostPerAcre  = drivers.land_cost_per_acre_usd as number
  const constructionPerKw = drivers.construction_cost_per_kw as number

  // ── Parcel-specific capex ──────────────────────────────────────────────────
  const parcelCapex = computeParcelCapex(
    row,
    landCostPerAcre,
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
    land_cost_per_acre_usd:   landCostPerAcre,
    construction_cost_per_kw: constructionPerKw,
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
    power_rate_usd_per_kwh:  drivers.power_rate_usd_per_kwh as number,
    // Water is not a cost driver the ranking depends on, and a county with no
    // published tariff still gets compared. 0 here means "no water charge in
    // this figure", and the gap is recorded below rather than hidden.
    water_rate_usd_per_kgal: drivers.water_rate_usd_per_kgal ?? 0,
    design_wue:              project.design_wue,
    staff_cost_index:         drivers.staff_cost_index as number,
    tax_rate:                 drivers.tax_rate ?? 0,
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
  // Every one of these five is arithmetic this engine performed, so each carries
  // basis 'modeled' and a method string saying how. They shipped with no basis
  // at all, which left the five costs that separate one parcel from another
  // looking the same as a figure read off a public record.
  const costModelSource = county.costModel.costModelSource
  const costModelDate   = county.costModel.costModelLastReviewed

  provenance.push({
    region_key:    row.parcel_id,
    driver:        'interconnect_capex_usd',
    value:         parcelCapex.interconnect_capex_usd,
    basis:         'modeled',
    source_url:    costModelSource,
    last_verified: costModelDate,
    method:        'Distance from this parcel to the nearest transmission line of 138 kV or above, ' +
                   `multiplied by the county cost model's spur rate of $${county.costModel.txSpurCostPerMeterUsd}/m, ` +
                   `plus a flat delivery point allowance of $${county.costModel.substationAllowanceUsd.toLocaleString('en-US')}. ` +
                   'Both rates are cost model assumptions, not quotes for this site.',
  })
  provenance.push({
    region_key:    row.parcel_id,
    driver:        'fiber_capex_usd',
    value:         row.dist_to_ixp_km !== null ? parcelCapex.fiber_capex_usd : null,
    basis:         row.dist_to_ixp_km !== null ? 'modeled' : null,
    source_url:    costModelSource,
    last_verified: costModelDate,
    method:        'Distance from this parcel to the nearest internet exchange facility listed in PeeringDB, ' +
                   `multiplied by the county cost model's conduit rate of $${county.costModel.fiberConduitPerMeterUsd}/m. ` +
                   'Null when PeeringDB carries no facility distance for this parcel.',
  })
  provenance.push({
    region_key:    row.parcel_id,
    driver:        'entitlement_cost_usd',
    value:         parcelCapex.entitlement_cost_usd,
    basis:         'modeled',
    source_url:    costModelSource,
    last_verified: costModelDate,
    method:        'Land cost carried at the discount rate set on the Setup screen for the number of months ' +
                   'the county cost model expects entitlement to take at this parcel\'s zoning status. It is the ' +
                   'cost of holding the land while permits are worked through, not a fee anyone charges.',
  })
  provenance.push({
    region_key:    row.parcel_id,
    driver:        'sitework_usd',
    value:         parcelCapex.sitework_usd,
    basis:         'modeled',
    source_url:    costModelSource,
    last_verified: costModelDate,
    method:        'Parcel acreage multiplied by the county cost model\'s earthwork and grading rate. ' +
                   'A flat rate per acre, so it does not read the slope of this particular site.',
  })
  provenance.push({
    region_key:    row.parcel_id,
    driver:        'land_cost_usd',
    value:         parcelCapex.land_cost_usd,
    basis:         'modeled',
    // The appraisal district publishes an appraised value. It does not publish
    // this number, which is that value divided by a state ratio and multiplied
    // by acreage. Citing the district's URL beside it read as though the
    // district had produced it.
    source_url:    `${county.parcelSource.url}/query`,
    last_verified: costModelDate,
    method:        `Derived here, not published. The appraisal district's appraised land value per acre is ` +
                   `divided by the Texas Comptroller's ${county.pvsYear} appraisal ratio for this property class ` +
                   'to approximate market value, then multiplied by the parcel acreage. The appraisal district ' +
                   'publishes the appraised value only; the division, the ratio and the multiplication are this engine\'s.',
  })

  // ── Gaps ───────────────────────────────────────────────────────────────────
  const gaps: ParcelEstimateBase['gaps'] = []
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

  const confidence = countConfidence(provenance, row)

  return {
    unevaluable: null,
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
): ParcelResult[] {
  const cacheKey = makeCostKey(county.id, project)

  // ── Cost cache, per parcel ───────────────────────────────────────────────
  // Compute only what this call actually asks for and has not been priced yet.
  // Ranking then runs over the requested set, so rank 1 means best among the
  // parcels that matched the filters rather than best in the county.
  const byId = touch(cacheKey)

  const cached = rows.map(row => {
    const hit = byId.get(row.parcel_id)
    if (hit) return hit
    const fresh = estimateParcel(row, project, county)
    remember(byId, row.parcel_id, fresh)
    return fresh
  })

  // ── Rank (re-sort over cached costs — weights only affect ranking) ────────
  const w: Weights = { ...DEFAULT_WEIGHTS, ...(project.weights ?? {}) }

  // Only parcels with a full set of cost drivers enter the ranking. The rest
  // come back at the end of the list, named, with no rank and no total.
  const priced = cached.filter(e => e.finance !== null)

  const rankInputs: RankInput[] = priced.map(e => ({
    site_id:       e.parcel_id,
    npv_usd:       e.finance!.npv_usd,
    risk_score:    e.non_cost_scores.risk_score,
    renewable_pct: e.non_cost_scores.renewable_pct,
    latency_ms:    e.non_cost_scores.latency_ms,
  }))

  const ranks = rankSites(rankInputs, w)
  const rankMap = new Map(ranks.map(r => [r.site_id, r]))

  return cached
    .map(e => withRank(e, rankMap.get(e.parcel_id)?.rank ?? 0, rankMap.get(e.parcel_id)?.weighted_score ?? 0))
    .sort((a, b) => {
      if (a.rank === 0 && b.rank === 0) return 0
      if (a.rank === 0) return 1
      if (b.rank === 0) return -1
      return a.rank - b.rank
    })
}

/**
 * Re-rank an already-scored set under new weights without recomputing costs.
 * Called when the user changes criteria weights — must complete in <100 ms.
 */
export function rerank(
  estimates: ParcelResult[],
  weights:   Partial<Weights>,
): ParcelResult[] {
  const w: Weights = { ...DEFAULT_WEIGHTS, ...weights }

  const rankInputs: RankInput[] = estimates
    .filter(e => e.finance !== null)
    .map(e => ({
      site_id:       e.parcel_id,
      npv_usd:       e.finance!.npv_usd,
      risk_score:    e.non_cost_scores.risk_score,
      renewable_pct: e.non_cost_scores.renewable_pct,
      latency_ms:    e.non_cost_scores.latency_ms,
    }))

  const ranks = rankSites(rankInputs, w)
  const rankMap = new Map(ranks.map(r => [r.site_id, r]))

  return estimates
    .map(e => withRank(e, rankMap.get(e.parcel_id)?.rank ?? 0, rankMap.get(e.parcel_id)?.weighted_score ?? 0))
    .sort((a, b) => {
      if (a.rank === 0 && b.rank === 0) return 0
      if (a.rank === 0) return 1
      if (b.rank === 0) return -1
      return a.rank - b.rank
    })
}

/** Clear the internal cache — for testing only. */
export function _clearScoreCache(): void {
  _costsCache.clear()
}

/** How many project shapes the cache is holding — for testing only. */
export function _cacheSize(): number {
  return _costsCache.size
}
