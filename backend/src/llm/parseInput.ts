/**
 * Free-text site description parser.
 *
 * Takes a natural-language description of a candidate site and extracts
 * structured fields that map to our input schema's `overrides` object.
 *
 * Behaviour:
 *   - If watsonx is configured, uses Granite to extract fields.
 *   - Falls back to a regex-based extractor that catches common patterns.
 *   - Returns `inferred_fields[]` naming any field not directly stated.
 */

import { watsonxConfigFromEnv, watsonxGenerate } from './client.js'
import { buildParseInputPrompt } from './prompts.js'
import { loadRegions } from '../regions.js'

export interface ParsedSiteInput {
  region_key?:      string | null
  label?:           string | null
  inferred_fields:  string[]
  overrides: {
    land_cost_per_acre_usd?:    number | null
    construction_cost_per_kw?:  number | null
    power_rate_usd_per_kwh?:    number | null
    water_rate_usd_per_kgal?:   number | null
    staff_cost_index?:           number | null
    tax_rate?:                   number | null
    incentive_usd?:              number | null
    /** Years of property-tax abatement negotiated with the jurisdiction. User-supplied only. */
    tax_abatement_years?:        number | null
    risk_score?:                 number | null
    renewable_pct?:              number | null
    latency_ms_to_hub?:          number | null
  }
}

// ── Regex-based fallback extractor ────────────────────────────────────────────

const POWER_RE   = /\$?([\d.]+)\s*(?:\/|\s*per\s*)kWh/i
const LAND_RE    = /\$?([\d,]+)\s*(?:\/|\s*per\s*)acre/i
const INCENTIVE_RE = /(?:incentive|grant|funding)[^$\d]*\$\s*([\d,.]+)\s*([MKB]?)/i
const RENEWABLE_RE = /(\d+)\s*%\s*(?:renewable|green|clean)/i
const LATENCY_RE = /(\d+)\s*ms/i
const CONSTRUCT_RE = /\$?([\d,]+)\s*(?:\/|\s*per\s*)kW\s*(?:construction|build|shell)/i
// Matches "five year abatement", "10-year tax holiday", "5 year abatement", "ten-year abatement"
const ABATEMENT_RE = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[-–]?\s*year\s+(?:tax[-\s]?)?(?:abatement|holiday|break|exemption)/i
const WORD_TO_NUM: Record<string, number> = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 }

function multiplier(suffix: string): number {
  if (suffix.toUpperCase() === 'M') return 1_000_000
  if (suffix.toUpperCase() === 'B') return 1_000_000_000
  if (suffix.toUpperCase() === 'K') return 1_000
  return 1
}

function regexExtract(text: string, exclude: Set<string> = new Set()): ParsedSiteInput {
  const overrides: ParsedSiteInput['overrides'] = {}
  const inferred: string[] = []

  const power = POWER_RE.exec(text)
  if (power) overrides.power_rate_usd_per_kwh = parseFloat(power[1])

  const land = LAND_RE.exec(text)
  if (land) overrides.land_cost_per_acre_usd = parseFloat(land[1].replace(/,/g, ''))

  const incentive = INCENTIVE_RE.exec(text)
  if (incentive) {
    overrides.incentive_usd = parseFloat(incentive[1].replace(/,/g, '')) * multiplier(incentive[2])
  }

  const renewable = RENEWABLE_RE.exec(text)
  if (renewable) overrides.renewable_pct = parseInt(renewable[1], 10) / 100

  const latency = LATENCY_RE.exec(text)
  if (latency) overrides.latency_ms_to_hub = parseInt(latency[1], 10)

  const construct = CONSTRUCT_RE.exec(text)
  if (construct) overrides.construction_cost_per_kw = parseFloat(construct[1].replace(/,/g, ''))

  const abatement = ABATEMENT_RE.exec(text)
  if (abatement) {
    const raw = abatement[1].toLowerCase()
    overrides.tax_abatement_years = WORD_TO_NUM[raw] ?? parseInt(raw, 10)
  }

  // Try to match region_key by label substring.
  //
  // Longest match wins rather than first match. Object key order is arbitrary,
  // so first-wins meant "Texas" could bind to whichever Texas region happened
  // to be enumerated first instead of the one actually named.
  //
  // Anything in `exclude` is skipped: a region already in the candidate set
  // must not be matched again, or the run ends up comparing a site to itself.
  let region_key: string | null = null
  try {
    const regions = loadRegions()
    const haystack = text.toLowerCase()
    let bestLen = 0
    for (const [key, region] of Object.entries(regions)) {
      if (exclude.has(key)) continue
      const label = region.label.toLowerCase()
      if (label.length > bestLen && haystack.includes(label)) {
        region_key = key
        bestLen = label.length
      }
    }
    if (region_key) inferred.push('region_key')
  } catch { /* regions may not be available in all test contexts */ }

  return { region_key, label: null, inferred_fields: inferred, overrides }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseSiteDescription(
  freeText: string,
  opts: { forceFallback?: boolean; excludeRegionKeys?: readonly string[] } = {},
): Promise<ParsedSiteInput> {
  // Region keys already taken by other sites in this request. The model is not
  // offered them, and a key that comes back anyway is discarded rather than
  // used, which is what stopped one site being compared against itself.
  const exclude = new Set(opts.excludeRegionKeys ?? [])
  const cfg = opts.forceFallback ? null : watsonxConfigFromEnv()

  if (cfg) {
    try {
      const knownKeys = Object.keys(loadRegions()).filter((k) => !exclude.has(k))
      const prompt    = buildParseInputPrompt(freeText, knownKeys)
      const raw       = await watsonxGenerate(prompt, cfg, { maxTokens: 400 })
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ParsedSiteInput
        if (parsed.overrides) {
          // Drop a hallucinated or duplicate region rather than trusting it.
          if (parsed.region_key && exclude.has(parsed.region_key)) {
            parsed.region_key = null
            parsed.inferred_fields = (parsed.inferred_fields ?? [])
              .filter((f) => f !== 'region_key')
          }
          return parsed
        }
      }
    } catch (err) {
      console.warn('[LLM] parseInput watsonx failed, using regex:', (err as Error).message)
    }
  }

  return regexExtract(freeText, exclude)
}
