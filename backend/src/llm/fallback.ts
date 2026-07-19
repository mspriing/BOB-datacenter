/**
 * Deterministic fallback narrative — produces the same NarrativeResult shape
 * as the watsonx path, built entirely from engine numbers.
 *
 * Used when WATSONX_API_KEY / WATSONX_PROJECT_ID are absent, or as the
 * offline demo path.  The LLM NEVER touches numbers; neither does this — all
 * figures are injected directly from the engine's EstimateOutput.
 */

import type { EstimateOutput } from '../schemas/output.js'
import type { NarrativeResult, SensitivityCallout, UncertaintyFlag } from '../schemas/output.js'

// ── Formatting helpers ────────────────────────────────────────────────────────

function usd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toFixed(0)}`
}

function pct(n: number): string { return `${(n * 100).toFixed(0)}%` }

/**
 * Find the 1–2 dominant cost drivers for a site by comparing OpEx/CapEx line
 * items as a share of total NPV cost.
 */
function dominantDrivers(
  output: EstimateOutput,
  siteId: string,
): string {
  const s = output.sites[siteId]
  const opex = s.opex_annual
  const cap  = s.capex
  const totalNPV = Math.abs(s.finance.npv_usd)

  const items: Array<{ name: string; value: number }> = [
    { name: 'power costs',        value: opex.power_usd * output.sites[siteId].finance.payback_years },
    { name: 'construction costs', value: cap.construction_usd },
    { name: 'land costs',         value: cap.land_usd },
    { name: 'staffing costs',     value: opex.staff_usd * output.sites[siteId].finance.payback_years },
    { name: 'property taxes',     value: opex.taxes_usd * output.sites[siteId].finance.payback_years },
    { name: 'water costs',        value: opex.water_usd * output.sites[siteId].finance.payback_years },
  ]
  items.sort((a, b) => b.value - a.value)

  const top = items.slice(0, 2).filter(i => i.value / totalNPV > 0.05)
  if (top.length === 0) return 'overall operating costs'
  if (top.length === 1) return top[0].name
  return `${top[0].name} and ${top[1].name}`
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildFallbackNarrative(
  output: EstimateOutput,
  siteLabels: Record<string, string>,
): NarrativeResult {
  const rank1Id    = output.ranking[0]
  const rank2Id    = output.ranking[1]
  const rank1      = output.sites[rank1Id]
  const rank2      = output.sites[rank2Id]
  const rank1Label = siteLabels[rank1Id] ?? rank1Id
  const rank2Label = siteLabels[rank2Id] ?? rank2Id

  // ── Recommendation paragraph ────────────────────────────────────────────────
  const costGap = Math.abs(rank1.finance.npv_usd) - Math.abs(rank2.finance.npv_usd)
  const cheaper = costGap > 0 ? rank2Label : rank1Label   // whichever has lower absolute NPV cost
  const pricedBetter = Math.abs(rank1.finance.levelized_cost_per_kw) < Math.abs(rank2.finance.levelized_cost_per_kw)

  const recommendation =
    `Based on a ${output.ranking.length}-site analysis, ${rank1Label} is the recommended site ` +
    `with a weighted composite score of ${rank1.weighted_score.toFixed(3)}, ` +
    `a total capital outlay of ${usd(rank1.capex.total_usd)}, and annual operating costs of ${usd(rank1.opex_annual.total_usd)}. ` +
    `The ${output.sites[rank1Id].finance.payback_years.toFixed(1)}-year base-case NPV is ${usd(rank1.finance.npv_usd)}, ` +
    `yielding a levelized cost of ${usd(rank1.finance.levelized_cost_per_kw)}/kW ` +
    (pricedBetter ? `— the most competitive figure among the evaluated candidates. ` : `— `) +
    `Under low and high cost scenarios this spans ${usd(rank1.finance.ranges.low.levelized_per_kw)}/kW to ` +
    `${usd(rank1.finance.ranges.high.levelized_per_kw)}/kW. ` +
    `${output.flip_sentence} ` +
    `${rank2Label} is the strongest alternative, with a levelized cost of ` +
    `${usd(rank2.finance.levelized_cost_per_kw)}/kW and ${pct(rank2.non_cost_scores.renewable_pct)} renewable power availability.`

  // ── Sensitivity callouts — one per site ────────────────────────────────────
  const sensitivity_callouts: SensitivityCallout[] = output.ranking.map((sid) => {
    const label   = siteLabels[sid] ?? sid
    const s       = output.sites[sid]
    const drivers = dominantDrivers(output, sid)
    const callout =
      `${label}: ${drivers} drive most of the cost structure, ` +
      `accounting for the majority of the ${usd(s.finance.npv_usd)} base-case NPV; ` +
      `renewable energy availability stands at ${pct(s.non_cost_scores.renewable_pct)} with a risk score of ${s.non_cost_scores.risk_score.toFixed(1)}/10.`
    return { site_id: sid, label, callout }
  })

  // ── Uncertainty flags ───────────────────────────────────────────────────────
  const uncertainty_flags: UncertaintyFlag[] = []
  // Flag any site whose power rate last_verified is older than 12 months
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 12)
  for (const prov of output.data_provenance) {
    if (prov.driver === 'power_rate_usd_per_kwh') {
      const parts = prov.last_verified.split('-')
      const verifiedDate = new Date(parseInt(parts[0]), (parseInt(parts[1] ?? '1') - 1))
      if (verifiedDate < cutoff) {
        uncertainty_flags.push({
          site_id: prov.region_key,
          field:   'power_rate_usd_per_kwh',
          reason:  `Last verified ${prov.last_verified} — may not reflect current tariffs. Recommend direct utility quote.`,
        })
      }
    }
  }

  return {
    recommendation,
    sensitivity_callouts,
    uncertainty_flags,
    source: 'fallback',
  }
}
