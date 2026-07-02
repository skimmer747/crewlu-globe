import { describe, it, expect } from 'vitest'
import { chasePov, altForLeg, CHASE_FLOOR } from '../src/globe/chaseCam'

describe('chaseCam', () => {
  it('cruise flies far below the legacy camera altitude (the visible difference)', () => {
    // Root cause of "no difference": the old fly-to-arrival tween already tracks the
    // route at altForLeg height. The chase must fly WELL below it to read as a chase.
    const shortLeg = chasePov([38, -85], [41, -87], 300, 0.5)
    expect(shortLeg.altitude).toBeLessThan(altForLeg(300) * 0.45)
    expect(shortLeg.altitude).toBeGreaterThanOrEqual(CHASE_FLOOR)
    const longHaul = chasePov([61, -150], [22, 114], 4400, 0.5)
    expect(longHaul.altitude).toBeLessThan(altForLeg(4400) * 0.45)
    expect(longHaul.altitude).toBeGreaterThan(0.35) // never below the dart's max cruise bump
  })
  it('starts wide at the runway and trails behind the dart', () => {
    const early = chasePov([0, 0], [0, 10], 600, 0.02)
    expect(early.altitude).toBeGreaterThan(0.9)
    const mid = chasePov([0, 0], [0, 10], 600, 0.5)
    expect(mid.lng).toBeCloseTo(4, 0) // camera at the p-0.1 track point while the dart is at p=0.5
  })
})
