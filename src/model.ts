import type { LatLng } from './astro/geo'

/** Row shape from the Supabase `flights` table (only fields the globe needs). */
export interface FlightRow {
  id: string
  departure: string | null
  arrival: string | null
  is_dh: boolean | null
  is_commercial_deadhead: boolean | null
  scheduled_block_out_time: string | null
  scheduled_take_off_time: string | null
  scheduled_landing_time: string | null
  scheduled_block_in_time: string | null
  scheduled_block_time: number | null  // SECONDS (Swift TimeInterval on the writer side)
  take_off_time: string | null
  block_out_time: string | null
  landing_time: string | null
  block_in_time: string | null
  duty_period_id: string | null
  trip_id: string | null
  aircraft_type: string | null
  tail_number: string | null
  deleted_at: string | null
}

export interface AirportCoord { iata: string; lat: number; lng: number; city?: string; country?: string }

/** One side's OOOI set (out/off/on/in), parsed to epoch ms; null where the column was absent/garbage. */
export interface OoiTimes { out: number | null; off: number | null; on: number | null; in: number | null }

/** A resolved, drawable flight leg. Times are actual-first with scheduled fallback (see transform.ts). */
export interface Leg {
  id: string
  from: string
  to: string
  s: LatLng         // departure [lat,lng]
  e: LatLng         // arrival [lat,lng]
  t: number         // epoch ms used for chronological ordering/replay — block-out, actual-first
  takeoff: number   // epoch ms — start of the airborne span, actual-first, clamped >= t
  landing: number   // epoch ms — end of the airborne span (sanity-guarded; distance-estimated as last resort)
  out: number       // block-out (== t)
  in: number        // block-in (falls back to landing when absent/garbage)
  blockMs: number   // sane block time for stats (see resolution hierarchy in transform.ts)
  sched: OoiTimes   // raw scheduled pairs, for delta display
  act: OoiTimes     // raw actual pairs, for delta display
  dh: boolean       // true => deadhead (rode), false => flew (operated)
  miles: number
  aircraft: string | null
  tail: string | null
  tripId: string | null
}

export interface Stats { miles: number; airports: number; countries: number; hours: number; flewMiles: number; rodeMiles: number; onTimePct: number | null }
