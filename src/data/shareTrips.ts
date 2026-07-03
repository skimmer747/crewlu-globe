import type { Trip } from './trips'
import type { Leg } from '../model'

/** Last = most recent trip already started (fallback: final trip). Next = first upcoming. */
export function resolveShareTrips(trips: Trip[], now: number): { last: Trip | null; next: Trip | null } {
  if (!trips.length) return { last: null, next: null }
  let last: Trip | null = null
  let next: Trip | null = null
  for (const t of trips) {
    if (t.start <= now) last = t
    else if (!next) next = t
  }
  if (!last) last = trips[trips.length - 1]
  return { last, next }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jul 1 · SDF→ANC→HKG" — date of the first leg + the ordered airport chain. */
export function tripLabel(trip: Trip): string {
  const d = new Date(trip.start)
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  const route = tripRoute(trip)
  return `${date} · ${route}`
}

/** Ordered airport chain across the trip's legs, e.g. "SDF→ANC→HKG". */
export function tripRoute(trip: Trip): string {
  const stops: string[] = []
  for (const l of trip.legs) {
    if (!stops.length) stops.push(l.from)
    if (stops[stops.length - 1] !== l.to) stops.push(l.to)
  }
  return stops.join('→')
}

export const VIDEO_FLOOR_MS = 6000
export const VIDEO_CEIL_MS = 18000
const PER_LEG_TARGET_MS = 1000

/** Total on-screen flight time for `legCount` legs at SPEEDS[i]. */
export function tripFlightMs(legCount: number, speeds: number[], baseLegMs: number, i = pickTripSpeedIndex(legCount, speeds, baseLegMs)): number {
  return legCount * (baseLegMs / speeds[i])
}

/**
 * Choose the SPEEDS index whose total flight time is closest to a clamped target
 * (≈1s per leg, floored/ceiled so short trips linger and epic trips stay shareable).
 * Ties break toward the faster speed (shorter, snappier clip).
 */
export function pickTripSpeedIndex(legCount: number, speeds: number[], baseLegMs: number): number {
  const target = Math.min(VIDEO_CEIL_MS, Math.max(VIDEO_FLOOR_MS, legCount * PER_LEG_TARGET_MS))
  let best = 0, bestErr = Infinity
  for (let i = 0; i < speeds.length; i++) {
    const total = legCount * (baseLegMs / speeds[i])
    const err = Math.abs(total - target)
    if (err < bestErr - 1e-6) { bestErr = err; best = i }
  }
  const alt = best + 1
  if (alt < speeds.length && Math.abs(legCount * (baseLegMs / speeds[alt]) - target) === bestErr) best = alt
  return best
}

export interface TripCardStats { route: string; nm: number; legs: number; blockHours: number }

/** Card figures for one trip, over operated (non-deadhead) legs. */
export function tripCardStats(trip: Trip): TripCardStats {
  let nm = 0, blockMs = 0, legs = 0
  for (const l of trip.legs as Leg[]) {
    if (l.dh) continue
    nm += l.miles; blockMs += l.blockMs; legs++
  }
  return { route: tripRoute(trip), nm: Math.round(nm), legs, blockHours: Math.round((blockMs / 3.6e6) * 10) / 10 }
}
