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

export const API_BASE = import.meta.env.VITE_API_URL ?? ''

export interface ProvenanceItem {
  region_key: string
  driver: string
  value: number | null
  source_url: string
  last_verified: string
  basis?: 'sourced' | 'modeled' | 'assumed'
}

export interface DataGap { site_id: string; driver: string; reason: string }

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

export interface EstimateOutput {
  request_id: string
  generated_at: string
  engine_version: string
  ranking: string[]
  site_labels: Record<string, string>
  sites: Record<string, {
    rank: number
    weighted_score: number
    finance: { capex_per_kw: number; lifetime_cost_per_kw: number; npv_usd: number; payback_years: number }
  }>
  flip_sentence: string
  narrative: NarrativeResult
  data_provenance: ProvenanceItem[]
  data_gaps: DataGap[]
  confidence: Confidence
}

export interface EstimateSiteInput { site_id: string; label: string; region_key: string }

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

const SLOW_MS = 3_000
const TIMEOUT_MS = 90_000

export interface EstimateState {
  data: EstimateOutput | null
  error: string | null
  slow: boolean
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
  try {
    const res = await fetch(`${API_BASE}/api/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `The server answered ${res.status}.`)
    }
    return { data: (await res.json()) as EstimateOutput, error: null, slow: false }
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    return {
      data: null,
      slow: false,
      error: aborted
        ? 'The server did not answer in time. It may still be starting up — try again in a minute.'
        : err instanceof Error ? err.message : 'The server could not be reached.',
    }
  } finally {
    clearTimeout(killer)
    clearTimeout(slowTimer)
  }
}
