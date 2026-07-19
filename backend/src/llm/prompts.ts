/**
 * Prompt templates for watsonx/Granite calls.
 *
 * Rules enforced by every prompt:
 *   - The model MUST cite only the numbers provided in the JSON context.
 *   - The model MUST NOT invent, estimate, or round figures.
 *   - Output is plain text (no markdown), ready for a VP memo.
 */

import type { EstimateOutput } from '../schemas/output.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function usd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toFixed(0)}`
}

function pct(n: number): string { return `${(n * 100).toFixed(0)}%` }
function round1(n: number): string { return n.toFixed(1) }

// ── Narrative prompt ──────────────────────────────────────────────────────────

export function buildNarrativePrompt(output: EstimateOutput, siteLabels: Record<string, string>): string {
  const rank1Id    = output.ranking[0]
  const rank1      = output.sites[rank1Id]
  const rank1Label = siteLabels[rank1Id] ?? rank1Id

  // Build a compact context block the model can cite
  const siteLines = output.ranking.map((sid, i) => {
    const s = output.sites[sid]
    const label = siteLabels[sid] ?? sid
    return [
      `SITE ${i + 1}: ${label} (${sid})`,
      `  Rank: ${s.rank}  Score: ${s.weighted_score}`,
      `  CapEx total: ${usd(s.capex.total_usd)}`,
      `    Land: ${usd(s.capex.land_usd)}  Construction: ${usd(s.capex.construction_usd)}`,
      `    Electrical: ${usd(s.capex.electrical_usd)}  Cooling: ${usd(s.capex.cooling_usd)}  IT fitout: ${usd(s.capex.it_fitout_usd)}`,
      `  Annual OpEx: ${usd(s.opex_annual.total_usd)}`,
      `    Power: ${usd(s.opex_annual.power_usd)}  Water: ${usd(s.opex_annual.water_usd)}  Staff: ${usd(s.opex_annual.staff_usd)}`,
      `    Maintenance: ${usd(s.opex_annual.maintenance_usd)}  Taxes: ${usd(s.opex_annual.taxes_usd)}  Connectivity: ${usd(s.opex_annual.connectivity_usd)}`,
      `  Finance (base): NPV ${usd(s.finance.npv_usd)}  Levelized ${usd(s.finance.levelized_cost_per_kw)}/kW  Payback ${round1(s.finance.payback_years)} yr`,
      `  Finance low:  NPV ${usd(s.finance.ranges.low.npv_usd)}  Levelized ${usd(s.finance.ranges.low.levelized_per_kw)}/kW`,
      `  Finance high: NPV ${usd(s.finance.ranges.high.npv_usd)}  Levelized ${usd(s.finance.ranges.high.levelized_per_kw)}/kW`,
      `  Risk score: ${s.non_cost_scores.risk_score}/10  Renewable: ${pct(s.non_cost_scores.renewable_pct)}  Latency: ${s.non_cost_scores.latency_ms} ms`,
    ].join('\n')
  }).join('\n\n')

  const sensitivityLines = output.sensitivity
    .map(s => `  ${s.driver}: current ${s.current_value}, flip at ${s.flip_value} (${s.pct_change}% change)`)
    .join('\n')

  return `You are a senior infrastructure investment analyst writing a concise site-selection memo.

STRICT RULES:
1. You MUST cite ONLY the figures provided below. Do NOT invent, estimate, or round any numbers.
2. Write in plain English suitable for a VP to copy into a board memo. No markdown, no bullet lists.
3. Your RECOMMENDATION paragraph must be exactly one paragraph (4–6 sentences). It must name the winning site, state its total CapEx, annual OpEx, levelized cost per kW, and the flip condition.
4. Your SENSITIVITY CALLOUTS must be exactly ${output.ranking.length} sentences, one per site, identifying the 1–2 dominant cost drivers for that site. Each sentence starts with the site name.
5. Do NOT add any figures that are not in the DATA section below.

DATA:
Project: ${output.ranking.length} candidate sites, ${rank1.finance.payback_years.toFixed(1)}-year payback horizon.
Top-ranked site: ${rank1Label}

${siteLines}

Sensitivity flip points:
${sensitivityLines}

Flip condition: ${output.flip_sentence}

OUTPUT FORMAT (return exactly this JSON, nothing else):
{
  "recommendation": "<one paragraph, 4-6 sentences>",
  "sensitivity_callouts": [
${output.ranking.map((sid, i) => `    {"site_id": "${sid}", "label": "${siteLabels[sid] ?? sid}", "callout": "<one sentence for site ${i + 1}>"}`).join(',\n')}
  ],
  "uncertainty_flags": []
}`
}

// ── Parse-input prompt ────────────────────────────────────────────────────────

export function buildParseInputPrompt(freeText: string, knownRegionKeys: string[]): string {
  return `You are a data-center site analyst. Extract structured parameters from the free-text description below.

Known region keys: ${knownRegionKeys.join(', ')}

Free-text: """
${freeText}
"""

Return ONLY valid JSON matching this schema (use null for any field you cannot determine with confidence):
{
  "region_key": "<one of the known region keys, or null>",
  "label": "<short site name, or null>",
  "inferred_fields": ["<list fields you guessed rather than read directly>"],
  "overrides": {
    "land_cost_per_acre_usd":   <number or null>,
    "construction_cost_per_kw": <number or null>,
    "power_rate_usd_per_kwh":   <number or null>,
    "water_rate_usd_per_kgal":  <number or null>,
    "staff_cost_index":          <number or null>,
    "tax_rate":                  <number or null>,
    "incentive_usd":             <number or null>,
    "risk_score":                <number 0-10 or null>,
    "renewable_pct":             <number 0-1 or null>,
    "latency_ms_to_hub":         <number or null>
  }
}`
}
