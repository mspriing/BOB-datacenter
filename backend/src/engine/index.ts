/**
 * Engine orchestrator — wires capex, opex, finance, rank, sensitivity,
 * and the LLM narrative layer.
 * Called by routes/estimate.ts.
 */

import { v4 as uuidv4 } from 'uuid'
import type { EstimateInput } from '../schemas/input.js'
import type { EstimateOutput, SiteOutput, ParsedField, DataGap, Confidence } from '../schemas/output.js'
import { loadRegions } from '../regions.js'
import { computeCapex, type CapexParams } from './capex.js'
import { computeOpex,  type OpexParams  } from './opex.js'
import { computeFinance } from './finance.js'
import { rankSites, type RankInput } from './rank.js'
import { computeSensitivity, type SensitivitySiteParams } from './sensitivity.js'
import type { ProvenanceItem } from '../schemas/output.js'
import { generateNarrative, type NarrativeOptions } from '../llm/narrative.js'
import { parseSiteDescription } from '../llm/parseInput.js'

const ENGINE_VERSION = '0.2.0'

// Default weights if not supplied
const DEFAULT_WEIGHTS = {
  total_cost:     0.50,
  risk:           0.20,
  sustainability: 0.15,
  latency:        0.15,
}

export async function runEngine(
  input: EstimateInput,
  narrativeOpts?: NarrativeOptions,
): Promise<EstimateOutput> {
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
    risk_score:                   number | null
    renewable_pct:                number | null
    low_carbon_pct:               number | null
    latency_ms:                   number | null
    grid_interconnection_years:   number | null
    incentive_usd: number
  }

  // ── parsed_fields, data_gaps, confidence accumulators ─────────────────────
  const parsed_fields: ParsedField[] = []
  const data_gaps: DataGap[] = []
  const confidence: Confidence = { sourced: 0, modeled: 0, assumed: 0, missing: 0 }

  const bundles: SiteBundle[] = await Promise.all(input.sites.map(async (site) => {
    const region = regions[site.region_key]
    if (!region) throw new Error(`Unknown region_key: ${site.region_key}`)

    // Parse free_text (if provided) to get additional overrides
    let parsed: import('../llm/parseInput.js').ParsedSiteInput | null = null
    if (site.free_text && site.free_text.trim().length > 0) {
      parsed = await parseSiteDescription(site.free_text, {
        forceFallback: narrativeOpts?.forceFallback ?? false,
        // Every other site's region, so a free-text description can never move
        // this site onto a region already in the set. Without this the parser
        // could return a region_key already in use and the engine would score
        // that region twice, once against itself.
        excludeRegionKeys: input.sites
          .filter((s) => s.site_id !== site.site_id)
          .map((s) => s.region_key),
      })
    }

    const ov = site.overrides ?? {}
    const provenance: ProvenanceItem[] = []

    // Helper: resolve a driver value with precedence:
    //   1. explicit site.overrides (not null)
    //   2. parsed from free_text
    //   3. regions.json baseline (may be null — null is a valid output)
    // When a parsed value is used, provenance is marked as user-supplied.
    // Side-effects: populates provenance[], data_gaps[], and confidence counts.
    function resolve(
      field: keyof typeof region,
      overrideVal: number | null | undefined,
    ): number | null {
      const driver = region[field] as { value: number | null; low?: number | null; high?: number | null; source_url: string; last_verified: string; basis?: string } | undefined
      if (!driver) return null

      const parsedVal = parsed?.overrides[field as keyof typeof parsed.overrides] ?? null

      const fromExplicit = overrideVal != null
      const fromParsed   = !fromExplicit && parsedVal != null

      const val: number | null = fromExplicit ? overrideVal as number
                               : fromParsed   ? parsedVal as number
                               :                driver.value

      const isInferred = fromParsed && (parsed!.inferred_fields.includes(field as string))

      provenance.push({
        region_key:    site.region_key,
        driver:        field as string,
        value:         val,
        source_url:    fromParsed ? 'user-supplied description' : driver.source_url,
        last_verified: fromParsed ? 'unverified'               : driver.last_verified,
      })

      if (fromParsed) {
        parsed_fields.push({
          site_id:  site.site_id,
          field:    field as string,
          value:    val as number,
          inferred: isInferred,
        })
      }

      // Confidence counting — every resolved driver slot is counted once per site.
      if (val === null) {
        confidence.missing++
      } else if (fromExplicit || fromParsed) {
        // User-supplied override: count as sourced (user is the source)
        confidence.sourced++
      } else {
        const basis = (driver as any).basis as string | undefined
        if (basis === 'sourced')       confidence.sourced++
        else if (basis === 'modeled')  confidence.modeled++
        else if (basis === 'assumed')  confidence.assumed++
        else                           confidence.missing++   // basis unknown
      }

      return val
    }

    const power_rate    = resolve('power_rate_usd_per_kwh',       ov.power_rate_usd_per_kwh)
    const water_rate    = resolve('water_rate_usd_per_kgal',      ov.water_rate_usd_per_kgal)
    const land_cost     = resolve('land_cost_per_acre_usd',       ov.land_cost_per_acre_usd)
    const construction  = resolve('construction_cost_per_kw',     ov.construction_cost_per_kw)
    const staff_index   = resolve('staff_cost_index',              ov.staff_cost_index)
    const tax_rate      = resolve('tax_rate',                      ov.tax_rate)
    // tax_abatement_years: user-supplied value (explicit override or parsed from free_text)
    // takes precedence over the region default. The region value is kept as a baseline
    // fallback but is NOT the authoritative figure — abatement is negotiated per deal.
    const abatement: number =
      ov.tax_abatement_years != null         ? ov.tax_abatement_years
      : (parsed?.overrides.tax_abatement_years != null ? parsed.overrides.tax_abatement_years
      : (region.tax_abatement_years?.value ?? 0))
    // incentive_usd: similarly user-supplied; no longer derived from regional incentive_usd_per_kw.
    const incentive_usd = ov.incentive_usd != null
      ? ov.incentive_usd
      : (parsed?.overrides.incentive_usd != null
          ? parsed.overrides.incentive_usd
          : 0)
    const risk          = resolve('risk_score',                    ov.risk_score)
    const renewable     = resolve('renewable_pct',                 ov.renewable_pct)
    const low_carbon    = resolve('low_carbon_pct',                ov.low_carbon_pct)
    const latency       = resolve('latency_ms_to_hub',             ov.latency_ms_to_hub)
    const grid_ix_years = resolve('grid_interconnection_years',    ov.grid_interconnection_years)

    // design_wue comes from project (default 0.4 via Zod)
    const design_wue = input.project.design_wue ?? 0.4

    const capexParams: CapexParams = {
      capacity_kw:              input.project.capacity_kw,
      land_cost_per_acre_usd:   land_cost ?? 0,
      construction_cost_per_kw: construction ?? 0,
      incentive_usd:            incentive_usd,
    }

    // Compute capex first so we have total for opex maintenance calc
    const capex = computeCapex(capexParams)

    const opexParams: OpexParams = {
      capacity_kw:             input.project.capacity_kw,
      design_pue:              input.project.design_pue,
      power_rate_usd_per_kwh:  power_rate ?? 0,
      water_rate_usd_per_kgal: water_rate ?? 0,
      design_wue,
      staff_cost_index:        staff_index ?? 1,
      tax_rate:                tax_rate ?? 0,
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
      power_rate_base:        power_rate ?? 0,
      power_rate_low:         region.power_rate_usd_per_kwh.low   ?? (power_rate ?? 0) * 0.85,
      power_rate_high:        region.power_rate_usd_per_kwh.high  ?? (power_rate ?? 0) * 1.15,
      construction_cost_base: construction ?? 0,
      construction_cost_low:  region.construction_cost_per_kw.low  ?? (construction ?? 0) * 0.90,
      construction_cost_high: region.construction_cost_per_kw.high ?? (construction ?? 0) * 1.10,
      risk_score:                 risk,
      renewable_pct:              renewable,
      low_carbon_pct:             low_carbon,
      latency_ms:                 latency,
      grid_interconnection_years: grid_ix_years,
      incentive_usd,
    }
  }))

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
        risk_score:                 b.risk_score,
        renewable_pct:              b.renewable_pct,
        low_carbon_pct:             b.low_carbon_pct,
        latency_ms:                 b.latency_ms,
        grid_interconnection_years: b.grid_interconnection_years,
      },
    }

    // Pass true nulls — rank.ts will exclude null dimensions and renormalise.
    rankInputs.push({
      site_id:       b.site_id,
      npv_usd:       finance.npv_usd,
      risk_score:    b.risk_score,
      renewable_pct: b.renewable_pct,
      latency_ms:    b.latency_ms,
    })

    // Record data_gaps for ranked dimensions that are null.
    if (b.risk_score    === null) data_gaps.push({ site_id: b.site_id, driver: 'risk_score',    reason: 'no value in regions.json' })
    if (b.renewable_pct === null) data_gaps.push({ site_id: b.site_id, driver: 'renewable_pct', reason: 'no value in regions.json' })
    if (b.latency_ms    === null) data_gaps.push({ site_id: b.site_id, driver: 'latency_ms_to_hub', reason: 'no value in regions.json' })
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

  // ── Sensitivity analysis (rank-1, all sites as context) ───────────────────
  const rank1bundle = bundles.find((b) => b.site_id === ranking[0])!
  const rank2bundle = bundles.find((b) => b.site_id === ranking[1])!

  // Build SensitivitySiteParams for every site (the full-N context is required)
  const allSensParams: SensitivitySiteParams[] = bundles.map((b) => ({
    site_id:        b.site_id,
    capexParams:    b.capexParams,
    opexParams:     b.opexParams,
    discount_rate:  input.project.discount_rate,
    lifetime_years: input.project.lifetime_years,
    // Sensitivity analysis requires concrete numbers; treat null as neutral midpoints.
    risk_score:     b.risk_score     ?? 5,
    renewable_pct:  b.renewable_pct  ?? 0,
    latency_ms:     b.latency_ms     ?? 50,
  }))

  const rank1SensParams = allSensParams.find((s) => s.site_id === ranking[0])!
  const rank2SensParams = allSensParams.find((s) => s.site_id === ranking[1])!

  const sensitivity = computeSensitivity(rank1SensParams, rank2SensParams, allSensParams, weights)

  // ── Flip sentence ─────────────────────────────────────────────────────────
  let flip_sentence = `${rank1bundle.label} ranks #1 and remains stable across all base-case driver ranges.`
  // Use the first non-stable item for the flip sentence
  const topFlip = sensitivity.find((s) => !s.stable)
  if (topFlip) {
    const rank1Label = rank1bundle.label
    const rank2Label = rank2bundle.label
    if (topFlip.driver === 'power_rate_usd_per_kwh') {
      flip_sentence =
        `This ranking flips if ${rank1Label} power rates rise above ` +
        `$${topFlip.flip_value.toFixed(4)}/kWh ` +
        `(+${topFlip.pct_change.toFixed(1)}% vs. current $${topFlip.current_value.toFixed(4)}/kWh), ` +
        `at which point ${rank2Label} becomes the preferred option.`
    } else if (topFlip.driver === 'construction_cost_per_kw') {
      flip_sentence =
        `This ranking flips if ${rank1Label} construction costs exceed ` +
        `$${topFlip.flip_value.toFixed(0)}/kW ` +
        `(+${topFlip.pct_change.toFixed(1)}% vs. current $${topFlip.current_value.toFixed(0)}/kW).`
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

  // ── Build site labels map ──────────────────────────────────────────────────
  const siteLabels: Record<string, string> = {}
  for (const site of input.sites) {
    siteLabels[site.site_id] = site.label
  }

  // ── Generate narrative (async: watsonx if configured, else fallback) ───────
  const partialOutput: EstimateOutput = {
    request_id:     input.request_id ?? uuidv4(),
    generated_at:   new Date().toISOString(),
    engine_version: ENGINE_VERSION,
    ranking,
    site_labels:    siteLabels,
    sites: siteOutputs,
    sensitivity,
    flip_sentence,
    narrative: {
      recommendation:       '',
      sensitivity_callouts: [],
      uncertainty_flags:    [],
      source:               'fallback',
    },
    parsed_fields,
    data_provenance,
    data_gaps,
    confidence,
  }

  const narrative = await generateNarrative(partialOutput, siteLabels, narrativeOpts)

  return { ...partialOutput, narrative }
}
