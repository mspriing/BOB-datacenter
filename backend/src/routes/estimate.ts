import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { InputSchema } from '../schemas/input.js'
import { runEngine } from '../engine/index.js'
import type { EstimateInput } from '../schemas/input.js'

export const estimateRouter = Router()

estimateRouter.post('/', async (req, res) => {
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

  try {
    // 2. Run deterministic engine + narrative (LLM or fallback)
    const output = await runEngine(input)

    // 3. Respond
    res.json(output)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: 'Engine error', message: msg })
  }
})
