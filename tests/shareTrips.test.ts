import { describe, it, expect } from 'vitest'
import { resolveShareTrips, tripLabel } from '../src/data/shareTrips'
import type { Trip } from '../src/data/trips'
import type { Leg } from '../src/model'

const leg = (from: string, to: string, t: number): Leg => ({
  id: `${from}${to}${t}`, from, to, s: [0, 0], e: [0, 0], t, takeoff: t, landing: t + 3.6e6,
  out: t, in: t + 4e6, blockMs: 3.6e6, sched: { out: null, off: null, on: null, in: null },
  act: { out: null, off: null, on: null, in: null }, dh: false, miles: 500, aircraft: null,
  tail: null, tripId: null,
})
const trip = (id: string, start: number, legs: Leg[]): Trip => ({ id, legs, start, end: legs[legs.length - 1].t, dest: legs[legs.length - 1].to })

describe('resolveShareTrips', () => {
  const now = 1_000_000_000
  const past = trip('p', now - 5 * 86400e3, [leg('SDF', 'ORD', now - 5 * 86400e3), leg('ORD', 'SDF', now - 5 * 86400e3 + 4e6)])
  const cur = trip('c', now - 1000, [leg('SDF', 'MIA', now - 1000)])
  const future = trip('f', now + 5 * 86400e3, [leg('SDF', 'CGN', now + 5 * 86400e3)])

  it('last = most recent trip that has started; next = first upcoming', () => {
    const { last, next } = resolveShareTrips([past, cur, future], now)
    expect(last?.id).toBe('c')
    expect(next?.id).toBe('f')
  })
  it('next is null when nothing is upcoming', () => {
    expect(resolveShareTrips([past, cur], now).next).toBeNull()
  })
  it('last falls back to the final trip when none has started yet', () => {
    const { last } = resolveShareTrips([future], now)
    expect(last?.id).toBe('f')
  })
  it('empty input yields nulls', () => {
    expect(resolveShareTrips([], now)).toEqual({ last: null, next: null })
  })
})

describe('tripLabel', () => {
  it('formats "MMM D · A→B→C" from the trip legs', () => {
    const t = trip('x', Date.UTC(2026, 6, 1), [leg('SDF', 'ANC', Date.UTC(2026, 6, 1)), leg('ANC', 'HKG', Date.UTC(2026, 6, 1) + 4e6)])
    expect(tripLabel(t)).toBe('Jul 1 · SDF→ANC→HKG')
  })
  it('collapses a simple out-and-back to A→B→A', () => {
    const t = trip('y', Date.UTC(2026, 6, 9), [leg('SDF', 'CGN', Date.UTC(2026, 6, 9)), leg('CGN', 'SDF', Date.UTC(2026, 6, 9) + 4e6)])
    expect(tripLabel(t)).toBe('Jul 9 · SDF→CGN→SDF')
  })
})

import { pickTripSpeedIndex, tripFlightMs, VIDEO_FLOOR_MS, VIDEO_CEIL_MS } from '../src/data/shareTrips'

const SPEEDS = [0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const BASE_LEG_MS = 1200

describe('pickTripSpeedIndex', () => {
  it('returns a valid index into SPEEDS', () => {
    const i = pickTripSpeedIndex(4, SPEEDS, BASE_LEG_MS)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(SPEEDS.length)
  })
  it('a 15-leg trip runs at least as fast as a 2-leg trip (higher speed index)', () => {
    expect(pickTripSpeedIndex(15, SPEEDS, BASE_LEG_MS)).toBeGreaterThanOrEqual(pickTripSpeedIndex(2, SPEEDS, BASE_LEG_MS))
  })
  it('chooses the speed closest to the clamped ~1s/leg target', () => {
    const target = (n: number) => Math.min(VIDEO_CEIL_MS, Math.max(VIDEO_FLOOR_MS, n * 1000))
    for (const n of [1, 2, 5, 15, 25, 40]) {
      const i = pickTripSpeedIndex(n, SPEEDS, BASE_LEG_MS)
      const chosenErr = Math.abs(n * (BASE_LEG_MS / SPEEDS[i]) - target(n))
      for (let j = 0; j < SPEEDS.length; j++) {
        const altErr = Math.abs(n * (BASE_LEG_MS / SPEEDS[j]) - target(n))
        expect(chosenErr).toBeLessThanOrEqual(altErr + 1e-6)
      }
    }
  })
  it('keeps realistic trips (<=20 legs) within a shareable ~3-20s flight window', () => {
    for (let n = 1; n <= 20; n++) {
      const ms = tripFlightMs(n, SPEEDS, BASE_LEG_MS)
      expect(ms).toBeGreaterThanOrEqual(3000)
      expect(ms).toBeLessThanOrEqual(20000)
    }
  })
})

import { tripCardStats } from '../src/data/shareTrips'

describe('tripCardStats', () => {
  it('sums flown miles + block hours over operated legs and counts flown legs', () => {
    const legs: Leg[] = [
      { ...leg('SDF', 'ANC', 0), miles: 2000, blockMs: 5 * 3.6e6, dh: false },
      { ...leg('ANC', 'HKG', 1), miles: 4200, blockMs: 9.5 * 3.6e6, dh: false },
      { ...leg('HKG', 'HKG', 2), miles: 100, blockMs: 3.6e6, dh: true },
    ]
    const t = trip('w', 0, legs)
    const s = tripCardStats(t)
    expect(s.route).toBe('SDF→ANC→HKG')
    expect(s.nm).toBe(6200)
    expect(s.legs).toBe(2)
    expect(s.blockHours).toBeCloseTo(14.5, 1)
  })
})
