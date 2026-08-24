# Parcel-grain TCO — build plan

> Status: proposal, not yet implemented. Written 2026-08-16.
> Every endpoint claim in the "Data inventory" section was probed live on that date; results are recorded as measured, not assumed.

## What changes

Today leepr answers **"which of these 3 regions is cheapest?"** The user brings the candidates.

The parcel tool answers **"which of these 3,516 parcels should I look at?"** The tool brings the candidates. That inversion — from scoring a supplied set to ranking a discovered one — is the whole design problem. It drives every decision below:

| | Today | Parcel tool |
|---|---|---|
| Unit | 63 regions (state/metro) | ~3,500 candidate parcels per county |
| Input | user picks 2–4 | user states criteria; tool finds them |
| Engine runs | 3 per request | 3,500 precomputed, re-ranked per request |
| Map | hand-drawn state SVG | real basemap + parcel polygons |
| Land price | one figure per region | per-parcel, from the assessor |

The existing cost engine survives intact. `priceSite()` already takes a drivers bundle and returns a full CapEx/OpEx/NPV breakdown; a parcel is just a site with better-resolved drivers. What's new is the discovery layer around it.

---

## Data inventory (probed 2026-08-16)

### Verified working

| Source | Endpoint | Result |
|---|---|---|
| **BCAD parcels** | `maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0` | **710,772 parcels.** Fields include `LandVal`, `ImprVal`, `Acres`, `State_cd`, `Owner`, `PropUse`, `Situs` |
| **HIFLD transmission lines** | `services1.arcgis.com/Hp6G80Pky0om7QvQ/.../Electric_Power_Transmission_Lines/FeatureServer/0` | live, voltage attribute present |
| **PeeringDB** | `peeringdb.com/api/fac?city=San Antonio` | 5 facilities |
| **FEMA NFHL** | `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` | live — layer 28 is "Flood Hazard Zones" |

BCAD candidate funnel, measured:

```
all parcels                            710,772
acres >= 10                             10,264
acres >= 25                              3,516
acres >= 50                              1,623
  of which state_cd D* (ag/open space)   1,457
  of which state_cd F* (comm/industrial)   475
  of which state_cd C* (vacant)            202
```

Sample record, real: `JCB TEXAS LLC`, 227.3 ac, `LandVal` $6,472,390, `State_cd` F2 → **$28,475/acre appraised**. A neighbouring parcel is owned by `TX SOLAR I LLC` — already energy-adjacent land, which is exactly the signal the tool should surface.

### Broken in the existing script

`backend/src/scripts/ingestParcels.ts` exists but **has never run successfully** — there is no `data/raw/` and no `data/parcels-bexar.geojson`. Four defects, all confirmed:

1. **Wrong field names.** It queries `GIS_ACRES`, `STATE_CD`, `LND_VAL`, `PROP_ID`, `SITUS_NUM`. The layer actually has `Acres`, `State_cd`, `LandVal`, `PropID`, `Situs`. The very first query (`where: GIS_ACRES >= 10`) returns an ArcGIS error, so the run dies at source 1.
2. **FEMA URL 404s.** It uses `/gis/nfhl/rest/services/public/NFHLWMS/MapServer/28`. Correct base is `/arcgis/rest/services/public/NFHL/MapServer/28`.
3. **COSA zoning URL is dead** (`Invalid URL`). Needs rediscovery on the San Antonio open-data portal.
4. **HIFLD service territories URL is dead** (`Invalid URL`) — HIFLD Open was archived around Oct 2025 and layers moved. The transmission-lines layer still resolves; the territories one does not.

### Geometry bugs worth fixing before scaling

The script's spatial math is approximate in ways that matter at parcel grain:

- `minDistToLines` measures to the nearest **vertex** of a transmission line, not the nearest point on the **segment**. On sparsely-digitised long-haul lines this overstates distance badly — a parcel sitting under the middle of a 3 km span reads as 1.5 km away.
- Every containment test uses the parcel **centroid**. A 460-acre parcel is either in the flood zone or not; centroid-only turns a partial overlap into a coin flip.

Fix: use `@turf/turf` for real polygon intersection and point-to-line distance. Report flood as *percent of parcel area affected*, not a boolean — buildable-area-after-flood is a genuine cost driver.

### Needed, not yet wired

