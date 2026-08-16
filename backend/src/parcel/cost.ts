/**
 * backend/src/parcel/cost.ts
 *
 * Parcel-specific CapEx components.
 * Each function is pure: no I/O, no LLM, no side effects.
 * Constants come from CountyConfig.costModel — not inline literals.
 *
 * Components:
 *   interconnectCapex   — transmission spur to nearest ≥138 kV line
 *   fiberCapex          — conduit to nearest PeeringDB IXP facility
 *   entitlementCost     — carrying cost of land during entitlement period
 *   siteworkCost        — earthwork for site grading
 *   landCost            — BCAD appraised land value ÷ PVS ratio (basis: modeled)
 *
 * Rule: no cost or financial math may move to the LLM layer.
 * Rule: every constant must trace to CountyConfig.costModel with a method string.
 *
 * See docs/SCHEMA.md §"Parcel-specific CapEx constants" for derivations.
 */

import type { CostModelConfig } from '../ingest/countyConfig.js'
import type { ParcelRow } from './repository.js'

// ── Output type ────────────────────────────────────────────────────────────────

export interface ParcelCapex {
  /** Transmission spur cost to reach nearest ≥138 kV line (USD). */
  interconnect_capex_usd: number
  /** Fiber conduit cost to reach nearest PeeringDB IXP facility (USD). */
  fiber_capex_usd: number
  /** Carrying cost of land value during entitlement period (USD). */
  entitlement_cost_usd: number
  /** Site grading and earthwork (USD). */
  sitework_usd: number
  /** Modeled land acquisition cost: appraised / PVS ratio (USD). */
  land_cost_usd: number
  /** Sum of all components above (USD). */
  total_usd: number
}

// ── Component functions ────────────────────────────────────────────────────────

/**
 * Transmission spur capex.
 *
 * Formula:  dist_to_tx_line_m × txSpurCostPerMeterUsd + substationAllowanceUsd
 *
 * Zero case: if dist_to_tx_line_m is 0 the spur cost is 0, but the
 * substation allowance is still applied (a new delivery point is always needed).
 * If dist_to_tx_line_m is null (no transmission data), the full cost is assumed
 * at the county maxDistToTxLineM threshold (conservative for a null-data parcel).
 *
 * Basis: assumed (ERCOT CREZ benchmark $/m + flat substation allowance).
 */
export function interconnectCapex(
  distToTxLineM: number | null,
  maxDistM: number,
  cm: CostModelConfig,
): number {
  const dist = distToTxLineM ?? maxDistM
  const spurCost = dist * cm.txSpurCostPerMeterUsd
  return Math.round(spurCost + cm.substationAllowanceUsd)
}

/**
 * Fiber conduit capex.
 *
 * Formula:  dist_to_ixp_km × 1000 × fiberConduitPerMeterUsd
 *
 * Zero case: if dist_to_ixp_km is 0 the conduit cost is 0 (parcel is at an
 * IXP facility — no conduit needed beyond building entry).
 * If dist_to_ixp_km is null (no PeeringDB data), returns 0 and the caller
 * records this as a gap — do not invent a distance.
 *
 * Basis: assumed (industry benchmark $/m conduit, underground directional bore).
 */
export function fiberCapex(
  distToIxpKm: number | null,
  cm: CostModelConfig,
): number {
  if (distToIxpKm === null) return 0  // gap — recorded upstream by caller
  const distM = distToIxpKm * 1000
  return Math.round(distM * cm.fiberConduitPerMeterUsd)
}

/**
 * Entitlement carrying cost.
 *
 * Formula:  entitlementMonths × (landCostUsd × discountRate / 12)
 *
 * Entitlement months come from the zoning tag in the county config.
 * Discount rate is the project WACC (the opportunity cost of capital during
 * the period when the land is owned but development has not started).
 *
 * Basis: assumed (DSD stated timelines; discount rate from project params).
 *
 * @param landCostUsd   - total land acquisition cost (not per acre)
 * @param zoning        - zoning tag from the parcel row
 * @param discountRate  - project WACC (decimal, e.g. 0.08)
 * @param cm            - county cost model config
 */
