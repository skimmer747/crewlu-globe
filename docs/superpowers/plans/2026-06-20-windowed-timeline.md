# Windowed Event-Paced Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the strobing, calendar-rate career auto-replay with a schedule-first globe that opens parked on the current trip, plays back event-paced (leg-by-leg with a dwell at each trip boundary), and is framed by a draggable date window + speed slider on a real-date timeline with compressed, labeled time-off gaps.

**Architecture:** New pure modules do the math — `trips.ts` (group legs into trips), `schedule.ts` (now / focus trip / default window / solid-vs-ghost split), `timeAxis.ts` (compressed real-date axis with `dateToX`/`xToDate`, gaps, ticks), and `playback.ts` (a pure beat-schedule + a thin rAF controller). DOM glue lives in `timelineDock.ts` (replaces `scrubber.ts`) and a rewired `main.ts`. The timeline renders the whole career faintly with the window vivid; the globe renders only the window (solid up to the playhead, faint "ghost" arcs after).

**Tech Stack:** TypeScript, Vite, Vitest (`environment: node`), globe.gl. No new dependencies. No Supabase query changes.

**Spec:** `docs/superpowers/specs/2026-06-20-globe-windowed-timeline-design.md`

**Design note (refinement on the spec):** The dock's axis spans the **full data range** `[firstLeg, lastLeg]`, not just the window — segments outside the window render dimmed so the two handles always have somewhere to slide. The globe stays schedule-first (window-only). This is additive to the approved spec; confirm with the user at first live review.

**Conventions:**
- Run all tests: `npm test` (`vitest run`). One file: `npx vitest run tests/<file>.test.ts`.
- Build/type-check: `npm run build` (`tsc --noEmit && vite build`).
- Time is epoch ms throughout. `LatLng = [lat, lng]`.
- Commit after every green step.

---

## File structure

| File | New/Change | Responsibility |
|---|---|---|
| `src/model.ts` | change | add `tripId` to `Leg` |
| `src/data/transform.ts` | change | populate `Leg.tripId` |
| `src/data/trips.ts` | new | `Trip`, `groupIntoTrips` |
| `src/data/schedule.ts` | new | `beaconHome`, `focusTrip`, `defaultWindow`, `legsInWindow`, `splitAtPlayhead` |
| `src/globe/timeAxis.ts` | new | `gapLabel`, `buildAxis` → `dateToX`/`xToDate`/pieces/gaps/ticks |
| `src/globe/playback.ts` | new | `buildPlaybackSchedule` (pure) + `createPlayback` (rAF controller) |
| `src/globe/arcsLayer.ts` | change | ghost arcs (`arcPaint`, `setArcs(globe, solid, ghost)`) |
| `src/globe/beaconLayer.ts` | change | `flyLeg(leg, durationMs?)` |
| `src/globe/hud.ts` | change | `setMoment(dateLabel, tripLabel, state)` |
| `src/globe/timelineDock.ts` | new (replaces `scrubber.ts`) | render dock + emit events |
| `src/globe/scrubber.ts` | delete | superseded |
| `src/styles.css` | change | dock restyle |
| `src/main.ts` | change | wire everything; no autoplay |
| `tests/trips.test.ts` | new | grouping |
| `tests/schedule.test.ts` | new | now/window/split |
| `tests/timeAxis.test.ts` | new | axis math |
| `tests/playback.test.ts` | new | beat schedule |
| `tests/arcsLayer.test.ts` | new | arc paint/ghost helpers |

---

## Task 1: Add `tripId` to `Leg`

**Files:**
- Modify: `src/model.ts` (the `Leg` interface)
- Modify: `src/data/transform.ts:23-29` (the `legs.push({...})`)
- Test: `tests/transform.test.ts`

- [ ] **Step 1: Write the failing test** — append to the `flightsToLegs` describe block in `tests/transform.test.ts`:

```ts
  it('carries trip_id onto the leg', () => {
    const { legs } = flightsToLegs([
      row({ id: 'a', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-11', trip_id: 'T1' }),
      row({ id: 'b', departure: 'ANC', arrival: 'PVG', scheduled_block_out_time: '2024-02-12', trip_id: null }),
    ], idx)
    expect(legs[0].tripId).toBe('T1')
    expect(legs[1].tripId).toBe(null)
  })
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/transform.test.ts`
Expected: FAIL — `tripId` does not exist on type `Leg` / value undefined.

- [ ] **Step 3: Add the field.** In `src/model.ts`, inside `interface Leg`, add after `aircraft`:

```ts
  aircraft: string | null
  tripId: string | null
```

In `src/data/transform.ts`, in the `legs.push({...})` object, add `tripId: r.trip_id,`:

```ts
    legs.push({
      id: r.id, from: dep.iata, to: arr.iata, s, e,
      t,
      dh: Boolean(r.is_dh || r.is_commercial_deadhead),
      miles: haversineNm(s, e),
      aircraft: r.aircraft_type,
      tripId: r.trip_id,
    })
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/transform.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/model.ts src/data/transform.ts tests/transform.test.ts
git commit -m "feat(model): carry trip_id onto Leg"
```

---

## Task 2: Group legs into trips (`trips.ts`)

**Files:**
- Create: `src/data/trips.ts`
- Test: `tests/trips.test.ts`

A `Trip` is a chronologically-ordered run of legs sharing a `tripId`. Legs with `tripId === null` each become their own one-leg trip. `dest` is the arrival of the last leg (used for the HUD "trip to ANC" label). `start`/`end` are first/last leg `t`.

- [ ] **Step 1: Write the failing test** — `tests/trips.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupIntoTrips } from '../src/data/trips'
import type { Leg } from '../src/model'

const leg = (o: Partial<Leg>): Leg => ({
  id: 'x', from: 'SDF', to: 'ANC', s: [0, 0], e: [1, 1], t: 0, dh: false, miles: 1, aircraft: null, tripId: null, ...o,
})

describe('groupIntoTrips', () => {
  it('groups by tripId, orders legs and trips by time, sets start/end/dest', () => {
    const trips = groupIntoTrips([
      leg({ id: 'a2', t: 200, tripId: 'T1', to: 'PVG' }),
      leg({ id: 'a1', t: 100, tripId: 'T1', to: 'ANC' }),
      leg({ id: 'b1', t: 500, tripId: 'T2', to: 'SDF' }),
    ])
    expect(trips.map(t => t.id)).toEqual(['T1', 'T2'])
    expect(trips[0].legs.map(l => l.id)).toEqual(['a1', 'a2'])
    expect(trips[0].start).toBe(100)
    expect(trips[0].end).toBe(200)
    expect(trips[0].dest).toBe('PVG')
    expect(trips[1].start).toBe(500)
  })

  it('makes each null-tripId leg its own standalone trip', () => {
    const trips = groupIntoTrips([
      leg({ id: 'x1', t: 100, tripId: null }),
      leg({ id: 'x2', t: 200, tripId: null }),
    ])
    expect(trips.length).toBe(2)
    expect(trips[0].legs.map(l => l.id)).toEqual(['x1'])
    expect(trips[1].legs.map(l => l.id)).toEqual(['x2'])
  })

  it('returns [] for no legs', () => {
    expect(groupIntoTrips([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/trips.test.ts`
Expected: FAIL — cannot find module `../src/data/trips`.

- [ ] **Step 3: Implement** — `src/data/trips.ts`:

```ts
import type { Leg } from '../model'

export interface Trip {
  id: string
  legs: Leg[]
  start: number
  end: number
  dest: string
}

export function groupIntoTrips(legs: Leg[]): Trip[] {
  const groups = new Map<string, Leg[]>()
  let standalone = 0
  for (const l of legs) {
    const key = l.tripId ?? `__solo_${standalone++}`
    const arr = groups.get(key)
    if (arr) arr.push(l)
    else groups.set(key, [l])
  }
  const trips: Trip[] = []
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => a.t - b.t)
    const last = sorted[sorted.length - 1]
    trips.push({
      id: key,
      legs: sorted,
      start: sorted[0].t,
      end: last.t,
      dest: last.to,
    })
  }
  trips.sort((a, b) => a.start - b.start)
  return trips
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/trips.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/trips.ts tests/trips.test.ts
git commit -m "feat(data): group legs into trips"
```

