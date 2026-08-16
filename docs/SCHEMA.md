# leepr — Canonical Input / Output Schema

> **Source of truth.** Both `backend/src/schemas/` (Zod) and `frontend/src/types/schema.ts` are derived from this document. Update here first, then update the code.

---

## POST /estimate

### Request body — `EstimateInput`

```jsonc
{
  "request_id": "uuid-v4",          // optional; generated server-side if absent

  "project": {
    "name":           "string",      // e.g. "ACME Expansion Phase 2"
    "capacity_kw":    10000,         // IT load in kW; range 100–500000
    "design_pue":     1.4,           // power usage effectiveness target; range 1.0–3.0
    "design_wue":     0.4,           // water usage effectiveness (litres/kWh of cooling); range 0.0–2.5
                                     // design assumption set by the user — NOT a regional lookup
    "lifetime_years": 20,            // NPV horizon; range 5–40
    "discount_rate":  0.08,          // WACC, decimal; range 0.01–0.30

    "weights": {                     // must sum to 1.0; all optional (defaults shown)
      "total_cost":     0.50,
      "risk":           0.20,
      "sustainability": 0.15,
      "latency":        0.15
    }
  },

  "sites": [                         // 2–4 items; validated by Zod
    {
      "site_id":    "string",        // unique within request, e.g. "site-A"
      "label":      "string",        // display name, e.g. "Phoenix, AZ"
      "region_key": "string",        // key into data/regions.json

      "free_text":  "string | null", // optional messy description; LLM parses into overrides

      "overrides": {                 // any non-null field supersedes regions.json value
        "land_cost_per_acre_usd":      null,
        "construction_cost_per_kw":    null,
        "power_rate_usd_per_kwh":      null,
        "water_rate_usd_per_kgal":     null,
        "staff_cost_index":            null,
        "tax_rate":                    null,
        "incentive_usd":               null,   // total capital incentive (USD); user-supplied
        "tax_abatement_years":         null,   // years of property-tax abatement; user-supplied; negotiated per deal
        "risk_score":                  null,   // 0–10 (0=best)
        "renewable_pct":               null,   // 0–1
        "low_carbon_pct":              null,   // 0–1; includes nuclear; see regions.json note
        "latency_ms_to_hub":           null,
        "grid_interconnection_years":  null    // years from request to energization; 0–30
      }
    }
  ]
}
```

### Default weights (applied when `project.weights` is omitted or partial)

| Dimension     | Default |
|---------------|---------|
| total_cost    | 0.50    |
| risk          | 0.20    |
| sustainability| 0.15    |
| latency       | 0.15    |

---

## Response body — `EstimateOutput`

