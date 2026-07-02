# RECORDS Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SHORTEST LEG can no longer be a same-airport air return, and MOST LANDINGS excludes landings at the base of the trip they belonged to ("base at the time").

**Architecture:** `recordsFor()` gets two filter rules. The base comes from the Supabase `trips.base` column via a new paginated `fetchTripBases()` (normalized 3-char, `SDFZ`→`SDF`), threaded as `Leg.base` through `flightsToLegs(rows, idx, baseByTrip?)`. Demo mode stamps all its trips `SDF`. Trips-fetch failure degrades to an empty map — old behavior, never blocks the globe.

**Tech Stack:** TypeScript/Vite, vitest, Supabase JS client.

**Spec:** `docs/superpowers/specs/2026-07-02-records-fixes-design.md`
**Repo:** `/Users/toddanderson/Dev/crewlu-globe`, branch `feat/records-fixes` (create from main).

**File map:**
- Modify: `src/model.ts` — `Leg` gains optional `base?: string | null` (Task 1)
- Modify: `src/data/career.ts:17-40` — `recordsFor` rules (Task 1); Test: `tests/career.test.ts`
- Modify: `src/data/transform.ts:27,55-63` — thread `baseByTrip` (Task 2); Test: `tests/transform.test.ts`
- Modify: `src/data/flights.ts` — `normalizeBase` + `fetchTripBases` (Task 3); Test: create `tests/flights.test.ts`
- Modify: `src/main.ts:5,54-56` — fetch + wire + demo stamp (Task 4)

---

### Task 1: recordsFor rules (TDD)

**Files:**
- Modify: `src/model.ts` (Leg interface, ~line 50)
- Modify: `src/data/career.ts`
- Modify: `tests/career.test.ts`

- [ ] **Step 1: Add the optional field to Leg**

In `src/model.ts`, after `tripId: string | null` in `interface Leg`, add:

```ts
  base?: string | null // normalized 3-char base of the leg's trip at the time (null/absent = unknown)
```

(Optional so existing literal `Leg` constructions in tests stay valid; `flightsToLegs` will always set it in Task 2.)

- [ ] **Step 2: Write the failing tests**

