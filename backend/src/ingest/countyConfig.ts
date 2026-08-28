/**
 * backend/src/ingest/countyConfig.ts
 *
 * Typed configuration interface for a county ingest.
 * All county-specific literals (endpoints, thresholds, field names, tariffs)
 * live in a CountyConfig.  The pipeline receives one and has no county literals.
 */

export interface BboxConfig {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export interface ParcelSourceConfig {
  url:              string
  cachePrefix:      string
  acresField:       string
  acresFallback:    string
  idField:          string
  addressField:     string
  stateCodeField:   string
  landValField:     string
  allowedStateCodes: Set<string>
  excludedStateCodes: Set<string>

  // ── Ownership and exemption screening ───────────────────────────────────────
  //
  // Land-use codes alone do not say whether a parcel can be bought. A city park
  // is coded the same as any other open land; what marks it is a tax exemption.
  // These fields let the pipeline tell "not for sale" from "someone lives on it"
  // from "genuinely available".
  exemptField:      string
  ownerField:       string

  /** Exemption code prefixes meaning the owner is an institution: not for sale. */
  institutionalExemptPrefixes: string[]

  /** Exemption code prefixes meaning a private residence sits on the land. */
  occupancyExemptPrefixes: string[]

  /** Owner-name fragments that indicate public ownership. Secondary net. */
  governmentOwnerPatterns: string[]

  /**
   * Below this modeled land price the parcel is treated as unpriceable rather
   * than cheap. An appraisal artifact of $0 an acre would otherwise rank first,
   * because a cost the data never captured reads as a cost that is not there.
   */
  minLandValuePerAcre: number
}

/**
 * How the dominant utility's name maps to a jurisdiction label.
 *
 * This lived in pipeline.ts as a hardcoded `utility.includes('CPS')`, which is
 * exactly the kind of county literal the pipeline is supposed to be free of.
 */
export interface PrimaryUtilityConfig {
  /** Fragment matched against the utility name from the territory layer. */
  match: string
  /** Label used for parcels inside that territory. */
  jurisdictionLabel: string
}

export interface FloodSourceConfig {
  url:               string
  expectedLayerName: string
  cachePrefix:       string
  whereClause:       string
  dropZones:         Set<string>
  flagZones:         Set<string>
}

export interface TransmissionSourceConfig {
  url:          string
  cachePrefix:  string
  whereClause:  string
  voltageField: string
  minKv:        number
}

export interface GapRecord {
  urlsTried:  string[]
  probedDate: string
  outcome:    string
  note?:      string
}

export interface PowerRateConfig {
  valueUsdPerKwh: number
  source_url:     string
  last_verified:  string
  low:            number
  high:           number
  method:         string
}

export interface WaterRateConfig {
  valueUsdPerKgal: number
  source_url:      string
  last_verified:   string
  low:             number
  high:            number
  method:          string
}

/**
 * Cost-model constants for parcel-grain CapEx components.
 * Every numeric constant carries a `method` string explaining its derivation.
 * Values without a defensible origin must use basis='assumed' and be visible
 * in confidence counts — never silently embedded as magic numbers.
 */
export interface CostModelConfig {
  /** regions.json key used for county-level fallback drivers. */
  regionKey: string

  /**
   * Transmission spur build cost per metre (converted from $/mile at constant definition).
   * Source: assumed from ERCOT Competitive Renewable Energy Zone (CREZ) transmission cost
   * studies for 138 kV single-circuit line, ~$1.5 M/mile in 2024 USD.
   * Basis: assumed — order-of-magnitude benchmark; replace with ERCOT queue data per project.
   * $1,500,000 / 1609.34 m/mile ≈ $932/m
   */
  txSpurCostPerMeterUsd: number

  /**
   * Flat substation allowance for a 138 kV → distribution transformer.
   * Source: assumed from ERCOT interconnection cost estimates for <20 MW loads,
   * ~$2–4 M for a new delivery point.  Use $3 M as midpoint.
   * Basis: assumed.
   */
  substationAllowanceUsd: number

