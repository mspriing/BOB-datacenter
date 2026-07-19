# BOB-datacenter

Data-center site-decision copilot for the **IBM AI Builders Challenge** (Wildcard: Intelligent Systems for the Future of Work).

A site-selection professional inputs 2–4 candidate data-center sites; the tool ranks them, prices the real cost drivers, and writes a defensible recommendation.

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

**Terminal 1 — Backend**
```bash
cd backend
npm run dev
# → Listening on http://localhost:3001
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
# → http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Architecture

```
BOB-datacenter/
├── data/regions.json        ← cost-driver database (source_url + last_verified on every value)
├── docs/SCHEMA.md           ← canonical input/output schema (source of truth)
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

**Core rule:** The LLM layer never generates numbers. All cost/financial math is in `backend/src/engine/` as deterministic, tested, plain code.

---

## API

### `POST /estimate`

Submit 2–4 candidate sites and receive a full cost analysis.

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

> **Current state:** Skeleton with stub `/estimate` endpoint.
> Engine math (CapEx, OpEx, NPV, ranking, sensitivity) and watsonx narrative generation are in progress (see build order in docs/).

| Module | Status |
|---|---|
| `/estimate` stub endpoint | ✅ Working |
| Zod input/output validation | ✅ Done |
| `data/regions.json` (6 US regions) | ✅ Done |
| `docs/SCHEMA.md` | ✅ Done |
| Deterministic cost engine | 🔄 Next |
| watsonx/Granite integration | 🔄 Upcoming |
| Full React results dashboard | ✅ Scaffolded |