---

## Task 3: Now / focus / window / split (`schedule.ts`)

**Files:**
- Create: `src/data/schedule.ts`
- Test: `tests/schedule.test.ts`

Functions:
- `beaconHome(legs, now)` → arrival `LatLng` of the last flown leg, else departure of the first upcoming leg, else `null`.
- `focusTrip(trips, now)` → the trip whose `[start,end]` contains `now`; else the first trip starting after `now`; else the last trip; else `null`.
- `defaultWindow(legs, trips, now)` → `{ start: min(now, focusTrip.start), end: lastLeg.t }`. Empty → `{start: now, end: now}`.
- `legsInWindow(legs, w)` → legs with `t` in `[w.start, w.end]`.
- `splitAtPlayhead(windowLegs, playhead)` → `{ solid: t <= playhead, ghost: t > playhead }`.

- [ ] **Step 1: Write the failing test** — `tests/schedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { beaconHome, focusTrip, defaultWindow, legsInWindow, splitAtPlayhead } from '../src/data/schedule'
import { groupIntoTrips } from '../src/data/trips'
import type { Leg } from '../src/model'

const leg = (o: Partial<Leg>): Leg => ({
  id: 'x', from: 'SDF', to: 'ANC', s: [10, 10], e: [20, 20], t: 0, dh: false, miles: 1, aircraft: null, tripId: null, ...o,
})

describe('schedule', () => {
  const legs = [
    leg({ id: 'p1', t: 100, tripId: 'P', s: [1, 1], e: [2, 2] }),
    leg({ id: 'p2', t: 200, tripId: 'P', s: [2, 2], e: [3, 3] }),
    leg({ id: 'f1', t: 800, tripId: 'F', s: [3, 3], e: [4, 4] }),
  ]
  const trips = groupIntoTrips(legs)

  it('beaconHome = arrival of last flown leg', () => {
    expect(beaconHome(legs, 500)).toEqual([3, 3]) // p2 is last with t<=500
  })
  it('beaconHome falls back to first upcoming departure when nothing flown', () => {
    expect(beaconHome(legs, 50)).toEqual([1, 1])
  })
  it('beaconHome is null with no legs', () => {
    expect(beaconHome([], 0)).toBe(null)
  })

  it('focusTrip = trip containing now', () => {
    expect(focusTrip(trips, 150)?.id).toBe('P')
  })
  it('focusTrip = next upcoming when off between trips', () => {
    expect(focusTrip(trips, 500)?.id).toBe('F')
  })
  it('focusTrip = last trip when now is past everything', () => {
    expect(focusTrip(trips, 9999)?.id).toBe('F')
  })

  it('defaultWindow spans min(now, focus.start) .. lastLeg', () => {
    // off at t=500: focus=F(start 800) -> start=min(500,800)=500, end=800
    expect(defaultWindow(legs, trips, 500)).toEqual({ start: 500, end: 800 })
    // mid-trip P at t=150: focus=P(start 100) -> start=min(150,100)=100, end=800
    expect(defaultWindow(legs, trips, 150)).toEqual({ start: 100, end: 800 })
  })

  it('legsInWindow filters inclusive', () => {
    expect(legsInWindow(legs, { start: 100, end: 200 }).map(l => l.id)).toEqual(['p1', 'p2'])
  })

  it('splitAtPlayhead splits solid vs ghost', () => {
    const { solid, ghost } = splitAtPlayhead(legs, 200)
    expect(solid.map(l => l.id)).toEqual(['p1', 'p2'])
    expect(ghost.map(l => l.id)).toEqual(['f1'])
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/schedule.test.ts`
Expected: FAIL — cannot find module `../src/data/schedule`.

- [ ] **Step 3: Implement** — `src/data/schedule.ts`:

```ts
import type { Leg } from '../model'
import type { LatLng } from '../astro/geo'
import type { Trip } from './trips'

export interface Window { start: number; end: number }

export function beaconHome(legs: Leg[], now: number): LatLng | null {
  if (!legs.length) return null
  let lastFlown: Leg | null = null
  for (const l of legs) { if (l.t <= now) lastFlown = l; else break }
  if (lastFlown) return [lastFlown.e[0], lastFlown.e[1]]
  const firstUpcoming = legs.find((l) => l.t > now)
  return firstUpcoming ? [firstUpcoming.s[0], firstUpcoming.s[1]] : null
}

export function focusTrip(trips: Trip[], now: number): Trip | null {
  if (!trips.length) return null
  const containing = trips.find((t) => now >= t.start && now <= t.end)
  if (containing) return containing
  const nextUpcoming = trips.find((t) => t.start > now)
  if (nextUpcoming) return nextUpcoming
  return trips[trips.length - 1]
}

export function defaultWindow(legs: Leg[], trips: Trip[], now: number): Window {
  if (!legs.length) return { start: now, end: now }
  const focus = focusTrip(trips, now)
  const lastLeg = legs[legs.length - 1]
  const start = focus ? Math.min(now, focus.start) : legs[0].t
  return { start, end: lastLeg.t }
}

export function legsInWindow(legs: Leg[], w: Window): Leg[] {
  return legs.filter((l) => l.t >= w.start && l.t <= w.end)
}

export function splitAtPlayhead(windowLegs: Leg[], playhead: number): { solid: Leg[]; ghost: Leg[] } {
  const solid: Leg[] = [], ghost: Leg[] = []
  for (const l of windowLegs) (l.t <= playhead ? solid : ghost).push(l)
  return { solid, ghost }
}
```

> Note: `beaconHome` assumes `legs` is chronologically sorted (it is — `flightsToLegs` sorts by `t`). The `else break` is the only place that relies on it; correctness holds because we want the *last* `t <= now`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/schedule.ts tests/schedule.test.ts
git commit -m "feat(data): now/focus/window/split helpers"
```

---

## Task 4: Time axis — labels, pieces, gaps (`timeAxis.ts` part A)

**Files:**
- Create: `src/globe/timeAxis.ts`
- Test: `tests/timeAxis.test.ts`

The axis spans `[domainStart, domainEnd]` and is split into ordered **pieces**: one `active` piece per trip (clamped to the domain), with `gap` pieces filling the time between trips and the domain edges. Each piece gets a layout **weight**: active = `max(durationMs, MIN_ACTIVE_MS)`; gap = `min(durationMs, GAP_THRESHOLD_MS)` (so long time-off compresses to a fixed max width). Gaps longer than `GAP_THRESHOLD_MS` are "compressed" and get a human label.

Constants (exported for tests/tuning):
```ts
export const DAY = 86400000
export const MIN_ACTIVE_MS = 1.5 * DAY   // smallest visible trip width
export const GAP_THRESHOLD_MS = 2 * DAY  // gaps longer than this compress + get a label
```

- [ ] **Step 1: Write the failing test** — `tests/timeAxis.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gapLabel, buildAxis, DAY } from '../src/globe/timeAxis'
import type { Trip } from '../src/data/trips'

const trip = (id: string, start: number, end: number, dest = 'ANC'): Trip =>
  ({ id, legs: [], start, end, dest })

describe('gapLabel', () => {
  it('formats days, weeks, months', () => {
    expect(gapLabel(4 * DAY)).toBe('4d off')
    expect(gapLabel(21 * DAY)).toBe('3 wks off')
    expect(gapLabel(60 * DAY)).toBe('2 mo off')
  })
})

