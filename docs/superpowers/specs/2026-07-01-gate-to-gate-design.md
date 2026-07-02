# Gate to Gate — Actual OOOI Times Throughout the Flight Globe

Date: 2026-07-01
Status: Approved (package 1 of 4: Gate to Gate → Follow the Dart → Jumpseat Mode → CrewLu Wrapped)

## Goal

Replace every estimated time in the globe with the pilot's actual recorded OOOI times. Today the airborne span is scheduled-times-with-460kt-fallback and BLOCK HOURS is literally `Math.round(miles / 460)`. After this package: replays run on actual out/off/on/in, block hours are logbook-grade, deadhead miles are separated from flown miles, scheduled-vs-actual deltas surface on arc labels and the timeline, and the dart's climb/descent envelope is time-based instead of fixed fractions.

## Data facts (verified against the Duty repo schema + DTOs)

- `flights` columns available: `scheduled_block_out_time, scheduled_take_off_time, scheduled_landing_time, scheduled_block_in_time` and actuals `block_out_time, take_off_time, landing_time, block_in_time` (all timestamptz), plus `scheduled_block_time` (double precision, **seconds** — Swift `TimeInterval` in FlightRow.swift:54/ImportSnapshotStore.swift:14).
- Currently fetched (src/data/flights.ts COLS): scheduled out/off/on + actual `take_off_time` only.
- ~2% of rows carry garbage timestamps; existing guards (MAX_AIR_MS = 20h, landing > takeoff, estFlightMs fallback) must survive.

## Model changes (src/model.ts)

`FlightRow` gains: `block_out_time`, `landing_time`, `block_in_time`, `scheduled_block_in_time` (string | null) and `scheduled_block_time` (number | null).

`Leg` gains (all epoch ms):
- `out: number` — block-out; equals `t` (see resolution). `in: number` — block-in; falls back to `landing`.
- `blockMs: number` — sane block time for stats.
- `sched` and `act`: `{ out: number | null; off: number | null; on: number | null; in: number | null }` — raw parsed pairs for delta display.

`t`/`takeoff`/`landing` keep their names and consumer semantics but become actual-first. `Stats` gains `flewMiles`, `rodeMiles`, `onTimePct: number | null`; `hours` becomes real block hours (flew legs only).

## Resolution rules (src/data/transform.ts, flightsToLegs)

