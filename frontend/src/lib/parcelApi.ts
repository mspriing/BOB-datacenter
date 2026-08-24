/**
 * Client for the parcel endpoints. Shapes mirror backend/src/schemas/parcelApi.ts,
 * which docs/SCHEMA.md defines; update there first, then here.
 */
import { API_BASE } from './api'

export interface ParcelSummary {
  parcel_id: string
  address: string
  acres: number | null
  zoning: string
  flood_buildable_pct: number | null
  dist_to_tx_line_m: number | null
  dist_to_ixp_km: number | null
  lat: number | null
  lng: number | null
  lifetime_cost_per_kw: number
  capex_per_kw: number
  land_cost_per_acre_usd: number
  rank: number
  weighted_score: number
}

export interface ParcelListResponse {
  county: string
  total: number
  page: number
  per_page: number
  parcels: ParcelSummary[]
}

/** The filter vocabulary the backend accepts. Kept flat so one state object drives every view. */
export interface ParcelFilters {
  min_acres?: number
  max_acres?: number
  max_land_cost_per_acre?: number
  max_dist_tx_m?: number
  exclude_flood?: boolean
}

export type SortBy = 'rank' | 'acres' | 'lifetime_cost_per_kw' | 'land_cost_per_acre'

export interface ParcelQuery extends ParcelFilters {
  county?: string
  page?: number
  per_page?: number
  sort_by?: SortBy
}

function toQueryString(q: ParcelQuery): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, String(v))
  }
  return p.toString()
}

export interface ApiResult<T> { data: T | null; error: string | null }

async function get<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}/api${path}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      // The backend's error shape is { error: { message } }; fall back to the
      // status when a proxy or a crash returns something else entirely.
      let message = `Request failed (${res.status})`
      try {
        const body = await res.json()
        if (body?.error?.message) message = body.error.message
      } catch { /* keep the status message */ }
      return { data: null, error: message }
    }
    return { data: (await res.json()) as T, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' }
  }
}

export function fetchParcels(q: ParcelQuery): Promise<ApiResult<ParcelListResponse>> {
  return get<ParcelListResponse>(`/parcels?${toQueryString(q)}`)
}

export function fetchParcel(id: string, county = 'bexar'): Promise<ApiResult<unknown>> {
  return get<unknown>(`/parcels/${encodeURIComponent(id)}?county=${encodeURIComponent(county)}`)
}

// ── Criteria parsing ──────────────────────────────────────────────────────────

export interface CriteriaResult {
  filters: ParcelFilters
  weights: Record<string, number>
  /** Phrases the parser could not express as a filter. Always shown. */
  unparsed: string[]
  source: 'watsonx' | 'fallback'
}

export async function parseCriteria(text: string): Promise<ApiResult<CriteriaResult>> {
  try {
    const res = await fetch(`${API_BASE}/api/parcels/criteria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      let message = `Request failed (${res.status})`
      try { const b = await res.json(); if (b?.error) message = String(b.error) } catch { /* keep */ }
      return { data: null, error: message }
    }
    return { data: (await res.json()) as CriteriaResult, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' }
  }
}
