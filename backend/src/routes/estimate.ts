import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { InputSchema } from '../schemas/input.js'
import { OutputSchema } from '../schemas/output.js'
import { runEngine, UnpriceableError } from '../engine/index.js'
import type { EstimateInput } from '../schemas/input.js'
import { loadRegions } from '../regions.js'

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
    const regions = loadRegions()
    const unknownRegion = input.sites.find((site) => !regions[site.region_key])
    if (unknownRegion) {
      res.status(400).json({
        error: 'Invalid input',
        message: `Unknown region_key: ${unknownRegion.region_key}`,
      })
      return
    }

    // 2. Run deterministic engine + narrative (LLM or fallback)
    const output = OutputSchema.parse(await runEngine(input))

    // 3. Respond
    res.json(output)
  } catch (err) {
    // Fewer than two candidates could be priced. That is a gap in the data, not
    // a failure in the engine, so answer with the drivers that are missing and
    // from which site rather than a bare 500.
    if (err instanceof UnpriceableError) {
      res.status(422).json({
        error:       'Not enough priced sites to compare',
        message:     'At least two candidates need a construction cost, a power rate, a land cost and a staffing index before they can be ranked.',
        unevaluable: err.unevaluable,
      })
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: 'Engine error', message: msg })
  }
})
