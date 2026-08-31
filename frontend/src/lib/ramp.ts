/**
 * The shading ramp, shared by the state map and the parcel map.
 *
 * Quantile rather than linear, for the reason UsMap.tsx records: power price
 * runs from $0.038 to $0.315 and a linear ramp puts 90% of the country in the
 * bottom two steps because Hawaii stretches the top. Parcel land values are
 * worse — a handful of downtown parcels stretch the scale until every rural
 * parcel reads as identical. Ranking by position is what makes either map
 * readable.
 *
 * UsMap.tsx still carries its own copy. Folding it onto this module is a safe
 * follow-up, deliberately not done in the same change that adds a second tool,
 * so the working region map is untouched here.
 */

import { cssColor } from './theme'

export const RAMP = Array.from({ length: 8 }, (_, i) => `var(--ramp-${i})`)
export const NO_DATA = 'var(--map-no-data)'

export function resolvedRamp(): string[] {
  return Array.from({ length: 8 }, (_, i) => cssColor(`--ramp-${i}`))
}

export function rampColor(t: number, colors = RAMP): string {
  const i = Math.min(colors.length - 1, Math.max(0, Math.round(t * (colors.length - 1))))
  return colors[i]
}

/**
 * Build a quantile scale over the given values. Returns a function mapping a
 * value to 0..1, where 1 is always "better" — so a driver where low is good is
 * inverted here rather than at every call site.
 */
export function quantileScale(values: number[], lowIsGood: boolean): (v: number) => number {
  const sorted = [...values].filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length < 2) return () => 0.5
  const lo = sorted[0]
  const hi = sorted[sorted.length - 1]
  if (hi === lo) return () => 0.5

  return (v: number) => {
    let i = 0
    while (i < sorted.length && sorted[i] < v) i++
    const t = i / (sorted.length - 1)
    return lowIsGood ? 1 - t : t
  }
}
