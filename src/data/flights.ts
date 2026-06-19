import type { SupabaseClient } from '@supabase/supabase-js'
import type { FlightRow } from '../model'

const COLS =
  'id,departure,arrival,is_dh,is_commercial_deadhead,flight_date,scheduled_block_out_time,duty_period_id,trip_id,aircraft_type,tail_number,deleted_at'

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
