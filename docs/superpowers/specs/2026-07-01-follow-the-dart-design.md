# Follow the Dart — Cinematic Playback

Date: 2026-07-01
Status: Approved (package 2 of 4; builds on Gate to Gate's actual airborne spans)

## Goal

Turn playback from camera-teleports-to-arrival into a mission replay: real bloom, a living contrail behind the dart, a chase cam riding the leg, cities igniting at dusk, a cold-open title sequence on load, and sunrise/sunset callouts that land where they really happened.

## Constraints (unchanged from prior work)

Single customThreeObject slot (dart owns it) — new 3D via `globe.scene().add()` only; no CSS 3D on the canvas (chase cam is camera-only: `pointOfView` per frame); sky bodies stay DOM overlays; contrail writes go through the existing paths layer with a mandatory ~25fps throttle (known DOM-churn hot path). `prefers-reduced-motion` disables the cold-open animation and the drifting effects; playback-driven camera movement is user-initiated and stays.

## Components

1. **Bloom** (`globeScene.ts`): `globe.postProcessingComposer().addPass(new UnrealBloomPass(vec2(w,h), 0.7, 0.4, 0.55))` after construction; pass resized in the existing `size()` handler. Threshold tuned in the harness so arcs/dart/night-lights bloom but the day-side Earth doesn't blow out (fallback: slightly dim `day.rgb` in the shader). Import from `three/examples/jsm/postprocessing/UnrealBloomPass.js`.
2. **Texture quality flags** (`globeScene.ts`): `anisotropy = renderer.capabilities.getMaxAnisotropy()` on both textures (visual-only; `colorSpace` change tested in harness and kept only if it doesn't shift the tuned look).
3. **Dusk ignition + ocean glint** (`dayNightShader.ts`): night boost `night.rgb *= 1.0 + 1.6 * smoothstep(0.25, 0.0, abs(intensity))` so cities switch on along the terminator (and feed the bloom); water-masked specular (`day.b - day.r` blue test) with a Blinn half-vector against the view axis, added on the day side only.
4. **Contrail** (`src/globe/contrail.ts`, new, pure + unit-tested): ring buffer (~60 points of `[lat, lng, alt]`) with per-point alpha ramp tail→dart (0→0.85), `push()` throttled to ~40ms, `decay()` dropping tail points once the dart lands, `snapshot()` → `{ pts, colors }` for the paths layer. `dartLayer` exposes `geoPos(): [lat, lng, alt] | null` (captured in `tick`). `main.ts` rAF loop feeds it; `globe.pathsData([...])` writes throttled to 25fps; `pathPointAlt` switches to per-point `p[2]`.
5. **Chase cam** (`main.ts` + dock button): FOLLOW toggle (default ON) next to play. While a leg flies, per-frame `pointOfView({...slerp(s, e, clamp01(p − 0.08)), altitude}, 0)` — trailing the dart; altitude eases from 1.2 at the ends to `altForLeg(miles) * 0.55` at cruise via `sin(π·p)`. Leg end → 800ms handoff fly to arrival. Pause/seek/stop null the follower. Toggle OFF restores today's fly-to-arrival.
6. **Cold-open** (`main.ts`): monospace `ACQUIRING TELEMETRY ▌` line (blinking cursor) shown while data loads; when the scene mounts, arcs draw themselves on chronologically (`arcDashLength(1).arcDashGap(2).arcDashInitialGap(1 + order*0.12).arcDashAnimateTime(2200)`) while the camera dives from altitude 4.5 to the beacon at 1.7 over 2600ms, then arc config restores to `configureArcs` values and `draw()` repaints. Skipped entirely under reduced-motion (straight to the normal first paint).
7. **Golden-hour callouts** (`astro/sun.ts` + `hud.ts` + `main.ts`): pure `sunElevationDeg(lat, lng, dateMs)` (90 − angular distance to the subsolar point); during playback, a sign flip between playhead ticks at the dart's position fires `hud.setEvent('SUNRISE · 42°N OVER 040°W')` — a top-center chip that fades after ~3s, rate-limited to one per 1.5s wall-clock. Thanks to Gate to Gate, crossings land at the real times.

## Testing & verification

Vitest for the pure parts: contrail ring buffer (push/throttle/decay/alpha ramp), `sunElevationDeg` (subsolar point → +90°, antipode → −90°, terminator ≈ 0°), crossing detector. tsc + `npm run build` gates. Visual: the same synthetic-rows harness pattern as Gate to Gate (uncommitted) — verify bloom doesn't blow out the day side, contrail trails and decays, chase cam rides a long-haul without judder, cold-open draws arcs, dusk band visible along the terminator. No deploy without approval.

## Out of scope (explicitly)

8K texture swap (asset selection/licensing is the user's call — flags-only for now), the Jumpseat/Wrapped packages, any playback pacing changes.
