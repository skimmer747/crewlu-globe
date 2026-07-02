import { describe, it, expect } from 'vitest'
import { arcPaint, combineArcData, legDeltaLine } from '../src/globe/arcsLayer'
import type { Leg } from '../src/model'

const leg = (o: Partial<Leg>): Leg => ({
  id: 'x', from: 'A', to: 'B', s: [0, 0], e: [1, 1], t: 0, takeoff: 0, landing: 0, out: 0, in: 0, blockMs: 0, sched: { out: null, off: null, on: null, in: null }, act: { out: null, off: null, on: null, in: null }, dh: false, miles: 1, aircraft: null, tripId: null, ...o,
})

describe('arcsLayer helpers', () => {
  it('arcPaint: solid flew is bright cyan both ends', () => {
    expect(arcPaint(leg({ dh: false }))).toEqual(['#5fe0ff', '#5fe0ff'])
  })
  it('arcPaint: solid deadhead is amber', () => {
    expect(arcPaint(leg({ dh: true }))).toEqual(['#ffb15f', '#ffb15f'])
  })
  it('arcPaint: ghost uses low-alpha rgba', () => {
    const [c] = arcPaint(leg({ dh: false, __ghost: true } as any))
    expect(c).toMatch(/^rgba\(/)
    expect(c).toContain('0.18')
  })
  it('legDeltaLine formats OFF/ON deltas and block with sked', () => {
    const l = leg({ blockMs: (7 * 60 + 42) * 60000,
      sched: { out: 0, off: 10 * 60000, on: null, in: (7 * 60 + 55) * 60000 },
      act: { out: 0, off: 24 * 60000, on: null, in: null } })
    expect(legDeltaLine(l)).toBe('OFF +0:14 · BLOCK 7+42 (SKED 7+55)')
  })
  it('legDeltaLine shows early arrivals negative and skips sked when equal', () => {
    const l = leg({ blockMs: 5 * 3600000,
      sched: { out: 0, off: null, on: 6 * 3600000, in: 5 * 3600000 },
      act: { out: 0, off: null, on: 6 * 3600000 - 6 * 60000, in: null } })
    expect(legDeltaLine(l)).toBe('ON −0:06 · BLOCK 5+00')
  })
  it('legDeltaLine falls back to block only without comparable pairs', () => {
    expect(legDeltaLine(leg({ blockMs: 90 * 60000 }))).toBe('BLOCK 1+30')
  })
  it('combineArcData tags ghosts and keeps order solid-first', () => {
    const out = combineArcData([leg({ id: 's' })], [leg({ id: 'g' })])
    expect(out.map(l => l.id)).toEqual(['s', 'g'])
    expect((out[0] as any).__ghost).toBeFalsy()
    expect((out[1] as any).__ghost).toBe(true)
  })
})