```jsonc
{
  "request_id":     "uuid-v4",
  "generated_at":   "ISO-8601",
  "engine_version": "semver",        // bumped on any formula change

  // Ordered array of site_id strings, best → worst
  "ranking": ["site-A", "site-B"],

  // Map of site_id to display label, one entry per submitted site
  "site_labels": { "site-A": "Phoenix, AZ" },

  "sites": {
    "site-A": {

      "rank":           1,
      "weighted_score": 0.812,       // 0–1, higher = better

      "capex": {
        "land_usd":         4200000,
        "construction_usd": 85000000,
        "electrical_usd":   12000000,
        "cooling_usd":       9500000,
        "it_fitout_usd":    18000000,
        "total_usd":       128700000
      },

      "opex_annual": {
        "power_usd":       9200000,
        "water_usd":        420000,
        "staff_usd":       3100000,
        "maintenance_usd": 1800000,
        "taxes_usd":        950000,
        "connectivity_usd": 600000,
        "total_usd":      16070000
      },

      "finance": {
        "capex_per_kw":          12870,      // $/kW; total construction capital ÷ capacity. This is the figure comparable to published data-center build costs.
        "lifetime_cost_per_kw":  1842,       // $/kW; NPV of total cost ÷ capacity_kw
        "npv_usd":               -198000000, // negative = cost NPV
        "payback_years":          7.4,

        "ranges": {
          "low":  { "npv_usd": -178000000, "lifetime_per_kw": 1640 },
          "base": { "npv_usd": -198000000, "lifetime_per_kw": 1842 },
          "high": { "npv_usd": -231000000, "lifetime_per_kw": 2140 }
        }
      },

      "non_cost_scores": {
        "risk_score":        3.2,  // 0=best, 10=worst
        "renewable_pct":     0.68,
        "low_carbon_pct":    0.72, // renewable_pct + nuclear share; null when not available
        "latency_ms":        14,
        "grid_interconnection_years": 3.2  // null when not available
      }
    }
    // … repeated for each submitted site_id
  },

  // Top-5 flip-point drivers, sorted by smallest pct_change (most fragile first)
  "sensitivity": [
    {
      "driver":         "power_rate_usd_per_kwh",
      "current_value":  0.042,
      "flip_value":     0.061,    // value at which rank-1 and rank-2 swap
      "pct_change":     45.2,
      "affected_sites": ["site-A", "site-B"]
    }
  ],

  // Single most fragile flip point, written as a plain-English sentence
  "flip_sentence": "This ranking flips if Phoenix power rates rise above $0.061/kWh (+45%).",

  // LLM-generated paragraph citing engine numbers — no new figures introduced
  "narrative": "string",

  // Fields parsed out of free_text by the LLM/regex extractor, per site
  "parsed_fields": [
    {
      "site_id":  "site-A",
      "field":    "power_rate_usd_per_kwh",
      "value":    0.068,
      "inferred": true    // true when the LLM inferred the value rather than reading it verbatim
    }
  ],

  // Source citations for every regions.json value used in this estimate
  "data_provenance": [
    {
      "region_key":    "us-az-phoenix",
      "driver":        "power_rate_usd_per_kwh",
      "value":         0.042,
      "source_url":    "https://www.eia.gov/electricity/state/arizona/",
      "last_verified": "2025-06"
    }
  ],

  // Drivers that were null for a site and therefore excluded from scoring.
  // The affected driver is dropped from the weighted score; remaining weights
  // are renormalised so the score stays on a 0–1 scale.
  "data_gaps": [
    {
      "site_id": "site-A",
      "driver":  "grid_interconnection_years",
      "reason":  "no value in regions.json"
    }
  ],

  // Counts of how every driver value used in this estimate was sourced.
  // "missing" counts driver slots that were null and excluded from scoring.
  // All four counts sum to (sites × drivers_per_site).
  "confidence": {
    "sourced": 31,
    "modeled": 12,
    "assumed":  4,
    "missing":  5
  }
}
```

---

## data/regions.json — per-region entry shape

```jsonc
{
  "us-az-phoenix": {
    "label":     "Phoenix, AZ",
    "precision": "metro",           // "state" | "metro" | "international"
                                    // tells the UI whether values are a state average or metro-level detail

    "power_rate_usd_per_kwh": {
      "value":         0.042,
      "low":           0.036,
      "high":          0.052,
      "source_url":    "https://…",
      "last_verified": "2025-06",
      "basis":         "sourced",   // REQUIRED. One of:
                                    //   "sourced"  = read directly from the source at source_url
                                    //   "modeled"  = derived from other data; see "method"
                                    //   "assumed"  = benchmark or placeholder; must be replaced
      "method":        null         // OPTIONAL string. Required (non-null) when basis = "modeled".
                                    // Describes the derivation or caveat in plain English.
    },

    // Every driver follows the same six-field shape shown above.

    "water_rate_usd_per_kgal":  { ... },
    "land_cost_per_acre_usd":   { ... },
    "construction_cost_per_kw": { ... },
    "construction_cost_per_mw": { ... },
    "staff_cost_index":         { ... },
    "tax_rate":                 { ... },
    "tax_abatement_years":      { ... },
    "incentive_usd_per_kw":     { ... },
    "risk_score":               { ... },

    // Renewable share — hydro + wind + solar + geothermal + biomass over total generation.
    // Excludes nuclear. A site heavy on nuclear (e.g. Toronto, Paris) scores poorly here.
    "renewable_pct": { ... },

    // Low-carbon share — renewable_pct PLUS nuclear share.
    // Toronto (≈50% nuclear) and Paris (≈65% nuclear) score far better on this metric.
    // Both metrics are carried so the UI can show either or both.
    "low_carbon_pct": { ... },

    "latency_ms_to_hub": { ... },

    // Grid interconnection wait time in years (request → energization).
    // Source is the LBNL generator queue as a proxy for load connection wait;
    // methodology caveat is in the "method" string on every value.
    // null is a valid and correct output when data is unavailable.
    "grid_interconnection_years": { ... }
  }
}
```

