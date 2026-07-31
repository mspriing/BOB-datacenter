// The three published candidate sites. Values copied from data/regions.json so
// the worked example on the home page and the flip narrative stay reproducible.
// Nordic Hydro is not on the US map, so it is carried here rather than in usRegions.
import type { SiteDrivers } from '../lib/engine'

export interface NamedSite { key: string; label: string; place: string; base: SiteDrivers }

export const DEFAULT_SITES: NamedSite[] = [
  {
    key: 'eu-nordic-hydro', label: 'Nordic Hydro', place: 'Luleå and Boden, Sweden',
    base: { powerRate: 0.024, waterRate: 1.1, landCostPerAcre: 18000, constructionPerKw: 10200,
            staffIndex: 1.35, taxRate: 0.022, taxAbatementYears: 0, incentivePerKw: 30,
            riskScore: 1.2, renewablePct: 0.97, latencyMs: 42, gridWaitYears: 2.5 },
  },
  {
    key: 'us-tx-ercot', label: 'Texas ERCOT', place: 'Hays County, Texas',
    base: { powerRate: 0.038, waterRate: 3.2, landCostPerAcre: 55000, constructionPerKw: 8200,
            staffIndex: 0.96, taxRate: 0.019, taxAbatementYears: 10, incentivePerKw: 220,
            riskScore: 5.8, renewablePct: 0.42, latencyMs: 22, gridWaitYears: 4 },
  },
  {
    key: 'us-va-northern', label: 'Northern Virginia', place: 'Loudoun County, Virginia',
    base: { powerRate: 0.068, waterRate: 5.2, landCostPerAcre: 420000, constructionPerKw: 9100,
            staffIndex: 1.18, taxRate: 0.06, taxAbatementYears: 0, incentivePerKw: 50,
            riskScore: 2, renewablePct: 0.2, latencyMs: 4, gridWaitYears: 6.5 },
  },
]
