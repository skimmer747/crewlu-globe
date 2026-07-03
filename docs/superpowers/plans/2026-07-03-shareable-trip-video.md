# Shareable Trip Video — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot static Share card with an interactive panel that lets a pilot pick their last or next trip and share a sharp ~8–20s video of that trip animating on the globe, ending on a stats card for that trip.

**Architecture:** The globe's animation is driven by a real-time render loop (globe.gl's composer) plus wall-clock tweens (`dart.flyLeg`, camera `pointOfView`). Rather than reimplement all of that as a pure clock function (a large refactor), v1 **records the live animation in real time** but forces the renderer's backing store to 1920×1080 so the capture is genuinely high-res. Frames are blitted onto a 16:9 "stage" canvas (`captureStream` + `MediaRecorder`); the last ~2s draws the trip-stats card. On iOS / unsupported browsers we fall back to the existing static image path (now a trip card) so Share never dead-ends. Pure logic (trip resolution, pacing, label, card stats) is extracted into small tested modules; the render/capture/UI pieces are verified in the browser via demo mode (`?demo=1`).

**Tech Stack:** TypeScript, Vite, Vitest, globe.gl 2.34 / three 0.184, `MediaRecorder` + `HTMLCanvasElement.captureStream`.

**Spec:** `docs/superpowers/specs/2026-07-03-shareable-trip-video-design.md`

---

## File structure

| File | Responsibility | New/Modify |
| --- | --- | --- |
| `src/data/shareTrips.ts` | Pure logic: resolve last/next trip, trip label, per-trip playback speed, trip-card stats | **New** |
| `src/data/shareTrips.test.ts` | Unit tests for the above | **New** |
| `src/globe/tripVideo.ts` | Record the live globe into a 16:9 stage canvas → `Blob`; codec detection + feature-detect | **New** |
| `src/globe/shareCard.ts` | Parametrize card size; add `composeTripCard` (trip-stats, 16:9) | Modify |
| `src/globe/hud.ts` | Share panel markup + methods (open/close, trip buttons, progress) | Modify |
| `src/styles.css` | Share panel + progress-bar styles (Night-Ops) | Modify |
| `src/main.ts` | Wire the panel: resolve trips, scope+record the selected trip, share/download, fallback | Modify |

Data facts this plan relies on (already in the codebase):
- `Trip { id, legs, start, end, dest }` from `groupIntoTrips(legs)` (`src/data/trips.ts`), chronological.
- `Leg { id, from, to, s, e, t, takeoff, landing, in, blockMs, dh, miles, tripId, ... }` (`src/model.ts`).
- `statsFor(legs, airports): Stats` (`src/data/transform.ts`) — `Stats.flewMiles`, `Stats.hours` are operated-leg (`!dh`) totals.
- `SPEEDS = [0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]` (`src/globe/timelineDock.ts`); playback `baseLegMs = 1200` (`src/main.ts`), so a leg takes `1200 / SPEEDS[i]` ms.
- `lunarReturns(miles)` (`src/globe/lunarTrajectory.ts`).
- The live share handler at `src/main.ts:307-330`; globe built with `preserveDrawingBuffer: true` (`src/globe/globeScene.ts:30`), exposing `globe.renderer()`, `globe.camera()`, `globe.scene()`, `globe.postProcessingComposer()`, `globe.width()/height()`.

**Verification harness for browser tasks:** run `npm run dev` and open the printed URL with `?demo=1` (demo mode always has past trips **and** one future "ghost" trip, so both Last and Next are exercisable without Supabase). Use the preview MCP tools (`preview_start`, `preview_console_logs`, `preview_screenshot`) to drive and observe.

---

## Task 1: Spike — prove real-time 1080p capture → WebM

De-risk the single unknown (can we capture the composited globe at 1080p into a playable video?) **before** building anything else. Throwaway code; delete after.

**Files:**
- Modify (temporarily): `src/main.ts` (add a spike hook, then revert)

- [ ] **Step 1: Add a throwaway spike function wired to a keypress**

In `src/main.ts`, immediately after `const scene = createGlobeScene(host, viewport)` (line ~81), add:

```ts
// SPIKE (remove after Task 1): press "V" to capture 5s of the live globe at 1080p.
;(window as any).__spikeCapture = async () => {
  const gl = host.querySelector('canvas') as HTMLCanvasElement
  const hostW = host.clientWidth, hostH = host.clientHeight
  scene.globe.renderer().setSize(1920, 1080, false)
  scene.globe.postProcessingComposer().setSize(1920, 1080)
  scene.globe.camera().aspect = 16 / 9; scene.globe.camera().updateProjectionMatrix()

  const stage = document.createElement('canvas'); stage.width = 1920; stage.height = 1080
  const ctx = stage.getContext('2d')!
  const stream = stage.captureStream(30)
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((m) => MediaRecorder.isTypeSupported(m)) || ''
  console.log('[spike] using mime:', mime)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  const chunks: Blob[] = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()))

  rec.start()
  const t0 = performance.now()
  await new Promise<void>((resolve) => {
    const frame = () => {
      const s = Math.max(1920 / gl.width, 1080 / gl.height)
      ctx.drawImage(gl, (1920 - gl.width * s) / 2, (1080 - gl.height * s) / 2, gl.width * s, gl.height * s)
      if (performance.now() - t0 > 5000) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  rec.stop(); await stopped

  scene.globe.width(hostW).height(hostH)
  scene.globe.postProcessingComposer().setSize(hostW, hostH)
  scene.globe.camera().aspect = hostW / hostH; scene.globe.camera().updateProjectionMatrix()

  const blob = new Blob(chunks, { type: mime })
  console.log('[spike] blob bytes:', blob.size)
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'spike.webm'; a.click()
}
window.addEventListener('keydown', (e) => { if (e.key === 'v' || e.key === 'V') (window as any).__spikeCapture() })
```

