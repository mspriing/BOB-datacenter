/**
 * backend/src/llm/parseCriteria.ts
 *
 * Turns a sentence into parcel filters and ranking weights.
 *
 * The model never produces a number that reaches the maths. It proposes filter
 * values; every one is validated against the real filter vocabulary and dropped
 * if it is not in it — a filter the model invented is worse than one it missed,
 * because a missed one shows up in `unparsed` and an invented one silently
 * changes the result set.
 *
 * The deterministic matcher is the primary path, not a safety net. watsonx
 * credentials are disabled, so this is what will actually run.
 */

import { watsonxConfigFromEnv, watsonxGenerate } from './client.js'
import { buildParseCriteriaPrompt } from './prompts.js'

// ── Public types ───────────────────────────────────────────────────────────────

export interface ParsedFilters {
  min_acres?:              number
  max_acres?:              number
  max_land_cost_per_acre?: number
  max_dist_tx_m?:          number
  exclude_flood?:          boolean
}

export interface ParsedWeights {
  total_cost?:     number
  risk?:           number
  sustainability?: number
  latency?:        number
}

export interface CriteriaResult {
  filters:  ParsedFilters
  weights:  ParsedWeights
  /** Phrases the parser could not turn into a filter. Never omitted. */
  unparsed: string[]
  source:   'watsonx' | 'fallback'
}

/** The only filter keys that may reach the API. Anything else is dropped. */
const FILTER_KEYS = new Set<keyof ParsedFilters>([
  'min_acres', 'max_acres', 'max_land_cost_per_acre', 'max_dist_tx_m', 'exclude_flood',
])

const WEIGHT_KEYS = new Set<keyof ParsedWeights>([
  'total_cost', 'risk', 'sustainability', 'latency',
])

// ── Unit helpers ───────────────────────────────────────────────────────────────

const MILES_TO_M = 1609.344

/** "1.5k", "20,000", "2 million" → number. Returns null when it is not a number. */
function toNumber(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, '').replace(/^\$/, '')
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(k|m|million|thousand)?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  switch (m[2]) {
    case 'k': case 'thousand': return n * 1_000
    case 'm': case 'million':  return n * 1_000_000
    default:                   return n
  }
}

// ── Deterministic matcher ──────────────────────────────────────────────────────

interface Rule {
  /** Named so an unmatched clause can say which idea it failed to place. */
  name: string
  re: RegExp
  apply: (m: RegExpMatchArray, f: ParsedFilters, w: ParsedWeights) => boolean
}

const RULES: Rule[] = [
  {
    name: 'minimum acreage',
    re: /(?:at least|min(?:imum)?|over|more than|bigger than|larger than|>=?)\s*([\d.,]+k?)\s*(?:\+\s*)?acres?/i,
    apply: (m, f) => { const n = toNumber(m[1]); if (n === null) return false; f.min_acres = n; return true },
  },
  {
    name: 'minimum acreage, suffix form',
    re: /([\d.,]+k?)\s*\+\s*acres?/i,
    apply: (m, f) => { const n = toNumber(m[1]); if (n === null) return false; f.min_acres = n; return true },
  },
  {
    name: 'maximum acreage',
    re: /(?:at most|max(?:imum)?|under|less than|smaller than|no more than|<=?)\s*([\d.,]+k?)\s*acres?/i,
    apply: (m, f) => { const n = toNumber(m[1]); if (n === null) return false; f.max_acres = n; return true },
  },
  {
    name: 'land price ceiling',
    re: /(?:under|below|less than|at most|max(?:imum)?|no more than|cheaper than|<=?)\s*\$?\s*([\d.,]+\s*(?:k|m|million|thousand)?)\s*(?:dollars?\s*)?(?:per|an?|\/)\s*acre/i,
    apply: (m, f) => { const n = toNumber(m[1]); if (n === null) return false; f.max_land_cost_per_acre = n; return true },
  },
  {
    name: 'distance to transmission',
    re: /within\s*([\d.,]+)\s*(km|kilometou?res?|kilometers?|mi|miles?|m\b|met(?:er|re)s?)\s*(?:of|from|to)?\s*(?:the\s*)?(?:transmission|power|grid|substation|high[- ]voltage|hv\b)/i,
    apply: (m, f) => {
      const n = toNumber(m[1])
      if (n === null) return false
      const unit = m[2].toLowerCase()
      f.max_dist_tx_m = unit.startsWith('mi') ? n * MILES_TO_M
        : unit.startsWith('k')                ? n * 1_000
        : n
      return true
    },
  },
  {
    name: 'flood exclusion',
    re: /\b(?:no|avoid|without|exclude|outside|not in)\b[^.,;]{0,24}\bflood/i,
    apply: (_m, f) => { f.exclude_flood = true; return true },
  },
  {
    name: 'cost emphasis',
    re: /\b(?:cheapest|lowest cost|cost is (?:the )?most important|prioriti[sz]e cost|budget[- ]driven|as cheap as possible)\b/i,
    apply: (_m, _f, w) => { w.total_cost = 0.70; w.risk = 0.10; w.sustainability = 0.10; w.latency = 0.10; return true },
  },
  {
    name: 'latency emphasis',
    re: /\b(?:low latency|close to users?|latency matters|near(?:est)? (?:the )?hub|proximity to users?)\b/i,
    apply: (_m, _f, w) => { w.total_cost = 0.35; w.risk = 0.15; w.sustainability = 0.15; w.latency = 0.35; return true },
  },
  {
    name: 'clean power emphasis',
    re: /\b(?:renewable|clean power|green|low[- ]carbon|sustainab(?:le|ility))\b/i,
    apply: (_m, _f, w) => { w.total_cost = 0.35; w.risk = 0.15; w.sustainability = 0.35; w.latency = 0.15; return true },
  },
  {
    name: 'risk emphasis',
    re: /\b(?:low risk|avoid hazard|hazard[- ]free|safe from|seismically? (?:stable|quiet)|storm[- ]safe)\b/i,
    apply: (_m, _f, w) => { w.total_cost = 0.35; w.risk = 0.35; w.sustainability = 0.15; w.latency = 0.15; return true },
  },
]

