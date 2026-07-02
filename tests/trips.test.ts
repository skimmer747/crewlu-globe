import { describe, it, expect } from 'vitest'
import { groupIntoTrips } from '../src/data/trips'
import type { Leg } from '../src/model'

const leg = (o: Partial<Leg>): Leg => ({
  id: 'x', from: 'SDF', to: 'ANC', s: [0, 0], e: [1, 1], t: 0, takeoff: 0, landing: 0, out: 0, in: 0, blockMs: 0, sched: { out: null, off: null, on: null, in: null }, act: { out: null, off: null, on: null, in: null }, dh: false, miles: 1, aircraft: null, tail: null, tripId: null, ...o,
})

describe('groupIntoTrips', () => {
  it('groups by tripId, orders legs and trips by time, sets start/end/dest', () => {
    const trips = groupIntoTrips([
      leg({ id: 'a2', t: 200, tripId: 'T1', to: 'PVG' }),
      leg({ id: 'a1', t: 100, tripId: 'T1', to: 'ANC' }),
      leg({ id: 'b1', t: 500, tripId: 'T2', to: 'SDF' }),
    ])
    expect(trips.map(t => t.id)).toEqual(['T1', 'T2'])
    expect(trips[0].legs.map(l => l.id)).toEqual(['a1', 'a2'])
    expect(trips[0].start).toBe(100)
    expect(trips[0].end).toBe(200)
    expect(trips[0].dest).toBe('PVG')
    expect(trips[1].start).toBe(500)
  })

  it('makes each null-tripId leg its own standalone trip', () => {
    const trips = groupIntoTrips([
      leg({ id: 'x1', t: 100, tripId: null }),
      leg({ id: 'x2', t: 200, tripId: null }),
    ])
    expect(trips.length).toBe(2)
    expect(trips[0].legs.map(l => l.id)).toEqual(['x1'])
    expect(trips[1].legs.map(l => l.id)).toEqual(['x2'])
    expect(trips[0].id).toBe('x1')
    expect(trips[1].id).toBe('x2')
  })

  it('returns [] for no legs', () => {
    expect(groupIntoTrips([])).toEqual([])
  })
})
