# Lunar Return Cinematic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping ◓ LUNAR RETURN flies a ~28 s first-person cinematic along the free-return trajectory — launch from the pilot's position, close-up 3D moon skim with Apollo-site labels, earthrise hold, sprint home — then settles into the existing mission view; re-recordable as a shareable 1080p video.

**Architecture:** Two new modules (`moonMesh.ts` — a lit, textured 3D moon added via `scene().add()`; `lunarCinematic.ts` — a rAF camera flight along a Catmull-Rom fit of the trajectory with keyframed "beats"), plus an anchored-launch option in `lunarTrajectory.ts`, a `recordCanvas` extraction in `tripVideo.ts`, small HUD additions, and rewired toggle logic in `main.ts`. Spec: `docs/superpowers/specs/2026-07-09-lunar-cinematic-design.md`.

**Tech Stack:** TypeScript, globe.gl / three.js (r184), Vite, vitest. Globe radius = 100 scene units; 100 units = 3,440 NM. The `customThreeObject` slot is owned by dartLayer — all new 3D objects go through `globe.scene().add()`.

---

### Task 1: Moon texture asset

**Files:**
- Create: `public/textures/moon-color-2k.jpg`

- [ ] **Step 1: Download the Solar System Scope 2K moon color map** (CC-BY-4.0 — the HUD tip at `src/globe/hud.ts:232` already credits "EARTH & MOON IMAGERY · SOLARSYSTEMSCOPE.COM · CC-BY-4.0", so attribution is covered)

```bash
cd /Users/toddanderson/Dev/crewlu-globe
curl -L -o public/textures/moon-color-2k.jpg https://www.solarsystemscope.com/textures/download/2k_moon.jpg
```

Expected: a JPEG ~500 KB–1.5 MB. Verify with `file public/textures/moon-color-2k.jpg` → "JPEG image data … 2048x1024". If the download fails (offline/blocked), continue — the moon shader has a flat-grey fallback — and note it for the user.

- [ ] **Step 2: Commit**

```bash
git add public/textures/moon-color-2k.jpg
git commit -m "Add 2K moon color map (Solar System Scope, CC-BY-4.0)"
```

---

### Task 2: Anchored launch + progress marker in lunarTrajectory

**Files:**
- Modify: `src/globe/lunarTrajectory.ts`
- Test: `tests/lunarTrajectory.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildTrajectoryPoints, pointAtFraction } from '../src/globe/lunarTrajectory'
import type { GeoPoint } from '../src/globe/lunarTrajectory'

const R = 100
const rOf = (p: GeoPoint) => R * (1 + p.alt)

describe('buildTrajectoryPoints with a launch anchor', () => {
  const moon = { lat: 12, lng: -140, alt: 59.3 }
  const cam = { x: 0, y: 0, z: 100 }
  const start = { lat: 38.17, lng: -85.74 } // SDF

  it('starts exactly at the pad and returns near it', () => {
    const t = buildTrajectoryPoints(moon.lat, moon.lng, moon.alt, { cam, start })
    expect(t.points[0].lat).toBeCloseTo(start.lat, 1)
    expect(t.points[0].lng).toBeCloseTo(start.lng, 1)
    const end = t.points[t.points.length - 1]
    expect(Math.abs(end.lat - start.lat)).toBeLessThan(12)
    expect(Math.abs(rOf(end) - R)).toBeLessThan(0.5)
  })

  it('never dips inside the Earth, even from an antipodal pad', () => {
    const away = { lat: -12, lng: 40 } // opposite side of Earth from the Moon
    const t = buildTrajectoryPoints(moon.lat, moon.lng, moon.alt, { cam, start: away })
    for (const p of t.points) expect(rOf(p)).toBeGreaterThanOrEqual(R - 1e-6)
  })

  it('still reaches and loops the Moon', () => {
    const t = buildTrajectoryPoints(moon.lat, moon.lng, moon.alt, { cam, start })
    const maxR = Math.max(...t.points.map(rOf))
    expect(maxR).toBeGreaterThan(6000)
    for (let i = 1; i < t.cum.length; i++) expect(t.cum[i]).toBeGreaterThanOrEqual(t.cum[i - 1])
  })

  it('unanchored path is unchanged (starts on the surface near the moonward point)', () => {
    const t = buildTrajectoryPoints(moon.lat, moon.lng, moon.alt, { cam })
    expect(Math.abs(rOf(t.points[0]) - R)).toBeLessThan(0.5)
  })
})

describe('pointAtFraction', () => {
  const t = buildTrajectoryPoints(10, -120, 59.3, { cam: { x: 0, y: 0, z: 100 }, start: { lat: 38, lng: -85 } })
  it('interpolates endpoints and interior', () => {
    expect(pointAtFraction(t, 0).lat).toBeCloseTo(t.points[0].lat, 5)
    expect(pointAtFraction(t, 1).alt).toBeCloseTo(t.points[t.points.length - 1].alt, 5)
    expect(rOf(pointAtFraction(t, 0.5))).toBeGreaterThan(1000) // mid-path is deep space
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/toddanderson/Dev/crewlu-globe && npx vitest run tests/lunarTrajectory.test.ts`
Expected: FAIL — `start` is not in `TrajectoryOpts` (TS error) and `pointAtFraction` is not exported.

- [ ] **Step 3: Implement**

In `src/globe/lunarTrajectory.ts`:

3a. Extend the opts interface:

```ts
export interface TrajectoryOpts { samples?: number; bulge?: number; loopRadius?: number; R?: number; cam?: { x: number; y: number; z: number }; start?: { lat: number; lng: number } }
```

3b. Add two helpers above `buildTrajectoryPoints` (next to the other V3 helpers):

