import { describe, it, expect } from 'vitest'
import { gapLabel, buildAxis, DAY } from '../src/globe/timeAxis'
import type { Trip } from '../src/data/trips'

const trip = (id: string, start: number, end: number, dest = 'ANC'): Trip =>
  ({ id, legs: [], start, end, dest })

describe('gapLabel', () => {
  it('formats days, weeks, months', () => {
    expect(gapLabel(4 * DAY)).toBe('4d off')
    expect(gapLabel(21 * DAY)).toBe('3 wks off')
    expect(gapLabel(60 * DAY)).toBe('2 mo off')
  })
})

describe('buildAxis pieces & gaps', () => {
  const t0 = Date.UTC(2026, 0, 1)
  const trips = [
    trip('A', t0, t0 + 3 * DAY),
    trip('B', t0 + 33 * DAY, t0 + 36 * DAY), // 30-day gap before B -> compressed + labeled
  ]
  const axis = buildAxis(t0, t0 + 36 * DAY, trips)

  it('alternates active/gap pieces covering the domain', () => {
    expect(axis.pieces.map(p => p.kind)).toEqual(['active', 'gap', 'active'])
    expect(axis.pieces[0].startMs).toBe(t0)
    expect(axis.pieces[axis.pieces.length - 1].endMs).toBe(t0 + 36 * DAY)
  })
  it('labels only the compressed (long) gaps', () => {
    expect(axis.gaps.length).toBe(1)
    expect(axis.gaps[0].label).toBe(gapLabel(30 * DAY))
  })
  it('x runs 0..1 monotonically and active trips carry their id', () => {
    expect(axis.pieces[0].x0).toBe(0)
    expect(axis.pieces[axis.pieces.length - 1].x1).toBeCloseTo(1, 6)
    expect(axis.pieces[0].tripId).toBe('A')
    expect(axis.pieces[2].tripId).toBe('B')
    for (let i = 1; i < axis.pieces.length; i++) expect(axis.pieces[i].x0).toBeGreaterThanOrEqual(axis.pieces[i - 1].x1 - 1e-9)
  })
})