- [ ] **Step 2: Run the spike**

Run: `npm run dev`, open the URL with `?demo=1`. Press `Play` on the timeline so the dart is flying, then press `V`.

Expected in console: `[spike] using mime: video/webm;codecs=vp9` (or vp8), then `[spike] blob bytes:` with a value in the hundreds of thousands to millions. A `spike.webm` downloads.

- [ ] **Step 3: Verify the artifact**

Open `spike.webm`. Expected: a ~5s clip of the globe with the dart/arcs/terminator, visibly sharp (1080p), plays smoothly. Confirm the bloom glow (cyan arcs, dart) is present — this proves the composer output (not a bare `renderer.render`) is captured.

**Decision gate:**
- If it works (expected): the real-time-capture architecture is validated. Proceed.
- If the canvas reads black: `preserveDrawingBuffer` may not apply to the composer's final target — try capturing `scene.globe.renderer().domElement` directly via `.captureStream()` instead of blitting, or set the bloom pass `renderToScreen`. Note findings.
- If `MediaRecorder` is unsupported (unlikely on desktop Chrome): stop and report — the whole approach needs revisiting.

- [ ] **Step 4: Revert the spike**

Remove the spike block added in Step 1. Confirm `git diff src/main.ts` is empty.

- [ ] **Step 5: Commit (nothing to commit if reverted cleanly)**

No commit — the spike leaves no code. Record the outcome (mime used, that it works) in the PR/notes for later tasks.

---

## Task 2: Trip resolution + label (pure, TDD)

**Files:**
- Create: `src/data/shareTrips.ts`
- Create: `src/data/shareTrips.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/data/shareTrips.test.ts
import { describe, it, expect } from 'vitest'
import { resolveShareTrips, tripLabel } from './shareTrips'
import type { Trip } from './trips'
import type { Leg } from '../model'

const leg = (from: string, to: string, t: number): Leg => ({
  id: `${from}${to}${t}`, from, to, s: [0, 0], e: [0, 0], t, takeoff: t, landing: t + 3.6e6,
  out: t, in: t + 4e6, blockMs: 3.6e6, sched: { out: null, off: null, on: null, in: null },
  act: { out: null, off: null, on: null, in: null }, dh: false, miles: 500, aircraft: null,
  tail: null, tripId: null,
})
const trip = (id: string, start: number, legs: Leg[]): Trip => ({ id, legs, start, end: legs[legs.length - 1].t, dest: legs[legs.length - 1].to })

describe('resolveShareTrips', () => {
  const now = 1_000_000_000
  const past = trip('p', now - 5 * 86400e3, [leg('SDF', 'ORD', now - 5 * 86400e3), leg('ORD', 'SDF', now - 5 * 86400e3 + 4e6)])
  const cur = trip('c', now - 1000, [leg('SDF', 'MIA', now - 1000)])
  const future = trip('f', now + 5 * 86400e3, [leg('SDF', 'CGN', now + 5 * 86400e3)])

  it('last = most recent trip that has started; next = first upcoming', () => {
    const { last, next } = resolveShareTrips([past, cur, future], now)
    expect(last?.id).toBe('c')
    expect(next?.id).toBe('f')
  })
  it('next is null when nothing is upcoming', () => {
    expect(resolveShareTrips([past, cur], now).next).toBeNull()
  })
  it('last falls back to the final trip when none has started yet', () => {
    const { last } = resolveShareTrips([future], now)
    expect(last?.id).toBe('f')
  })
  it('empty input yields nulls', () => {
    expect(resolveShareTrips([], now)).toEqual({ last: null, next: null })
  })
})

describe('tripLabel', () => {
  it('formats "MMM D · A→B→C" from the trip legs', () => {
    const t = trip('x', Date.UTC(2026, 6, 1), [leg('SDF', 'ANC', Date.UTC(2026, 6, 1)), leg('ANC', 'HKG', Date.UTC(2026, 6, 1) + 4e6)])
    expect(tripLabel(t)).toBe('Jul 1 · SDF→ANC→HKG')
  })
  it('collapses a simple out-and-back to A→B→A', () => {
    const t = trip('y', Date.UTC(2026, 6, 9), [leg('SDF', 'CGN', Date.UTC(2026, 6, 9)), leg('CGN', 'SDF', Date.UTC(2026, 6, 9) + 4e6)])
    expect(tripLabel(t)).toBe('Jul 9 · SDF→CGN→SDF')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/shareTrips.test.ts`
