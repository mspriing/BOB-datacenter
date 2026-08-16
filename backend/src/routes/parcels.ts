/**
 * backend/src/routes/parcels.ts
 *
 * GET  /parcels          — paged summary list with filters + scoring
 * GET  /parcels/:id      — full ParcelEstimate for one parcel
 * POST /parcels/search   — same as GET but criteria in JSON body
 *
 * All reads go through parcelRepository (never open files directly here).
 * Spatial filtering uses the Flatbush index; no full-scan per request.
 *
 * Rule: no LLM calls. No cost math. Only scoring (estimateParcel) and ranking
 * (scoreAll / rerank) happen here — both are deterministic, tested functions.
 */

import { Router } from 'express'
import { fileRepository } from '../parcel/repository.js'
import { bexarConfig } from '../ingest/counties/bexar.js'
import { getOrBuildIndex, queryBbox } from '../parcel/spatialIndex.js'
import { scoreAll, estimateParcel, rerank } from '../parcel/score.js'
import {
  ListQuerySchema, DetailQuerySchema, SearchBodySchema,
  type ParcelSummary, type ParcelListResponse,
} from '../schemas/parcelApi.js'
import type { ParcelRow } from '../parcel/repository.js'
import type { ParcelProject } from '../parcel/score.js'
import type { CountyConfig } from '../ingest/countyConfig.js'

export const parcelsRouter = Router()

// ── County registry — extend when adding counties ─────────────────────────────

const COUNTY_CONFIGS: Record<string, CountyConfig> = {
  bexar: bexarConfig,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCountyConfig(countyId: string): CountyConfig | null {
  return COUNTY_CONFIGS[countyId] ?? null
}

/** Load rows, returning null with an error message if the file doesn't exist. */
function loadRows(countyId: string): ParcelRow[] | null {
  try {
    return fileRepository.listParcels(countyId)
  } catch {
    return null
  }
}

function projectFromQuery(q: {
  capacity_kw: number; design_pue: number; design_wue: number;
  lifetime_years: number; discount_rate: number; weights?: unknown
}): ParcelProject {
  return {
    capacity_kw:    q.capacity_kw,
    design_pue:     q.design_pue,
    design_wue:     q.design_wue,
    lifetime_years: q.lifetime_years,
    discount_rate:  q.discount_rate,
    weights:        q.weights as ParcelProject['weights'],
  }
}

/** Apply filter predicates to a row array. Returns the filtered set. */
function applyFilters(rows: ParcelRow[], f: {
  bbox?:                   { minLng: number; minLat: number; maxLng: number; maxLat: number }
  min_acres?:              number
  max_acres?:              number
  max_land_cost_per_acre?: number
  max_dist_tx_m?:          number
  exclude_flood?:          boolean
  zoning?:                 string[]
}, countyId: string): ParcelRow[] {
  let result = rows

  // Bbox: use Flatbush index for fast spatial filter
  if (f.bbox) {
    const pi = getOrBuildIndex(countyId, rows)
    const { minLng, minLat, maxLng, maxLat } = f.bbox
    result = queryBbox(pi, minLng, minLat, maxLng, maxLat)
  }

  if (f.min_acres !== undefined) {
    result = result.filter(r => r.acres !== null && r.acres >= f.min_acres!)
  }
  if (f.max_acres !== undefined) {
    result = result.filter(r => r.acres !== null && r.acres <= f.max_acres!)
  }
  if (f.max_land_cost_per_acre !== undefined) {
    result = result.filter(r => {
      const v = r.drivers['land_cost_per_acre_usd']?.value
      return v !== null && v !== undefined && v <= f.max_land_cost_per_acre!
    })
  }
  if (f.max_dist_tx_m !== undefined) {
    result = result.filter(r => r.dist_to_tx_line_m !== null && r.dist_to_tx_line_m <= f.max_dist_tx_m!)
  }
  if (f.exclude_flood) {
    result = result.filter(r => r.flood_buildable_pct === null || r.flood_buildable_pct >= 1.0)
  }
  if (f.zoning && f.zoning.length > 0) {
    const zoningSet = new Set(f.zoning)
    result = result.filter(r => zoningSet.has(r.zoning))
  }

  return result
}

function toSummary(
  e: { parcel_id: string; address: string; acres: number | null; zoning: string;
       flood_buildable_pct: number | null; rank: number; weighted_score: number;
       finance: { lifetime_cost_per_kw: number; capex_per_kw: number };
       provenance: Array<{ driver: string; value: number | null }> },
  row: ParcelRow,
): ParcelSummary {
  const landProv = e.provenance.find(p => p.driver === 'land_cost_per_acre_usd')
  return {
    parcel_id:              e.parcel_id,
    address:                e.address,
    acres:                  e.acres,
    zoning:                 e.zoning,
    flood_buildable_pct:    e.flood_buildable_pct,
    dist_to_tx_line_m:      row.dist_to_tx_line_m,
    dist_to_ixp_km:         row.dist_to_ixp_km,
    lat:                    row.lat,
    lng:                    row.lng,
    lifetime_cost_per_kw:   e.finance.lifetime_cost_per_kw,
    capex_per_kw:           e.finance.capex_per_kw,
    land_cost_per_acre_usd: landProv?.value ?? 0,
    rank:                   e.rank,
    weighted_score:         e.weighted_score,
  }
}

function paginate<T>(arr: T[], page: number, perPage: number): T[] {
  return arr.slice((page - 1) * perPage, page * perPage)
}

// ── GET /parcels ───────────────────────────────────────────────────────────────

parcelsRouter.get('/', (req, res) => {
  const parsed = ListQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() })
    return
  }
  const q = parsed.data
  const county = getCountyConfig(q.county)
  if (!county) {
    res.status(404).json({ error: 'county not found', county: q.county })
    return
  }
  const allRows = loadRows(q.county)
  if (!allRows) {
    res.status(404).json({
      error: 'parcel data not found',
      county: q.county,
      hint: 'Run `npm run ingest:parcels` to generate data/parcels/bexar.rows.json',
    })
    return
  }

  // Filter
  const filtered = applyFilters(allRows, {
    bbox:                   q.bbox,
    min_acres:              q.min_acres,
    max_acres:              q.max_acres,
    max_land_cost_per_acre: q.max_land_cost_per_acre,
    max_dist_tx_m:          q.max_dist_tx_m,
    exclude_flood:          q.exclude_flood ?? undefined,
    zoning:                 q.zoning,
  }, q.county)

  // Score the filtered set (uses cache)
  const project = projectFromQuery(q)
  const scored  = scoreAll(filtered, project, county)

  // Sort
  const sorted = [...scored].sort((a, b) => {
    switch (q.sort_by) {
      case 'acres':               return (b.acres ?? 0) - (a.acres ?? 0)
      case 'lifetime_cost_per_kw':return a.finance.lifetime_cost_per_kw - b.finance.lifetime_cost_per_kw
      case 'land_cost_per_acre':  {
        const av = a.provenance.find(p => p.driver === 'land_cost_per_acre_usd')?.value ?? 0
        const bv = b.provenance.find(p => p.driver === 'land_cost_per_acre_usd')?.value ?? 0
        return av - bv
      }
      default: return a.rank - b.rank  // 'rank'
    }
  })

  const page    = q.page
  const perPage = q.per_page
  const paged   = paginate(sorted, page, perPage)

  // Build row lookup for summary
  const rowById = new Map(allRows.map(r => [r.parcel_id, r]))

  const response: ParcelListResponse = {
    county:   q.county,
    total:    sorted.length,
    page,
    per_page: perPage,
    parcels:  paged.map(e => toSummary(e, rowById.get(e.parcel_id)!)),
  }
  res.json(response)
})

