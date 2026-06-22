import { describe, it, expect } from 'vitest'
import { shuttleRate, clampStart, clampEnd, DAY } from '../src/globe/shuttle'

const SPAN = 700 * DAY // ~2 years

describe('shuttleRate', () => {
  it('is zero at/below the dead zone or for inward (negative) overshoot', () => {
    expect(shuttleRate(0, 100, SPAN)).toBe(0)
    expect(shuttleRate(5, 100, SPAN)).toBe(0)
    expect(shuttleRate(-20, 100, SPAN)).toBe(0)
  })
  it('reaches full-span-in-targetSec at a full pull', () => {
    expect(shuttleRate(100, 100, SPAN, { targetSec: 2.5 })).toBeCloseTo(SPAN / 2.5, -3)
  })
  it('accelerates: pushing further is strictly faster', () => {
    const a = shuttleRate(30, 100, SPAN)
    const b = shuttleRate(60, 100, SPAN)
    const c = shuttleRate(90, 100, SPAN)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })
  it('is convex (accelerating), not linear', () => {
    const mid = shuttleRate(50, 100, SPAN)
    const full = shuttleRate(100, 100, SPAN)
    expect(mid).toBeLessThan(full * 0.5)
  })
})

describe('clampStart / clampEnd', () => {
  const dStart = 0, dEnd = SPAN, minWin = DAY
  it('clampStart respects the domain floor and the min window', () => {
    expect(clampStart(-100, SPAN, dStart, minWin)).toBe(dStart)
    expect(clampStart(SPAN, SPAN, dStart, minWin)).toBe(SPAN - minWin)
    expect(clampStart(10 * DAY, SPAN, dStart, minWin)).toBe(10 * DAY)
  })
  it('clampEnd respects the domain ceiling and the min window', () => {
    expect(clampEnd(SPAN + 100, 0, dEnd, minWin)).toBe(dEnd)
    expect(clampEnd(0, 0, dEnd, minWin)).toBe(minWin)
    expect(clampEnd(10 * DAY, 0, dEnd, minWin)).toBe(10 * DAY)
  })
})
