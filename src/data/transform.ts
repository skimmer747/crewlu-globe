import type { FlightRow, Leg, Stats } from '../model'
import type { AirportIndex } from './airports'
import { haversineNm } from '../astro/geo'

const legTime = (r: FlightRow): number => {
  const s = r.scheduled_block_out_time ?? r.flight_date
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : 0
}

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
    legs.push({
      id: r.id, from: dep.iata, to: arr.iata, s, e,
      t: legTime(r),
      dh: Boolean(r.is_dh || r.is_commercial_deadhead),
      miles: haversineNm(s, e),
      aircraft: r.aircraft_type,
    })
  }
  legs.sort((a, b) => a.t - b.t)
  return { legs, dropped }
}

export const legsUpTo = (legs: Leg[], cutoffMs: number): Leg[] => legs.filter((l) => l.t <= cutoffMs)

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
