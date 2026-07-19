/**
 * Annual OpEx calculation — pure function, no I/O, no LLM.
 *
 * Formulas:
 *   power_usd        = capacity_kw × pue × 8760 × power_rate_per_kwh
 *   water_usd        = capacity_kw × pue × 8760 × wue × (1 gal/kWh cooling) × water_rate_per_kgal / 1000
 *                      [wue = water usage effectiveness; gal of water per kWh of IT energy]
 *   staff_usd        = BASE_STAFF_COST_PER_KW × capacity_kw × staff_cost_index
 *   maintenance_usd  = capex_total × MAINTENANCE_RATE
 *   taxes_usd        = capex_total × effective_tax_rate  (0 during abatement years)
 *   connectivity_usd = BASE_CONNECTIVITY_PER_KW × capacity_kw
 *   total_usd        = sum of all above
 *
 * Water: 1 kWh of cooling ≈ 1 gallon of water evaporated in a cooling tower (industry rule of thumb).
 * Cooling kWh = IT_kWh × (pue − 1).  Water = cooling_kWh × wue × rate.
 */

export interface OpexParams {
  capacity_kw:             number
  design_pue:              number
  power_rate_usd_per_kwh:  number
  water_rate_usd_per_kgal: number
  wue:                     number   // water usage effectiveness (gal / kWh cooling)
  staff_cost_index:        number   // multiplier vs. national baseline
  tax_rate:                number   // decimal (e.g. 0.055)
  tax_abatement_years:     number   // years from year-0 with zero property tax
  current_year:            number   // which year we're computing (0-indexed)
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
const HOURS_PER_YEAR           = 8_760
const BASE_STAFF_COST_PER_KW   = 280   // $/kW-year — national median fully-loaded DC ops
const MAINTENANCE_RATE         = 0.015 // 1.5% of CapEx per year
const BASE_CONNECTIVITY_PER_KW = 60    // $/kW-year — diverse fiber + dark fiber amortised

export function computeOpex(p: OpexParams): OpexResult {
  // Annual IT energy (kWh)
  const it_energy_kwh      = p.capacity_kw * HOURS_PER_YEAR
  // Total facility energy (kWh, including overhead via PUE)
  const total_energy_kwh   = it_energy_kwh * p.design_pue
  // Cooling energy (kWh) = overhead portion
  const cooling_energy_kwh = it_energy_kwh * (p.design_pue - 1)

  const power_usd = total_energy_kwh * p.power_rate_usd_per_kwh

  // Water: cooling_kWh × wue (gal/kWh) → gallons → convert to kgal → × rate
  const water_gallons = cooling_energy_kwh * p.wue
  const water_usd     = (water_gallons / 1_000) * p.water_rate_usd_per_kgal

  const staff_usd        = p.capacity_kw * BASE_STAFF_COST_PER_KW * p.staff_cost_index
  const maintenance_usd  = p.capex_total_usd * MAINTENANCE_RATE
  const taxes_usd        = p.current_year < p.tax_abatement_years
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
