import 'dotenv/config'   // load backend/.env so WATSONX_* credentials reach the LLM layer
import express from 'express'
import cors, { type CorsOptions } from 'cors'
import rateLimit from 'express-rate-limit'
import { estimateRouter } from './routes/estimate.js'
import { healthRouter } from './routes/health.js'
import { parcelsRouter } from './routes/parcels.js'
import { watsonxConfigFromEnv } from './llm/client.js'

const app = express()

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'
const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
const productionOrigins = configuredOrigins.length > 0
  ? configuredOrigins
  : ['https://leepr-frontend.onrender.com']
const corsOptions: CorsOptions | undefined = isProduction
  ? {
      origin: (origin, callback) => {
        callback(null, !origin || productionOrigins.includes(origin))
      },
    }
  : undefined

if (isProduction) app.set('trust proxy', 1)
app.use(cors(corsOptions))
app.use(express.json())

const estimateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !isProduction,
  message: { error: 'Too many estimate requests. Try again in a few minutes.' },
})
const parcelLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !isProduction,
  message: { error: 'Too many parcel requests. Try again in a few minutes.' },
})

app.use(['/estimate', '/api/estimate'], estimateLimiter)
app.use(['/parcels', '/api/parcels'], parcelLimiter)
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
