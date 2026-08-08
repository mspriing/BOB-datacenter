# leepr — Local Development

## Running locally

### Backend

```sh
cd backend && npm install && npm run dev
# Listens on http://localhost:3001
```

### Frontend

```sh
cd frontend && npm install && npm run dev
# Listens on http://localhost:5173
```

Neither half needs a `.env` file to start.

A missing `WATSONX_API_KEY` is **not an error**. The narrative layer falls back to
a deterministic template that quotes the same engine figures; the interface labels the
recommendation `the deterministic template` instead of `watsonx Granite`. Every number
is still produced by the deterministic engine either way.

---

## Ports

| Service  | Port |
|----------|------|
| Backend  | 3001 |
| Frontend | 5173 |

---

## Proxy behaviour

In development `VITE_API_URL` is unset, so the browser calls the relative path
`/api/estimate`. Vite's dev server proxies `/api/*` to `http://localhost:3001` and
**strips the `/api` prefix** before forwarding:

```ts
// frontend/vite.config.ts
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
},
```

The backend therefore receives the request at `/estimate`, not `/api/estimate`. To
accommodate both the proxied dev request and direct production traffic, the backend
mounts its router at **both paths**:

```ts
app.use('/estimate',     estimateRouter)
app.use('/api/estimate', estimateRouter)
```

All four combinations answer correctly:

```sh
curl -s localhost:3001/health
curl -s localhost:3001/api/health
curl -s -X POST localhost:3001/estimate    -H 'content-type: application/json' -d @/tmp/req.json
curl -s -X POST localhost:3001/api/estimate -H 'content-type: application/json' -d @/tmp/req.json
```

---

## Test fixture

Build `/tmp/req.json` from the Zod schema, not guesswork. The hero fixture:

```json
{
  "project": {
    "name": "Hero Sites Test",
    "capacity_kw": 10000,
    "design_pue": 1.4,
    "design_wue": 0.4,
    "lifetime_years": 15,
    "discount_rate": 0.08,
    "weights": { "total_cost": 0.50, "risk": 0.20, "sustainability": 0.15, "latency": 0.15 }
  },
  "sites": [
    { "site_id": "site-A", "label": "Nordic Hydro",      "region_key": "eu-nordic-hydro" },
    { "site_id": "site-B", "label": "Texas ERCOT",        "region_key": "us-tx-ercot"     },
    { "site_id": "site-C", "label": "Northern Virginia",  "region_key": "us-va-northern"  }
  ]
}
```

Expected ranking: Nordic 0.672 → ERCOT 0.622 → Northern Virginia 0.315.
The ranking flips when Nordic construction cost rises ~8% above today's figure.

---

## Weights format

The backend schema validates each weight as a decimal in `[0.0, 1.0]`.
The frontend stores weights as integers (50, 20, 15, 15) for display, and divides
by 100 before sending to the API.