describe('buildAxis pieces & gaps', () => {
  const t0 = Date.UTC(2026, 0, 1)
  const trips = [
    trip('A', t0, t0 + 3 * DAY),
    trip('B', t0 + 33 * DAY, t0 + 36 * DAY), // 30-day gap before B -> compressed + labeled
  ]
  const axis = buildAxis(t0, t0 + 36 * DAY, trips)

  it('alternates active/gap pieces covering the domain', () => {
    expect(axis.pieces.map(p => p.kind)).toEqual(['active', 'gap', 'active'])
    expect(axis.pieces[0].startMs).toBe(t0)
    expect(axis.pieces[axis.pieces.length - 1].endMs).toBe(t0 + 36 * DAY)
  })
  it('labels only the compressed (long) gaps', () => {
    expect(axis.gaps.length).toBe(1)
    expect(axis.gaps[0].label).toBe('30 days?'.length ? gapLabel(30 * DAY) : '')
  })
  it('x runs 0..1 monotonically and active trips carry their id', () => {
    expect(axis.pieces[0].x0).toBe(0)
    expect(axis.pieces[axis.pieces.length - 1].x1).toBeCloseTo(1, 6)
    expect(axis.pieces[0].tripId).toBe('A')
    expect(axis.pieces[2].tripId).toBe('B')
    for (let i = 1; i < axis.pieces.length; i++) expect(axis.pieces[i].x0).toBeGreaterThanOrEqual(axis.pieces[i - 1].x1 - 1e-9)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/timeAxis.test.ts`
Expected: FAIL — cannot find module `../src/globe/timeAxis`.

- [ ] **Step 3: Implement part A** — `src/globe/timeAxis.ts`:

```ts
import type { Trip } from '../data/trips'

export const DAY = 86400000
export const MIN_ACTIVE_MS = 1.5 * DAY
export const GAP_THRESHOLD_MS = 2 * DAY

export interface AxisPiece {
  kind: 'active' | 'gap'
  startMs: number
  endMs: number
  x0: number
  x1: number
  tripId?: string
}
export interface AxisGap { startMs: number; endMs: number; x0: number; x1: number; label: string }
export interface AxisTick { ms: number; x: number; label: string }
export interface TimeAxis {
  domainStart: number
  domainEnd: number
  pieces: AxisPiece[]
  gaps: AxisGap[]
  ticks: AxisTick[]
  dateToX(ms: number): number
  xToDate(x: number): number
}

export function gapLabel(ms: number): string {
  const days = ms / DAY
  if (days < 14) return `${Math.max(1, Math.round(days))}d off`
  if (days < 60) return `${Math.round(days / 7)} wks off`
  return `${Math.round(days / 30)} mo off`
}

export interface BuildAxisOpts { gapThresholdMs?: number; minActiveMs?: number }

export function buildAxis(domainStart: number, domainEnd: number, trips: Trip[], opts: BuildAxisOpts = {}): TimeAxis {
  const gapThresholdMs = opts.gapThresholdMs ?? GAP_THRESHOLD_MS
  const minActiveMs = opts.minActiveMs ?? MIN_ACTIVE_MS

  // Trips overlapping the domain, clamped, ordered.
  const inDomain = trips
    .filter((t) => t.end >= domainStart && t.start <= domainEnd)
    .map((t) => ({ id: t.id, start: Math.max(t.start, domainStart), end: Math.min(t.end, domainEnd) }))
    .sort((a, b) => a.start - b.start)

  // Raw pieces (no x yet).
  type Raw = { kind: 'active' | 'gap'; startMs: number; endMs: number; tripId?: string }
  const raw: Raw[] = []
  let cursor = domainStart
  for (const t of inDomain) {
    if (t.start > cursor) raw.push({ kind: 'gap', startMs: cursor, endMs: t.start })
    raw.push({ kind: 'active', startMs: t.start, endMs: t.end, tripId: t.id })
    cursor = Math.max(cursor, t.end)
  }
  if (cursor < domainEnd) raw.push({ kind: 'gap', startMs: cursor, endMs: domainEnd })
  if (!raw.length) raw.push({ kind: 'gap', startMs: domainStart, endMs: domainEnd })

  const weight = (p: Raw): number => {
    const dur = p.endMs - p.startMs
    return p.kind === 'active' ? Math.max(dur, minActiveMs) : Math.min(dur, gapThresholdMs)
  }
  const totalW = raw.reduce((s, p) => s + weight(p), 0) || 1

  const pieces: AxisPiece[] = []
  let acc = 0
  for (const p of raw) {
    const w = weight(p)
    const x0 = acc / totalW
    acc += w
    const x1 = acc / totalW
    pieces.push({ kind: p.kind, startMs: p.startMs, endMs: p.endMs, x0, x1, tripId: p.tripId })
  }

  const gaps: AxisGap[] = pieces
    .filter((p) => p.kind === 'gap' && p.endMs - p.startMs > gapThresholdMs)
    .map((p) => ({ startMs: p.startMs, endMs: p.endMs, x0: p.x0, x1: p.x1, label: gapLabel(p.endMs - p.startMs) }))

  const dateToX = (ms: number): number => {
    if (ms <= domainStart) return 0
    if (ms >= domainEnd) return 1
    for (const p of pieces) {
      if (ms >= p.startMs && ms <= p.endMs) {
        const span = p.endMs - p.startMs
        return span <= 0 ? p.x0 : p.x0 + ((ms - p.startMs) / span) * (p.x1 - p.x0)
      }
    }
    return 1
  }
  const xToDate = (x: number): number => {
    const c = Math.min(1, Math.max(0, x))
    for (const p of pieces) {
      if (c >= p.x0 && c <= p.x1) {
        const span = p.x1 - p.x0
        return span <= 0 ? p.startMs : p.startMs + ((c - p.x0) / span) * (p.endMs - p.startMs)
      }
    }
    return domainEnd
  }

  return { domainStart, domainEnd, pieces, gaps, ticks: [], dateToX, xToDate }
}
```

> The test's gap-label assertion line is intentionally just `gapLabel(30 * DAY)` — keep the implementation's labeling identical to `gapLabel`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/timeAxis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/globe/timeAxis.ts tests/timeAxis.test.ts
git commit -m "feat(globe): time axis pieces, gaps, gapLabel"
```

---

## Task 5: Time axis — `dateToX`/`xToDate` round-trip + ticks (`timeAxis.ts` part B)

**Files:**
- Modify: `src/globe/timeAxis.ts` (add tick generation; `dateToX`/`xToDate` already exist)
- Test: `tests/timeAxis.test.ts`

Ticks adapt to the domain span: ≤ ~45 days → weekly (label `D MON`), ≤ ~18 months → monthly (label `MON` or `MON YY`), else yearly (label `YYYY`). Place each tick via `dateToX`, then drop ticks closer than `MIN_TICK_DX` to the previous (avoids bunching inside compressed gaps).

- [ ] **Step 1: Write the failing tests** — append to `tests/timeAxis.test.ts`:

```ts
import { } from '../src/globe/timeAxis'

describe('buildAxis dateToX / xToDate', () => {
  const t0 = Date.UTC(2026, 0, 1)
  const trips = [trip('A', t0, t0 + 3 * DAY), trip('B', t0 + 33 * DAY, t0 + 36 * DAY)]
  const axis = buildAxis(t0, t0 + 36 * DAY, trips)

  it('round-trips dates inside active pieces', () => {
    const mid = t0 + 1.5 * DAY
    expect(axis.xToDate(axis.dateToX(mid))).toBeCloseTo(mid, -3)
  })
  it('clamps outside the domain', () => {
    expect(axis.dateToX(t0 - DAY)).toBe(0)
    expect(axis.dateToX(t0 + 99 * DAY)).toBe(1)
  })
  it('compresses the long gap: 30 real days occupy <= the active widths', () => {
    const gapX = axis.gaps[0].x1 - axis.gaps[0].x0
    const activeX = axis.pieces[0].x1 - axis.pieces[0].x0
    expect(gapX).toBeLessThanOrEqual(activeX + 1e-9)
  })
})

describe('buildAxis ticks', () => {
  it('uses monthly ticks across ~6 months and they are within [0,1]', () => {
    const t0 = Date.UTC(2026, 0, 1)
    const axis = buildAxis(t0, Date.UTC(2026, 6, 1), [trip('A', t0, Date.UTC(2026, 6, 1))])
    expect(axis.ticks.length).toBeGreaterThanOrEqual(4)
    for (const tk of axis.ticks) { expect(tk.x).toBeGreaterThanOrEqual(0); expect(tk.x).toBeLessThanOrEqual(1) }
  })
  it('uses yearly ticks across many years', () => {
    const axis = buildAxis(Date.UTC(2019, 0, 1), Date.UTC(2026, 0, 1), [trip('A', Date.UTC(2019, 0, 1), Date.UTC(2026, 0, 1))])
    expect(axis.ticks.some(tk => /^\d{4}$/.test(tk.label))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/timeAxis.test.ts`
Expected: FAIL — `axis.ticks` is empty (length 0).

- [ ] **Step 3: Implement ticks.** In `src/globe/timeAxis.ts`, add the constant and helpers above `buildAxis`:

```ts
export const MIN_TICK_DX = 0.045
const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

function monthStarts(start: number, end: number): number[] {
  const out: number[] = []
  const d = new Date(start)
  let y = d.getUTCFullYear(), m = d.getUTCMonth()
  if (Date.UTC(y, m, 1) < start) { m++; if (m > 11) { m = 0; y++ } }
  for (let ms = Date.UTC(y, m, 1); ms <= end; ) {
    out.push(ms)
    m++; if (m > 11) { m = 0; y++ }
    ms = Date.UTC(y, m, 1)
  }
  return out
}
function yearStarts(start: number, end: number): number[] {
  const out: number[] = []
  let y = new Date(start).getUTCFullYear()
  if (Date.UTC(y, 0, 1) < start) y++
  for (let ms = Date.UTC(y, 0, 1); ms <= end; y++, ms = Date.UTC(y, 0, 1)) out.push(ms)
  return out
}
function weekStarts(start: number, end: number): number[] {
  const out: number[] = []
  for (let ms = Math.ceil(start / (7 * DAY)) * (7 * DAY); ms <= end; ms += 7 * DAY) out.push(ms)
  return out
}
```

Then, just before the `return {...}` in `buildAxis`, build ticks and include them:

```ts
  const spanDays = (domainEnd - domainStart) / DAY
  let raw_ticks: { ms: number; label: string }[]
  if (spanDays <= 45) {
    raw_ticks = weekStarts(domainStart, domainEnd).map((ms) => {
      const d = new Date(ms); return { ms, label: `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }
    })
  } else if (spanDays <= 18 * 30) {
    const multiYear = new Date(domainStart).getUTCFullYear() !== new Date(domainEnd).getUTCFullYear()
    raw_ticks = monthStarts(domainStart, domainEnd).map((ms) => {
      const d = new Date(ms)
      return { ms, label: multiYear ? `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : MON[d.getUTCMonth()] }
    })
  } else {
    raw_ticks = yearStarts(domainStart, domainEnd).map((ms) => ({ ms, label: String(new Date(ms).getUTCFullYear()) }))
  }
  const ticks: AxisTick[] = []
  for (const tk of raw_ticks) {
    const x = dateToX(tk.ms)
    if (!ticks.length || x - ticks[ticks.length - 1].x >= MIN_TICK_DX) ticks.push({ ms: tk.ms, x, label: tk.label })
  }
```

And change the final return to use `ticks` instead of `ticks: []`:

```ts
  return { domainStart, domainEnd, pieces, gaps, ticks, dateToX, xToDate }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/timeAxis.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/globe/timeAxis.ts tests/timeAxis.test.ts
git commit -m "feat(globe): adaptive time-axis ticks + round-trip mapping"
```

---

## Task 6: Playback beat schedule (`playback.ts` pure core)

**Files:**
- Create: `src/globe/playback.ts`
- Test: `tests/playback.test.ts`

`buildPlaybackSchedule(legs, trips, {legMs, dwellMs})` lays each leg's draw end-to-end; after the last leg of a trip (i.e. before a leg whose `tripId` differs from the previous), it inserts a dwell. `sampleAt(elapsed)` returns the current leg `index`, `phase` (`'draw'` while inside the leg's draw window, else `'dwell'`), `frac` (0..1 progress through the *draw*, used for beacon slerp), and `done`.

- [ ] **Step 1: Write the failing test** — `tests/playback.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPlaybackSchedule } from '../src/globe/playback'
import type { Leg } from '../src/model'

const leg = (id: string, t: number, tripId: string | null): Leg =>
  ({ id, from: 'A', to: 'B', s: [0, 0], e: [1, 1], t, dh: false, miles: 1, aircraft: null, tripId })

describe('buildPlaybackSchedule', () => {
  // 3 legs: two in trip T1, one in trip T2 -> one dwell after leg index 1
  const legs = [leg('a', 1, 'T1'), leg('b', 2, 'T1'), leg('c', 3, 'T2')]
  const sched = buildPlaybackSchedule(legs, [], { legMs: 100, dwellMs: 50 })

  it('total = 3 legs * 100 + 1 dwell * 50', () => {
    expect(sched.totalMs).toBe(350)
  })
  it('samples draw phase within a leg', () => {
    expect(sched.sampleAt(50)).toMatchObject({ index: 0, phase: 'draw', done: false })
    expect(sched.sampleAt(50).frac).toBeCloseTo(0.5, 6)
  })
  it('inserts dwell only at the trip boundary (after leg 1)', () => {
    // leg1 draw: [100,200); dwell: [200,250); leg2 draw: [250,350)
    expect(sched.sampleAt(220)).toMatchObject({ index: 1, phase: 'dwell' })
    expect(sched.sampleAt(300)).toMatchObject({ index: 2, phase: 'draw' })
  })
  it('reports done past the end', () => {
    expect(sched.sampleAt(999)).toMatchObject({ index: 2, done: true })
  })
  it('timeAtIndex returns the draw-start of a leg', () => {
    expect(sched.timeAtIndex(2)).toBe(250)
  })
  it('empty legs -> total 0', () => {
    expect(buildPlaybackSchedule([], [], { legMs: 100, dwellMs: 50 }).totalMs).toBe(0)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/playback.test.ts`
Expected: FAIL — cannot find module `../src/globe/playback`.

- [ ] **Step 3: Implement the pure core** — `src/globe/playback.ts`:

```ts
import type { Leg } from '../model'
import type { Trip } from '../data/trips'

export interface PlaybackSample { index: number; phase: 'draw' | 'dwell'; frac: number; done: boolean }
export interface PlaybackSchedule {
  totalMs: number
  count: number
  timeAtIndex(index: number): number
  sampleAt(elapsedMs: number): PlaybackSample
}

export function buildPlaybackSchedule(
  legs: Leg[],
  _trips: Trip[],
  opts: { legMs: number; dwellMs: number },
): PlaybackSchedule {
  const { legMs, dwellMs } = opts
  const drawStart: number[] = new Array(legs.length)
  let cursor = 0
  for (let i = 0; i < legs.length; i++) {
    drawStart[i] = cursor
    cursor += legMs
    const boundary = i < legs.length - 1 && legs[i + 1].tripId !== legs[i].tripId
    if (boundary) cursor += dwellMs
  }
  const totalMs = legs.length ? cursor : 0

  return {
    totalMs,
    count: legs.length,
    timeAtIndex(index) {
      if (!legs.length) return 0
      return drawStart[Math.max(0, Math.min(index, legs.length - 1))]
    },
    sampleAt(elapsedMs) {
      if (!legs.length) return { index: 0, phase: 'dwell', frac: 1, done: true }
      if (elapsedMs >= totalMs) return { index: legs.length - 1, phase: 'dwell', frac: 1, done: true }
      let i = 0
      while (i + 1 < legs.length && drawStart[i + 1] <= elapsedMs) i++
      const local = elapsedMs - drawStart[i]
      if (local < legMs) return { index: i, phase: 'draw', frac: legMs ? local / legMs : 1, done: false }
      return { index: i, phase: 'dwell', frac: 1, done: false }
    },
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/playback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/globe/playback.ts tests/playback.test.ts
git commit -m "feat(globe): pure event-paced playback schedule"
```

---

## Task 7: Playback rAF controller (`playback.ts`)

**Files:**
- Modify: `src/globe/playback.ts` (append `createPlayback`)

The controller owns the rAF loop, current speed, and resume point. It rebuilds the schedule on play / speed change. It calls `onReveal(solidCount)` and `onFly(leg)` whenever the leg index advances, `onPlayhead(ms)` every frame, and `onDone()`/`onPlayingChange()` for state. No unit test (rAF/`performance.now`); verified live in Task 14.

- [ ] **Step 1: Append the controller** to `src/globe/playback.ts`:

```ts
export interface Playback {
  play(): void
  pause(): void
  toggle(): void
  setSpeed(mult: number): void
  isPlaying(): boolean
}

export interface PlaybackController {
  legs: () => Leg[]          // window legs, chronological
  trips: () => Trip[]
  startIndex: () => number   // resume: count of legs already solid (playhead-derived)
  baseLegMs: number
  baseDwellMs: number
  onReveal: (solidCount: number) => void
  onFly: (leg: Leg) => void
  onPlayhead: (ms: number) => void
  onDone: () => void
  onPlayingChange: (playing: boolean) => void
}

export function createPlayback(c: PlaybackController): Playback {
  let raf = 0, playing = false, speed = 1
  let sched: PlaybackSchedule | null = null
  let t0 = 0, baseElapsed = 0, lastIndex = -1

  const build = () => buildPlaybackSchedule(c.legs(), c.trips(), { legMs: c.baseLegMs / speed, dwellMs: c.baseDwellMs / speed })

  const frame = (ts: number) => {
    if (!playing || !sched) return
    const e = baseElapsed + (ts - t0)
    const s = sched.sampleAt(e)
    if (s.index !== lastIndex) {
      lastIndex = s.index
      c.onReveal(s.index + 1)
      const leg = c.legs()[s.index]
      if (leg) c.onFly(leg)
    }
    const cur = c.legs()[s.index]
    if (cur) c.onPlayhead(cur.t)
    if (s.done) { playing = false; c.onPlayingChange(false); c.onDone(); return }
    raf = requestAnimationFrame(frame)
  }

  const play = () => {
    const legs = c.legs()
    if (!legs.length) return
    sched = build()
    const si = Math.min(Math.max(0, c.startIndex()), legs.length - 1)
    baseElapsed = si >= legs.length - 1 ? 0 : sched.timeAtIndex(si)  // at end -> restart from beginning
    lastIndex = -1
    playing = true
    c.onPlayingChange(true)
    t0 = performance.now()
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(frame)
  }
  const pause = () => { playing = false; cancelAnimationFrame(raf); c.onPlayingChange(false) }

  return {
    play, pause,
    toggle() { playing ? pause() : play() },
    setSpeed(mult) {
      speed = mult
      if (playing && sched) {
        const curIdx = lastIndex < 0 ? 0 : lastIndex
        sched = build()
        baseElapsed = sched.timeAtIndex(curIdx)
        t0 = performance.now()
      }
    },
    isPlaying() { return playing },
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: PASS (no type errors). The controller is wired into the UI in Task 13.

- [ ] **Step 3: Commit**

```bash
git add src/globe/playback.ts
git commit -m "feat(globe): rAF playback controller"
```

---

## Task 8: Ghost arcs (`arcsLayer.ts`)

**Files:**
- Modify: `src/globe/arcsLayer.ts`
- Test: `tests/arcsLayer.test.ts`

Render upcoming legs as faint "ghost" arcs. We tag legs with a transient `__ghost` flag and key the `arcColor`/`arcStroke`/`arcAltitude` off it. Points (airport dots) come from solid legs only. We unit-test the two pure helpers (`arcPaint`, `combineArcData`); the globe wiring is verified live.

- [ ] **Step 1: Write the failing test** — `tests/arcsLayer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { arcPaint, combineArcData } from '../src/globe/arcsLayer'
import type { Leg } from '../src/model'

const leg = (o: Partial<Leg>): Leg => ({
  id: 'x', from: 'A', to: 'B', s: [0, 0], e: [1, 1], t: 0, dh: false, miles: 1, aircraft: null, tripId: null, ...o,
})

describe('arcsLayer helpers', () => {
  it('arcPaint: solid flew is bright cyan both ends', () => {
    expect(arcPaint(leg({ dh: false }))).toEqual(['#5fe0ff', '#5fe0ff'])
  })
  it('arcPaint: solid deadhead is amber', () => {
    expect(arcPaint(leg({ dh: true }))).toEqual(['#ffb15f', '#ffb15f'])
  })
  it('arcPaint: ghost uses low-alpha rgba', () => {
    const [c] = arcPaint(leg({ dh: false, __ghost: true } as any))
    expect(c).toMatch(/^rgba\(/)
    expect(c).toContain('0.18')
  })
  it('combineArcData tags ghosts and keeps order solid-first', () => {
    const out = combineArcData([leg({ id: 's' })], [leg({ id: 'g' })])
    expect(out.map(l => l.id)).toEqual(['s', 'g'])
    expect((out[0] as any).__ghost).toBeFalsy()
    expect((out[1] as any).__ghost).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/arcsLayer.test.ts`
Expected: FAIL — `arcPaint` / `combineArcData` not exported.

- [ ] **Step 3: Implement.** Replace the body of `src/globe/arcsLayer.ts` with:

```ts
import type { Leg } from '../model'

const FLEW = '#5fe0ff'
const DH = '#ffb15f'
const GHOST_FLEW = 'rgba(95,224,255,0.18)'
const GHOST_DH = 'rgba(255,177,95,0.18)'

type ArcLeg = Leg & { __ghost?: boolean }

export function arcPaint(d: ArcLeg): [string, string] {
  if (d.__ghost) { const g = d.dh ? GHOST_DH : GHOST_FLEW; return [g, g] }
  const c = d.dh ? DH : FLEW
  return [c, c]
}

export function combineArcData(solid: Leg[], ghost: Leg[]): ArcLeg[] {
  return [...solid, ...ghost.map((l) => ({ ...l, __ghost: true }))]
}

export function configureArcs(globe: any) {
  globe
    .arcStartLat((d: Leg) => d.s[0]).arcStartLng((d: Leg) => d.s[1])
    .arcEndLat((d: Leg) => d.e[0]).arcEndLng((d: Leg) => d.e[1])
    .arcColor((d: ArcLeg) => arcPaint(d))
    .arcStroke((d: ArcLeg) => (d.__ghost ? 0.3 : 0.6))
    .arcAltitudeAutoScale(0.45)
    .arcDashLength((d: ArcLeg) => (d.__ghost ? 0.25 : 0.45))
    .arcDashGap((d: ArcLeg) => (d.__ghost ? 0.5 : 0.18))
    .arcDashAnimateTime(2600)
    .arcLabel((d: Leg) => `<div style="font-family:monospace;color:#eaf7ff;background:rgba(8,20,34,.85);padding:6px 9px;border:1px solid rgba(47,214,255,.4);border-radius:7px;font-size:11px"><b style="color:#2fd6ff">${d.from} → ${d.to}</b> · ${d.miles.toLocaleString()} nm<br><span style="color:${d.dh ? DH : FLEW};font-size:9px;letter-spacing:1px">${d.dh ? 'DEADHEAD (rode)' : 'FLEW (operated)'}</span></div>`)
    .pointLat((d: { lat: number }) => d.lat).pointLng((d: { lng: number }) => d.lng)
    .pointColor(() => '#fff7e0').pointAltitude(0.012).pointRadius(0.34)
}

export function setArcs(globe: any, solid: Leg[], ghost: Leg[] = []) {
  globe.arcsData(combineArcData(solid, ghost))
  const apts = new Map<string, { lat: number; lng: number }>()
  for (const l of solid) { apts.set(l.from, { lat: l.s[0], lng: l.s[1] }); apts.set(l.to, { lat: l.e[0], lng: l.e[1] }) }
  globe.pointsData([...apts.values()])
}
```

In `src/model.ts`, the `__ghost` flag is transient (not part of `Leg`). To keep `combineArcData`'s return typed without polluting `Leg`, the local `ArcLeg` type above is sufficient — no `model.ts` change needed.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/arcsLayer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/globe/arcsLayer.ts tests/arcsLayer.test.ts
git commit -m "feat(globe): faint ghost arcs for upcoming legs"
```

---

## Task 9: Beacon honors playback speed (`beaconLayer.ts`)

**Files:**
- Modify: `src/globe/beaconLayer.ts:45` (the `flyLeg` method) and the interface at `:11`

- [ ] **Step 1: Change `flyLeg` to accept an optional duration.** In the `BeaconLayer` interface, change:

```ts
  flyLeg(leg: Leg, durationMs?: number): void
```

In the implementation object, change the `flyLeg` line to:

```ts
    flyLeg(leg, durationMs = 820) { flying = { leg, t0: performance.now(), dur: durationMs } },
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/globe/beaconLayer.ts
git commit -m "feat(globe): flyLeg accepts a duration so playback speed scales it"
```

---

## Task 10: HUD moment copy (`hud.ts`)

**Files:**
- Modify: `src/globe/hud.ts` (the `Hud` interface `setMoment`, the implementation, and `#mSub` markup)

`setMoment` now takes a date label, an optional trip label (e.g. `trip to ANC`), and a state string (`PLAYING` / `PAUSED`).

- [ ] **Step 1: Update the interface.** In `src/globe/hud.ts`, change the `Hud` interface line:

```ts
  setMoment(dateLabel: string, tripLabel: string | null, state: 'PLAYING' | 'PAUSED'): void
```

- [ ] **Step 2: Update the implementation.** Replace the `setMoment` method with:

```ts
    setMoment(dateLabel, tripLabel, state) {
      q('#mDate').textContent = tripLabel ? `${dateLabel} · ${tripLabel}` : dateLabel
      q('#mSub').textContent = state
    },
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: PASS (`main.ts` still calls the old signature — that's fixed in Task 13; if build is run before Task 13 it will error on `main.ts`. If so, proceed to Task 13 and build there).

- [ ] **Step 4: Commit**

```bash
git add src/globe/hud.ts
git commit -m "feat(hud): moment chip shows date + trip + play state"
```

---

## Task 11: Timeline dock (`timelineDock.ts`, replaces `scrubber.ts`)

**Files:**
- Create: `src/globe/timelineDock.ts`
- Test: none (DOM; verified live in Task 14)

The dock renders over the full data domain: trip segments (dim outside the window; cyan flown / amber upcoming / glow current inside the window relative to the playhead), labeled compressed gaps, real-date tick labels, a draggable **start** and **end** handle (window), a draggable **playhead**, a `From`/`To` date readout (tap to type), a **Play/Pause** button, and a **speed** slider. It emits `onWindowChange`, `onSeek`, `onPlayToggle`, `onSpeed`. Pointer math uses `axis.dateToX`/`axis.xToDate`.

- [ ] **Step 1: Create the module** — `src/globe/timelineDock.ts`:

```ts
import type { Leg } from '../model'
import type { Trip } from '../data/trips'
import { buildAxis, type TimeAxis } from './timeAxis'

const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const dayLabel = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
export const SPEEDS = [0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]

export interface DockState { legs: Leg[]; trips: Trip[]; domainStart: number; domainEnd: number; windowStart: number; windowEnd: number; playhead: number; speedIndex: number }

export interface TimelineDock {
  mount(host: HTMLElement): void
  render(): void
  setPlayhead(ms: number): void
  setPlaying(playing: boolean): void
  setMomentTrip(label: string | null): void
  state: DockState
  onWindowChange(cb: (start: number, end: number) => void): void
  onSeek(cb: (ms: number) => void): void
  onPlayToggle(cb: () => void): void
  onSpeed(cb: (mult: number) => void): void
}

export function createTimelineDock(init: { legs: Leg[]; trips: Trip[]; windowStart: number; windowEnd: number; playhead: number }): TimelineDock {
  const legs = init.legs
  const domainStart = legs.length ? legs[0].t : init.windowStart
  const domainEnd = legs.length ? legs[legs.length - 1].t : init.windowEnd
  const state: DockState = {
    legs, trips: init.trips, domainStart, domainEnd,
    windowStart: init.windowStart, windowEnd: init.windowEnd, playhead: init.playhead, speedIndex: 3,
  }
  let axis: TimeAxis = buildAxis(domainStart, domainEnd, init.trips)
  let host!: HTMLElement
  let track!: HTMLElement
  let cbWindow: (s: number, e: number) => void = () => {}
  let cbSeek: (ms: number) => void = () => {}
  let cbToggle: () => void = () => {}
  let cbSpeed: (m: number) => void = () => {}

  const pctToMs = (pct: number) => axis.xToDate(pct)
  const msToPct = (ms: number) => axis.dateToX(ms) * 100

  const segColor = (p: { startMs: number; endMs: number }): string => {
    const inWindow = p.endMs >= state.windowStart && p.startMs <= state.windowEnd
    if (!inWindow) return 'dim'
    if (p.startMs <= state.playhead && p.endMs >= state.playhead) return 'current'
    return p.endMs <= state.playhead ? 'flown' : 'upcoming'
  }

  const renderTrack = () => {
    const segs = axis.pieces.filter((p) => p.kind === 'active').map((p) => {
      const cls = segColor(p)
      return `<div class="seg ${cls}" style="left:${(p.x0 * 100).toFixed(3)}%;width:${((p.x1 - p.x0) * 100).toFixed(3)}%"></div>`
    }).join('')
    const gaps = axis.gaps.map((g) =>
      `<div class="gap" style="left:${(g.x0 * 100).toFixed(3)}%;width:${((g.x1 - g.x0) * 100).toFixed(3)}%"><span class="gaplbl">${g.label}</span></div>`).join('')
    const ticks = axis.ticks.map((t) =>
      `<span class="atick" style="left:${(t.x * 100).toFixed(3)}%">${t.label}</span>`).join('')
    const winL = msToPct(state.windowStart), winR = msToPct(state.windowEnd)
    const ph = msToPct(state.playhead)
    track.innerHTML =
      `<div class="winmask" style="left:0;width:${winL.toFixed(3)}%"></div>` +
      `<div class="winmask" style="left:${winR.toFixed(3)}%;right:0"></div>` +
      gaps + segs +
      `<div class="phead" style="left:${ph.toFixed(3)}%"></div>` +
      `<div class="handle hL" data-h="L" style="left:${winL.toFixed(3)}%"></div>` +
      `<div class="handle hR" data-h="R" style="left:${winR.toFixed(3)}%"></div>` +
      `<div class="axisticks">${ticks}</div>`
    const fromEl = host.querySelector<HTMLElement>('#tlFrom')!
    const toEl = host.querySelector<HTMLElement>('#tlTo')!
    fromEl.textContent = dayLabel(state.windowStart)
    toEl.textContent = dayLabel(state.windowEnd)
  }

  const pointerPct = (clientX: number) => {
    const r = track.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }

  const bindDrag = () => {
    let dragging: 'L' | 'R' | 'P' | null = null
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.classList.contains('handle')) dragging = t.dataset.h as 'L' | 'R'
      else dragging = 'P'
      track.setPointerCapture(e.pointerId)
      move(e)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const ms = pctToMs(pointerPct(e.clientX))
      if (dragging === 'L') { state.windowStart = Math.min(ms, state.windowEnd - 1); state.playhead = Math.max(state.playhead, state.windowStart) }
      else if (dragging === 'R') { state.windowEnd = Math.max(ms, state.windowStart + 1); state.playhead = Math.min(state.playhead, state.windowEnd) }
      else { state.playhead = Math.min(Math.max(ms, state.windowStart), state.windowEnd) }
      renderTrack()
    }
    const up = () => {
      if (!dragging) return
      if (dragging === 'P') cbSeek(state.playhead)
      else cbWindow(state.windowStart, state.windowEnd)
      dragging = null
    }
    track.addEventListener('pointerdown', down)
    track.addEventListener('pointermove', move)
    track.addEventListener('pointerup', up)
    track.addEventListener('pointercancel', up)
  }

  return {
    state,
    mount(h) {
      host = h
      h.insertAdjacentHTML('beforeend', DOCK_HTML)
      track = h.querySelector<HTMLElement>('#tlTrack')!
      const speed = h.querySelector<HTMLInputElement>('#tlSpeed')!
      speed.value = String(state.speedIndex)
      speed.max = String(SPEEDS.length - 1)
      const speedLbl = h.querySelector<HTMLElement>('#tlSpeedVal')!
      speedLbl.textContent = `${SPEEDS[state.speedIndex]}×`
      speed.addEventListener('input', () => {
        state.speedIndex = +speed.value
        speedLbl.textContent = `${SPEEDS[state.speedIndex]}×`
        cbSpeed(SPEEDS[state.speedIndex])
      })
      h.querySelector('#tlPlay')!.addEventListener('click', () => cbToggle())
      bindDrag()
      renderTrack()
    },
    render() { axis = buildAxis(state.domainStart, state.domainEnd, state.trips); renderTrack() },
    setPlayhead(ms) { state.playhead = ms; renderTrack() },
    setPlaying(playing) { host.querySelector('#tlPlay')!.textContent = playing ? '❚❚' : '▶' },
    setMomentTrip() { /* moment chip is owned by the HUD; dock exposes window/playhead only */ },
    onWindowChange(cb) { cbWindow = cb },
    onSeek(cb) { cbSeek = cb },
    onPlayToggle(cb) { cbToggle = cb },
    onSpeed(cb) { cbSpeed = cb },
  }
}

const DOCK_HTML = `
<div id="dock">
  <div id="dockInner">
    <div id="tlTrack"></div>
    <div id="tlCtl">
      <button class="btn" id="tlPlay">▶</button>
      <div class="tlspeed"><span class="tlk">SPEED</span><input id="tlSpeed" type="range" min="0" max="7" step="1" value="3"><span id="tlSpeedVal" class="tlv">1×</span></div>
      <div class="tlrange"><span class="tlk">FROM</span><span id="tlFrom" class="tlpill">—</span><span class="tlk">TO</span><span id="tlTo" class="tlpill">—</span></div>
    </div>
  </div>
</div>
`
```

> Tappable-to-type on the date pills is wired in Task 13's verification as a small enhancement (a `prompt()`-free inline `<input type="date">` swap is fine, but the MVP ships the draggable handles + readout; if the executor has budget, convert `.tlpill` to an `<input type="date">` that calls `cbWindow`). The handles are the primary control and must work.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: may error in `main.ts` (still importing `scrubber`); that's fixed in Task 13. `timelineDock.ts` itself must type-check — if errors point only at `main.ts`/`scrubber.ts`, proceed.

- [ ] **Step 3: Commit**

```bash
git add src/globe/timelineDock.ts
git commit -m "feat(globe): windowed timeline dock with handles, gaps, speed"
```

---

## Task 12: Dock styles (`styles.css`)

**Files:**
- Modify: `src/styles.css` (replace the `Career-replay scrubber (dock)` block, lines ~46-59)

- [ ] **Step 1: Replace the dock CSS.** In `src/styles.css`, replace everything from the `/* ── Career-replay scrubber (dock) ──...` comment through the `#ctrl{...}` rule with:

```css
/* ── Windowed timeline dock ─────────────────────────────────────────────── */
#dock{position:absolute;left:0;right:0;bottom:0;height:128px;z-index:6;background:linear-gradient(to top,rgba(4,9,18,.94),rgba(4,9,18,0));pointer-events:none}
#dockInner{position:absolute;left:46px;right:46px;bottom:16px;pointer-events:auto}
#tlTrack{position:relative;height:46px;margin:0 4px 26px;touch-action:none;cursor:pointer}
#tlTrack::before{content:"";position:absolute;left:0;right:0;top:30px;height:2px;background:rgba(120,170,255,.18)}
.seg{position:absolute;top:18px;height:24px;border-radius:3px;background:#1c6fae;opacity:.5}
.seg.flown{background:#2fd6ff;opacity:.92}
.seg.upcoming{background:#ffb15f;opacity:.6}
.seg.current{background:#5fe0ff;opacity:1;box-shadow:0 0 10px rgba(95,224,255,.65);top:14px;height:32px}
.seg.dim{background:#39506a;opacity:.35}
.gap{position:absolute;top:22px;height:18px;border-left:1.5px dashed rgba(150,170,190,.55);border-right:1.5px dashed rgba(150,170,190,.55)}
.gaplbl{position:absolute;top:-16px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:9px;color:#9fb6cc;letter-spacing:.4px}
.winmask{position:absolute;top:10px;bottom:0;background:rgba(3,6,12,.62);pointer-events:none;z-index:2}
.phead{position:absolute;top:6px;bottom:2px;width:2px;background:#6cffae;box-shadow:0 0 8px #6cffae;z-index:4;transform:translateX(-1px)}
.phead::after{content:"";position:absolute;left:-3px;bottom:-3px;width:8px;height:8px;border-radius:50%;background:#6cffae}
.handle{position:absolute;top:8px;bottom:-2px;width:6px;margin-left:-3px;background:#ffd98a;border-radius:3px;box-shadow:0 0 10px #ffb15f;cursor:ew-resize;z-index:5;touch-action:none}
.axisticks{position:absolute;left:0;right:0;top:48px;height:12px}
.atick{position:absolute;transform:translateX(-50%);font-size:9px;color:#5fb8e0;letter-spacing:1px;white-space:nowrap}
#tlCtl{display:flex;align-items:center;gap:16px}
#tlPlay{width:38px;height:38px;flex:0 0 auto}
.tlspeed{display:flex;align-items:center;gap:8px}
.tlrange{margin-left:auto;display:flex;align-items:center;gap:8px}
.tlk{font-size:9px;letter-spacing:1.5px;color:#5fb8e0}
.tlv{font-size:10px;color:#aef0ff;min-width:26px}
.tlpill{font-size:11px;color:#eaf7ff;background:rgba(8,20,34,.6);border:1px solid rgba(47,214,255,.25);border-radius:7px;padding:5px 9px}
#tlSpeed{width:120px;-webkit-appearance:none;appearance:none;height:3px;border-radius:3px;background:rgba(120,170,255,.25);outline:none}
#tlSpeed::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#2fd6ff;box-shadow:0 0 10px #2fd6ff;cursor:pointer}
#tlSpeed::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#2fd6ff;cursor:pointer;border:none}
```

Then, in the `@media (max-width: 640px)` block, append:

```css
  #tlTrack { height: 40px; }
  #tlCtl { flex-wrap: wrap; gap: 10px; }
  .tlrange { margin-left: 0; }
  #tlSpeed { width: 90px; }
  #tip { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style(globe): windowed timeline dock visuals"
```

---

## Task 13: Wire it together (`main.ts`) + delete `scrubber.ts`

**Files:**
- Modify: `src/main.ts` (imports + the block from the scrubber section, lines ~79-103)
- Delete: `src/globe/scrubber.ts`

- [ ] **Step 1: Delete the old scrubber**

```bash
git rm src/globe/scrubber.ts
```

- [ ] **Step 2: Rewrite the imports and the playback/dock wiring in `src/main.ts`.**

Change the import block (lines 1-12) — drop `legsUpTo`, add the new modules:

```ts
import './styles.css'
import { supabase } from './supabase'
import { requireSession } from './auth/authView'
import { loadAirports } from './data/airports'
import { fetchFlights } from './data/flights'
import { flightsToLegs, statsFor } from './data/transform'
import { groupIntoTrips } from './data/trips'
import { beaconHome, focusTrip, defaultWindow, legsInWindow, splitAtPlayhead } from './data/schedule'
import { createGlobeScene } from './globe/globeScene'
import { configureArcs, setArcs } from './globe/arcsLayer'
import { createMoonLayer } from './globe/moonLayer'
import { createBeaconLayer } from './globe/beaconLayer'
import { createHud } from './globe/hud'
import { createTimelineDock, SPEEDS } from './globe/timelineDock'
import { createPlayback } from './globe/playback'
```

Replace the entire scrubber block (from `let lastRevealed = 0` through `scrubber.start()`, lines ~79-103) with:

```ts
  const trips = groupIntoTrips(legs)
  const now = Date.now()
  const win = defaultWindow(legs, trips, now)
  let playhead = Math.min(Math.max(now, win.start), win.end)

  const tripLabelFor = (ms: number): string | null => {
    const t = focusTrip(trips, ms)
    return t ? `trip to ${t.dest}` : null
  }

  // Arc rebuilds are gated on the solid-count changing (the only moment the
  // solid/ghost partition can change). The cheap per-frame updates always run.
  let lastSolidCount = -1
  const draw = (full = true) => {
    const inWin = legsInWindow(legs, { start: win.start, end: win.end })
    const { solid, ghost } = splitAtPlayhead(inWin, playhead)
    if (full || solid.length !== lastSolidCount) {
      setArcs(scene.globe, solid, ghost)
      hud.setStats(statsFor(solid, meta))
      lastSolidCount = solid.length
    }
    scene.setSun(new Date(playhead))
    moon.update(new Date(playhead))
    scene.globe.htmlElementsData([moon.datum, beacon.datum])
    moon.refreshOcclusion(scene.cameraPos()); beacon.refreshOcclusion(scene.cameraPos())
    hud.setMoment(fmt(playhead), tripLabelFor(playhead), playback.isPlaying() ? 'PLAYING' : 'PAUSED')
  }

  // Park the beacon where the pilot physically is right now.
  const home = beaconHome(legs, now)
  if (home) beacon.setAt(home[0], home[1])

  const dock = createTimelineDock({ legs, trips, windowStart: win.start, windowEnd: win.end, playhead })

  const playback = createPlayback({
    legs: () => legsInWindow(legs, { start: win.start, end: win.end }),
    trips: () => trips,
    startIndex: () => splitAtPlayhead(legsInWindow(legs, { start: win.start, end: win.end }), playhead).solid.length,
    baseLegMs: 1200,
    baseDwellMs: 500,
    onReveal: () => { /* arcs are rebuilt by draw() when solid-count changes */ },
    onFly: (leg) => beacon.flyLeg(leg, Math.max(200, 1200 / SPEEDS[dock.state.speedIndex])),
    onPlayhead: (ms) => { playhead = ms; dock.setPlayhead(ms); draw(false) },
    onDone: () => { dock.setPlaying(false); draw() },
    onPlayingChange: (p) => { dock.setPlaying(p); draw() },
  })

  dock.onPlayToggle(() => playback.toggle())
  dock.onSpeed((mult) => playback.setSpeed(mult))
  dock.onSeek((ms) => { playback.pause(); playhead = ms; draw() })
  dock.onWindowChange((s, e) => {
    playback.pause()
    win.start = s; win.end = e
    playhead = Math.min(Math.max(playhead, s), e)
    dock.render()
    draw()
  })

  dock.mount(hudHost)
  draw() // initial paint, paused
```

> `win` must be mutable for `onWindowChange`; declare it with `let win = defaultWindow(...)` (shown above as `const win` with mutated fields — either works since we mutate `.start`/`.end`; keep `const win` and mutate fields as written).

`fmt` (the date formatter) and `meta` already exist in `main.ts` above this block and are reused unchanged.

- [ ] **Step 3: Build and run the full test suite**

Run: `npm run build && npm test`
Expected: build PASS (no type errors), all test files PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(globe): schedule-first wiring — open parked on current trip, event-paced playback"
```

---

## Task 14: Live verification

**Files:** none (manual/preview verification)

- [ ] **Step 1: Start the dev server**

Use the preview tooling (`preview_start`) on `npm run dev` (Vite, default port 5173). Sign in with the test account.

- [ ] **Step 2: Verify open state (no autoplay).** Confirm on load:
  - Globe is centered, beacon at your current location, **nothing animating**.
  - The HUD moment chip shows a real date + `trip to XXX` + `PAUSED`.
  - The dock shows trip segments with the current trip glowing, faint upcoming amber segments, dimmed history outside the window, real month/year tick labels (NOT 2019/2021/2023/2025 hardcoded), and `FROM`/`TO` showing real dates.
  - On the globe: current trip solid, upcoming legs faint ghost arcs.
  Capture a `preview_screenshot`.

- [ ] **Step 3: Verify playback is event-paced (no strobe).** Press Play. Confirm each leg draws one at a time with a brief pause between trips; long time-off does not play out (the playhead hops the compressed gap). Adjust the speed slider and confirm it speeds up/slows the per-leg draw. Check `preview_console_logs` for errors.

- [ ] **Step 4: Verify the window controls.** Drag the **left handle** back in time → history fades in on the globe and the window mask shrinks. Drag the **playhead** → arcs reveal/hide to match; playback pauses. Drag the **right handle** in → upcoming trips drop out of the window.

- [ ] **Step 5: Verify mobile.** `preview_resize` to ~380px wide; confirm the dock controls wrap and the timeline is still usable.

- [ ] **Step 6: Final full check**

Run: `npm run build && npm test`
Expected: green. Then capture a final `preview_screenshot` of the running globe for the user.

- [ ] **Step 7: Commit any fixes found during verification**, then stop for user review before merging to `main`.

---

## Self-review notes (author)

- **Spec coverage:** open-parked-on-now (Task 13 + 14·2), event-paced leg+dwell (Tasks 6/7/13), ghost arcs (Task 8/13), real-date axis + compressed labeled gaps (Tasks 4/5/12), draggable window + speed (Tasks 11/12/13), HUD copy (Task 10/13), edge cases (Task 3 covers no-upcoming / future-only / single / null-trip via `focusTrip`/`defaultWindow`/`groupIntoTrips`). Empty account path in `main.ts` is untouched.
- **`legsUpTo`** in `transform.ts` is now unused by `main.ts` but still exported and tested — leave it (harmless, covered) unless the executor wants a follow-up cleanup.
- **Type consistency:** `Window`, `Trip`, `TimeAxis`, `PlaybackSchedule`, `Playback`/`PlaybackController`, `arcPaint`/`combineArcData`, `setArcs(globe, solid, ghost)`, `flyLeg(leg, durationMs?)`, `setMoment(dateLabel, tripLabel, state)` are used identically across tasks.
- **Open refinement to confirm with user at first live review:** the dock shows the full career dimmed outside the window (so handles have a domain). If the user wants the timeline itself to show *only* the window, that's a small change to `domainStart/domainEnd` in `createTimelineDock` (set them to `windowStart/windowEnd`) — but then the handles need a different affordance.
- **`onFly` speed line in Task 13 is intentionally simple** (fixed-ish duration); refine during live tuning if the leg-draw looks out of sync with the slider — the beacon draw duration should track `baseLegMs / speed`. A clean version: pass the effective `legMs` from the controller into `onFly`. Left as a live-tuning item.
