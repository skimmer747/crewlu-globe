import { describe, it, expect } from 'vitest'
import { LUNAR_RETURN_NM, lunarReturns, lunarTripLog, buildTrajectoryPoints, buildProgressPath, sliceTrajectory, pointAtFraction } from '../src/globe/lunarTrajectory'
import type { GeoPoint } from '../src/globe/lunarTrajectory'

const R100 = 100
const radiusOf = (p: GeoPoint) => R100 * (1 + p.alt)

describe('lunarTripLog', () => {
  it('headlines the racetrack position and reports days aloft', () => {
    const log = lunarTripLog(89348, 231, { lap: 1, segment: 'outbound', legProgress: 0.42 })
    expect(log).toContain('LAP 1 · OUTBOUND — 42% of the way to the Moon')
    expect(log).toContain('89,348 NM · 0.22 returns')
    expect(log).toContain('231 block hours — 9.6 days in the air')
    expect(log).toContain('× around the Earth')
  })

  it('inbound and moon segments get their own headlines', () => {
    expect(lunarTripLog(LUNAR_RETURN_NM * 2.9, 4800, { lap: 3, segment: 'inbound', legProgress: 0.8 }))
      .toContain('LAP 3 · INBOUND — 80% of the way home')
    expect(lunarTripLog(LUNAR_RETURN_NM * 2.5, 4800, { lap: 3, segment: 'moon', legProgress: 0.5 }))
      .toContain('LAP 3 · ROUNDING THE MOON')
  })

  it('falls back to a plain headline without a position', () => {
    expect(lunarTripLog(LUNAR_RETURN_NM * 2, 4000)).toContain('2.00 Earth–Moon returns')
  })
})

describe('buildProgressPath (the lunar-return racetrack)', () => {
  const moon = { lat: 12, lng: -140, alt: 59.3 }
  const cam = { x: 0, y: 0, z: 100 }
  const start = { lat: 38.17, lng: -85.74 }
  const build = (laps: number) => buildProgressPath(moon.lat, moon.lng, moon.alt, { laps, cam, start })

  it('one circuit = out, around the Moon, and back to Earth', () => {
    const p = build(1)
    expect(p.strands).toBe(1)
    expect(p.stopFraction).toBeCloseTo(1, 5) // a full return ends the circuit back at Earth
    expect(p.segment).toBe('inbound')
    expect(Math.max(...p.points.map(radiusOf))).toBeGreaterThan(5900) // reached the Moon
    const end = p.points[p.points.length - 1]
    expect(radiusOf(end)).toBeLessThan(130) // ...and came back around Earth (parking altitude)
    expect(p.points[0].lat).toBeCloseTo(start.lat, 1) // launched from the pad
  })

  it('0.21 returns parks mid-outbound on lap 1 (0.5 ≈ reached the Moon)', () => {
    const p = build(0.21)
    expect(p.lap).toBe(1)
    expect(p.segment).toBe('outbound')
    expect(p.legProgress).toBeGreaterThan(0.2)
    expect(p.legProgress).toBeLessThan(0.6)
  })

  it('0.62 returns is already heading home', () => {
    const p = build(0.62)
    expect(p.segment).toBe('inbound')
    expect(p.lap).toBe(1)
  })

  it('2.34 returns: three strands drawn, parked outbound on lap 3', () => {
    const p = build(2.34)
    expect(p.strands).toBe(3)
    expect(p.lap).toBe(3)
    expect(p.segment).toBe('outbound')
    expect(p.stopFraction).toBeGreaterThan(2 / 3) // past two full circuits
    expect(p.stopFraction).toBeLessThan(1)
  })

  it('careers beyond the drawn cap keep the true lap number', () => {
    const p = build(20.3)
    expect(p.strands).toBe(3)
    expect(p.lap).toBe(21)
    expect(p.stopFraction).toBeLessThan(1)
  })

  it('never dips inside the Earth, and the odometer is monotonic', () => {
    const p = build(2.5)
    for (const pt of p.points) expect(radiusOf(pt)).toBeGreaterThanOrEqual(R100 - 1e-6)
    for (let i = 1; i < p.cum.length; i++) expect(p.cum[i]).toBeGreaterThanOrEqual(p.cum[i - 1])
  })
})

