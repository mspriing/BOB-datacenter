# Work order 08 — parcel TCO drivers and cost model

Phase 1. Read `docs/work-orders/00-parcel-product-brief.md` and `AGENTS.md` first.

Branch: `parcel/phase1-tco`. Prerequisite: work order 07 is merged and `data/parcels/bexar.rows.json` exists.

---

## Context

`backend/src/engine/` already prices a site: CapEx, OpEx, NPV, payback, lifetime cost per kW, low/base/high range, ranking, and the sensitivity flip. It takes a `SiteDrivers` bundle and does not care where the drivers came from.

A parcel is a site with better-resolved drivers, **plus** capital costs that only exist at parcel grain: you must reach the transmission line, reach the fibre, get through entitlement, and level the ground. Those are the costs a region-level tool cannot see, and they are the reason this product exists.

Do not modify `backend/src/engine/`. Compose on top of it.

---

## Task 1 — write the schema first

`docs/SCHEMA.md` is the source of truth and gets updated before any code.

Add a `ParcelEstimate` section documenting the per-parcel output: parcel identity and geometry reference, acreage, the full existing cost breakdown, the new parcel-specific capex components below, `flood_buildable_pct`, and a `provenance` array in the same shape the region tool already uses.

**Acceptance.** `docs/SCHEMA.md` describes the shape before `backend/src/schemas/` mentions it.

**Commit.** `docs(schema): parcel estimate output shape`

---

## Task 2 — the driver adapter

Create `backend/src/parcel/drivers.ts` exporting `driversForParcel(row, county): SiteDrivers`, mapping an ingest row onto the bundle `priceSite()` already accepts.

Where a parcel has a real figure — land value, flood, distance to transmission — it wins. Where it does not, fall back to the county-level figure from `data/regions.json` and **mark the basis accordingly**: a county fallback is not a parcel measurement, and the output must say so.

**Acceptance.** A unit test asserts that a parcel with a null `LandVal` falls back to the county figure and that the resulting driver's `basis` is not `sourced`.

**Commit.** `feat(parcel): driver adapter from ingest rows`

---

## Task 3 — parcel-specific capital costs

Create `backend/src/parcel/cost.ts`. Each component is a named, tested function with its assumptions stated as constants in the county config, not inline literals.

| Component | Derivation |
|---|---|
| `interconnect_capex_usd` | distance to nearest ≥138 kV line × $/mile transmission spur + substation allowance sized to `capacity_kw` |
| `fiber_capex_usd` | distance to nearest PeeringDB facility × $/mile conduit |
| `entitlement_cost_usd` | `entitlement_months` of carrying cost on land value at the project discount rate |
| `sitework_usd` | mean slope band → earthwork $/acre × acres |
| `land_cost_usd` | `LandVal` ÷ PVS appraisal ratio, `basis: 'modeled'` |

`entitlement_months` comes from zoning status: by-right industrial is fastest, rezoning slowest, `outside-jurisdiction` (unincorporated Bexar, where Texas counties have no zoning authority) faster than either. Put the month figures in the county config where they can be argued with.

Every constant needs a `method` string explaining where it came from. A number with no defensible origin is `assumed` and must be visible as such — including in the coverage counts.

**Acceptance.** Tests in `backend/tests/parcelCost.test.ts` cover each component independently, including the zero cases: a parcel on top of a transmission line adds no spur cost; a flat parcel adds no earthwork.

**Commit.** `feat(parcel): interconnect, fibre, entitlement and sitework costs`

---

## Task 4 — compose into a full parcel estimate

Create `backend/src/parcel/score.ts` exporting `estimateParcel(row, project, county)` — parcel capex added to the engine's site pricing, returning the `ParcelEstimate` from task 1 — and `scoreAll(rows, project, county)` for the whole county.

`scoreAll` runs once and caches. Re-ranking under different weights must re-sort the cached array, **not** recompute costs. Weights do not change any cost, only the composite score, and the code should make that obvious.

**Acceptance.** `scoreAll` over the full Bexar candidate set completes in under 5 seconds on a cold run and under 100 ms on a re-rank. State both measured numbers in the commit message.

**Commit.** `feat(parcel): full parcel estimate and batch scoring`

---

## Task 5 — provenance and gaps

Every `ParcelEstimate` carries a `provenance` array in the same shape the region tool emits today, plus a `gaps` list naming drivers with no figure.

`grid_interconnection_years` stays `assumed` with a null value until an ERCOT queue pipeline exists. Do not model it from anything. In 2026 interconnection timing dominates siting economics, so a fabricated wait time is the single most misleading number this tool could emit.

**Acceptance.** A test asserts that no `ParcelEstimate` contains a figure absent from its `provenance` array.

**Commit.** `feat(parcel): provenance and gap reporting`

---

## Definition of done

- Any parcel id yields a full cost breakdown where every figure traces to a source or a stated formula.
- Backend suite passes; report the new count.
- `backend/src/engine/` is unchanged — verify with `git diff --stat main -- backend/src/engine/`.
- No API route, no frontend, no LLM work.