> **Note on `wue` (water usage effectiveness):** `wue` was removed from regions.json in this
> revision. WUE is a property of cooling design, not location — the spread between two operators
> in one city is wider than the spread between cities for one operator. Set `project.design_wue`
> in the request body instead (default 0.4 L/kWh, range 0.0–2.5).

---

## Validation rules (enforced by Zod)

| Field | Rule |
|---|---|
| `sites` array length | 2–4 items |
| `project.capacity_kw` | 100–500 000 |
| `project.design_pue` | 1.0–3.0 |
| `project.design_wue` | 0.0–2.5 (default 0.4) |
| `project.lifetime_years` | 5–40 |
| `project.discount_rate` | 0.01–0.30 |
| `project.weights` sum | Must equal 1.0 (±0.001 tolerance) |
| `site_id` uniqueness | All `site_id` values must be distinct |
| `region_key` | Must exist as a key in `data/regions.json` |
| `overrides.risk_score` | 0–10 if provided |
| `overrides.renewable_pct` | 0–1 if provided |
| `overrides.low_carbon_pct` | 0–1 if provided |
| `overrides.grid_interconnection_years` | 0–30 if provided |
| `region.precision` | `"state"` \| `"metro"` \| `"international"` |
| `driver.basis` | `"sourced"` \| `"modeled"` \| `"assumed"` (required on every driver) |

---

## Frontend feature gate

**No UI feature may be added that is not representable by this schema.** If a new field is needed, update this document first and get sign-off before writing code.

---

## Parcel API endpoints

> Phase 2. No API keys, no authentication. Read-only. All reads go through
> `backend/src/parcel/repository.ts`.
>
> Error shape reuses the existing convention:
> `{ "error": "string", "details"?: any }`

---

### GET /parcels

Paged list of parcel summaries — light rows for the map and ranked list.
Full cost breakdowns are in `GET /parcels/:id`.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `county` | string | `bexar` | County key (must match a `CountyConfig.id`) |
| `page` | integer ≥ 1 | `1` | Page number |
| `per_page` | integer 1–200 | `50` | Results per page |
| `bbox` | `minLng,minLat,maxLng,maxLat` | — | Spatial filter; centroid must be inside |
| `min_acres` | number | — | Minimum parcel size |
| `max_acres` | number | — | Maximum parcel size |
| `max_land_cost_per_acre` | number | — | Maximum modeled land cost $/acre |
| `max_dist_tx_m` | number | — | Maximum distance to ≥138 kV line (metres) |
| `exclude_flood` | boolean | `false` | Exclude parcels with `flood_buildable_pct < 1.0` |
| `zoning` | string | — | Comma-separated zoning tags to include (e.g. `outside-jurisdiction,industrial`) |
| `capacity_kw` | integer | `10000` | IT load for scoring (kW) |
| `design_pue` | number | `1.4` | PUE for scoring |
| `lifetime_years` | integer | `20` | NPV horizon for scoring |
| `discount_rate` | number | `0.08` | WACC for scoring |
| `weights` | JSON string | defaults | Ranking weights: `{"total_cost":0.5,"risk":0.2,...}` |
| `sort_by` | `rank`\|`acres`\|`lifetime_cost_per_kw`\|`land_cost_per_acre` | `rank` | Sort field |

**Response 200**

```jsonc
{
  "county":      "bexar",
  "total":       412,          // total matching parcels (before pagination)
  "page":        1,
  "per_page":    50,
  "parcels": [
    {
      "parcel_id":              "155887",
      "address":                "1234 INDUSTRIAL BLVD",
      "acres":                  227.3,
      "zoning":                 "outside-jurisdiction",
      "flood_buildable_pct":    0.97,
      "dist_to_tx_line_m":      1850,
      "dist_to_ixp_km":         14.2,
      "lat":                    29.4512,
      "lng":                   -98.5024,
      "lifetime_cost_per_kw":   1842,
      "capex_per_kw":           12870,
      "land_cost_per_acre_usd": 55176,
      "rank":                   3,
      "weighted_score":         0.782
    }
    // … up to per_page items
  ]
}
```

