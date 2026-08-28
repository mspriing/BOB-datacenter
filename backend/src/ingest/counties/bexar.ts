/**
 * backend/src/ingest/counties/bexar.ts
 *
 * County-specific configuration for Bexar County, Texas.
 * All literals that are Bexar-specific live here.  The pipeline has none.
 *
 * Phase 4 note: adding Loudoun County means creating
 * backend/src/ingest/counties/loudoun.ts with the same shape.
 */

import type { CountyConfig } from '../countyConfig.js'

export const bexarConfig: CountyConfig = {
  // ── Identity ──────────────────────────────────────────────────────────────
  id:        'bexar',
  name:      'Bexar County, Texas',
  state:     'TX',
  fips:      '48029',
  outputKey: 'bexar',

  // ── Spatial extent ────────────────────────────────────────────────────────
  bbox: { minLng: -99.5, minLat: 29.0, maxLng: -97.9, maxLat: 30.0 },

  // ── Candidate filter thresholds ───────────────────────────────────────────
  // 10 acres. A 10 MW campus occupies roughly 12 acres at 1.2 acres per MW, so
  // this admits smaller infill industrial sites as well as greenfield.
  minAcres:         10,
  maxDistToTxLineM: 8_000,   // 8 km to nearest ≥138 kV line
  floodDropPct:     0.25,    // drop parcel if >25% area in 100-yr SFHA

  // ── BCAD parcel layer ─────────────────────────────────────────────────────
  parcelSource: {
    url:          'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0',
    cachePrefix:  'bcad-parcels',
    acresField:   'Acres',
    acresFallback:'LglAcres',
    idField:      'PropID',
    addressField: 'Situs',
    stateCodeField:'State_cd',
    landValField: 'LandVal',
    // State codes that indicate developable parcels
    // https://comptroller.texas.gov/taxes/property-tax/docs/96-313.pdf
    allowedStateCodes: new Set(['F1', 'F2', 'C1', 'C2', 'D1', 'D2', 'E1', 'G1']),
    excludedStateCodes: new Set(['A1', 'A2', 'A3', 'B1', 'B2', 'X', 'X1', 'S1']),

    // ── Ownership and exemption screening ──────────────────────────────────
    //
    // Decoded from a 400-parcel live sample of BCAD on 2026-08-17. These are
    // judgement calls and a later reader should feel free to argue with them.
    //
    //   EX-XV   65% of exempt parcels — Texas Tax Code §11.11, property owned
    //           by the state or a political subdivision. The city parks and the
    //           San Antonio Water System land that were ranking first.
    //   EX-XJ   private schools.   EX-XI  charitable organisations.
    //   HS, OV65, DV4, DVHS, FRSS — homestead, over-65, disabled-veteran and
    //           surviving-spouse exemptions on PRIVATE property. Those parcels
    //           are purchasable; the exemption only tells us someone lives there.
    //
    // Agricultural land does not appear in this field at all: D1 open-space is
    // a special appraisal, not an exemption. So screening EX-* removes
    // institutional land without touching the greenfield a campus would use.
    exemptField: 'Exempts',
    ownerField:  'Owner',
    institutionalExemptPrefixes: ['EX-'],
    occupancyExemptPrefixes: ['HS', 'OV65', 'DV4', 'DVHS', 'FRSS'],
    governmentOwnerPatterns: [
      'CITY OF', 'COUNTY', 'STATE OF', 'ISD', 'SCHOOL',
      'UNITED STATES', 'SAN ANTONIO WATER',
    ],

    // $1,000/acre. Raw land in Bexar does not trade below this; 136 parcels
    // sit under it, including a 1,323-acre parcel appraised at $0 an acre.
    minLandValuePerAcre: 1_000,
  },

  // ── Zoning source ─────────────────────────────────────────────────────────
  // STATUS: GAP — see zoningGap below
  zoningSource: null,
  zoningGap: {
    urlsTried: [
      'https://services.arcgis.com/g3ToTjWotgngStr3/arcgis/rest/services/Zoning_Districts/FeatureServer/0',
      'https://gis.sanantonio.gov/arcgis/rest/services/Planning/Zoning/FeatureServer/0',
      'https://gis.sanantonio.gov/arcgis/rest/services/Zoning/FeatureServer/0',
      'https://services.arcgis.com/g3ToTjWotgngStr3/arcgis/rest/services/Zoning/FeatureServer/0',
      'https://services.arcgis.com/g3ToTjWotgngStr3/arcgis/rest/services/COSA_Zoning/FeatureServer/0',
    ],
    probedDate: '2025-08-16',
    outcome: 'g3ToTjWotgngStr3 org returns {"error":{"code":400,"message":"Invalid URL"}} on all service paths. ' +
      'gis.sanantonio.gov returns {"error":{"code":499,"message":"Token Required"}} — ' +
      'internal-only, not publicly accessible. No replacement found.',
    // Texas counties have no general zoning authority.
    // Unincorporated parcels → outside-jurisdiction (not unknown-gap).
    note: 'Parcels outside San Antonio city limits carry tag "outside-jurisdiction". ' +
      'Parcels inside city limits cannot be classified by code without this layer.',
  },

  // Industrial / heavy-commercial zoning prefixes (COSA UDC codes)
  industrialZoningPrefixes: ['I-1', 'I-2', 'BP', 'O/I', 'MXD', 'MPCD'],

  // ── Flood source ──────────────────────────────────────────────────────────
  floodSource: {
    url:         'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28',
    expectedLayerName: 'Flood Hazard Zones',
    cachePrefix: 'fema-nfhl-bexar',
    // Query by DFIRM_ID prefix for Bexar County (FIPS 48029); C series for CID ranges
    whereClause: "DFIRM_ID LIKE '48029%' OR DFIRM_ID LIKE '48C%'",
    dropZones:   new Set(['A', 'AE', 'AO', 'AH', 'VE', 'V']),
    flagZones:   new Set(['X500', 'X_500', 'B']),
  },

  // ── Service territory source ──────────────────────────────────────────────
  // STATUS: GAP — see territoryGap below
  territorySource: null,
  territoryGap: {
    urlsTried: [
      'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Retail_Service_Territories/FeatureServer/0',
      'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Elec_Retail_Service_Territories/FeatureServer/0',
      'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Service_Territories/FeatureServer/0',
      'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Utility_Service_Area/FeatureServer/0',
      'https://services2.arcgis.com/FiaFA6OHVYrXZjRv/arcgis/rest/services/Electric_Retail_Service_Territories/FeatureServer/0',
    ],
    probedDate: '2025-08-16',
    outcome: 'HIFLD Open was archived ~Oct 2025. All service-territory paths on ' +
      'Hp6G80Pky0om7QvQ return {"error":{"code":400,"message":"Invalid URL"}}. ' +
      'FiaFA6OHVYrXZjRv org likewise. Transmission-lines layer on the same Hp6G80Pky0om7QvQ ' +
      'host is still live (separate service path). No replacement found for territories.',
  },
  defaultUtility: 'assumed-CPS-Energy',
  primaryUtility: {
    match: 'CPS',
    jurisdictionLabel: 'City of San Antonio (CPS Energy territory)',
  },

  // ── Transmission lines source ─────────────────────────────────────────────
  transmissionSource: {
    url:          'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0',
    cachePrefix:  'hifld-tx-lines-138kv',
    // No STATE_1 field exists on this layer — its presence made the whole query
    // fail with "Cannot perform query. Invalid query parameters." The envelope
    // below already restricts results to the county, so the predicate was
    // redundant as well as wrong. Verified: 335 lines returned for Bexar.
    whereClause:  'VOLTAGE >= 138',
    voltageField: 'VOLTAGE',
    minKv:        138,
  },

  // ── PeeringDB fiber/IXP ───────────────────────────────────────────────────
  peeringDbUrl: 'https://www.peeringdb.com/api/fac?city=San+Antonio&state=TX&country=US',

  // ── Texas Comptroller PVS appraisal ratios (Bexar CAD, 2024) ─────────────
  // Hand-read from https://comptroller.texas.gov/taxes/property-tax/pvs/pvs-2024-summary.php
  // PDF; values carry basis='modeled'.
  pvsYear: '2024',
  pvsSource: 'https://comptroller.texas.gov/taxes/property-tax/pvs/pvs-2024-summary.php',
  pvsRatios: {
    'F1': { ratio: 0.93, category: 'F1 (Commercial real property)' },
    'F2': { ratio: 0.91, category: 'F2 (Industrial real property)' },
    'D1': { ratio: 0.85, category: 'D1 (Open-space ag land)' },
    '__aggregate__': { ratio: 0.94, category: 'Bexar CAD aggregate (all categories)' },
  },

  // ── Power tariff — CPS Energy Schedule LG ────────────────────────────────
  powerRate: {
    valueUsdPerKwh: 0.0385,
    source_url:     'https://www.cpsenergy.com/content/dam/doc/rates/LG.pdf',
    last_verified:  '2024-03',
    low:            0.033,
    high:           0.045,
    method:         'CPS Energy Rate Schedule LG (Large General Service), energy charge component, March 2024 tariff',
  },

  // ── Water tariff — SAWS ───────────────────────────────────────────────────
  waterRate: {
    valueUsdPerKgal: 7.51,
    source_url:      'https://www.saws.org/your-account/rates/',
    last_verified:   '2024-07',
    low:             6.50,
    high:            8.50,
    method:          'SAWS Uniform Rate Schedule Tier 3+ commercial rate, FY2024',
  },

  // ── Parcel cost model ─────────────────────────────────────────────────────
  costModel: {
    // Region key for county-level fallback drivers from data/regions.json
    regionKey: 'us-tx-ercot',

    // Transmission spur: $1,500,000/mile ÷ 1609.34 m/mile ≈ $932/m
    // ERCOT CREZ transmission cost study (138 kV single-circuit, 2024 USD)
    // Basis: assumed — order-of-magnitude; replace with ERCOT queue cost estimate per project
    txSpurCostPerMeterUsd: 932,

    // Substation allowance: $3,000,000 flat per new delivery point
    // ERCOT interconnection cost estimates for <20 MW loads, ~$2–4 M midpoint
    // Basis: assumed
    substationAllowanceUsd: 3_000_000,

    // Fiber conduit: $70,000/mile ÷ 1609.34 m/mile ≈ $43.50/m
    // Underground directional bore, urban/suburban Texas, including pull
    // Source: industry benchmark; basis: assumed
    fiberConduitPerMeterUsd: 43.5,

    // Entitlement months by zoning status
    // Source: San Antonio DSD stated timelines for commercial/industrial projects
    // Basis: assumed
    entitlementMonthsByZoning: {
      industrial:               6,   // by-right industrial permit only
      'outside-jurisdiction':  10,   // no city zoning; ETJ/state permits; faster than city rezoning
      'outside-limits':        10,   // outside city limits — similar to outside-jurisdiction
      'unknown-gap':           14,   // zoning unknown; conservative estimate
      default:                 24,   // rezoning cycle for non-industrial city parcels
    },

    // Earthwork unit costs by slope band ($/acre)
    // RSMeans 2024 Site Work & Landscape Cost Data, San Antonio labour market adjustment
    // NOTE: WO 07 ingest does not capture mean slope. All parcels currently default to flat.
    // Basis: assumed
    earthworkFlatUsdPerAcre:     8_000,
    earthworkRollingUsdPerAcre: 25_000,
    earthworkSteepUsdPerAcre:   55_000,

    costModelSource:       'ERCOT CREZ cost studies; RSMeans 2024 Site Work; San Antonio DSD stated timelines; industry benchmarks',
    costModelLastReviewed: '2025-08',
  },
}