With `ts(s) = finite Date.parse or null`:
- `act = { out: ts(block_out_time), off: ts(take_off_time), on: ts(landing_time), in: ts(block_in_time) }`; `sched` likewise from the scheduled columns.
- `t = act.out ?? sched.out ?? act.off ?? sched.off` (drop row if none — existing behavior).
- `takeoff = max(t, act.off ?? sched.off ?? t)` (clamped so a leg can't take off before block-out; prefers actual).
- `landing`: first of `[act.on, sched.on]` satisfying `(cand > takeoff && cand − takeoff ≤ MAX_AIR_MS)`; else `takeoff + estFlightMs(miles)`.
- `in`: first of `[act.in, sched.in]` satisfying `(cand ≥ landing && cand − landing ≤ 3h)`; else `landing`.
- `out = t`.
- `blockMs`: first sane (`0 < x ≤ 26h`) of: `act.in − act.out` → `sched.in − sched.out` → `scheduled_block_time × 1000` (seconds→ms) → `landing − takeoff`.

## Stats (statsFor)

- `flewMiles`/`rodeMiles` split on `leg.dh`; `miles` stays the total (HUD headline number unchanged in meaning).
- `hours = round(Σ blockMs over !dh legs / 3.6e6)` — replaces the miles/460 proxy.
- `onTimePct`: over legs having both actual and scheduled arrival (prefer in-pair, else on-pair), percent with `actArr ≤ schedArr + 14min` (A14 convention); `null` when no comparable legs.
- `refreshLunar` consumes `stats.flewMiles` (readout already says "DISTANCE FLOWN" — deadhead rides no longer count toward Lunar Return).

## Consumer upgrades

- **HUD (hud.ts)**: under the NAUTICAL MILES chip add a sub-line `FLEW 1,234,567 · RODE 84,210`; under BLOCK HOURS add `ON-TIME ARR 62%` when `onTimePct != null`.
- **Arc labels (arcsLayer.ts arcLabel)**: for non-ghost legs append, when the pairs exist: `OFF +0:14 · ON −0:06` (act−sched, ±h:mm) and `BLOCK 7+42` with `(SKED 7+55)` when scheduled block differs ≥ 1 min. Pilot-style `h+mm` block format. Ghost legs unchanged.
- **Timeline (timelineDock.ts renderTrack)**: under each actual air bar, when `sched.off/sched.on` exist and differ from takeoff/landing by ≥ 60s, draw a dim `seg(..., 'air sked ' + era)` underlay spanning the scheduled airborne span (new `.seg.sked` style in styles.css: low-alpha outline, no fill weight). Emitted before the actual bars so actuals draw on top.
- **positionAt (main.ts)** becomes five-phase using `out`/`in`: before `takeoff` → `"SDF · TAXI OUT"` at departure; airborne (existing); `landing < t ≤ in` → `"ANC · TAXI IN"` at arrival; after → parked (existing label). Before-first-leg unchanged.
- **computeAirportStats**: layover span becomes `next.t − leg.in` (block-in to next block-out) instead of `next.t − leg.landing`.
- **Dart envelope (dartLayer.ts)**: `flyLeg` derives `airborneMs = leg.landing − leg.takeoff`; `growEnd = clamp(20min/airborneMs, 0.05, 0.45)`, `shrinkStart = 1 − clamp(30min/airborneMs, 0.06, 0.45)`; `envelope(p)` uses these per-flight values (constants remain the defaults for degenerate spans). Altitude bump changes from `sin(π·p)` to a plateau: ramp up over the climb fraction, hold cruise, ramp down over the descent fraction (smoothstep edges) — a 14-hour leg cruises level instead of "climbing" for 7 hours. Bank gating via `pres` follows automatically.

## Explicitly unchanged

Playback pacing (wall-clock legMs), trips grouping, windowing/splitAtPlayhead (still keyed on `t`), beacon, arcs geometry, auth, and all sky/astro layers. No new dependencies.

## Testing & verification

- TDD in `tests/transform.test.ts`: actual-first resolution, per-field fallbacks, garbage-actual → scheduled → estimate chain, `blockMs` hierarchy incl. seconds-unit `scheduled_block_time`, taxi clamps (`takeoff ≥ t`, `in ≥ landing`), stats split/hours/onTimePct. Export the dart envelope math as a pure function and unit-test the fraction derivation. Existing tests must keep passing (the schedule-only test rows have no actuals and exercise the fallback path).
- `npm test` (vitest) + `npm run build` (tsc gate).
- Visual: temporary uncommitted harness entry that feeds synthetic FlightRows (delayed leg, long-haul leg, deadhead) through the real pipeline to the globe + dock in `vite` dev; WebGL must be manually sized/rendered because a hidden preview tab pauses rAF.
- Deploy (`npm run deploy` → gh-pages) only on explicit user approval.

## Risks

- `t` becomes actual block-out where present: leg order, windowing, and layover math shift by real minutes — intended, but the monotonic-sort assumption (`legs.sort by t`) still holds since sorting happens after resolution.
- Mixed actual/scheduled rows (actual out but no actual off) are handled by the `takeoff ≥ t` clamp and landing sanity chain.
- `scheduled_block_time` unit confirmed seconds from the writer's Swift type; the 26h sanity guard also rejects any hour-unit surprises.
- The lunar number visibly drops for pilots with deadhead miles — intentional honesty; called out in the release note to the user.
