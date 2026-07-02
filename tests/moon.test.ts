import { describe, it, expect } from 'vitest'
import { subLunarPoint, moonPhase, terminator } from '../src/astro/moon'

describe('moon', () => {
  it('subLunarPoint returns sane ranges', () => {
    const p = subLunarPoint(new Date('2024-09-18T00:00:00Z'))
    expect(p.lat).toBeGreaterThan(-90); expect(p.lat).toBeLessThan(90)
    expect(p.lng).toBeGreaterThanOrEqual(-180); expect(p.lng).toBeLessThanOrEqual(180)
  })
  it('illumination is near full at the 2024-09-18 full moon', () => {
    expect(moonPhase(new Date('2024-09-18T02:00:00Z')).illum).toBeGreaterThan(0.9)
  })
  it('illumination is near new at the 2024-09-03 new moon', () => {
    expect(moonPhase(new Date('2024-09-03T01:00:00Z')).illum).toBeLessThan(0.1)
  })
})

describe('terminator', () => {
  it('new moon: dark ellipse spans the disc (b = 1)', () => {
    expect(terminator(0, false).b).toBeCloseTo(1)
  })
  it('full moon: no dark region (b = -1)', () => {
    expect(terminator(1, true).b).toBeCloseTo(-1)
  })
  it('quarter moon: straight terminator (b = 0)', () => {
    expect(terminator(0.5, false).b).toBeCloseTo(0)
  })
  it('crescent bulges toward the lit side (b > 0), gibbous toward the dark side (b < 0)', () => {
    expect(terminator(0.25, false).b).toBeCloseTo(0.5)
    expect(terminator(0.75, false).b).toBeCloseTo(-0.5)
  })
  it('dark limb is on the right exactly when waning', () => {
    expect(terminator(0.3, true).darkOnRight).toBe(true)
    expect(terminator(0.3, false).darkOnRight).toBe(false)
  })
  it('clamps out-of-range illumination', () => {
    expect(terminator(-0.2, false).b).toBe(1)
    expect(terminator(1.4, false).b).toBe(-1)
  })
})
