import { Router } from 'express'
import { loadRegions } from '../regions.js'

export const healthRouter = Router()

healthRouter.get('/', (_req, res) => {
  try {
    const regionCount = Object.keys(loadRegions()).length
    if (regionCount === 0) {
      res.status(503).json({
        status: 'unavailable',
        service: 'leepr-backend',
        reason: 'Region data loaded but contains no regions',
      })
      return
    }
    res.json({ status: 'ok', service: 'leepr-backend', regions: regionCount })
  } catch (error) {
    res.status(503).json({
      status: 'unavailable',
      service: 'leepr-backend',
      reason: error instanceof Error ? error.message : 'Region data could not be loaded',
    })
  }
})