```ts
function slerpV(a: V3, b: V3, f: number): V3 {
  const d = Math.max(-1, Math.min(1, dot(a, b)))
  const th = Math.acos(d)
  if (th < 1e-6) return a
  const s = Math.sin(th)
  return add(scale(a, Math.sin((1 - f) * th) / s), scale(b, Math.sin(f * th) / s))
}

// Launch/entry arc between a surface point and a deep-space point: the direction turns early
// (f^0.6) while the radius climbs late (f^1.6), so the path can start anywhere on Earth — even
// facing away from the Moon — and arcs over the horizon without ever entering the sphere
// (radius is monotonic and never below the surface, unlike a straight chord).
function sweep(surf: V3, deep: V3, f: number): V3 {
  const dir = slerpV(norm(surf), norm(deep), Math.pow(f, 0.6))
  const r = mag(surf) + (mag(deep) - mag(surf)) * Math.pow(f, 1.6)
  return scale(dir, r)
}
```

3c. In `buildTrajectoryPoints`, replace the `Estart`/`Eend` lines and the out/return sampling loops:

```ts
  const sideA = add(M, scale(w, -loopRadius))             // out-leg reaches the Moon on this side
  const sideB = add(M, scale(w, loopRadius))             // return-leg departs from the other side
  const anchored = !!opts.start
  const Estart = anchored
    ? (() => { const c = geoToCartesian(opts.start!.lat, opts.start!.lng, 0, R); return [c.x, c.y, c.z] as V3 })()
    : scale(norm(add(u, scale(w, -0.03))), R)  // Earth surface, biased toward side A
  // Anchored missions come home just beside the pad (nudged along w) so out/return don't overlap.
  const Eend = anchored
    ? scale(norm(add(norm(Estart), scale(w, 0.06))), R)
    : scale(norm(add(u, scale(w, 0.03))), R)

  const No = Math.floor(N * 0.4), Nl = Math.floor(N * 0.2)
  const pts: V3[] = []
  for (let i = 0; i < No; i++) pts.push(anchored ? sweep(Estart, sideA, i / No) : lerp(Estart, sideA, i / No))
  for (let i = 0; i <= Nl; i++) { const a = -Math.PI / 2 + Math.PI * (i / Nl); pts.push(add(M, add(scale(u, loopRadius * Math.cos(a)), scale(w, loopRadius * Math.sin(a))))) } // around the far side, A -> B
  const Nr = N - pts.length
  for (let i = 1; i <= Nr; i++) pts.push(anchored ? sweep(Eend, sideB, 1 - i / Nr) : lerp(sideB, Eend, i / Nr))
```

3d. Add the exported pure interpolator (below `sliceTrajectory`):

```ts
/** Geo point at a fraction [0..1] of the path's length. */
export function pointAtFraction(t: Trajectory, fraction: number): GeoPoint {
  const f = Math.max(0, Math.min(1, fraction))
  const target = f * t.length
  let i = 1
  while (i < t.cum.length && t.cum[i] < target) i++
  if (i >= t.points.length) return t.points[t.points.length - 1]
  const a = t.points[i - 1], b = t.points[i]
  const seg = t.cum[i] - t.cum[i - 1] || 1
  const k = (target - t.cum[i - 1]) / seg
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k, alt: a.alt + (b.alt - a.alt) * k }
}
```

3e. Add the marker to the renderer. Extend the interface:

```ts
export interface LunarTrajectory {
  setPath(t: Trajectory): void
  setReveal(fraction: number): void // 0..1 of the path length
  setMarker(fraction: number | null): void // "YOU ARE HERE" glow on the path; null hides it
  tick(nowMs: number): void // pulses the marker; no-op when hidden
  hide(): void
}
```

In `createLunarTrajectory`, add before the `return`:

```ts
  let marker: THREE.Sprite | null = null
  const MARKER_SIZE = 60
  const markerTexture = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30)
    g.addColorStop(0, 'rgba(255,215,120,1)'); g.addColorStop(0.35, 'rgba(255,215,120,0.55)'); g.addColorStop(1, 'rgba(255,215,120,0)')
    x.fillStyle = g; x.fillRect(0, 0, 64, 64)
    return new THREE.CanvasTexture(c)
  })()
  const removeMarker = () => {
    if (marker) { globe.scene().remove(marker); (marker.material as THREE.SpriteMaterial).dispose(); marker = null }
  }
```

and in the returned object:

```ts
    setMarker(fraction) {
      if (fraction == null || !traj) { removeMarker(); return }
      if (!marker) {
        marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture, transparent: true, depthWrite: false }))
        globe.scene().add(marker)
      }
      const p = pointAtFraction(traj, fraction)
      const c = globe.getCoords(p.lat, p.lng, p.alt)
      marker.position.set(c.x, c.y, c.z)
      marker.scale.set(MARKER_SIZE, MARKER_SIZE, 1)
    },
    tick(nowMs) {
      if (!marker) return
      const k = 1 + 0.18 * Math.sin(nowMs / 260)
      marker.scale.set(MARKER_SIZE * k, MARKER_SIZE * k, 1)
    },
```

and make `hide()` also call `removeMarker()`:

```ts
    hide() { removeLine(); removeMarker() },
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lunarTrajectory.test.ts`
Expected: PASS (5 tests). Also run the full suite: `npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/globe/lunarTrajectory.ts tests/lunarTrajectory.test.ts
git commit -m "lunarTrajectory: anchored launch arc + YOU-ARE-HERE marker"
```

---

### Task 3: 3D moon (`moonMesh.ts`)

**Files:**
- Create: `src/globe/moonMesh.ts`

No unit test — it's all three.js scene plumbing; verified visually in Task 9.

- [ ] **Step 1: Create the module**

