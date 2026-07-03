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
