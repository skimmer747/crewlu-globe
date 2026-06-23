import { describe, it, expect } from 'vitest'
import { arcPaint, combineArcData } from '../src/globe/arcsLayer'
import type { Leg } from '../src/model'

const leg = (o: Partial<Leg>): Leg => ({
  id: 'x', from: 'A', to: 'B', s: [0, 0], e: [1, 1], t: 0, takeoff: 0, landing: 0, dh: false, miles: 1, aircraft: null, tripId: null, ...o,
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
  it('combineArcData tags ghosts and keeps order solid-first', () => {
    const out = combineArcData([leg({ id: 's' })], [leg({ id: 'g' })])
    expect(out.map(l => l.id)).toEqual(['s', 'g'])
    expect((out[0] as any).__ghost).toBeFalsy()
    expect((out[1] as any).__ghost).toBe(true)
  })
})
