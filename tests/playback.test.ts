import { describe, it, expect } from 'vitest'
import { buildPlaybackSchedule, playheadForSample } from '../src/globe/playback'
import type { Leg } from '../src/model'

const leg = (id: string, t: number, tripId: string | null): Leg =>
  ({ id, from: 'A', to: 'B', s: [0, 0], e: [1, 1], t, takeoff: t, landing: t, dh: false, miles: 1, aircraft: null, tripId })

describe('buildPlaybackSchedule', () => {
  // 3 legs: two in trip T1, one in trip T2 -> one dwell after leg index 1
  const legs = [leg('a', 1, 'T1'), leg('b', 2, 'T1'), leg('c', 3, 'T2')]
  const sched = buildPlaybackSchedule(legs, [], { legMs: 100, dwellMs: 50 })

  it('total = 3 legs * 100 + 1 dwell * 50', () => {
    expect(sched.totalMs).toBe(350)
  })
  it('samples draw phase within a leg', () => {
    expect(sched.sampleAt(50)).toMatchObject({ index: 0, phase: 'draw', done: false })
    expect(sched.sampleAt(50).frac).toBeCloseTo(0.5, 6)
  })
  it('inserts dwell only at the trip boundary (after leg 1)', () => {
    // leg1 draw: [100,200); dwell: [200,250); leg2 draw: [250,350)
    expect(sched.sampleAt(220)).toMatchObject({ index: 1, phase: 'dwell' })
    expect(sched.sampleAt(300)).toMatchObject({ index: 2, phase: 'draw' })
  })
  it('reports done past the end', () => {
    expect(sched.sampleAt(999)).toMatchObject({ index: 2, done: true })
  })
  it('timeAtIndex returns the draw-start of a leg', () => {
    expect(sched.timeAtIndex(2)).toBe(250)
  })
  it('empty legs -> total 0', () => {
    expect(buildPlaybackSchedule([], [], { legMs: 100, dwellMs: 50 }).totalMs).toBe(0)
  })
  it('inserts a dwell between two standalone (null-tripId) legs', () => {
    const s = buildPlaybackSchedule([leg('x', 1, null), leg('y', 2, null)], [], { legMs: 100, dwellMs: 50 })
    expect(s.totalMs).toBe(250) // 100 + 50 dwell + 100
  })
  it('inserts no dwell when all legs share a tripId', () => {
    const s = buildPlaybackSchedule([leg('a', 1, 'T1'), leg('b', 2, 'T1')], [], { legMs: 100, dwellMs: 50 })
    expect(s.totalMs).toBe(200)
  })
})

describe('playheadForSample', () => {
  // airborne span: takeoff 1000 -> landing 5000 (4s of real time), departure t=900
  const L: Leg = { ...leg('a', 900, 'T1'), takeoff: 1000, landing: 5000 }

  it('interpolates across the airborne span while the leg flies (draw phase)', () => {
    expect(playheadForSample(L, { index: 0, phase: 'draw', frac: 0, done: false })).toBe(1000)
    expect(playheadForSample(L, { index: 0, phase: 'draw', frac: 0.5, done: false })).toBe(3000)
    expect(playheadForSample(L, { index: 0, phase: 'draw', frac: 1, done: false })).toBe(5000)
  })
  it('holds at landing during a dwell', () => {
    expect(playheadForSample(L, { index: 0, phase: 'dwell', frac: 1, done: false })).toBe(5000)
  })
})
