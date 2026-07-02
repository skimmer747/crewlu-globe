# Gate to Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Actual OOOI times throughout the Flight Globe per `docs/superpowers/specs/2026-07-01-gate-to-gate-design.md` — actual-first leg resolution, logbook block hours with FLEW/RODE split, sched-vs-actual deltas on arc labels + timeline, five-phase position readout, time-based dart envelope.

**Architecture:** All resolution logic concentrates in `src/data/transform.ts` (pure, fully unit-tested); consumers read the enriched `Leg`. Pure helpers exported for testability (`legDeltaLine` in arcsLayer, `envelopeFractions` in dartLayer). DOM/visual changes (HUD sub-lines, timeline underlay, positionAt phases) verified via a temporary uncommitted vite harness.

**Tech Stack:** TypeScript, vitest (TDD), vite, globe.gl/three. Branch `feature/gate-to-gate`. No deploy without user approval (`npm run deploy` = production).

---

### Task 1: Model + fetch columns

**Files:** Modify: `src/model.ts`, `src/data/flights.ts`, `tests/transform.test.ts` (row factory only)

- [ ] **Step 1:** In `src/model.ts` FlightRow, after `scheduled_landing_time`, add:

```ts
  scheduled_block_in_time: string | null
  scheduled_block_time: number | null  // SECONDS (Swift TimeInterval on the writer side)
  block_out_time: string | null
  landing_time: string | null
  block_in_time: string | null
```

Replace the Leg interface time fields with:

```ts
  t: number         // epoch ms for ordering/replay — block-out, actual-first
  takeoff: number   // epoch ms — start of airborne span, actual-first, clamped ≥ t
  landing: number   // epoch ms — end of airborne span (sanity-guarded, estimate as last resort)
  out: number       // block-out (== t)
  in: number        // block-in (falls back to landing)
  blockMs: number   // sane block time for stats
  sched: OoiTimes   // raw scheduled out/off/on/in (ms or null)
  act: OoiTimes     // raw actual out/off/on/in (ms or null)
```

and add above Leg:

```ts
export interface OoiTimes { out: number | null; off: number | null; on: number | null; in: number | null }
```

Extend Stats:

```ts
export interface Stats { miles: number; airports: number; countries: number; hours: number; flewMiles: number; rodeMiles: number; onTimePct: number | null }
```

