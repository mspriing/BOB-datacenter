# leepr

leepr: land, evaluation, environment, pricing.

A site-decision copilot for data centers, built for the **IBM AI Builders Challenge** (Wildcard track: Intelligent Systems for the Future of Work).

Give it two to four candidate locations. It prices the land, the power, the people and the natural hazard risk at each one, ranks them against priorities you set, and writes a recommendation that cites its own numbers.

---

## The problem

A data center runs for fifteen years or longer. By the time the first rack is installed, most of what it will cost has already been decided by the choice of plot: the price of a kilowatt hour, how many years the utility takes to energize the site, what an electrician earns in that county, whether the ground floods, and what the local authority charges in property tax.

Those figures live in five different public datasets, in five different formats, and they move every quarter. A team choosing a site either guesses, or pays a consultancy six figures and waits a month for a spreadsheet nobody outside the engagement can audit.

Site selection is also not a pure cost question. The cheapest site is frequently the wrong one. In the worked example shipped with this repo, a Texas site builds for 22.5 percent less than a Swedish one and still loses, because its natural hazard score is 5.8 against 1.2 and its grid runs at 42 percent renewable against 97 percent. Any tool that answers "which is cheapest" has answered the wrong question.

This tool does the arithmetic in the open. Every input is visible, every figure carries the URL it came from and the date it was checked, and the ranking changes as you change what you care about.

---

## Technical approach

The design rule the whole project is built around: **the language model never generates a number.**

Cost and financial math lives in `backend/src/engine/` as deterministic TypeScript under test. CapEx, OpEx, NPV, payback, the low and high scenarios, the weighted ranking and the sensitivity flip points are all plain code. 72 tests cover it. Running the same input twice returns the same answer, and any figure in the output can be traced to a line of arithmetic.

IBM watsonx with the Granite 3 8B Instruct model does two jobs, neither of which involves inventing figures:

1. **Reading messy input.** A user can paste a broker's note instead of filling in fields. Granite extracts the values it recognizes and maps them to the schema's override fields. When it is unavailable, a regex extractor takes over, so the feature never hard-fails. Anything pulled out of typed text is marked `user-supplied description` and `unverified` in the provenance table so it is never confused with a sourced figure.

2. **Writing the recommendation.** Granite receives the engine's computed output and writes the ranked narrative and the sensitivity callouts. The prompt forbids introducing figures that are not in the engine output. When credentials are absent or the call fails, a deterministic template produces the same paragraph from the same numbers, and the interface shows which of the two produced what you are reading.

The ranking itself is min-max normalization across four drivers, so each is scored 0 to 1 with 1 always best, then weighted by four user-set sliders and summed. Sensitivity works backwards from that: each cost driver is moved on its own, holding everything else still, until the top two sites swap, which yields the "this ranking flips if" sentence and tells you which input is worth verifying before you commit money.

Every value in `data/regions.json` carries a `source_url` and a `last_verified` date. Electricity rates come from the EIA, wages from the BLS, hazard scores from FEMA's National Risk Index, and tax rates from county filings.

---

## How IBM Bob was used

Bob wrote this codebase. Every file in `backend/src/` and `frontend/src/`, every test, and every commit came from directing Bob inside VS Code.

The approach that worked was written work orders rather than conversation: name the file, the line, the symptom and the acceptance test, then have Bob commit each task separately. Bob plans the change, edits the files, runs `npm test` itself, and stops if the suite fails. The backend suite grew from 66 tests to 72 across the last two work orders, with Bob writing the new tests as part of each task.

**[`docs/BOB.md`](docs/BOB.md) has the full record**, including session transcripts, the exact instructions given, the commit table, and two changes worth reading: wiring an orphaned free-text parser with correct provenance handling, and a twelve-file rename that fixed a cost figure which was arithmetically correct but named in a way that made it look wrong to anyone who has priced a data center.

---

## Prerequisites

- **Node.js 20+** (check with `node --version`)
- **npm 10+**

---

## Quick start

### 1. Clone and install

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Environment variables (backend)

Copy `.env.example` to `backend/.env` and fill in your credentials:

```bash
cp .env.example backend/.env
```

| Variable | Description |
|---|---|
| `WATSONX_API_KEY` | IBM watsonx API key (not required for the stub; required for narrative generation) |
| `WATSONX_PROJECT_ID` | IBM watsonx project ID |
| `PORT` | Port for the backend server (default: `3001`) |

### 3. Run both servers

Open **two terminals**:

**Terminal 1, backend**
```bash
cd backend
npm run dev
# → Listening on http://localhost:3001
```

