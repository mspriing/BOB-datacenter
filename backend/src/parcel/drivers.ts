/**
 * backend/src/parcel/drivers.ts
 *
 * driversForParcel(row, county) → SiteDrivers
 *
 * Maps an ingest ParcelRow onto the driver bundle that priceSite()
 * (i.e. computeCapex / computeOpex / computeFinance) already accepts,
 * plus the non-cost scoring inputs (risk, renewable, latency).
 *
 * Resolution order per driver:
 *   1. Parcel-grain figure from the ingest row  (basis preserved from row)
 *   2. County-level fallback from data/regions.json  (basis: 'assumed' —
 *      a county average is not a parcel measurement; the output must say so)
 *
 * Rule: no cost math here. This module only resolves which number to use and
 * records where it came from. Cost formulas live in cost.ts and engine/.
 *
 * Rule: grid_interconnection_years is always null until the ERCOT Docling
 * pipeline exists. Do not model it from anything.
 */

import type { ParcelRow, DriverValue } from './repository.js'
import type { CountyConfig } from '../ingest/countyConfig.js'
import { loadRegions } from '../regions.js'
import type { ProvenanceItem } from '../schemas/output.js'

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * The resolved driver bundle for one parcel.
 * Fields map 1-to-1 onto CapexParams + OpexParams + non-cost scoring inputs.
 */
export interface SiteDrivers {
  // CapEx
  land_cost_per_acre_usd:   number
  construction_cost_per_kw: number
  incentive_usd:            number

  // OpEx
  power_rate_usd_per_kwh:   number
  water_rate_usd_per_kgal:  number
  staff_cost_index:          number
  tax_rate:                  number
  tax_abatement_years:       number

  // Non-cost scoring (all null until sourced at parcel grain or county level)
  risk_score:                  number | null
  renewable_pct:               number | null
  low_carbon_pct:              number | null
  latency_ms:                  number | null
  grid_interconnection_years:  null   // always null per rule above

  // Range bounds for scenario analysis (low/high from region or parcel driver)
  power_rate_low:              number
  power_rate_high:             number
  construction_cost_low:       number
  construction_cost_high:      number
}

