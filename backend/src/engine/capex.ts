/**
 * CapEx calculation — pure function, no I/O, no LLM.
 *
 * Formula:
 *
 *   land_usd         = acres_needed × land_cost_per_acre
 *   construction_usd = capacity_kw × construction_cost_per_kw
 *   total_usd        = land_usd + construction_usd − incentive_usd
 *
 * Land sizing: about 1.2 acres per MW of equipment load, minimum 5 acres.
 * Both figures, and everything else that is not read from data/regions.json,
 * live in assumptions.ts with their basis and working.
 *
 * ── Why electrical, cooling and IT fit-out are no longer added on top ────────
 *
 * They used to be: $550, $400 and $200 per kW, three bare constants with no
 * source, added to the construction figure. That double counted.
 * construction_cost_per_kw comes from a published construction cost index, and
 * that index's own methodology says its cost per watt already includes
 * "mechanical and electrical fit-out" and "mechanical and electrical
 * equipment", alongside shell and core and architectural fit-out. Adding
 * switchgear and cooling again charged for them twice.
 *
 * The three fields stay in the output at 0 so nothing downstream breaks, and so
 * a reader comparing this response to an older one can see what happened rather
 * than wondering where three lines went. What the index does exclude is named
 * in assumptions.ts under build_cost_scope, and the product says so on screen
 * instead of filling those gaps with numbers nobody published.
 */

import { ACRES_PER_MW, MIN_ACRES } from './assumptions.js'

export interface CapexParams {
  capacity_kw:             number   // IT load in kW
  land_cost_per_acre_usd:  number
  construction_cost_per_kw: number
  incentive_usd:           number   // one-time capital incentive (net from total)
}

export interface CapexResult {
  land_usd:         number
  construction_usd: number
  /** Inside construction_usd. Kept at 0 so the response shape does not change. */
  electrical_usd:   number
  /** Inside construction_usd. Kept at 0 so the response shape does not change. */
  cooling_usd:      number
  /** Not priced by this model. See build_cost_scope in assumptions.ts. */
  it_fitout_usd:    number
  total_usd:        number
}

export function computeCapex(p: CapexParams): CapexResult {
  const acres        = Math.max(MIN_ACRES, (p.capacity_kw / 1000) * ACRES_PER_MW)
  const land_usd     = acres * p.land_cost_per_acre_usd
  const construction = p.capacity_kw * p.construction_cost_per_kw

  const gross = land_usd + construction
  const total = Math.max(0, gross - p.incentive_usd)

  return {
    land_usd:         round2(land_usd),
    construction_usd: round2(construction),
    electrical_usd:   0,
    cooling_usd:      0,
    it_fitout_usd:    0,
    total_usd:        round2(total),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
