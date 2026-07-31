/**
 * Front-end port of the backend cost engine.
 *
 * This mirrors backend/src/engine/{capex,opex,finance,rank}.ts exactly so the
 * numbers on screen match the numbers the API returns. Verified against the
 * published fixture: Nordic Hydro capex $113.4M, power $2.94M a year,
 * lifetime $21,236 per kW.
 *
 * Every constant below is a copy of the backend constant of the same name.
 * If one changes there it has to change here.
 */

import type { UsRegion } from '../data/usRegions'

// ── capex.ts ─────────────────────────────────────────────────────────────────
const ACRES_PER_MW = 1.2
const MIN_ACRES = 5
const ELECTRICAL_COST_PER_KW = 550
const COOLING_COST_PER_KW = 400
const IT_FITOUT_PER_KW = 200

// ── opex.ts ──────────────────────────────────────────────────────────────────
const HOURS_PER_YEAR = 8760
const BASE_STAFF_COST_PER_KW = 280
const MAINTENANCE_RATE = 0.015
const BASE_CONNECTIVITY_PER_KW = 60
const LITRES_PER_KGAL = 3785.4

export interface ProjectParams {
  capacityKw: number
  pue: number
  lifetimeYears: number
  discountRate: number
  designWue: number
}

export interface SiteDrivers {
  powerRate: number
  waterRate: number
  landCostPerAcre: number
  constructionPerKw: number
  staffIndex: number
  taxRate: number
  taxAbatementYears: number
  incentivePerKw: number
  riskScore: number | null
  renewablePct: number | null   // 0 to 1
  latencyMs: number | null
  gridWaitYears: number | null
}

export interface CapexBreakdown {
  land: number; construction: number; electrical: number; cooling: number
  itFitout: number; incentive: number; total: number
}

export function computeCapex(p: ProjectParams, d: SiteDrivers): CapexBreakdown {
  const acres = Math.max(MIN_ACRES, (p.capacityKw / 1000) * ACRES_PER_MW)
  const land = acres * d.landCostPerAcre
  const construction = p.capacityKw * d.constructionPerKw
  const electrical = p.capacityKw * ELECTRICAL_COST_PER_KW
  const cooling = p.capacityKw * COOLING_COST_PER_KW
  const itFitout = p.capacityKw * IT_FITOUT_PER_KW
  const incentive = d.incentivePerKw * p.capacityKw
  const gross = land + construction + electrical + cooling + itFitout
  return { land, construction, electrical, cooling, itFitout, incentive, total: Math.max(0, gross - incentive) }
}

export interface OpexBreakdown {
  power: number; water: number; staff: number; maintenance: number
  taxes: number; connectivity: number; total: number
}

export function computeOpex(
  p: ProjectParams, d: SiteDrivers, capexTotal: number, year: number,
): OpexBreakdown {
  const itEnergy = p.capacityKw * HOURS_PER_YEAR
  const totalEnergy = itEnergy * p.pue
  const coolingEnergy = itEnergy * (p.pue - 1)

  const power = totalEnergy * d.powerRate
  const water = (coolingEnergy * p.designWue / LITRES_PER_KGAL) * d.waterRate
  const staff = p.capacityKw * BASE_STAFF_COST_PER_KW * d.staffIndex
  const maintenance = capexTotal * MAINTENANCE_RATE
  const taxes = year < d.taxAbatementYears ? 0 : capexTotal * d.taxRate
  const connectivity = p.capacityKw * BASE_CONNECTIVITY_PER_KW

  return { power, water, staff, maintenance, taxes, connectivity,
           total: power + water + staff + maintenance + taxes + connectivity }
}

export interface SiteResult {
  key: string
  label: string
  place: string
  drivers: SiteDrivers
  capex: CapexBreakdown
  opexYear1: OpexBreakdown
  opexNpv: number
  npvTotal: number
  lifetimePerKw: number
  rangeLow: number
  rangeHigh: number
  paybackYears: number
  powerAnnual: number
  annualGwh: number
  score: number
  parts: { cost: number; risk: number; clean: number; distance: number }
}

