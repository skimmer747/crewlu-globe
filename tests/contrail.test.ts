import { describe, it, expect } from 'vitest'
import { createContrail } from '../src/globe/contrail'

describe('contrail', () => {
  it('throttles pushes to the 40ms window', () => {
    const c = createContrail()
    expect(c.push(0, 0, 0.02, 1000)).toBe(true)
    expect(c.push(0, 1, 0.02, 1020)).toBe(false) // too soon
    expect(c.push(0, 1, 0.02, 1041)).toBe(true)
    expect(c.size()).toBe(2)
  })
  it('caps the buffer at 60 points, dropping the tail', () => {
    const c = createContrail()
    for (let i = 0; i < 80; i++) c.push(i, 0, 0.02, i * 50)
    expect(c.size()).toBe(60)
    expect(c.snapshot()!.pts[0][0]).toBe(20) // oldest 20 dropped
  })
  it('alpha ramps 0 at the tail to 0.85 at the head', () => {
    const c = createContrail()
    for (let i = 0; i < 5; i++) c.push(i, 0, 0.02, i * 50)
    const snap = c.snapshot()!
    expect(snap.colors[0]).toContain(',0.000)')
    expect(snap.colors[4]).toContain(',0.850)')
  })
  it('decay eats from the tail and reports emptiness; snapshot null under 2 pts', () => {
    const c = createContrail()
    c.push(1, 0, 0.02, 0); c.push(2, 0, 0.02, 50); c.push(3, 0, 0.02, 100)
    expect(c.decay()).toBe(true)
    expect(c.snapshot()!.pts[0][0]).toBe(2)
    expect(c.decay()).toBe(true)
    expect(c.snapshot()).toBe(null) // 1 point left: nothing to draw
    expect(c.decay()).toBe(false)
  })
})
