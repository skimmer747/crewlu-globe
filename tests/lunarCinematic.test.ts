import { describe, it, expect } from 'vitest'
import { missionStateAt, MISSION_TOTAL_MS, fmtMet } from '../src/globe/lunarCinematic'

describe('missionStateAt', () => {
  it('starts at the pad and ends just short of home', () => {
    expect(missionStateAt(0).u).toBe(0)
    expect(missionStateAt(MISSION_TOTAL_MS).u).toBeCloseTo(0.985, 3)
  })

  it('u is monotonic over the whole flight', () => {
    let prev = -1
    for (let t = 0; t <= MISSION_TOTAL_MS; t += 50) {
      const { u } = missionStateAt(t)
      expect(u).toBeGreaterThanOrEqual(prev)
      prev = u
    }
  })

  it('crawls the Moon for the near-side + earthrise beats', () => {
    // 19s–25s of the timeline crawls around the Moon (u ≈ 0.497 → 0.507)
    expect(missionStateAt(19500).u).toBeGreaterThan(0.49)
    expect(missionStateAt(24500).u).toBeLessThan(0.51)
  })

  it('is fully behind the ship a quarter of the way out', () => {
    // theta ≈ 172+ (chase) from u ≈ 0.12 onward — the camera must not lag the swing
    // until the ship is already at the Moon.
    const t = 7500 // end of the settle-behind beat
    expect(missionStateAt(t).cam.theta).toBeGreaterThan(165)
    expect(missionStateAt(t).u).toBeLessThan(0.15)
  })

  it('camera rig stays in sane bounds and ends in chase position', () => {
    for (let t = 0; t <= MISSION_TOTAL_MS; t += 250) {
      const { cam } = missionStateAt(t)
      expect(cam.dist).toBeGreaterThan(10)
      expect(cam.dist).toBeLessThan(60)
      expect(cam.theta).toBeGreaterThanOrEqual(0)
      expect(cam.theta).toBeLessThanOrEqual(180)
      expect(cam.rise).toBeGreaterThanOrEqual(0)
    }
    expect(missionStateAt(MISSION_TOTAL_MS).cam.theta).toBeCloseTo(178, 0)
  })
})

describe('fmtMet', () => {
  it('formats hours as HHH:MM:SS', () => {
    expect(fmtMet(0)).toBe('000:00:00')
    expect(fmtMet(67.2452)).toBe('067:14:42')
  })
})
