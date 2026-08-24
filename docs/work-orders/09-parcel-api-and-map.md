# Work order 09 — parcel API and map interface

Phase 2. Read `docs/work-orders/00-parcel-product-brief.md` and `AGENTS.md` first.

Branch: `parcel/phase2-ui`. Prerequisite: work order 08 merged.

---

## Context

The engine can price a parcel. Nothing can reach it yet. This work order makes it usable: three endpoints and two screens.

The region tool must keep working exactly as it does today. `POST /estimate`, the state map, Setup, Running and Results are untouched. The parcel tool is added alongside, not on top.

---

## Task 1 — schema first

Update `docs/SCHEMA.md` with three endpoints before writing code:

- `GET /parcels` — paged summary list; bbox and filter query params; returns light rows for the map and list, not full estimates
- `GET /parcels/:id` — one full `ParcelEstimate`
- `POST /parcels/search` — structured criteria (filters + weights) in, ranked parcel ids and summaries out

Document pagination, the filter vocabulary, and the error shape. Reuse the existing error convention rather than inventing a second one.

**Commit.** `docs(schema): parcel endpoints`

---

## Task 2 — routes

Create `backend/src/routes/parcels.ts`, mounted at both `/parcels` and `/api/parcels` to match the existing dual mounting in `server.ts`.

Zod schemas in `backend/src/schemas/`, derived from task 1. Reads go through `backend/src/parcel/repository.ts` only. Spatial filtering uses the Flatbush index; do not scan all parcels per request.

`GET /parcels` returns summaries — id, label, acres, lifetime cost per kW, score, centroid. Full estimates are `GET /parcels/:id`. A list endpoint that returns 3,500 full breakdowns is the obvious way to make this feel broken.

**Acceptance.** Route tests in `backend/tests/`: bbox filtering returns only parcels inside it; an unknown id returns the standard 404 shape; a search with weights re-ranks without changing any cost figure.

**Commit.** `feat(api): parcel list, detail and search endpoints`

---

## Task 3 — the map

Add MapLibre GL JS and a free vector basemap (OpenFreeMap, or self-hosted Protomaps `.pmtiles`). No API keys, no per-tile billing, no account. If a basemap needs credentials, pick a different one.

Create `frontend/src/components/map/ParcelMap.tsx`. Parcel polygons ship as a GeoJSON source. Shade by whichever driver is selected, reusing the existing quantile ramp logic from `UsMap.tsx` — that quantile choice exists because a linear ramp put 90% of the country in two colour steps, and the same will happen with parcel land values. Extract the ramp rather than copying it.

`UsMap.tsx` stays as the national overview. This is a drill-down, not a replacement.

**Acceptance.** The map renders Bexar candidates, shading changes with the selected driver, and clicking a parcel selects it. No network request to any host requiring a key.

**Commit.** `feat(ui): MapLibre parcel map`

---

## Task 4 — the search screen

Create `frontend/src/screens/ParcelSearch.tsx`: filter rail, map, and ranked result list, **all three bound to one piece of state**.

This is where the region tool's worst bug came from — the Setup picker held candidate regions in local state while the run read a different source, so changing a region changed the dropdown and nothing else. Do not reproduce that shape. Filter state lives in one place and every view reads it.

Filters: acreage range, land cost per acre, distance to transmission, flood exclusion, zoning status. Each shows how many parcels it eliminates, so a filter that empties the map explains itself.

**Acceptance.** Changing any filter updates rail, map and list together. A stranger can find the ten cheapest 50-acre parcels within 5 km of 138 kV without reading documentation.

**Commit.** `feat(ui): parcel search screen`

---

## Task 5 — parcel detail

Create `frontend/src/screens/ParcelDetail.tsx`. Reuse `Card`, `Explain`, `Counter`, `StatTile`, the provenance table and the gaps panel from `Results.tsx` — do not rebuild them.

Show the cost waterfall: land, interconnect, fibre, sitework, entitlement, then lifetime operating cost. The whole argument of this product is that parcel-grain costs change the ranking, so the breakdown is the primary content, not a detail view.

Every figure carries its basis badge. `assumed` figures — `grid_interconnection_years` in particular — say plainly that they are placeholders.

**Acceptance.** Every number on screen is traceable to the provenance table, and no `assumed` figure renders like a sourced one.

**Commit.** `feat(ui): parcel detail with cost waterfall`

---

## Task 6 — route the parcel tool into the app

Add routes to `frontend/src/lib/routes.ts` and nav entries in `App.tsx`. Keep parcel state in `App.tsx` alongside the existing region state, for the same reason as above.

Selecting 2–4 parcels feeds the existing `Results` compare view. That screen already takes a site list and does not care whether entries are regions or parcels.

**Acceptance.** The region tool works exactly as before. Both tools coexist in one nav.

**Commit.** `feat(ui): parcel routes and compare integration`

---

## Definition of done

- `npm --prefix frontend run typecheck` and `run build` clean.
- Backend suite passes; report the count.
- Region tool verified working end to end after the change.
- No LLM work — criteria stay structured until work order 10.
