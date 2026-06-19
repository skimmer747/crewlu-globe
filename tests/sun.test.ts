import { describe, it, expect } from 'vitest'
import { subsolarPoint } from '../src/astro/sun'

describe('subsolarPoint', () => {
  it('declination ~ +23.4 at June solstice', () => {
    const { lat } = subsolarPoint(new Date('2024-06-20T12:00:00Z'))
    expect(lat).toBeGreaterThan(23)
    expect(lat).toBeLessThan(23.6)
  })
  it('declination ~ -23.4 at December solstice', () => {
    const { lat } = subsolarPoint(new Date('2024-12-21T12:00:00Z'))
    expect(lat).toBeLessThan(-23)
    expect(lat).toBeGreaterThan(-23.6)
  })
  it('longitude stays within [-180,180]', () => {
    const { lng } = subsolarPoint(new Date('2024-03-20T06:00:00Z'))
    expect(lng).toBeGreaterThanOrEqual(-180)
    expect(lng).toBeLessThanOrEqual(180)
  })
})