**Errors**
- `400` — invalid query parameter (Zod validation failure)
- `404` — county not found

---

### GET /parcels/:id

Full `ParcelEstimate` for one parcel (see §ParcelEstimate above for shape).

**Query parameters**: same `capacity_kw`, `design_pue`, `lifetime_years`,
`discount_rate` as the list endpoint (scoring context).

`county` query param selects the county; defaults to `bexar`.

**Response 200** — the full `ParcelEstimate` object (see §ParcelEstimate).

**Errors**
- `404` — `{ "error": "parcel not found", "parcel_id": "..." }`

---

### POST /parcels/search

Structured criteria in, ranked parcel ids and summaries out.
Accepts the same filter vocabulary as `GET /parcels` but as a JSON body
(avoids URL-length limits on large bbox or zoning lists).

**Request body**

```jsonc
{
  "county": "bexar",    // optional; defaults to "bexar"

  "project": {          // scoring context
    "capacity_kw":    10000,
    "design_pue":     1.4,
    "design_wue":     0.4,
    "lifetime_years": 20,
    "discount_rate":  0.08,
    "weights": { "total_cost": 0.5, "risk": 0.2, "sustainability": 0.15, "latency": 0.15 }
  },

  "filters": {          // all optional; omit = no filter on that dimension
    "bbox":                    { "minLng": -99.0, "minLat": 29.1, "maxLng": -98.0, "maxLat": 29.9 },
    "min_acres":               25,
    "max_acres":               500,
    "max_land_cost_per_acre":  80000,
    "max_dist_tx_m":           5000,
    "exclude_flood":           true,
    "zoning":                  ["outside-jurisdiction", "industrial"]
  },

  "pagination": {
    "page":     1,
    "per_page": 50
  }
}
```

**Response 200** — same shape as `GET /parcels` 200.

**Errors**
- `400` — Zod validation failure

---

## ParcelEstimate — per-parcel cost output shape

> Used by `backend/src/parcel/score.ts` → `estimateParcel()` and `scoreAll()`.
> No API route exists yet (Phase 2). This section documents the data shape before
> any backend/src/schemas/ type references it.

