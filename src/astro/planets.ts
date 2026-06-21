import { toRad, toDeg } from './geo'

// Low-precision planetary positions using JPL/Standish mean Keplerian elements
// (valid ~1800–2050, accurate to a fraction of a degree — plenty for a naked-eye sky).
// Method: mean elements at date -> solve Kepler -> heliocentric ecliptic -> geocentric
// (subtract Earth) -> equatorial RA/Dec -> sub-point (lat/lng where the body is overhead).

export type PlanetId = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune'
export const PLANET_IDS: PlanetId[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']

export interface SkyPoint { lat: number; lng: number }

interface Elem {
  a: number; e: number; I: number; L: number; w: number; O: number          // values at J2000 (w = ϖ longitude of perihelion, O = Ω node)
  da: number; de: number; dI: number; dL: number; dw: number; dO: number     // rates per century
  b?: number; c?: number; s?: number; f?: number                            // extra mean-anomaly terms (Jupiter..Neptune)
}

const EL: Record<string, Elem> = {
  mercury: { a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.25032350, w: 77.45779628, O: 48.33076593, da: 0.00000037, de: 0.00001906, dI: -0.00594749, dL: 149472.67411175, dw: 0.16047689, dO: -0.12534081 },
  venus: { a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.97909950, w: 131.60246718, O: 76.67984255, da: 0.00000390, de: -0.00004107, dI: -0.00078890, dL: 58517.81538729, dw: 0.00268329, dO: -0.27769418 },
  earth: { a: 1.00000261, e: 0.01671123, I: -0.00001531, L: 100.46457166, w: 102.93768193, O: 0.0, da: 0.00000562, de: -0.00004392, dI: -0.01294668, dL: 35999.37244981, dw: 0.32327364, dO: 0.0 },
  mars: { a: 1.52371034, e: 0.09339410, I: 1.84969142, L: -4.55343205, w: -23.94362959, O: 49.55953891, da: 0.00001847, de: 0.00007882, dI: -0.00813131, dL: 19140.30268499, dw: 0.44441088, dO: -0.29257343 },
  jupiter: { a: 5.20288700, e: 0.04838624, I: 1.30439695, L: 34.39644051, w: 14.72847983, O: 100.47390909, da: -0.00011607, de: -0.00013253, dI: -0.00183714, dL: 3034.74612775, dw: 0.21252668, dO: 0.20469106, b: -0.00012452, c: 0.06064060, s: -0.35635438, f: 38.35125000 },
  saturn: { a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, w: 92.59887831, O: 113.66242448, da: -0.00125060, de: -0.00050991, dI: 0.00193609, dL: 1222.49362201, dw: -0.41897216, dO: -0.28867794, b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125000 },
  uranus: { a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, w: 170.95427630, O: 74.01692503, da: -0.00196176, de: -0.00004397, dI: -0.00242939, dL: 428.48202785, dw: 0.40805281, dO: 0.04240589, b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025000 },
  neptune: { a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, w: 44.96476227, O: 131.78422574, da: 0.00026291, de: 0.00005105, dI: 0.00035372, dL: 218.45945325, dw: -0.32241464, dO: -0.00508664, b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025000 },
}

const norm180 = (deg: number) => (((deg % 360) + 540) % 360) - 180

function centuriesSinceJ2000(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5
  return (jd - 2451545.0) / 36525
}

/** Heliocentric ecliptic position (AU) of a body from its mean elements at time T (centuries since J2000). */
function helioEcliptic(el: Elem, T: number): [number, number, number] {
  const a = el.a + el.da * T
  const e = el.e + el.de * T
  const I = el.I + el.dI * T
  const L = el.L + el.dL * T
  const w = el.w + el.dw * T
  const O = el.O + el.dO * T
  let M = L - w
  if (el.b !== undefined) M += el.b * T * T + (el.c ?? 0) * Math.cos(toRad((el.f ?? 0) * T)) + (el.s ?? 0) * Math.sin(toRad((el.f ?? 0) * T))
  M = norm180(M)

  // Kepler (Standish iteration, degrees)
  const eStar = (180 / Math.PI) * e
  let E = M + eStar * Math.sin(toRad(M))
  for (let i = 0; i < 10; i++) {
    const dM = M - (E - eStar * Math.sin(toRad(E)))
    const dE = dM / (1 - e * Math.cos(toRad(E)))
    E += dE
    if (Math.abs(dE) < 1e-9) break
  }

  const xp = a * (Math.cos(toRad(E)) - e)
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(toRad(E))

  const wr = toRad(w - O), Or = toRad(O), Ir = toRad(I)
  const cw = Math.cos(wr), sw = Math.sin(wr), cO = Math.cos(Or), sO = Math.sin(Or), cI = Math.cos(Ir), sI = Math.sin(Ir)
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp
  const z = (sw * sI) * xp + (cw * sI) * yp
  return [x, y, z]
}

/** Geocentric ecliptic vector -> sub-point (lat/lng where the body is at the zenith). */
function subpointFromGeoEcliptic(xg: number, yg: number, zg: number, date: Date): SkyPoint {
  const eps = toRad(23.43928)
  const xeq = xg
  const yeq = yg * Math.cos(eps) - zg * Math.sin(eps)
  const zeq = yg * Math.sin(eps) + zg * Math.cos(eps)
  const ra = toDeg(Math.atan2(yeq, xeq))
  const dec = toDeg(Math.atan2(zeq, Math.hypot(xeq, yeq)))
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0
  const gmst = (((280.46061837 + 360.98564736629 * n) % 360) + 360) % 360
  return { lat: dec, lng: norm180(ra - gmst) }
}

/** Sub-point of a planet for the given date. */
export function planetSubpoint(id: PlanetId, date: Date): SkyPoint {
  const T = centuriesSinceJ2000(date)
  const p = helioEcliptic(EL[id], T)
  const earth = helioEcliptic(EL.earth, T)
  return subpointFromGeoEcliptic(p[0] - earth[0], p[1] - earth[1], p[2] - earth[2], date)
}

/** The Sun's sub-point via the same pipeline (geocentric Sun = −Earth heliocentric). Used to cross-check the pipeline. */
export function sunSubpointViaEphemeris(date: Date): SkyPoint {
  const T = centuriesSinceJ2000(date)
  const earth = helioEcliptic(EL.earth, T)
  return subpointFromGeoEcliptic(-earth[0], -earth[1], -earth[2], date)
}
