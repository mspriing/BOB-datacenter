/**
 * Engine orchestrator — wires capex, opex, finance, rank, sensitivity.
 * Pure deterministic code. No LLM calls.
 * Called by routes/estimate.ts.
 */

import { v4 as uuidv4 } from 'uuid'
import type { EstimateInput } from '../schemas/input.js'
import type { EstimateOutput, SiteOutput } from '../schemas/output.js'
import { loadRegions } from '../regions.js'
import { computeCapex, type CapexParams } from './capex.js'
import { computeOpex,  type OpexParams  } from './opex.js'
import { computeFinance } from './finance.js'
import { rankSites, type RankInput } from './rank.js'
import { computeSensitivity, type SensitivitySiteParams } from './sensitivity.js'
import type { ProvenanceItem } from '../schemas/output.js'

const ENGINE_VERSION = '0.2.0'

// Default weights if not supplied
const DEFAULT_WEIGHTS = {
  total_cost:     0.50,
  risk:           0.20,
  sustainability: 0.15,
  latency:        0.15,
}

export function runEngine(input: EstimateInput): EstimateOutput {
  const regions = loadRegions()

  // ── Resolve per-site parameters ─────────────────────────────────────────────
  type SiteBundle = {
    site_id: string
    label:   string
    capexParams:  CapexParams
    opexParams:   OpexParams
    provenance:   ProvenanceItem[]
    // Region data for ranges
    power_rate_base: number
    power_rate_low:  number
    power_rate_high: number
    construction_cost_base: number
    construction_cost_low:  number
    construction_cost_high: number
    risk_score:    number
    renewable_pct: number
    latency_ms:    number
    incentive_usd: number
  }

  const bundles: SiteBundle[] = input.sites.map((site) => {
    const region = regions[site.region_key]
    if (!region) throw new Error(`Unknown region_key: ${site.region_key}`)

    const ov = site.overrides ?? {}
    const provenance: ProvenanceItem[] = []

    // Helper: resolve a driver value, prefer override, collect provenance
    function resolve(
      field: keyof typeof region,
      overrideVal: number | null | undefined,
    ): number {
      const driver = region[field] as { value: number; low?: number; high?: number; source_url: string; last_verified: string }
      const val = overrideVal != null ? overrideVal : driver.value
      provenance.push({
        region_key:    site.region_key,
        driver:        field as string,
        value:         val,
        source_url:    driver.source_url,
        last_verified: driver.last_verified,
      })
      return val
    }

    const power_rate    = resolve('power_rate_usd_per_kwh',  ov.power_rate_usd_per_kwh)
    const water_rate    = resolve('water_rate_usd_per_kgal', ov.water_rate_usd_per_kgal)
    const wue           = region.wue.value
    const land_cost     = resolve('land_cost_per_acre_usd',  ov.land_cost_per_acre_usd)
    const construction  = resolve('construction_cost_per_kw',ov.construction_cost_per_kw)
    const staff_index   = resolve('staff_cost_index',         ov.staff_cost_index)
    const tax_rate      = resolve('tax_rate',                 ov.tax_rate)
    const abatement     = region.tax_abatement_years.value
    const incentive_per_kw = resolve('incentive_usd_per_kw', undefined)
    const incentive_usd = ov.incentive_usd != null
      ? ov.incentive_usd
      : incentive_per_kw * input.project.capacity_kw
    const risk          = resolve('risk_score',               ov.risk_score)
    const renewable     = resolve('renewable_pct',            ov.renewable_pct)
    const latency       = resolve('latency_ms_to_hub',        ov.latency_ms_to_hub)

    const capexParams: CapexParams = {
      capacity_kw:              input.project.capacity_kw,
      land_cost_per_acre_usd:   land_cost,
      construction_cost_per_kw: construction,
      incentive_usd:            incentive_usd,
    }

    // Compute capex first so we have total for opex maintenance calc
    const capex = computeCapex(capexParams)

    const opexParams: OpexParams = {
      capacity_kw:             input.project.capacity_kw,
      design_pue:              input.project.design_pue,
      power_rate_usd_per_kwh:  power_rate,
      water_rate_usd_per_kgal: water_rate,
      wue,
      staff_cost_index:        staff_index,
      tax_rate,
      tax_abatement_years:     abatement,
      current_year:            1,             // Year 1 opex (abatement applies)
      capex_total_usd:         capex.total_usd,
    }

    return {
      site_id:   site.site_id,
      label:     site.label,
      capexParams,
      opexParams,
      provenance,
      power_rate_base:        power_rate,
      power_rate_low:         region.power_rate_usd_per_kwh.low  ?? power_rate * 0.85,
      power_rate_high:        region.power_rate_usd_per_kwh.high ?? power_rate * 1.15,
      construction_cost_base: construction,
      construction_cost_low:  region.construction_cost_per_kw.low  ?? construction * 0.90,
      construction_cost_high: region.construction_cost_per_kw.high ?? construction * 1.10,
      risk_score:    risk,
      renewable_pct: renewable,
      latency_ms:    latency,
      incentive_usd,
    }
  })

  // ── Compute per-site cost outputs ──────────────────────────────────────────
  const siteOutputs: Record<string, SiteOutput> = {}
  const rankInputs:  RankInput[]                = []

  for (const b of bundles) {
    const capex = computeCapex(b.capexParams)

    const opexYear1 = computeOpex({
      ...b.opexParams,
      current_year:    1,
      capex_total_usd: capex.total_usd,
    })

    const finance = computeFinance({
      lifetime_years:          input.project.lifetime_years,
      discount_rate:           input.project.discount_rate,
      capacity_kw:             input.project.capacity_kw,
      capex,
      opexBase:                opexYear1,
      opexParamsBase:          b.opexParams,
      capexParamsBase:         b.capexParams,
      power_rate_low:          b.power_rate_low,
      power_rate_high:         b.power_rate_high,
      construction_cost_low:   b.construction_cost_low,
      construction_cost_high:  b.construction_cost_high,
      incentive_usd:           b.incentive_usd,
    })

    siteOutputs[b.site_id] = {
      rank:           0,   // filled after ranking
      weighted_score: 0,   // filled after ranking
      capex,
      opex_annual:    opexYear1,
      finance,
      non_cost_scores: {
        risk_score:    b.risk_score,
        renewable_pct: b.renewable_pct,
        latency_ms:    b.latency_ms,
      },
    }

    rankInputs.push({
      site_id:       b.site_id,
      npv_usd:       finance.npv_usd,
      risk_score:    b.risk_score,
      renewable_pct: b.renewable_pct,
      latency_ms:    b.latency_ms,
    })
  }

  // ── Rank sites ─────────────────────────────────────────────────────────────
  const weights = {
    ...DEFAULT_WEIGHTS,
    ...(input.project.weights ?? {}),
  }
  const ranks = rankSites(rankInputs, weights)
  const ranking: string[] = []
  for (const r of ranks) {
    siteOutputs[r.site_id].rank           = r.rank
    siteOutputs[r.site_id].weighted_score = r.weighted_score
    ranking.push(r.site_id)
  }

  // ── Sensitivity analysis (rank-1 vs rank-2) ──────────────────────────────
  const rank1bundle = bundles.find((b) => b.site_id === ranking[0])!
  const rank2bundle = bundles.find((b) => b.site_id === ranking[1])!

  const rank1SensParams: SensitivitySiteParams = {
    site_id:        rank1bundle.site_id,
    capexParams:    rank1bundle.capexParams,
    opexParams:     rank1bundle.opexParams,
    discount_rate:  input.project.discount_rate,
    lifetime_years: input.project.lifetime_years,
  }
  const rank2SensParams: SensitivitySiteParams = {
    site_id:        rank2bundle.site_id,
    capexParams:    rank2bundle.capexParams,
    opexParams:     rank2bundle.opexParams,
    discount_rate:  input.project.discount_rate,
    lifetime_years: input.project.lifetime_years,
  }

  const sensitivity = computeSensitivity(rank1SensParams, rank2SensParams)

  // ── Flip sentence ─────────────────────────────────────────────────────────
  let flip_sentence = `${rank1bundle.label} ranks #1 under all base-case assumptions.`
  if (sensitivity.length > 0) {
    const top = sensitivity[0]
    const rank1Label = rank1bundle.label
    const rank2Label = rank2bundle.label
    if (top.driver === 'power_rate_usd_per_kwh') {
      flip_sentence =
        `This ranking flips if ${rank1Label} power rates rise above ` +
        `$${top.flip_value.toFixed(4)}/kWh ` +
        `(+${top.pct_change.toFixed(1)}% vs. current $${top.current_value.toFixed(4)}/kWh), ` +
        `at which point ${rank2Label} becomes the lower-cost option.`
    } else if (top.driver === 'power_rate_usd_per_kwh (rank-2 drop)') {
      flip_sentence =
        `This ranking flips if ${rank2Label} power rates fall below ` +
        `$${top.flip_value.toFixed(4)}/kWh ` +
        `(${top.pct_change.toFixed(1)}% drop vs. current $${top.current_value.toFixed(4)}/kWh).`
    } else if (top.driver === 'construction_cost_per_kw') {
      flip_sentence =
        `This ranking flips if ${rank1Label} construction costs exceed ` +
        `$${Math.round(top.flip_value).toLocaleString()}/kW ` +
        `(+${top.pct_change.toFixed(1)}% vs. current $${Math.round(top.current_value).toLocaleString()}/kW).`
    }
  }

  // ── Provenance (deduplicated by region_key + driver) ──────────────────────
  const seen = new Set<string>()
  const data_provenance: ProvenanceItem[] = []
  for (const b of bundles) {
    for (const p of b.provenance) {
      const key = `${p.region_key}::${p.driver}`
      if (!seen.has(key)) {
        seen.add(key)
        data_provenance.push(p)
      }
    }
  }

  return {
    request_id:     input.request_id ?? uuidv4(),
    generated_at:   new Date().toISOString(),
    engine_version: ENGINE_VERSION,
    ranking,
    sites: siteOutputs,
    sensitivity,
    flip_sentence,
    narrative: '[Narrative will be generated by watsonx/Granite once the LLM module is wired in.]',
    data_provenance,
  }
}