```jsonc
{
  // ── Parcel identity ────────────────────────────────────────────────────────
  "parcel_id":    "155887",
  "address":      "1234 INDUSTRIAL BLVD",
  "county":       "bexar",           // CountyConfig.id
  "acres":        227.3,
  "zoning":       "outside-jurisdiction",  // value from ingest row
  "flood_buildable_pct": 0.97,       // 1 = fully buildable; null = no flood data

  // ── Parcel-specific CapEx components ──────────────────────────────────────
  // These costs only exist at parcel grain and are not in the region tool.
  "parcel_capex": {
    "land_cost_usd":          12540000,  // LandVal ÷ PVS ratio; basis: "modeled"
    "interconnect_capex_usd":  4200000,  // dist_to_tx_line_m × $/mile spur + substation
    "fiber_capex_usd":          380000,  // dist_to_ixp_km × $/mile conduit
    "entitlement_cost_usd":    620000,   // entitlement_months × carrying cost on land
    "sitework_usd":             180000,  // slope band → $/acre × acres
    "total_usd":              17920000   // sum of components above
  },

  // ── Full site cost breakdown (from engine) ────────────────────────────────
  // The engine's CapexResult, OpexResult, FinanceResult — same shape as POST /estimate.
  "capex": {
    "land_usd":         12540000,   // = parcel_capex.land_cost_usd (parcel wins region value)
    "construction_usd": 85000000,
    "electrical_usd":   12000000,
    "cooling_usd":       9500000,
    "it_fitout_usd":    18000000,
    "total_usd":       137040000   // engine capex total including parcel_capex components
  },
  "opex_annual": {
    "power_usd":       9200000,
    "water_usd":        420000,
    "staff_usd":       3100000,
    "maintenance_usd": 1800000,
    "taxes_usd":        950000,
    "connectivity_usd": 600000,
    "total_usd":      16070000
  },
  "finance": {
    "capex_per_kw":         13704,   // $/kW; parcel-adjusted total ÷ capacity
    "lifetime_cost_per_kw": 1960,    // $/kW; |NPV| ÷ capacity
    "npv_usd":           -210000000,
    "payback_years":          8.5,
    "ranges": {
      "low":  { "npv_usd": -188000000, "lifetime_per_kw": 1740 },
      "base": { "npv_usd": -210000000, "lifetime_per_kw": 1960 },
      "high": { "npv_usd": -245000000, "lifetime_per_kw": 2290 }
    }
  },

  // ── Composite score and ranking ───────────────────────────────────────────
  "rank":           1,               // position within the scored county set
  "weighted_score": 0.782,           // 0–1, higher = better; same formula as region tool
  "non_cost_scores": {
    "risk_score":                 null,
    "renewable_pct":              null,
    "low_carbon_pct":             null,
    "latency_ms":                 null,
    "grid_interconnection_years": null
  },

  // ── Provenance ────────────────────────────────────────────────────────────
  // One entry per driver value used in this estimate.
  // Same shape as data_provenance in POST /estimate.
  // "region_key" is the county region key (e.g. "us-tx-ercot") when the value
  // came from regions.json, or the parcel_id when measured at parcel grain.
  "provenance": [
    {
      "region_key":    "155887",          // parcel_id for parcel-grain figures
      "driver":        "land_cost_per_acre_usd",
      "value":         55176,
      "source_url":    "https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query",
      "last_verified": "2025-08"
    },
    {
      "region_key":    "us-tx-ercot",     // region key for county-fallback figures
      "driver":        "construction_cost_per_kw",
      "value":         850,
      "source_url":    "https://…",
      "last_verified": "2025-06"
    }
    // … one entry per driver
  ],

  // ── Gaps ──────────────────────────────────────────────────────────────────
  // Drivers with no figure. Same shape as data_gaps in POST /estimate.
  "gaps": [
    {
      "driver": "grid_interconnection_years",
      "reason": "ERCOT queue data requires Docling PDF pipeline; value is null until populated"
    }
  ],

  // ── Confidence summary ────────────────────────────────────────────────────
  "confidence": {
    "sourced": 4,
    "modeled": 3,
    "assumed": 2,
    "missing": 1
  }
}
```

### ParcelProject — project parameters for parcel scoring

Same as the `project` object in `POST /estimate`, reused without change.
`scoreAll(rows, project, county)` accepts a `ParcelProject`.

```jsonc
{
  "capacity_kw":    10000,
  "design_pue":     1.4,
  "design_wue":     0.4,
  "lifetime_years": 20,
  "discount_rate":  0.08,
  "weights": {
    "total_cost":     0.50,
    "risk":           0.20,
    "sustainability": 0.15,
    "latency":        0.15
  }
}
```

### Parcel-specific CapEx constants (stored in CountyConfig.costModel)

Every constant must carry a `method` string explaining its derivation.
A number with no defensible origin is `basis: "assumed"` and visible in confidence counts.

| Constant | Description | Basis |
|---|---|---|
| `txSpurCostPerMileUsd` | Transmission spur build cost per mile (single-circuit 138 kV) | assumed |
| `substationAllowanceUsd` | Flat substation allowance per project (sized to capacity) | assumed |
| `fiberConduitPerMileUsd` | Fiber conduit cost per mile (directional bore, underground) | assumed |
| `entitlementMonthsByZoning` | Months of entitlement by zoning status (`industrial`, `outside-jurisdiction`, `rezoning-needed`) | assumed |
| `earthworkFlatUsdPerAcre` | Earthwork unit cost for flat sites (0–2% mean slope) | assumed |
| `earthworkRollingUsdPerAcre` | Earthwork unit cost for rolling sites (2–5% mean slope) | assumed |
| `earthworkSteepUsdPerAcre` | Earthwork unit cost for steep sites (>5% mean slope) | assumed |
| `regionKey` | regions.json key for county-level fallback drivers | — |

---

## GET /health

Returns `200 OK` with a small JSON body:

```json
{ "status": "ok", "service": "leepr-backend" }
```

This endpoint is the **deployment health check** used by Render to decide whether the backend
service is alive. Do not remove it and do not change the path — removing it will cause Render
to mark the service as unhealthy and stop routing traffic to it.