// ── GET /parcels/:id ───────────────────────────────────────────────────────────

parcelsRouter.get('/:id', (req, res) => {
  const parsed = DetailQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() })
    return
  }
  const q       = parsed.data
  const county  = getCountyConfig(q.county)
  if (!county) {
    res.status(404).json({ error: 'county not found', county: q.county })
    return
  }

  const row = fileRepository.getParcel(q.county, req.params.id)
  if (!row) {
    res.status(404).json({ error: 'parcel not found', parcel_id: req.params.id })
    return
  }

  const project  = projectFromQuery(q)
  const estimate = estimateParcel(row, project, county)
  res.json({ ...estimate, rank: 0, weighted_score: 0 })
})

// ── POST /parcels/search ───────────────────────────────────────────────────────

parcelsRouter.post('/search', (req, res) => {
  const parsed = SearchBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
    return
  }
  const body   = parsed.data
  const county = getCountyConfig(body.county)
  if (!county) {
    res.status(404).json({ error: 'county not found', county: body.county })
    return
  }
  const allRows = loadRows(body.county)
  if (!allRows) {
    res.status(404).json({
      error: 'parcel data not found',
      county: body.county,
      hint: 'Run `npm run ingest:parcels` to generate data/parcels/bexar.rows.json',
    })
    return
  }

  const filters = body.filters ?? {}
  const filtered = applyFilters(allRows, {
    bbox:                   filters.bbox,
    min_acres:              filters.min_acres,
    max_acres:              filters.max_acres,
    max_land_cost_per_acre: filters.max_land_cost_per_acre,
    max_dist_tx_m:          filters.max_dist_tx_m,
    exclude_flood:          filters.exclude_flood,
    zoning:                 filters.zoning,
  }, body.county)

  const defaultProject: ParcelProject = {
    capacity_kw:    10_000,
    design_pue:     1.4,
    design_wue:     0.4,
    lifetime_years: 20,
    discount_rate:  0.08,
  }
  const project: ParcelProject = body.project
    ? { ...defaultProject, ...body.project }
    : defaultProject

  const scored = scoreAll(filtered, project, county)

  // Apply weight re-rank if different from scoring weights
  const final = project.weights ? rerank(scored, project.weights) : scored

  const page    = body.pagination?.page     ?? 1
  const perPage = body.pagination?.per_page ?? 50
  const paged   = paginate(final, page, perPage)

  const rowById = new Map(allRows.map(r => [r.parcel_id, r]))
  const response: ParcelListResponse = {
    county:   body.county,
    total:    final.length,
    page,
    per_page: perPage,
    parcels:  paged.map(e => toSummary(e, rowById.get(e.parcel_id)!)),
  }
  res.json(response)
})