- [ ] **Step 2:** In `src/data/flights.ts` COLS add `scheduled_block_in_time,scheduled_block_time,block_out_time,landing_time,block_in_time` (keep existing fields).
- [ ] **Step 3:** In `tests/transform.test.ts` row() factory defaults add: `scheduled_block_in_time: null, scheduled_block_time: null, block_out_time: null, landing_time: null, block_in_time: null,`
- [ ] **Step 4:** Run `npx tsc --noEmit` — expect errors ONLY in transform.ts (Leg missing new fields) — that's Task 2's cue. If other files error, fix types there first.
- [ ] **Step 5:** No commit yet (repo won't compile until Task 2; Tasks 1+2 commit together).

### Task 2: Actual-first resolution in transform.ts (TDD)

**Files:** Modify: `src/data/transform.ts`, Test: `tests/transform.test.ts`

- [ ] **Step 1: Write failing tests** (append to describe block):

```ts
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
  it('blockMs hierarchy: sched pair, then scheduled_block_time seconds, then airborne', () => {
    const { legs } = flightsToLegs([
      row({ id: 'sp', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-11T10:00:00Z',
        scheduled_take_off_time: '2024-02-11T10:15:00Z', scheduled_landing_time: '2024-02-11T15:30:00Z',
        scheduled_block_in_time: '2024-02-11T15:42:00Z' }),
      row({ id: 'col', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-12T10:00:00Z',
        scheduled_take_off_time: '2024-02-12T10:15:00Z', scheduled_landing_time: '2024-02-12T15:30:00Z',
        scheduled_block_time: 20520 }),  // 5h42m in SECONDS
      row({ id: 'air', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-13T10:00:00Z',
        scheduled_take_off_time: '2024-02-13T10:15:00Z', scheduled_landing_time: '2024-02-13T15:30:00Z' }),
    ], idx)
    expect(legs.find(l => l.id === 'sp')!.blockMs).toBe(Date.parse('2024-02-11T15:42:00Z') - Date.parse('2024-02-11T10:00:00Z'))
    expect(legs.find(l => l.id === 'col')!.blockMs).toBe(20520 * 1000)
    const air = legs.find(l => l.id === 'air')!
    expect(air.blockMs).toBe(air.landing - air.takeoff)
  })
```

- [ ] **Step 2:** Run `npx vitest run tests/transform.test.ts` — expect the new tests FAIL (fields undefined).
- [ ] **Step 3: Implement.** In `src/data/transform.ts` delete the `legTime` helper and replace the body of the per-row loop's time logic with:

```ts
const ts = (s: string | null | undefined): number | null => {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}
const MAX_BLOCK_MS = 26 * 60 * 60 * 1000
const MAX_TAXI_IN_MS = 3 * 60 * 60 * 1000
```

and inside the loop (after `miles`):

```ts
    const act = { out: ts(r.block_out_time), off: ts(r.take_off_time), on: ts(r.landing_time), in: ts(r.block_in_time) }
    const sched = { out: ts(r.scheduled_block_out_time), off: ts(r.scheduled_take_off_time), on: ts(r.scheduled_landing_time), in: ts(r.scheduled_block_in_time) }
    const t = act.out ?? sched.out ?? act.off ?? sched.off
    if (t == null) { dropped++; continue }
    const takeoff = Math.max(t, act.off ?? sched.off ?? t)
    const landing = [act.on, sched.on].find((c): c is number => c != null && c > takeoff && c - takeoff <= MAX_AIR_MS)
      ?? takeoff + estFlightMs(miles)
    const inMs = [act.in, sched.in].find((c): c is number => c != null && c >= landing && c - landing <= MAX_TAXI_IN_MS)
      ?? landing
    const sane = (x: number | null): x is number => x != null && x > 0 && x <= MAX_BLOCK_MS
    const actBlock = act.in != null && act.out != null ? act.in - act.out : null
    const schedBlock = sched.in != null && sched.out != null ? sched.in - sched.out : null
    const colBlock = r.scheduled_block_time != null && Number.isFinite(r.scheduled_block_time) ? r.scheduled_block_time * 1000 : null
    const blockMs = sane(actBlock) ? actBlock : sane(schedBlock) ? schedBlock : sane(colBlock) ? colBlock : landing - takeoff
```

Leg push gains `out: t, in: inMs, blockMs, sched, act`.

- [ ] **Step 4:** `npx vitest run tests/transform.test.ts` — ALL pass (old tests exercise the scheduled/estimate fallback paths). Then `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "Gate to Gate: actual-first OOOI resolution with sched/act pairs on every leg"`

### Task 3: Logbook stats + layover + lunar (TDD)

**Files:** Modify: `src/data/transform.ts` (statsFor, computeAirportStats), `src/main.ts` (one line), Test: `tests/transform.test.ts`

- [ ] **Step 1: Failing tests:**

```ts
  it('stats: real block hours, FLEW/RODE split, on-time pct', () => {
    const { legs } = flightsToLegs([
      row({ id: 'f1', departure: 'SDF', arrival: 'ANC', block_out_time: '2024-02-11T10:00:00Z',
        take_off_time: '2024-02-11T10:15:00Z', landing_time: '2024-02-11T16:00:00Z',
        block_in_time: '2024-02-11T16:10:00Z', scheduled_block_in_time: '2024-02-11T16:00:00Z' }), // +10m: on-time (A14)
      row({ id: 'dh', departure: 'ANC', arrival: 'PVG', is_dh: true, block_out_time: '2024-02-12T10:00:00Z',
        take_off_time: '2024-02-12T10:15:00Z', landing_time: '2024-02-12T18:00:00Z',
        block_in_time: '2024-02-12T18:08:00Z', scheduled_block_in_time: '2024-02-12T17:30:00Z' }), // +38m: late (but RODE)
    ], idx)
    const s = statsFor(legs, idx)
    expect(s.hours).toBe(Math.round((Date.parse('2024-02-11T16:10:00Z') - Date.parse('2024-02-11T10:00:00Z')) / 3600000)) // flew only
    expect(Math.round(s.flewMiles + s.rodeMiles)).toBe(Math.round(s.miles))
    expect(s.rodeMiles).toBeGreaterThan(0)
    expect(s.onTimePct).toBe(50)
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
```

(import `computeAirportStats` in the test file's transform import.)

- [ ] **Step 2:** `npx vitest run tests/transform.test.ts` — new tests FAIL.
- [ ] **Step 3: Implement.** statsFor:

```ts
export function statsFor(legs: Leg[], airports: AirportIndex): Stats {
  const codes = new Set<string>()
  const countries = new Set<string>()
  let miles = 0, flewMiles = 0, rodeMiles = 0, flewBlockMs = 0, onTime = 0, comparable = 0
  for (const l of legs) {
    codes.add(l.from); codes.add(l.to); miles += l.miles
    const c1 = airports.lookup(l.from)?.country, c2 = airports.lookup(l.to)?.country
    if (c1) countries.add(c1); if (c2) countries.add(c2)
    if (l.dh) rodeMiles += l.miles
    else { flewMiles += l.miles; flewBlockMs += l.blockMs }
    const pair = l.act.in != null && l.sched.in != null ? [l.act.in, l.sched.in]
      : l.act.on != null && l.sched.on != null ? [l.act.on, l.sched.on] : null
    if (pair) { comparable++; if (pair[0] <= pair[1] + 14 * 60000) onTime++ }
  }
  const hours = Math.round(flewBlockMs / 3600000)
  const onTimePct = comparable ? Math.round((onTime / comparable) * 100) : null
  return { miles, airports: codes.size, countries: countries.size, hours, flewMiles, rodeMiles, onTimePct }
}
```

computeAirportStats: change `legs[i + 1].t - leg.landing` → `legs[i + 1].t - leg.in`. In `src/main.ts` draw(): `currentMiles = stats.flewMiles` (was `stats.miles`).

- [ ] **Step 4:** `npx vitest run` — all green; `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit: `git commit -am "Gate to Gate: logbook block hours, FLEW/RODE split, A14 on-time pct, block-to-block layovers, flew-only lunar miles"`

### Task 4: Arc-label delta telemetry (TDD)

**Files:** Modify: `src/globe/arcsLayer.ts`, Test: `tests/arcsLayer.test.ts` (inspect existing tests first; keep them green)

- [ ] **Step 1: Failing test** (append; adapt leg factory to whatever the existing test file uses, adding the new Leg fields):

```ts
  it('legDeltaLine formats OFF/ON deltas and block with sked', () => {
    const leg = { dh: false, blockMs: (7 * 60 + 42) * 60000,
      sched: { out: 0, off: 1000 * 60 * 10, on: null, in: (7 * 60 + 55) * 60000 },
      act: { out: 0, off: 1000 * 60 * 24, on: null, in: null } } as any
    expect(legDeltaLine(leg)).toBe('OFF +0:14 · BLOCK 7+42 (SKED 7+55)')
  })
  it('legDeltaLine empty without comparable pairs', () => {
    const leg = { dh: false, blockMs: 0, sched: { out: null, off: null, on: null, in: null }, act: { out: null, off: null, on: null, in: null } } as any
    expect(legDeltaLine(leg)).toBe('BLOCK 0+00')
  })
```

- [ ] **Step 2:** Run — FAIL (no export).
- [ ] **Step 3: Implement** in arcsLayer.ts:

```ts
const fmtDelta = (ms: number): string => {
  const sign = ms < 0 ? '−' : '+'
  const m = Math.round(Math.abs(ms) / 60000)
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
const fmtBlock = (ms: number): string => {
  const m = Math.round(ms / 60000)
  return `${Math.floor(m / 60)}+${String(m % 60).padStart(2, '0')}`
}
export function legDeltaLine(d: Leg): string {
  const parts: string[] = []
  if (d.act.off != null && d.sched.off != null) parts.push(`OFF ${fmtDelta(d.act.off - d.sched.off)}`)
  if (d.act.on != null && d.sched.on != null) parts.push(`ON ${fmtDelta(d.act.on - d.sched.on)}`)
  let block = `BLOCK ${fmtBlock(d.blockMs)}`
  const schedBlock = d.sched.in != null && d.sched.out != null ? d.sched.in - d.sched.out : null
  if (schedBlock != null && Math.abs(schedBlock - d.blockMs) >= 60000) block += ` (SKED ${fmtBlock(schedBlock)})`
  parts.push(block)
  return parts.join(' · ')
}
```

In `arcLabel`, for non-ghost legs append after the status span:

```ts
      const delta = d.__ghost ? '' : `<br><span style="color:#9fd8c0;font-size:9px;letter-spacing:1px">${legDeltaLine(d)}</span>`
```

and insert `${delta}` before `</div>`.

- [ ] **Step 4:** `npx vitest run` green; `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit: `git commit -am "Gate to Gate: OFF/ON/BLOCK delta telemetry on arc labels"`

### Task 5: Time-based dart envelope (TDD)

**Files:** Modify: `src/globe/dartLayer.ts`, Test: `tests/dartLayer.test.ts` (create)

- [ ] **Step 1: Failing test** (`tests/dartLayer.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { envelopeFractions } from '../src/globe/dartLayer'

describe('envelopeFractions', () => {
  it('long haul: 20min climb is a sliver; short hop clamps', () => {
    const long = envelopeFractions(14 * 3600 * 1000)
    expect(long.growEnd).toBeCloseTo(20 / (14 * 60), 3)
    expect(long.shrinkStart).toBeCloseTo(1 - 30 / (14 * 60), 3)
    const short = envelopeFractions(30 * 60000)
    expect(short.growEnd).toBe(0.45)
    expect(short.shrinkStart).toBe(0.55)
  })
  it('degenerate spans stay sane', () => {
    const f = envelopeFractions(0)
    expect(f.growEnd).toBeLessThanOrEqual(0.45)
    expect(f.shrinkStart).toBeGreaterThanOrEqual(0.55)
  })
})
```

- [ ] **Step 2:** Run — FAIL (no export).
- [ ] **Step 3: Implement** in dartLayer.ts:

```ts
const CLIMB_MS = 20 * 60000, DESCENT_MS = 30 * 60000
export function envelopeFractions(airborneMs: number): { growEnd: number; shrinkStart: number } {
  const g = Math.min(0.45, Math.max(0.05, CLIMB_MS / Math.max(1, airborneMs)))
  const d = Math.min(0.45, Math.max(0.06, DESCENT_MS / Math.max(1, airborneMs)))
  return { growEnd: g, shrinkStart: 1 - d }
}
```

`envelope(p)` → `envelope(p, f: { growEnd: number; shrinkStart: number })` using `f.growEnd`/`f.shrinkStart` in place of the constants (constants GROW_END/SHRINK_START deleted). `flying` gains `frac: envelopeFractions(leg.landing - leg.takeoff)` set in `flyLeg`; `tick()` calls `envelope(p, flying.frac)`. `altAt` becomes a plateau profile:

```ts
  const altAt = (p: number, ang: number, f: { growEnd: number; shrinkStart: number }) => {
    const rise = smooth(Math.min(1, p / f.growEnd))
    const fall = smooth(Math.min(1, (1 - p) / (1 - f.shrinkStart)))
    return SKIM_ALT + Math.min(MAX_BUMP, ang * CLIMB) * Math.min(rise, fall)
  }
```

with `at(p, f)` passing `flying.frac` through (both call sites in `tick`).

- [ ] **Step 4:** `npx vitest run` green; `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit: `git commit -am "Gate to Gate: time-based climb/descent envelope with cruise plateau"`

### Task 6: HUD sub-lines, timeline sked underlay, five-phase positionAt

**Files:** Modify: `src/globe/hud.ts`, `src/globe/timelineDock.ts`, `src/styles.css`, `src/main.ts`

- [ ] **Step 1: HUD.** In HUD_HTML miles chip add `<div class="sl" id="sMilesSub" style="margin-top:3px"></div>` after the NAUTICAL MILES label; hours chip add `<div class="sl" id="sOnTime" style="margin-top:3px"></div>`. In setStats append:

```ts
      q('#sMilesSub').textContent = `FLEW ${Math.round(s.flewMiles).toLocaleString()} · RODE ${Math.round(s.rodeMiles).toLocaleString()}`
      q('#sOnTime').textContent = s.onTimePct != null ? `ON-TIME ARR ${s.onTimePct}%` : ''
```

- [ ] **Step 2: Timeline underlay.** In timelineDock.ts renderTrack, replace the flights map body with:

```ts
    const flights = state.legs.map((l, i) => {
      const next = state.legs[i + 1]
      const a0 = l.takeoff, a1 = Math.min(l.landing, next ? next.t : Infinity)
      if (a1 <= state.windowStart || a0 >= state.windowEnd) return ''
      let sked = ''
      if (l.sched.off != null && l.sched.on != null && l.sched.on > l.sched.off &&
          (Math.abs(l.sched.off - l.takeoff) >= 60000 || Math.abs(l.sched.on - l.landing) >= 60000) &&
          l.sched.on > state.windowStart && l.sched.off < state.windowEnd) {
        sked = seg(a.dateToX(Math.max(l.sched.off, state.windowStart)), a.dateToX(Math.min(l.sched.on, state.windowEnd)), `air sked ${era(l.takeoff)}`)
      }
      return sked + seg(a.dateToX(Math.max(a0, state.windowStart)), a.dateToX(Math.min(a1, state.windowEnd)), `air ${era(l.takeoff)}`)
    }).join('')
```

In styles.css, next to the existing `.seg.air` rules (grep `.seg` first, match the block's formatting) add:

```css
#tlTrack .seg.air.sked { opacity: 0.3; height: 2px; margin-top: 8px; }
```

Adjust height/margin against the real `.seg.air` metrics so the underlay hugs the bottom edge of the actual bar.

- [ ] **Step 3: positionAt phases.** In main.ts replace the two ground returns:

```ts
    if (t < prev.takeoff) return { latlng: prev.s, label: `${prev.from} · TAXI OUT` }
    if (t <= prev.landing) {
      const frac = Math.min(1, Math.max(0, (t - prev.takeoff) / Math.max(1, prev.landing - prev.takeoff)))
      return { latlng: slerp(prev.s, prev.e, frac), label: `${prev.from} → ${prev.to}` }
    }
    if (t <= prev.in) return { latlng: prev.e, label: `${prev.to} · TAXI IN` }
    return { latlng: prev.e, label: prev.to }
```

- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit` — green/clean.
- [ ] **Step 5:** Commit: `git commit -am "Gate to Gate: HUD flew/rode + on-time lines, scheduled-span timeline underlay, taxi phases in position readout"`

### Task 7: Visual verification harness + full gate

**Files:** Temporary (NOT committed): `harness.html`, `src/harness.ts`

- [ ] **Step 1:** Create `src/harness.ts` importing the real pipeline with synthetic FlightRows (bypasses auth/Supabase): a delayed leg (actual 45m late vs sched), a 14h long-haul, a deadhead, and a garbage row (landing before takeoff). Feed through `flightsToLegs` → render globe scene + arcs + HUD + dock exactly as main.ts does (copy the wiring minus `requireSession`/`fetchFlights`). `harness.html` mirrors index.html but loads `/src/harness.ts`.
- [ ] **Step 2:** `npx vite --port 8798` and open `http://localhost:8798/harness.html` via preview tools. Hidden preview tabs pause rAF — drive WebGL manually (`globe.renderer().setSize(...)` + render) per the known gotcha before screenshotting.
- [ ] **Step 3:** Verify: HUD shows real block hours + FLEW/RODE + ON-TIME lines; arc tooltip shows OFF/ON/BLOCK deltas on the delayed leg; timeline shows the dim scheduled underlay offset from the actual bar; scrubbing before takeoff shows "· TAXI OUT", after landing "· TAXI IN"; playback of the long-haul holds a cruise plateau (dart at full size mid-leg, no continuous climb); lunar readout uses flew-only miles. Zero console errors.
- [ ] **Step 4:** Delete harness files. `npm test && npm run build` — both clean. `git status` clean except intended files.
- [ ] **Step 5:** Report to user with evidence; offer deploy (`npm run deploy`) — do NOT run it without approval.

## Self-review notes

- Spec coverage: resolution rules → Task 2; stats/lunar/layover → Task 3; arc labels → Task 4; dart envelope → Task 5; HUD/timeline/positionAt → Task 6; verification → Task 7. `scheduled_block_time` seconds unit encoded in Task 2 test (20520 s = 5h42m).
- Type consistency: `OoiTimes` (Task 1) consumed by Tasks 2–4 field names `out/off/on/in`; `envelopeFractions` return `{growEnd, shrinkStart}` used in Task 5 both test and impl.
- Existing tests: the old "takeoff/landing come from the schedule" test remains valid (rows carry no actuals → scheduled path).