/**
 * Split on clause boundaries so an unmatched idea can be reported on its own
 * rather than swallowing the whole sentence into `unparsed`.
 */
function clauses(text: string): string[] {
  return text
    .split(/[.,;\n]|\band\b|\bwith\b|\bbut\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 2)
}

export function parseCriteriaFallback(text: string): CriteriaResult {
  const filters: ParsedFilters = {}
  const weights: ParsedWeights = {}
  const unparsed: string[] = []

  for (const clause of clauses(text)) {
    let matched = false
    // Every rule gets a look. One clause routinely carries several criteria —
    // "at least 100 acres within 2 km of transmission" is two — and stopping at
    // the first match silently dropped the rest.
    for (const rule of RULES) {
      const m = clause.match(rule.re)
      if (m && rule.apply(m, filters, weights)) matched = true
    }
    // A clause carrying no number and no keyword is usually connective text
    // rather than a criterion the reader expects to see honoured.
    if (!matched && /\d|acre|flood|transmission|grid|cost|risk|renewable|latency|water|zoning|fiber|fibre/i.test(clause)) {
      unparsed.push(clause)
    }
  }

  return { filters, weights, unparsed, source: 'fallback' }
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Keep only keys in the vocabulary, with finite non-negative values. Anything
 * else is dropped and named, so an invented filter becomes a visible omission
 * rather than a silent change to the result set.
 */
export function validateParsed(raw: unknown): { filters: ParsedFilters; weights: ParsedWeights; rejected: string[] } {
  const filters: ParsedFilters = {}
  const weights: ParsedWeights = {}
  const rejected: string[] = []

  const obj = (raw ?? {}) as Record<string, unknown>
  const rawFilters = (obj.filters ?? {}) as Record<string, unknown>
  const rawWeights = (obj.weights ?? {}) as Record<string, unknown>

  for (const [k, v] of Object.entries(rawFilters)) {
    if (!FILTER_KEYS.has(k as keyof ParsedFilters)) { rejected.push(k); continue }
    if (k === 'exclude_flood') {
      if (typeof v === 'boolean') filters.exclude_flood = v
      else rejected.push(k)
      continue
    }
    const n = typeof v === 'number' ? v : toNumber(String(v))
    if (n === null || !Number.isFinite(n) || n < 0) { rejected.push(k); continue }
    ;(filters as Record<string, number>)[k] = n
  }

  for (const [k, v] of Object.entries(rawWeights)) {
    if (!WEIGHT_KEYS.has(k as keyof ParsedWeights)) { rejected.push(k); continue }
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 1) { rejected.push(k); continue }
    ;(weights as Record<string, number>)[k] = n
  }

  return { filters, weights, rejected }
}

// ── Public entry ──────────────────────────────────────────────────────────────

export interface ParseCriteriaOptions { forceFallback?: boolean }

export async function parseCriteria(
  text: string,
  opts: ParseCriteriaOptions = {},
): Promise<CriteriaResult> {
  const deterministic = parseCriteriaFallback(text)

  const cfg = opts.forceFallback ? null : watsonxConfigFromEnv()
  if (!cfg) return deterministic

  try {
    const prompt = buildParseCriteriaPrompt(text, [...FILTER_KEYS], [...WEIGHT_KEYS])
    const raw    = await watsonxGenerate(prompt, cfg, { maxTokens: 400 })
    const json   = raw.match(/\{[\s\S]*\}/)
    if (!json) return deterministic

    const parsed = JSON.parse(json[0]) as Record<string, unknown>
    const { filters, weights, rejected } = validateParsed(parsed)

    // Nothing usable survived validation — the deterministic read is better than
    // an empty one.
    if (Object.keys(filters).length === 0 && Object.keys(weights).length === 0) {
      return deterministic
    }

    const modelUnparsed = Array.isArray(parsed.unparsed)
      ? parsed.unparsed.filter((u): u is string => typeof u === 'string')
      : []

    return {
      filters,
      weights,
      unparsed: [...new Set([...modelUnparsed, ...rejected])],
      source: 'watsonx',
    }
  } catch (e) {
    console.warn('[LLM] criteria parse failed, using deterministic matcher:',
      e instanceof Error ? e.message : e)
    return deterministic
  }
}
