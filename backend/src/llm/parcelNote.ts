/**
 * backend/src/llm/parcelNote.ts
 *
 * A two-to-three sentence note about one parcel.
 *
 * Scope, fixed by the product owner: the note is written from the driver data
 * and its provenance, never from the parcel's identity. No prose about owners,
 * neighborhoods, or what a site "feels like" — the model has no basis for any
 * of that, and inventing it would undermine every honest figure beside it.
 *
 * Every number in the prose is quoted from the estimate. The model is not
 * permitted to compute one, and a note whose numbers do not all appear in the
 * estimate is rejected in favour of the deterministic text.
 *
 * Generated on demand for the parcel being viewed. Never batched: 3,040
 * generations per ingest would be expensive and pointless.
 */

import { watsonxConfigFromEnv, watsonxGenerate } from './client.js'
import { cacheGet, cacheSet } from './cache.js'
import type { ParcelEstimate } from '../parcel/score.js'

export interface ParcelNote {
  text:   string
  source: 'watsonx' | 'fallback' | 'cache'
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** Large totals, abbreviated. */
const usd = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${Math.round(a / 1e3)}K`
  return `$${Math.round(a)}`
}

/**
 * Per-kW figures in full dollars. Abbreviating $19,733 to "$20K" throws away
 * precision exactly where a reader is comparing sites against each other.
 */
const usdExact = (n: number): string => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`

/** Which capital line dominates, so the note leads with what actually drives the number. */
function dominantCost(e: ParcelEstimate): { name: string; value: number; share: number } {
  const items = [
    { name: 'land',                        value: e.capex.land_usd },
    { name: 'construction',                value: e.capex.construction_usd },
    { name: 'reaching the transmission line', value: e.parcel_capex.interconnect_capex_usd },
    { name: 'leveling the ground',        value: e.parcel_capex.sitework_usd },
    { name: 'entitlement carrying cost',   value: e.parcel_capex.entitlement_cost_usd },
    { name: 'reaching fiber',              value: e.parcel_capex.fiber_capex_usd },
  ].sort((a, b) => b.value - a.value)

  const total = e.capex.total_usd || 1
  return { ...items[0], share: items[0].value / total }
}

/** Drivers carrying no figure, named plainly. */
function assumedDrivers(e: ParcelEstimate): string[] {
  return (e.provenance ?? [])
    .filter(p => p.basis === 'assumed' || p.value === null)
    .map(p => String(p.driver ?? '').replace(/_/g, ' '))
    .filter(Boolean)
}

// ── Deterministic note ────────────────────────────────────────────────────────

export function buildFallbackNote(e: ParcelEstimate): string {
  const dom  = dominantCost(e)
  const gaps = assumedDrivers(e)

  const first =
    `Whole-life cost works out at ${usdExact(e.finance.lifetime_cost_per_kw)} per kW, ` +
    `with ${dom.name} the largest single item at ${usd(dom.value)}, ` +
    `about ${Math.round(dom.share * 100)}% of the capital cost.`

  const second = e.parcel_capex.interconnect_capex_usd > 0
    ? `Reaching the grid adds ${usd(e.parcel_capex.interconnect_capex_usd)} and reaching ` +
      `fiber ${usd(e.parcel_capex.fiber_capex_usd)}, costs a region-level comparison cannot see.`
    : `The parcel already sits on the transmission line, so no spur is priced.`

  const third = gaps.length > 0
    ? `Read it knowing ${gaps.slice(0, 2).join(' and ')} ${gaps.length === 1 ? 'is' : 'are'} ` +
      `assumed rather than sourced, so the figure could move.`
    : `Every driver behind this figure carries a source.`

  return `${first} ${second} ${third}`
}

// ── Number guard ──────────────────────────────────────────────────────────────

/**
 * Every numeric token in the prose must be traceable to the estimate. Formatted
 * figures are compared loosely — "$19,733" and "19733" are the same number — and
 * a note carrying anything else is thrown away rather than shown.
 */
export function everyNumberIsTraceable(text: string, e: ParcelEstimate): boolean {
  const allowed = new Set<string>()
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return
    const a = Math.abs(n)
    allowed.add(String(Math.round(a)))
    allowed.add(String(Math.round(a / 1e3)))
    allowed.add((a / 1e6).toFixed(1))
    allowed.add((a / 1e9).toFixed(2))
    allowed.add(a.toFixed(1))
    allowed.add(String(Math.round(a * 100)))   // percentage shares
  }