describe('lunarReturns', () => {
  it('one round trip = the Earth-Moon return distance', () => {
    expect(lunarReturns(LUNAR_RETURN_NM)).toBeCloseTo(1, 6)
  })
  it('309,626 nm is about 0.75 of a return', () => {
    expect(lunarReturns(309626)).toBeCloseTo(0.746, 2)
  })
})

describe('buildTrajectoryPoints', () => {
  const t = buildTrajectoryPoints(20, -30, 59.3)

  it('starts and ends at the Earth surface', () => {
    expect(Math.abs(t.points[0].alt)).toBeLessThan(0.5)
    expect(Math.abs(t.points[t.points.length - 1].alt)).toBeLessThan(0.5)
  })
  it('reaches the Moon near the mid-point', () => {
    const maxAlt = Math.max(...t.points.map((p) => p.alt))
    expect(maxAlt).toBeGreaterThan(55)
    expect(maxAlt).toBeLessThan(62)
  })
  it('has a monotonic cumulative length', () => {
    for (let i = 1; i < t.cum.length; i++) expect(t.cum[i]).toBeGreaterThanOrEqual(t.cum[i - 1])
    expect(t.length).toBeGreaterThan(0)
  })
})

const R = 100
const rOf = (p: GeoPoint) => R * (1 + p.alt)

describe('buildTrajectoryPoints with a launch anchor', () => {
  const moon = { lat: 12, lng: -140, alt: 59.3 }
  const cam = { x: 0, y: 0, z: 100 }
  const start = { lat: 38.17, lng: -85.74 } // SDF

  it('starts exactly at the pad and returns near it', () => {
    const t = buildTrajectoryPoints(moon.lat, moon.lng, moon.alt, { cam, start })
    expect(t.points[0].lat).toBeCloseTo(start.lat, 1)
    expect(t.points[0].lng).toBeCloseTo(start.lng, 1)
    const end = t.points[t.points.length - 1]
    expect(Math.abs(end.lat - start.lat)).toBeLessThan(12)
    expect(Math.abs(rOf(end) - R)).toBeLessThan(0.5)
  })

  it('never dips inside the Earth, even from an antipodal pad', () => {
    const away = { lat: -12, lng: 40 } // opposite side of Earth from the Moon
    const t = buildTrajectoryPoints(moon.lat, moon.lng, moon.alt, { cam, start: away })
    for (const p of t.points) expect(rOf(p)).toBeGreaterThanOrEqual(R - 1e-6)
  })

  it('still reaches and loops the Moon', () => {
    const t = buildTrajectoryPoints(moon.lat, moon.lng, moon.alt, { cam, start })
    const maxR = Math.max(...t.points.map(rOf))
    expect(maxR).toBeGreaterThan(6000)
    for (let i = 1; i < t.cum.length; i++) expect(t.cum[i]).toBeGreaterThanOrEqual(t.cum[i - 1])
  })

  it('unanchored path is unchanged (starts on the surface near the moonward point)', () => {
    const t = buildTrajectoryPoints(moon.lat, moon.lng, moon.alt, { cam })
    expect(Math.abs(rOf(t.points[0]) - R)).toBeLessThan(0.5)
  })
})

describe('pointAtFraction', () => {
  const t = buildTrajectoryPoints(10, -120, 59.3, { cam: { x: 0, y: 0, z: 100 }, start: { lat: 38, lng: -85 } })
  it('interpolates endpoints and interior', () => {
    expect(pointAtFraction(t, 0).lat).toBeCloseTo(t.points[0].lat, 5)
    expect(pointAtFraction(t, 1).alt).toBeCloseTo(t.points[t.points.length - 1].alt, 5)
    expect(rOf(pointAtFraction(t, 0.5))).toBeGreaterThan(1000) // mid-path is deep space
  })
})

describe('sliceTrajectory', () => {
  const t = buildTrajectoryPoints(20, -30, 59.3)
  it('returns nothing at 0 and the whole path at 1', () => {
    expect(sliceTrajectory(t, 0)).toEqual([])
    expect(sliceTrajectory(t, 1).length).toBe(t.points.length)
  })
  it('reveals a partial path at 0.5', () => {
    const half = sliceTrajectory(t, 0.5)
    expect(half.length).toBeGreaterThan(0)
    expect(half.length).toBeLessThan(t.points.length)
  })
})
