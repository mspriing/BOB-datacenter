import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { z } from 'zod'

const RegionDriverSchema = z.object({
  value:         z.number(),
  source_url:    z.string(),
  last_verified: z.string(),
})

export const RegionSchema = z.object({
  label:                     z.string(),
  power_rate_usd_per_kwh:   RegionDriverSchema,
  water_rate_usd_per_kgal:  RegionDriverSchema,
  land_cost_per_acre_usd:   RegionDriverSchema,
  construction_cost_per_kw: RegionDriverSchema,
  staff_cost_index:         RegionDriverSchema,
  tax_rate:                 RegionDriverSchema,
  incentive_usd_per_kw:     RegionDriverSchema,
  risk_score:               RegionDriverSchema,
  renewable_pct:            RegionDriverSchema,
  latency_ms_to_hub:        RegionDriverSchema,
})

export const RegionsFileSchema = z.record(z.string(), RegionSchema)

export type Region = z.infer<typeof RegionSchema>
export type RegionsFile = z.infer<typeof RegionsFileSchema>

let _cache: RegionsFile | null = null

export function loadRegions(): RegionsFile {
  if (_cache) return _cache
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const filePath = resolve(__dirname, '../../..', 'data/regions.json')
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  const result = RegionsFileSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`data/regions.json failed validation: ${JSON.stringify(result.error.flatten())}`)
  }
  _cache = result.data
  return _cache
}
