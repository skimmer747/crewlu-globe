import { describe, it, expect } from 'vitest'
import { envelopeFractions } from '../src/globe/dartLayer'

describe('envelopeFractions', () => {
  it('mid-range legs get proportional fractions; extremes clamp', () => {
    const fourHour = envelopeFractions(4 * 3600 * 1000)
    expect(fourHour.growEnd).toBeCloseTo(20 / 240, 3)        // 8.3% climbing
    expect(fourHour.shrinkStart).toBeCloseTo(1 - 30 / 240, 3) // descending from 87.5%
    const longHaul = envelopeFractions(14 * 3600 * 1000)
    expect(longHaul.growEnd).toBe(0.05)   // floored so the playback grow animation stays visible
    expect(longHaul.shrinkStart).toBe(0.94)
    const short = envelopeFractions(30 * 60000)
    expect(short.growEnd).toBe(0.45)
    expect(short.shrinkStart).toBe(0.55)
  })
  it('degenerate spans stay sane', () => {
    const f = envelopeFractions(0)
    expect(f.growEnd).toBeLessThanOrEqual(0.45)
    expect(f.shrinkStart).toBeGreaterThanOrEqual(0.55)
    expect(f.growEnd).toBeLessThan(f.shrinkStart)
  })
})
