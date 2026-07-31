import 'dotenv/config'   // load backend/.env so WATSONX_* credentials reach the LLM layer
import express from 'express'
import cors from 'cors'
import { estimateRouter } from './routes/estimate.js'
import { healthRouter } from './routes/health.js'
import { watsonxConfigFromEnv } from './llm/client.js'

const app = express()

const corsOrigin = process.env.CORS_ORIGIN
app.use(cors(corsOrigin ? { origin: corsOrigin } : undefined))
app.use(express.json())

app.use('/health',      healthRouter)
app.use('/estimate',    estimateRouter)
app.use('/api/health',  healthRouter)
app.use('/api/estimate', estimateRouter)

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => {
  const llm = watsonxConfigFromEnv() ? 'watsonx (live)' : 'deterministic fallback (no WATSONX_* credentials)'
  console.log(`leepr backend listening on http://localhost:${PORT}`)
  console.log(`Narrative layer: ${llm}`)
})

export { app }
