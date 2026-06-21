import { describe, it, expect } from 'vitest'
import { LUNAR_RETURN_NM, lunarReturns, buildTrajectoryPoints, sliceTrajectory } from '../src/globe/lunarTrajectory'

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
