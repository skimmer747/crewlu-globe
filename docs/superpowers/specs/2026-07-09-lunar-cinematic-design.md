# Lunar Return Cinematic — Design

**Date:** 2026-07-09
**Status:** Approved

## Overview

Tapping ◓ LUNAR RETURN currently pulls the camera to a static wide "mission view" and
reveals the dashed free-return trajectory proportional to career miles flown. This
feature replaces the entry into that view with a ~28-second first-person cinematic:
the camera launches from the user's current position, flies the full free-return
trajectory around the Moon — with a real 3D moon close-up, Apollo-style telemetry, a
career-miles progress beacon, and a held earthrise shot — then settles into the
existing mission view. The flight is re-recordable as a shareable 1080p video.

## Decisions (user-approved)

- **Button flow:** tap → full cinematic → settle into today's mission view with the
  dashed trajectory + readout. Tap again exits (unchanged from today).
- **Pacing:** full cinematic, ~25–30 s, with held beats. Tap anywhere to skip.
- **Miles tie-in:** always fly the full loop; pass a pulsing "YOU ARE HERE — N%"
  beacon at the point on the 415,119 NM path that career miles have reached.
- **Extras (all in v1):** Apollo-style telemetry overlay, earthrise held moment,
  Apollo landing-site labels, shareable video export.
- **Progress model (revised 2026-07-09 per user feedback — supersedes "full loop + marker"):**
  the flight is now a *fly-to-your-earned-spot* journey. One full lunar return of mileage
  reaches the Moon; each additional return is one lap around it. The ship flies out along a
  progress path and **parks at exactly `laps` along it — it does not come home.** Below 1.0
  return the ship parks in transit with the Moon a distant glowing goal ahead (no close-up
  yet — that's earned at 1.0). The line draws **bright up to the ship, faint beyond** (miles
  not yet flown). After the flight the ship hands off to the gold "you are here" marker at the
  parked spot (dart↔beacon-style). Multi-return laps coil around the Moon. Demo pilot = 0.22
  returns, so the shipped demo shows the out-and-park-in-transit case.
- **Camera approach (revised same-day per user feedback):** chase cam. First-person
  proved disorienting in practice ("hard to tell where I am") — the shipped design flies
  a dedicated dart instance (`buildDart()` export from dartLayer, added via
  `scene().add()`) along the trajectory, with the camera orbiting it on keyframed
  azimuth/distance/rise beats, always looking at the ship: ahead of it on ascent so
  Earth shrinks behind it, swinging around it at the coast turnaround, tight chase over
  the lunar surface. Director's-cuts remains rejected.

## Shot list (~28 s)

| Beat | Time | Camera | Notes |
|---|---|---|---|
| Ignition | 0–3 s | Dive to launch point, brief hold, launch | Launch point = dart's current position, falling back to home beacon. Trajectory re-anchored to start there. |
| Ascent | 3–9 s | Ride the path, look mostly ahead, Earth shrinking behind | Dashes reveal ahead via `setReveal`. Pass the YOU ARE HERE beacon at the career-miles fraction. |
| Translunar coast | 9–14 s | Speed-ramped, slight drift | Moon grows from dot to disc. Starfield + DOM planets remain as backdrop. |
| Lunar skim | 14–19 s | Decelerate low over the near side along the terminator | 3D moon fills lower frame; Apollo 11/15/17 labels drift past (city-label style). |
| Earthrise | 19–23 s | ~2.5 s hold rounding the far side | Lunar limb foreground, Earth rising with atmosphere glow. Signature shot. |
| Return sprint | 23–27 s | Accelerating fall home, look at Earth | Earth swells to fill frame. |
| Settle | 27–29 s | Blend to the existing mission view | Full trajectory revealed, readout updated, OrbitControls restored. |

- **Skip:** any tap/click during flight fast-forwards (~600 ms ease) to the settle beat.
- **Reduced motion:** `prefers-reduced-motion` bypasses the cinematic entirely —
  current static behavior, untouched.
- **Telemetry:** compact HUD strip in the `.lunartel` style: simulated MET,
  velocity, distance from Earth in NM. Scene→NM conversion: 100 units = Earth
  radius = 3,440 NM.

## Architecture

### New: `src/globe/moonMesh.ts`

A real textured 3D moon shown only while the cinematic (or its recording) runs.

