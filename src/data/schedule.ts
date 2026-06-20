import type { Leg } from '../model'
import type { LatLng } from '../astro/geo'
import type { Trip } from './trips'

export interface Window { start: number; end: number }

export function beaconHome(legs: Leg[], now: number): LatLng | null {
  if (!legs.length) return null
  let lastFlown: Leg | null = null
  for (const l of legs) { if (l.t <= now) lastFlown = l; else break }
  if (lastFlown) return [lastFlown.e[0], lastFlown.e[1]]
  const firstUpcoming = legs.find((l) => l.t > now)
  return firstUpcoming ? [firstUpcoming.s[0], firstUpcoming.s[1]] : null
}

export function focusTrip(trips: Trip[], now: number): Trip | null {
  if (!trips.length) return null
  const containing = trips.find((t) => now >= t.start && now <= t.end)
  if (containing) return containing
  const nextUpcoming = trips.find((t) => t.start > now)
  if (nextUpcoming) return nextUpcoming
  return trips[trips.length - 1]
}

export function defaultWindow(legs: Leg[], trips: Trip[], now: number): Window {
  if (!legs.length) return { start: now, end: now }
  const focus = focusTrip(trips, now)
  const lastLeg = legs[legs.length - 1]
  const start = focus ? Math.min(now, focus.start) : legs[0].t
  return { start, end: lastLeg.t }
}

export function legsInWindow(legs: Leg[], w: Window): Leg[] {
  return legs.filter((l) => l.t >= w.start && l.t <= w.end)
}

export function splitAtPlayhead(windowLegs: Leg[], playhead: number): { solid: Leg[]; ghost: Leg[] } {
  const solid: Leg[] = [], ghost: Leg[] = []
  for (const l of windowLegs) (l.t <= playhead ? solid : ghost).push(l)
  return { solid, ghost }
}
