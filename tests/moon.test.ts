import { describe, it, expect } from 'vitest'
import { subLunarPoint, moonPhase } from '../src/astro/moon'

describe('moon', () => {
  it('subLunarPoint returns sane ranges', () => {
    const p = subLunarPoint(new Date('2024-09-18T00:00:00Z'))
    expect(p.lat).toBeGreaterThan(-90); expect(p.lat).toBeLessThan(90)
    expect(p.lng).toBeGreaterThanOrEqual(-180); expect(p.lng).toBeLessThanOrEqual(180)
  })
  it('illumination is near full at the 2024-09-18 full moon', () => {
    expect(moonPhase(new Date('2024-09-18T02:00:00Z')).illum).toBeGreaterThan(0.9)
  })
  it('illumination is near new at the 2024-09-03 new moon', () => {
    expect(moonPhase(new Date('2024-09-03T01:00:00Z')).illum).toBeLessThan(0.1)
  })
})
