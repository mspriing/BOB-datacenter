#!/usr/bin/env tsx
/**
 * backend/src/scripts/ingestParcels.ts
 *
 * Entry point for the parcel ingest pipeline.
 * All logic lives in backend/src/ingest/pipeline.ts (county-parameterised).
 * All Bexar County specifics live in backend/src/ingest/counties/bexar.ts.
 *
 * Run from backend/:  npm run ingest:parcels
 */

import { runIngest } from '../ingest/pipeline.js'
import { bexarConfig } from '../ingest/counties/bexar.js'

runIngest(bexarConfig).catch(err => {
  console.error('ingestParcels.ts fatal error:', err)
  process.exit(1)
})
