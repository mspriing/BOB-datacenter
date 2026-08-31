/**
 * The seam between this interface and the deterministic backend engine.
 *
 * The client engine in lib/engine.ts exists so the projection sliders re-rank
 * instantly with no network round trip. It is a mirror of the server, not a
 * replacement for it. Anything the user is asked to trust as a published fact —
 * the provenance of every driver, the recorded gaps, the confidence counts and
 * the written recommendation — comes from this module, which is to say from the
 * server, or it is not shown at all.
 */

function normalizeApiBase(value: string | undefined): string {
  const base = value?.trim().replace(/\/+$/, '') ?? ''
  if (!base || /^https?:\/\//i.test(base)) return base
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)) return `http://${base}`
  return `https://${base}`
}

export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL)

export interface ProvenanceItem {
  region_key: string
  driver: string
  value: number | null
  source_url: string
  last_verified: string
  basis?: 'sourced' | 'modeled' | 'assumed'
  method?: string
}

export interface DataGap { site_id: string; driver: string; reason: string }
export interface UnevaluableSite {
  site_id: string
  label: string
  missing_drivers: string[]
}

export interface Assumption {
  key: string
  label: string
  value: number
  unit: string
  basis: 'sourced' | 'modeled' | 'assumed'
  source_url: string
  last_verified: string
  method: string
}

export interface Confidence {
  sourced: number
  modeled: number
  assumed: number
  missing: number
}

export interface NarrativeResult {
  recommendation: string
  sensitivity_callouts: Array<{ site_id: string; label: string; callout: string }>
  uncertainty_flags: Array<{ site_id: string; field: string; reason: string }>
  source: 'watsonx' | 'fallback' | 'cache'
}

export interface FinanceOutput {
  capex_per_kw: number
  lifetime_cost_per_kw: number
  npv_usd: number
  lifetime_years: number
  /** Required by the response schema and always null for this cost-only model. */
  payback_years: null
  ranges: Record<'low' | 'base' | 'high', {
    npv_usd: number
    lifetime_per_kw: number
  }>
}

export interface EstimateOutput {
  request_id: string
  generated_at: string
  engine_version: string
  ranking: string[]
  site_labels: Record<string, string>
  sites: Record<string, {
    rank: number
    weighted_score: number
    capex: {
      land_usd: number
      construction_usd: number
      electrical_usd: number
      cooling_usd: number
      it_fitout_usd: number
      total_usd: number
    }
    opex_annual: {
      power_usd: number
      water_usd: number
      staff_usd: number
      maintenance_usd: number
      taxes_usd: number
      connectivity_usd: number
      total_usd: number
    }
    finance: FinanceOutput
    non_cost_scores: {
      risk_score: number | null
      renewable_pct: number | null
      low_carbon_pct: number | null
      latency_ms: number | null
      grid_interconnection_years: number | null
    }
  }>
  sensitivity: Array<{
    driver: string
    current_value: number
    flip_value: number
    pct_change: number | null
    absolute_change?: number
    affected_sites: string[]
    stable?: boolean
  }>
  flip_sentence: string
  narrative: NarrativeResult
  parsed_fields: Array<{
    site_id: string
    field: string
    value: number
    inferred: boolean
  }>
  data_provenance: ProvenanceItem[]
  data_gaps: DataGap[]
  unevaluable: UnevaluableSite[]
  confidence: Confidence
  assumptions: Assumption[]
}

export interface EstimateSiteInput {
  site_id: string
  label: string
  region_key: string
  free_text?: string | null
}

export interface EstimateRequest {
  project: {
    name: string
    capacity_kw: number
    design_pue: number
    design_wue?: number
    lifetime_years: number
    discount_rate: number
    weights?: { total_cost?: number; risk?: number; sustainability?: number; latency?: number }
  }
  sites: EstimateSiteInput[]
}

export type EstimateProject = Omit<EstimateRequest['project'], 'weights'>
export type SiteSetup = Record<string, { label: string; free_text: string }>

const SLOW_MS = 3_000
const TIMEOUT_MS = 120_000

let warmStarted = false

/** Start waking the free-tier service before the reader submits a comparison. */
export function warmApi(): void {
  if (warmStarted) return
  warmStarted = true
  void fetch(`${API_BASE}/api/health`).catch(() => undefined)
}

export interface EstimateState {
  data: EstimateOutput | null
  error: string | null
  slow: boolean
  retryable: boolean
}

/**
 * Free-tier Render sleeps after about fifteen minutes idle and takes roughly
 * fifty seconds to wake. `onSlow` fires at three seconds so the interface can
 * say that out loud rather than appear frozen.
 */
export async function fetchEstimate(
  req: EstimateRequest,
  onSlow?: () => void,
): Promise<EstimateState> {
  const controller = new AbortController()
  const killer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const slowTimer = setTimeout(() => onSlow?.(), SLOW_MS)
  let retryable = true
  try {
    const res = await fetch(`${API_BASE}/api/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    if (!res.ok) {
      retryable = res.status === 408 || res.status === 429 || res.status >= 500
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `The server answered ${res.status}.`)
    }
    return {
      data: (await res.json()) as EstimateOutput,
      error: null,
      slow: false,
      retryable: false,
    }
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    return {
      data: null,
      slow: false,
      retryable,
      error: aborted
        ? 'The server did not answer in time. It may still be starting up — try again in a minute.'
        : err instanceof Error ? err.message : 'The server could not be reached.',
    }
  } finally {
    clearTimeout(killer)
    clearTimeout(slowTimer)
  }
}
