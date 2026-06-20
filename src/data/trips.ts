import type { Leg } from '../model'

export interface Trip {
  id: string
  legs: Leg[]
  start: number
  end: number
  dest: string
}

export function groupIntoTrips(legs: Leg[]): Trip[] {
  const groups = new Map<string, Leg[]>()
  let standalone = 0
  for (const l of legs) {
    const key = l.tripId ?? `__solo_${standalone++}`
    const arr = groups.get(key)
    if (arr) arr.push(l)
    else groups.set(key, [l])
  }
  const trips: Trip[] = []
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => a.t - b.t)
    const last = sorted[sorted.length - 1]
    trips.push({
      id: key,
      legs: sorted,
      start: sorted[0].t,
      end: last.t,
      dest: last.to,
    })
  }
  trips.sort((a, b) => a.start - b.start)
  return trips
}
