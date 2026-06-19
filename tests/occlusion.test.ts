import { describe, it, expect } from 'vitest'
import { geoToCartesian, isOccluded } from '../src/globe/occlusion'

describe('occlusion', () => {
  const cam = geoToCartesian(0, 0, 2.4, 100) // altitude 2.4 => radius 340

  it('near-side point is visible', () => {
    expect(isOccluded(cam, 0, 0, 1.0, 100)).toBe(false)
  })
  it('far-side (antipodal) point is occluded', () => {
    expect(isOccluded(cam, 0, 180, 1.0, 100)).toBe(true)
  })
})
