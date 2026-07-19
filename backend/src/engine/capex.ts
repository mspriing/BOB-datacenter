/**
 * CapEx calculation — pure function, no I/O, no LLM.
 *
 * Formula breakdown (all figures ultimately come from data/regions.json
 * or per-site overrides — the caller resolves which value to use):
 *
 *   land_usd         = acres_needed × land_cost_per_acre
 *   construction_usd = capacity_kw × construction_cost_per_kw
 *   electrical_usd   = capacity_kw × ELECTRICAL_COST_PER_KW   (switchgear, transformers, UPS)
 *   cooling_usd      = capacity_kw × cooling_cost_per_kw       (varies by cooling type)
 *   it_fitout_usd    = capacity_kw × IT_FITOUT_PER_KW          (racks, cable, structured cabling)
 *   total_usd        = sum of above − incentive_usd
 *
 * Land sizing: ~1 acre per MW of IT load; minimum 5 acres.
 */

export interface CapexParams {
  capacity_kw:             number   // IT load in kW
  land_cost_per_acre_usd:  number
  construction_cost_per_kw: number
  incentive_usd:           number   // one-time capital incentive (net from total)
}

export interface CapexResult {
  land_usd:         number
  construction_usd: number
  electrical_usd:   number
  cooling_usd:      number
  it_fitout_usd:    number
  total_usd:        number
}

// ── Constants (industry benchmarks, adjusted for Tier III facilities) ─────────
const ACRES_PER_MW     = 1.2    // typical campus land density
const MIN_ACRES        = 5
const ELECTRICAL_COST_PER_KW = 550   // $/kW — switchgear, UPS, PDUs, transformers
const COOLING_COST_PER_KW    = 400   // $/kW — baseline air-cooled CRAC/CRAH
const IT_FITOUT_PER_KW       = 200   // $/kW — racks, cable trays, structured cabling

export function computeCapex(p: CapexParams): CapexResult {
  const acres        = Math.max(MIN_ACRES, (p.capacity_kw / 1000) * ACRES_PER_MW)
  const land_usd     = acres * p.land_cost_per_acre_usd
  const construction = p.capacity_kw * p.construction_cost_per_kw
  const electrical   = p.capacity_kw * ELECTRICAL_COST_PER_KW
  const cooling      = p.capacity_kw * COOLING_COST_PER_KW
  const it_fitout    = p.capacity_kw * IT_FITOUT_PER_KW

  const gross = land_usd + construction + electrical + cooling + it_fitout
  const total  = Math.max(0, gross - p.incentive_usd)

  return {
    land_usd:         round2(land_usd),
    construction_usd: round2(construction),
    electrical_usd:   round2(electrical),
    cooling_usd:      round2(cooling),
    it_fitout_usd:    round2(it_fitout),
    total_usd:        round2(total),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
