import type { FlightRow, Leg, Stats } from '../model'
import type { AirportIndex } from './airports'
import { haversineNm } from '../astro/geo'

const legTime = (r: FlightRow): number => {
  const s = r.scheduled_block_out_time ?? r.scheduled_take_off_time ?? r.take_off_time
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : NaN
}

/**
 * Estimated airborne time for a leg, in milliseconds. The data only carries departure
 * times, so flight duration is approximated from great-circle distance at ~460 kt block
 * speed (floored at 20 min). Shared by the globe's in-air/on-ground readout (positionAt)
 * and the timeline's per-flight bars so both agree on when a leg is "in the air".
 */
export const estFlightMs = (miles: number): number => Math.max(20, (miles / 460) * 60) * 60000

/** Sanity cap on one leg's airborne time; a scheduled span longer than this is treated as bad data. */
const MAX_AIR_MS = 20 * 60 * 60 * 1000

export function flightsToLegs(rows: FlightRow[], airports: AirportIndex): { legs: Leg[]; dropped: number } {
  const legs: Leg[] = []
  let dropped = 0
  for (const r of rows) {
    if (r.deleted_at) continue
    const dep = r.departure ? airports.lookup(r.departure) : undefined
    const arr = r.arrival ? airports.lookup(r.arrival) : undefined
    if (!dep || !arr) { dropped++; continue }
    const t = legTime(r)
    if (!Number.isFinite(t)) { dropped++; continue }
    const s: [number, number] = [dep.lat, dep.lng]
    const e: [number, number] = [arr.lat, arr.lng]
    const miles = haversineNm(s, e)
    // Airborne span from the schedule: takeoff -> landing. Both are ~100% populated, but ~2% of
    // rows carry garbage (landing at/before takeoff, or absurdly long), so guard and fall back to
    // the distance estimate when the timestamps don't make sense.
    const toRaw = r.scheduled_take_off_time ? Date.parse(r.scheduled_take_off_time) : NaN
    const takeoff = Number.isFinite(toRaw) ? toRaw : t
    const lnRaw = r.scheduled_landing_time ? Date.parse(r.scheduled_landing_time) : NaN
    const landing = Number.isFinite(lnRaw) && lnRaw > takeoff && lnRaw - takeoff <= MAX_AIR_MS
      ? lnRaw
      : takeoff + estFlightMs(miles)
    legs.push({
      id: r.id, from: dep.iata, to: arr.iata, s, e,
      t, takeoff, landing,
      dh: Boolean(r.is_dh || r.is_commercial_deadhead),
      miles,
      aircraft: r.aircraft_type,
      tripId: r.trip_id,
    })
  }
  legs.sort((a, b) => a.t - b.t)
  return { legs, dropped }
}

export const legsUpTo = (legs: Leg[], cutoffMs: number): Leg[] => legs.filter((l) => l.t <= cutoffMs)

export interface AirportStats { landings: number; layoverMs: number }

// legs must already be sorted by t (flightsToLegs guarantees this).
// Layover = ground time between this landing and the next departure from the same airport.
export function computeAirportStats(legs: Leg[]): Map<string, AirportStats> {
  const stats = new Map<string, AirportStats>()
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const s = stats.get(leg.to) ?? { landings: 0, layoverMs: 0 }
    s.landings++
    if (i + 1 < legs.length && legs[i + 1].from === leg.to) {
      s.layoverMs += Math.max(0, legs[i + 1].t - leg.landing)
    }
    stats.set(leg.to, s)
  }
  return stats
}

export function statsFor(legs: Leg[], airports: AirportIndex): Stats {
  const codes = new Set<string>()
  const countries = new Set<string>()
  let miles = 0
  for (const l of legs) {
    codes.add(l.from); codes.add(l.to); miles += l.miles
    const c1 = airports.lookup(l.from)?.country, c2 = airports.lookup(l.to)?.country
    if (c1) countries.add(c1); if (c2) countries.add(c2)
  }
  const hours = Math.round(miles / 460) // v1 proxy: block-time columns inconsistently populated
  return { miles, airports: codes.size, countries: countries.size, hours }
}
