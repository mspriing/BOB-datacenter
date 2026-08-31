import { z } from 'zod'

// ── Per-site overrides (all optional / nullable) ──────────────────────────────
export const OverrideValuesSchema = z.object({
  land_cost_per_acre_usd:       z.number().positive().nullable().optional(),
  construction_cost_per_kw:     z.number().positive().nullable().optional(),
  power_rate_usd_per_kwh:       z.number().positive().nullable().optional(),
  water_rate_usd_per_kgal:      z.number().positive().nullable().optional(),
  staff_cost_index:              z.number().positive().nullable().optional(),
  tax_rate:                      z.number().min(0).max(1).nullable().optional(),
  incentive_usd:                 z.number().min(0).nullable().optional(),
  /** Years of property-tax abatement negotiated with the jurisdiction. User-supplied. */
  tax_abatement_years:           z.number().int().min(0).max(30).nullable().optional(),
  risk_score:                    z.number().min(0).max(10).nullable().optional(),
  renewable_pct:                 z.number().min(0).max(1).nullable().optional(),
  low_carbon_pct:                z.number().min(0).max(1).nullable().optional(),
  latency_ms_to_hub:             z.number().min(0).nullable().optional(),
  grid_interconnection_years:    z.number().min(0).max(30).nullable().optional(),
})
const OverridesSchema = OverrideValuesSchema.optional()

// ── Single candidate site ─────────────────────────────────────────────────────
const SiteInputSchema = z.object({
  site_id:    z.string().min(1).refine(
    (id) => !['__proto__', 'prototype', 'constructor'].includes(id),
    { message: 'site_id uses a reserved object key' },
  ),
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
}).refine(
  (weights) => Object.values(weights).some((weight) => weight != null && weight > 0),
  { message: 'At least one ranking weight must be greater than zero' },
).optional()

// ── Project parameters ────────────────────────────────────────────────────────
const ProjectSchema = z.object({
  name:           z.string().min(1),
  capacity_kw:    z.number().min(100).max(500_000),
  design_pue:     z.number().min(1.0).max(3.0),
  // design_wue: water usage effectiveness (litres per kWh of cooling energy).
  // This is a cooling-design assumption, NOT a regional lookup.
  // Default 0.4 L/kWh; range 0.0–2.5.
  design_wue:     z.number().min(0.0).max(2.5).optional().default(0.4),
  lifetime_years: z.number().int().min(5).max(40),
  discount_rate:  z.number().min(0.01).max(0.30),

  // Revenue is the reader's own commercial assumption, not a figure this
  // project sources, so both fields are optional and the engine returns no
  // payback without them. Price per kW per month is the colocation convention;
  // occupancy is here because capacity built but unsold earns nothing.
  revenue_per_kw_month: z.number().min(0).max(10_000).optional(),
  occupancy_pct:        z.number().min(0).max(1).optional().default(0.85),

  weights:        WeightsSchema,
})

// ── Full request body ─────────────────────────────────────────────────────────
export const InputSchema = z.object({
  request_id: z.string().uuid().optional(),
  project:    ProjectSchema,
  sites: z
    .array(SiteInputSchema)
    .min(2, 'Provide at least 2 candidate sites')
    .max(4, 'Maximum 4 candidate sites')
    // A region may appear only once. Without this a caller can submit the same
    // region_key twice and the engine will happily score a site against itself,
    // producing a ranking where one site both wins and loses.
    .refine(
      (sites) => new Set(sites.map((s) => s.region_key)).size === sites.length,
      { message: 'Each candidate site must use a different region_key' },
    )
    // site_id is what the output keys results by, so duplicates there silently
    // collapse two sites into one.
    .refine(
      (sites) => new Set(sites.map((s) => s.site_id)).size === sites.length,
      { message: 'Each candidate site must have a different site_id' },
    ),
})

export type EstimateInput = z.infer<typeof InputSchema>
