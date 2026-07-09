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

  it('holds near the Moon for the earthrise beat', () => {
    // 19s–23s of the timeline crawls through the far side (u ≈ 0.499 → 0.505)
    expect(missionStateAt(19000).u).toBeGreaterThan(0.49)
    expect(missionStateAt(23000).u).toBeLessThan(0.51)
  })

  it('camera rig stays in sane bounds and ends in chase position', () => {
    for (let t = 0; t <= MISSION_TOTAL_MS; t += 250) {
      const { cam } = missionStateAt(t)
      expect(cam.dist).toBeGreaterThan(10)
      expect(cam.dist).toBeLessThan(40)
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
