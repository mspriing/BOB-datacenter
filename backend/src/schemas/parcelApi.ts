/**
 * backend/src/schemas/parcelApi.ts
 *
 * Zod schemas for the parcel API endpoints (Phase 2).
 * Derived from docs/SCHEMA.md §"Parcel API endpoints".
 */

import { z } from 'zod'

// ── Shared scoring context ─────────────────────────────────────────────────────

export const ScoringContextSchema = z.object({
  capacity_kw:    z.coerce.number().min(100).max(500_000).default(10_000),
  design_pue:     z.coerce.number().min(1.0).max(3.0).default(1.4),
  design_wue:     z.coerce.number().min(0).max(2.5).default(0.4),
  lifetime_years: z.coerce.number().int().min(5).max(40).default(20),
  discount_rate:  z.coerce.number().min(0.01).max(0.30).default(0.08),
})

const WeightsSchema = z.object({
  total_cost:     z.number().min(0).max(1).optional(),
  risk:           z.number().min(0).max(1).optional(),
  sustainability: z.number().min(0).max(1).optional(),
  latency:        z.number().min(0).max(1).optional(),
}).optional()

// ── Filter vocabulary (shared by GET query params and POST body) ──────────────

export const FiltersSchema = z.object({
  min_acres:               z.coerce.number().optional(),
  max_acres:               z.coerce.number().optional(),
  max_land_cost_per_acre:  z.coerce.number().optional(),
  max_dist_tx_m:           z.coerce.number().optional(),
  exclude_flood:           z.coerce.boolean().optional(),
  zoning:                  z.array(z.string()).optional(),
  bbox: z.object({
    minLng: z.number(), minLat: z.number(),
    maxLng: z.number(), maxLat: z.number(),
  }).optional(),
})

export type ParcelFilters = z.infer<typeof FiltersSchema>

// ── GET /parcels query params ─────────────────────────────────────────────────

export const ListQuerySchema = ScoringContextSchema.extend({
  county:   z.string().default('bexar'),
  page:     z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),

  // Spatial filter — comma-separated "minLng,minLat,maxLng,maxLat"
  bbox: z.string().optional().transform((s, ctx) => {
    if (!s) return undefined
    const parts = s.split(',').map(Number)
    if (parts.length !== 4 || parts.some(isNaN)) {
      ctx.addIssue({ code: 'custom', message: 'bbox must be minLng,minLat,maxLng,maxLat' })
      return z.NEVER
    }
    return { minLng: parts[0], minLat: parts[1], maxLng: parts[2], maxLat: parts[3] }
  }),

  min_acres:               z.coerce.number().optional(),
  max_acres:               z.coerce.number().optional(),
  max_land_cost_per_acre:  z.coerce.number().optional(),
  max_dist_tx_m:           z.coerce.number().optional(),
  exclude_flood:           z.string().optional().transform(s => s === 'true' ? true : s === 'false' ? false : undefined),

  // Comma-separated zoning tags
  zoning: z.string().optional().transform(s => s ? s.split(',').map(t => t.trim()).filter(Boolean) : undefined),

  sort_by: z.enum(['rank', 'acres', 'lifetime_cost_per_kw', 'land_cost_per_acre']).default('rank'),

  // weights as JSON string
  weights: z.string().optional().transform((s) => {
    if (!s) return undefined
    try { return WeightsSchema.parse(JSON.parse(s)) } catch { return undefined }
  }),
})

// ── GET /parcels/:id query params ─────────────────────────────────────────────

export const DetailQuerySchema = ScoringContextSchema.extend({
  county: z.string().default('bexar'),
})

// ── POST /parcels/search body ─────────────────────────────────────────────────

export const SearchBodySchema = z.object({
  county:  z.string().default('bexar'),
  project: ScoringContextSchema.extend({ weights: WeightsSchema }).optional(),
  filters: FiltersSchema.optional(),
  pagination: z.object({
    page:     z.number().int().min(1).default(1),
    per_page: z.number().int().min(1).max(200).default(50),
  }).optional(),
})

// ── Response types ────────────────────────────────────────────────────────────

export interface ParcelSummary {
  parcel_id:              string
  address:                string
  acres:                  number | null
  zoning:                 string
  flood_buildable_pct:    number | null
  dist_to_tx_line_m:      number | null
  dist_to_ixp_km:         number | null
  lat:                    number | null
  lng:                    number | null
  // null means this parcel could not be priced. A missing cost is not a zero
  // cost, and a total built on one would put the least known parcel first.
  lifetime_cost_per_kw:   number | null
  capex_per_kw:           number | null
  land_cost_per_acre_usd: number | null
  /** Names the cost drivers with no value. null when the parcel was priced. */
  unevaluable:            string[] | null
  /** 0 when the parcel is unpriced and therefore carries no rank. */
  rank:                   number
  weighted_score:         number
}

export interface ParcelListResponse {
  county:   string
  total:    number
  page:     number
  per_page: number
  parcels:  ParcelSummary[]
}