Expected: FAIL — `Failed to resolve import "./shareTrips"`.

- [ ] **Step 3: Implement**

```ts
// src/data/shareTrips.ts
import type { Trip } from './trips'

/** Last = most recent trip already started (fallback: final trip). Next = first upcoming. */
export function resolveShareTrips(trips: Trip[], now: number): { last: Trip | null; next: Trip | null } {
  if (!trips.length) return { last: null, next: null }
  let last: Trip | null = null
  let next: Trip | null = null
  for (const t of trips) {
    if (t.start <= now) last = t
    else if (!next) next = t
  }
  if (!last) last = trips[trips.length - 1]
  return { last, next }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jul 1 · SDF→ANC→HKG" — date of the first leg + the ordered airport chain. */
export function tripLabel(trip: Trip): string {
  const d = new Date(trip.start)
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  const route = tripRoute(trip)
  return `${date} · ${route}`
}

/** Ordered airport chain across the trip's legs, e.g. "SDF→ANC→HKG". */
export function tripRoute(trip: Trip): string {
  const stops: string[] = []
  for (const l of trip.legs) {
    if (!stops.length) stops.push(l.from)
    if (stops[stops.length - 1] !== l.to) stops.push(l.to)
  }
  return stops.join('→')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/shareTrips.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/shareTrips.ts src/data/shareTrips.test.ts
git commit -m "feat(share): resolve last/next trip and trip label (pure)"
```

---

## Task 3: Per-trip playback speed (pure, TDD)

Pick a `SPEEDS` index so a big trip runs longer than a short one, clamped to a watchable window. Reusing the existing speed system (rather than an arbitrary `legMs`) keeps the camera-follow duration — which reads the dock speed — in sync with the recording.

**Files:**
- Modify: `src/data/shareTrips.ts`
- Modify: `src/data/shareTrips.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/data/shareTrips.test.ts`:

```ts
import { pickTripSpeedIndex, tripFlightMs, VIDEO_FLOOR_MS, VIDEO_CEIL_MS } from './shareTrips'

const SPEEDS = [0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const BASE_LEG_MS = 1200

describe('pickTripSpeedIndex', () => {
  it('returns a valid index into SPEEDS', () => {
    const i = pickTripSpeedIndex(4, SPEEDS, BASE_LEG_MS)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(SPEEDS.length)
  })
  it('a 15-leg trip runs at least as fast as a 2-leg trip (higher speed index)', () => {
    expect(pickTripSpeedIndex(15, SPEEDS, BASE_LEG_MS)).toBeGreaterThanOrEqual(pickTripSpeedIndex(2, SPEEDS, BASE_LEG_MS))
  })
  it('keeps total flight time within [floor, ceil] as closely as the discrete speeds allow', () => {
    for (const n of [1, 2, 5, 15, 25, 40]) {
      const ms = tripFlightMs(n, SPEEDS, BASE_LEG_MS)
      // never wildly past the ceiling; never a blink well under the floor unless legs are truly few
      expect(ms).toBeLessThanOrEqual(VIDEO_CEIL_MS + BASE_LEG_MS / SPEEDS[SPEEDS.length - 1])
      expect(ms).toBeGreaterThan(2000)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/shareTrips.test.ts`
Expected: FAIL — `pickTripSpeedIndex` / `tripFlightMs` not exported.

- [ ] **Step 3: Implement**

Append to `src/data/shareTrips.ts`:

```ts
export const VIDEO_FLOOR_MS = 6000
export const VIDEO_CEIL_MS = 18000
const PER_LEG_TARGET_MS = 1000

/** Total on-screen flight time for `legCount` legs at SPEEDS[i]. */
export function tripFlightMs(legCount: number, speeds: number[], baseLegMs: number, i = pickTripSpeedIndex(legCount, speeds, baseLegMs)): number {
  return legCount * (baseLegMs / speeds[i])
}

/**
 * Choose the SPEEDS index whose total flight time is closest to a clamped target
 * (≈1s per leg, floored/ceiled so short trips linger and epic trips stay shareable).
 * Ties break toward the faster speed (shorter, snappier clip).
 */
export function pickTripSpeedIndex(legCount: number, speeds: number[], baseLegMs: number): number {
  const target = Math.min(VIDEO_CEIL_MS, Math.max(VIDEO_FLOOR_MS, legCount * PER_LEG_TARGET_MS))
  let best = 0, bestErr = Infinity
  for (let i = 0; i < speeds.length; i++) {
    const total = legCount * (baseLegMs / speeds[i])
    const err = Math.abs(total - target)
    if (err < bestErr - 1e-6) { bestErr = err; best = i } // strict `<` => on a tie, keep the earlier (slower) i…
  }
  // …then nudge toward faster on an exact tie so epic trips don't drag:
  const alt = best + 1
  if (alt < speeds.length && Math.abs(legCount * (baseLegMs / speeds[alt]) - target) === bestErr) best = alt
  return best
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/shareTrips.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/shareTrips.ts src/data/shareTrips.test.ts
git commit -m "feat(share): per-trip playback speed with floor/ceiling pacing"
```

