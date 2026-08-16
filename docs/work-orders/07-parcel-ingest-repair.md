# Work order 07 — repair the parcel ingest and produce the first Bexar candidate layer

Phase 0 of `docs/PARCEL-TOOL-PLAN.md`. Read `AGENTS.md` first; its rules apply unchanged.

Commit each task separately so a bad task can be reverted without losing a good one. Work on a branch named `parcel/phase0-ingest`. When you finish, run `git branch` and compare `git rev-parse HEAD` against `git rev-parse origin/main` so the branch you committed to is visible rather than assumed.

---

## Context

`backend/src/scripts/ingestParcels.ts` exists and has never run successfully. There is no `data/raw/` and no output file. It dies on its first query. Everything below was probed live on 2026-08-16; treat these as measured facts, not guesses, and do not re-derive them.

**The BCAD parcel layer is live** at `https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0`, `maxRecordCount` 1000, and its real field names are:

```
OBJECTID, PropID, Situs, Owner, AddrLn1, AddrLn2, AddrLn3, AddrCity, AddrSt,
Country, Zip, Zip4, DBA, AcctNumb, LglDesc, LandVal, ImprVal, TotVal, Nbhd,
GBA, TOT_GBA, YrBlt, Stories, NumRooms, Houses, Detached, State_cd, LglAcres,
Acres, TaxUnits, Exempts, IS_UDI, UDIPARNT, Roll, SWP, PropUse, Shape
```

Measured counts: 710,772 parcels total; 10,264 at `Acres >= 10`; **3,516 at `Acres >= 25`**; 1,623 at `Acres >= 50`. Within `Acres >= 25`: 1,457 `State_cd` `D*`, 475 `F*`, 202 `C*`.

Known-good sample record: `PropID` 155887, `Owner` "JCB TEXAS LLC", `Acres` 227.3, `LandVal` 6472390, `State_cd` F2.

---

## Task 1 — fix the BCAD field names

**Symptom.** `fetchBcadParcels()` queries `where: GIS_ACRES >= ${MIN_ACRES}` and `parseAttributes()` reads `PROP_ID`, `SITUS_NUM`, `SITUS_STREET`, `GIS_ACRES`, `CALC_ACRES`, `STATE_CD`, `LND_VAL`. **None of those fields exist.** The ArcGIS query returns an error object, `arcgisFetchAll` logs it and breaks, and the pipeline proceeds with zero parcels.

**Fix.** Use the real names above. `Situs` is a single pre-joined address string — delete the `SITUS_NUM` + `SITUS_STREET` concatenation rather than mapping it. Keep `LglAcres` as a fallback for `Acres` only, and record in the record which one was used.

**Also.** `where: "Acres >= 25 AND LandVal > 0"` returns `Error performing query operation` from this service. Filter on `Acres` and `State_cd` server-side; filter on `LandVal` client-side after fetch.

**Acceptance.** `npm run ingest:parcels` fetches a non-zero parcel count, and the funnel line for the acreage stage prints 3,516 for a 25-acre threshold. Print the raw fetched count before any filtering so a silent zero can never again look like a valid empty result.

**Commit.** `fix(ingest): use real BCAD field names`

---

## Task 2 — fix the FEMA endpoint

**Symptom.** `FEMA_NFHL_URL` points at `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHLWMS/MapServer/28`, which returns HTTP 404.

**Fix.** The working base is `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer`. Layer **28** is `Flood Hazard Zones` and layer 27 is `Flood Hazard Boundaries`; you want 28. Verify the layer name matches `Flood Hazard Zones` at runtime before querying, and fail loudly with the actual returned name if FEMA renumbers layers.

**Acceptance.** Flood zones fetch returns features for Bexar County, and the funnel prints a non-zero drop count at the flood stage.

**Commit.** `fix(ingest): correct FEMA NFHL endpoint`

---

## Task 3 — rediscover the two dead endpoints

**Symptom.** Two sources return `Invalid URL` from ArcGIS:
- `COSA_ZONING_URL` — `services.arcgis.com/g3ToTjWotgngStr3/.../Zoning_Districts/FeatureServer/0`
- `HIFLD_TERRITORY_URL` — `services1.arcgis.com/Hp6G80Pky0om7QvQ/.../Electric_Retail_Service_Territories/FeatureServer/0`

HIFLD Open was archived around October 2025 and its layers moved; the transmission-lines layer on the same host still resolves, so do not assume the whole host is gone.

**Fix.** Find current replacements. For zoning, start from the San Antonio open-data portal; for service territories, start from the HIFLD geoplatform hub. Probe each candidate URL with `?f=json` and confirm it returns a layer descriptor with the fields you intend to read **before** wiring it in.

**If a replacement cannot be found**, do not fake it and do not silently pass parcels through. Record the source as an explicit gap in the meta file with the URLs you tried and the date, and have the coverage table name it. A recorded gap is an acceptable outcome for this task; an unrecorded one is not.

**Note.** Texas counties have no general zoning authority, so parcels in unincorporated Bexar have no zoning to look up. Tag those `outside-jurisdiction`, which is a different fact from `unknown-gap`, and keep the two distinguishable downstream.

**Acceptance.** Every source is either wired to a probed-working URL or listed as a gap with attempted URLs recorded.

**Commit.** `fix(ingest): replace dead zoning and service-territory endpoints`

---

## Task 4 — replace the geometry math with turf

**Symptom.** Two approximations that are wrong at parcel grain:

1. `minDistToLines()` measures to the nearest **vertex** of a transmission line. A parcel under the middle of a sparsely-digitised 3 km span reads as ~1.5 km away. Distance to transmission is a primary siting driver, so this error propagates straight into the ranking.
2. Every containment test — zoning, flood, utility territory — uses `geometryCentroid()`. A 460-acre parcel partially in a flood zone is scored as fully in or fully out on where its centroid lands.