```ts
import * as THREE from 'three'
import { subsolarPoint } from '../astro/sun'
import { geoToCartesian } from './occlusion'

// Real 3D moon, shown only while the lunar cinematic flies (the everyday Moon stays the DOM
// overlay in moonLayer). Radius matches the app's visual language: MOON_EARTH_RATIO (0.2) ×
// globe radius (100). Added via scene().add() — never customThreeObject (the dart owns it).
const MOON_R = 20

const SITES = [
  { name: 'APOLLO 11', lat: 0.674, lng: 23.473 },
  { name: 'APOLLO 15', lat: 26.132, lng: 3.634 },
  { name: 'APOLLO 17', lat: 20.191, lng: 30.772 },
]

export interface MoonMesh {
  center: THREE.Vector3
  radius: number
  show(center: { x: number; y: number; z: number }, date: Date): void
  hide(): void
  setLabelOpacity(o: number): void
}

export function createMoonMesh(globe: any): MoonMesh {
  const group = new THREE.Group()
  let added = false
  let texRequested = false

  const uniforms = {
    map: { value: new THREE.Texture() },
    hasMap: { value: 0 },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
  }
  // Lambert with a hard cap: 0.05 earthshine floor so the night side never goes black; the
  // 0.85 diffuse ceiling keeps every pixel under the bloom threshold (0.95) — terrain must
  // never bloom.
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vN; varying vec2 vUv;
void main() { vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float hasMap; uniform vec3 sunDir;
varying vec3 vN; varying vec2 vUv;
void main() {
  vec3 base = hasMap > 0.5 ? texture2D(map, vUv).rgb : vec3(0.62, 0.63, 0.66);
  float diff = max(dot(normalize(vN), normalize(sunDir)), 0.0);
  gl_FragColor = vec4(base * (0.05 + 0.85 * diff), 1.0);
}`,
  })
  group.add(new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 96, 48), mat))

  // Apollo-site labels: canvas-text sprites parented to the group (sprites billboard on their
  // own). Selenographic → local: +X faces Earth (three's sphere UV puts the texture center on
  // +X), +Y is lunar north, and east runs toward -Z.
  const labelSprites: THREE.Sprite[] = []
  for (const s of SITES) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96
    const x = c.getContext('2d')!
    x.font = '700 40px ui-monospace, Menlo, monospace'
    x.textBaseline = 'middle'
    x.shadowColor = 'rgba(47,214,255,0.9)'; x.shadowBlur = 14
    x.fillStyle = '#dff4ff'
    x.fillText(`· ${s.name}`, 18, 48)
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false }))
    const la = (s.lat * Math.PI) / 180, lo = (s.lng * Math.PI) / 180
    const r = MOON_R * 1.1
    spr.position.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo))
    spr.scale.set(13, 2.4, 1)
    group.add(spr)
    labelSprites.push(spr)
  }

  const center = new THREE.Vector3()

  return {
    center,
    radius: MOON_R,
    show(c, date) {
      center.set(c.x, c.y, c.z)
      group.position.copy(center)
      // Near side faces Earth: rotate local +X onto the Earth direction, +Y ≈ north.
      const toEarth = center.clone().negate().normalize()
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toEarth).normalize()
      const up = new THREE.Vector3().crossVectors(toEarth, right).normalize()
      group.setRotationFromMatrix(new THREE.Matrix4().makeBasis(toEarth, up, new THREE.Vector3().crossVectors(toEarth, up)))
      // Correct phase lighting: the sun direction from the live ephemeris (sun ≈ at infinity,
      // so the Earth-centered direction serves at the Moon too).
      const s = subsolarPoint(date)
      const d = geoToCartesian(s.lat, s.lng, 0, 1)
      uniforms.sunDir.value.set(d.x, d.y, d.z)
      if (!texRequested) {
        texRequested = true
        new THREE.TextureLoader().load(
          '/textures/moon-color-2k.jpg',
          (t: THREE.Texture) => {
            t.colorSpace = THREE.SRGBColorSpace
            t.anisotropy = globe.renderer().capabilities.getMaxAnisotropy()
            uniforms.map.value = t
            uniforms.hasMap.value = 1
          },
          undefined,
          () => console.warn('moon-color-2k.jpg failed to load — flat-grey moon'),
        )
      }
      if (!added) { globe.scene().add(group); added = true }
    },
    hide() { if (added) { globe.scene().remove(group); added = false } },
    setLabelOpacity(o) { for (const spr of labelSprites) (spr.material as THREE.SpriteMaterial).opacity = o },
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/globe/moonMesh.ts
git commit -m "moonMesh: lit 3D moon with Apollo-site labels for the cinematic"
```

---

### Task 4: The flight (`lunarCinematic.ts`)

**Files:**
- Create: `src/globe/lunarCinematic.ts`
- Test: `tests/lunarCinematic.test.ts` (new)

The beat table and time→(u, gaze) mapping are pure — TDD those; the rAF/camera shell is verified visually in Task 9.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { missionStateAt, MISSION_TOTAL_MS, fmtMet } from '../src/globe/lunarCinematic'

describe('missionStateAt', () => {
  it('starts at the pad and ends just short of home', () => {
    expect(missionStateAt(0).u).toBe(0)
    expect(missionStateAt(MISSION_TOTAL_MS).u).toBeCloseTo(0.985, 3)
  })

  it('u is monotonic over the whole flight', () => {
    let prev = -1
    for (let t = 0; t <= MISSION_TOTAL_MS; t += 50) {
      const { u } = missionStateAt(t)
      expect(u).toBeGreaterThanOrEqual(prev)
      prev = u
    }
  })

  it('holds near the Moon for the earthrise beat', () => {
    // 19s–23s of the timeline crawls through the far side (u ≈ 0.499 → 0.505)
    expect(missionStateAt(19000).u).toBeGreaterThan(0.49)
    expect(missionStateAt(23000).u).toBeLessThan(0.51)
  })

  it('gaze weights always sum to 1 and end on Earth', () => {
    for (let t = 0; t <= MISSION_TOTAL_MS; t += 500) {
      const { look } = missionStateAt(t)
      expect(look.ahead + look.moon + look.earth).toBeCloseTo(1, 5)
    }
    expect(missionStateAt(MISSION_TOTAL_MS).look.earth).toBeCloseTo(1, 5)
  })
})

describe('fmtMet', () => {
  it('formats hours as HHH:MM:SS', () => {
    expect(fmtMet(0)).toBe('000:00:00')
    expect(fmtMet(67.2452)).toBe('067:14:42')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/lunarCinematic.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the module**

```ts
import * as THREE from 'three'
import type { Trajectory } from './lunarTrajectory'
import type { MoonMesh } from './moonMesh'