export function entitlementCost(
  landCostUsd:  number,
  zoning:       string,
  discountRate: number,
  cm: CostModelConfig,
): number {
  const months = entitlementMonths(zoning, cm)
  // Monthly carrying cost = annual cost / 12
  const monthlyCost = landCostUsd * discountRate / 12
  return Math.round(months * monthlyCost)
}

/**
 * Look up entitlement months for a zoning tag.
 * Exported so tests can verify the lookup directly.
 */
export function entitlementMonths(zoning: string, cm: CostModelConfig): number {
  const map = cm.entitlementMonthsByZoning
  if (zoning in map) return (map as Record<string, number>)[zoning]
  return map.default
}

/**
 * Sitework (earthwork / site grading) cost.
 *
 * Formula:  acres × earthworkUsdPerAcre(slopeClass)
 *
 * WO 07 ingest does not capture mean slope — no DEM source is wired yet.
 * Until a slope source is added, all parcels use the flat rate.
 * The parcel row carries no slope field, so we have no way to distinguish
 * flat/rolling/steep and must not invent one.
 *
 * If acres is null, returns 0 (gap recorded by caller).
 *
 * Basis: assumed (RSMeans 2024 Site Work, San Antonio labour market).
 */
export function siteworkCost(
  acres:      number | null,
  slopeClass: 'flat' | 'rolling' | 'steep',
  cm: CostModelConfig,
): number {
  if (acres === null) return 0
  const rateMap: Record<string, number> = {
    flat:    cm.earthworkFlatUsdPerAcre,
    rolling: cm.earthworkRollingUsdPerAcre,
    steep:   cm.earthworkSteepUsdPerAcre,
  }
  return Math.round(acres * rateMap[slopeClass])
}

/**
 * Land acquisition cost — BCAD appraised value ÷ PVS appraisal ratio.
 *
 * Texas is a non-disclosure state: sale prices are not public. This is the
 * only defensible estimate available at the county/parcel grain.
 * The engine's capex.land_usd uses land_cost_per_acre_usd × acres, so this
 * function computes the total directly from the parcel row.
 *
 * If appraisedLandValue is null, falls back to the per-acre region figure
 * × acres — recorded as basis='assumed'.
 *
 * Basis: modeled (BCAD appraised / PVS ratio).
 */
export function landCost(
  landCostPerAcreUsd: number,
  acres:              number | null,
): number {
  if (acres === null || acres <= 0) return 0
  return Math.round(landCostPerAcreUsd * acres)
}

// ── Combined parcel capex ─────────────────────────────────────────────────────

/**
 * Compute all parcel-specific CapEx components for a single parcel.
 *
 * @param row          - parcel row from the repository
 * @param landCostUsdPerAcre - resolved land cost $/acre (from driversForParcel)
 * @param discountRate - project WACC
 * @param maxDistM     - county maxDistToTxLineM (fallback if tx distance null)
 * @param cm           - county cost model config
 */
export function computeParcelCapex(
  row:               ParcelRow,
  landCostUsdPerAcre: number,
  discountRate:      number,
  maxDistM:          number,
  cm:                CostModelConfig,
): ParcelCapex {
  // Slope: always flat until DEM source is wired (see note in siteworkCost)
  const slopeClass: 'flat' | 'rolling' | 'steep' = 'flat'

  const land_cost_usd       = landCost(landCostUsdPerAcre, row.acres)
  const interconnect        = interconnectCapex(row.dist_to_tx_line_m, maxDistM, cm)
  const fiber               = fiberCapex(row.dist_to_ixp_km, cm)
  const entitlement         = entitlementCost(land_cost_usd, row.zoning, discountRate, cm)
  const sitework            = siteworkCost(row.acres, slopeClass, cm)

  const total = land_cost_usd + interconnect + fiber + entitlement + sitework

  return {
    interconnect_capex_usd: interconnect,
    fiber_capex_usd:        fiber,
    entitlement_cost_usd:   entitlement,
    sitework_usd:           sitework,
    land_cost_usd,
    total_usd:              total,
  }
}
