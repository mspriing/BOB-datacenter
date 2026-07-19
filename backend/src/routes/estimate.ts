import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { InputSchema } from '../schemas/input.js'
import { runEngine } from '../engine/index.js'
import type { EstimateInput } from '../schemas/input.js'

export const estimateRouter = Router()

estimateRouter.post('/', (req, res) => {
  // 1. Validate input
  const parsed = InputSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() })
    return
  }

  const input: EstimateInput = {
    ...parsed.data,
    request_id: parsed.data.request_id ?? uuidv4(),
  }

  // 2. Run deterministic engine (stub returns hard-coded example output)
  const output = runEngine(input)

  // 3. Respond
  res.json(output)
})
