import { describe, it, expect } from 'vitest'
import { buildAirportIndex } from '../src/data/airports'
import { flightsToLegs, legsUpTo, statsFor } from '../src/data/transform'
import type { FlightRow } from '../src/model'

const idx = buildAirportIndex([
  { iata: 'SDF', lat: 38.17, lng: -85.74, country: 'USA' },
  { iata: 'ANC', lat: 61.17, lng: -149.99, country: 'USA' },
  { iata: 'PVG', lat: 31.14, lng: 121.81, country: 'China' },
])
const row = (o: Partial<FlightRow>): FlightRow => ({
  id: 'x', departure: null, arrival: null, is_dh: null, is_commercial_deadhead: null,
  flight_date: null, scheduled_block_out_time: null, duty_period_id: null, trip_id: null,
  aircraft_type: null, tail_number: null, deleted_at: null, ...o,
})

describe('flightsToLegs', () => {
  it('resolves coords, flags deadhead, sorts by date, drops unresolved', () => {
    const rows = [
      row({ id: 'b', departure: 'ANC', arrival: 'PVG', flight_date: '2024-02-12', is_dh: false }),
      row({ id: 'a', departure: 'SDF', arrival: 'ANC', flight_date: '2024-02-11', is_dh: false }),
      row({ id: 'd', departure: 'PVG', arrival: 'SDF', flight_date: '2024-03-02', is_commercial_deadhead: true }),
      row({ id: 'gone', departure: 'ZZZ', arrival: 'SDF', flight_date: '2024-02-15' }),
    ]
    const { legs, dropped } = flightsToLegs(rows, idx)
    expect(dropped).toBe(1)
    expect(legs.map(l => l.id)).toEqual(['a', 'b', 'd'])
    expect(legs[2].dh).toBe(true)
    expect(legs[0].dh).toBe(false)
    expect(legs[0].miles).toBeGreaterThan(0)
  })
  it('excludes tombstoned rows', () => {
    const { legs } = flightsToLegs([row({ id: 't', departure: 'SDF', arrival: 'ANC', flight_date: '2024-01-01', deleted_at: '2024-02-01' })], idx)
    expect(legs.length).toBe(0)
  })
  it('legsUpTo and statsFor', () => {
    const { legs } = flightsToLegs([
      row({ id: 'a', departure: 'SDF', arrival: 'ANC', flight_date: '2024-02-11' }),
      row({ id: 'b', departure: 'ANC', arrival: 'PVG', flight_date: '2024-02-12' }),
    ], idx)
    const upTo = legsUpTo(legs, Date.parse('2024-02-11T23:59:59Z'))
    expect(upTo.length).toBe(1)
    const stats = statsFor(legs, idx)
    expect(stats.airports).toBe(3)
    expect(stats.countries).toBe(2)
    expect(stats.miles).toBeGreaterThan(0)
  })
})
