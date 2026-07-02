export type LatLng = [number, number] // [lat, lng] in degrees

export const toRad = (d: number) => (d * Math.PI) / 180
export const toDeg = (r: number) => (r * 180) / Math.PI

/** Great-circle distance in nautical miles. */
export function haversineNm(a: LatLng, b: LatLng): number {
  const R = 3440.065 // earth radius in nm
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))))
}

/** Spherical-linear interpolation along the great circle from a to b at fraction f. */
export function slerp(a: LatLng, b: LatLng, f: number): LatLng {
  const la1 = toRad(a[0]), lo1 = toRad(a[1]), la2 = toRad(b[0]), lo2 = toRad(b[1])
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(
    Math.sin((la2 - la1) / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2)))
  if (d < 1e-9) return [a[0], a[1]]
  const A = Math.sin((1 - f) * d) / Math.sin(d)
  const B = Math.sin(f * d) / Math.sin(d)
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2)
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2)
  const z = A * Math.sin(la1) + B * Math.sin(la2)
  return [toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]
}

export function greatCirclePoints(a: LatLng, b: LatLng, n: number): LatLng[] {
  const out: LatLng[] = []
  for (let i = 0; i < n; i++) out.push(slerp(a, b, i / (n - 1)))
  return out
}

/** Great-circle angular separation between two points, in degrees (unrounded). */
export function angularDistanceDeg(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return toDeg(2 * Math.asin(Math.min(1, Math.sqrt(s))))
}
