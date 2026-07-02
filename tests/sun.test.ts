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

import { sunElevationDeg } from '../src/astro/sun'

describe('sunElevationDeg', () => {
  const t = Date.parse('2026-06-21T12:00:00Z')
  it('is +90 at the subsolar point and -90 at its antipode', () => {
    const s = subsolarPoint(new Date(t))
    expect(sunElevationDeg(s.lat, s.lng, t)).toBeCloseTo(90, 3)
    const antiLng = s.lng > 0 ? s.lng - 180 : s.lng + 180
    expect(sunElevationDeg(-s.lat, antiLng, t)).toBeCloseTo(-90, 3)
  })
  it('is ~0 on the terminator (90 degrees away, due north on the same meridian)', () => {
    const s = subsolarPoint(new Date(t))
    const over = s.lat + 90 > 90
    const lat90 = over ? 180 - (s.lat + 90) : s.lat + 90
    const lng90 = over ? (s.lng > 0 ? s.lng - 180 : s.lng + 180) : s.lng
    expect(Math.abs(sunElevationDeg(lat90, lng90, t))).toBeLessThan(0.01)
  })
})