---

## Task 4: Trip-card stats (pure, TDD)

**Files:**
- Modify: `src/data/shareTrips.ts`
- Modify: `src/data/shareTrips.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/data/shareTrips.test.ts`:

```ts
import { tripCardStats } from './shareTrips'

describe('tripCardStats', () => {
  it('sums flown miles + block hours over operated legs and counts flown legs', () => {
    const legs: Leg[] = [
      { ...leg('SDF', 'ANC', 0), miles: 2000, blockMs: 5 * 3.6e6, dh: false },
      { ...leg('ANC', 'HKG', 1), miles: 4200, blockMs: 9.5 * 3.6e6, dh: false },
      { ...leg('HKG', 'HKG', 2), miles: 100, blockMs: 3.6e6, dh: true }, // deadhead — excluded
    ]
    const t = trip('w', 0, legs)
    const s = tripCardStats(t)
    expect(s.route).toBe('SDF→ANC→HKG')
    expect(s.nm).toBe(6200)
    expect(s.legs).toBe(2)
    expect(s.blockHours).toBeCloseTo(14.5, 1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/shareTrips.test.ts`
Expected: FAIL — `tripCardStats` not exported.

- [ ] **Step 3: Implement**

Append to `src/data/shareTrips.ts`:

```ts
import type { Leg } from '../model'

export interface TripCardStats { route: string; nm: number; legs: number; blockHours: number }

/** Card figures for one trip, over operated (non-deadhead) legs. */
export function tripCardStats(trip: Trip): TripCardStats {
  let nm = 0, blockMs = 0, legs = 0
  for (const l of trip.legs as Leg[]) {
    if (l.dh) continue
    nm += l.miles; blockMs += l.blockMs; legs++
  }
  return { route: tripRoute(trip), nm: Math.round(nm), legs, blockHours: Math.round((blockMs / 3.6e6) * 10) / 10 }
}
```

Note: `tripRoute` (Task 2) uses **all** legs so the deadhead reposition still shows in the route chain, while the figures count flown legs only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/shareTrips.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/shareTrips.ts src/data/shareTrips.test.ts
git commit -m "feat(share): per-trip card stats (miles/legs/block hours)"
```

---

## Task 5: Parametrize card size + add the trip card

**Files:**
- Modify: `src/globe/shareCard.ts`
- Test: browser (no jsdom canvas)

- [ ] **Step 1: Make `composeShareCard` size-configurable (keep the default identical)**

In `src/globe/shareCard.ts`, change the signature and the `W`/`H` constants so existing callers are unaffected:

```ts
import type { Stats } from '../model'
import type { TripCardStats } from '../data/shareTrips'

