import { describe, it, expect } from 'vitest'
import { PLANET_IDS, planetSubpoint, sunSubpointViaEphemeris } from '../src/astro/planets'
import { subsolarPoint } from '../src/astro/sun'

// Smallest absolute angular difference between two longitudes (handles ±180 wrap).
const dLng = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

describe('planets ephemeris', () => {
  it('covers all seven planets', () => {
    expect(PLANET_IDS).toEqual(['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'])
  })

  // Cross-check: the Sun's sub-point computed through the planet pipeline (geocentric Sun =
  // −Earth heliocentric) must match the independent subsolarPoint model to a fraction of a degree.
  it('Sun sub-point via ephemeris matches subsolarPoint', () => {
    for (const iso of ['2024-06-20T12:00:00Z', '2025-01-01T00:00:00Z', '2026-09-23T06:00:00Z']) {
      const d = new Date(iso)
      const a = sunSubpointViaEphemeris(d)
      const b = subsolarPoint(d)
      expect(Math.abs(a.lat - b.lat)).toBeLessThan(1)
      expect(dLng(a.lng, b.lng)).toBeLessThan(1)
    }
  })

  it('Sun declination tracks the seasons (~+23.4° near June solstice, ~−23.4° near December)', () => {
    expect(sunSubpointViaEphemeris(new Date('2024-06-20T12:00:00Z')).lat).toBeGreaterThan(23)
    expect(sunSubpointViaEphemeris(new Date('2024-12-21T12:00:00Z')).lat).toBeLessThan(-23)
  })

  it('every planet returns a valid, in-range sub-point', () => {
    const d = new Date('2026-06-20T00:00:00Z')
    for (const id of PLANET_IDS) {
      const p = planetSubpoint(id, d)
      expect(Number.isFinite(p.lat)).toBe(true)
      expect(Number.isFinite(p.lng)).toBe(true)
      expect(p.lat).toBeGreaterThanOrEqual(-90); expect(p.lat).toBeLessThanOrEqual(90)
      expect(p.lng).toBeGreaterThanOrEqual(-180); expect(p.lng).toBeLessThanOrEqual(180)
      // planets stay near the ecliptic — declination well within obliquity + inclination
      expect(Math.abs(p.lat)).toBeLessThan(35)
    }
  })

  it('is deterministic and the planets are not all coincident', () => {
    const d = new Date('2026-06-20T00:00:00Z')
    const a = planetSubpoint('mars', d), b = planetSubpoint('mars', d)
    expect(a).toEqual(b)
    const mars = planetSubpoint('mars', d), jup = planetSubpoint('jupiter', d)
    expect(dLng(mars.lng, jup.lng) + Math.abs(mars.lat - jup.lat)).toBeGreaterThan(1)
  })
})
