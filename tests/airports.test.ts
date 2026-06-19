import { describe, it, expect } from 'vitest'
import { buildAirportIndex } from '../src/data/airports'

const FIXTURE = [
  { iata: 'SDF', lat: 38.17, lng: -85.74, city: 'Louisville', country: 'USA' },
  { iata: 'anc', lat: 61.17, lng: -149.99, city: 'Anchorage', country: 'USA' },
]

describe('airport index', () => {
  it('looks up by IATA case-insensitively', () => {
    const idx = buildAirportIndex(FIXTURE)
    expect(idx.lookup('SDF')?.lat).toBeCloseTo(38.17)
    expect(idx.lookup('anc')?.lat).toBeCloseTo(61.17)
    expect(idx.lookup('ANC')?.lng).toBeCloseTo(-149.99)
  })
  it('returns undefined for unknown codes', () => {
    expect(buildAirportIndex(FIXTURE).lookup('ZZZ')).toBeUndefined()
  })
})