**Terminal 2, frontend**
```bash
cd frontend
npm run dev
# → http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Deployment

The app deploys to **[Render](https://render.com)** from the `render.yaml` blueprint in the repo root.
One `git push` provisions both services automatically.

### Services

| Service | Type | Render name |
|---|---|---|
| Backend | Node web service | `leepr-backend` |
| Frontend | Static site | `leepr-frontend` |

The two services wire themselves together: Render injects the backend URL into
`VITE_API_URL` at frontend build time, and the frontend URL into `CORS_ORIGIN`
on the backend at startup.

### Secrets — enter in the Render dashboard

Three secrets must be set manually in the Render dashboard (they are marked
`sync: false` in `render.yaml` so they are never stored in the file):

| Variable | Where to get it |
|---|---|
| `WATSONX_API_KEY` | IBM Cloud — API key for your watsonx.ai instance |
| `WATSONX_PROJECT_ID` | IBM watsonx.ai project UUID |
| `EIA_API_KEY` | [eia.gov/opendata](https://www.eia.gov/opendata/) — free registration |

### Free-tier cold start

Both services run on Render's free tier. The backend sleeps after roughly
15 minutes of inactivity and takes up to about 50 seconds to wake on the
first request. The frontend shows a notice after 3 seconds of waiting
and the request times out cleanly after 90 seconds with a message to retry.

### Live URL

> **TODO:** replace this placeholder once the first deploy completes.
>
> Frontend: `https://leepr-frontend.onrender.com`

---

## Architecture

```
leepr/
├── data/regions.json        ← cost-driver database (source_url + last_verified on every value)
├── docs/SCHEMA.md           ← canonical input/output schema (source of truth)
├── docs/BOB.md              ← how IBM Bob was used, with session transcripts
├── backend/                 ← Node 20 + TypeScript + Express
│   └── src/
│       ├── engine/          ← deterministic cost/ranking math (NO LLM calls)
│       ├── llm/             ← watsonx/Granite input parsing + narrative (no new numbers)
│       ├── routes/          ← POST /estimate, GET /health
│       └── schemas/         ← Zod input + output validation
└── frontend/                ← React 18 + Vite + Tailwind + Recharts
    └── src/
        ├── components/      ← SiteForm, RankingTable, CostBreakdownChart, SensitivityChart, …
        ├── hooks/           ← useEstimate (API client)
        └── types/schema.ts  ← TypeScript types mirroring docs/SCHEMA.md
```

**Core rule:** The LLM layer never generates numbers. All cost and financial math is in `backend/src/engine/` as deterministic, tested, plain code.

**Second rule:** `docs/SCHEMA.md` is the source of truth. Any API shape change is written there first, then into the Zod schema, then into the frontend type.

---

## API

### `POST /estimate`

Submit 2 to 4 candidate sites and receive a full cost analysis.

Request and response shapes are documented in [`docs/SCHEMA.md`](docs/SCHEMA.md).

**Quick test with curl:**
```bash
curl -s -X POST http://localhost:3001/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "project": {
      "name": "Test",
      "capacity_kw": 10000,
      "design_pue": 1.4,
      "lifetime_years": 20,
      "discount_rate": 0.08
    },
    "sites": [
      { "site_id": "site-A", "label": "Phoenix AZ",   "region_key": "us-az-phoenix" },
      { "site_id": "site-B", "label": "Columbus OH",  "region_key": "us-oh-columbus" }
    ]
  }' | jq .
```

### `GET /health`

```bash
curl http://localhost:3001/health
```

---

## Reading the output

Two cost figures are reported per site and they are not the same thing.

`capex_per_kw` is total construction capital divided by capacity. This is the number comparable to published data center build costs, typically $9,000 to $12,000 per kW.

`lifetime_cost_per_kw` is everything the site costs over the full NPV horizon, construction plus running costs, divided by capacity. It is necessarily larger. It is the figure that decides the ranking, because a cheap site to build with expensive power is not a cheap site.

---

## Development

### Run backend tests
```bash
cd backend
npm test
```

### Build for production
```bash
# Backend
cd backend && npm run build

# Frontend
cd frontend && npm run build
```

---

## Build status

> **Current state:** End to end working. `/estimate` runs the deterministic
> engine and returns a full analysis with a watsonx/Granite narrative (or the
> deterministic fallback when no credentials are configured). 72 backend tests
> passing.

| Module | Status |
|---|---|
| `/estimate` endpoint (engine + narrative) | ✅ Working |
| Zod input/output validation | ✅ Done |
| `data/regions.json` | ✅ Done |
| `docs/SCHEMA.md` | ✅ Done |
| Deterministic cost engine (CapEx/OpEx/NPV/rank/sensitivity) | ✅ Done + tested |
| watsonx/Granite narrative + offline fallback | ✅ Done + tested |
| Free-text site parsing into overrides | ✅ Done + tested |
| User-set decision weights | ✅ Done |
| React results dashboard | ✅ Done |

### Verifying the watsonx (live) path

The app silently uses the deterministic fallback whenever `WATSONX_*` credentials
are missing or the call fails, so a working UI alone does **not** prove watsonx is
in the loop. To confirm the live path:

```bash
cd backend
cp ../.env.example .env      # then paste your IBM Cloud API key + project UUID
npm install                  # picks up dotenv (new dependency)
npm run watsonx:smoke        # one live Granite call, prints source = "watsonx" on success
```

`backend/.env` is loaded automatically by `npm run dev` (via `dotenv`). The
Recommendation card in the UI shows the source badge ("IBM watsonx, Granite" vs
"Deterministic template") so the demo makes the watsonx call visible on screen.
