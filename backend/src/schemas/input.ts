import { z } from 'zod'

// ── Per-site overrides (all optional / nullable) ──────────────────────────────
const OverridesSchema = z.object({
  land_cost_per_acre_usd:    z.number().positive().nullable().optional(),
  construction_cost_per_kw:  z.number().positive().nullable().optional(),
  power_rate_usd_per_kwh:    z.number().positive().nullable().optional(),
  water_rate_usd_per_kgal:   z.number().positive().nullable().optional(),
  staff_cost_index:           z.number().positive().nullable().optional(),
  tax_rate:                   z.number().min(0).max(1).nullable().optional(),
  incentive_usd:              z.number().min(0).nullable().optional(),
  risk_score:                 z.number().min(0).max(10).nullable().optional(),
  renewable_pct:              z.number().min(0).max(1).nullable().optional(),
  latency_ms_to_hub:          z.number().min(0).nullable().optional(),
}).optional()

// ── Single candidate site ─────────────────────────────────────────────────────
const SiteInputSchema = z.object({
  site_id:    z.string().min(1),
  label:      z.string().min(1),
  region_key: z.string().min(1),
  free_text:  z.string().nullable().optional(),
  overrides:  OverridesSchema,
})

// ── Ranking weights (must sum to 1.0) ─────────────────────────────────────────
const WeightsSchema = z.object({
  total_cost:     z.number().min(0).max(1).optional(),
  risk:           z.number().min(0).max(1).optional(),
  sustainability: z.number().min(0).max(1).optional(),
  latency:        z.number().min(0).max(1).optional(),
}).optional()

// ── Project parameters ────────────────────────────────────────────────────────
const ProjectSchema = z.object({
  name:           z.string().min(1),
  capacity_kw:    z.number().min(100).max(500_000),
  design_pue:     z.number().min(1.0).max(3.0),
  lifetime_years: z.number().int().min(5).max(40),
  discount_rate:  z.number().min(0.01).max(0.30),
  weights:        WeightsSchema,
})

// ── Full request body ─────────────────────────────────────────────────────────
export const InputSchema = z.object({
  request_id: z.string().uuid().optional(),
  project:    ProjectSchema,
  sites: z
    .array(SiteInputSchema)
    .min(2, 'Provide at least 2 candidate sites')
    .max(4, 'Maximum 4 candidate sites'),
})

export type EstimateInput = z.infer<typeof InputSchema>