export interface DriversResult {
  drivers:    SiteDrivers
  provenance: ProvenanceItem[]
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Metres to miles, for display strings only. */
function metersToMiles(m: number): number { return m / 1609.34 }
void metersToMiles  // suppress unused warning

/**
 * Resolve a single driver.  Returns the parcel value when available, otherwise
 * falls back to the region value and marks basis = 'assumed'.
 *
 * @param parcelDriver - raw DriverValue from the ingest row (or null = no parcel figure)
 * @param regionDriver - DriverValue from regions.json for this county's region key
 * @param fieldName    - canonical driver name (for provenance)
 * @param parcelId     - used as "region_key" in provenance when the parcel wins
 * @param regionKey    - used as "region_key" in provenance when the region fallback is used
 */
function resolveDriver(
  parcelDriver: DriverValue | null | undefined,
  regionDriver: { value: number | null; low?: number | null; high?: number | null; source_url: string; last_verified: string; basis?: string } | undefined,
  fieldName:    string,
  parcelId:     string,
  regionKey:    string,
): { value: number | null; low: number | null; high: number | null; prov: ProvenanceItem; basis: string } {
  // Parcel has a real, non-null figure for this driver
  if (parcelDriver && parcelDriver.value !== null) {
    return {
      value: parcelDriver.value,
      low:   parcelDriver.low   ?? null,
      high:  parcelDriver.high  ?? null,
      basis: parcelDriver.basis,
      prov: {
        region_key:    parcelId,
        driver:        fieldName,
        value:         parcelDriver.value,
        // Basis was computed here and then dropped from the provenance item, so
        // the parcel table could not distinguish a sourced figure from a modeled
        // one — the distinction the whole tool rests on.
        basis:         parcelDriver.basis,
        source_url:    parcelDriver.source_url,
        last_verified: parcelDriver.last_verified,
      },
    }
  }

  // Fall back to region
  const rv = regionDriver?.value ?? null
  return {
    value: rv,
    low:   regionDriver?.low   ?? null,
    high:  regionDriver?.high  ?? null,
    basis: 'assumed',   // county average is not a parcel measurement
    prov: {
      region_key:    regionKey,
      driver:        fieldName,
      value:         rv,
      basis:         'assumed',
      source_url:    regionDriver?.source_url    ?? '',
      last_verified: regionDriver?.last_verified ?? '',
    },
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Map a parcel ingest row to the driver bundle consumed by the cost engine.
 *
 * @param row    - parcel row from the repository
 * @param county - county config (for costModel.regionKey and tariff fallbacks)
 */
export function driversForParcel(row: ParcelRow, county: CountyConfig): DriversResult {
  const regions   = loadRegions()
  const regionKey = county.costModel.regionKey
  const region    = regions[regionKey]
  if (!region) {
    throw new Error(
      `driversForParcel: regionKey "${regionKey}" not found in regions.json. ` +
      `Check CountyConfig.costModel.regionKey for county "${county.id}".`
    )
  }

  const provenance: ProvenanceItem[] = []
  const parcelId = row.parcel_id

  // ── Land cost ─────────────────────────────────────────────────────────────
  // The ingest row carries land_cost_per_acre_usd in its drivers map.
  const landRes = resolveDriver(
    row.drivers['land_cost_per_acre_usd'],
    region.land_cost_per_acre_usd,
    'land_cost_per_acre_usd',
    parcelId, regionKey,
  )
  provenance.push(landRes.prov)

  // ── Construction cost per kW ──────────────────────────────────────────────
  // Parcel rows do not carry construction cost — always falls back to region.
  const constrRes = resolveDriver(null, region.construction_cost_per_kw, 'construction_cost_per_kw', parcelId, regionKey)
  provenance.push(constrRes.prov)

  // ── Power rate ────────────────────────────────────────────────────────────
  const powerRes = resolveDriver(
    row.drivers['power_rate_usd_per_kwh'],
    region.power_rate_usd_per_kwh,
    'power_rate_usd_per_kwh',
    parcelId, regionKey,
  )
  provenance.push(powerRes.prov)

  // ── Water rate ────────────────────────────────────────────────────────────
  const waterRes = resolveDriver(
    row.drivers['water_rate_usd_per_kgal'],
    region.water_rate_usd_per_kgal,
    'water_rate_usd_per_kgal',
    parcelId, regionKey,
  )
  provenance.push(waterRes.prov)

  // ── Staff, tax, abatement — always region (parcel ingest does not supply these) ──
  const staffRes    = resolveDriver(null, region.staff_cost_index,     'staff_cost_index',     parcelId, regionKey)
  const taxRes      = resolveDriver(null, region.tax_rate,             'tax_rate',             parcelId, regionKey)
  const abateRes    = resolveDriver(null, region.tax_abatement_years,  'tax_abatement_years',  parcelId, regionKey)
  provenance.push(staffRes.prov, taxRes.prov, abateRes.prov)

  // ── Non-cost scoring (all region; parcel ingest does not supply these yet) ──
  const riskRes      = resolveDriver(null, region.risk_score,                 'risk_score',                 parcelId, regionKey)
  const renewRes     = resolveDriver(null, region.renewable_pct,              'renewable_pct',              parcelId, regionKey)
  const lcRes        = resolveDriver(null, region.low_carbon_pct,             'low_carbon_pct',             parcelId, regionKey)
  const latencyRes   = resolveDriver(null, region.latency_ms_to_hub,          'latency_ms_to_hub',          parcelId, regionKey)
  provenance.push(riskRes.prov, renewRes.prov, lcRes.prov, latencyRes.prov)

  // grid_interconnection_years: always null — never fall back to region value
  provenance.push({
    region_key:    parcelId,
    driver:        'grid_interconnection_years',
    value:         null,
    source_url:    'https://www.ercot.com/services/rq/large-load-integration',
    last_verified: '',
  })

  const drivers: SiteDrivers = {
    land_cost_per_acre_usd:   landRes.value   ?? 0,
    construction_cost_per_kw: constrRes.value ?? 0,
    incentive_usd:            0,  // no parcel-grain incentive data yet

    power_rate_usd_per_kwh:   powerRes.value ?? 0,
    water_rate_usd_per_kgal:  waterRes.value ?? 0,
    staff_cost_index:          staffRes.value  ?? 1,
    tax_rate:                  taxRes.value    ?? 0,
    tax_abatement_years:       abateRes.value  ?? 0,

    risk_score:                 riskRes.value,
    renewable_pct:              renewRes.value,
    low_carbon_pct:             lcRes.value,
    latency_ms:                 latencyRes.value,
    grid_interconnection_years: null,

    power_rate_low:          powerRes.low   ?? (powerRes.value ?? 0) * 0.85,
    power_rate_high:         powerRes.high  ?? (powerRes.value ?? 0) * 1.15,
    construction_cost_low:   constrRes.low  ?? (constrRes.value ?? 0) * 0.90,
    construction_cost_high:  constrRes.high ?? (constrRes.value ?? 0) * 1.10,
  }

  return { drivers, provenance }
}
