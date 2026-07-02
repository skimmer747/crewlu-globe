import type { FlightRow, Leg, Stats } from '../model'
import type { AirportIndex } from './airports'
import { haversineNm } from '../astro/geo'

/** Parse a timestamptz column to epoch ms, or null when absent/garbage. */
const ts = (s: string | null | undefined): number | null => {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/**
 * Last-resort airborne time estimate, in milliseconds: great-circle distance at ~460 kt
 * (floored at 20 min). Only used when both actual and scheduled landing are absent/garbage.
 */
export const estFlightMs = (miles: number): number => Math.max(20, (miles / 460) * 60) * 60000

/** Sanity cap on one leg's airborne time; a span longer than this is treated as bad data. */
const MAX_AIR_MS = 20 * 60 * 60 * 1000
/** Sanity cap on one leg's block time (out -> in). */
const MAX_BLOCK_MS = 26 * 60 * 60 * 1000
/** Longest believable taxi-in; a block-in further past landing than this is garbage. */
const MAX_TAXI_IN_MS = 3 * 60 * 60 * 1000
/** A sched-vs-actual delta beyond this is bad data, not a record-setting delay. */
export const MAX_CRED_DELTA_MS = 6 * 60 * 60 * 1000

export function flightsToLegs(rows: FlightRow[], airports: AirportIndex): { legs: Leg[]; dropped: number } {
  const legs: Leg[] = []
  let dropped = 0
  for (const r of rows) {
    if (r.deleted_at) continue
    const dep = r.departure ? airports.lookup(r.departure) : undefined
    const arr = r.arrival ? airports.lookup(r.arrival) : undefined
    if (!dep || !arr) { dropped++; continue }
    const s: [number, number] = [dep.lat, dep.lng]
    const e: [number, number] = [arr.lat, arr.lng]
    const miles = haversineNm(s, e)
    // Actual-first OOOI resolution. Actuals are ~100% populated but ~2% of rows carry
    // garbage (landing at/before takeoff, block-in hours after landing, absurd spans),
    // so each field falls through: actual -> scheduled -> derived, behind sanity guards.
    const act = { out: ts(r.block_out_time), off: ts(r.take_off_time), on: ts(r.landing_time), in: ts(r.block_in_time) }
    const sched = { out: ts(r.scheduled_block_out_time), off: ts(r.scheduled_take_off_time), on: ts(r.scheduled_landing_time), in: ts(r.scheduled_block_in_time) }
    const t = act.out ?? sched.out ?? act.off ?? sched.off
    if (t == null) { dropped++; continue }
    const takeoff = Math.max(t, act.off ?? sched.off ?? t) // can't take off before block-out
    const landing = [act.on, sched.on].find((c): c is number => c != null && c > takeoff && c - takeoff <= MAX_AIR_MS)
      ?? takeoff + estFlightMs(miles)
    const inMs = [act.in, sched.in].find((c): c is number => c != null && c >= landing && c - landing <= MAX_TAXI_IN_MS)
      ?? landing
    const sane = (x: number | null): x is number => x != null && x > 0 && x <= MAX_BLOCK_MS
    const actBlock = act.in != null && act.out != null ? act.in - act.out : null
    const schedBlock = sched.in != null && sched.out != null ? sched.in - sched.out : null
    const colBlock = r.scheduled_block_time != null && Number.isFinite(r.scheduled_block_time) ? r.scheduled_block_time * 1000 : null
    const blockMs = sane(actBlock) ? actBlock : sane(schedBlock) ? schedBlock : sane(colBlock) ? colBlock : landing - takeoff
    legs.push({
      id: r.id, from: dep.iata, to: arr.iata, s, e,
      t, takeoff, landing, out: t, in: inMs, blockMs, sched, act,
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
      s.layoverMs += Math.max(0, legs[i + 1].t - leg.in) // block-in -> next block-out
    }
    stats.set(leg.to, s)
  }
  return stats
}

export function statsFor(legs: Leg[], airports: AirportIndex): Stats {
  const codes = new Set<string>()
  const countries = new Set<string>()
  let miles = 0, flewMiles = 0, rodeMiles = 0, flewBlockMs = 0, onTime = 0, comparable = 0
  for (const l of legs) {
    codes.add(l.from); codes.add(l.to); miles += l.miles
    const c1 = airports.lookup(l.from)?.country, c2 = airports.lookup(l.to)?.country
    if (c1) countries.add(c1); if (c2) countries.add(c2)
    if (l.dh) rodeMiles += l.miles
    else { flewMiles += l.miles; flewBlockMs += l.blockMs }
    // On-time = actual arrival within 14 min of scheduled (A14). Prefer the block-in pair,
    // fall back to the landing pair; legs missing either side don't count against the pilot,
    // and a delta beyond credibility (±6h) is garbage data, not a record delay.
    const pair = l.act.in != null && l.sched.in != null ? [l.act.in, l.sched.in]
      : l.act.on != null && l.sched.on != null ? [l.act.on, l.sched.on] : null
    if (pair && Math.abs(pair[0] - pair[1]) <= MAX_CRED_DELTA_MS) {
      comparable++
      if (pair[0] <= pair[1] + 14 * 60000) onTime++
    }
  }
  const hours = Math.round(flewBlockMs / 3600000) // real block time, operated legs only
  const onTimePct = comparable ? Math.round((onTime / comparable) * 100) : null
  return { miles, airports: codes.size, countries: countries.size, hours, flewMiles, rodeMiles, onTimePct }
}
