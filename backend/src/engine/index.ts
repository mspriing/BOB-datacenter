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
import { ASSUMPTIONS } from './assumptions.js'

const ENGINE_VERSION = '0.2.0'

/**
 * The drivers a site must have before it can be priced at all.
 *
 * Every one of these is coalesced to 0 further down when the region carries no
 * value, which is what a missing number has to become before it can go into
 * arithmetic. The consequence is that a region nobody has priced yet arrives at
 * the ranker looking free, and cost carries the heaviest weight, so it wins.
 * Only 8 of the 77 regions in data/regions.json held all six of these before
 * the July collection was merged in, so this was the common case rather than
 * the edge case.
 */
export const COST_DRIVERS = [
  'construction_cost_per_kw',
  'power_rate_usd_per_kwh',
  'land_cost_per_acre_usd',
  'staff_cost_index',
] as const

export type CostDriver = typeof COST_DRIVERS[number]

export interface UnevaluableSite {
  site_id:         string
  label:           string
  missing_drivers: string[]
}

/** Fewer than two sites could be priced, so there is no comparison to publish. */
export class UnpriceableError extends Error {
  readonly unevaluable: UnevaluableSite[]
  constructor(unevaluable: UnevaluableSite[]) {
    const names = unevaluable.map((u) => `${u.label} (${u.missing_drivers.join(', ')})`).join('; ')
    super(`Not enough priced sites to compare. Missing: ${names}`)
    this.name = 'UnpriceableError'
    this.unevaluable = unevaluable
  }
}

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
    land_cost_low:           number
    land_cost_high:          number
    water_rate_low:          number
    water_rate_high:         number
    staff_cost_index_low:    number
    staff_cost_index_high:   number
    tax_rate_low:            number
    tax_rate_high:           number
    risk_score:                   number | null
    renewable_pct:                number | null
    low_carbon_pct:               number | null
    latency_ms:                   number | null
    grid_interconnection_years:   number | null
    /** Raw resolved cost drivers, before the coalesce to 0. null = no value. */
    cost_drivers: Record<CostDriver, number | null>
  }

  // ── parsed_fields, data_gaps, confidence accumulators ─────────────────────
  const parsed_fields: ParsedField[] = []
  const data_gaps: DataGap[] = []
  const unevaluable: UnevaluableSite[] = []
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
      const driver = region[field] as { value: number | null; low?: number | null; high?: number | null; source_url: string; last_verified: string; basis?: string; method?: string | null } | undefined
      if (!driver) return null

      const parsedVal = parsed?.overrides[field as keyof typeof parsed.overrides] ?? null

      const fromExplicit = overrideVal != null
      const fromParsed   = !fromExplicit && parsedVal != null

      const val: number | null = fromExplicit ? overrideVal as number
                               : fromParsed   ? parsedVal as number
                               :                driver.value

      const isInferred = fromParsed && (parsed!.inferred_fields.includes(field as string))

      const fromUser = fromExplicit || fromParsed
      const basisVal = fromUser ? 'sourced'
        : (driver.basis === 'sourced' || driver.basis === 'modeled' || driver.basis === 'assumed'
            ? driver.basis as 'sourced' | 'modeled' | 'assumed'
            : null)

      provenance.push({
        region_key:    site.region_key,
        driver:        field as string,
        value:         val,
        source_url:    fromParsed ? 'user-supplied description'
                     : fromExplicit ? 'user-supplied override'
                     : driver.source_url,
        last_verified: fromUser ? 'unverified' : driver.last_verified,
        basis:         basisVal,
        ...(fromUser ? { method: 'Value supplied for this candidate site; regional baseline not used.' }
                     : driver.method ? { method: driver.method }
                     : {}),
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

    function bounds(
      field: keyof typeof region,
      base: number,
      overrideVal: number | null | undefined,
      fallbackPct: number,
    ): { low: number; high: number } {
      const parsedVal = parsed?.overrides[field as keyof typeof parsed.overrides] ?? null
      if (overrideVal != null || parsedVal != null) return { low: base, high: base }
      const driver = region[field] as { low?: number | null; high?: number | null }
      const candidates = [
        base,
        driver.low ?? base * (1 - fallbackPct),
        driver.high ?? base * (1 + fallbackPct),
      ]
      return { low: Math.min(...candidates), high: Math.max(...candidates) }
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
      : 0)
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

    function recordNegotiated(
      driver: 'tax_abatement_years' | 'incentive_usd',
      value: number,
      source: 'user-supplied override' | 'user-supplied description',
    ): void {
      provenance.push({
        region_key: site.region_key,
        driver,
        value,
        source_url: source,
        last_verified: 'unverified',
        basis: 'sourced',
        method: 'Negotiated candidate-site value; no regional default applied.',
      })
      confidence.sourced++
      if (source === 'user-supplied description') {
        parsed_fields.push({
          site_id: site.site_id,
          field: driver,
          value,
          inferred: false,
        })
      }
    }
    if (ov.tax_abatement_years != null) recordNegotiated('tax_abatement_years', abatement, 'user-supplied override')
    else if (parsed?.overrides.tax_abatement_years != null) recordNegotiated('tax_abatement_years', abatement, 'user-supplied description')
    if (ov.incentive_usd != null) recordNegotiated('incentive_usd', incentive_usd, 'user-supplied override')
    else if (parsed?.overrides.incentive_usd != null) recordNegotiated('incentive_usd', incentive_usd, 'user-supplied description')

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
    const grossCapexBasis = capex.land_usd
      + capex.construction_usd
      + capex.electrical_usd
      + capex.cooling_usd
      + capex.it_fitout_usd

    const powerBounds       = bounds('power_rate_usd_per_kwh', power_rate ?? 0, ov.power_rate_usd_per_kwh, 0.15)
    const constructionBounds = bounds('construction_cost_per_kw', construction ?? 0, ov.construction_cost_per_kw, 0.10)
    const landBounds        = bounds('land_cost_per_acre_usd', land_cost ?? 0, ov.land_cost_per_acre_usd, 0.15)
    const waterBounds       = bounds('water_rate_usd_per_kgal', water_rate ?? 0, ov.water_rate_usd_per_kgal, 0.15)
    const staffBounds       = bounds('staff_cost_index', staff_index ?? 1, ov.staff_cost_index, 0.10)
    const taxBounds         = bounds('tax_rate', tax_rate ?? 0, ov.tax_rate, 0.10)

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
      // Incentives reduce acquisition cost, not the physical asset basis used
      // for maintenance and property-tax calculations.
      capex_total_usd:         grossCapexBasis,
    }

    return {
      site_id:   site.site_id,
      label:     site.label,
      capexParams,
      opexParams,
      provenance,
      power_rate_base:        power_rate ?? 0,
      power_rate_low:         powerBounds.low,
      power_rate_high:        powerBounds.high,
      construction_cost_base: construction ?? 0,
      construction_cost_low:  constructionBounds.low,
      construction_cost_high: constructionBounds.high,
      land_cost_low:          landBounds.low,
      land_cost_high:         landBounds.high,
      water_rate_low:         waterBounds.low,
      water_rate_high:        waterBounds.high,
      staff_cost_index_low:   staffBounds.low,
      staff_cost_index_high:  staffBounds.high,
      tax_rate_low:           taxBounds.low,
      tax_rate_high:          taxBounds.high,
      risk_score:                 risk,
      renewable_pct:              renewable,
      low_carbon_pct:             low_carbon,
      latency_ms:                 latency,
      grid_interconnection_years: grid_ix_years,
      cost_drivers: {
        construction_cost_per_kw: construction,
        power_rate_usd_per_kwh:   power_rate,
        land_cost_per_acre_usd:   land_cost,
        staff_cost_index:         staff_index,
      },
    }
  }))

  // ── Compute per-site cost outputs ──────────────────────────────────────────
  const siteOutputs: Record<string, SiteOutput> = Object.create(null)
  const rankInputs:  RankInput[]                = []

  for (const b of bundles) {
    const missing_cost_drivers = COST_DRIVERS.filter((d) => b.cost_drivers[d] === null)

    for (const driver of missing_cost_drivers) {
      data_gaps.push({
        site_id: b.site_id,
        driver,
        reason:  'no value in regions.json, so this site cannot be priced',
      })
    }

    if (missing_cost_drivers.length > 0) {
      unevaluable.push({
        site_id:         b.site_id,
        label:           b.label,
        missing_drivers: [...missing_cost_drivers],
      })
      continue
    }

    const capex = computeCapex(b.capexParams)
    const opexYear1 = computeOpex({ ...b.opexParams, current_year: 1 })
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
      land_cost_low:           b.land_cost_low,
      land_cost_high:          b.land_cost_high,
      water_rate_low:          b.water_rate_low,
      water_rate_high:         b.water_rate_high,
      staff_cost_index_low:    b.staff_cost_index_low,
      staff_cost_index_high:   b.staff_cost_index_high,
      tax_rate_low:            b.tax_rate_low,
      tax_rate_high:           b.tax_rate_high,
    })

    siteOutputs[b.site_id] = {
      rank: 0,
      weighted_score: 0,
      capex,
      opex_annual: opexYear1,
      finance,
      non_cost_scores: {
        risk_score: b.risk_score,
        renewable_pct: b.renewable_pct,
        low_carbon_pct: b.low_carbon_pct,
        latency_ms: b.latency_ms,
        grid_interconnection_years: b.grid_interconnection_years,
      },
    }
    rankInputs.push({
      site_id: b.site_id,
      npv_usd: finance.npv_usd,
      risk_score: b.risk_score,
      renewable_pct: b.renewable_pct,
      latency_ms: b.latency_ms,
    })

    // Record data_gaps for ranked dimensions that are null.
    if (b.risk_score    === null) data_gaps.push({ site_id: b.site_id, driver: 'risk_score',    reason: 'no value in regions.json' })
    if (b.renewable_pct === null) data_gaps.push({ site_id: b.site_id, driver: 'renewable_pct', reason: 'no value in regions.json' })
    if (b.latency_ms    === null) data_gaps.push({ site_id: b.site_id, driver: 'latency_ms_to_hub', reason: 'no value in regions.json' })
  }

  // Ranking one site against nothing is not a comparison, so stop here and name
  // the numbers that are missing instead of publishing a winner by default.
  if (rankInputs.length < 2) {
    throw new UnpriceableError(unevaluable)
  }

  // ── Rank sites ─────────────────────────────────────────────────────────────
  const rawWeights = {
    ...DEFAULT_WEIGHTS,
    ...(input.project.weights ?? {}),
  }
  const weightTotal = Object.values(rawWeights).reduce((sum, value) => sum + value, 0)
  const weights = Object.fromEntries(
    Object.entries(rawWeights).map(([key, value]) => [key, value / weightTotal]),
  ) as typeof DEFAULT_WEIGHTS
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

  // Every ranked site, which is the full-N context the sensitivity pass needs.
  // Unpriced sites are excluded: their costs were zeroed, and one sitting in
  // this set would move the flip threshold against a rival that does not exist
  // at that price.
  const allSensParams: SensitivitySiteParams[] = bundles
    .filter((b) => ranking.includes(b.site_id))
    .map((b) => ({
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
      const change = topFlip.pct_change === null
        ? `an absolute increase of ${topFlip.absolute_change ?? topFlip.flip_value} from zero`
        : `+${topFlip.pct_change.toFixed(1)}% vs. current $${topFlip.current_value.toFixed(4)}/kWh`
      flip_sentence =
        `This ranking flips if ${rank1Label} power rates rise above ` +
        `$${topFlip.flip_value.toFixed(4)}/kWh ` +
        `(${change}), ` +
        `at which point ${rank2Label} becomes the preferred option.`
    } else if (topFlip.driver === 'construction_cost_per_kw') {
      const change = topFlip.pct_change === null
        ? `an absolute increase of ${topFlip.absolute_change ?? topFlip.flip_value} from zero`
        : `+${topFlip.pct_change.toFixed(1)}% vs. current $${topFlip.current_value.toFixed(0)}/kW`
      flip_sentence =
        `This ranking flips if ${rank1Label} construction costs exceed ` +
        `$${topFlip.flip_value.toFixed(0)}/kW ` +
        `(${change}).`
    } else {
      const driverLabel = topFlip.driver.replace(/_/g, ' ')
      const change = topFlip.pct_change === null
        ? `an absolute increase of ${topFlip.absolute_change ?? topFlip.flip_value} from zero`
        : `+${topFlip.pct_change.toFixed(1)}% versus the current value`
      flip_sentence =
        `This ranking flips if ${rank1Label}'s ${driverLabel} reaches ` +
        `${topFlip.flip_value} (${change}), ` +
        `at which point ${rank2Label} becomes the preferred option.`
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
  const siteLabels: Record<string, string> = Object.create(null)
  const siteIdByRegion: Record<string, string> = Object.create(null)
  for (const site of input.sites) {
    siteLabels[site.site_id] = site.label
    siteIdByRegion[site.region_key] = site.site_id
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
    unevaluable,
    confidence,
    assumptions: ASSUMPTIONS,
  }

  const narrative = await generateNarrative(partialOutput, siteLabels, {
    ...narrativeOpts,
    siteIdByRegion,
  })

  return { ...partialOutput, narrative }
}
