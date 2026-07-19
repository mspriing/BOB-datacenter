import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { z } from 'zod'

// A driver entry with optional low/high range bands
const RegionDriverSchema = z.object({
  value:         z.number(),
  low:           z.number().optional(),
  high:          z.number().optional(),
  source_url:    z.string(),
  last_verified: z.string(),
})

export const RegionSchema = z.object({
  label:                     z.string(),
  power_rate_usd_per_kwh:    RegionDriverSchema,
  water_rate_usd_per_kgal:   RegionDriverSchema,
  wue:                       RegionDriverSchema,
  land_cost_per_acre_usd:    RegionDriverSchema,
  construction_cost_per_kw:  RegionDriverSchema,
  construction_cost_per_mw:  RegionDriverSchema,
  staff_cost_index:          RegionDriverSchema,
  tax_rate:                  RegionDriverSchema,
  tax_abatement_years:       RegionDriverSchema,
  incentive_usd_per_kw:      RegionDriverSchema,
  risk_score:                RegionDriverSchema,
  renewable_pct:             RegionDriverSchema,
  latency_ms_to_hub:         RegionDriverSchema,
})

export const RegionsFileSchema = z.record(z.string(), RegionSchema)

export type RegionDriver = z.infer<typeof RegionDriverSchema>
export type Region       = z.infer<typeof RegionSchema>
export type RegionsFile  = z.infer<typeof RegionsFileSchema>

let _cache: RegionsFile | null = null

export function loadRegions(): RegionsFile {
  if (_cache) return _cache
  const __dirname = dirname(fileURLToPath(import.meta.url))
  // Resolve relative to the package root (backend/) when running compiled,
  // or relative to cwd (project root) when running via tsx / vitest.
  const fromMeta = resolve(__dirname, '../..', 'data/regions.json')
  const fromCwd  = resolve(process.cwd(), 'data/regions.json')
  const filePath = (() => {
    try { readFileSync(fromMeta); return fromMeta } catch { /* fall through */ }
    return fromCwd
  })()
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  const result = RegionsFileSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`data/regions.json failed validation: ${JSON.stringify(result.error.flatten())}`)
  }
  _cache = result.data
  return _cache
}

/** Reset the cache — only for tests. */
export function _resetRegionsCache(): void {
  _cache = null
}