  /**
   * Fiber conduit cost per metre (underground directional bore in urban/suburban Texas).
   * Source: assumed from industry benchmark ~$60,000–$80,000/mile for
   * underground conduit + pull; use $70,000/mile ≈ $43/m.
   * Basis: assumed.
   */
  fiberConduitPerMeterUsd: number

  /**
   * Entitlement timeline in months by zoning status.
   * - industrial: by-right; fastest (permitting only, no rezoning).
   * - outside-jurisdiction: no county zoning; only ETJ/state permits needed; faster than city.
   * - rezoning-needed: full rezoning cycle; slowest.
   * Source: assumed from San Antonio DSD (Development Services Department) stated timelines
   * for commercial/industrial projects, ~6-12 months by-right, 18-24 months rezoning.
   * Basis: assumed.
   */
  entitlementMonthsByZoning: {
    industrial:           number
    'outside-jurisdiction': number
    'outside-limits':     number
    'unknown-gap':        number
    default:              number  // rezoning-needed or unrecognised
  }

  /**
   * Earthwork unit costs by slope band ($/acre).
   * flat:    0–2% mean slope — minimal grading
   * rolling: 2–5% mean slope — moderate cut/fill
   * steep:   >5% mean slope — heavy cut/fill with import/export
   *
   * Source: assumed from Texas construction cost indices for industrial pad prep.
   * RSMeans 2024 Site Work & Landscape Cost Data, adjusted for San Antonio labour market.
   * Flat: ~$8,000/ac; Rolling: ~$25,000/ac; Steep: ~$55,000/ac.
   * Basis: assumed.
   *
   * NOTE: WO 07 ingest does not capture mean slope (no DEM source wired).
   * Until that gap is filled, all parcels default to 'flat'.
   * A recorded gap in parcel drivers is acceptable; an invented slope is not.
   */
  earthworkFlatUsdPerAcre:    number
  earthworkRollingUsdPerAcre: number
  earthworkSteepUsdPerAcre:   number

  /** Source string for all cost-model assumed constants. */
  costModelSource: string
  /** Date constants were last reviewed. */
  costModelLastReviewed: string
}

export interface CountyConfig {
  // Identity
  id:        string    // e.g. 'bexar'
  name:      string    // e.g. 'Bexar County, Texas'
  state:     string    // two-letter code
  fips:      string    // 5-digit FIPS
  outputKey: string    // filename stem for the generated output files

  // Spatial extent
  bbox: BboxConfig

  // Candidate filter thresholds
  minAcres:         number
  maxDistToTxLineM: number
  floodDropPct:     number   // fraction of parcel area in 100-yr SFHA above which to drop

  // Parcel layer
  parcelSource: ParcelSourceConfig

  // Zoning (nullable = gap)
  zoningSource:           ZoningSourceConfig | null
  zoningGap?:             GapRecord
  industrialZoningPrefixes: string[]

  // Flood
  floodSource: FloodSourceConfig

  // Service territories (nullable = gap)
  territorySource:  TerritorySourceConfig | null
  territoryGap?:    GapRecord
  defaultUtility:   string
  primaryUtility:   PrimaryUtilityConfig

  // Transmission lines
  transmissionSource: TransmissionSourceConfig

  // PeeringDB
  peeringDbUrl: string

  // Appraisal ratios (PVS)
  pvsYear:   string
  pvsSource: string
  pvsRatios: Record<string, { ratio: number; category: string }>

  // Tariffs
  powerRate: PowerRateConfig
  waterRate: WaterRateConfig

  // Parcel cost model
  costModel: CostModelConfig
}

// These are stub shapes for future use when endpoints become available
export interface ZoningSourceConfig {
  url:        string
  cachePrefix:string
  codeField:  string
}

export interface TerritorySourceConfig {
  url:        string
  cachePrefix:string
  nameField:  string
  whereClause:string
}
