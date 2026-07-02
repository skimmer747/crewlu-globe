import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { demoFlights } from '../src/data/demoFlights'
import { buildAirportIndex } from '../src/data/airports'
import { flightsToLegs } from '../src/data/transform'
import { groupIntoTrips } from '../src/data/trips'

const NOW = Date.parse('2026-07-01T18:00:00Z')
const rows = demoFlights(NOW)
const idx = buildAirportIndex(JSON.parse(readFileSync('public/data/airports.json', 'utf8')))

describe('demoFlights', () => {
  it('generates a substantial, chronological line', () => {
    expect(rows.length).toBeGreaterThanOrEqual(50)
    const outs = rows.map(r => Date.parse(r.scheduled_block_out_time!))
    for (let i = 1; i < outs.length; i++) expect(outs[i]).toBeGreaterThan(outs[i - 1])
  })
  it('every airport resolves against the shipped index; nothing drops', () => {
    const { legs, dropped } = flightsToLegs(rows, idx)
    expect(dropped).toBe(0)
    expect(legs.length).toBe(rows.length)
  })
  it('actuals stay within the ±6h credibility window of schedule', () => {
    for (const r of rows) {
      if (!r.block_in_time) continue
      const d = Math.abs(Date.parse(r.block_in_time) - Date.parse(r.scheduled_block_in_time!))
      expect(d).toBeLessThanOrEqual(6 * 3600 * 1000)
    }
  })
  it('has deadheads, a future scheduled-only trip, and >=8 trips', () => {
    expect(rows.filter(r => r.is_dh).length).toBeGreaterThanOrEqual(3)
    const future = rows.filter(r => Date.parse(r.scheduled_block_out_time!) > NOW)
    expect(future.length).toBeGreaterThan(0)
    expect(future.every(r => r.block_out_time === null)).toBe(true)
    const { legs } = flightsToLegs(rows, idx)
    expect(groupIntoTrips(legs).length).toBeGreaterThanOrEqual(8)
  })
})
