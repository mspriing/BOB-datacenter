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
        "land_cost_per_acre_usd":   null,
        "construction_cost_per_kw": null,
        "power_rate_usd_per_kwh":   null,
        "water_rate_usd_per_kgal":  null,
        "staff_cost_index":         null,
        "tax_rate":                 null,
        "incentive_usd":            null,
        "risk_score":               null, // 0–10 (0=best)
        "renewable_pct":            null, // 0–1
        "latency_ms_to_hub":        null
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
        "levelized_cost_per_kw": 1842,      // $/kW; NPV of total cost ÷ capacity_kw
        "npv_usd":               -198000000, // negative = cost NPV
        "payback_years":          7.4,

        "ranges": {
          "low":  { "npv_usd": -178000000, "levelized_per_kw": 1640 },
          "base": { "npv_usd": -198000000, "levelized_per_kw": 1842 },
          "high": { "npv_usd": -231000000, "levelized_per_kw": 2140 }
        }
      },

      "non_cost_scores": {
        "risk_score":    3.2,  // 0=best, 10=worst
        "renewable_pct": 0.68,
        "latency_ms":    14
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

  // Source citations for every regions.json value used in this estimate
  "data_provenance": [
    {
      "region_key":    "us-az-phoenix",
      "driver":        "power_rate_usd_per_kwh",
      "value":         0.042,
      "source_url":    "https://www.eia.gov/electricity/state/arizona/",
      "last_verified": "2025-06"
    }
  ]
}
```

---

## data/regions.json — per-region entry shape

```jsonc
{
  "us-az-phoenix": {
    "label": "Phoenix, AZ",
    "power_rate_usd_per_kwh":   { "value": 0.042, "source_url": "https://…", "last_verified": "2025-06" },
    "water_rate_usd_per_kgal":  { "value": 4.20,  "source_url": "https://…", "last_verified": "2025-04" },
    "land_cost_per_acre_usd":   { "value": 85000, "source_url": "https://…", "last_verified": "2025-03" },
    "construction_cost_per_kw": { "value": 8500,  "source_url": "https://…", "last_verified": "2025-05" },
    "staff_cost_index":         { "value": 1.02,  "source_url": "https://bls.gov/…", "last_verified": "2025-01" },
    "tax_rate":                 { "value": 0.048, "source_url": "https://…", "last_verified": "2025-06" },
    "incentive_usd_per_kw":     { "value": 120,   "source_url": "https://…", "last_verified": "2025-02" },
    "risk_score":               { "value": 3.2,   "source_url": "https://fema.gov/…", "last_verified": "2024-12" },
    "renewable_pct":            { "value": 0.68,  "source_url": "https://www.eia.gov/…", "last_verified": "2025-05" },
    "latency_ms_to_hub":        { "value": 14,    "source_url": "https://…", "last_verified": "2025-04" }
  }
}
```

---

## Validation rules (enforced by Zod)

| Field | Rule |
|---|---|
| `sites` array length | 2–4 items |
| `project.capacity_kw` | 100–500 000 |
| `project.design_pue` | 1.0–3.0 |
| `project.lifetime_years` | 5–40 |
| `project.discount_rate` | 0.01–0.30 |
| `project.weights` sum | Must equal 1.0 (±0.001 tolerance) |
| `site_id` uniqueness | All `site_id` values must be distinct |
| `region_key` | Must exist as a key in `data/regions.json` |
| `overrides.risk_score` | 0–10 if provided |
| `overrides.renewable_pct` | 0–1 if provided |

---

## Frontend feature gate

**No UI feature may be added that is not representable by this schema.** If a new field is needed, update this document first and get sign-off before writing code.