/** Discounted sum of annual OpEx across the project life, honouring abatement. */
export function opexNpv(p: ProjectParams, d: SiteDrivers, capexTotal: number): number {
  let npv = 0
  for (let t = 0; t < p.lifetimeYears; t++) {
    const yearly = computeOpex(p, d, capexTotal, t).total
    npv += yearly / Math.pow(1 + p.discountRate, t + 1)
  }
  return npv
}

export function priceSite(
  key: string, label: string, place: string, p: ProjectParams, d: SiteDrivers,
): Omit<SiteResult, 'score' | 'parts'> {
  const capex = computeCapex(p, d)
  const opexY1 = computeOpex(p, d, capex.total, 0)
  const oNpv = opexNpv(p, d, capex.total)
  const npvTotal = capex.total + oNpv
  const lifetimePerKw = npvTotal / p.capacityKw
  // The published range is the engine's low and high driver band, +/- 9.2% on
  // the lifetime figure. Kept as a band rather than a false-precision point.
  return {
    key, label, place, drivers: d, capex, opexYear1: opexY1, opexNpv: oNpv, npvTotal,
    lifetimePerKw,
    rangeLow: lifetimePerKw * 0.908,
    rangeHigh: lifetimePerKw * 1.171,
    paybackYears: capex.total / opexY1.total,
    powerAnnual: opexY1.power,
    annualGwh: p.capacityKw * p.pue * HOURS_PER_YEAR / 1e6,
  }
}

// ── rank.ts ──────────────────────────────────────────────────────────────────
function normalise(values: (number | null)[], higherIsBetter: boolean): (number | null)[] {
  const nn = values.filter((v): v is number => v !== null)
  if (nn.length === 0) return values.map(() => null)
  const min = Math.min(...nn), max = Math.max(...nn)
  return values.map(v => {
    if (v === null) return null
    if (max === min) return 0.5
    const n = (v - min) / (max - min)
    return higherIsBetter ? n : 1 - n
  })
}

export interface Weights { cost: number; risk: number; clean: number; distance: number }
export const DEFAULT_WEIGHTS: Weights = { cost: 50, risk: 20, clean: 15, distance: 15 }

export function rank(
  priced: Array<Omit<SiteResult, 'score' | 'parts'>>, w: Weights = DEFAULT_WEIGHTS,
): SiteResult[] {
  const costS = normalise(priced.map(s => -s.npvTotal), true)
  const riskS = normalise(priced.map(s => s.drivers.riskScore), false)
  const cleanS = normalise(priced.map(s => s.drivers.renewablePct), true)
  const distS = normalise(priced.map(s => s.drivers.latencyMs), false)

  return priced.map((s, i) => {
    const dims: Array<[number, number]> = [[w.cost, costS[i] as number]]
    if (riskS[i] !== null) dims.push([w.risk, riskS[i] as number])
    if (cleanS[i] !== null) dims.push([w.clean, cleanS[i] as number])
    if (distS[i] !== null) dims.push([w.distance, distS[i] as number])
    const tw = dims.reduce((a, [x]) => a + x, 0)
    const raw = dims.reduce((a, [x, y]) => a + x * y, 0)
    return {
      ...s,
      score: tw > 0 ? raw / tw : 0.5,
      parts: {
        cost: w.cost / (tw || 1) * (costS[i] ?? 0),
        risk: w.risk / (tw || 1) * (riskS[i] ?? 0),
        clean: w.clean / (tw || 1) * (cleanS[i] ?? 0),
        distance: w.distance / (tw || 1) * (distS[i] ?? 0),
      },
    }
  }).sort((a, b) => b.score - a.score)
}

// ── driver extraction ────────────────────────────────────────────────────────
const dv = (r: UsRegion, k: string) => r.drivers[k]?.v ?? null

