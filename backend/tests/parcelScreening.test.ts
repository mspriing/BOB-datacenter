/**
 * backend/tests/parcelScreening.test.ts
 *
 * Ownership and priceability screening, decided from the BCAD `Exempts` field.
 *
 * The defect these guard against: the candidate list was topped by city parks
 * and San Antonio Water System land, appraised at $0–$3 an acre. Land-use code
 * cannot tell a park from a field — the tax exemption can.
 */

import { describe, it, expect } from 'vitest'
import { bexarConfig } from '../src/ingest/counties/bexar.js'

const src = bexarConfig.parcelSource

/** Same predicates the pipeline applies, exercised against the shipped config. */
const isInstitutional = (exemptCodes: string, owner: string): boolean => {
  const codes = exemptCodes.toUpperCase()
  if (src.institutionalExemptPrefixes.some(p => codes.includes(p))) return true
  const o = owner.toUpperCase()
  return src.governmentOwnerPatterns.some(g => o.includes(g))
}

const isOccupied = (exemptCodes: string): boolean =>
  src.occupancyExemptPrefixes.some(p =>
    exemptCodes.toUpperCase().split(',').map(c => c.trim()).includes(p))

describe('institutional screening', () => {
  it('excludes government land by exemption code', () => {
    // EX-XV is Texas Tax Code §11.11 — state or political subdivision.
    expect(isInstitutional('EX-XV', 'CITY OF SAN ANTONIO')).toBe(true)
    expect(isInstitutional('EX-XV', 'SAN ANTONIO WATER SYSTEM')).toBe(true)
    expect(isInstitutional('EX-XJ', 'SOME PRIVATE SCHOOL')).toBe(true)
    expect(isInstitutional('EX-XI', 'A CHARITY')).toBe(true)
  })

  it('excludes government land by owner name even with no exemption recorded', () => {
    expect(isInstitutional('', 'CITY OF SAN ANTONIO')).toBe(true)
    expect(isInstitutional('', 'BEXAR COUNTY')).toBe(true)
    expect(isInstitutional('', 'JUDSON ISD')).toBe(true)
  })

  it('keeps private land, including homesteads', () => {
    expect(isInstitutional('HS', 'BROWN DELBERT E & REGINA C')).toBe(false)
    expect(isInstitutional('HS, OV65', 'GARIBAY IGNACIO JR')).toBe(false)
    expect(isInstitutional('', 'JCB TEXAS LLC')).toBe(false)
  })

  it('keeps agricultural land, which carries no exemption at all', () => {
    // D1 open-space is a special appraisal, not an exemption, so ag land must
    // survive this filter — it is the greenfield a campus would actually use.
    expect(isInstitutional('', 'SOME RANCH LP')).toBe(false)
  })
})

describe('occupancy flagging', () => {
  it('flags homestead and veteran exemptions as occupied', () => {
    expect(isOccupied('HS')).toBe(true)
    expect(isOccupied('HS, OV65')).toBe(true)
    expect(isOccupied('DV4, HS, OV65')).toBe(true)
    expect(isOccupied('DVHS, HS')).toBe(true)
  })

  it('does not flag land with no exemption', () => {
    expect(isOccupied('')).toBe(false)
    expect(isOccupied('EX-XV')).toBe(false)
  })
})

describe('priceability floor', () => {
  const floor = src.minLandValuePerAcre
  const perAcre = (landVal: number, acres: number) => landVal / acres

  it('rejects the appraisal artifacts that were ranking first', () => {
    expect(perAcre(0, 1323.3)).toBeLessThan(floor)        // DONOP RD, $0/acre
    expect(perAcre(111, 111.4)).toBeLessThan(floor)       // $1/acre
  })

  it('accepts ordinary raw land', () => {
    expect(perAcre(6_472_390, 227.3)).toBeGreaterThan(floor)  // $28k/acre
    expect(perAcre(5_002_015, 208.9)).toBeGreaterThan(floor)  // $24k/acre
  })

  it('sits above every implausible value and below the county median', () => {
    // Measured 2026-08-17: median $22,502/acre, 136 parcels below $1,000.
    expect(floor).toBeGreaterThan(500)
    expect(floor).toBeLessThan(22_502)
  })
})
