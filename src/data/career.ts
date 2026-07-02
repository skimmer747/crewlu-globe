import type { Leg } from '../model'

// Career math for the Wrapped features: records, milestones, fleet breakdown.
// Everything here counts OPERATED legs only (deadheads are rides, not logbook lines).

/** One trip around the equator: 360° × 60 nm/degree. */
export const EARTH_LAP_NM = 21600

export interface CareerRecords {
  longest: Leg | null
  shortest: Leg | null
  topPair: { a: string; b: string; count: number; legIds: string[] } | null // undirected city pair
  topAirport: { iata: string; landings: number } | null
  distinctTails: number
}

export function recordsFor(legs: Leg[]): CareerRecords {
  const flown = legs.filter((l) => !l.dh)
  if (!flown.length) return { longest: null, shortest: null, topPair: null, topAirport: null, distinctTails: 0 }
  let longest: Leg | null = null, shortest: Leg | null = null
  const pairs = new Map<string, { a: string; b: string; count: number; legIds: string[] }>()
  const landings = new Map<string, number>()
  const tails = new Set<string>()
  for (const l of flown) {
    if (l.from !== l.to) { // same-airport legs have no meaningful great-circle distance
      if (!longest || l.miles > longest.miles) longest = l
      if (!shortest || l.miles < shortest.miles) shortest = l
    }
    const [a, b] = [l.from, l.to].sort()
    const key = `${a}-${b}`
    const p = pairs.get(key) ?? { a, b, count: 0, legIds: [] }
    p.count++; p.legIds.push(l.id)
    pairs.set(key, p)
    // "base at the time": landing at the trip's own base doesn't count toward MOST LANDINGS
    if (l.base == null || l.to !== l.base) landings.set(l.to, (landings.get(l.to) ?? 0) + 1)
    if (l.tail) tails.add(l.tail.trim().toUpperCase())
  }
  let topPair = null as CareerRecords['topPair']
  for (const p of pairs.values()) if (!topPair || p.count > topPair.count) topPair = p
  let topAirport = null as CareerRecords['topAirport']
  for (const [iata, n] of landings) if (!topAirport || n > topAirport.landings) topAirport = { iata, landings: n }
  return { longest, shortest, topPair, topAirport, distinctTails: tails.size }
}

export interface Milestone { t: number; label: string; kind: 'legs' | 'miles' | 'hours' | 'lap' }

const LEG_MARKS = [100, 250, 500, 1000, 2500, 5000, 10000]
const HOUR_MARKS = [1000, 2500, 5000, 10000, 15000, 20000, 25000]
const MILES_STEP = 250000

const ordinal = (n: number) => {
  const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100
  return `${n.toLocaleString()}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** Threshold crossings over the (sorted) operated legs, stamped at the crossing leg's landing. */
export function milestonesFor(legs: Leg[]): Milestone[] {
  const out: Milestone[] = []
  let count = 0, miles = 0, blockMs = 0
  let nextMiles = MILES_STEP, nextLap = EARTH_LAP_NM
  let legIdx = 0, hourIdx = 0
  for (const l of legs) {
    if (l.dh) continue
    count++; miles += l.miles; blockMs += l.blockMs
    if (legIdx < LEG_MARKS.length && count >= LEG_MARKS[legIdx]) {
      out.push({ t: l.landing, label: `${ordinal(LEG_MARKS[legIdx])} LEG`, kind: 'legs' })
      legIdx++
    }
    while (miles >= nextMiles) {
      out.push({ t: l.landing, label: `${(nextMiles / 1000).toLocaleString()}K NAUTICAL MILES`, kind: 'miles' })
      nextMiles += MILES_STEP
    }
    while (miles >= nextLap) {
      out.push({ t: l.landing, label: `EARTH LAP ${Math.round(nextLap / EARTH_LAP_NM)}`, kind: 'lap' })
      nextLap += EARTH_LAP_NM
    }
    const hours = blockMs / 3600000
    if (hourIdx < HOUR_MARKS.length && hours >= HOUR_MARKS[hourIdx]) {
      out.push({ t: l.landing, label: `${HOUR_MARKS[hourIdx].toLocaleString()} BLOCK HOURS`, kind: 'hours' })
      hourIdx++
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface FleetStat { type: string; legs: number; miles: number; blockMs: number }

/** Per-aircraft-type totals over operated legs, ranked by leg count. */
export function fleetStats(legs: Leg[]): FleetStat[] {
  const map = new Map<string, FleetStat>()
  for (const l of legs) {
    if (l.dh) continue
    const type = (l.aircraft ?? '').trim().toUpperCase() || 'UNK'
    const f = map.get(type) ?? { type, legs: 0, miles: 0, blockMs: 0 }
    f.legs++; f.miles += l.miles; f.blockMs += l.blockMs
    map.set(type, f)
  }
  return [...map.values()].sort((a, b) => b.legs - a.legs || b.miles - a.miles)
}
