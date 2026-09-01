# leepr

**leepr: land, evaluation, environment, pricing.**

A decision-support system for data center siting, built for the **IBM AI Builders Challenge — Wildcard track: Build Intelligent Systems for the Future of Work.**

Live: **https://leepr-frontend.onrender.com**

Describe a build. leepr prices its whole fifteen-year life across candidate markets, ranks them against what you care about, drops to individual parcels inside a county, and writes a recommendation that cites its own arithmetic. Every figure carries the URL it came from and the date it was checked.

---

## Contents

- [The problem](#the-problem)
- [Challenge fit](#challenge-fit-intelligent-systems-for-the-future-of-work)
- [What it does](#what-it-does)
- [The screens](#the-screens)
- [The rule the project is built on](#the-rule-the-project-is-built-on)
- [Architecture](#architecture)
- [The cost model, in full](#the-cost-model-in-full)
- [How the ranking works](#how-the-ranking-works)
- [The AI layer](#the-ai-layer)
- [Data and provenance](#data-and-provenance)
- [The parcel tool](#the-parcel-tool)
- [Running it](#running-it)
- [API](#api)
- [Testing](#testing)
- [Deployment](#deployment)
- [Judging criteria](#against-the-judging-criteria)
- [Known gaps](#known-gaps)
- [How this was built](#how-this-was-built)
- [What comes next](#what-comes-next)

---

## The problem

A data center runs for fifteen years or longer. By the time the first rack is installed, most of what it will cost has already been decided by the choice of ground: the price of a kilowatt hour, how many years the utility takes to energize the site, what an electrician earns in that county, whether the plot floods, and what the local authority charges in property tax.

Those figures live in half a dozen public datasets, in half a dozen formats, and they move every quarter. A team choosing a site either guesses, or pays a consultancy six figures and waits a month for a spreadsheet nobody outside the engagement can audit.

Site selection is also not a pure cost question. **The cheapest site is frequently the wrong one.** In the worked example shipped with this repo, a Texas site builds for materially less than a Swedish one and still loses, because its natural hazard exposure and its grid mix are worse. Any tool that answers "which is cheapest" has answered the wrong question.

leepr does the arithmetic in the open. Every input is visible, every figure carries its source, and the ranking changes as you change what you weigh.

---

## Challenge fit: Intelligent Systems for the Future of Work

The wildcard brief asks for AI that helps people **plan, coordinate, decide and execute** — a collaborator rather than a productivity gadget. Site selection is a good test of that, because it is a decision that is expensive, slow, evidence-heavy, and currently made behind a consultancy's closed door.

**How AI reduces repetitive work here.** The unglamorous majority of a siting study is gathering: pulling industrial power rates out of the EIA, wage indices out of the BLS, hazard scores out of FEMA and ThinkHazard, appraisal rolls out of a county district, transmission geometry out of a federal layer, and normalizing all of it into one comparable table. `backend/src/scripts/` and `backend/src/ingest/` do that work and re-run it on demand, each figure landing with its source URL and verification date attached. What a junior analyst spends three weeks assembling, the ingest assembles reproducibly.

**How AI improves decision-making here.** Not by producing a number — deliberately never that. It improves the decision in three ways the deterministic engine cannot:

1. **It reads intent.** A developer writes *"at least 200 acres within 3 km of transmission, under $25k an acre, no flood risk"* and gets structured filters back, with anything it could not express listed as ignored rather than silently dropped.
2. **It explains the answer in the reader's terms**, quoting only figures the engine produced, and saying plainly when a driver behind that answer is assumed rather than sourced.
3. **It surfaces fragility.** The engine computes the point at which each input would flip the ranking; the narrative names the one worth checking before anyone commits money.

**How teams reach outcomes faster.** The output is a shareable, auditable comparison rather than an opinion: a ranked set, an itemized cost breakdown per site, a low/base/high band, an explicit list of what could not be priced, and a provenance table naming every source. A colleague who disagrees with the answer can find the figure they disagree with and check it — which is the part that usually takes the longest.

**Decision support, not decision replacement.** The tool refuses to guess. A region missing a required driver is kept out of the ranking and named. A parcel with no land value is published in a separate list rather than ranked first for being free. Payback is "not applicable" until a human supplies a revenue assumption. Those refusals are the feature.

---

## What it does

leepr is one engine seen at two grains, plus an AI layer around it.

### 1. Compare markets

Pick two to four candidate markets — from a list, or by pinning them on a US map shaded by any cost driver. Describe the build: capacity, cooling overhead, water use, planning life, discount rate, and optionally what you expect to earn.

You get back a ranked set with, for each site:

- **Itemized CapEx** — land, construction, electrical, cooling, IT fit-out
- **Itemized annual OpEx** — power, water, staff, maintenance, property tax, connectivity
- **Whole-life cost in today's money**, discounted year by year, and lifetime cost per kW
- **A low / base / high band** recomputed at the scenario boundary, not scaled
- **Payback**, once you supply expected revenue
- **The flip point** — how far each input would have to move to change the ranking
- **A written recommendation** citing the engine's figures
- **A provenance table** naming the source and date behind every input

### 2. Compare parcels

The same question, closer in. Individual plots inside the pilot county — Bexar County, Texas — priced on the whole build rather than the asking price: the land, reaching the transmission line, reaching fiber, leveling the ground, and carrying cost through entitlement.

Filter by acreage, land price, distance to transmission and flood exposure, or describe what you want in a sentence. Open any parcel for its cost waterfall and provenance.

### 3. Read the working

Every screen is auditable. `#/how-to-use` explains the ranking, why each variable matters, the cost formulas, and the worked example. `#/sources`, `#/the-drivers` and `#/known-gaps` publish the dataset's own coverage — including what is missing.

---

## The screens

Three steps in the top bar — **Start · Set up · Results** — with the maps and the parcel views nested inside the step they belong to. They were once peer tabs, which made the bar read as a menu: a reader saw "Map" and "Set up" side by side with no way to tell which came first, and could land on Results before anything had been run.

| Route | What it is |
|---|---|
| `#/home` | The offer, an animation that flies from a rack out to the county and lands on the live results component, then what leepr is, the key factors, and how to use it |
| `#/setup` | Choose the grain — whole markets, or parcels in one county — then describe the build. Everything below the choice is keyed on it, so switching redraws rather than patches |
| `#/map` | The national choropleth. Every state shaded on the driver you pick, the deepest-coverage metros pinnable |
| `#/running` | A paced checklist that never runs ahead of the server: the last step stays lit until the request settles, so the interface cannot claim work the engine has not done |
| `#/results` | The ranked answer, itemized costs, the band, the flip point, the narrative and the provenance table |
| `#/parcels` | Filter rail, MapLibre map and ranked list, all reading one state object |
| `#/parcel` | One parcel: cost waterfall, provenance, gaps, and its note |
| `#/how-to-use` | **More info** — the walkthrough, the ranking, why each variable matters, the formulas, the worked example |
| `#/sources` `#/the-drivers` `#/all-regions` `#/known-gaps` `#/release-notes` | The dataset describing itself |
| `#/request-region` `#/report-figure` `#/talk-to-team` | Contact |

**Light and dark**, persisted, with the map basemap and the choropleth ramp both following the theme. Every workflow is phone-ready.

**It degrades rather than breaks.** The parcel screens fall back to a recorded snapshot when the service is unreachable and say so on the page, with the capture date. The map falls back to plain ground when the tile host fails, because the parcels are the content and the basemap is context. The estimate retries once on a cold start, since the free tier sleeps.

---

## The rule the project is built on

> **The language model never generates a number.**

Every cost and financial figure is deterministic TypeScript in `backend/src/engine/`, under test. Build cost, running cost, discounting, the scenario bands, the weighted ranking and the sensitivity flip points are plain code. Run the same input twice and you get the same answer; any figure in the output traces to a line of arithmetic.

The model's job is language: reading messy input, and explaining output it is not allowed to invent. This is enforced, not merely intended — the per-parcel note is validated so that **every numeric token in the prose must appear in the estimate**, and the note is discarded in favour of deterministic text if it does not.

The rule extends to honesty about gaps:

- A site missing a required driver is **excluded from the ranking and named**, rather than treated as costing zero. A cost the data never captured would otherwise read as a cost that is not there — and since cost carries half the ranking weight, the site with the least data behind it would win.
- Assumptions that are not regional lookups — cooling overhead, maintenance rate, staffing baseline — live in `backend/src/engine/assumptions.ts` with their basis, source, date and working, and are returned with every estimate.
- `grid_interconnection_years` is `null` everywhere, because nobody publishes the large-load queue. It says so rather than modelling a guess.

---

## Architecture

```
backend/
  src/
    engine/            deterministic cost math — no I/O, no LLM
      capex.ts         land, construction, electrical, cooling, fit-out
      opex.ts          power, water, staff, maintenance, tax, connectivity
      finance.ts       discounting, NPV, bands, payback
      rank.ts          weighted ranking across cost, risk, sustainability, latency
      sensitivity.ts   the point at which each driver flips the order
      assumptions.ts   every non-regional constant, with its source
      index.ts         orchestration + the unevaluable rule
    parcel/            the same engine at parcel grain
      drivers.ts       parcel row → driver bundle, with basis preserved
      cost.ts          interconnect, fiber, entitlement, sitework
      score.ts         per-parcel estimate + cached batch scoring
      repository.ts    the ONLY reader of parcel files (PostGIS swaps in here)
      spatialIndex.ts  Flatbush index for bbox queries
      geometry.ts      WKT handling
    ingest/            re-runnable data pipeline
      pipeline.ts      paged ArcGIS fetch, spatial joins, provenance, coverage
      countyConfig.ts  the contract a county must satisfy
      counties/        one file per county — Bexar today
    llm/               language only, never arithmetic
      narrative.ts     the recommendation
      parseInput.ts    free text → typed overrides
      parseCriteria.ts a sentence → parcel filters and weights
      parcelNote.ts    per-parcel explanation, number-guarded
      fallback.ts      deterministic text when watsonx is unreachable
    routes/            estimate, parcels, health
    schemas/           Zod in and out — docs/SCHEMA.md is the source of truth
frontend/
  src/
    screens/           Home, Setup, Running, Results, MapScreen,
                       ParcelSearch, ParcelDetail
    components/map/    UsMap (SVG choropleth), ParcelMap (MapLibre)
    lib/               api clients, client-side engine mirror, ramp, theme
    pages/DocPage.tsx  every reference page
data/
  regions.json         77 regions × 13 drivers, each with source and date
  parcels/             the ingested parcel layer, plus a coverage meta file
docs/
  SCHEMA.md            API contract — written before any schema change
  DATA-SOURCES.md      every source, its licence and its retrieval date
  work-orders/         the written briefs this was built from
```

**Stack.** TypeScript throughout. Express + Zod on the backend; React 18 + Vite + Tailwind on the frontend, with Radix primitives, Framer Motion, MapLibre GL for parcel geography and a hand-built SVG choropleth for the national view. Turf for spatial joins, Flatbush for spatial indexing, Vitest for tests.

**No paid dependencies and no map API key.** The basemap is OpenFreeMap; the tile layer needs no account and cannot expire mid-demo.

---

## The cost model, in full

Every formula below is in `backend/src/engine/`, under test, and returns the same answer for the same input.

### Capital cost — `capex.ts`

```
land_usd         = acres_needed × land_cost_per_acre
construction_usd = capacity_kw × construction_cost_per_kw
total_usd        = land_usd + construction_usd − incentive_usd

acres_needed     = max(5, MW × 1.2)
```

Electrical, cooling and IT fit-out are **not** added on top, and that is deliberate. They used to be — $550, $400 and $200 per kW, three bare constants with no source. But `construction_cost_per_kw` comes from a published construction cost index whose own methodology states that its cost per watt already includes mechanical and electrical fit-out. Adding them again double-counted roughly a tenth of the build. The fields remain in the output at zero so an older response can still be compared against a current one.

### Running cost, per year — `opex.ts`

```
it_energy_kwh      = capacity_kw × 8,760
total_energy_kwh   = it_energy_kwh × design_pue
cooling_energy_kwh = it_energy_kwh × (design_pue − 1)

power_usd        = total_energy_kwh × power_rate_usd_per_kwh
water_usd        = (cooling_energy_kwh × design_wue ÷ 3,785.4) × water_rate_usd_per_kgal
staff_usd        = capacity_kw × staff_cost_per_kw × staff_cost_index
maintenance_usd  = capex_total_usd × maintenance_rate
taxes_usd        = year ≤ abatement_years ? 0 : capex_total_usd × tax_rate
connectivity_usd = capacity_kw × connectivity_per_kw
```

Water is charged against **cooling** energy rather than total energy, because water usage effectiveness is a property of the cooling design. Property tax honours an abatement year by year rather than as an average — a ten-year abatement on a fifteen-year build is a different number from a 33% discount across the life.

### Whole-life cost — `finance.ts`

```
NPV = −CapEx − Σ (OpEx_y ÷ (1 + r)^y)   for y = 1..lifetime_years
lifetime_cost_per_kw = |NPV| ÷ capacity_kw
capex_per_kw         = capex.total_usd ÷ capacity_kw
```

The NPV is negative because it is a **cost** NPV — lower is better — and the interface shows it as a positive cost with a label saying so.

OpEx is recomputed for each year rather than treated as an annuity on year one. That distinction exists because of the abatement above: treating year one as representative would price a ten-year tax holiday as if it never expired.

`lifetime_cost_per_kw` was once called *levelized* cost per kW. It was renamed because "levelized" conventionally means $/MWh, and $/kW conventionally means build-cost intensity — so the old name matched two industry conventions and meant neither. `capex_per_kw` is published beside it for the figure a reader actually expects under that name.

### Payback — optional, and yours

```
annual_revenue = capacity_kw × revenue_per_kw_month × 12 × occupancy_pct
net_annual     = annual_revenue − opex year one
payback_years  = capex_total_usd ÷ net_annual
```

Revenue is an **input**, not a lookup: what a site earns is a commercial judgement no public dataset carries. Leave it empty and payback reads "Not applicable", exactly as it did before the field existed. Payback is withheld rather than approximated when revenue is absent, zero, or does not clear the running cost — a site that cannot cover its opex has no payback, and a negative one is not a figure to put in front of anyone. `npv_usd` is untouched by revenue; a test asserts that.

### The assumptions that are not regional

Cooling overhead, maintenance rate, staffing baseline, connectivity per kW, acres per MW and the build-cost scope note live in `assumptions.ts`, each carrying its value, basis, source, verification date and working. **Every estimate returns them.** They move the answer as much as the regional data does, and they used to sit in the code as bare constants with a comment at best.

---

## How the ranking works

Cost is not the only axis, and the tool would be misleading if it pretended otherwise.

Four dimensions are normalised to [0,1] across the submitted sites:

| Dimension | Direction | Default weight |
|---|---|---|
| Total cost | Lower is better — inverted | **50%** |
| Hazard risk | Lower is better — inverted | **20%** |
| Sustainability | Higher renewable share is better | **15%** |
| Latency to hub | Lower is better — inverted | **15%** |

Three details that matter:

1. **Null dimensions are excluded, not zeroed.** Per site, only the weights for dimensions that carry a figure are summed, then renormalised to 1.0. A missing renewable share does not silently score zero and drag a site down; it is recorded as a data gap and the remaining weights carry the score.
2. **Identical values score neutral.** If every site shares a value on some dimension, it contributes 0.5 to all of them rather than distorting the spread.
3. **A site missing a required cost driver is not ranked at all.** It is returned as unevaluable and named. This is the single most important rule in the engine: a cost the data never captured would otherwise arrive at the ranker as zero, and since cost carries half the weight, **the site with the least data behind it would win.**

### The flip point — `sensitivity.ts`

For each driver, the engine binary-searches for the value at which the current leader **loses rank one in the full N-site ranking** — not in a pairwise head-to-head, and not on raw NPV.

That distinction was a real bug once. A site can lead a three-way comparison and lose a two-way against the runner-up, because the 50% cost weight dominates when the third site is absent. Searching on NPV alone ignored risk, renewables and latency entirely, which made the search converge at the current value and report a flip of zero percent.

The result is the sentence the recommendation ends on: *this ranking holds unless X moves by Y percent* — which is the figure worth checking before anyone commits money.

---

## The AI layer

IBM **watsonx** with **Granite** (`ibm/granite-3-3-8b-instruct`), used in three bounded places:

| Where | What it does | Guard |
|---|---|---|
| `parseInput.ts` | Free-text site description → typed overrides | Hallucinated region keys are dropped; parsed values are stamped `source_url: "user-supplied description"` so a typed figure can never inherit a dataset's citation |
| `parseCriteria.ts` | A sentence → parcel filters and ranking weights | Every proposed filter is validated against the real vocabulary; anything outside it is dropped and reported. The interpretation is shown as editable chips **before** it changes any result |
| `parcelNote.ts` | Two or three sentences on what drives a parcel's cost | Every numeric token must appear in the estimate or the note is discarded. Generated on demand for the parcel being viewed, never batched |
| `narrative.ts` | The ranked recommendation | Quotes engine figures; names the fragile input |

### Why each guard exists

The parse guards are not hypothetical. `parseSiteDescription` was written, tested, and wired to a textarea — and `runEngine` never read the field, so anything typed there was silently discarded. When that was fixed, the subtler problem appeared: a number a user typed was inheriting the citation of the dataset it replaced. Parsed values are now stamped `source_url: "user-supplied description"` and `last_verified: "unverified"`, so the provenance table distinguishes a figure from the EIA from a figure somebody typed into a box.

The criteria parser drops anything outside its vocabulary for the same reason. **A filter the model invented is worse than one it missed:** a missed criterion shows up in `unparsed` where a reader can see it, while an invented one silently changes the result set and nobody knows.

**Every path has a deterministic fallback.** With no credentials, the criteria parser is a keyword-and-unit matcher, and the narrative is assembled from the same engine figures. The interface says which produced the words — a `wx` badge for Granite, `≡` for the template — so a reader always knows. The tool is fully usable with the model switched off, which is also how it behaves during a credential outage.

---

## Data and provenance

**77 regions × 13 drivers = 1,001 cells.** 279 sourced, 275 modeled, **447 empty and shown as empty**. 13 regions carry everything the engine requires to rank a site.

Every cell records `value`, `basis` (`sourced` / `modeled` / `assumed`), `source_url`, `last_verified`, and — when modeled — the derivation.

| Source | What it provides |
|---|---|
| **US EIA** | Industrial retail electricity rates |
| **US BLS OES** | Wage indices for the relevant occupations |
| **FEMA National Risk Index** | Natural hazard exposure, US |
| **ThinkHazard** (GFDRR) | Natural hazard exposure, international |
| **Eurostat** + **ECB** | European rates and currency conversion |
| **Our World in Data** | International generation mix |
| **PeeringDB** | Interconnection facility locations |
| **Texas Comptroller** | Appraisal ratios for the parcel land model |
| **Bexar CAD** | Parcel geometry, acreage, land value, use codes |

The interface never overstates this. `#/known-gaps` publishes what is missing, `#/sources` publishes every URL and date, and coverage counts are generated from the data by `frontend/scripts/gen-coverage.mjs` rather than typed by hand — so the page cannot drift from the dataset.

### The ingest pipeline

`backend/src/ingest/pipeline.ts` takes a `CountyConfig` and produces three artefacts: a GeoJSON layer for the map, a flat rows file for the repository, and a meta file carrying the run's provenance.

It is built around the ways public GIS services actually fail:

- **Adaptive paging.** BCAD and FEMA both answer *"Error performing query operation"* when a page carries too much geometry — measured: 1,000 records with all fields fails where the identical request at 100 succeeds three times out of three. The fetch halves the page size and retries rather than treating a size limit as a dead source, then keeps the size that worked.
- **Errors are never cached.** A failed page used to be written to the raw cache and replayed on every later run, turning one bad minute into a permanently broken pipeline that re-running could not fix.
- **Real spatial math.** Distance to transmission is measured to the nearest point on a line segment, not the nearest vertex — on a sparsely digitised span the difference is kilometres. Containment uses polygon intersection, not the parcel centroid, so a plot half inside a flood zone is not scored as fully in or fully out.
- **Deterministic output.** `last_verified` records when the source was fetched, not wall-clock time at formatting; features sort by parcel id; coordinates round to six decimal places. Re-running against a warm cache produces byte-identical files.
- **Gaps are recorded, not filled.** When a source cannot be reached, the meta file carries every URL tried and the date. Two sources are recorded that way today: San Antonio's zoning service, which requires a token, and HIFLD's service-territory layer, archived around October 2025.

Coverage counts in the interface are generated from the data by `frontend/scripts/gen-coverage.mjs`, so the page cannot overstate or understate the dataset.

**Land values are modeled, not market prices.** Texas is a non-disclosure state: no sale prices are published, so parcel land figures are appraisal-district values divided by the Comptroller's appraisal ratio. The tool says so wherever the figure appears.

---

## The parcel tool

**3,040 candidate parcels** in Bexar County, from **3,516** at 25 acres and above, after filtering on land value, land-use code and distance to transmission. The ingest publishes its funnel and per-driver basis counts to `data/parcels/bexar.meta.json`, so the count on screen is one you can audit.

The funnel ends at 3,046 rows and the interface says 3,040, because a handful of rows are parts of the same multi-part parcel. The backend hands out one row per id and the coverage generator counts unique ids, so the two agree on what a parcel is.

Per parcel, beyond the regional drivers:

| Driver | Derivation |
|---|---|
| `land_cost_usd` | Appraised land value ÷ appraisal ratio × acres — **modeled** |
| `interconnect_capex_usd` | Distance to nearest ≥138 kV line × $/mile + substation allowance |
| `fiber_capex_usd` | Distance to nearest interconnection facility × $/mile conduit |
| `entitlement_cost_usd` | Carrying cost over the entitlement period |
| `sitework_usd` | Earthwork from terrain |
| `flood_buildable_pct` | Share of the parcel outside the mapped flood zone |

The map draws real parcel outlines. Below the handover zoom it falls back to dots, because a 25-acre plot with the whole county in frame is smaller than a pixel — and a 25-acre square and a 25-acre roadside ribbon cost the same to buy and build very differently.

**Bexar is the pilot county.** The pipeline is county-parameterised: `backend/src/ingest/counties/` holds one config per county, and `pipeline.ts` contains no county literals, enforced by test.

---

## Running it

**Requirements:** Node 20+.

```bash
git clone https://github.com/mspriing/BOB-datacenter.git
cd BOB-datacenter
```

Backend, in one terminal:

```bash
npm --prefix backend install && npm --prefix backend run dev
```

Frontend, in another:

```bash
npm --prefix frontend install && npm --prefix frontend run dev
```

Then open **http://localhost:5173**. The frontend proxies `/api` to `localhost:3001`, so start the backend first.

**There is no root `package.json`** — install and run each side with `--prefix`, or `cd` into it.

**watsonx is optional.** With no credentials the tool runs its deterministic paths and says so on screen. To enable Granite, copy `.env.example` to `backend/.env` and fill in `WATSONX_API_KEY` and `WATSONX_PROJECT_ID`, then:

```bash
npm --prefix backend run watsonx:smoke
```

Re-running the data pipelines:

```bash
npm --prefix backend run ingest          # regional dataset
npm --prefix backend run ingest:parcels  # the parcel layer
```

Both cache raw responses under `data/raw/` and produce byte-identical output from a warm cache.

---

## API

Documented in full in [`docs/SCHEMA.md`](docs/SCHEMA.md), which is written **before** any schema change, per `AGENTS.md`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness, and which narrative path is active |
| `POST` | `/estimate` | Price and rank 2–4 sites |
| `GET` | `/parcels` | Paged, filtered, ranked parcel list |
| `GET` | `/parcels/:id` | One parcel's full estimate |
| `POST` | `/parcels/search` | The same, with criteria in a JSON body |
| `POST` | `/parcels/criteria` | A sentence → filters and weights. **Interprets only; runs nothing** |

Every route is mounted at both `/x` and `/api/x`. Production adds rate limiting and an origin allow-list.

---

## Testing

```bash
npm --prefix backend test
```

**264 tests across 23 files.** They cover the arithmetic, and also the project's own rules:

- Capex, opex, discounting, ranking and sensitivity against worked examples
- The unevaluable rule — a site with a missing driver stays out of the ranking
- Revenue and payback, including that payback is **withheld** rather than negative, and that adding revenue moves neither the NPV nor the lifetime cost per kW
- Criteria parsing, including that an invented filter key is dropped and named
- The parcel note's number guard, and that notes are never batch-generated
- Ingest determinism, spatial math, and county-config invariants enforced by grep
- Repository path validation against traversal — the county id reaches the filesystem, and the routes allow-list it, but the repository is a public interface and one careless caller from a traversal

Some of those tests exist because the thing they check was once broken. The score cache keyed on county and project but not on the row set, so `rows` was honoured on the first call and ignored on every later one — every filtered request got the whole county back, which made the entire filter rail look wired up and do nothing. The route tests missed it because they cleared the cache between cases and only ever exercised the cold path.

---

## Deployment

Both services deploy from `render.yaml`:

- **leepr-backend** — Node web service, health-checked at `/health`
- **leepr-frontend** — static site, SPA-rewritten, built with `VITE_API_URL` compiled in

Pushing to `main` rebuilds both. A failed build leaves the previous version serving, so the deployed JS bundle — content-hashed, and therefore impossible to serve stale — is the thing to check when confirming a release, not the page.

---

## Against the judging criteria

**Technical execution.** A deterministic engine under 264 tests, a re-runnable ingest pipeline with provenance on every cell, a repository interface that makes the PostGIS migration a loader rather than a rewrite, an LLM layer whose output is validated against the engine's own numbers, and a frontend that degrades correctly when the API, the basemap or the model is unavailable.

**Innovation.** The interesting choice is what the AI is *not* allowed to do. Putting a hard wall between the model and the arithmetic — and enforcing it with a token-level guard on generated prose — produces something a developer can take to an investment committee. Most AI tools in this space are the inverse: a model that produces figures and a UI that hopes.

**Feasibility.** It is running. Public data, no paid APIs, no map key, free-tier hosting, and a deterministic path for every AI feature so nothing depends on a credential holding.

**Challenge fit.** Decision support for a decision that is expensive, slow and evidence-heavy — with the AI doing the gathering, the reading and the explaining, and a human keeping the judgement.

**Real-world impact.** Data center siting is a live constraint on AI infrastructure buildout, and the interconnection queue has become its binding one. A tool that prices whole-life cost from public data, refuses to invent what it does not know, and shows its working, is useful to a developer, a county assessing an application, and anyone checking a claim made about either.

---

## Known gaps

Published here for the same reason they are published in the interface.

- **Interconnection wait is not modelled.** `grid_interconnection_years` is null everywhere. ERCOT publishes the large-load queue only as PDFs, and in 2026 that wait dominates siting economics more than land price does. A fabricated figure would be the most misleading number this tool could produce.
- **Flood data is incomplete.** The FEMA layer fails at deep pagination offsets, so `flood_buildable_pct` is unpopulated for the current parcel run.
- **Zoning is unavailable for Bexar.** San Antonio's service requires a token. Texas counties have no general zoning authority outside city limits, so unincorporated parcels are tagged accordingly rather than guessed.
- **One county.** Bexar is the pilot. The pipeline is parameterised for more.
- **Land prices are modeled**, not transactions — see above.
- **Payback depends on a revenue figure you supply.** It is labelled as your input wherever it appears.

`#/known-gaps` carries the same list, kept in step with the data.

---

## How this was built

Development was directed through written work orders rather than conversation — each naming the file, the symptom, the fix and the acceptance test, with one commit per task. [`docs/BOB.md`](docs/BOB.md) records how IBM Bob was used and what that produced; [`docs/work-orders/`](docs/work-orders/) holds the briefs themselves, including the ones that repaired an ingest that had never successfully run, and the plan behind the parcel tool.

The method mattered more than it sounds. A written brief naming the file, the symptom and the acceptance test produced clean work on the first attempt; conversational requests produced work that had to be redone. Each acceptance test is a `grep` or a command with an expected result, which is what caught the failures worth catching:

- An ingest script that had been committed as complete and **had never successfully run** — it queried four field names the source layer does not have, so its first request errored and the pipeline reported success over zero parcels.
- A candidate picker writing to state the run never read, so changing a region changed the dropdown and nothing else.
- A generated video whose final frames read *"Lauddnn County, Viiginis"* — which is why the hero hands off to the live component two and a half seconds early rather than sitting on the last frame.
- Invariant tests that had silently skipped for months because they shell out to `grep`, which was unavailable on the machine running them. When they finally ran they caught two real violations.

Two rules from [`AGENTS.md`](AGENTS.md) shaped everything above:

1. All cost and financial math lives in the backend as deterministic, tested code. **The LLM never generates numbers.**
2. `docs/SCHEMA.md` is the source of truth. An API change is written there first, then into the Zod schema, then into the frontend type.

---

## What comes next

In rough order of how much each would improve the answer:

1. **The interconnection queue.** Parsing ERCOT's large-load queue out of its TAC report PDFs would turn the single most decision-relevant driver from `assumed` into sourced. In 2026 the wait to energize dominates siting economics more than land price does.
2. **A second county**, to prove the pipeline abstraction. The repository interface and the county config exist for this; the migration to PostGIS is a loader behind the same interface rather than a rewrite.
3. **Validation against ground truth.** Loudoun County publishes existing, approved and proposed data center locations with substations, refreshed twice a year. That is a labelled test set: run the scorer over historical parcels and ask whether it would have picked the ones that actually got built. Without that check, a whole-life cost score is an opinion.
4. **Flood coverage**, once the FEMA deep-pagination limit is worked around by splitting the query.

---

## Licence

Apache 2.0. See [`NOTICE`](NOTICE) for third-party data attributions and their terms — several sources require the source to be named, and it is.

**leepr is not investment advice.** Everything it produces is for informational purposes only, is an estimate built from public data and assumptions you enter, and is not a valuation, appraisal, quote or offer. Take independent professional advice before committing money to a site.
