import { describe, it, expect } from 'vitest'
import { buildAirportIndex } from '../src/data/airports'
import { flightsToLegs, legsUpTo, statsFor, computeAirportStats } from '../src/data/transform'
import type { FlightRow } from '../src/model'

const idx = buildAirportIndex([
  { iata: 'SDF', lat: 38.17, lng: -85.74, country: 'USA' },
  { iata: 'ANC', lat: 61.17, lng: -149.99, country: 'USA' },
  { iata: 'PVG', lat: 31.14, lng: 121.81, country: 'China' },
])
const row = (o: Partial<FlightRow>): FlightRow => ({
  id: 'x', departure: null, arrival: null, is_dh: null, is_commercial_deadhead: null,
  scheduled_block_out_time: null, scheduled_take_off_time: null, scheduled_landing_time: null,
  scheduled_block_in_time: null, scheduled_block_time: null,
  take_off_time: null, block_out_time: null, landing_time: null, block_in_time: null,
  duty_period_id: null, trip_id: null,
  aircraft_type: null, tail_number: null, deleted_at: null, ...o,
})

describe('flightsToLegs', () => {
  it('resolves coords, flags deadhead, sorts by date, drops unresolved', () => {
    const rows = [
      row({ id: 'b', departure: 'ANC', arrival: 'PVG', scheduled_block_out_time: '2024-02-12', is_dh: false }),
      row({ id: 'a', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-11', is_dh: false }),
      row({ id: 'd', departure: 'PVG', arrival: 'SDF', scheduled_block_out_time: '2024-03-02', is_commercial_deadhead: true }),
      row({ id: 'gone', departure: 'ZZZ', arrival: 'SDF', scheduled_block_out_time: '2024-02-15' }),
    ]
    const { legs, dropped } = flightsToLegs(rows, idx)
    expect(dropped).toBe(1)
    expect(legs.map(l => l.id)).toEqual(['a', 'b', 'd'])
    expect(legs[2].dh).toBe(true)
    expect(legs[0].dh).toBe(false)
    expect(legs[0].miles).toBeGreaterThan(0)
  })
  it('excludes tombstoned rows', () => {
    const { legs } = flightsToLegs([row({ id: 't', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-01-01', deleted_at: '2024-02-01' })], idx)
    expect(legs.length).toBe(0)
  })
  it('drops rows with no resolvable date', () => {
    const { legs, dropped } = flightsToLegs([
      row({ id: 'undated', departure: 'SDF', arrival: 'ANC' }), // no time columns at all
    ], idx)
    expect(legs.length).toBe(0)
    expect(dropped).toBe(1)
  })
  it('legsUpTo and statsFor', () => {
    const { legs } = flightsToLegs([
      row({ id: 'a', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-11' }),
      row({ id: 'b', departure: 'ANC', arrival: 'PVG', scheduled_block_out_time: '2024-02-12' }),
    ], idx)
    const upTo = legsUpTo(legs, Date.parse('2024-02-11T23:59:59Z'))
    expect(upTo.length).toBe(1)
    const stats = statsFor(legs, idx)
    expect(stats.airports).toBe(3)
    expect(stats.countries).toBe(2)
    expect(stats.miles).toBeGreaterThan(0)
  })
  it('carries trip_id onto the leg', () => {
    const { legs } = flightsToLegs([
      row({ id: 'a', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-11', trip_id: 'T1' }),
      row({ id: 'b', departure: 'ANC', arrival: 'PVG', scheduled_block_out_time: '2024-02-12', trip_id: null }),
    ], idx)
    expect(legs[0].tripId).toBe('T1')
    expect(legs[1].tripId).toBe(null)
  })
  it('takeoff/landing come from the schedule, with a distance-estimate fallback for bad data', () => {
    const { legs } = flightsToLegs([
      row({ id: 'real', departure: 'SDF', arrival: 'ANC',
        scheduled_block_out_time: '2024-02-11T10:00:00Z',
        scheduled_take_off_time: '2024-02-11T10:15:00Z',
        scheduled_landing_time: '2024-02-11T15:30:00Z' }),
      row({ id: 'bad', departure: 'SDF', arrival: 'ANC',
        scheduled_block_out_time: '2024-02-12T10:00:00Z',
        scheduled_take_off_time: '2024-02-12T10:15:00Z',
        scheduled_landing_time: '2024-02-12T09:00:00Z' }), // lands before it takes off
    ], idx)
    const real = legs.find(l => l.id === 'real')!
    expect(real.takeoff).toBe(Date.parse('2024-02-11T10:15:00Z'))
    expect(real.landing).toBe(Date.parse('2024-02-11T15:30:00Z'))
    const bad = legs.find(l => l.id === 'bad')!
    expect(bad.takeoff).toBe(Date.parse('2024-02-12T10:15:00Z'))
    expect(bad.landing).toBeGreaterThan(bad.takeoff) // fell back to the estimate
  })
  it('prefers actual OOOI over scheduled and carries sched/act pairs', () => {
    const { legs } = flightsToLegs([row({ id: 'x', departure: 'SDF', arrival: 'ANC',
      scheduled_block_out_time: '2024-02-11T10:00:00Z', scheduled_take_off_time: '2024-02-11T10:15:00Z',
      scheduled_landing_time: '2024-02-11T15:30:00Z', scheduled_block_in_time: '2024-02-11T15:40:00Z',
      block_out_time: '2024-02-11T10:45:00Z', take_off_time: '2024-02-11T11:02:00Z',
      landing_time: '2024-02-11T16:11:00Z', block_in_time: '2024-02-11T16:19:00Z' })], idx)
    const l = legs[0]
    expect(l.t).toBe(Date.parse('2024-02-11T10:45:00Z'))
    expect(l.takeoff).toBe(Date.parse('2024-02-11T11:02:00Z'))
    expect(l.landing).toBe(Date.parse('2024-02-11T16:11:00Z'))
    expect(l.in).toBe(Date.parse('2024-02-11T16:19:00Z'))
    expect(l.blockMs).toBe(Date.parse('2024-02-11T16:19:00Z') - Date.parse('2024-02-11T10:45:00Z'))
    expect(l.sched.off).toBe(Date.parse('2024-02-11T10:15:00Z'))
    expect(l.act.on).toBe(Date.parse('2024-02-11T16:11:00Z'))
  })
  it('garbage actual landing falls back to scheduled, then estimate', () => {
    const base = { departure: 'SDF', arrival: 'ANC', block_out_time: '2024-02-11T10:00:00Z', take_off_time: '2024-02-11T10:15:00Z' }
    const { legs } = flightsToLegs([
      row({ id: 'schedRescue', ...base, landing_time: '2024-02-11T09:00:00Z', scheduled_landing_time: '2024-02-11T15:30:00Z' }),
      row({ id: 'estimate', ...base, block_out_time: '2024-02-12T10:00:00Z', take_off_time: '2024-02-12T10:15:00Z', landing_time: '2024-02-12T09:00:00Z' }),
    ], idx)
    expect(legs.find(l => l.id === 'schedRescue')!.landing).toBe(Date.parse('2024-02-11T15:30:00Z'))
    const est = legs.find(l => l.id === 'estimate')!
    expect(est.landing).toBeGreaterThan(est.takeoff)
  })
  it('takeoff clamps to block-out; block-in clamps to landing', () => {
    const { legs } = flightsToLegs([row({ id: 'c', departure: 'SDF', arrival: 'ANC',
      block_out_time: '2024-02-11T11:00:00Z', scheduled_take_off_time: '2024-02-11T10:15:00Z',
      scheduled_landing_time: '2024-02-11T15:30:00Z', block_in_time: '2024-02-11T12:00:00Z' })], idx)
    expect(legs[0].takeoff).toBe(Date.parse('2024-02-11T11:00:00Z'))   // sched off < actual out -> clamped
    expect(legs[0].in).toBe(legs[0].landing)                            // block-in before landing -> rejected
  })
  it('stats: real block hours, FLEW/RODE split, on-time pct', () => {
    const { legs } = flightsToLegs([
      row({ id: 'f1', departure: 'SDF', arrival: 'ANC', block_out_time: '2024-02-11T10:00:00Z',
        take_off_time: '2024-02-11T10:15:00Z', landing_time: '2024-02-11T16:00:00Z',
        block_in_time: '2024-02-11T16:10:00Z', scheduled_block_in_time: '2024-02-11T16:00:00Z' }),
      row({ id: 'dh', departure: 'ANC', arrival: 'PVG', is_dh: true, block_out_time: '2024-02-12T10:00:00Z',
        take_off_time: '2024-02-12T10:15:00Z', landing_time: '2024-02-12T18:00:00Z',
        block_in_time: '2024-02-12T18:08:00Z', scheduled_block_in_time: '2024-02-12T17:30:00Z' }),
    ], idx)
    const s = statsFor(legs, idx)
    expect(s.hours).toBe(Math.round((Date.parse('2024-02-11T16:10:00Z') - Date.parse('2024-02-11T10:00:00Z')) / 3600000))
    expect(Math.round(s.flewMiles + s.rodeMiles)).toBe(Math.round(s.miles))
    expect(s.rodeMiles).toBeGreaterThan(0)
    expect(s.onTimePct).toBe(50)
  })
  it('on-time pct ignores garbage arrival pairs (delta beyond credibility)', () => {
    const { legs } = flightsToLegs([
      row({ id: 'ok', departure: 'SDF', arrival: 'ANC', block_out_time: '2024-02-11T10:00:00Z',
        take_off_time: '2024-02-11T10:15:00Z', landing_time: '2024-02-11T16:00:00Z',
        block_in_time: '2024-02-11T16:10:00Z', scheduled_block_in_time: '2024-02-11T16:05:00Z' }),
      row({ id: 'junk', departure: 'ANC', arrival: 'PVG', block_out_time: '2024-02-12T10:00:00Z',
        take_off_time: '2024-02-12T10:15:00Z', scheduled_landing_time: '2024-02-12T18:00:00Z',
        landing_time: '2024-02-12T03:00:00Z' }), // actual "landing" 15h before schedule: garbage
    ], idx)
    expect(statsFor(legs, idx).onTimePct).toBe(100) // junk pair excluded, not counted late/early
  })
  it('layover runs block-in to next block-out', () => {
    const { legs } = flightsToLegs([
      row({ id: 'a', departure: 'SDF', arrival: 'ANC', block_out_time: '2024-02-11T10:00:00Z',
        take_off_time: '2024-02-11T10:15:00Z', landing_time: '2024-02-11T16:00:00Z', block_in_time: '2024-02-11T16:10:00Z' }),
      row({ id: 'b', departure: 'ANC', arrival: 'PVG', block_out_time: '2024-02-12T10:00:00Z', take_off_time: '2024-02-12T10:15:00Z' }),
    ], idx)
    const st = computeAirportStats(legs)
    expect(st.get('ANC')!.layoverMs).toBe(Date.parse('2024-02-12T10:00:00Z') - Date.parse('2024-02-11T16:10:00Z'))
  })
  it('blockMs hierarchy: sched pair, then scheduled_block_time seconds, then airborne', () => {
    const { legs } = flightsToLegs([
      row({ id: 'sp', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-11T10:00:00Z',
        scheduled_take_off_time: '2024-02-11T10:15:00Z', scheduled_landing_time: '2024-02-11T15:30:00Z',
        scheduled_block_in_time: '2024-02-11T15:42:00Z' }),
      row({ id: 'col', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-12T10:00:00Z',
        scheduled_take_off_time: '2024-02-12T10:15:00Z', scheduled_landing_time: '2024-02-12T15:30:00Z',
        scheduled_block_time: 20520 }),
      row({ id: 'air', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-13T10:00:00Z',
        scheduled_take_off_time: '2024-02-13T10:15:00Z', scheduled_landing_time: '2024-02-13T15:30:00Z' }),
    ], idx)
    expect(legs.find(l => l.id === 'sp')!.blockMs).toBe(Date.parse('2024-02-11T15:42:00Z') - Date.parse('2024-02-11T10:00:00Z'))
    expect(legs.find(l => l.id === 'col')!.blockMs).toBe(20520 * 1000)
    const air = legs.find(l => l.id === 'air')!
    expect(air.blockMs).toBe(air.landing - air.takeoff)
  })
})
