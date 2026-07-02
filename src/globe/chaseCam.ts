import { slerp, type LatLng } from '../astro/geo'

// Chase-cam math, extracted pure for testability.
//
// Why this exists: the legacy playback camera (a fly-to-arrival tween) already tracks the
// route between consecutive legs at altForLeg height, so a chase cam flying a similar
// altitude is visually indistinguishable from it. The chase differentiates by flying LOW —
// hugging the surface at cruise so the ground rushes past — and by trailing the dart.

export interface ChasePov { lat: number; lng: number; altitude: number }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Idle/legacy camera altitude for a leg length (single source of truth; main.ts imports this). */
export const altForLeg = (miles: number) => Math.min(2.6, Math.max(0.6, 0.6 + miles * 0.00033))

const ENTRY_ALT = 1.0     // wide establishing view at the runways
const LAG = 0.1           // camera trails the dart by this fraction of the leg
export const CHASE_FLOOR = 0.18 // low enough that the surface visibly streams past

/** Low-and-behind chase view for playback progress p (0..1) along a leg. */
export function chasePov(s: LatLng, e: LatLng, miles: number, p: number): ChasePov {
  p = clamp01(p)
  const [lat, lng] = slerp(s, e, clamp01(p - LAG))
  const cruise = Math.max(CHASE_FLOOR, altForLeg(miles) * 0.3)
  const altitude = cruise + (ENTRY_ALT - cruise) * (1 - Math.sin(Math.PI * p))
  return { lat, lng, altitude }
}
