import { describe, it, expect } from 'vitest'
import { normalizeBase } from '../src/data/flights'

describe('normalizeBase', () => {
  it('normalizes to a 3-char uppercase code (SDFZ -> SDF)', () => {
    expect(normalizeBase('SDFZ')).toBe('SDF')
    expect(normalizeBase(' sdf ')).toBe('SDF')
    expect(normalizeBase('ANC')).toBe('ANC')
  })
  it('returns null for empty/absent', () => {
    expect(normalizeBase(null)).toBe(null)
    expect(normalizeBase(undefined)).toBe(null)
    expect(normalizeBase('  ')).toBe(null)
  })
})
