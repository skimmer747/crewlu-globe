import type { FlightRow } from '../model'

// Jumpseat Mode: a plausible UPS 74Y line generated at load time, anchored to `now` so the
// beacon, ghosts, and "today" always look alive. Deterministic — no randomness, just a
// repeating two-week pattern of SDF hub turns and an Anchorage–Asia–Europe world tour,
// with commercial deadheads and realistic OFF/ON delays. Everything flows through the
// real pipeline (flightsToLegs etc.); nothing downstream knows it's synthetic.

const MIN = 60000
const H = 60 * MIN
const D = 24 * H

/** Rough block minutes per demo city pair. */
const BLOCK: Record<string, number> = {
  'SDF-ORD': 55, 'ORD-SDF': 50,
  'SDF-MIA': 140, 'MIA-SDF': 145,
  'SDF-DFW': 115, 'DFW-SDF': 110,
  'SDF-SEA': 265, 'SEA-SDF': 240,
  'SEA-ANC': 215, 'ANC-SEA': 200,
  'ANC-HKG': 630, 'HKG-ANC': 560,
  'HKG-CGN': 750, 'CGN-HKG': 690,
  'CGN-SDF': 560, 'SDF-CGN': 510,
}

interface TplLeg { from: string; to: string; dh?: boolean; startHourZ: number; dayOffset: number }
interface TplTrip { name: string; legs: TplLeg[] }

// Two-week rotation: a 3-day SDF turns trip, then the world tour.
const TURNS: TplTrip = {
  name: 'turns',
  legs: [
    { from: 'SDF', to: 'ORD', startHourZ: 8, dayOffset: 0 },
    { from: 'ORD', to: 'SDF', startHourZ: 12, dayOffset: 0 },
    { from: 'SDF', to: 'MIA', startHourZ: 7, dayOffset: 1 },
    { from: 'MIA', to: 'SDF', startHourZ: 13, dayOffset: 1 },
    { from: 'SDF', to: 'DFW', startHourZ: 9, dayOffset: 2 },
    { from: 'DFW', to: 'SDF', startHourZ: 14, dayOffset: 2 },
  ],
}
const WORLD: TplTrip = {
  name: 'world',
  legs: [
    { from: 'SDF', to: 'SEA', dh: true, startHourZ: 15, dayOffset: 0 }, // commercial dh to pick up the trip
    { from: 'SEA', to: 'ANC', startHourZ: 4, dayOffset: 1 },
    { from: 'ANC', to: 'HKG', startHourZ: 11, dayOffset: 1 },
    { from: 'HKG', to: 'CGN', startHourZ: 16, dayOffset: 3 },
    { from: 'CGN', to: 'SDF', startHourZ: 10, dayOffset: 5 },
  ],
}

const iso = (ms: number) => new Date(ms).toISOString()

export function demoFlights(now: number = Date.now()): FlightRow[] {
  const rows: FlightRow[] = []
  const anchor = Math.floor(now / D) * D // midnight-align so times are stable within a day
  let id = 0
  // 5 cycles behind + 1 ahead: weeks -10..+2 -> ~66 legs, one future ghost trip.
  for (let cycle = -5; cycle <= 1; cycle++) {
    for (const [ti, tpl] of [TURNS, WORLD].entries()) {
      const tripStart = anchor + cycle * 14 * D + ti * 7 * D
      const tripId = `DEMO-T${cycle + 6}${ti ? 'W' : 'H'}`
      for (const leg of tpl.legs) {
        id++
        const schedOut = tripStart + leg.dayOffset * D + leg.startHourZ * H
        const blockMs = (BLOCK[`${leg.from}-${leg.to}`] ?? 120) * MIN
        const schedOff = schedOut + 17 * MIN
        const schedOn = schedOut + blockMs - 9 * MIN
        const schedIn = schedOut + blockMs
        // Deterministic delay pattern: mostly small, every 7th leg a real ATC hold.
        const delay = id % 7 === 0 ? 45 * MIN : (((id * 7) % 5) - 2) * 7 * MIN
        const past = schedIn + delay < now
        rows.push({
          id: `DEMO-L${id}`,
          departure: leg.from, arrival: leg.to,
          is_dh: leg.dh ?? false, is_commercial_deadhead: false,
          scheduled_block_out_time: iso(schedOut),
          scheduled_take_off_time: iso(schedOff),
          scheduled_landing_time: iso(schedOn),
          scheduled_block_in_time: iso(schedIn),
          scheduled_block_time: blockMs / 1000, // seconds, like the real writer
          block_out_time: past ? iso(schedOut + delay) : null,
          take_off_time: past ? iso(schedOff + delay) : null,
          landing_time: past ? iso(schedOn + delay) : null,
          block_in_time: past ? iso(schedIn + delay) : null,
          duty_period_id: null,
          trip_id: tripId,
          aircraft_type: ti ? '74Y' : 'M1F',
          tail_number: `N${600 + (id % 30)}UP`,
          deleted_at: null,
        })
      }
    }
  }
  return rows
}
