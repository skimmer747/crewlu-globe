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
  take_off_time: string | null
  duty_period_id: string | null
  trip_id: string | null
  aircraft_type: string | null
  tail_number: string | null
  deleted_at: string | null
}

export interface AirportCoord { iata: string; lat: number; lng: number; city?: string; country?: string }

/** A resolved, drawable flight leg. */
export interface Leg {
  id: string
  from: string
  to: string
  s: LatLng         // departure [lat,lng]
  e: LatLng         // arrival [lat,lng]
  t: number         // epoch ms used for chronological ordering/replay (block-out / departure)
  takeoff: number   // epoch ms, scheduled takeoff — start of the airborne span
  landing: number   // epoch ms, scheduled landing — end of the airborne span (distance-estimated when data is missing/bad)
  dh: boolean       // true => deadhead (rode), false => flew (operated)
  miles: number
  aircraft: string | null
  tripId: string | null
}

export interface Stats { miles: number; airports: number; countries: number; hours: number }
