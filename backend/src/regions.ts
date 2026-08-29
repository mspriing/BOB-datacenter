import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { z } from 'zod'

// A driver entry: value may be null (missing = correct output, not an error).
// basis is required on every entry; method is required when basis = "modeled".
const RegionDriverSchema = z.object({
  value:         z.number().nullable(),
  low:           z.number().nullable().optional(),
  high:          z.number().nullable().optional(),
  source_url:    z.string().url(),
  last_verified: z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/),
  basis:         z.enum(['sourced', 'modeled', 'assumed']),
  method:        z.string().nullable().optional(),
}).superRefine((driver, ctx) => {
  if (driver.basis === 'modeled' && !driver.method?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['method'],
      message: 'Modeled figures require a calculation method',
    })
  }
}).transform((driver) => {
  if (driver.value !== null && /example\.com|placeholder/i.test(driver.source_url)) {
    return { ...driver, value: null, low: null, high: null }
  }
  return driver
})

export const RegionSchema = z.object({
  label:                        z.string(),
  precision:                    z.enum(['state', 'metro', 'international']),
  power_rate_usd_per_kwh:       RegionDriverSchema,
  water_rate_usd_per_kgal:      RegionDriverSchema,
  land_cost_per_acre_usd:       RegionDriverSchema,
  construction_cost_per_kw:     RegionDriverSchema,
  construction_cost_per_mw:     RegionDriverSchema,
  staff_cost_index:              RegionDriverSchema,
  tax_rate:                      RegionDriverSchema,
  tax_abatement_years:           RegionDriverSchema,
  incentive_usd_per_kw:          RegionDriverSchema,
  risk_score:                    RegionDriverSchema,
  renewable_pct:                 RegionDriverSchema,
  low_carbon_pct:                RegionDriverSchema,
  latency_ms_to_hub:             RegionDriverSchema,
  grid_interconnection_years:    RegionDriverSchema,
  // parent_state is present on metro regions for fallback lookups
  parent_state:                  z.string().optional(),
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
  const placeholderFigures = Object.values(raw as Record<string, Record<string, unknown>>)
    .flatMap((region) => Object.values(region))
    .filter((driver) => {
      if (!driver || typeof driver !== 'object') return false
      const entry = driver as { value?: unknown; source_url?: unknown }
      return entry.value !== null
        && typeof entry.value === 'number'
        && typeof entry.source_url === 'string'
        && /example\.com|placeholder/i.test(entry.source_url)
    }).length
  if (placeholderFigures > 0) {
    console.warn(`[data] ignored ${placeholderFigures} unsourced placeholder figure(s) in regions.json`)
  }
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
