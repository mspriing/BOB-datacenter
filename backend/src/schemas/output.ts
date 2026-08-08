import { z } from 'zod'

// ── Narrative (LLM layer output) ──────────────────────────────────────────────
export const SensitivityCalloutSchema = z.object({
  site_id:  z.string(),
  label:    z.string(),
  callout:  z.string(),   // plain-English 1-sentence driver summary
})

export const UncertaintyFlagSchema = z.object({
  site_id: z.string(),
  field:   z.string(),
  reason:  z.string(),
})

export const NarrativeSchema = z.object({
  recommendation:        z.string(),            // investment-memo paragraph for rank-1
  sensitivity_callouts:  z.array(SensitivityCalloutSchema), // 2–3 items
  uncertainty_flags:     z.array(UncertaintyFlagSchema),
  source:                z.enum(['watsonx', 'fallback', 'cache']),
})

export type NarrativeResult    = z.infer<typeof NarrativeSchema>
export type SensitivityCallout = z.infer<typeof SensitivityCalloutSchema>
export type UncertaintyFlag    = z.infer<typeof UncertaintyFlagSchema>

const RangeSchema = z.object({
  npv_usd:         z.number(),
  lifetime_per_kw: z.number(),
})

const FinanceSchema = z.object({
  capex_per_kw:         z.number(),
  lifetime_cost_per_kw: z.number(),
  npv_usd:              z.number(),
  payback_years:        z.number(),
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
  risk_score:                 z.number().nullable(),
  renewable_pct:              z.number().nullable(),
  low_carbon_pct:             z.number().nullable(),
  latency_ms:                 z.number().nullable(),
  grid_interconnection_years: z.number().nullable(),
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
  /** True when no weighted-score flip occurs within the search range. */
  stable:          z.boolean().optional(),
})

export const ProvenanceItemSchema = z.object({
  region_key:    z.string(),
  driver:        z.string(),
  value:         z.number().nullable(),
  source_url:    z.string(),
  last_verified: z.string(),
  basis:         z.enum(['sourced', 'modeled', 'assumed']).nullable().optional(),
})

export type ProvenanceItem = z.infer<typeof ProvenanceItemSchema>

export const ParsedFieldSchema = z.object({
  site_id:  z.string(),
  field:    z.string(),
  value:    z.number(),
  inferred: z.boolean(),
})

export type ParsedField = z.infer<typeof ParsedFieldSchema>

// ── data_gaps — drivers that were null and excluded from scoring ──────────────
export const DataGapSchema = z.object({
  site_id: z.string(),
  driver:  z.string(),
  reason:  z.string(),
})

export type DataGap = z.infer<typeof DataGapSchema>

// ── confidence — count of driver values by basis ──────────────────────────────
export const ConfidenceSchema = z.object({
  sourced: z.number().int().min(0),
  modeled: z.number().int().min(0),
  assumed: z.number().int().min(0),
  missing: z.number().int().min(0),
})

export type Confidence = z.infer<typeof ConfidenceSchema>

export const OutputSchema = z.object({
  request_id:      z.string().uuid(),
  generated_at:    z.string(),
  engine_version:  z.string(),
  ranking:         z.array(z.string()),
  site_labels:     z.record(z.string()),
  sites:           z.record(z.string(), SiteOutputSchema),
  sensitivity:     z.array(SensitivityItemSchema),
  flip_sentence:   z.string(),
  narrative:       NarrativeSchema,
  parsed_fields:   z.array(ParsedFieldSchema),
  data_provenance: z.array(ProvenanceItemSchema),
  data_gaps:       z.array(DataGapSchema),
  confidence:      ConfidenceSchema,
})

export type EstimateOutput = z.infer<typeof OutputSchema>
export type SiteOutput     = z.infer<typeof SiteOutputSchema>
