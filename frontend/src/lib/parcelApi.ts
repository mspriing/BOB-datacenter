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
  /**
   * null when the parcel is missing a cost driver. A missing cost is not a zero
   * cost, so the server sends null rather than 0 and the list says so in words.
   */
  lifetime_cost_per_kw: number | null
  capex_per_kw: number | null
  land_cost_per_acre_usd: number | null
  /** Names the missing cost drivers. null when the parcel was priced. */
  unevaluable: string[] | null
  /** 0 when the parcel carries no rank because it could not be priced. */
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

export interface ApiResult<T> {
  data: T | null
  error: string | null
  /**
   * True when the reply came from the recorded snapshot rather than from the
   * service. The screens say so on the page; nothing reads this silently.
   */
  offline?: boolean
  /** The date the snapshot was recorded. Set only when offline is true. */
  capturedAt?: string
}

/**
 * A request that never reached the service, as against one the service
 * answered with an error. Only the first case falls back to the snapshot: if
 * the service replied 400 or 404, its answer is the truth and replacing it
 * with older data would hide a real fault.
 */
interface Unreachable { unreachable: true; message: string }
function unreachable(e: unknown): Unreachable {
  return { unreachable: true, message: e instanceof Error ? e.message : 'Network error' }
}

async function get<T>(path: string): Promise<ApiResult<T> | Unreachable> {
  try {
    const res = await fetch(`${API_BASE}/api${path}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      // The parcel service answers an error in JSON, as { error } or
      // { error: { message } }. Anything else on this path came from a static
      // host or a proxy that has no parcel service behind it, and a page served
      // from one of those is offline as far as parcels are concerned.
      let body: unknown = null
      try { body = await res.json() } catch { return unreachable(new Error(`Request failed (${res.status})`)) }
      const err = (body as { error?: unknown })?.error
      if (err === undefined) return unreachable(new Error(`Request failed (${res.status})`))
      const message = typeof err === 'string'
        ? err
        : (err as { message?: string })?.message ?? `Request failed (${res.status})`
      return { data: null, error: message }
    }
    // A static host that answers every path with the app's own index.html
    // returns 200 and no JSON. That is not the parcel service either.
    try {
      return { data: (await res.json()) as T, error: null }
    } catch (e) {
      return unreachable(e)
    }
  } catch (e) {
    return unreachable(e)
  }
}

export async function fetchParcels(q: ParcelQuery): Promise<ApiResult<ParcelListResponse>> {
  const r = await get<ParcelListResponse>(`/parcels?${toQueryString(q)}`)
  if (!('unreachable' in r)) return r
  const { offlineParcels, SNAPSHOT_DATE } = await import('./parcelOffline')
  return { data: offlineParcels(q), error: null, offline: true, capturedAt: SNAPSHOT_DATE }
}

export async function fetchParcel(id: string, county = 'bexar'): Promise<ApiResult<unknown>> {
  const r = await get<unknown>(
    `/parcels/${encodeURIComponent(id)}?county=${encodeURIComponent(county)}`)
  if (!('unreachable' in r)) return r
  const { offlineParcel, SNAPSHOT_DATE } = await import('./parcelOffline')
  const hit = offlineParcel(id)
  if (!hit) {
    return {
      data: null,
      error: 'The parcel service did not answer, and this parcel is not one of '
        + 'the ones held in the recorded set.',
    }
  }
  return { data: hit, error: null, offline: true, capturedAt: SNAPSHOT_DATE }
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
