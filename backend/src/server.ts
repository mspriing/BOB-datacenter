import 'dotenv/config'   // load backend/.env so WATSONX_* credentials reach the LLM layer
import express from 'express'
import cors from 'cors'
import { estimateRouter } from './routes/estimate.js'
import { healthRouter } from './routes/health.js'
import { parcelsRouter } from './routes/parcels.js'
import { watsonxConfigFromEnv } from './llm/client.js'

const app = express()

const corsOrigin = process.env.CORS_ORIGIN
app.use(cors(corsOrigin ? { origin: corsOrigin } : undefined))
app.use(express.json())

app.use('/health',       healthRouter)
app.use('/estimate',     estimateRouter)
app.use('/parcels',      parcelsRouter)
app.use('/api/health',   healthRouter)
app.use('/api/estimate', estimateRouter)
app.use('/api/parcels',  parcelsRouter)

const PORT = process.env.PORT ?? 3001

// Importing this module must not bind a port. Two test files now import `app`
// — routes.test.ts and parcelsRoutes.test.ts — and vitest gives each its own
// worker, so binding at import time made them race for 3001 and end the run
// with EADDRINUSE even though every test passed. Tests wrap `app` in their own
// server on an ephemeral port; only a real boot listens here.
if (!process.env.VITEST) {
  app.listen(PORT, () => {
    const llm = watsonxConfigFromEnv() ? 'watsonx (live)' : 'deterministic fallback (no WATSONX_* credentials)'
    console.log(`leepr backend listening on http://localhost:${PORT}`)
    console.log(`Narrative layer: ${llm}`)
  })
}

export { app }
