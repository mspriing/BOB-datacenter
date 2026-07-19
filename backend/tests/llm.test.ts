/**
 * Tests for the LLM narrative layer — fallback path only.
 * No watsonx credentials are needed; forceFallback:true is always set.
 * Cache is bypassed with skipCache:true to get deterministic results.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { buildFallbackNarrative } from '../src/llm/fallback.js'
import { generateNarrative }      from '../src/llm/narrative.js'
import { cacheGet, cacheSet, cacheKey } from '../src/llm/cache.js'
import { buildNarrativePrompt }   from '../src/llm/prompts.js'
import { parseSiteDescription }   from '../src/llm/parseInput.js'
import { runEngine }              from '../src/engine/index.js'
import { _resetRegionsCache }     from '../src/regions.js'
import type { EstimateOutput }    from '../src/schemas/output.js'

// ── Shared fixture ────────────────────────────────────────────────────────────

const heroInput = {
  request_id: '00000000-0000-0000-0000-000000000099',
  project: {
    name: 'Narrative Test',
    capacity_kw: 10_000,
    design_pue: 1.4,
    lifetime_years: 15,
    discount_rate: 0.08,
  },
  sites: [
    { site_id: 'nova',   label: 'Northern Virginia', region_key: 'us-va-northern'  },
    { site_id: 'ercot',  label: 'Texas ERCOT',        region_key: 'us-tx-ercot'     },
    { site_id: 'nordic', label: 'Nordic Hydro',        region_key: 'eu-nordic-hydro' },
  ],
}

const siteLabels: Record<string, string> = {
  nova:   'Northern Virginia',
  ercot:  'Texas ERCOT',
  nordic: 'Nordic Hydro',
}

// We compute the engine output once per describe block
async function getOutput(): Promise<EstimateOutput> {
  _resetRegionsCache()
  return runEngine(heroInput, { forceFallback: true, skipCache: true })
}

// ── buildFallbackNarrative ────────────────────────────────────────────────────
describe('buildFallbackNarrative', () => {
  it('returns source = fallback', async () => {
    const out    = await getOutput()
    const result = buildFallbackNarrative(out, siteLabels)
    expect(result.source).toBe('fallback')
  })

  it('recommendation cites the rank-1 site label', async () => {
    const out    = await getOutput()
    const result = buildFallbackNarrative(out, siteLabels)
    const rank1Label = siteLabels[out.ranking[0]]
    expect(result.recommendation).toContain(rank1Label)
  })

  it('recommendation contains total CapEx figure', async () => {
    const out    = await getOutput()
    const rank1  = out.sites[out.ranking[0]]
    const result = buildFallbackNarrative(out, siteLabels)
    // CapEx is in the hundreds-of-millions range; check the $M suffix appears
    expect(result.recommendation).toMatch(/\$[\d.]+M/)
  })

  it('recommendation contains the flip sentence', async () => {
    const out    = await getOutput()
    const result = buildFallbackNarrative(out, siteLabels)
    // flip_sentence text should appear verbatim in the recommendation
    expect(result.recommendation).toContain(out.flip_sentence)
  })

  it('produces one sensitivity callout per site', async () => {
    const out    = await getOutput()
    const result = buildFallbackNarrative(out, siteLabels)
    expect(result.sensitivity_callouts).toHaveLength(out.ranking.length)
    for (const c of result.sensitivity_callouts) {
      expect(c.callout.length).toBeGreaterThan(20)
      expect(typeof c.site_id).toBe('string')
    }
  })

  it('uncertainty_flags is an array', async () => {
    const out    = await getOutput()
    const result = buildFallbackNarrative(out, siteLabels)
    expect(Array.isArray(result.uncertainty_flags)).toBe(true)
  })

  it('no invented numbers — recommendation mentions only figures already in output', async () => {
    const out    = await getOutput()
    const result = buildFallbackNarrative(out, siteLabels)
    // Extract all dollar amounts from the recommendation
    const dollarRE = /\$([\d.]+)([MBK]?)/g
    const mentioned: number[] = []
    let m: RegExpExecArray | null
    while ((m = dollarRE.exec(result.recommendation)) !== null) {
      const raw = parseFloat(m[1])
      const mult = m[2] === 'B' ? 1e9 : m[2] === 'M' ? 1e6 : m[2] === 'K' ? 1e3 : 1
      mentioned.push(raw * mult)
    }
    // Each mentioned figure must be traceable to an engine number (within 2%)
    const rank1 = out.sites[out.ranking[0]]
    const rank2 = out.sites[out.ranking[1]]
    const engineNumbers = [
      Math.abs(rank1.capex.total_usd),
      Math.abs(rank1.opex_annual.total_usd),
      Math.abs(rank1.finance.npv_usd),
      rank1.finance.levelized_cost_per_kw,
      rank1.finance.ranges.low.levelized_per_kw,
      rank1.finance.ranges.high.levelized_per_kw,
      Math.abs(rank2.finance.levelized_cost_per_kw),
      // Sensitivity flip values are real engine numbers and appear in flip_sentence
      ...out.sensitivity.flatMap(s => [s.current_value, s.flip_value]),
    ]
    for (const fig of mentioned) {
      const match = engineNumbers.some(n => Math.abs(n - fig) / (Math.abs(n) || 1) < 0.02)
      expect(match, `Unexpected figure $${fig.toLocaleString()} in recommendation`).toBe(true)
    }
  })
})

// ── generateNarrative (fallback path) ────────────────────────────────────────
describe('generateNarrative (fallback path)', () => {
  it('returns source = fallback when forceFallback:true', async () => {
    const out    = await getOutput()
    const result = await generateNarrative(out, siteLabels, { forceFallback: true, skipCache: true })
    expect(result.source).toBe('fallback')
  })

  it('recommendation is non-empty', async () => {
    const out    = await getOutput()
    const result = await generateNarrative(out, siteLabels, { forceFallback: true, skipCache: true })
    expect(result.recommendation.length).toBeGreaterThan(50)
  })

  it('sensitivity_callouts count equals number of sites', async () => {
    const out    = await getOutput()
    const result = await generateNarrative(out, siteLabels, { forceFallback: true, skipCache: true })
    expect(result.sensitivity_callouts).toHaveLength(heroInput.sites.length)
  })
})

// ── Cache ─────────────────────────────────────────────────────────────────────
describe('LLM cache', () => {
  it('round-trips a string value', () => {
    const prompt = `test-prompt-${Date.now()}`
    expect(cacheGet(prompt)).toBeNull()
    cacheSet(prompt, 'hello world')
    expect(cacheGet(prompt)).toBe('hello world')
  })

  it('cache key is deterministic', () => {
    const p = 'my-prompt'
    expect(cacheKey(p)).toBe(cacheKey(p))
  })

  it('generateNarrative writes to cache', async () => {
    const out    = await getOutput()
    const prompt = buildNarrativePrompt(out, siteLabels)
    // Remove any existing cache entry for this prompt
    const key = cacheKey(prompt)
    const fs   = await import('fs')
    const path = await import('path')
    const cacheFile = path.resolve(process.cwd(), '.bob', 'llm-cache', `${key}.json`)
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile)

    // Generate — should write cache
    await generateNarrative(out, siteLabels, { forceFallback: true })
    expect(fs.existsSync(cacheFile)).toBe(true)
  })

  it('generateNarrative returns source = cache on second call', async () => {
    const out    = await getOutput()
    // First call writes cache
    await generateNarrative(out, siteLabels, { forceFallback: true })
    // Second call (no skipCache) should hit the cache
    const result = await generateNarrative(out, siteLabels, { forceFallback: true })
    expect(result.source).toBe('cache')
  })
})

// ── Prompt builder ────────────────────────────────────────────────────────────
describe('buildNarrativePrompt', () => {
  it('injects all site IDs into the prompt', async () => {
    const out    = await getOutput()
    const prompt = buildNarrativePrompt(out, siteLabels)
    for (const sid of out.ranking) {
      expect(prompt).toContain(sid)
    }
  })

  it('includes the flip sentence', async () => {
    const out    = await getOutput()
    const prompt = buildNarrativePrompt(out, siteLabels)
    expect(prompt).toContain(out.flip_sentence)
  })

  it('contains STRICT RULES section', async () => {
    const out    = await getOutput()
    const prompt = buildNarrativePrompt(out, siteLabels)
    expect(prompt).toContain('STRICT RULES')
  })
})

// ── parseSiteDescription (regex fallback) ────────────────────────────────────
describe('parseSiteDescription (regex fallback)', () => {
  it('extracts power rate from text', async () => {
    const result = await parseSiteDescription(
      'Greenfield site near I-10 with power at $0.041/kWh from APS',
      { forceFallback: true },
    )
    expect(result.overrides.power_rate_usd_per_kwh).toBeCloseTo(0.041, 3)
  })

  it('extracts land cost per acre', async () => {
    const result = await parseSiteDescription(
      '40-acre parcel available at $75,000/acre in West Phoenix',
      { forceFallback: true },
    )
    expect(result.overrides.land_cost_per_acre_usd).toBe(75_000)
  })

  it('extracts renewable percentage', async () => {
    const result = await parseSiteDescription(
      'Grid is 68% renewable via PPAs with local wind farms',
      { forceFallback: true },
    )
    expect(result.overrides.renewable_pct).toBeCloseTo(0.68, 2)
  })

  it('extracts latency', async () => {
    const result = await parseSiteDescription(
      'Network hub reachable in 12ms from this location',
      { forceFallback: true },
    )
    expect(result.overrides.latency_ms_to_hub).toBe(12)
  })

  it('extracts incentive with M suffix', async () => {
    const result = await parseSiteDescription(
      'State incentive of $2.5M available for qualifying data centers',
      { forceFallback: true },
    )
    expect(result.overrides.incentive_usd).toBe(2_500_000)
  })

  it('returns empty overrides for unrecognized text', async () => {
    const result = await parseSiteDescription(
      'Nice place to build a facility',
      { forceFallback: true },
    )
    const overrides = result.overrides
    expect(Object.values(overrides).every(v => v == null)).toBe(true)
  })
})

// ── End-to-end: runEngine includes narrative ──────────────────────────────────
describe('runEngine narrative integration', () => {
  beforeEach(() => { _resetRegionsCache() })

  it('output.narrative.source is fallback when no LLM credentials', async () => {
    const out = await runEngine(heroInput, { forceFallback: true, skipCache: true })
    expect(out.narrative.source).toBe('fallback')
  })

  it('output.narrative.recommendation is non-empty', async () => {
    const out = await runEngine(heroInput, { forceFallback: true, skipCache: true })
    expect(out.narrative.recommendation.length).toBeGreaterThan(50)
  })

  it('output.narrative has correct number of sensitivity_callouts', async () => {
    const out = await runEngine(heroInput, { forceFallback: true, skipCache: true })
    expect(out.narrative.sensitivity_callouts).toHaveLength(heroInput.sites.length)
  })

  it('output.narrative.uncertainty_flags is an array', async () => {
    const out = await runEngine(heroInput, { forceFallback: true, skipCache: true })
    expect(Array.isArray(out.narrative.uncertainty_flags)).toBe(true)
  })
})