// First-person flight along the lunar free-return path. The camera IS the ship: it rides a
// Catmull-Rom fit of the trajectory with keyframed pacing (beats below), blending its gaze
// between the path ahead, the Moon, and Earth. OrbitControls are suspended for the duration;
// every exit (finish, skip, cancel) restores controls and the camera's up vector.

export interface CineDeps {
  globe: any
  moonMesh: MoonMesh
  onFrame(): void                    // per-frame side effects (occlusion + shader refresh)
  onTelemetry(text: string): void
  onEvent(text: string): void
  setReveal(f: number): void         // trajectory dashes reveal just ahead of the ship
}

export interface CinePlayOpts {
  traj: Trajectory
  moonCenter: { x: number; y: number; z: number }
  milesFraction: number | null       // 0..1 → "YOU ARE HERE" callout as we pass it; null = none
}

export interface LunarCinematic {
  play(opts: CinePlayOpts): Promise<boolean> // resolves false if cancelled
  cancel(): void
  skip(): void
  isPlaying(): boolean
  totalMs: number
}

const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const easeInOutSine = (k: number) => -(Math.cos(Math.PI * k) - 1) / 2
const easeInCubic = (k: number) => k * k * k
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3)

export interface Gaze { ahead: number; moon: number; earth: number }
interface Beat { dur: number; u1: number; ease: (k: number) => number; look1: Gaze }

// u = arc-length fraction of the path. The Moon loop is only ~1.2% of the path's length, so
// time maps to u through beats: skim/earthrise crawl through that sliver while ascent/return
// sprint across the empty two-hundred-thousand-mile legs. Gaze weights must each sum to 1.
const BEATS: Beat[] = [
  { dur: 3000, u1: 0.012, ease: easeInCubic,    look1: { ahead: 1, moon: 0, earth: 0 } },       // ignition
  { dur: 6000, u1: 0.30,  ease: easeInOutCubic, look1: { ahead: 0.85, moon: 0.15, earth: 0 } }, // ascent
  { dur: 5000, u1: 0.462, ease: easeInOutSine,  look1: { ahead: 0.45, moon: 0.55, earth: 0 } }, // translunar coast
  { dur: 5000, u1: 0.499, ease: easeInOutSine,  look1: { ahead: 0.35, moon: 0.65, earth: 0 } }, // lunar skim
  { dur: 4000, u1: 0.505, ease: easeInOutSine,  look1: { ahead: 0, moon: 0.1, earth: 0.9 } },   // earthrise hold
  { dur: 4000, u1: 0.985, ease: easeInOutCubic, look1: { ahead: 0, moon: 0, earth: 1 } },       // return sprint
]
export const MISSION_TOTAL_MS = BEATS.reduce((s, b) => s + b.dur, 0)

/** Pure timeline lookup: elapsed ms → path fraction + gaze weights. Exported for tests. */
export function missionStateAt(elapsedMs: number): { u: number; look: Gaze } {
  const t = Math.max(0, Math.min(MISSION_TOTAL_MS, elapsedMs))
  let acc = 0
  let u0 = 0
  let look0: Gaze = { ahead: 1, moon: 0, earth: 0 }
  for (const b of BEATS) {
    if (t <= acc + b.dur) {
      const k = (t - acc) / b.dur
      const e = b.ease(k)
      return {
        u: u0 + (b.u1 - u0) * e,
        look: {
          ahead: look0.ahead + (b.look1.ahead - look0.ahead) * k,
          moon: look0.moon + (b.look1.moon - look0.moon) * k,
          earth: look0.earth + (b.look1.earth - look0.earth) * k,
        },
      }
    }
    acc += b.dur; u0 = b.u1; look0 = b.look1
  }
  return { u: BEATS[BEATS.length - 1].u1, look: BEATS[BEATS.length - 1].look1 }
}