// The career card keeps its historical 1200x630 default; the trip video passes 1920x1080.
export function composeShareCard(
  gl: HTMLCanvasElement, stats: Stats, lunarLine: string,
  size: { w: number; h: number } = { w: 1200, h: 630 },
): HTMLCanvasElement {
  const W = size.w, H = size.h
  const out = document.createElement('canvas')
  out.width = W; out.height = H
  const ctx = out.getContext('2d')!
  // …existing body unchanged, but every literal `1200`/`W` and `630`/`H` now reads W/H…
  return out
}
```

Replace the two `const W = 1200, H = 630` line and confirm the body already references `W`/`H` (it does). Delete the old module-level `const W = 1200, H = 630`.

- [ ] **Step 2: Add `composeTripCard` below it**

```ts
// 16:9 trip card: cover-cropped globe frame + Night-Ops footer carrying this trip's figures.
export function composeTripCard(
  gl: HTMLCanvasElement, card: TripCardStats, lunarLine: string,
  size: { w: number; h: number } = { w: 1920, h: 1080 },
): HTMLCanvasElement {
  const W = size.w, H = size.h
  const out = document.createElement('canvas'); out.width = W; out.height = H
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#04111f'; ctx.fillRect(0, 0, W, H)

  const scale = Math.max(W / gl.width, H / gl.height)
  const dw = gl.width * scale, dh = gl.height * scale
  ctx.drawImage(gl, (W - dw) / 2, (H - dh) / 2, dw, dh)

  const bandH = Math.round(H * 0.34)
  const grad = ctx.createLinearGradient(0, H - bandH, 0, H)
  grad.addColorStop(0, 'rgba(4,17,31,0)'); grad.addColorStop(0.45, 'rgba(4,17,31,0.82)'); grad.addColorStop(1, 'rgba(4,17,31,0.96)')
  ctx.fillStyle = grad; ctx.fillRect(0, H - bandH, W, bandH)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#eaf7ff'; ctx.font = '700 42px ui-monospace, Menlo, monospace'
  ctx.fillText('CREWLU', 64, H - 190)
  const w1 = ctx.measureText('CREWLU').width
  ctx.fillStyle = '#2fd6ff'; ctx.fillText(' · FLIGHT GLOBE', 64 + w1, H - 190)

  ctx.fillStyle = '#eaf7ff'; ctx.font = '700 60px ui-monospace, Menlo, monospace'
  ctx.fillText(card.route, 64, H - 120)

  const stat = (label: string, value: string, x: number) => {
    ctx.fillStyle = '#ffffff'; ctx.font = '700 46px ui-monospace, Menlo, monospace'; ctx.fillText(value, x, H - 56)
    ctx.fillStyle = '#8fb8cf'; ctx.font = '600 18px ui-monospace, Menlo, monospace'; ctx.fillText(label, x, H - 28)
  }
  stat('NAUTICAL MILES', card.nm.toLocaleString(), 64)
  stat('LEGS', String(card.legs), 620)
  stat('BLOCK HOURS', card.blockHours.toLocaleString(), 860)

  ctx.fillStyle = '#5cff9e'; ctx.font = '600 22px ui-monospace, Menlo, monospace'
  ctx.fillText(lunarLine, 64, H - 236)

  ctx.fillStyle = '#5fb8e0'; ctx.font = '600 20px ui-monospace, Menlo, monospace'
  const url = 'globe.crewlu.net'
  ctx.fillText(url, W - 64 - ctx.measureText(url).width, H - 28)
  return out
}
```

- [ ] **Step 3: Build passes**

Run: `npm run build`
Expected: `tsc --noEmit` passes (the `Stats` career call still type-checks; new function type-checks against `TripCardStats`).

- [ ] **Step 4: Browser sanity-check the trip card**

Temporarily expose it: in `src/main.ts` after `scene` is created, add `;(window as any).__card = () => document.body.appendChild(composeTripCard(host.querySelector('canvas')!, { route:'SDF→ANC→HKG', nm:6200, legs:2, blockHours:14.5 }, '0.12 LUNAR RETURNS'))` (import `composeTripCard`). Run `npm run dev`, open `?demo=1`, run `__card()` in the console. Expected: an 1920×1080 canvas appears with the globe frame + `SDF→ANC→HKG` and `6,200 / 2 / 14.5`. Remove the temporary hook.

- [ ] **Step 5: Commit**

```bash
git add src/globe/shareCard.ts
git commit -m "feat(share): size-configurable card + 16:9 trip card"
```

---

## Task 6: `tripVideo.ts` — record the live globe into a Blob

**Files:**
- Create: `src/globe/tripVideo.ts`
- Test: browser

- [ ] **Step 1: Implement the recorder**

```ts
// src/globe/tripVideo.ts
// Records the live globe (already rendering at high-res backing store) into a 16:9 stage
// canvas via MediaRecorder. Real-time capture: a 2D stage canvas is fed each animation frame
// (blit the GL canvas, cover-cropped), then the trip-stats card for the outro. See the plan's
// architecture note — the animation is wall-clock-driven, so we record rather than frame-step.

const MIMES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']

export function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

/** True when this browser can produce a video (both the recorder and canvas capture exist). */
export function canRecordVideo(): boolean {
  return pickMime() != null && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function'
}

export interface TripVideoOpts {
  gl: HTMLCanvasElement
  width: number
  height: number
  fps: number
  flightMs: number
  outroMs: number
  play: () => void
  stop: () => void
  drawOutro: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  onProgress?: (pct: number) => void
}

