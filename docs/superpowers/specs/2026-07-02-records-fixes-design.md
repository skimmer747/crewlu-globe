# RECORDS Fixes: Same-Airport Shortest Leg + Base-Aware Most Landings — Design

**Date:** 2026-07-02
**Status:** Approved (base rule: "base at the time", per-trip, chosen over current-base-only and inference)

## Problems

1. **SHORTEST LEG** can be won by a same-airport leg (air return / repositioning; real data has 27 such operated legs, e.g. SDF→SDF ×11), displaying a meaningless "SDF → SDF · 0 NM".
2. **MOST LANDINGS** trivially crowns the pilot's domicile — a hub pilot's base wins by construction, hiding the interesting outstation record.

## Rules

1. A leg with `from === to` cannot hold either distance record (SHORTEST or LONGEST LEG — it has no meaningful great-circle distance; in practice only shortest changes, since ~0 NM can never win longest against any real leg). It still counts everywhere else: hours, milestones, most-flown pair, landings.
2. A landing does not count toward MOST LANDINGS when it occurred at **the base of the trip it belongs to** ("base at the time"). Landings at a *future or former* domicile count normally — an ANC-era landing at SDF was an outstation landing. Legs whose trip base is unknown count normally.

## Data plumbing

- The Supabase `trips` table has a `base` text column (values like `SDF`, `ANC`, `SDFZ`, `MIA`). The globe currently fetches only `flights`.
- New fetch in `src/data/flights.ts`: `fetchTripBases(sb)` → `Map<tripId, base>` from `trips.select('id, base')` where `deleted_at is null` (RLS scopes rows to the user). Normalize base: trim, uppercase, first 3 chars (`SDFZ` → `SDF`); drop null/empty.
- `Leg` (src/model.ts) gains `base: string | null` — the normalized base of its trip at the time, `null` when unknown.
- `flightsToLegs(rows, idx, baseByTrip?)` (src/data/transform.ts) sets `leg.base = baseByTrip?.get(row.trip_id ?? '') ?? null`.
- `main.ts` fetches flights and trip bases concurrently (`Promise.all`) and threads the map into `flightsToLegs`. A trips-fetch failure degrades to an empty map (old behavior), never blocks the globe.
- Demo mode (`src/data/demoFlights.ts`): all synthetic trips are SDF-based → demo legs get `base: 'SDF'`, so the demo shows the fixed behavior (MOST LANDINGS becomes an outstation, e.g. ORD/ANC, not SDF).

## recordsFor changes (src/data/career.ts)

- `shortest` scan skips legs with `l.from === l.to`.
- `landings` tally skips a leg when `l.base !== null && l.to === l.base`.
- `longest`, `topPair`, `distinctTails` unchanged. `CareerRecords` shape unchanged.
- Edge cases (all already guarded by `if (r.…)` row rendering in main.ts): every leg same-airport → `shortest: null`; every landing at base → `topAirport: null`.

## UI

Row labels and formats unchanged ("SHORTEST LEG", "MOST LANDINGS").

## Testing (TDD, tests/…)

- `career.test.ts`: same-airport leg with the smallest miles never wins shortest; all-same-airport input → `shortest` null while `longest` survives; landings at a leg's own base excluded; era-change scenario (leg based ANC landing SDF counts; leg based SDF landing SDF doesn't); `base: null` legs count normally; SDFZ-style normalization is upstream so career sees clean 3-char bases.
- `transform.test.ts`: `flightsToLegs` threads `baseByTrip` (hit, miss → null, and no-map → null).
- Demo verification in `?demo=1`: RECORDS panel shows a non-SDF MOST LANDINGS and a real SHORTEST LEG.

## Deploy

Standard pipeline after visual check: merge → `npm run deploy` → Pages build `built` → cache-busted bundle + behavior verify.
