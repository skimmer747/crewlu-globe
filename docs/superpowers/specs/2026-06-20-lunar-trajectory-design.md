# Lunar Return Trajectory — Design Spec

**Date:** 2026-06-20
**Status:** Approved (brainstorm)

## Goal

A NASA-style "lunar return" trajectory the user can toggle on: a glowing dashed line
**extends from Earth, loops around the Moon, and returns**, drawn to a length equal to the
**miles the pilot has flown** in the current timeline window. A telemetry readout reports how
many Earth–Moon round-trips that distance represents.

## Behavior (decided)

- **Approach A — proportional reach.** The drawn length of the trajectory = flown miles, mapped
  onto the Earth→Moon→Earth path (one lap = one lunar round-trip). The line extends and stops
  exactly where the mileage runs out, with a small craft marker at the leading edge. For more
  than one round-trip it retraces the loop and a **lap counter** ticks (×1, ×2 …) with the
  remainder drawn as the partial leg.
- **Miles source:** the **windowed** miles — the same `statsFor(...).miles` already shown in the
  HUD rail — so it tracks the timeline window/playhead.
- **Round-trip distance:** Earth–Moon one-way ≈ 207,560 nm → "to the Moon and back" ≈
  **415,119 nm** (`LUNAR_RETURN_NM`). Current sample: 309,626 nm ≈ 0.75 laps (the line won't quite
  complete one return until the window exceeds ~415k nm).

## Visual / styling

- Trajectory: thin **cyan-white dashed, glowing** free-return curve — Earth's sub-lunar surface
  point → arc out → loop around the Moon's far side → arc back to Earth — with faint tick marks.
- A glowing **craft marker** rides the leading edge during the extend animation.
- **Telemetry panel** (monospace, mission-control): e.g.
  `DISTANCE FLOWN 309,626 NM · EARTH–MOON RETURN 415,119 NM · = 0.75 LUNAR RETURNS`.
- On activate, the camera **eases back to frame Earth + Moon** (the trajectory spans ~60 Earth-radii,
  so it's only legible zoomed out). Toggling off retracts the line and restores the prior view.

## Architecture

### `src/globe/lunarTrajectory.ts` (new)
- `buildTrajectoryPoints(subLunarLatLng, moonLatLng, moonAlt)` → ordered `[lat, lng, alt]` samples
  for the full one-lap path (Earth surface → out to Moon → loop around it → back to Earth surface),
  plus the cumulative path length so a fraction can be sliced precisely.
- `createLunarTrajectory(globe)` → `{ show(fraction, laps), hide(), animateTo(fraction) }`. Renders
  via globe.gl `pathsData` (own path layer, separate from the beacon contrail) with dashed glowing
  styling; reveals points up to `fraction × total` and places the craft marker at the tip.
- Pure helpers (`lunarReturns(miles)`, `buildTrajectoryPoints`, path-length/slice math) are
  unit-tested; the globe.gl rendering + animation is verified live.

### `src/globe/hud.ts` (change)
- Add a NASA-style toggle button and the telemetry readout element; expose
  `onLunarToggle(cb)` and `setLunarReadout(text)`.

### `src/main.ts` (change)
- Compute `miles` (already available via `statsFor`) and `laps = miles / LUNAR_RETURN_NM`.
- On toggle: build the trajectory from the current sub-lunar point + Moon position, animate it to
  `laps` (capped visual at one lap, counter shows the integer part), ease the camera to frame
  Earth+Moon, set the readout. On toggle-off: retract + restore camera.
- Recompute the readout/length when the window/playhead changes while active.

## Data flow

```
button toggle ─▶ miles (windowed) ─▶ laps = miles / LUNAR_RETURN_NM
             ─▶ buildTrajectoryPoints(subLunar, moon) ─▶ animateTo(min(1, fractional lap))
             ─▶ camera eases to frame Earth+Moon ─▶ telemetry readout
```

## Testing

- `tests/lunarTrajectory.test.ts` — `lunarReturns(miles)` math (e.g. 415,119 nm → 1.0; 309,626 → ~0.75);
  `buildTrajectoryPoints` returns an ordered path that starts at the Earth surface (alt≈0), reaches
  the Moon's altitude near the mid-point, and returns to the surface; cumulative length is monotonic.
- Globe.gl path rendering, the extend animation, marker, and camera framing are verified live.

## Edge cases / tunables

- Miles = 0 (empty window) → no line, readout shows `0.00 LUNAR RETURNS`.
- Laps > 1 → retrace + lap counter (no literal multi-coil spiral in v1).
- Tunables: line color/dash/glow, marker size, animation speed, framing distance, tick spacing.

## Non-goals (v1)

- No literal N-coil spiral for multi-lap (retrace + counter instead).
- No editable round-trip distance / alternate destinations.
