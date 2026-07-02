import { describe, it, expect } from 'vitest'
import { recordsFor, milestonesFor, fleetStats } from '../src/data/career'
import type { Leg, OoiTimes } from '../src/model'

const NIL: OoiTimes = { out: null, off: null, on: null, in: null }
let seq = 0
const leg = (o: Partial<Leg>): Leg => {
  seq++
  const t = o.t ?? seq * 86400000
  return {
    id: `L${seq}`, from: 'SDF', to: 'ANC', s: [38, -85], e: [61, -150],
    t, takeoff: t + 600000, landing: (o.landing ?? t + 4 * 3600000), out: t, in: (o.landing ?? t + 4 * 3600000),
    blockMs: 4 * 3600000, sched: NIL, act: NIL, dh: false, miles: 1000, aircraft: '74Y', tail: 'N601UP', tripId: null, base: null, ...o,
  }
}

describe('recordsFor', () => {
  it('finds longest/shortest, undirected top pair, top airport, distinct tails — operated legs only', () => {
    seq = 0
    const legs = [
      leg({ miles: 4400, from: 'ANC', to: 'HKG', tail: 'N605UP' }),
      leg({ miles: 250, from: 'SDF', to: 'ORD', tail: 'N601UP' }),
      leg({ miles: 260, from: 'ORD', to: 'SDF', tail: 'N601UP' }),
      leg({ miles: 255, from: 'SDF', to: 'ORD', tail: 'N602UP' }),
      leg({ miles: 9000, from: 'HKG', to: 'CGN', dh: true, tail: 'N9DH' }), // deadhead: excluded
    ]
    const r = recordsFor(legs)
    expect(r.longest!.miles).toBe(4400)
    expect(r.shortest!.miles).toBe(250)
    expect(r.topPair).toMatchObject({ a: 'ORD', b: 'SDF', count: 3 })
    expect(r.topAirport).toMatchObject({ iata: 'ORD', landings: 2 })
    expect(r.distinctTails).toBe(3)
  })
  it('handles empty input', () => {
    const r = recordsFor([])
    expect(r.longest).toBe(null)
    expect(r.topPair).toBe(null)
  })
})

describe('recordsFor — same-airport and base-at-the-time rules', () => {
  it('a same-airport leg cannot hold a distance record', () => {
    seq = 0
    const legs = [
      leg({ miles: 0, from: 'SDF', to: 'SDF' }), // air return — must not win shortest
      leg({ miles: 250, from: 'SDF', to: 'ORD' }),
      leg({ miles: 4400, from: 'ANC', to: 'HKG' }),
    ]
    const r = recordsFor(legs)
    expect(r.shortest!.miles).toBe(250)
    expect(r.longest!.miles).toBe(4400)
  })
  it('all legs same-airport -> both distance records are null, rest still computed', () => {
    seq = 0
    const legs = [leg({ miles: 0, from: 'SDF', to: 'SDF' }), leg({ miles: 1, from: 'ANC', to: 'ANC' })]
    const r = recordsFor(legs)
    expect(r.shortest).toBe(null)
    expect(r.longest).toBe(null)
    expect(r.topPair).not.toBe(null)
    expect(r.distinctTails).toBe(1)
  })
  it('landings at the trip\'s own base are excluded ("base at the time")', () => {
    seq = 0
    const legs = [
      // ANC era: SDF was an outstation, so these SDF landings count
      leg({ from: 'ANC', to: 'SDF', base: 'ANC' }),
      leg({ from: 'ANC', to: 'SDF', base: 'ANC' }),
      // SDF era: landings back at base do not count
      leg({ from: 'ORD', to: 'SDF', base: 'SDF' }),
      leg({ from: 'SDF', to: 'ORD', base: 'SDF' }),
      leg({ from: 'SDF', to: 'ORD', base: 'SDF' }),
      leg({ from: 'SDF', to: 'ORD', base: 'SDF' }),
    ]
    // raw landings: SDF 3, ORD 3 — but one SDF landing is at-base, so ORD 3 beats SDF 2
    const r = recordsFor(legs)
    expect(r.topAirport).toMatchObject({ iata: 'ORD', landings: 3 })
  })
  it('legs with unknown base count landings normally', () => {
    seq = 0
    const legs = [
      leg({ from: 'ORD', to: 'SDF', base: null }),
      leg({ from: 'ORD', to: 'SDF', base: undefined }),
      leg({ from: 'SDF', to: 'ORD', base: 'SDF' }),
    ]
    const r = recordsFor(legs)
    expect(r.topAirport).toMatchObject({ iata: 'SDF', landings: 2 })
  })
})

describe('milestonesFor', () => {
  it('records crossing times for leg counts and Earth laps, skipping deadheads', () => {
    seq = 0
    // 100 operated legs of 250nm each = 25,000nm -> crosses 1 Earth lap (21,600) and 100 legs
    const legs: Leg[] = []
    for (let i = 0; i < 100; i++) legs.push(leg({ miles: 250 }))
    legs.splice(50, 0, leg({ dh: true, miles: 99999 })) // huge deadhead must not trigger lap
    const ms = milestonesFor(legs)
    const lap = ms.find(m => m.kind === 'lap')!
    expect(lap.label).toContain('EARTH LAP')
    // 21600/250 = 86.4 -> crossed on the 87th operated leg
    const operated = legs.filter(l => !l.dh)
    expect(lap.t).toBe(operated[86].landing)
    const hundred = ms.find(m => m.kind === 'legs' && m.label.includes('100'))!
    expect(hundred.t).toBe(operated[99].landing)
  })
})

describe('fleetStats', () => {
  it('ranks by legs, normalizes type, sums block', () => {
    seq = 0
    const legs = [
      leg({ aircraft: '74Y' }), leg({ aircraft: '74Y' }), leg({ aircraft: ' 74y ' }),
      leg({ aircraft: 'M1F' }), leg({ aircraft: null }),
    ]
    const f = fleetStats(legs)
    expect(f[0]).toMatchObject({ type: '74Y', legs: 3 })
    expect(f[0].blockMs).toBe(3 * 4 * 3600000)
    expect(f.find(x => x.type === 'UNK')!.legs).toBe(1)
  })
})