  add(e.finance.lifetime_cost_per_kw); add(e.finance.capex_per_kw)
  add(e.finance.npv_usd);              add(e.finance.payback_years)
  add(e.capex.total_usd);              add(e.capex.land_usd)
  add(e.capex.construction_usd);       add(e.capex.electrical_usd)
  add(e.capex.cooling_usd);            add(e.capex.it_fitout_usd)
  add(e.parcel_capex.interconnect_capex_usd); add(e.parcel_capex.fiber_capex_usd)
  add(e.parcel_capex.entitlement_cost_usd);   add(e.parcel_capex.sitework_usd)
  add(e.parcel_capex.land_cost_usd);          add(e.acres)
  add(e.rank);                                add(e.weighted_score)

  const dom = dominantCost(e)
  add(dom.value); add(dom.share * 100)

  for (const raw of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const clean = raw.replace(/,/g, '')
    const n = Number(clean)
    if (!Number.isFinite(n)) return false
    const forms = [
      String(Math.round(n)), n.toFixed(1), n.toFixed(2), clean,
    ]
    if (!forms.some(f => allowed.has(f))) return false
  }
  return true
}

// ── Public entry ──────────────────────────────────────────────────────────────

export interface ParcelNoteOptions { forceFallback?: boolean; skipCache?: boolean }

export async function parcelNote(
  e:    ParcelEstimate,
  opts: ParcelNoteOptions = {},
): Promise<ParcelNote> {
  const fallback = buildFallbackNote(e)

  const cacheKey =
    `parcel-note:${e.parcel_id}:${e.finance.lifetime_cost_per_kw}:${e.capex.total_usd}:${e.rank}`

  if (!opts.skipCache) {
    const hit = cacheGet(cacheKey)
    if (hit) return { text: hit, source: 'cache' }
  }

  const cfg = opts.forceFallback ? null : watsonxConfigFromEnv()
  if (!cfg) return { text: fallback, source: 'fallback' }

  try {
    const prompt = buildParcelNotePrompt(e)
    const raw    = (await watsonxGenerate(prompt, cfg, { maxTokens: 220 })).trim()
    const text   = raw.replace(/^["'\s]+|["'\s]+$/g, '')

    // A note that invents a figure is worse than a plain one, so it is dropped.
    if (!text || !everyNumberIsTraceable(text, e)) {
      return { text: fallback, source: 'fallback' }
    }

    if (!opts.skipCache) cacheSet(cacheKey, text)
    return { text, source: 'watsonx' }
  } catch (err) {
    console.warn('[LLM] parcel note failed, using deterministic text:',
      err instanceof Error ? err.message : err)
    return { text: fallback, source: 'fallback' }
  }
}

function buildParcelNotePrompt(e: ParcelEstimate): string {
  const dom  = dominantCost(e)
  const gaps = assumedDrivers(e)

  return `Write two or three plain sentences explaining what drives this parcel's cost.

Use ONLY the figures below. Do not compute anything. Do not mention the owner,
the neighborhood, the address, or what the site is like — you have no
information about any of that and must not invent it. Write about the cost
drivers and how well sourced they are, nothing else.

Figures:
- lifetime cost per kW: ${usdExact(e.finance.lifetime_cost_per_kw)}
- total capital cost: ${usd(e.capex.total_usd)}
- land: ${usd(e.capex.land_usd)}
- construction: ${usd(e.capex.construction_usd)}
- reaching the transmission line: ${usd(e.parcel_capex.interconnect_capex_usd)}
- reaching fiber: ${usd(e.parcel_capex.fiber_capex_usd)}
- leveling the ground: ${usd(e.parcel_capex.sitework_usd)}
- entitlement carrying cost: ${usd(e.parcel_capex.entitlement_cost_usd)}
- largest single item: ${dom.name}, ${Math.round(dom.share * 100)}% of capital cost
- drivers that are assumed rather than sourced: ${gaps.length ? gaps.join(', ') : 'none'}

If any driver is assumed, say so in the last sentence.`
}
