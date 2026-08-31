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
import { z } from 'zod'

/** Granite returns the narrative body WITHOUT a `source` field — we add it. */
const NarrativeModelSchema = NarrativeSchema.omit({ source: true })

function numericTokens(text: string): string[] {
  return (text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((token) => token.replace(/,/g, '').replace(/^-/, ''))
}

const UNIT_CLAIM_PATTERNS = [
  /\$\s*\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand|[MBK])?(?:\/kWh|\/kW)?/gi,
  /\d[\d,]*(?:\.\d+)?\s*%/g,
  /\d[\d,]*(?:\.\d+)?\s*(?:-| )?years?/gi,
  /\d[\d,]*(?:\.\d+)?\s*ms/gi,
  /\d[\d,]*(?:\.\d+)?\s*\/10/g,
  /\d[\d,]*(?:\.\d+)?\s*(?:kWh|kW|MW|kgal|acres?)\b/gi,
  /\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand)/gi,
]

function normalizeClaim(claim: string): string {
  return claim.toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/million/g, 'm')
    .replace(/billion/g, 'b')
    .replace(/thousand/g, 'k')
}

function unitClaims(text: string): string[] {
  return UNIT_CLAIM_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => normalizeClaim(match[0])))
}

function numbersAreGrounded(
  narrative: z.infer<typeof NarrativeModelSchema>,
  prompt: string,
): boolean {
  const allowed = new Set(numericTokens(prompt))
  const prose = [
    narrative.recommendation,
    ...narrative.sensitivity_callouts.flatMap((item) => [item.label, item.callout]),
    ...narrative.uncertainty_flags.flatMap((item) => [item.field, item.reason]),
  ].join('\n')
  const allowedClaims = new Set(unitClaims(prompt))
  return unitClaims(prose).every((claim) => allowedClaims.has(claim))
    && numericTokens(prose).every((token) => allowed.has(token))
}

export interface NarrativeOptions {
  /** Skip watsonx even if env vars are present (for tests). */
  forceFallback?: boolean
  /** Skip disk cache (for tests that want a fresh call each time). */
  skipCache?: boolean
  /** Submitted site ID keyed by canonical region key, for user-facing flags. */
  siteIdByRegion?: Record<string, string>
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
        const body = NarrativeModelSchema.parse(parsed)
        if (parsed.source === 'fallback' || numbersAreGrounded(body, prompt)) {
          return {
            ...parsed,
            uncertainty_flags: parsed.uncertainty_flags.map(flag => ({
              ...flag,
              site_id: opts.siteIdByRegion?.[flag.site_id] ?? flag.site_id,
            })),
            source: 'cache',
          }
        }
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
        // The prompt asks Granite for {recommendation, sensitivity_callouts,
        // uncertainty_flags} WITHOUT a `source` field, so validate against the
        // schema minus `source` and stamp source='watsonx' ourselves. (Parsing
        // with the full NarrativeSchema would reject every valid model response.)
        const parsed = NarrativeModelSchema.safeParse(JSON.parse(jsonMatch[0]))
        if (parsed.success && numbersAreGrounded(parsed.data, prompt)) {
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
  const result = buildFallbackNarrative(output, siteLabels, opts.siteIdByRegion)
  if (!opts.skipCache) cacheSet(prompt, JSON.stringify(result))
  return result
}