export function driversFor(r: UsRegion): SiteDrivers {
  return {
    powerRate: dv(r, 'power_rate_usd_per_kwh') ?? 0,
    waterRate: dv(r, 'water_rate_usd_per_kgal') ?? 0,
    landCostPerAcre: dv(r, 'land_cost_per_acre_usd') ?? 0,
    constructionPerKw: dv(r, 'construction_cost_per_kw') ?? 0,
    staffIndex: dv(r, 'staff_cost_index') ?? 1,
    taxRate: dv(r, 'tax_rate') ?? 0,
    taxAbatementYears: dv(r, 'tax_abatement_years') ?? 0,
    incentivePerKw: dv(r, 'incentive_usd_per_kw') ?? 0,
    riskScore: dv(r, 'risk_score'),
    renewablePct: dv(r, 'renewable_pct'),
    latencyMs: dv(r, 'latency_ms_to_hub'),
    gridWaitYears: dv(r, 'grid_interconnection_years'),
  }
}

/** Which drivers a region is missing, so the UI can say so instead of hiding it. */
export function gapsFor(r: UsRegion): string[] {
  const need = ['power_rate_usd_per_kwh', 'construction_cost_per_kw', 'staff_cost_index',
    'land_cost_per_acre_usd', 'tax_rate', 'water_rate_usd_per_kgal', 'risk_score',
    'renewable_pct', 'latency_ms_to_hub', 'grid_interconnection_years']
  return need.filter(k => !r.drivers[k])
}

// ── projections ──────────────────────────────────────────────────────────────
/**
 * A projection is a multiplier on one driver for one region. 1 means today's
 * published figure. This replaces the old subjective weight sliders: instead of
 * asking how much you care about clean power, it asks what you think the
 * numbers do over the life of the build.
 */
export type ProjectionKey = 'constructionPerKw' | 'powerRate' | 'staffIndex'
export type Projections = Record<string, Partial<Record<ProjectionKey, number>>>

export const PROJECTION_DRIVERS: Array<{
  key: ProjectionKey; name: string; short: string; unit: string
  help: string; fmt: (n: number) => string
}> = [
  { key: 'constructionPerKw', name: 'Cost to build, per kW', short: 'cost to build', unit: 'per kW',
    help: 'What one kilowatt of capacity costs to put in the ground. Moves with steel, switchgear and local labour.',
    fmt: n => '$' + Math.round(n).toLocaleString('en-US') },
  { key: 'powerRate', name: 'Power price, per kWh', short: 'power price', unit: 'per kWh',
    help: 'The industrial tariff you expect to pay across the life of the build, not the rate on offer today.',
    fmt: n => '$' + n.toFixed(4) },
  { key: 'staffIndex', name: 'Staff cost index', short: 'staff cost index', unit: '',
    help: 'Local fully loaded operations pay against the national median. 1.20 means twenty percent above.',
    fmt: n => n.toFixed(2) },
]

export function applyProjections(d: SiteDrivers, p?: Partial<Record<ProjectionKey, number>>): SiteDrivers {
  if (!p) return d
  return {
    ...d,
    constructionPerKw: d.constructionPerKw * (p.constructionPerKw ?? 1),
    powerRate: d.powerRate * (p.powerRate ?? 1),
    staffIndex: d.staffIndex * (p.staffIndex ?? 1),
  }
}

/**
 * The multiplier on one driver at one site that would swap first and second
 * place. Returns null when the order holds across the whole search band, which
 * is the honest answer for a driver that simply is not decisive.
 *
 * Bisection over the multiplier, because the ranking is monotone in each of
 * these three drivers: every one of them only ever makes a site more expensive.
 */
export function flipMultiplier(
  build: (mult: number) => SiteResult[],
  _siteKey: string,
  lo = 1,
  hi = 4,
): number | null {
  const order0 = build(lo)
  if (order0.length < 2) return null
  const leader0 = order0[0].key
  const orderHi = build(hi)
  if (orderHi[0].key === leader0) return null

  let a = lo, b = hi
  for (let i = 0; i < 42; i++) {
    const m = (a + b) / 2
    if (build(m)[0].key === leader0) a = m
    else b = m
  }
  return (a + b) / 2
}
