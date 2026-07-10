import { describe, it, expect } from 'vitest'
import { missionTiming, shipUAt, fmtMet } from '../src/globe/lunarCinematic'

describe('missionTiming', () => {
  it('parks-early trips are shorter than full-coil trips', () => {
    expect(missionTiming(0.2).totalMs).toBeLessThan(missionTiming(1).totalMs)
    expect(missionTiming(0).flyMs).toBeGreaterThan(0)
    expect(missionTiming(1).totalMs).toBe(missionTiming(1).flyMs + missionTiming(1).parkMs)
  })
})

describe('shipUAt', () => {
  const stop = 0.22
  const t = missionTiming(stop)

  it('starts at 0 and reaches exactly the stop fraction, then parks there', () => {
    expect(shipUAt(0, stop, t)).toBe(0)
    expect(shipUAt(t.flyMs, stop, t)).toBeCloseTo(stop, 6)
    expect(shipUAt(t.totalMs, stop, t)).toBeCloseTo(stop, 6) // parked, never overshoots
  })

  it('is monotonic over the flight and never exceeds the stop', () => {
    let prev = -1
    for (let e = 0; e <= t.totalMs; e += 100) {
      const u = shipUAt(e, stop, t)
      expect(u).toBeGreaterThanOrEqual(prev)
      expect(u).toBeLessThanOrEqual(stop + 1e-9)
      prev = u
    }
  })
})

describe('fmtMet', () => {
  it('formats hours as HHH:MM:SS', () => {
    expect(fmtMet(0)).toBe('000:00:00')
    expect(fmtMet(67.2452)).toBe('067:14:42')
  })
})
