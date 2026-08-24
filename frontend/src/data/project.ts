export const PROJECT = {
  name: 'Northgate AI Campus, phase 1',
  capacityMw: 10,
  // Cooling overhead a new build is designed to reach. Was 1.4, which is closer
  // to what an older running fleet averages than to what anyone designs today.
  // Uptime Institute's 2025 survey puts the industry at 1.54 and facilities of
  // 20 MW and above at 1.44; 1.25 is a design target and matches a facility a
  // working operator runs now.
  pue: 1.25,
  lifetimeYears: 15,
  discountRate: 0.08,
  // 10,000 kW x 1.25 x 8,760 hours, in GWh.
  annualGwh: 109.5,
}
// COVERAGE is generated from data/regions.json by scripts/gen-coverage.mjs.
// Re-exported here so every existing import keeps working.
export { COVERAGE } from './coverage'
