# Timeline shuttle-zoom — design

**Date:** 2026-06-22
**Component:** `globe.crewlu.net` timeline dock (`src/globe/timelineDock.ts`, `src/globe/timeAxis.ts`, `src/styles.css`, `src/main.ts`)
**Status:** approved (verbal), pre-implementation

## Problem

The timeline's draggable window is hard to use, especially on a phone. The visible span defaults to ~the current trip, but the underlying data spans ~2 years (252 flights, Aug 2024 → the last leg). Reaching the full span means dragging tiny handles across the whole track. There is no pan or zoom gesture.

## Goal

Turn the two yellow window bars into **spring-loaded shuttle controls** that make zooming the timeline in and out fast and natural, in **all views** (desktop + mobile, mouse + touch).

## Interaction model

The track is **window-fit**: it renders the current `From → To` window stretched across the width, a yellow bar near each end (left = From, right = To). The old dimmed full-history context (window mask over the full domain) is removed — the bars *are* the window edges.

Each bar has two zones relative to its resting (home) position:

- **Outward pull = velocity zoom-out (shuttle).** Left bar dragged left, or right bar dragged right. The edge moves outward at a speed proportional to how far past home the pointer is, **accelerating** (see curve). It runs **live while held** (the track rescales continuously). On release the bar springs back to home and the new (wider) window stays; the date label reflects the new edge.
- **Inward push = positional (direct).** Left bar dragged right, or right bar dragged left. The edge jumps **1:1 to the date under the pointer** at the current scale (no velocity). On release the bar springs back to home and the track rescales to the new (tighter) window.

The bar being held drives only its own edge; the other bar and the playhead keep their dates during the gesture.

### Speed curve (outward velocity)

Accelerating: gentle near home for fine control, ramping up the further the pointer is pushed. Tuned so a **full pull crosses the entire data span (~2 years) in ≈ 2–3 seconds**. Implemented as a pure function `shuttleRate(overshootPx, runwayPx, spanMs)` → ms/second, with a small dead-zone near home and an exponential ramp. Exact constants are tunable.

### Resting positions / runway

Bars rest **inset** from the track ends (e.g. left ≈ 12%, right ≈ 88% of the dock width). The window content renders between them; the outer bands (0–12%, 88–100%) are the **pull runway** for the outward velocity gesture and may carry a faint affordance. The inset gives finger room to express outward displacement on a phone. Percentages are tunable.

## Limits & edge cases

- **Clamp to data bounds:** From cannot shuttle earlier than `domainStart` (first leg); To cannot shuttle later than `domainEnd` (last leg). At a bound, velocity stops.
- **Minimum window:** `MIN_WIN_MS` (≈ 1 day) so the window can't collapse; inward pushes clamp against the *other* edge minus `MIN_WIN_MS`.
- **Playhead:** keeps its true date. If it falls outside the window after a zoom, its marker pins to the nearest edge (clamped visually); its underlying time is unchanged unless the existing `onWindowChange` clamp in `main.ts` moves it. (Decision: keep current `main.ts` clamp behavior — playhead is clamped into the window — to avoid desyncing playback; revisit if it feels wrong.)
- **Multi-touch:** a second pointer during an active shuttle is ignored (single-pointer model).

## Architecture / components

### `src/globe/shuttle.ts` (new) — pure, unit-tested
- `shuttleRate(overshootPx, runwayPx, spanMs, opts?)` → ms/sec (accelerating curve, dead-zone).
- `clampWindow({start, end}, domainStart, domainEnd, minWinMs)` → `{start, end}`.
- (Reuse `axis.xToDate` for positional mapping; no new fn needed there.)

### `src/globe/timeAxis.ts` — unchanged
`buildAxis(start, end, trips)` already clips trips to its range and picks adaptive ticks (weeks ≤ 45d, months ≤ 18mo, years beyond). We simply call it with the **window** instead of the domain.

### `src/globe/timelineDock.ts` — main work
- `render()` builds the axis over `[windowStart, windowEnd]` (window-fit) and lays out pieces/gaps/ticks within the inset content band; **remove the `winmask` elements**; draw the two bars at their home inset positions; pin the playhead marker to the nearest edge if outside.
- Replace `bindDrag` with the shuttle model:
  - `pointerdown` on a bar → record which bar + home x; capture pointer.
  - Each `pointermove`: compute pointer x; if **outside** home → set/refresh a target velocity; if **inside** → set the edge positionally (`xToDate`) and re-render.
  - A `requestAnimationFrame` loop runs while an outward shuttle is active: integrate `windowStart/End` by `rate * dt`, clamp, rebuild axis, re-render. The heavy globe callback (`cbWindow`) is **throttled** (~120 ms) during the loop and fired once on release; the cheap track re-render runs every frame.
  - `pointerup`/`pointercancel`: stop the loop, animate the bar spring-back to home, fire final `cbWindow`.
- Keep the existing public interface (`onWindowChange`, `onSeek`, `onPlayToggle`, `onSpeed`, `setPlayhead`, `render`, `state`). Tapping the track body (not a bar) still seeks the playhead.

### `src/styles.css`
- Remove `.winmask`. Style the two bars as comfortable touch targets (coarse-pointer sizing already added). Optional faint runway affordance on the outer bands.

### `src/main.ts`
- `onWindowChange` stays the authoritative globe update (clamp playhead, pause playback, `draw()`); it just needs to tolerate being called repeatedly (throttled) during a shuttle. No structural change expected.

## Testing

- Unit tests (`tests/shuttle.test.ts`): `shuttleRate` monotonic + dead-zone + ~2–3s full-span target; `clampWindow` bounds and min-window.
- Existing `timeAxis.test.ts` stays green (axis unchanged).
- Mechanics verified in a throwaway harness (sample data spanning ~2 years) via synthetic pointer events + screenshots: outward = velocity zoom-out, inward = positional, spring-back, clamps. **Feel (speed curve) to be tuned on a real device.**

## Out of scope / deferred

- Two-finger pinch (this gesture model replaces the need for it).
- Persisting the last window across reloads.
- Changing the default opening window (still `defaultWindow()`).
