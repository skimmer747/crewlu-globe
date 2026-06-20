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

describe('buildAxis dateToX / xToDate', () => {
  const t0 = Date.UTC(2026, 0, 1)
  const trips = [trip('A', t0, t0 + 3 * DAY), trip('B', t0 + 33 * DAY, t0 + 36 * DAY)]
  const axis = buildAxis(t0, t0 + 36 * DAY, trips)

  it('round-trips dates inside active pieces', () => {
    const mid = t0 + 1.5 * DAY
    expect(axis.xToDate(axis.dateToX(mid))).toBeCloseTo(mid, -3)
  })
  it('clamps outside the domain', () => {
    expect(axis.dateToX(t0 - DAY)).toBe(0)
    expect(axis.dateToX(t0 + 99 * DAY)).toBe(1)
  })
  it('compresses the long gap: 30 real days occupy <= the active widths', () => {
    const gapX = axis.gaps[0].x1 - axis.gaps[0].x0
    const activeX = axis.pieces[0].x1 - axis.pieces[0].x0
    expect(gapX).toBeLessThanOrEqual(activeX + 1e-9)
  })
})

describe('buildAxis ticks', () => {
  it('uses monthly ticks across ~6 months and they are within [0,1]', () => {
    const t0 = Date.UTC(2026, 0, 1)
    const axis = buildAxis(t0, Date.UTC(2026, 6, 1), [trip('A', t0, Date.UTC(2026, 6, 1))])
    expect(axis.ticks.length).toBeGreaterThanOrEqual(4)
    for (const tk of axis.ticks) { expect(tk.x).toBeGreaterThanOrEqual(0); expect(tk.x).toBeLessThanOrEqual(1) }
  })
  it('uses yearly ticks across many years', () => {
    const axis = buildAxis(Date.UTC(2019, 0, 1), Date.UTC(2026, 0, 1), [trip('A', Date.UTC(2019, 0, 1), Date.UTC(2026, 0, 1))])
    expect(axis.ticks.some(tk => /^\d{4}$/.test(tk.label))).toBe(true)
  })
})
