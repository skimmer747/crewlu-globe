# Follow the Dart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cinematic playback per `docs/superpowers/specs/2026-07-01-follow-the-dart-design.md` — bloom, dusk city-ignition + ocean glint, living contrail, chase cam, cold-open, golden-hour callouts.

**Architecture:** Pure logic in new `src/globe/contrail.ts` and a `sunElevationDeg` helper in `src/astro/sun.ts` (both unit-tested). Rendering changes contained to `globeScene.ts` (bloom, texture flags) and `dayNightShader.ts` (GLSL). Behavior wiring in `main.ts` (contrail feed, chase cam, cold-open, callouts) with small API additions to `dartLayer.ts` (`geoPos`), `hud.ts` (`setEvent`), `timelineDock.ts` (FOLLOW toggle). Visual tuning via the uncommitted synthetic harness.

**Tech Stack:** three UnrealBloomPass via `globe.postProcessingComposer()` (globe.gl 2.34), GLSL edits, vanilla TS. Branch `feature/follow-the-dart`. No deploy without approval.

---

### Task 1: Pure helpers (TDD) — contrail buffer + sun elevation

**Files:** Create: `src/globe/contrail.ts`, `tests/contrail.test.ts`. Modify: `src/astro/sun.ts`, `tests/moon.test.ts`-style new `tests/sun.test.ts`.

- [x] Failing tests (`tests/contrail.test.ts`): push respects 40ms throttle; buffer caps at 60; alpha ramps 0→0.85 tail→head; decay drops from tail and empties; snapshot shape `{pts: [lat,lng,alt][], colors: string[]}`.
- [x] Failing tests (`tests/sun.test.ts`): elevation ≈ +90 at the subsolar point, ≈ −90 at its antipode, ≈ 0 at 90° away; `crossedHorizon` detects a sign flip and reports direction.
- [x] Implement `contrail.ts`:

```ts
export interface ContrailSnapshot { pts: [number, number, number][]; colors: string[] }
const MAX_PTS = 60
const PUSH_MS = 40
export function createContrail() {
  const pts: [number, number, number][] = []
  let lastPush = -Infinity
  return {
    push(lat: number, lng: number, alt: number, nowMs: number): boolean {
      if (nowMs - lastPush < PUSH_MS) return false
      lastPush = nowMs
      pts.push([lat, lng, alt])
      if (pts.length > MAX_PTS) pts.shift()
      return true
    },
    decay(): boolean { pts.shift(); return pts.length > 0 },
    clear() { pts.length = 0 },
    size() { return pts.length },
    snapshot(): ContrailSnapshot | null {
      if (pts.length < 2) return null
      const n = pts.length
      const colors = pts.map((_, i) => `rgba(150,220,255,${(0.85 * i / (n - 1)).toFixed(3)})`)
      return { pts: pts.slice(), colors }
    },
  }
}
```

- [x] Implement in `sun.ts`:

```ts
import { angularDistance } from './geo'  // add if absent: great-circle angle between two lat/lng, degrees
export function sunElevationDeg(lat: number, lng: number, dateMs: number): number {
  const s = subsolarPoint(new Date(dateMs))
  return 90 - angularDistance([lat, lng], [s.lat, s.lng])
}
```

(`geo.ts` gains `angularDistance` if it only has haversineNm — derive: `deg = haversineNm(a,b) / 60`.)

- [x] `npx vitest run` green; commit.

### Task 2: Bloom + texture flags + shader dusk/glint

**Files:** Modify: `src/globe/globeScene.ts`, `src/globe/dayNightShader.ts`

- [x] globeScene: import UnrealBloomPass; after globe construction add pass (strength 0.7, radius 0.4, threshold 0.55 initial); resize pass in `size()`; set `anisotropy` on both textures via `tex.onUpdate`/load callback or after `renderer()` exists.
- [x] dayNightShader fragment: dusk ignition band + water-masked specular on the day side (exact GLSL in the diff; tune constants in harness).
- [x] tsc + build green; visual tune via harness; commit.

### Task 3: Contrail wiring + dart geoPos

**Files:** Modify: `src/globe/dartLayer.ts` (expose `geoPos()`), `src/globe/beaconLayer.ts` (`pathPointAlt` per-point), `src/main.ts` (feed loop, 25fps write throttle, decay on landing)

- [x] dartLayer: capture `[lat, lng, alt]` of the last tick; `geoPos()` returns it or null when not flying.
- [x] main rAF loop: push dart geoPos into contrail; on snapshot change (>=25fps interval) `globe.pathsData(snap ? [snap] : [])`; when dart stops, decay ~1 point/frame until empty.
- [x] Verify in harness (trail follows, fades, decays); commit.

### Task 4: Chase cam + FOLLOW toggle

**Files:** Modify: `src/globe/timelineDock.ts` (FOLLOW button + onFollow/setFollow), `src/main.ts` (follower state machine), `src/styles.css` (btn active state)

- [x] Dock: `<button class="btn" id="tlFollow">FOLLOW</button>` after play; `onFollow(cb)`, `setFollow(on)` toggles `.on` class.
- [x] main: `follow = true` default; `onFly` when following sets `chase = { leg, t0: performance.now(), dur }` instead of the arrival pointOfView; rAF loop drives `pointOfView({...trail point...}, 0)`; leg end → 800ms handoff to arrival; pause/seek/toggle-off clear `chase`.
- [x] Verify in harness; commit.

### Task 5: Cold-open + golden-hour callouts

**Files:** Modify: `src/main.ts` (loading line, intro sequence, crossing detector), `src/globe/hud.ts` (`setEvent`), `src/styles.css` (loading line, event chip)

- [x] Loading line rendered before `Promise.all`; removed on mount.
- [x] Intro (reduced-motion-gated): dash draw-on config, camera dive 4.5 → 1.7 over 2600ms, restore arc config + `draw()` after 2800ms.
- [x] hud.setEvent(text): top-center chip, 3s fade; callout detector in `onPlayhead` path comparing `sunElevationDeg` sign at successive dart positions, 1.5s wall-clock rate limit, message `SUNRISE/SUNSET · <|lat|>°N/S`.
- [x] Verify in harness; commit.

### Task 6: Gate + harness verification + report

- [x] `npm test` + `npm run build` green; harness sweep (bloom balance day/night, contrail, chase cam on long-haul, cold-open, dusk band, callout fires at terminator crossing); harness deleted; report with evidence; deploy only on approval.