export async function recordTripVideo(o: TripVideoOpts): Promise<Blob> {
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
  o.play()
  const total = o.flightMs + o.outroMs
  const t0 = performance.now()

  await new Promise<void>((resolve) => {
    const frame = () => {
      const elapsed = performance.now() - t0
      if (elapsed < o.flightMs) blit()
      else o.drawOutro(ctx, o.width, o.height)
      o.onProgress?.(Math.min(0.99, elapsed / total))
      if (elapsed >= total) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  o.stop()
  rec.stop()
  await stopped
  o.onProgress?.(1)
  return new Blob(chunks, { type: mime })
}
```

- [ ] **Step 2: Build passes**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Browser smoke test (standalone)**

Temporarily in `src/main.ts` add (importing `recordTripVideo`):

```ts
;(window as any).__rec = async () => {
  const gl = host.querySelector('canvas') as HTMLCanvasElement
  const blob = await recordTripVideo({
    gl, width: 1920, height: 1080, fps: 30, flightMs: 4000, outroMs: 1500,
    play: () => {}, stop: () => {},
    drawOutro: (c, w, h) => { c.fillStyle = '#04111f'; c.fillRect(0, 0, w, h); c.fillStyle = '#2fd6ff'; c.font = '700 80px monospace'; c.fillText('OUTRO', 700, 560) },
    onProgress: (p) => console.log('progress', Math.round(p * 100)),
  })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rec.webm'; a.click()
}
```

Run `npm run dev`, open `?demo=1`, press Play, run `__rec()`. Expected: progress logs 0→100, `rec.webm` downloads, plays ~5.5s of live globe then ~1.5s of the OUTRO card. Remove the temporary hook.

- [ ] **Step 4: Commit**

```bash
git add src/globe/tripVideo.ts
git commit -m "feat(share): tripVideo recorder (stage canvas + MediaRecorder)"
```

---

## Task 7: Share panel in the HUD

**Files:**
- Modify: `src/globe/hud.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Extend the `Hud` interface**

In `src/globe/hud.ts`, in `interface Hud`, remove `onShare(cb: () => void): void` and add:

```ts
  onShareOpen(cb: () => void): void
  onShareTrip(cb: (which: 'last' | 'next') => void): void
  onShareImage(cb: () => void): void
  setShareTrips(last: string | null, next: string | null): void
  setShareProgress(pct: number): void
  closeSharePanel(): void
```

- [ ] **Step 2: Add the panel markup**

In `HUD_HTML`, replace the share button line
`<button id="shareBtn" class="navbtn" style="margin-left:8px">⇪ SHARE</button>`
with the button plus a hidden panel (kept inside the pointer-events:auto `#lunar` block):

```html
<button id="shareBtn" class="navbtn" style="margin-left:8px">⇪ SHARE</button>
<div id="sharePanel" class="sharepanel" style="display:none">
  <div class="sharehdr">SHARE A TRIP</div>
  <button id="shareLast" class="sharebtn"><span class="sharekick">◀ LAST TRIP</span><span id="shareLastLbl" class="sharelbl">—</span></button>
  <button id="shareNext" class="sharebtn"><span class="sharekick">NEXT TRIP ▶</span><span id="shareNextLbl" class="sharelbl">—</span></button>
  <div id="shareProg" class="shareprog" style="display:none"><div id="shareProgBar"></div><div id="shareProgTxt">RENDERING 0%</div></div>
  <a id="shareImage" class="sharelink">Just the current view (image)</a>
</div>
```

- [ ] **Step 3: Wire the methods**

In the returned object of `createHud`, replace `onShare(...)` with:

```ts
    onShareOpen(cb) {
      q('#shareBtn').addEventListener('click', () => {
        const p = q<HTMLElement>('#sharePanel')
        const open = p.style.display !== 'none'
        p.style.display = open ? 'none' : 'block'
        if (!open) cb()
      })
    },
    onShareTrip(cb) {
      q('#shareLast').addEventListener('click', () => cb('last'))
      q('#shareNext').addEventListener('click', () => cb('next'))
    },
    onShareImage(cb) { q('#shareImage').addEventListener('click', cb) },
    setShareTrips(last, next) {
      const lb = q<HTMLButtonElement>('#shareLast'), nb = q<HTMLButtonElement>('#shareNext')
      q('#shareLastLbl').textContent = last ?? 'none yet'
      q('#shareNextLbl').textContent = next ?? 'none scheduled'
      lb.disabled = last == null; nb.disabled = next == null
    },
    setShareProgress(pct) {
      const wrap = q<HTMLElement>('#shareProg')
      if (pct <= 0 || pct >= 1) { wrap.style.display = pct >= 1 ? 'none' : 'none' }
      else {
        wrap.style.display = 'block'
        q<HTMLElement>('#shareProgBar').style.width = `${Math.round(pct * 100)}%`
        q('#shareProgTxt').textContent = `RENDERING ${Math.round(pct * 100)}%`
      }
    },
    closeSharePanel() { q<HTMLElement>('#sharePanel').style.display = 'none'; q<HTMLElement>('#shareProg').style.display = 'none' },
```

- [ ] **Step 4: Add styles**

Append to `src/styles.css`:

```css
.sharepanel { margin-top: 8px; width: 260px; padding: 12px; background: rgba(11,32,51,0.92);
  border: 1px solid rgba(47,214,255,0.35); border-radius: 12px; pointer-events: auto; }
.sharehdr { font: 600 12px ui-monospace, Menlo, monospace; color: #3fd8ff; letter-spacing: 1.5px; margin-bottom: 10px; }
.sharebtn { display: block; width: 100%; text-align: left; margin: 0 0 8px; padding: 8px 12px;
  background: #0d2a3d; border: 1px solid #1d4a64; border-radius: 9px; cursor: pointer; }
.sharebtn:hover:not(:disabled) { border-color: #2fd6ff; }
.sharebtn:disabled { opacity: 0.4; cursor: default; }
.sharekick { display: block; font: 600 10px ui-monospace, Menlo, monospace; color: #7fb8d4; letter-spacing: 1px; }
.sharelbl { display: block; font: 500 13px ui-monospace, Menlo, monospace; color: #eaf7ff; margin-top: 2px; }
.sharelink { display: inline-block; margin-top: 4px; font: 400 12px ui-monospace, Menlo, monospace; color: #6f97ad; cursor: pointer; text-decoration: underline; }
.shareprog { margin: 4px 0 10px; }
.shareprog > #shareProgBar { height: 4px; width: 0; background: #2fd6ff; border-radius: 2px; transition: width 0.2s; }
.shareprog > #shareProgTxt { margin-top: 6px; font: 600 10px ui-monospace, Menlo, monospace; color: #3fd8ff; letter-spacing: 1px; }
```

- [ ] **Step 5: Fix the compile break in `main.ts` (temporary stub)**

`main.ts` still calls the removed `hud.onShare(...)`. Temporarily comment out that whole `hud.onShare(() => { … })` block (lines ~309-330) so the build passes; Task 8 replaces it.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Browser check the panel**

Run `npm run dev`, open `?demo=1`, click `⇪ SHARE`. Expected: the panel opens under the button, styled dark/cyan, with two trip buttons (labels `—` for now) and the image link. Click Share again → closes. Screenshot it.

- [ ] **Step 7: Commit**

```bash
git add src/globe/hud.ts src/styles.css
git commit -m "feat(share): interactive share panel (Last/Next + progress)"
```

---

## Task 8: Wire the panel → record → share in `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add imports**

At the top of `src/main.ts` add:

```ts
import { resolveShareTrips, tripLabel, tripCardStats, pickTripSpeedIndex } from './data/shareTrips'
import { composeTripCard } from './globe/shareCard'
import { recordTripVideo, canRecordVideo } from './globe/tripVideo'
import { SPEEDS } from './globe/timelineDock'
```

(Confirm `composeShareCard` is already imported at line 27; keep it.)

- [ ] **Step 2: Replace the old share block with the panel wiring**

Delete the commented-out `hud.onShare` block. In its place (still inside the mount function, where `hud`, `scene`, `host`, `trips`, `now`, `meta`, `win`, `playhead`, `draw`, `playback`, `dock`, `currentMiles`, `lastStats`, `lunarReturns` are in scope):

```ts
  // ---- Share: interactive trip video (falls back to a still image) ----
  const shareTrips = resolveShareTrips(trips, now)
  hud.onShareOpen(() => hud.setShareTrips(
    shareTrips.last ? tripLabel(shareTrips.last) : null,
    shareTrips.next ? tripLabel(shareTrips.next) : null,
  ))

  const glCanvas = () => host.querySelector('canvas') as HTMLCanvasElement

  const shareOrDownload = async (blob: Blob, filename: string, title: string) => {
    const file = new File([blob], filename, { type: blob.type })
    const nav: any = navigator
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title }) } catch { /* dismissed */ }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    }
  }

  const lunarLineFor = (miles: number) =>
    `${Math.round(miles).toLocaleString()} NM FLOWN · ${lunarReturns(miles).toFixed(2)} LUNAR RETURNS`

  // The "just the image" secondary link keeps the original career-card behaviour.
  hud.onShareImage(() => {
    if (!lastStats) return
    const card = composeShareCard(glCanvas(), lastStats, lunarLineFor(currentMiles))
    card.toBlob((b) => { if (b) shareOrDownload(b, 'crewlu-globe.jpg', 'My CrewLu Flight Globe') }, 'image/jpeg', 0.9)
    hud.closeSharePanel()
  })

  let recording = false
  hud.onShareTrip(async (which) => {
    if (recording) return
    const trip = which === 'last' ? shareTrips.last : shareTrips.next
    if (!trip) return
    recording = true

    const cardStats = tripCardStats(trip)
    const speedIdx = pickTripSpeedIndex(cardStats.legs || trip.legs.length, SPEEDS, 1200)
    const flightMs = (cardStats.legs || trip.legs.length) * (1200 / SPEEDS[speedIdx])
    const card = composeTripCard(glCanvas(), cardStats, lunarLineFor(cardStats.nm))

    // Fallback path: no video support → share the trip card as an image.
    if (!canRecordVideo()) {
      card.toBlob((b) => { if (b) shareOrDownload(b, 'crewlu-trip.jpg', `My ${cardStats.route} trip`) }, 'image/jpeg', 0.9)
      hud.closeSharePanel(); recording = false; return
    }

    // Save live state, scope the window to just this trip, set the recording speed.
    const savedStart = win.start, savedEnd = win.end, savedPlayhead = playhead
    const savedSpeedIdx = dock.state.speedIndex
    const hostW = host.clientWidth, hostH = host.clientHeight
    win.start = trip.legs[0].t; win.end = trip.legs[trip.legs.length - 1].t
    playhead = win.start; dock.state.speedIndex = speedIdx
    playback.setSpeed(SPEEDS[speedIdx])
    draw(true)

    // Force 1080p backing store so the capture is genuinely high-res.
    scene.globe.renderer().setSize(1920, 1080, false)
    scene.globe.postProcessingComposer().setSize(1920, 1080)
    scene.globe.camera().aspect = 16 / 9; scene.globe.camera().updateProjectionMatrix()

    try {
      const blob = await recordTripVideo({
        gl: glCanvas(), width: 1920, height: 1080, fps: 30, flightMs, outroMs: 2000,
        play: () => playback.play(), stop: () => playback.pause(),
        drawOutro: (ctx, w, h) => ctx.drawImage(card, 0, 0, w, h),
        onProgress: (p) => hud.setShareProgress(p),
      })
      await shareOrDownload(blob, 'crewlu-trip.webm', `My ${cardStats.route} trip`)
    } finally {
      // Restore renderer size, camera, window, speed, and the live scene.
      scene.globe.width(hostW).height(hostH)
      scene.globe.postProcessingComposer().setSize(hostW, hostH)
      scene.globe.camera().aspect = hostW / hostH; scene.globe.camera().updateProjectionMatrix()
      win.start = savedStart; win.end = savedEnd; playhead = savedPlayhead
      dock.state.speedIndex = savedSpeedIdx; playback.setSpeed(SPEEDS[savedSpeedIdx])
      playback.pause(); draw(true)
      hud.setShareProgress(0); hud.closeSharePanel(); recording = false
    }
  })
```

- [ ] **Step 2b: Confirm `dock.state.speedIndex` is writable**

Check `src/globe/timelineDock.ts`: the returned object must expose a mutable `state` with `speedIndex` (it is read as `dock.state.speedIndex` at `main.ts:274`). If `state` is frozen or not exposed for writing, add a `setSpeedIndex(i: number)` method to the dock that sets it, and call that instead of the direct assignment above. Verify by reading the dock's return object.

- [ ] **Step 3: Build passes**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: End-to-end browser verification (demo mode)**

Run `npm run dev`, open `?demo=1`:
1. Click `⇪ SHARE` → panel shows real labels for Last trip and Next trip (dates + routes).
2. Click **Last trip** → progress bar climbs 0→100%; the globe animates the trip; a `crewlu-trip.webm` downloads (or the share sheet opens). Open it: the trip flies, then holds ~2s on the trip card with the right route/nm/legs/block-hours.
3. Confirm afterward the globe returns to its normal size and the pre-record view (window/playhead restored, no leftover 16:9 stretch).
4. Click **Next trip** → a shorter/one-leg future trip records correctly.
5. Click **Just the current view (image)** → the career image still shares/downloads as before.

Capture a screenshot of the panel mid-render and confirm no console errors (`preview_console_logs`).

- [ ] **Step 5: Verify a short vs long trip differ in length**

In demo mode, record a short turn (e.g. a 2-leg SDF turn) and the world tour; confirm the world-tour clip is visibly longer (per Task 3 pacing) and neither is under ~6s or a slog.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(share): wire share panel to trip-video recording + image fallback"
```

---

## Task 9: Cross-check the career-image path + full test run

**Files:**
- Verify only

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: all pass, including the new `shareTrips` tests and the untouched existing suites.

- [ ] **Step 2: Build + typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Regression check the existing share entry points**

Grep for any remaining references to the removed `onShare`:

Run: `grep -rn "onShare\b" src`
Expected: only `onShareOpen` / `onShareTrip` / `onShareImage` — no bare `onShare(`.

- [ ] **Step 4: Non-demo smoke (optional, needs Supabase)**

If a real login is available, confirm: a user with only past flights sees **Last trip** enabled and **Next trip** disabled ("none scheduled"); recording Last still works.

- [ ] **Step 5: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "test(share): full suite green; drop stale onShare references"
```

---

## Self-Review (completed while writing)

**Spec coverage:**
- Interactive panel / Last-Next buttons → Task 7 + 8. ✔
- Video of selected trip → Task 6 + 8. ✔
- Ends on this-trip stats card → Task 5 (`composeTripCard`) + Task 8 outro. ✔
- 16:9 1920×1080 → Task 5/6/8. ✔
- Length scales with trip (floor/ceiling) → Task 3 + verified in Task 8 Step 5. ✔
- Build frame-by-frame vs screen-record → **Amended**: architecture note + Task 1 spike establish real-time high-res capture (the animation is wall-clock-driven; true frame-stepping deferred). ✔ (documented deviation from spec §6)
- Native encoder + iOS image fallback → `canRecordVideo` + `composeTripCard` fallback in Task 8. ✔
- Trip resolution reuses `now` split → Task 2. ✔
- `preserveDrawingBuffer` reliance → confirmed in Task 1. ✔

**Placeholder scan:** no TBD/TODO; every code step has complete code; verification steps have exact commands + expected output.

**Type consistency:** `TripCardStats { route, nm, legs, blockHours }` defined in Task 4, consumed in Task 5/8. `recordTripVideo`/`TripVideoOpts` defined in Task 6, consumed in Task 8. `pickTripSpeedIndex(legCount, speeds, baseLegMs)` defined Task 3, called Task 8 with `(legs, SPEEDS, 1200)`. `resolveShareTrips`/`tripLabel`/`tripRoute` defined Task 2. Hud methods `onShareOpen/onShareTrip/onShareImage/setShareTrips/setShareProgress/closeSharePanel` defined Task 7, called Task 8. Consistent.

**Known integration risks (surface during execution):**
- `dock.state.speedIndex` writability (Task 8 Step 2b).
- Composer capture returning black (Task 1 decision gate).
- 16:9 backing store on a non-16:9 screen may look briefly stretched *during* recording — acceptable (panel/progress is up); the captured/blitted output is correctly cover-cropped.
