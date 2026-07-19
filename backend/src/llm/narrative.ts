/**
 * Narrative generation — orchestrates watsonx vs. fallback vs. cache.
 *
 * Priority order:
 *   1. Cache hit  → return cached result (source = 'cache')
 *   2. watsonx    → call Granite, cache result, return (source = 'watsonx')
 *   3. Fallback   → deterministic templates (source = 'fallback')
 *
 * The LLM is fed only the engine's computed numbers (injected via the prompt).
 * It may NOT invent figures. The fallback enforces the same constraint by
 * reading directly from EstimateOutput.
 */

import type { EstimateOutput, NarrativeResult } from '../schemas/output.js'
import { NarrativeSchema } from '../schemas/output.js'
import { watsonxConfigFromEnv, watsonxGenerate } from './client.js'
import { buildNarrativePrompt } from './prompts.js'
import { buildFallbackNarrative } from './fallback.js'
import { cacheGet, cacheSet } from './cache.js'

export interface NarrativeOptions {
  /** Skip watsonx even if env vars are present (for tests). */
  forceFallback?: boolean
  /** Skip disk cache (for tests that want a fresh call each time). */
  skipCache?: boolean
}

export async function generateNarrative(
  output: EstimateOutput,
  siteLabels: Record<string, string>,
  opts: NarrativeOptions = {},
): Promise<NarrativeResult> {
  const prompt = buildNarrativePrompt(output, siteLabels)

  // ── 1. Cache ────────────────────────────────────────────────────────────────
  if (!opts.skipCache) {
    const cached = cacheGet(prompt)
    if (cached) {
      try {
        const parsed = NarrativeSchema.parse(JSON.parse(cached))
        return { ...parsed, source: 'cache' }
      } catch {
        // Corrupt cache entry — proceed to regenerate
      }
    }
  }

  // ── 2. watsonx ──────────────────────────────────────────────────────────────
  const cfg = opts.forceFallback ? null : watsonxConfigFromEnv()
  if (cfg) {
    try {
      const raw  = await watsonxGenerate(prompt, cfg, { maxTokens: 900 })
      // Extract the JSON block — model may emit trailing text
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = NarrativeSchema.safeParse(JSON.parse(jsonMatch[0]))
        if (parsed.success) {
          const result: NarrativeResult = { ...parsed.data, source: 'watsonx' }
          if (!opts.skipCache) cacheSet(prompt, JSON.stringify(result))
          return result
        }
      }
    } catch (err) {
      // Log but don't rethrow — fall through to fallback
      console.warn('[LLM] watsonx call failed, using fallback:', (err as Error).message)
    }
  }

  // ── 3. Fallback ─────────────────────────────────────────────────────────────
  const result = buildFallbackNarrative(output, siteLabels)
  if (!opts.skipCache) cacheSet(prompt, JSON.stringify(result))
  return result
}
