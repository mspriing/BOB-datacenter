/**
 * backend/tests/parcelRepositorySafety.test.ts
 *
 * The county id reaches the filesystem, so it is validated inside the
 * repository rather than only at the route. The routes allowlist against a
 * county registry today, but the repository is a public interface and a later
 * caller could hand it a value straight from a request.
 */

import { describe, it, expect } from 'vitest'
import { fileRepository } from '../src/parcel/repository.js'

describe('parcel repository — county id validation', () => {
  const traversals = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32\\config\\sam',
    'bexar/../../../secrets',
    '/etc/shadow',
    'C:\\Windows\\win.ini',
    '..',
  ]

  for (const bad of traversals) {
    it(`rejects ${JSON.stringify(bad)} rather than reading it`, () => {
      expect(() => fileRepository.listParcels(bad)).toThrow(/invalid county id|escapes the data directory/)
    })
  }

  it('rejects an id with characters outside the allowed set', () => {
    expect(() => fileRepository.listParcels('bexar;rm -rf')).toThrow(/invalid county id/)
    expect(() => fileRepository.listParcels('Bexar')).toThrow(/invalid county id/)
  })

  it('lets a well-formed id through to the normal missing-file error', () => {
    // 'nosuchcounty' is valid in shape, so it passes validation and fails on
    // read instead — proving the guard rejects shape, not existence.
    expect(() => fileRepository.listParcels('nosuchcounty')).toThrow(/ENOENT|no such file/i)
  })
})
