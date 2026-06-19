import { describe, it, expect } from 'vitest'
import { haversineNm, slerp, greatCirclePoints } from '../src/astro/geo'

describe('geo', () => {
  const SDF: [number, number] = [38.17, -85.74]
  const ANC: [number, number] = [61.17, -149.99]

  it('haversineNm matches a known SDF->ANC distance (~2100-2500 nm)', () => {
    const d = haversineNm(SDF, ANC)
    expect(d).toBeGreaterThan(2100)
    expect(d).toBeLessThan(2800)
  })
  it('slerp endpoints return the endpoints', () => {
    expect(slerp(SDF, ANC, 0)[0]).toBeCloseTo(SDF[0], 4)
    expect(slerp(SDF, ANC, 1)[1]).toBeCloseTo(ANC[1], 4)
  })
  it('slerp midpoint lies between the endpoints latitudinally', () => {
    const m = slerp(SDF, ANC, 0.5)
    expect(m[0]).toBeGreaterThan(SDF[0])
    expect(m[0]).toBeLessThan(ANC[0])
  })
  it('greatCirclePoints returns n points starting/ending at the endpoints', () => {
    const pts = greatCirclePoints(SDF, ANC, 10)
    expect(pts.length).toBe(10)
    expect(pts[0][0]).toBeCloseTo(SDF[0], 4)
    expect(pts[9][1]).toBeCloseTo(ANC[1], 4)
  })
})
