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

export interface CountyConfig {
  // Identity
  id:        string    // e.g. 'bexar'
  name:      string    // e.g. 'Bexar County, Texas'
  state:     string    // two-letter code
  fips:      string    // 5-digit FIPS
  outputKey: string    // filename stem (data/parcels/<outputKey>.geojson)

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
