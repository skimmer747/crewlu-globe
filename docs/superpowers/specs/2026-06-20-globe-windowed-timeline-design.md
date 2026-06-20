# Flight Globe — windowed, event-paced timeline

Date: 2026-06-20
Status: Approved design, ready for implementation plan
Repo: `skimmer747/crewlu-globe` (globe.crewlu.net)

## Problem

The globe today auto-plays the user's whole career on a **calendar-time axis**. Because
flights clump into busy stretches separated by long time-off, a playhead moving at a
constant rate **strobes** through dense weeks and **crawls** across empty gaps — "several
years in seconds, like strobe lights." The bottom timeline compounds it: the year labels
are hardcoded `2019 / 2021 / 2023 / 2025` and the histogram bins are evenly spaced in
calendar time, so the labels and the motion rarely line up with the real data.

Current behavior lives in:
- `src/globe/scrubber.ts` — maps a `0..1000` range linearly onto `[firstLeg, lastLeg+1d]`,
  auto-plays via `v += dt * 0.07` (full sweep in ~14 s regardless of span), hardcoded year
  labels, equal-bin histogram.
- `src/main.ts` — orchestrates load → draw → `scrubber.start()` (which auto-plays after 1 s).
- `src/data/transform.ts` — `legsUpTo(legs, cutoff)` filters by calendar cutoff.

## Goal

Make the globe **schedule-first, calm, and legible**:

1. **Opens parked on "now."** Refresh lands on the trip you're on plus upcoming trips, sitting
   still. No auto-strobe.
2. **Playback is event-paced, not real-time.** Each leg draws over a fixed beat; a short dwell
   at every trip boundary. A month off and a 12-hour turn both advance one beat — empty time is
   hopped, never played out.
3. **The timeline tells the truth.** Real-date axis with true labels; idle gaps compressed and
   labeled (`3 wks off`); trips drawn as segments that match what's on the globe.
4. **The user controls the view.** A windowed start/end (draggable handles + tappable exact
   date) and a speed slider.

## Decisions (locked with the user)

| Topic | Decision |
|---|---|
| Default view on open | Current trip + **upcoming only**; history hidden until the window is dragged back |
| On-open motion | **Sit still, paused** on the current trip |
| Timeline axis | **Real dates, gaps compressed** (playhead hops the empty time) |
| Gap markers | **Labeled** (`4d off`, `3 wks off`, `2 mo off`) |
| Beat size | **Draw each leg, then dwell at trip boundaries** (reuse the fly-the-leg animation) |
| Upcoming legs | Shown as **faint "ghost" arcs** ahead of the playhead before play |
| Date-range control | **Draggable handles + per-handle date readout you can tap to type** |
| Speed | **Slider** scaling per-leg draw + dwell |

## The model

### Time & "now"
- `now = Date.now()` (real clock).
- A leg is **flown** if `t <= now`, **upcoming** if `t > now` (`t` from
  `scheduled_block_out_time ?? scheduled_take_off_time ?? take_off_time`, already computed in
  `transform.ts:legTime`).
- **Beacon parks** at the arrival airport of the last flown leg ("where you are now"). If there
  are no flown legs, it parks at the departure of the first upcoming leg.
- **Focus trip** = the trip whose span contains `now`; else the next upcoming trip; else the most
  recent past trip.

### Trips
Legs are grouped into trips by `trip_id` (a leg with null `trip_id` becomes a standalone one-leg
trip). A `Trip` carries its ordered legs, `start` (first leg `t`), and `end` (last leg `t`). Trips
are the unit of dwell and the segments drawn on the timeline.

### The window
A window is `[startMs, endMs]`.
- **Default**: `start = min(now, focusTrip.start)`, `end = lastLeg.t`. So you open on current +
  upcoming, and `now` is always inside the window (when you're *off*, the lead-in time-off shows
  as a compressed gap at the left edge — e.g. `5d off` before your next trip).
- The **playhead** is a third position inside the window; default playhead =
  `clamp(now, start, end)` — i.e. `now`, kept on the rails of the invariant `start ≤ playhead ≤ end`.
- Legs **outside** the window are hidden entirely.
- Dragging the **left handle** earlier reveals history (the full career replay, on demand).

### What's drawn on the globe
- **Solid contrails** — legs in `[windowStart, playhead]`.
- **Ghost arcs** (faint) — upcoming legs in `(playhead, windowEnd]`.
- **Hidden** — legs outside the window.
As the playhead advances, ghosts become solid.

### Playback (the strobe fix)
The engine is driven by **leg index, decoupled from the date axis**:

1. Take the window's legs in chronological order.
2. For each leg: animate it drawing across the globe (`beacon.flyLeg`), reveal its arc as solid,
   advance the playhead to that leg's date.
3. At each **trip boundary**, dwell briefly, then **hop** to the next trip's first leg (a quick
   slide across the compressed gap — empty time is never played).
4. Stop at `windowEnd`.

The **speed slider** scales the per-leg draw duration and the dwell. Defaults (1×):
~1.2 s/leg draw, ~0.5 s dwell, ~0.4 s gap-hop; slider range ~0.3×–4×. Play/Pause persists;
scrubbing the playhead or dragging a handle pauses.

> Why this kills strobe: the visible event rate is constant (one leg per beat) regardless of how
> tightly packed the dates are. The playhead's spatial speed on the axis varies, but you always
> see one flight at a time.

