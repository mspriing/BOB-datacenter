import { z } from 'zod'

const RangeSchema = z.object({
  npv_usd:          z.number(),
  levelized_per_kw: z.number(),
})

const FinanceSchema = z.object({
  levelized_cost_per_kw: z.number(),
  npv_usd:               z.number(),
  payback_years:         z.number(),
  ranges: z.object({
    low:  RangeSchema,
    base: RangeSchema,
    high: RangeSchema,
  }),
})

const CapexSchema = z.object({
  land_usd:         z.number(),
  construction_usd: z.number(),
  electrical_usd:   z.number(),
  cooling_usd:      z.number(),
  it_fitout_usd:    z.number(),
  total_usd:        z.number(),
})

const OpexAnnualSchema = z.object({
  power_usd:        z.number(),
  water_usd:        z.number(),
  staff_usd:        z.number(),
  maintenance_usd:  z.number(),
  taxes_usd:        z.number(),
  connectivity_usd: z.number(),
  total_usd:        z.number(),
})

const NonCostScoresSchema = z.object({
  risk_score:    z.number(),
  renewable_pct: z.number(),
  latency_ms:    z.number(),
})

const SiteOutputSchema = z.object({
  rank:            z.number().int().min(1),
  weighted_score:  z.number().min(0).max(1),
  capex:           CapexSchema,
  opex_annual:     OpexAnnualSchema,
  finance:         FinanceSchema,
  non_cost_scores: NonCostScoresSchema,
})

const SensitivityItemSchema = z.object({
  driver:          z.string(),
  current_value:   z.number(),
  flip_value:      z.number(),
  pct_change:      z.number(),
  affected_sites:  z.array(z.string()),
})

const ProvenanceItemSchema = z.object({
  region_key:    z.string(),
  driver:        z.string(),
  value:         z.number(),
  source_url:    z.string(),
  last_verified: z.string(),
})

export const OutputSchema = z.object({
  request_id:     z.string().uuid(),
  generated_at:   z.string(),
  engine_version: z.string(),
  ranking:        z.array(z.string()),
  sites:          z.record(z.string(), SiteOutputSchema),
  sensitivity:    z.array(SensitivityItemSchema),
  flip_sentence:  z.string(),
  narrative:      z.string(),
  data_provenance: z.array(ProvenanceItemSchema),
})

export type EstimateOutput = z.infer<typeof OutputSchema>
export type SiteOutput     = z.infer<typeof SiteOutputSchema>
