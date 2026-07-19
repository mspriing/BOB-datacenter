// ── Input types ──────────────────────────────────────────────────────────────

export interface SiteOverrides {
  land_cost_per_acre_usd?:    number | null
  construction_cost_per_kw?:  number | null
  power_rate_usd_per_kwh?:    number | null
  water_rate_usd_per_kgal?:   number | null
  staff_cost_index?:           number | null
  tax_rate?:                   number | null
  incentive_usd?:              number | null
  risk_score?:                 number | null
  renewable_pct?:              number | null
  latency_ms_to_hub?:          number | null
}

export interface SiteInput {
  site_id:    string
  label:      string
  region_key: string
  free_text?: string | null
  overrides?: SiteOverrides
}

export interface ProjectWeights {
  total_cost?:     number
  risk?:           number
  sustainability?: number
  latency?:        number
}

export interface ProjectInput {
  name:           string
  capacity_kw:    number
  design_pue:     number
  lifetime_years: number
  discount_rate:  number
  weights?:       ProjectWeights
}

export interface EstimateInput {
  request_id?: string
  project:     ProjectInput
  sites:       SiteInput[]
}

// ── Output types ─────────────────────────────────────────────────────────────

export interface CostRange {
  npv_usd:          number
  levelized_per_kw: number
}

export interface SiteCapex {
  land_usd:         number
  construction_usd: number
  electrical_usd:   number
  cooling_usd:      number
  it_fitout_usd:    number
  total_usd:        number
}

export interface SiteOpexAnnual {
  power_usd:        number
  water_usd:        number
  staff_usd:        number
  maintenance_usd:  number
  taxes_usd:        number
  connectivity_usd: number
  total_usd:        number
}

export interface SiteFinance {
  levelized_cost_per_kw: number
  npv_usd:               number
  payback_years:         number
  ranges: {
    low:  CostRange
    base: CostRange
    high: CostRange
  }
}

export interface NonCostScores {
  risk_score:    number
  renewable_pct: number
  latency_ms:    number
}

export interface SiteOutput {
  rank:            number
  weighted_score:  number
  capex:           SiteCapex
  opex_annual:     SiteOpexAnnual
  finance:         SiteFinance
  non_cost_scores: NonCostScores
}

export interface SensitivityItem {
  driver:         string
  current_value:  number
  flip_value:     number
  pct_change:     number
  affected_sites: string[]
}

export interface ProvenanceItem {
  region_key:    string
  driver:        string
  value:         number
  source_url:    string
  last_verified: string
}

export interface EstimateOutput {
  request_id:      string
  generated_at:    string
  engine_version:  string
  ranking:         string[]
  sites:           Record<string, SiteOutput>
  sensitivity:     SensitivityItem[]
  flip_sentence:   string
  narrative:       string
  data_provenance: ProvenanceItem[]
}

// ── Scenario toggle type ──────────────────────────────────────────────────────
export type Scenario = 'low' | 'base' | 'high'
