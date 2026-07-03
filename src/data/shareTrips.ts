import type { Trip } from './trips'

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
