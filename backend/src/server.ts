import express from 'express'
import cors from 'cors'
import { estimateRouter } from './routes/estimate.js'
import { healthRouter } from './routes/health.js'

const app = express()

app.use(cors())
app.use(express.json())

app.use('/health', healthRouter)
app.use('/estimate', estimateRouter)

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => {
  console.log(`BOB-datacenter backend listening on http://localhost:${PORT}`)
})

export { app }