/** Mission elapsed time, hours → "HHH:MM:SS". Exported for tests. */
export function fmtMet(hours: number): string {
  const s = Math.floor(hours * 3600)
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  return `${String(hh).padStart(3, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

// smoothstep that ramps 0→1 as x falls from `far` to `near`.
const proximity = (far: number, near: number, x: number) => {
  const k = Math.max(0, Math.min(1, (far - x) / (far - near)))
  return k * k * (3 - 2 * k)
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const MET_TOTAL_H = 145.2 // a free-return mission is ~6 days, compressed into the flight
const NM_PER_UNIT = 34.4  // 100 scene units = Earth radius = 3,440 NM
const PATH_NM = 415119

export function createLunarCinematic(deps: CineDeps): LunarCinematic {
  let playing = false
  let cancelled = false
  let raf = 0
  let skipLeftMs = 0
  let resolveRun: ((ok: boolean) => void) | null = null
  let cleanups: (() => void)[] = []

  const stop = (ok: boolean) => {
    cancelAnimationFrame(raf)
    for (const fn of cleanups) fn()
    cleanups = []
    if (playing) {
      playing = false
      deps.globe.controls().enabled = true
      deps.globe.camera().up.set(0, 1, 0) // OrbitControls assumes world-up; a tilted up axis corrupts orbiting
    }
    resolveRun?.(ok)
    resolveRun = null
  }

  const skip = () => { if (playing && skipLeftMs <= 0) skipLeftMs = 600 }

  async function play(o: CinePlayOpts): Promise<boolean> {
    if (playing) return false
    cancelled = false

    const pts = o.traj.points.map((p) => { const c = deps.globe.getCoords(p.lat, p.lng, p.alt); return new THREE.Vector3(c.x, c.y, c.z) })
    const curve = new THREE.CatmullRomCurve3(pts)
    // Default arc-length sampling (200) aliases the tiny moon loop; the earthrise crawl needs
    // sub-loop resolution or the camera stutters through it.
    curve.arcLengthDivisions = 3000
    const M = new THREE.Vector3(o.moonCenter.x, o.moonCenter.y, o.moonCenter.z)

    // Fly to the pad with globe.gl's own tween, then take manual control.
    const pad = o.traj.points[0]
    deps.globe.pointOfView({ lat: pad.lat, lng: pad.lng, altitude: 0.18 }, 1000)
    await wait(1050)
    if (cancelled) return false

    playing = true
    deps.globe.controls().enabled = false

    // Tap anywhere that isn't an interactive HUD element → fast-forward to the end.
    const onTap = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('button, a, .sharepanel, .lunartel, #rail, #moment')) return
      skip()
    }
    window.addEventListener('pointerdown', onTap, true)
    cleanups.push(() => window.removeEventListener('pointerdown', onTap, true))

    // ?cineHold=0.7 freezes the timeline at that fraction (screenshot/debug); release with
    // `__cineGo = true` in the console.
    const holdParam = new URLSearchParams(location.search).get('cineHold')
    const holdMs = holdParam != null ? Math.max(0, Math.min(1, parseFloat(holdParam) || 0)) * MISSION_TOTAL_MS : null

    const cam = deps.globe.camera()
    const startPos = cam.position.clone()
    let elapsed = 0
    let last = performance.now()
    let prevU = 0
    let met = 0
    let vShow = 0
    let saidHere = false

    const run = (now: number) => {
      if (!playing) return
      let dt = Math.min(100, now - last) // hidden-tab clamp: the flight pauses instead of jump-cutting
      last = now
      if (skipLeftMs > 0) {
        dt *= Math.max(1, (MISSION_TOTAL_MS - elapsed) / Math.max(16, skipLeftMs))
        skipLeftMs = Math.max(0, skipLeftMs - dt)
      }
      elapsed += dt
      if (holdMs != null && !(window as any).__cineGo) elapsed = Math.min(elapsed, holdMs)
      elapsed = Math.min(MISSION_TOTAL_MS, elapsed)

      const { u, look } = missionStateAt(elapsed)

      // Position: on the rail, lifted a little — away from Earth on the legs, away from the
      // Moon during the skim so the surface fills the lower frame without clipping.
      const base = curve.getPointAt(u)
      const dM = base.distanceTo(M)
      const wM = proximity(160, 60, dM)
      const pos = base.clone()
        .addScaledVector(base.clone().normalize(), 6 * (1 - wM))
        .addScaledVector(base.clone().sub(M).normalize(), 5 * wM)

      // Gaze: weighted blend of path-ahead / Moon / Earth.
      const ahead = curve.getPointAt(Math.min(1, u + 0.03))
      const target = new THREE.Vector3()
        .addScaledVector(ahead, look.ahead)
        .addScaledVector(M, look.moon) // Earth term is (0,0,0) — nothing to add

      // Up: radial from Earth, handing over to radial-from-Moon up close (prevents the
      // degenerate lookAt when staring at Earth from behind the Moon).
      const up = new THREE.Vector3()
        .addScaledVector(pos.clone().normalize(), 1 - wM)
        .addScaledVector(pos.clone().sub(M).normalize(), wM)
        .normalize()

      // Ease in from wherever the pad tween left us — kills any first-frame snap.
      const blend = easeOutCubic(Math.min(1, elapsed / 800))
      cam.position.copy(startPos.clone().lerp(pos, blend))
      cam.up.copy(up)
      cam.lookAt(target)

      deps.setReveal(Math.min(1, u + 0.04))
      deps.moonMesh.setLabelOpacity(proximity(420, 180, dM))

      // Telemetry: MET runs on the wall clock (it keeps ticking through the earthrise hold);
      // velocity is d(path NM)/d(MET), smoothed for readability.
      met += (dt * MET_TOTAL_H) / MISSION_TOTAL_MS
      const dMetH = (dt * MET_TOTAL_H) / MISSION_TOTAL_MS
      const vKt = Math.abs(u - prevU) * PATH_NM / Math.max(1e-9, dMetH)
      vShow = vShow * 0.85 + vKt * 0.15
      prevU = u
      const distNm = Math.max(0, (pos.length() - 100) * NM_PER_UNIT)
      deps.onTelemetry(`MET T+ ${fmtMet(met)}\nVEL ${Math.round(vShow).toLocaleString()} KT\nEARTH DIST ${Math.round(distNm).toLocaleString()} NM`)

      if (o.milesFraction != null && !saidHere && u >= o.milesFraction) {
        saidHere = true
        deps.onEvent(`YOU ARE HERE · ${Math.round(o.milesFraction * 100)}% OF A LUNAR RETURN`)
      }

      deps.onFrame()

      if (elapsed >= MISSION_TOTAL_MS) { stop(true); return }
      raf = requestAnimationFrame(run)
    }
    raf = requestAnimationFrame(run)
    return new Promise<boolean>((res) => { resolveRun = res })
  }

  return {
    play,
    cancel() { cancelled = true; stop(false) },
    skip,
    isPlaying: () => playing,
    totalMs: MISSION_TOTAL_MS,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lunarCinematic.test.ts`
Expected: PASS. (Note: the module imports `three` at top level but the tested exports are pure — vitest resolves the import fine.)

- [ ] **Step 5: Commit**

```bash
git add src/globe/lunarCinematic.ts tests/lunarCinematic.test.ts
git commit -m "lunarCinematic: keyframed first-person free-return flight"
```

---

### Task 5: Extract `recordCanvas` from tripVideo

**Files:**
- Modify: `src/globe/tripVideo.ts`

Pure refactor — trip video behavior must not change. Existing suite + the Task 9 smoke test cover it.

- [ ] **Step 1: Refactor**

Replace the body of `recordTripVideo` and add `recordCanvas` (keep `pickMime`, `canRecordVideo`, `TripVideoOpts` as-is):

```ts
export interface CanvasRecOpts {
  gl: HTMLCanvasElement
  width: number
  height: number
  fps: number
  totalMs: number
  onStart?: () => void
  // blit() cover-crops the live GL canvas onto the stage; call it (or not) per frame.
  drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, elapsedMs: number, blit: () => void): void
  onProgress?: (pct: number) => void
}

/** Real-time canvas capture: stage canvas + MediaRecorder, one drawFrame per rAF. */
export async function recordCanvas(o: CanvasRecOpts): Promise<Blob> {
  const mime = pickMime()
  if (!mime) throw new Error('MediaRecorder unsupported')

  const stage = document.createElement('canvas'); stage.width = o.width; stage.height = o.height
  const ctx = stage.getContext('2d')!
  const stream = (stage as any).captureStream(o.fps) as MediaStream
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>((res) => { rec.onstop = () => res() })

  const blit = () => {
    const s = Math.max(o.width / o.gl.width, o.height / o.gl.height)
    const dw = o.gl.width * s, dh = o.gl.height * s
    ctx.drawImage(o.gl, (o.width - dw) / 2, (o.height - dh) / 2, dw, dh)
  }

  rec.start()
  o.onStart?.()
  const t0 = performance.now()

  await new Promise<void>((resolve) => {
    const frame = () => {
      const elapsed = performance.now() - t0
      o.drawFrame(ctx, o.width, o.height, elapsed, blit)
      o.onProgress?.(Math.min(0.99, elapsed / o.totalMs))
      if (elapsed >= o.totalMs) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  rec.stop()
  await stopped
  o.onProgress?.(1)
  return new Blob(chunks, { type: mime })
}

export async function recordTripVideo(o: TripVideoOpts): Promise<Blob> {
  const blob = await recordCanvas({
    gl: o.gl, width: o.width, height: o.height, fps: o.fps,
    totalMs: o.flightMs + o.outroMs,
    onStart: o.play,
    drawFrame: (ctx, w, h, elapsed, blit) => {
      if (elapsed < o.flightMs) { blit(); o.drawOverlay?.(ctx, w, h) }
      else o.drawOutro(ctx, w, h)
    },
    onProgress: o.onProgress,
  })
  o.stop()
  return blob
}
```

(The only behavioral delta: `rec.stop()` now precedes `o.stop()` by one microtask — the recorder has already captured the full `totalMs` either way.)

- [ ] **Step 2: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean / all green.

- [ ] **Step 3: Commit**

```bash
git add src/globe/tripVideo.ts
git commit -m "tripVideo: extract reusable recordCanvas core"
```

---

### Task 6: HUD additions

**Files:**
- Modify: `src/globe/hud.ts`

- [ ] **Step 1: Extend the interface** (inside `export interface Hud`, after `setLunarReadout`):

```ts
  onMissionVideo(cb: () => void): void
  setMissionVideoVisible(on: boolean): void
  openSharePanel(): void
```

- [ ] **Step 2: Implement** (in the returned object, after `setLunarReadout`):

```ts
    onMissionVideo(cb) { q('#lunarVideoBtn').addEventListener('click', cb) },
    setMissionVideoVisible(on) { q<HTMLElement>('#lunarVideoBtn').style.display = on ? 'inline-block' : 'none' },
    openSharePanel() { q<HTMLElement>('#sharePanel').style.display = 'block' },
```

- [ ] **Step 3: Add the button to `HUD_HTML`** — replace the line
`<div id="lunarReadout" class="lunartel" style="display:none"></div>` with:

```html
  <div id="lunarReadout" class="lunartel" style="display:none"></div>
  <button id="lunarVideoBtn" class="navbtn" style="display:none;margin-top:8px">⬇ SAVE MISSION VIDEO</button>
```

- [ ] **Step 4: Typecheck, commit**

```bash
npx tsc --noEmit
git add src/globe/hud.ts
git commit -m "hud: mission-video button + openSharePanel accessor"
```

---

### Task 7: `refreshView` on GlobeScene

**Files:**
- Modify: `src/globe/globeScene.ts`

The day/night shader's `globeRotation` uniform only updates on OrbitControls 'change' events; the cinematic moves the camera directly, so it needs a manual sync per frame.

- [ ] **Step 1: Add to the interface:**

```ts
export interface GlobeScene {
  globe: any
  setSun(date: Date): void
  cameraPos(): { x: number; y: number; z: number }
  onCameraChange(cb: () => void): void
  refreshView(): void // re-sync view-dependent shader uniforms after direct camera moves
}
```

- [ ] **Step 2: Add to the returned object** (after `onCameraChange`):

```ts
    refreshView() { const pov = globe.pointOfView(); material.uniforms.globeRotation.value.set(pov.lng, pov.lat); maybeLoadHiRes() },
```

- [ ] **Step 3: Typecheck, commit**

```bash
npx tsc --noEmit
git add src/globe/globeScene.ts
git commit -m "globeScene: refreshView for direct-camera animation paths"
```

---

### Task 8: Wire it all in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Imports** — update these lines:

```ts
import { createLunarTrajectory, buildTrajectoryPoints, lunarReturns, LUNAR_RETURN_NM } from './globe/lunarTrajectory'
import { createMoonMesh } from './globe/moonMesh'
import { createLunarCinematic } from './globe/lunarCinematic'
import { recordTripVideo, recordCanvas, canRecordVideo } from './globe/tripVideo'
```

- [ ] **Step 2: Create the mesh** — after `const lunar = createLunarTrajectory(scene.globe)` (line ~91):

```ts
  const moonMesh = createMoonMesh(scene.globe)
```

- [ ] **Step 3: Occlusion guard** — immediately BEFORE `const applyOcclusion = () => {` add:

```ts
  let missionFlying = false
```

and inside `applyOcclusion`, wrap the two moon lines (`moon.setScale(...)` and `featherBehindEarth(...)`) as:

```ts
    if (missionFlying) {
      moon.el.style.opacity = '0' // the cinematic's 3D moon owns the sky; hide the DOM overlay
    } else {
      moon.el.style.opacity = ''
      moon.setScale(Math.min(10, Math.max(0.02, (MOON_EARTH_RATIO * earthRpx) / 23.8))) // 23.8px = rendered disk radius at scale 1
      featherBehindEarth({ maskEl: moon.scaleEl, boxHalf: 42, scale: moon.scale, lat: moon.datum.lat, lng: moon.datum.lng, alt: moon.datum.alt, cam, globe: scene.globe, viewport })
    }
```

(Keep the existing explanatory comments above the block; opacity — not `display` — because three-globe owns the wrap's `display` for behind-Earth hiding.)

- [ ] **Step 4: Create the cinematic** — after `scene.onCameraChange(applyOcclusion)` (line ~144):

```ts
  let cineTelem = ''
  const cine = createLunarCinematic({
    globe: scene.globe,
    moonMesh,
    onFrame: () => { scene.refreshView(); applyOcclusion() },
    onTelemetry: (t) => { cineTelem = t; hud.setLunarReadout(t) },
    onEvent: (t) => hud.setEvent(t),
    setReveal: (f) => lunar.setReveal(f),
  })
```

- [ ] **Step 5: Marker pulse** — in the main rAF loop (line ~169), after `const nowMs = performance.now()` add:

```ts
    lunar.tick(nowMs)
```

- [ ] **Step 6: Rework `refreshLunar`** (line ~233) — anchor the path at the beacon, reveal the FULL path, park the marker at the earned fraction:

```ts
  // Rebuild the lunar line + readout from the current miles & Moon position (called on toggle and on every timeline change).
  const refreshLunar = (animate: boolean) => {
    if (missionFlying) return // the cinematic owns the line, reveal, and readout while flying
    // Orient the swing to face the lunar-return vantage (camera sits at lat 0, lng moonLng+90).
    // Use that deterministic direction rather than the live camera, which is still mid-fly-in.
    const camDir = geoToCartesian(0, moon.datum.lng + 90, 0, 100)
    lunar.setPath(buildTrajectoryPoints(moon.datum.lat, moon.datum.lng, moon.datum.alt, { cam: camDir, start: { lat: beacon.pos.lat, lng: beacon.pos.lng } }))
    const laps = lunarReturns(currentMiles)
    hud.setLunarReadout(`DISTANCE FLOWN  ${Math.round(currentMiles).toLocaleString()} NM\nEARTH–MOON RETURN  ${LUNAR_RETURN_NM.toLocaleString()} NM\n= ${laps.toFixed(2)} LUNAR RETURNS`)
    // Full mission always drawn; the gold marker shows how far the career miles have reached.
    lunar.setMarker(laps >= 0.01 && laps < 1 ? laps : null)
    cancelAnimationFrame(revealRaf)
    if (!animate) { lunar.setReveal(1); return }
    const t0 = performance.now()
    const step = (ts: number) => { const f = Math.min(1, (ts - t0) / 1600); lunar.setReveal(f); if (f < 1) revealRaf = requestAnimationFrame(step) }
    revealRaf = requestAnimationFrame(step)
  }
```

- [ ] **Step 7: Replace the lunar toggle block** (lines ~648–667, the `let savedMaxDist …` through `})`) with:

```ts
  // Lunar return: tap flies the full free-return mission (launch from the pilot's position →
  // around the Moon → home), then settles into the wide mission view. Reduced-motion keeps
  // the static reveal. Tap again exits, restoring the saved camera.
  let savedMaxDist = 0, savedPov: any = null

  const missionView = (durationMs: number) => {
    scene.globe.pointOfView({ lat: 0, lng: moon.datum.lng + 90, altitude: 62 }, durationMs)
    refreshLunar(true)
  }

  const startMission = async (): Promise<boolean> => {
    missionFlying = true
    const camDir = geoToCartesian(0, moon.datum.lng + 90, 0, 100)
    const traj = buildTrajectoryPoints(moon.datum.lat, moon.datum.lng, moon.datum.alt, { cam: camDir, start: { lat: beacon.pos.lat, lng: beacon.pos.lng } })
    lunar.setPath(traj)
    lunar.setReveal(0)
    const laps = lunarReturns(currentMiles)
    const fraction = laps >= 0.01 && laps < 1 ? laps : null
    lunar.setMarker(fraction)
    const mc = scene.globe.getCoords(moon.datum.lat, moon.datum.lng, moon.datum.alt)
    moonMesh.show(mc, new Date(playhead))
    const ok = await cine.play({ traj, moonCenter: mc, milesFraction: fraction })
    missionFlying = false
    moonMesh.hide()
    applyOcclusion()
    if (!ok || !lunarOn) return false
    missionView(1400)
    return true
  }

  hud.onLunarToggle(async () => {
    if (recording) return
    lunarOn = !lunarOn
    hud.setLunarActive(lunarOn)
    const ctr = scene.globe.controls()
    if (lunarOn) {
      playback.pause()
      savedMaxDist = ctr.maxDistance; savedPov = scene.globe.pointOfView()
      ctr.maxDistance = 9000; ctr.autoRotate = false
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        scene.globe.pointOfView({ lat: 0, lng: moon.datum.lng + 90, altitude: 62 }, 1400)
        refreshLunar(true)
      } else {
        const done = await startMission()
        if (done) hud.setMissionVideoVisible(canRecordVideo())
      }
    } else {
      cine.cancel()
      cancelAnimationFrame(revealRaf)
      lunar.hide()
      hud.setMissionVideoVisible(false)
      ctr.maxDistance = savedMaxDist || 1800
      if (savedPov) scene.globe.pointOfView(savedPov, 1200)
    }
  })

  // Save-mission-video: replay the exact cinematic while recording the GL canvas at 1080p —
  // the DOM HUD never appears in the capture, so telemetry is drawn onto the stage instead.
  hud.onMissionVideo(async () => {
    if (recording || !lunarOn || missionFlying) return
    recording = true
    hud.openSharePanel()
    hud.setShareResult(null)
    const hostW = host.clientWidth, hostH = host.clientHeight
    scene.globe.renderer().setSize(1920, 1080, false)
    scene.globe.postProcessingComposer().setSize(1920, 1080)
    scene.globe.camera().aspect = 16 / 9; scene.globe.camera().updateProjectionMatrix()
    try {
      const blob = await recordCanvas({
        gl: glCanvas(), width: 1920, height: 1080, fps: 30,
        totalMs: 1050 + cine.totalMs + 1600, // pad fly-in + flight + settle into mission view
        onStart: () => { void startMission() },
        drawFrame: (ctx, w, h, _elapsed, blit) => {
          blit()
          ctx.textBaseline = 'alphabetic'
          ctx.font = '700 34px ui-monospace, Menlo, monospace'
          ctx.fillStyle = '#eaf7ff'; ctx.fillText('CREWLU', 64, 92)
          ctx.fillStyle = '#2fd6ff'; ctx.fillText(' · LUNAR RETURN', 64 + ctx.measureText('CREWLU').width, 92)
          ctx.fillStyle = '#9fe6ff'; ctx.font = '600 30px ui-monospace, Menlo, monospace'
          const lines = cineTelem.split('\n')
          lines.forEach((ln, i) => ctx.fillText(ln, 64, h - 64 - (lines.length - 1 - i) * 40))
        },
        onProgress: (p) => hud.setShareProgress(p),
      })
      hud.setShareProgress(0)
      presentTripVideo(blob, `crewlu-lunar-return.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, 'LUNAR RETURN')
    } catch (err) {
      console.error('[share] mission recording failed', err)
      hud.setShareProgress(0)
      const e = document.createElement('div')
      e.style.cssText = 'font:600 10px ui-monospace,Menlo,monospace;letter-spacing:1px;color:#ff9f6f'
      e.textContent = 'Recording failed on this browser (see console).'
      hud.setShareResult(e)
    } finally {
      scene.globe.width(hostW).height(hostH)
      scene.globe.postProcessingComposer().setSize(hostW, hostH)
      scene.globe.camera().aspect = hostW / hostH; scene.globe.camera().updateProjectionMatrix()
      recording = false
    }
  })
