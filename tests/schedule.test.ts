import { describe, it, expect } from 'vitest'
import { beaconHome, focusTrip, defaultWindow, legsInWindow, splitAtPlayhead } from '../src/data/schedule'
import { groupIntoTrips } from '../src/data/trips'
import type { Leg } from '../src/model'

const leg = (o: Partial<Leg>): Leg => ({
  id: 'x', from: 'SDF', to: 'ANC', s: [10, 10], e: [20, 20], t: 0, takeoff: 0, landing: 0, out: 0, in: 0, blockMs: 0, sched: { out: null, off: null, on: null, in: null }, act: { out: null, off: null, on: null, in: null }, dh: false, miles: 1, aircraft: null, tripId: null, ...o,
})

describe('schedule', () => {
  const legs = [
    leg({ id: 'p1', t: 100, tripId: 'P', s: [1, 1], e: [2, 2] }),
    leg({ id: 'p2', t: 200, tripId: 'P', s: [2, 2], e: [3, 3] }),
    leg({ id: 'f1', t: 800, tripId: 'F', s: [3, 3], e: [4, 4] }),
  ]
  const trips = groupIntoTrips(legs)

  it('beaconHome = arrival of last flown leg', () => {
    expect(beaconHome(legs, 500)).toEqual([3, 3]) // p2 is last with t<=500
  })
  it('beaconHome falls back to first upcoming departure when nothing flown', () => {
    expect(beaconHome(legs, 50)).toEqual([1, 1])
  })
  it('beaconHome is null with no legs', () => {
    expect(beaconHome([], 0)).toBe(null)
  })

  it('focusTrip = trip containing now', () => {
    expect(focusTrip(trips, 150)?.id).toBe('P')
  })
  it('focusTrip = next upcoming when off between trips', () => {
    expect(focusTrip(trips, 500)?.id).toBe('F')
  })
  it('focusTrip = last trip when now is past everything', () => {
    expect(focusTrip(trips, 9999)?.id).toBe('F')
  })

  it('defaultWindow spans min(now, focus.start) .. lastLeg', () => {
    expect(defaultWindow(legs, trips, 500)).toEqual({ start: 500, end: 800 })
    expect(defaultWindow(legs, trips, 150)).toEqual({ start: 100, end: 800 })
  })

  it('defaultWindow when now is before the first leg shows the full future', () => {
    expect(defaultWindow(legs, trips, 50)).toEqual({ start: 50, end: 800 })
  })
  it('defaultWindow when now is past the last leg collapses to the last leg', () => {
    expect(defaultWindow(legs, trips, 9999)).toEqual({ start: 800, end: 800 })
  })

  it('legsInWindow filters inclusive', () => {
    expect(legsInWindow(legs, { start: 100, end: 200 }).map(l => l.id)).toEqual(['p1', 'p2'])
  })

  it('splitAtPlayhead splits solid vs ghost', () => {
    const { solid, ghost } = splitAtPlayhead(legs, 200)
    expect(solid.map(l => l.id)).toEqual(['p1', 'p2'])
    expect(ghost.map(l => l.id)).toEqual(['f1'])
  })
})
