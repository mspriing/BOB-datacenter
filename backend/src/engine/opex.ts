/**
 * Annual OpEx calculation — pure function, no I/O, no LLM.
 *
 * Formulas:
 *   power_usd        = capacity_kw × pue × 8760 × power_rate_per_kwh
 *   water_usd        = capacity_kw × (pue − 1) × 8760 × design_wue × water_rate_per_kgal / 1000
 *                      [design_wue = litres of water per kWh of cooling energy (project-level design assumption)]
 *   staff_usd        = BASE_STAFF_COST_PER_KW × capacity_kw × staff_cost_index
 *   maintenance_usd  = capex_total × MAINTENANCE_RATE
 *                      [was 1.5% with nothing behind it; now 1.0% and stated
 *                       as an assumption in assumptions.ts]
 *   taxes_usd        = capex_total × effective_tax_rate  (0 during abatement years)
 *   connectivity_usd = BASE_CONNECTIVITY_PER_KW × capacity_kw
 *   total_usd        = sum of all above
 *
 * Water: cooling_kWh × design_wue (L/kWh) → litres → convert to kgal (1 kgal = 3785.4 L) → × rate
 * Note: design_wue is NOT read from regions.json; it is a project-level parameter set by the user.
 */

export interface OpexParams {
  capacity_kw:             number
  design_pue:              number
  power_rate_usd_per_kwh:  number
  water_rate_usd_per_kgal: number
  design_wue:              number   // water usage effectiveness (litres / kWh cooling) — project-level design assumption
  staff_cost_index:        number   // multiplier vs. national baseline
  tax_rate:                number   // decimal (e.g. 0.055)
  tax_abatement_years:     number   // how many years from the start carry no property tax
  current_year:            number   // which year we're computing, numbered from 1
  capex_total_usd:         number
}

export interface OpexResult {
  power_usd:        number
  water_usd:        number
  staff_usd:        number
  maintenance_usd:  number
  taxes_usd:        number
  connectivity_usd: number
  total_usd:        number
}

// ── Constants ─────────────────────────────────────────────────────────────────
// Everything that is not a physical conversion now lives in assumptions.ts with
// its basis, its source and its working, and is published with the estimate.
import {
  BASE_STAFF_COST_PER_KW,
  BASE_CONNECTIVITY_PER_KW,
  MAINTENANCE_RATE,
} from './assumptions.js'

const HOURS_PER_YEAR  = 8_760
const LITRES_PER_KGAL = 3_785.4

export function computeOpex(p: OpexParams): OpexResult {
  // Annual IT energy (kWh)
  const it_energy_kwh      = p.capacity_kw * HOURS_PER_YEAR
  // Total facility energy (kWh, including overhead via PUE)
  const total_energy_kwh   = it_energy_kwh * p.design_pue
  // Cooling energy (kWh) = overhead portion
  const cooling_energy_kwh = it_energy_kwh * (p.design_pue - 1)

  const power_usd = total_energy_kwh * p.power_rate_usd_per_kwh

  // Water: cooling_kWh × design_wue (L/kWh) → litres → kgal → × rate
  const water_litres = cooling_energy_kwh * p.design_wue
  const water_usd    = (water_litres / LITRES_PER_KGAL) * p.water_rate_usd_per_kgal

  const staff_usd        = p.capacity_kw * BASE_STAFF_COST_PER_KW * p.staff_cost_index
  const maintenance_usd  = p.capex_total_usd * MAINTENANCE_RATE
  // Years are numbered from 1, so an abatement of N years covers years 1 to N
  // and tax starts in year N+1. This read `<` while every caller passed year 1,
  // which made an abatement of 1 year and an abatement of 15 behave the same.
  const taxes_usd        = p.current_year <= p.tax_abatement_years
    ? 0
    : p.capex_total_usd * p.tax_rate
  const connectivity_usd = p.capacity_kw * BASE_CONNECTIVITY_PER_KW

  const total = power_usd + water_usd + staff_usd + maintenance_usd + taxes_usd + connectivity_usd

  return {
    power_usd:        round2(power_usd),
    water_usd:        round2(water_usd),
    staff_usd:        round2(staff_usd),
    maintenance_usd:  round2(maintenance_usd),
    taxes_usd:        round2(taxes_usd),
    connectivity_usd: round2(connectivity_usd),
    total_usd:        round2(total),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
