import type { SupabaseClient } from '@supabase/supabase-js'
import type { FlightRow } from '../model'

const COLS =
  'id,departure,arrival,is_dh,is_commercial_deadhead,scheduled_block_out_time,scheduled_take_off_time,scheduled_landing_time,scheduled_block_in_time,scheduled_block_time,take_off_time,block_out_time,landing_time,block_in_time,duty_period_id,trip_id,aircraft_type,tail_number,deleted_at'

export async function fetchFlights(client: SupabaseClient): Promise<FlightRow[]> {
  const all: FlightRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('flights')
      .select(COLS)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as FlightRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

/** Base code normalized to its first 3 chars, uppercased ('SDFZ' -> 'SDF'); null for empty/absent. */
export function normalizeBase(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toUpperCase()
  return s ? s.slice(0, 3) : null
}

/** tripId -> base-at-the-time, for the MOST LANDINGS exclusion. Paginated like fetchFlights. */
export async function fetchTripBases(client: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('trips')
      .select('id,base')
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as { id: string; base: string | null }[]
    for (const r of rows) { const b = normalizeBase(r.base); if (b) map.set(r.id, b) }
    if (rows.length < PAGE) break
  }
  return map
}