### The timeline dock (fixes "doesn't match up")
- **Compressed real-date axis.** Active stretches (periods containing trips) keep a true,
  proportional date scale. Any idle gap longer than a threshold (~2 days, tunable) collapses to a
  fixed small width and shows a duration label (`3 wks off`). The axis exposes
  `dateToX(date)` / `xToDate(x)` (inverse of each other within a segment) so handles and the
  playhead map cleanly both directions.
- **Trip segments** replace the equal-bin histogram: flown trips bright cyan, upcoming trips amber,
  the focus trip emphasized.
- **Two range handles** (start/end), each showing its date; tap a date to type an exact day.
- A **"now" tick**, a **draggable playhead**, and **month/year labels computed from the data**
  (no hardcoded years; tick granularity adapts to the window span — days/weeks/months/years).

### HUD copy
The moment chip stops showing `REPLAYING · 37%`. It shows the current date + trip context
(e.g. `14 Jun · trip to ANC`) and a clear `PAUSED` / `PLAYING` state. (`hud.ts:setMoment`.)

## Components (units & boundaries)

New and changed modules, each with one purpose and a tested interface where it's pure:

| Module | New/Change | Responsibility | Pure / tested |
|---|---|---|---|
| `src/data/trips.ts` | new | `groupIntoTrips(legs): Trip[]`; `Trip` type | pure ✓ |
| `src/data/schedule.ts` | new | `findNow`, `beaconHome(legs, now)`, `focusTrip(trips, now)`, `defaultWindow(legs, trips, now)`, `classify(legs, windowStart, playhead, windowEnd) → { solid, ghost }` | pure ✓ |
| `src/globe/timeAxis.ts` | new | `buildAxis(windowStart, windowEnd, trips, opts) → { dateToX, xToDate, segments, gaps, ticks }` (gap compression + adaptive tick labels) | pure ✓ |
| `src/globe/playback.ts` | new | event-paced engine: leg-by-leg with trip dwell + gap-hop; speed-scaled; callbacks `onRevealLeg`, `onAdvancePlayhead`, `onState`. Injectable clock for tests | mostly pure ✓ |
| `src/globe/timelineDock.ts` | new (replaces `scrubber.ts`) | render dock: trip segments, labeled gaps, two handles + date pills, playhead, speed slider, play/pause, computed labels. Emits `onWindowChange`, `onSeek`, `onPlayToggle`, `onSpeed` | DOM |
| `src/globe/arcsLayer.ts` | change | ghost arcs: accept solid + ghost sets (or a `ghost` flag); ghosts render dimmer/thinner | — |
| `src/globe/beaconLayer.ts` | change | `flyLeg(leg, durationMs?)` to honor speed (currently fixed 820 ms) | — |
| `src/globe/hud.ts` | change | `setMoment(dateLabel, tripLabel, state)` copy | — |
| `src/main.ts` | change | compute now/trips/window → initial draw (solid current + ghost upcoming, beacon parked, **no autoplay**) → wire dock + playback | — |
| `src/styles.css` | change | dock restyle: segments, gap markers + labels, handles, date pills, speed slider | — |

`scrubber.ts` is deleted; its histogram/auto-play logic is superseded.

## Data flow

```
fetchFlights → flightsToLegs (transform.ts)
  → groupIntoTrips (trips.ts)
  → findNow / focusTrip / defaultWindow / beaconHome (schedule.ts)
  → initial draw: classify() → setArcs(solid, ghost); beacon.setAt(home); paused
  → timelineDock.render(axis = buildAxis(window, trips))
        handles → onWindowChange  → rebuild axis, re-classify, redraw, pause
        playhead → onSeek         → re-classify, redraw, pause
        play     → onPlayToggle    → playback engine drives legs → onRevealLeg (setArcs) +
                                      beacon.flyLeg(leg, dur) + onAdvancePlayhead (dock + hud)
        slider   → onSpeed         → engine beat scale
```

## Edge cases
- **No upcoming trips** (all history): focus = last trip; default window = that trip; playhead at
  `windowEnd`; drag back for more.
- **Only future trips** (brand-new pilot): beacon at first upcoming departure; playhead at window
  start; everything ghosted until played.
- **Single trip / single leg**: dwell/hop logic no-ops; engine still completes.
- **Legs with null `trip_id`**: standalone one-leg trips.
- **Undated legs**: already dropped in `transform.ts`.
- **Empty account**: existing empty-state panel in `main.ts` is unchanged.

## Testing
- `trips.ts`: grouping by `trip_id`, null → standalone, ordering, start/end.
- `schedule.ts`: now-classification, focus-trip selection across the three cases, default window
  endpoints, beacon-home selection, solid/ghost split at a given playhead.
- `timeAxis.ts`: `dateToX`/`xToDate` round-trip within segments; gaps over threshold compress to
  fixed width; gap labels (`4d`/`3 wks`/`2 mo`); adaptive tick granularity for short vs multi-year
  windows; monotonic x across segment boundaries.
- `playback.ts`: with an injected clock — legs fire in order, dwell inserted only at trip
  boundaries, gap-hop between trips, speed scales durations, stops at `windowEnd`, pause/resume.

## Non-goals (YAGNI)
- No new Supabase columns or queries (`fetchFlights` is unchanged).
- No per-leg block-hours fix (`statsFor` keeps the `miles/460` proxy).
- No saved/shareable windows, no URL state for the window (could be a later add).
- No change to auth, moon, sun, occlusion, or starfield layers.
