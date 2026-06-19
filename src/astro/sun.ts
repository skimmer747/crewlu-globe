import { toRad } from './geo'

const rev = (x: number) => ((x % 360) + 360) % 360

/** Geographic point where the sun is at the zenith. Returns degrees. */
export function subsolarPoint(date: Date): { lng: number; lat: number } {
  const ms = date.getTime()
  const n = ms / 86400000 + 2440587.5 - 2451545.0 // days since J2000
  const Lm = rev(280.46 + 0.9856474 * n)
  const g = rev(357.528 + 0.9856003 * n)
  const lam = Lm + 1.915 * Math.sin(toRad(g)) + 0.02 * Math.sin(toRad(2 * g))
  const eps = 23.439 - 0.0000004 * n
  const lat = Math.asin(Math.sin(toRad(eps)) * Math.sin(toRad(lam))) * 180 / Math.PI
  const gmst = rev(280.46061837 + 360.98564736629 * n)
  const ra = Math.atan2(Math.cos(toRad(eps)) * Math.sin(toRad(lam)), Math.cos(toRad(lam))) * 180 / Math.PI
  const lng = ((ra - gmst + 540) % 360) - 180
  return { lng, lat }
}