In `tests/career.test.ts`, add `base: null,` to the `leg()` factory defaults (before `...o`, i.e. change `tripId: null, ...o,` to `tripId: null, base: null, ...o,`), then append:

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/career.test.ts`
Expected: FAIL — same-airport test gets `shortest.miles = 0`; base test gets `topAirport.iata = 'SDF'` with 3.

- [ ] **Step 4: Implement**

In `src/data/career.ts`, replace the body of `recordsFor` (lines 17–40) with:

```ts
export function recordsFor(legs: Leg[]): CareerRecords {
  const flown = legs.filter((l) => !l.dh)
  if (!flown.length) return { longest: null, shortest: null, topPair: null, topAirport: null, distinctTails: 0 }
  let longest: Leg | null = null, shortest: Leg | null = null
  const pairs = new Map<string, { a: string; b: string; count: number; legIds: string[] }>()
  const landings = new Map<string, number>()
  const tails = new Set<string>()
  for (const l of flown) {
    if (l.from !== l.to) { // same-airport legs have no meaningful great-circle distance
      if (!longest || l.miles > longest.miles) longest = l
      if (!shortest || l.miles < shortest.miles) shortest = l
    }
    const [a, b] = [l.from, l.to].sort()
    const key = `${a}-${b}`
    const p = pairs.get(key) ?? { a, b, count: 0, legIds: [] }
    p.count++; p.legIds.push(l.id)
    pairs.set(key, p)
    // "base at the time": landing at the trip's own base doesn't count toward MOST LANDINGS
    if (l.base == null || l.to !== l.base) landings.set(l.to, (landings.get(l.to) ?? 0) + 1)
    if (l.tail) tails.add(l.tail.trim().toUpperCase())
  }
  let topPair = null as CareerRecords['topPair']
  for (const p of pairs.values()) if (!topPair || p.count > topPair.count) topPair = p
  let topAirport = null as CareerRecords['topAirport']
  for (const [iata, n] of landings) if (!topAirport || n > topAirport.landings) topAirport = { iata, landings: n }
  return { longest, shortest, topPair, topAirport, distinctTails: tails.size }
}
```

- [ ] **Step 5: Run to verify pass, typecheck**

Run: `npx vitest run tests/career.test.ts && npx tsc --noEmit`
Expected: all pass (old + 4 new), tsc clean. (The pre-existing first test's expectations still hold: its `topAirport` legs all have `base: null` from the factory default.)

- [ ] **Step 6: Commit**

```bash
git add src/model.ts src/data/career.ts tests/career.test.ts
git commit -m "fix(records): same-airport legs can't hold distance records; landings at trip base excluded"
```

---

### Task 2: Thread baseByTrip through flightsToLegs (TDD)

**Files:**
- Modify: `src/data/transform.ts`
- Modify: `tests/transform.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/transform.test.ts` (it already has the `row()` factory and `idx`):

```ts
describe('flightsToLegs baseByTrip', () => {
  it('stamps each leg with its trip base; missing entries and absent map -> null', () => {
    const rows = [
      row({ id: 'a', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-11', trip_id: 'T1' }),
      row({ id: 'b', departure: 'ANC', arrival: 'SDF', scheduled_block_out_time: '2024-02-12', trip_id: 'T2' }),
      row({ id: 'c', departure: 'SDF', arrival: 'ANC', scheduled_block_out_time: '2024-02-13', trip_id: null }),
    ]
    const bases = new Map([['T1', 'ANC']])
    const { legs } = flightsToLegs(rows, idx, bases)
    expect(legs.map((l) => l.base)).toEqual(['ANC', null, null])
    const { legs: plain } = flightsToLegs(rows, idx)
    expect(plain.map((l) => l.base)).toEqual([null, null, null])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/transform.test.ts`
Expected: FAIL — `flightsToLegs` takes 2 args / `base` is `undefined`, not `null`.

- [ ] **Step 3: Implement**

In `src/data/transform.ts`:
- Change the signature (line 27) to:
  ```ts
  export function flightsToLegs(rows: FlightRow[], airports: AirportIndex, baseByTrip?: Map<string, string>): { legs: Leg[]; dropped: number } {
  ```
- In the `legs.push({ ... })` literal, after `tripId: r.trip_id,` add:
  ```ts
      base: (r.trip_id != null ? baseByTrip?.get(r.trip_id) : undefined) ?? null,
  ```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/transform.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/data/transform.ts tests/transform.test.ts
git commit -m "feat(transform): stamp legs with their trip's base via optional baseByTrip map"
```

---

### Task 3: fetchTripBases + normalizeBase (TDD)

**Files:**
- Modify: `src/data/flights.ts`
- Create: `tests/flights.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/flights.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeBase } from '../src/data/flights'

describe('normalizeBase', () => {
  it('normalizes to a 3-char uppercase code (SDFZ -> SDF)', () => {
    expect(normalizeBase('SDFZ')).toBe('SDF')
    expect(normalizeBase(' sdf ')).toBe('SDF')
    expect(normalizeBase('ANC')).toBe('ANC')
  })
  it('returns null for empty/absent', () => {
    expect(normalizeBase(null)).toBe(null)
    expect(normalizeBase(undefined)).toBe(null)
    expect(normalizeBase('  ')).toBe(null)
  })
})
```

(Safe to import: `src/data/flights.ts` only `import type`s the Supabase client, which is erased at runtime.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/flights.test.ts`
Expected: FAIL — `normalizeBase` is not exported.

- [ ] **Step 3: Implement**

Append to `src/data/flights.ts`:

```ts
/** Normalized 3-char base code ('SDFZ' -> 'SDF'); null for empty/absent values. */
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/flights.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/data/flights.ts tests/flights.test.ts
git commit -m "feat(data): fetchTripBases — paginated tripId->base map, normalized 3-char codes"
```

---

### Task 4: Wire into main.ts + demo base stamp

**Files:**
- Modify: `src/main.ts` (line 5 import; lines 54–56 fetch/transform)

- [ ] **Step 1: Extend the import**

Line 5: `import { fetchFlights } from './data/flights'` → `import { fetchFlights, fetchTripBases } from './data/flights'`

- [ ] **Step 2: Fetch bases concurrently and thread them**

Replace (current lines 54–56):

```ts
  const [airports, flights] = await Promise.all([loadAirports(), demo ? Promise.resolve(demoFlights()) : fetchFlights(supabase)])
  app.querySelector('#acquiring')?.remove()
  const { legs, dropped } = flightsToLegs(flights, airports)
```

with:

```ts
  const [airports, flights, baseByTrip] = await Promise.all([
    loadAirports(),
    demo ? Promise.resolve(demoFlights()) : fetchFlights(supabase),
    // base-at-the-time map for RECORDS; failure degrades to no exclusion, never blocks the globe
    demo ? Promise.resolve(new Map<string, string>())
         : fetchTripBases(supabase).catch((e) => { console.warn('trip bases unavailable', e); return new Map<string, string>() }),
  ])
  app.querySelector('#acquiring')?.remove()
  if (demo) for (const f of flights) if (f.trip_id) baseByTrip.set(f.trip_id, 'SDF') // demo line is SDF-based
  const { legs, dropped } = flightsToLegs(flights, airports, baseByTrip)
```

- [ ] **Step 3: Full gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean, all tests pass (120+ incl. the 7 new), build ok.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(records): wire trip-base map into leg transform; demo trips stamped SDF"
```

---

### Task 5: Demo verification + deploy

**Files:** none (verification + release)

- [ ] **Step 1: Verify in the demo app**

`preview_start name:globe` → `http://localhost:8798/?demo=1` → click `#recordsBtn` → snapshot the records panel. Expect: MOST LANDINGS is NOT SDF (demo landings at SDF are all at-base now); SHORTEST LEG shows a real pair (demo has no same-airport legs, so it's unchanged there); LONGEST/pair/tails rows unchanged.

- [ ] **Step 2: Merge and deploy**

```bash
git checkout main && git merge --ff-only feat/records-fixes && git branch -d feat/records-fixes
git push origin main
npm run deploy
```

- [ ] **Step 3: Cache-safe live verify**

Wait for `gh api repos/skimmer747/crewlu-globe/pages/builds/latest --jq .status` = `built`, then with `CB=$RANDOM`:

```bash
curl -s "https://globe.crewlu.net/?cb=$CB" | grep -o 'assets/index-[^"]*\.js'      # new hash, matches local dist/index.html
curl -s "https://globe.crewlu.net/<bundle>?cb=$CB" | grep -c 'trip bases unavailable'  # 1 — new code marker
```
