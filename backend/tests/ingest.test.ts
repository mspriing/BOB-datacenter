/**
 * Tests for ingest invariants that can be checked against the live regions.json.
 *
 * These tests validate the *output* of the ingest script, not the script's
 * internal functions.  Run after `npm run ingest` to confirm correctness, or
 * as part of CI against the committed regions.json snapshot.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REGIONS_PATH = resolve(__dirname, '../../data/regions.json')

interface DriverValue {
  value: number | null
}
interface Region {
  renewable_pct:  DriverValue
  low_carbon_pct: DriverValue
  [k: string]: unknown
}
type RegionsFile = Record<string, Region>

function loadRegions(): RegionsFile {
  return JSON.parse(readFileSync(REGIONS_PATH, 'utf-8'))
}

describe('regions.json invariants', () => {
  it('low_carbon_pct is never less than renewable_pct for any region', () => {
    const regions = loadRegions()
    const violations: string[] = []

    for (const [key, region] of Object.entries(regions)) {
      const ren = region.renewable_pct.value
      const lc  = region.low_carbon_pct.value
      // Only check when both values are present
      if (ren === null || lc === null) continue
      if (lc < ren - 1e-9) {
        violations.push(
          `${key}: low_carbon_pct=${lc.toFixed(4)} < renewable_pct=${ren.toFixed(4)}`
        )
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `low_carbon_pct < renewable_pct in ${violations.length} region(s):\n  ` +
        violations.join('\n  ')
      )
    }
  })
})
