# BOB-datacenter — Canonical Input / Output Schema

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

## GET /health

Returns `200 OK` with a small JSON body:

```json
{ "status": "ok", "service": "bob-datacenter-backend" }
```

This endpoint is the **deployment health check** used by Render to decide whether the backend
service is alive. Do not remove it and do not change the path — removing it will cause Render
to mark the service as unhealthy and stop routing traffic to it.