- `THREE.SphereGeometry`, radius 20 (app's `MOON_EARTH_RATIO = 0.2` × globe R 100).
- Centered on the DOM moon's datum: `getCoords(datum.lat, datum.lng, 59.3)` ≈ 6,030
  scene units — well inside `camera().far = 50000`.
- Oriented so the near side faces Earth, north up; selenographic coords then place
  Apollo-site sprite labels correctly.
- Custom Lambert `ShaderMaterial` with a `sunDir` uniform from `subsolarPoint` →
  real phase lighting, immune to scene lights; output clamped so it never blooms
  (UnrealBloomPass is active).
- One new asset: ~2K equirectangular moon color map under `public/textures/`,
  lazy-loaded on first lunar tap (flat-grey fallback until decoded, matching the
  `moon-disc.webp` fallback pattern).
- Added/removed via `globe.scene().add()` / `.remove()` + `dispose()`. Never
  `customThreeObject` — the dart owns that slot.

### New: `src/globe/lunarCinematic.ts`

`createLunarCinematic(globe, deps) → { play(opts): Promise<void>, cancel(), isPlaying() }`

- Suspends OrbitControls (`controls().enabled = false`), drives `globe.camera()`
  directly in a rAF loop; frame dt clamped so hidden-tab freezes jump-cut instead of
  exploding easing.
- Camera path: Catmull-Rom curve through the trajectory's scene-space points, offset
  slightly above/beside the line so the dashes lead ahead in frame.
- Keyframed per-beat: eased arc-length fraction (reusing the trajectory's `cum[]`),
  look-target blending (ahead → moon → Earth), camera `up` kept smoothly
  away-from-Earth to avoid rolls, with slight banking on the sprint home.
- Progress beacon: small pulsing sprite at `cum` fraction = milesFlown / 415,119 NM,
  plus a "YOU ARE HERE — N%" chip as the camera passes. Omitted below 1%.
- Finish/cancel/skip all restore: controls enabled, `maxDistance`, DOM moon
  visibility, occlusion guard flag.

### Touched files

- `main.ts` — lunar toggle: `playback.pause()` → hide DOM moon + set occlusion
  guard → `cinematic.play()` → existing `refreshLunar(true)` mission view → restore
  DOM moon, remove mesh. Toggle-off mid-flight calls `cancel()` and restores saved
  POV exactly as today. Guard flag skips the moon branch of `applyOcclusion` while
  the mesh moon is live.
- `hud.ts` — telemetry strip element + accessors; post-flight "Save mission video"
  chip.
- `lunarTrajectory.ts` — `buildTrajectoryPoints` accepts an optional launch anchor
  (lat/lng) so the path starts at the user's position.
- `tripVideo.ts` — extract the stage-canvas + MediaRecorder core into a reusable
  `recordStage(...)`; trip video and mission video both consume it.

### Video export

After the flight, the chip replays the cinematic while recording: real-time 1080p
capture of the GL canvas (`preserveDrawingBuffer` already on), telemetry + CREWLU
wordmark drawn onto the stage canvas (the DOM HUD is never captured). Save/share
runs off the fresh user tap, per platform requirements.

## Edge cases

- **Zero/low miles:** no progress beacon below 1%; flight otherwise identical.
- **Mid-flight toggle-off:** cancel + full restore.
- **Hidden tab:** dt clamp; flight effectively pauses rather than corrupting easing.
- **Texture not yet loaded:** flight starts anyway; moon is flat-grey-lit until the
  map decodes (it's a dot for the first ~10 s regardless).
- **DOM sky bodies:** sun/planets (at alt 250 ≈ 25,100 units) keep projecting
  correctly during flight; only the DOM moon is swapped out.

## Testing

- Demo mode (`localhost:8798/?demo=1`) as the test bed.
- Verify: full flight timing/beats, skip, mid-flight cancel, settle state equals
  today's mission view, toggle-off restore, reduced-motion bypass, occlusion guard
  (DOM moon never double-renders), no bloom on the moon mesh, video export plays
  and includes telemetry overlay.
- Visual verification via screenshots at each beat (pause-by-fraction debug hook).

## Future ideas (not v1)

- "Mission patch" share card with lunar-return stats (`shareCard.ts` style).
- Ambient Apollo radio audio, muted by default.
- Flag planted on the moon at 100% of a lunar return.
- "Next stop: Mars" teaser past 1.0 returns — natural set piece for the Q4 Wrapped tour.
