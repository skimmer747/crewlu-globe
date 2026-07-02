import { toRad } from './geo'
const rev = (x: number) => ((x % 360) + 360) % 360
const D2R = Math.PI / 180

/** Geographic point the Moon is directly over (sub-lunar point). Degrees. */
export function subLunarPoint(date: Date): { lat: number; lng: number } {
  const ms = date.getTime()
  const d = ms / 86400000 + 2440587.5 - 2451543.5 // Schlyter epoch
  const N = rev(125.1228 - 0.0529538083 * d)
  const i = 5.1454
  const w = rev(318.0634 + 0.1643573223 * d)
  const a = 60.2666, e = 0.0549
  const M = rev(115.3654 + 13.0649929509 * d)
  let E = M + (180 / Math.PI) * e * Math.sin(toRad(M)) * (1 + e * Math.cos(toRad(M)))
  for (let k = 0; k < 4; k++) E = E - (E - (180 / Math.PI) * e * Math.sin(toRad(E)) - M) / (1 - e * Math.cos(toRad(E)))
  const xv = a * (Math.cos(toRad(E)) - e)
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(toRad(E))
  const v = rev(Math.atan2(yv, xv) / D2R)
  const r = Math.sqrt(xv * xv + yv * yv)
  const xh = r * (Math.cos(toRad(N)) * Math.cos(toRad(v + w)) - Math.sin(toRad(N)) * Math.sin(toRad(v + w)) * Math.cos(toRad(i)))
  const yh = r * (Math.sin(toRad(N)) * Math.cos(toRad(v + w)) + Math.cos(toRad(N)) * Math.sin(toRad(v + w)) * Math.cos(toRad(i)))
  const zh = r * Math.sin(toRad(v + w)) * Math.sin(toRad(i))
  const lon = rev(Math.atan2(yh, xh) / D2R)
  const lat = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) / D2R
  const ecl = toRad(23.4393 - 3.563e-7 * d)
  const xe = Math.cos(toRad(lon)) * Math.cos(toRad(lat))
  const ye = Math.sin(toRad(lon)) * Math.cos(toRad(lat)) * Math.cos(ecl) - Math.sin(toRad(lat)) * Math.sin(ecl)
  const ze = Math.sin(toRad(lon)) * Math.cos(toRad(lat)) * Math.sin(ecl) + Math.sin(toRad(lat)) * Math.cos(ecl)
  const RA = rev(Math.atan2(ye, xe) / D2R)
  const Dec = Math.atan2(ze, Math.sqrt(xe * xe + ye * ye)) / D2R
  const n2 = ms / 86400000 + 2440587.5 - 2451545.0
  const gmst = rev(280.46061837 + 360.98564736629 * n2)
  const lng = ((RA - gmst + 540) % 360) - 180
  return { lat: Dec, lng }
}

export interface Phase { illum: number; waning: boolean; name: string; icon: string }

/** Illuminated fraction + label from the synodic cycle. */
export function moonPhase(date: Date): Phase {
  const ms = date.getTime()
  const syn = 29.530588853
  const knownNew = Date.UTC(2000, 0, 6, 18, 14)
  let p = (((ms - knownNew) / 86400000) / syn) % 1
  if (p < 0) p += 1
  const illum = (1 - Math.cos(2 * Math.PI * p)) / 2
  const waning = p > 0.5
  const name = illum < 0.04 ? 'NEW MOON'
    : illum > 0.96 ? 'FULL MOON'
    : (waning ? 'WANING ' : 'WAXING ') + (illum > 0.5 ? 'GIBBOUS' : 'CRESCENT')
  const icon = illum < 0.04 ? '🌑' : illum > 0.96 ? '🌕'
    : waning ? (illum > 0.5 ? '🌖' : '🌘') : (illum > 0.5 ? '🌔' : '🌒')
  return { illum, waning, name, icon }
}

export interface Terminator { b: number; darkOnRight: boolean }

/** Terminator ellipse for a unit-radius disc. `b = 1 − 2·illum` is the signed
 *  semi-minor axis: > 0 bulges toward the LIT side, extending the dark region
 *  past center (crescent); < 0 bulges toward the dark side, shrinking the dark
 *  region to a sliver (gibbous). Dark area fraction = ½ + b/2 = 1 − illum.
 *  darkOnRight keeps the old sliding-shadow convention: waning ⇒ dark limb right. */
export function terminator(illum: number, waning: boolean): Terminator {
  const f = Math.min(1, Math.max(0, illum))
  return { b: 1 - 2 * f, darkOnRight: waning }
}
