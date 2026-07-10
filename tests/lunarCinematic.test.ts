import { describe, it, expect } from 'vitest'
import { trapezoid, buildPacing, fmtMet } from '../src/globe/lunarCinematic'

describe('trapezoid', () => {
  it('starts at 0, ends at 1, symmetric midpoint', () => {
    expect(trapezoid(0)).toBe(0)
    expect(trapezoid(1)).toBeCloseTo(1, 9)
    expect(trapezoid(0.5)).toBeCloseTo(0.5, 9)
  })
  it('is monotonic with a constant-speed cruise', () => {
    let prev = -1
    for (let k = 0; k <= 1.0001; k += 0.01) {
      const s = trapezoid(k)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
    // constant cruise: equal steps in the middle produce equal increments
    const d1 = trapezoid(0.5) - trapezoid(0.45)
    const d2 = trapezoid(0.45) - trapezoid(0.4)
    expect(d1).toBeCloseTo(d2, 9)
  })
})

describe('buildPacing', () => {
  // synthetic 10-segment path, 100 units long
  const cum = Array.from({ length: 11 }, (_, i) => i * 10)

  it('uniform weights: reaches the stop exactly at flyMs, monotonic, never overshoots', () => {
    const weight = new Array(11).fill(1)
    const p = buildPacing(cum, weight, 1)
    expect(p.uAt(0)).toBe(0)
    expect(p.uAt(p.flyMs)).toBeCloseTo(1, 6)
    expect(p.uAt(p.totalMs)).toBeCloseTo(1, 6)
    let prev = -1
    for (let e = 0; e <= p.totalMs; e += 50) {
      const u = p.uAt(e)
      expect(u).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(u).toBeLessThanOrEqual(1 + 1e-9)
      prev = u
    }
  })

  it('a heavy segment gets a proportionally larger share of the flight time', () => {
    // segment 5..6 (10% of the distance) weighted 35x — like a moon flyby
    const weight = new Array(11).fill(1)
    weight[6] = 35
    const p = buildPacing(cum, weight, 1)
    // time spent while u is inside the heavy segment (0.5..0.6 of path)
    let inHeavy = 0
    const step = 20
    for (let e = 0; e <= p.flyMs; e += step) {
      const u = p.uAt(e)
      if (u >= 0.5 && u < 0.6) inHeavy += step
    }
    // heavy segment cost = 350 of total 450 → ~78% of the flight vs 10% naive
    expect(inHeavy / p.flyMs).toBeGreaterThan(0.5)
  })

  it('a short trip parks early and clamps to the stop fraction', () => {
    const weight = new Array(11).fill(1)
    const p = buildPacing(cum, weight, 0.22)
    expect(p.uAt(p.flyMs * 0.5)).toBeLessThan(0.22)
    expect(p.uAt(p.flyMs)).toBeCloseTo(0.22, 6)
    expect(p.uAt(p.totalMs + 1000)).toBeCloseTo(0.22, 6)
  })
})

describe('fmtMet', () => {
  it('formats hours as HHH:MM:SS', () => {
    expect(fmtMet(0)).toBe('000:00:00')
    expect(fmtMet(67.2452)).toBe('067:14:42')
  })
})
