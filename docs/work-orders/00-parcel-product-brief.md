# Parcel product — standing brief

Read this before every parcel work order (07 onward), alongside `AGENTS.md`. It is the architecture contract. Individual work orders name tasks; this names the invariants that hold across all of them.

## What is being built

A parcel-grain total-cost-of-ownership tool for data-center site selection. A developer states criteria; the tool ranks every candidate parcel in a county by whole-life cost and shows what each figure rests on.

The existing region tool (63 states/metros, 2–4 user-supplied candidates) **keeps working throughout**. It is the demo that exists today. No parcel work order may break it, and `POST /estimate` keeps its current contract.

The shift is from scoring a supplied set to ranking a discovered one: ~3,500 candidate parcels per county instead of 3 regions.

## Invariants

These are not negotiable and are not restated in each work order.

1. **No cost or financial math in the LLM layer.** All of it stays deterministic, tested, in `backend/src/engine/` and `backend/src/parcel/`. Granite parses messy input and writes prose that cites the engine's numbers. It never produces a number.
2. **`docs/SCHEMA.md` is the source of truth.** Any API shape change is written there first, then the Zod schema, then the frontend type. In that order.
3. **Every figure carries provenance** — `basis` (`sourced` / `modeled` / `assumed`), `source_url`, `last_verified`, and `method` when modeled. A figure with no source is a gap, and a gap is displayed as a gap. Never fill one with a plausible number.
4. **Modeled is never presented as sourced.** Texas is a non-disclosure state: land cost is appraised value divided by an appraisal ratio, and must never render as a market price.
5. **All parcel reads go through `backend/src/parcel/repository.ts`.** Nothing else opens the GeoJSON or rows file. This is what keeps PostGIS a later loader rather than a later rewrite.
6. **County specifics live in `backend/src/ingest/counties/<county>.ts`.** No county literals in pipeline, engine, API, or UI code.
7. **watsonx / Granite is the LLM.** The deterministic fallback in `backend/src/llm/fallback.ts` covers credential outages so a demo never depends on the model being reachable. Do not add a provider abstraction.

## Architecture

```
backend/src/
  ingest/            work order 07 — sources, spatial joins, county configs
  engine/            UNCHANGED — priceSite / rank / sensitivity already work
  parcel/
    repository.ts    the only reader of parcel files
    drivers.ts       parcel row → SiteDrivers
    cost.ts          parcel-specific capex on top of the engine
    score.ts         batch scoring + criteria-keyed cache
  llm/
    parseCriteria.ts NL → filters + weights
    parcelNote.ts    per-parcel narrative from driver data
  routes/
    estimate.ts      UNCHANGED
    parcels.ts       new
frontend/src/
  screens/           existing region screens UNCHANGED; parcel screens added
  components/map/    UsMap (states) stays; MapLibre parcel map added
```

**Storage.** Precomputed files plus an in-memory [Flatbush](https://github.com/mourner/flatbush) index. 3,500 parcels fit in RAM comfortably. PostGIS arrives with county two, behind the repository interface.

**Scoring.** Compute per-parcel drivers and the full cost breakdown once, at ingest. At request time only weights change, which is a re-sort over a cached array — not a recompute.

**Map.** MapLibre GL JS with a free vector basemap (OpenFreeMap, or self-hosted Protomaps `.pmtiles`). No API key, no per-tile billing. Ship parcels as a GeoJSON source; only reach for tippecanoe/pmtiles above ~50k features.

## Phase map

| WO | Phase | Delivers |
|---|---|---|
| 07 | 0 | Repaired ingest → `data/parcels/bexar.{geojson,rows.json,meta.json}` |
| 08 | 1 | Parcel TCO drivers and cost model, under test |
| 09 | 2 | `/parcels` API and the map + search UI |
| 10 | 3 | Criteria parsing and per-parcel narrative |
| 11 | 4 | Loudoun validation against published data-center locations |

Each work order ends with a working, committed, demonstrable state. Do not start the next phase inside the previous one.

## Working rules

- Commit each task separately, with the message given in the work order.
- Work on the branch the work order names. Afterwards run `git branch` and compare `git rev-parse HEAD` to `git rev-parse origin/main`, and say which branch the work landed on.
- Run `npm --prefix backend test` before each commit. Report the count; it was 88 at work order 07.
- If a task is blocked or tempts you outside its scope, stop and write down what and why rather than improvising past it.
