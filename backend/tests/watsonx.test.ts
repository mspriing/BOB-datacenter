/**
 * Tests for the LIVE watsonx path — the code that only runs when credentials
 * are present. global.fetch is mocked, so no network or real key is used.
 *
 * These cover the two bugs that made the live path silently fall back before:
 *   1. narrative.ts validated the model output with the full NarrativeSchema
 *      (which requires a `source` field the model never emits), so every valid
 *      Granite response was rejected. Test "returns source=watsonx" guards it.
 *   2. the client had no timeout/retry. The retry + give-up tests guard that.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runEngine } from '../src/engine/index.js'
import { generateNarrative } from '../src/llm/narrative.js'
import { _resetIAMToken } from '../src/llm/client.js'
import { _resetRegionsCache } from '../src/regions.js'
import type { EstimateOutput } from '../src/schemas/output.js'

const heroInput = {
  request_id: '00000000-0000-0000-0000-0000000000aa',
  project: { name: 'Watsonx Test', capacity_kw: 10_000, design_pue: 1.4, lifetime_years: 15, discount_rate: 0.08 },
  sites: [
    { site_id: 'nova',   label: 'Northern Virginia', region_key: 'us-va-northern'  },
    { site_id: 'ercot',  label: 'Texas ERCOT',        region_key: 'us-tx-ercot'     },
    { site_id: 'nordic', label: 'Nordic Hydro',        region_key: 'eu-nordic-hydro' },
  ],
}
const labels: Record<string, string> = { nova: 'Northern Virginia', ercot: 'Texas ERCOT', nordic: 'Nordic Hydro' }

// ── Fetch mocking helpers ─────────────────────────────────────────────────────

function response(status: number, body: unknown): Response {
  return {
    ok:     status >= 200 && status < 300,
    status,
    json:   async () => body,
    text:   async () => JSON.stringify(body),
  } as unknown as Response
}

const iamOk = () => response(200, { access_token: 'test-token', expires_in: 3600 })

/** Model output for the generation endpoint — note: NO `source` field, exactly
 *  as the prompt instructs Granite to respond. */
function graniteBody(recommendation: string): unknown {
  return {
    results: [{
      generated_text:
        `Here is the memo you requested:\n` +
        JSON.stringify({
          recommendation,
          sensitivity_callouts: heroInput.sites.map(s => ({ site_id: s.site_id, label: s.label, callout: `${s.label} driver note.` })),
          uncertainty_flags: [],
        }) +
        `\nLet me know if you need anything else.`,
    }],
  }
}

/**
 * Install a fetch mock. IAM always succeeds; each call to the generation
 * endpoint is served by the next responder (last one repeats). A responder may
 * return a Response or throw to simulate a network error.
 */
function installFetch(genResponders: Array<() => Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('iam.cloud.ibm.com')) return iamOk()
    const idx = Math.min(genCall, genResponders.length - 1)
    genCall++
    return genResponders[idx]()
  })
  let genCall = 0
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

async function engineOutput(): Promise<EstimateOutput> {
  _resetRegionsCache()
  return runEngine(heroInput, { forceFallback: true, skipCache: true })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const realFetch = global.fetch

beforeEach(() => {
  process.env.WATSONX_API_KEY    = 'test-key'
  process.env.WATSONX_PROJECT_ID = '11111111-2222-3333-4444-555555555555'
  process.env.WATSONX_TIMEOUT_MS = '5000'
  _resetIAMToken()
})

afterEach(() => {
  global.fetch = realFetch
  delete process.env.WATSONX_API_KEY
  delete process.env.WATSONX_PROJECT_ID
  delete process.env.WATSONX_TIMEOUT_MS
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('watsonx live path', () => {
  it('returns source = watsonx and uses the model recommendation (guards the source-field bug)', async () => {
    const out = await engineOutput()
    installFetch([() => response(200, graniteBody('GRANITE_RECOMMENDATION_TEXT'))])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('watsonx')
    expect(result.recommendation).toBe('GRANITE_RECOMMENDATION_TEXT')
    expect(result.sensitivity_callouts).toHaveLength(heroInput.sites.length)
  })

  it('extracts the JSON block even when the model wraps it in prose', async () => {
    const out = await engineOutput()
    installFetch([() => response(200, graniteBody('WRAPPED_IN_PROSE'))])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('watsonx')
    expect(result.recommendation).toBe('WRAPPED_IN_PROSE')
  })

  it('rejects a valid-shaped narrative containing a figure not supplied by the engine', async () => {
    const out = await engineOutput()
    installFetch([() => response(200, graniteBody('The project will save $999M.'))])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('fallback')
    expect(result.recommendation).not.toContain('$999M')
  })

  it('does not authorize a dollar claim from an unrelated project-year number', async () => {
    const out = await engineOutput()
    installFetch([() => response(200, graniteBody('This choice saves $15M.'))])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('fallback')
    expect(result.recommendation).not.toContain('$15M')
  })

  it('rejects an unsupported capacity claim even when its number appears elsewhere', async () => {
    const out = await engineOutput()
    installFetch([() => response(200, graniteBody('The facility is 1 MW.'))])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('fallback')
    expect(result.recommendation).not.toContain('1 MW')
  })

  it('does not confuse kWh claims with kW figures', async () => {
    const out = await engineOutput()
    installFetch([() => response(200, graniteBody('Annual usage is 10 kWh.'))])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('fallback')
    expect(result.recommendation).not.toContain('10 kWh')
  })

  it('retries once on a transient 500, then succeeds on watsonx', async () => {
    const out = await engineOutput()
    const fetchMock = installFetch([
      () => response(500, { error: 'server error' }),
      () => response(200, graniteBody('AFTER_RETRY')),
    ])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('watsonx')
    expect(result.recommendation).toBe('AFTER_RETRY')
    // 1 IAM (cached after first) + 2 generation attempts = 3 fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('falls back to the deterministic template when both attempts return 5xx', async () => {
    const out = await engineOutput()
    const fetchMock = installFetch([
      () => response(503, { error: 'unavailable' }),
      () => response(503, { error: 'unavailable' }),
    ])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('fallback')
    expect(result.recommendation.length).toBeGreaterThan(50)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 IAM + 2 generation attempts
  })

  it('falls back when the network call throws on both attempts', async () => {
    const out = await engineOutput()
    installFetch([
      () => { throw new Error('ECONNRESET') },
      () => { throw new Error('ECONNRESET') },
    ])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('fallback')
  })

  it('does NOT retry on a 4xx (auth/bad request) — single attempt, then fallback', async () => {
    const out = await engineOutput()
    const fetchMock = installFetch([
      () => response(401, { error: 'unauthorized' }),
      () => response(200, graniteBody('SHOULD_NOT_REACH')),
    ])

    const result = await generateNarrative(out, labels, { skipCache: true })

    expect(result.source).toBe('fallback')
    // 1 IAM + exactly 1 generation attempt (no retry on 401) = 2 calls
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