```

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean / all green.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts
git commit -m "main: lunar toggle flies the cinematic, mission video export"
```

---

### Task 9: Browser verification + tuning

**Files:** none new — fixes land where the issues are.

Test bed: demo mode at `http://localhost:8798/?demo=1` (dev server: `npm run dev` in the globe repo; port 8798 per `vite.config.ts` — confirm, and use the existing `globe` launch config / preview tooling). If the preview tab is hidden, rAF stalls — inject the known shim via eval before timing-sensitive checks.

- [ ] **Full flight:** tap ◓ LUNAR RETURN. Expect: dive to the demo pilot's position → launch → beacon "YOU ARE HERE" event fires → moon grows → close skim with Apollo labels → earthrise hold with Earth over the limb → sprint home → settle into mission view (full dashed loop + gold marker + readout). Console clean.
- [ ] **Beat screenshots** via `?demo=1&cineHold=<f>`: 0.25 (ascent — Earth shrinking), 0.60 (skim — surface + labels), 0.78 (earthrise — limb + Earth). Verify the moon disc never blooms and its lit side matches the DOM moon's phase before/after.
- [ ] **Skip:** tap the canvas mid-flight → fast-forward (~0.6 s) → mission view intact, controls work.
- [ ] **Cancel:** tap ◓ again mid-flight → flight stops, saved camera restored, DOM moon visible again (opacity restored), no leftover mesh/marker/line, controls + world-up correct (drag-orbit feels normal).
- [ ] **Reduced motion:** `preview_eval` stub `window.matchMedia` to report reduce=true, toggle → static reveal only, now with full line + marker.
- [ ] **Mission video:** after a flight, ⬇ SAVE MISSION VIDEO → progress → inline preview plays, telemetry + wordmark baked in, Save link present. Renderer/aspect restored after.
- [ ] **Trip video regression:** record "LAST TRIP" in demo mode → still works.
- [ ] **Tune** anything that looks off (dash scale vs camera, lift heights, label sizes, telemetry position) — expect a brightness/feel pass. Commit fixes as they land.
- [ ] **Final commit + build:** `npm run build` green.