| Need | Source | Access reality |
|---|---|---|
| Interconnection wait | ERCOT Large Load Integration, TAC reports | **PDF only.** Queue hit ~238.6 GW (Mar 2026), 77.5% data centers; >438 GW by mid-2026, ~90% data centers |
| Generation queue context | [LBNL Queued Up 2026](https://emp.lbl.gov/queues) | Excel, project-level, CC BY 4.0. Generation only, not load |
| Large-load rules | TX SB6 / PUCT 16 TAC 25.194 | Financial security, site control, batch studies, curtailment obligations for loads ≥75 MW |
| Utility tariff | CPS Energy | Large load defined as **>40 MW**; study fees $75k–$150k; BTM generation tariff piloting |
| Sale comps | — | **Texas is a non-disclosure state.** No public sale prices. See risk below |
| Terrain / sitework | USGS 3DEP DEM | slope → earthwork cost |
| Fiber routes | PeeringDB + FCC broadband | long-haul conduit routes are largely proprietary |

---

## Which county

Scored on what actually determines whether the tool can be built and trusted:

| | Bexar TX | Loudoun VA | Maricopa AZ | Franklin OH |
|---|---|---|---|---|
| Parcel data open + rich | **verified rich** | 238 open datasets | good | good |
| Sale prices public | **no** (non-disclosure) | yes | yes (affidavit of value) | yes |
| Zoning binding + digitised | city only¹ | **yes, official layer** | yes (PlanNet) | yes |
| Market activity | 30 built, 23 proposed | **largest on earth** | growing fast | growing fast |
| Ground truth to validate against | no | **published DC + substation map, updated 6-monthly** | no | no |
| Power market | CPS municipal — one tariff | Dominion, queue-constrained | APS/SRP | AEP Ohio |
| Land headroom for discovery | **high** | low, mostly spoken for | medium | medium |

¹ Texas counties have no general zoning authority. Outside San Antonio city limits, unincorporated Bexar has effectively no zoning constraint — which simplifies the model but also means "zoning" is a thin driver there.

### Recommendation: build on Bexar, validate against Loudoun

**Bexar stays the primary.** Your instinct was right, for reasons beyond the existing scaffolding:

- The parcel layer is verified rich — land value per parcel, acreage, use code, owner, all queryable today with no scraping and no login.
- CPS Energy being a single municipal utility is an underrated advantage: **one tariff to model instead of a dozen retail providers.** Ironically the "less deregulated" county is the easier one to price.
- Cheap land is where a discovery tool earns its keep. In Loudoun the answer is "there is no land"; in Bexar the answer is a ranked list, which is the product you're describing.
- The market is real and moving — 324 MW today heading toward 3,300 MW by 2033 — so the output is decision-relevant rather than academic.

**Add Loudoun as a validation county, not a second product.** Loudoun publishes an interactive map of existing, approved, and proposed data centers *with substations*, refreshed every six months. That is a labelled test set. You can run your scorer over Loudoun parcels as of some past date and ask: **would my model have ranked the parcels that actually got built?** Without that check, a TCO score is an opinion. This is the single highest-value thing on this plan and it costs one ingest adapter.

**If Texas non-disclosure proves fatal** to land pricing, Maricopa is the fallback: disclosure state, county-level zoning authority, real growth, good open data.

---

## Architecture

### Backend

Keep `AGENTS.md` rule 1 absolutely: **no cost math in the LLM layer.** The AI parses criteria; the engine prices.

```
backend/src/
  ingest/
    sources/{bcad,zoning,fema,hifld,peeringdb,terrain}.ts   one module per source
    join.ts             turf-based spatial joins
    pipeline.ts         orchestrates → data/parcels/<county>.geojson + .meta.json
  engine/               UNCHANGED — priceSite/rank already do the work
  parcel/
    drivers.ts          parcel record → SiteDrivers (the adapter)
    interconnect.ts     dist + voltage → substation/line capex
    entitlement.ts      zoning status → months → carrying cost
    score.ts            batch-score all parcels, cache by criteria hash
  routes/
    parcels.ts          GET /parcels, GET /parcels/:id, POST /parcels/search
    estimate.ts         UNCHANGED — compare view still works
  llm/
    parseCriteria.ts    NL → structured filters + weights (extends parseInput.ts)
```

**Storage.** Start with precomputed GeoJSON plus an in-memory [Flatbush](https://github.com/mourner/flatbush) index — 3,500 parcels is nothing, it fits in RAM and needs no new infrastructure. Move to **PostGIS the moment you add a second county**; the ingest output shape should already be table-shaped so that migration is a loader, not a rewrite. Do not build PostGIS on day one.

**Scoring.** Precompute per-parcel drivers and the full cost breakdown at ingest time. At request time only the *weighting* changes, which is a cheap re-sort over a cached array. Cache keyed on `hash(criteria)`.

### New parcel-grain drivers

Beyond the existing region drivers, each of these is a real line item in the amalgamated cost:

| Driver | Derivation | Basis |
|---|---|---|
| `land_cost_usd` | `LandVal` ÷ PVS level-of-appraisal ratio × acres | modeled |
| `interconnect_capex_usd` | distance to ≥138 kV × $/mile + substation allowance | modeled |
| `interconnect_wait_years` | CPS/ERCOT queue position | assumed until PDF pipeline lands |
| `fiber_capex_usd` | distance to nearest PeeringDB facility × $/mile conduit | modeled |
| `entitlement_months` | zoning status → carrying cost at discount rate | modeled |
| `flood_buildable_pct` | 1 − (parcel area ∩ SFHA) ÷ area | sourced |
| `sitework_usd` | mean slope from 3DEP → earthwork $/acre | modeled |
| `water_avail_gpd` | SAWS service area + capacity | sourced |

Every one carries `basis` / `source_url` / `last_verified` / `method`, exactly as `regions.json` does now. **The honesty discipline is the moat** — a parcel tool that says "this figure is modeled, here's the formula" is worth more to a developer than one that emits a confident wrong number. Keep the sourced/modeled/assumed badge system from the current UI.

### Frontend

The hand-drawn state SVG doesn't extend to parcels. For the parcel view:

- **MapLibre GL JS** with a free vector basemap (OpenFreeMap or self-hosted Protomaps `.pmtiles`). No API key, no per-tile billing, consistent with the project's no-proprietary-dependency posture.
- 3,500 parcels ship fine as a GeoJSON source. Only reach for `tippecanoe` → pmtiles when a county exceeds ~50k features.
- Keep the existing state map as the national overview; the parcel map is a drill-down.

Screens:

| Screen | Content |
|---|---|
| **Search** | map + filter rail (acres, $/acre, distance to transmission, flood, zoning) + ranked result list, all three bound to one state |
| **Parcel detail** | full TCO waterfall, provenance table, "what's missing here" gaps panel — reuse `Card`, `Explain`, `Counter`, `StatTile` as-is |
| **Compare** | existing Results screen, fed 2–4 parcels instead of regions. Nearly free given the fix already landed |
| **Criteria** | NL box → parsed filters shown back for confirmation before applying |

The criteria box must **show the parsed interpretation before acting on it**, same as the free-text parser does today. Never silently act on an LLM reading of the user's intent.

---

## Phases

**Phase 0 — repair and prove the pipeline (~1 week).**
Fix the four broken source references, swap centroid math for turf, rediscover the two dead URLs. Ship `data/parcels/bexar.geojson` plus a coverage table. *Done when:* a candidate count and a per-driver sourced/modeled/assumed table print, and re-running produces an identical file.

**Phase 1 — parcel TCO.**
`parcel/drivers.ts` adapter, the new cost components, tests mirroring `backend/tests/engine.test.ts`. *Done when:* any parcel returns a full breakdown where every figure traces to a source or a stated formula.

**Phase 2 — API and map.**
`/parcels` endpoints, MapLibre search screen, parcel detail. *Done when:* a stranger can find the ten cheapest 50-acre parcels within 5 km of 138 kV without reading docs.

**Phase 3 — criteria AI.**
NL → filters + weights, with confirmation UI.

**Phase 4 — validate, then generalise.**
Run the Loudoun ground-truth check. Publish hit-rate honestly. Only then add county two — and let that adapter's shape prove the abstraction before promising "nationwide."

---

## Risks and open decisions

**Texas non-disclosure is the real one.** No public sale prices means land cost is appraised-value-divided-by-a-ratio — a model, not a market price, and appraisal districts lag hot markets badly. Mitigations: label it `modeled` and show the formula (already the house style); widen the low/high band on land specifically; consider commercial comps (CoStar/Reonomy) if this ever needs to be defensible to someone spending real money. **Do not let a modeled land price render as a market quote.**

**The queue is the binding constraint and it's in PDFs.** In 2026 ERCOT interconnection timing dominates siting economics far more than land price does. Getting `interconnect_wait_years` out of `assumed` requires a PDF pipeline against ERCOT TAC reports. Until then, say so on screen.

**San Antonio's data-center policy is being written right now.** Council is actively developing DC-specific zoning and community-benefit rules. Anything you model about entitlement in the city is a moving target; unincorporated county land is more stable.

## Decisions taken (2026-08-16)

1. **LLM provider stays watsonx / Granite.** No pluggable abstraction. The deterministic fallback continues to cover credential outages, so demos never depend on the model being reachable.
2. **PostGIS at county two, not now.** Conditional on Phase 0 emitting table-shaped rows alongside GeoJSON and routing all reads through a single repository module — see work order 07, task 6. Without that, the migration is a rewrite; with it, it's a loader plus one interface implementation.
3. **Loudoun validation is in scope.** Lands as Phase 4. Phase 0 must therefore parameterise the pipeline by county config rather than hardcoding Bexar.
4. **AI layer = criteria parsing, plus a short per-parcel narrative.** The narrative is written from the *driver data and its provenance*, not from the parcel's identity — no prose about owners, neighbourhoods, or what a site "feels like." It explains which figures drive the number and how well-sourced they are, citing the engine's values under the existing `AGENTS.md` rule that the LLM never produces a number. At 3,500-parcel scale this must be generated on demand for the parcel being viewed, never batch-generated for the whole set.
