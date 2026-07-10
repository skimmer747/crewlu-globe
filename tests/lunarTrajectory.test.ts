import { describe, it, expect } from 'vitest'
import { LUNAR_RETURN_NM, lunarReturns, lunarTripLog, buildTrajectoryPoints, buildProgressPath, sliceTrajectory, pointAtFraction } from '../src/globe/lunarTrajectory'
import type { GeoPoint } from '../src/globe/lunarTrajectory'

const R100 = 100
const radiusOf = (p: GeoPoint) => R100 * (1 + p.alt)

describe('lunarTripLog', () => {
  it('sub-1.0: headlines percent to the Moon and reports days aloft', () => {
    const log = lunarTripLog(89348, 231)
    expect(log).toContain('89,348 NM flown — 22% of the way to the Moon')
    expect(log).toContain('0.22 Earth–Moon returns')
    expect(log).toContain('231 block hours — 9.6 days in the air')
    expect(log).toContain('× around the Earth')
  })

  it('past 1.0: headlines to-the-Moon-and-back with the extra percent', () => {
    const log = lunarTripLog(LUNAR_RETURN_NM * 2.34, 4800)
    expect(log).toContain('to the Moon & back ×2, +34% again')
    expect(log).toContain('2.34 Earth–Moon returns')
  })

  it('exact multiple omits the "+N% again" tail', () => {
    expect(lunarTripLog(LUNAR_RETURN_NM * 2, 4000)).toContain('to the Moon & back ×2')
    expect(lunarTripLog(LUNAR_RETURN_NM * 2, 4000)).not.toContain('again')
  })
})

describe('buildProgressPath (fly to your earned spot)', () => {
  const moon = { lat: 12, lng: -140, alt: 59.3 }
  const cam = { x: 0, y: 0, z: 100 }
  const start = { lat: 38.17, lng: -85.74 }

  it('sub-1.0 mileage: no laps, stop fraction tracks the transit progress, moon not reached', () => {
    const p = buildProgressPath(moon.lat, moon.lng, moon.alt, { laps: 0.22, cam, start })
    expect(p.loopCount).toBe(0)
    expect(p.reachedMoon).toBe(false)
    expect(p.stopFraction).toBeCloseTo(0.22, 2) // no loops → path is the outbound, fraction == laps
    expect(p.points[0].lat).toBeCloseTo(start.lat, 1)
  })

  it('one full return reaches the Moon at the end of the transit', () => {
    const p = buildProgressPath(moon.lat, moon.lng, moon.alt, { laps: 1, cam, start })
    expect(p.loopCount).toBe(0)
    expect(p.reachedMoon).toBe(true)
    expect(p.stopFraction).toBeCloseTo(1, 5)
    expect(Math.max(...p.points.map(radiusOf))).toBeGreaterThan(5900) // out at the Moon (near-side entry ~5985)
  })

  it('2.34 returns → two laps of headroom, ship parks partway through the second', () => {
    const p = buildProgressPath(moon.lat, moon.lng, moon.alt, { laps: 2.34, cam, start })
    expect(p.loopCount).toBe(2)
    expect(p.reachedMoon).toBe(true)
    // outLen is 1 return; each loop is one more. 2.34 → outLen + 1.34 loops.
    const perLoop = (p.length - p.outLen) / 2
    const expected = (p.outLen + 1.34 * perLoop) / p.length
    expect(p.stopFraction).toBeCloseTo(expected, 4)
    expect(p.stopFraction).toBeLessThan(1)
  })

  it('never dips inside the Earth', () => {
    const p = buildProgressPath(moon.lat, moon.lng, moon.alt, { laps: 2.5, cam, start })
    for (const pt of p.points) expect(radiusOf(pt)).toBeGreaterThanOrEqual(R100 - 1e-6)
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
