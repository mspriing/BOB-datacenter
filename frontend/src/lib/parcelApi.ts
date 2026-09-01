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
   * The parcel outline, thinned server-side, or null when the ingest holds no
   * usable shape. The map draws this. The point above is what it falls back to
   * when the whole county is in view and a plot is smaller than a pixel.
   */
  geometry: { type: 'Polygon'; coordinates: number[][][] } | null
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

export interface ParcelWeights {
  total_cost?: number
  risk?: number
  sustainability?: number
  latency?: number
}

export type SortBy = 'rank' | 'acres' | 'lifetime_cost_per_kw' | 'land_cost_per_acre'

export interface ParcelQuery extends ParcelFilters {
  county?: string
  page?: number
  per_page?: number
  sort_by?: SortBy
  capacity_kw?: number
  design_pue?: number
  design_wue?: number
  lifetime_years?: number
  discount_rate?: number
  /** The reader's revenue assumption, so parcels pay back on the same basis as regions. */
  revenue_per_kw_month?: number
  occupancy_pct?: number
  weights?: ParcelWeights
}

function toQueryString(q: ParcelQuery): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, k === 'weights' ? JSON.stringify(v) : String(v))
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
const TIMEOUT_MS = 120_000

function unreachable(e: unknown, cancelled = false): Unreachable & { cancelled?: boolean } {
  return {
    unreachable: true,
    message: e instanceof Error ? e.message : 'Network error',
    ...(cancelled ? { cancelled: true } : {}),
  }
}

async function get<T>(
  path: string,
  externalSignal?: AbortSignal,
): Promise<ApiResult<T> | (Unreachable & { cancelled?: boolean })> {
  const controller = new AbortController()
  let timedOut = false
  const killer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT_MS)
  const cancel = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', cancel, { once: true })

  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
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
    if (controller.signal.aborted) {
      return unreachable(
        new Error(timedOut ? 'The parcel request timed out.' : 'The parcel request was cancelled.'),
        !timedOut,
      )
    }
    return unreachable(e)
  } finally {
    clearTimeout(killer)
    externalSignal?.removeEventListener('abort', cancel)
  }
}

export async function fetchParcels(
  q: ParcelQuery,
  signal?: AbortSignal,
): Promise<ApiResult<ParcelListResponse>> {
  const r = await get<ParcelListResponse>(`/parcels?${toQueryString(q)}`, signal)
  if (!('unreachable' in r)) return r
  if (r.cancelled) return { data: null, error: r.message }
  const { offlineParcels, SNAPSHOT_DATE } = await import('./parcelOffline')
  return { data: offlineParcels(q), error: null, offline: true, capturedAt: SNAPSHOT_DATE }
}

const mapRequests = new Map<string, Promise<ApiResult<ParcelListResponse>>>()

/**
 * Fetches every matching parcel for the map while the ranked list stays paged.
 * The live API caps a response at 200 rows, so the remaining pages are joined
 * client-side and the completed request is cached by filters and build inputs.
 */
export function fetchParcelMap(
  q: ParcelQuery,
  signal?: AbortSignal,
): Promise<ApiResult<ParcelListResponse>> {
  const mapQuery = { ...q, page: 1, per_page: 200 }
  const key = toQueryString(mapQuery)
  const cached = signal ? undefined : mapRequests.get(key)
  if (cached) return cached

  const request = (async () => {
    const first = await fetchParcels(mapQuery, signal)
    if (first.error || !first.data) return first
    if (first.offline) {
      const { offlineParcelMap, SNAPSHOT_DATE } = await import('./parcelOffline')
      const parcels = offlineParcelMap(mapQuery)
      return {
        data: {
          county: mapQuery.county ?? 'bexar',
          total: parcels.length,
          page: 1,
          per_page: parcels.length,
          parcels,
        },
        error: null,
        offline: true,
        capturedAt: SNAPSHOT_DATE,
      }
    }

    const pageCount = Math.ceil(first.data.total / mapQuery.per_page)
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        fetchParcels({ ...mapQuery, page: index + 2 }, signal)),
    )
    const failed = rest.find(result => result.error || !result.data)
    if (failed) return {
      data: null,
      error: failed.error ?? 'Could not load all matching parcels for the map',
    }

    return {
      data: {
        ...first.data,
        per_page: first.data.total,
        parcels: [
          ...first.data.parcels,
          ...rest.flatMap(result => result.data?.parcels ?? []),
        ],
      },
      error: null,
    }
  })()

  if (!signal) {
    mapRequests.set(key, request)
    request.then(result => {
      if (result.error) mapRequests.delete(key)
    })
  }
  return request
}

export async function fetchParcel(
  id: string,
  query: Pick<ParcelQuery, 'county' | 'capacity_kw' | 'design_pue' | 'design_wue' | 'lifetime_years' | 'discount_rate' | 'revenue_per_kw_month' | 'occupancy_pct'> = {},
  signal?: AbortSignal,
): Promise<ApiResult<unknown>> {
  const detailQuery = toQueryString({
    county: query.county ?? 'bexar',
    capacity_kw: query.capacity_kw,
    design_pue: query.design_pue,
    design_wue: query.design_wue,
    lifetime_years: query.lifetime_years,
    discount_rate: query.discount_rate,
    revenue_per_kw_month: query.revenue_per_kw_month,
    occupancy_pct: query.occupancy_pct,
  })
  const r = await get<unknown>(
    `/parcels/${encodeURIComponent(id)}?${detailQuery}`,
    signal)
  if (!('unreachable' in r)) return r
  if (r.cancelled) return { data: null, error: r.message }
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
  weights: ParcelWeights
  /** Phrases the parser could not express as a filter. Always shown. */
  unparsed: string[]
  source: 'watsonx' | 'fallback'
}

export async function parseCriteria(
  text: string,
  externalSignal?: AbortSignal,
): Promise<ApiResult<CriteriaResult>> {
  const controller = new AbortController()
  let timedOut = false
  const killer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT_MS)
  const cancel = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', cancel, { once: true })

  try {
    const res = await fetch(`${API_BASE}/api/parcels/criteria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    if (!res.ok) {
      let message = `Request failed (${res.status})`
      try { const b = await res.json(); if (b?.error) message = String(b.error) } catch { /* keep */ }
      return { data: null, error: message }
    }
    return { data: (await res.json()) as CriteriaResult, error: null }
  } catch (e) {
    if (controller.signal.aborted) {
      return {
        data: null,
        error: timedOut ? 'The criteria request timed out.' : 'The criteria request was cancelled.',
      }
    }
    return { data: null, error: e instanceof Error ? e.message : 'Network error' }
  } finally {
    clearTimeout(killer)
    externalSignal?.removeEventListener('abort', cancel)
  }
}