**Fix.** Add `@turf/turf`. Use `pointToLineDistance` (or `nearestPointOnLine`) for transmission distance, and real polygon intersection for containment.

Change the flood output from boolean to **percent of parcel area affected**: `flood_buildable_pct = 1 − (area(parcel ∩ SFHA) / area(parcel))`. Buildable-area-after-flood is a genuine cost driver and a boolean throws it away. Keep the 100-year drop rule, but drop on a meaningful area threshold rather than a centroid hit — start at >25% of parcel area in an A/AE/AO/AH/VE/V zone and make the threshold a named constant.

Delete `pointInPolygon`, `pointInGeometry`, and `minDistToLines` once nothing calls them.

**Acceptance.** A unit test in `backend/tests/` covers: a point beside the midpoint of a two-vertex line returns the perpendicular distance, not the distance to an endpoint; and a parcel half-covered by a flood polygon returns `flood_buildable_pct` ≈ 0.5.

**Commit.** `fix(ingest): real spatial math via turf`

---

## Task 5 — make the pipeline county-parameterised

**Symptom.** Bexar specifics are hardcoded throughout: endpoint constants, the FIPS filter `48029`, the bounding box `-99.5,29.0,-97.9,30.0`, state codes, zoning prefixes, CPS/SAWS rates, PVS ratios.

**Fix.** Introduce `backend/src/ingest/counties/bexar.ts` exporting a typed `CountyConfig` — identifiers, FIPS, bbox, source URLs, land-use code mappings, zoning prefixes, utility and water tariffs, appraisal-ratio table. The pipeline takes a `CountyConfig` and has no county literals left in it.

This exists because **Loudoun County is confirmed for Phase 4 validation**. Do not build Loudoun now. Build the seam so Loudoun is a config file plus, at most, one adapter.

**Acceptance.** `grep -ri "bexar\|48029\|CPS\|SAWS" backend/src/ingest/pipeline.ts` returns nothing.

**Commit.** `refactor(ingest): county config drives the pipeline`

---

## Task 6 — emit table-shaped rows, not only GeoJSON

**Symptom.** The script writes GeoJSON only. `docs/PARCEL-TOOL-PLAN.md` defers PostGIS to county two, and that deferral is only safe if the migration is a loader rather than a rewrite.

**Fix.** Emit two artefacts per county:
- `data/parcels/<county>.geojson` — FeatureCollection, for the map
- `data/parcels/<county>.rows.json` — flat array, one object per parcel, scalar columns plus a `geometry_wkt` string. No nesting except the `drivers` object.

Add `backend/src/parcel/repository.ts` exporting the read interface the rest of the backend uses — `listParcels`, `getParcel`, `queryByBbox` — with a file-backed implementation. **Nothing outside this module may read the GeoJSON or rows file directly.** Adding PostGIS later then means one new implementation behind the same interface.

**Acceptance.** `grep -rn "parcels/.*\.geojson\|rows\.json" backend/src --include=*.ts` matches only `repository.ts` and the ingest pipeline.

**Commit.** `feat(parcel): file-backed repository behind a stable read interface`

---

## Task 7 — determinism

**Symptom.** `const TODAY = new Date().toISOString().slice(0, 7)` is stamped into every driver's `last_verified`, so two runs in different months produce different files. Feature order also follows fetch order, which ArcGIS does not guarantee.

**Fix.**
- `last_verified` must record **when the source data was fetched or published**, taken from the raw cache entry, not from wall-clock time at formatting.
- Sort features by `parcel_id` before writing.
- Round coordinates to 6 decimal places and monetary values to whole dollars.
- Write the run timestamp once, to the meta file, where it belongs.

**Acceptance.** Running `npm run ingest:parcels` twice against the warm cache produces byte-identical `.geojson` and `.rows.json`. Verify with a hash comparison and state the result in the commit message.

**Commit.** `fix(ingest): deterministic output`

---

## Task 8 — coverage table and meta file

**Fix.** Write `data/parcels/<county>.meta.json` containing: run timestamp, county config identifier, every source URL with its probe result and fetch date, the full funnel with a count at each stage, per-driver counts by basis (`sourced` / `modeled` / `assumed` / `missing`), and the explicit gap list from task 3.

Keep the existing console coverage table and add the funnel to it.

**Rules that still apply.** Land value is `modeled` — BCAD appraised value divided by the Texas Comptroller PVS ratio — and must never be presented as a market price; Texas is a non-disclosure state and no public sale prices exist. `grid_interconnection_years` stays `assumed` with `value: null` until an ERCOT queue pipeline exists. Do not invent a number to fill a gap.

**Acceptance.** `data/parcels/bexar.meta.json` exists, the funnel sums correctly stage to stage, and every driver in the output is represented in the basis counts.

**Commit.** `feat(ingest): coverage and provenance meta output`

---

## Definition of done

- `npm run ingest:parcels` completes with no unhandled rejection and produces the three files.
- Candidate parcel count is printed and non-zero, with the funnel showing where each drop happened.
- Re-running produces byte-identical output.
- Every figure carries `basis`, `source_url`, `last_verified`, and `method` where modeled.
- Backend suite still passes: `npm --prefix backend test` (88 tests as of this work order — report the new count).
- No cost or financial math added to the LLM layer.

## Out of scope

Do not build in this work order: the parcel TCO drivers (Phase 1), any API route or frontend (Phase 2), criteria parsing or per-parcel narrative (Phase 3), Loudoun ingest (Phase 4), PostGIS. If a task tempts you into one of these, stop and note it instead.
