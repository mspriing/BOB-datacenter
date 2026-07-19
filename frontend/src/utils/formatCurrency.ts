/** Formats a USD number as "$1.2M" or "$840K" etc. */
export function formatUSD(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`
  }
  return `$${value.toFixed(0)}`
}

/** Formats a $/kW value. */
export function formatPerKW(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}/kW`
}
