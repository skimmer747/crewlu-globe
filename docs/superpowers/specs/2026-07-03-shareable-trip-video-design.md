# Shareable Trip Video — Design Spec

- **Date:** 2026-07-03
- **Repo:** `~/Dev/crewlu-globe` (Flight Globe)
- **Status:** Approved design → ready for implementation plan

## 1. Goal

Today the Share button (`hud.onShare` → `composeShareCard`) produces a single static
1200×630 JPEG of the current globe frame plus lifetime career stats. Make sharing
interactive and cinematic: let the user pick their most-recent or next trip and share a
short, high-resolution **video** of that trip animating on the globe, ending on a stats
card for that specific trip.

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Video content | Selected trip flies, then holds ~2s on a trip-stats card | Short, shareable; reuses the existing playback engine + a card outro |
| Trip picker | "Last trip" / "Next trip" buttons (no calendar/list) | Matches the ask; minimal UI; trips already derivable from data |
| How it's made | Build frame-by-frame at fixed resolution/FPS (**not** screen recording) | True high-res, zero dropped frames, deterministic across devices |
| Encoder | Native `MediaRecorder` + `captureStream`; image fallback on iOS | Zero new dependencies; excellent on desktop/Android; never dead-ends |
| Aspect / resolution | **16:9, 1920×1080, 30 fps** | Best for desktop / YouTube / X; closest to the existing card; friendliest to the encoder path |
| Outro stats | **This trip's** stats (route, nm, legs, block hrs) | Relevant to the specific trip being shared |

## 3. User flow

1. User clicks `⇪ SHARE`.
2. A compact Night-Ops panel opens, anchored to the button:
   - **◀ LAST TRIP** — `<date · route>` (most recent flown trip)
   - **NEXT TRIP ▶** — `<date · route>` (first upcoming trip; disabled/greyed when none)
   - *"Just the current view (image)"* — secondary link = today's instant image share (unchanged)
   - **▶ CREATE VIDEO** (primary action)
3. User picks a trip (Last/Next) and clicks Create video.
4. The primary button becomes a progress bar (`Rendering NN%…`) while frames render + encode.
5. The finished clip is handed to `navigator.share({ files })`; if unsupported, it downloads.
   On iOS / where in-browser recording is unavailable or fails, silently fall back to the
   trip-stats **image** card so Share never dead-ends.

Trip labels: `date` = `trip.start` formatted; `route` = `from→…→to`. Both come free from
`groupIntoTrips`, which already yields `Trip { id, legs, start, end, dest }`.

## 4. Trip resolution

- All trips: `groupIntoTrips(legs)` (already chronological).
- **Last** = last trip with `end <= now` (fallback: last trip overall).
- **Next** = first trip with `start > now`. If none, disable the button.
  - Demo mode (`?demo=1`) always has one future "ghost" trip. Real users only have a Next
    trip when the Supabase `flights` table carries scheduled (not-yet-flown) rows.
- Reuse the split already encoded in `schedule.ts` (`focusTrip` / `beaconHome` do the same
  `t <= now` / `t > now` comparison) rather than reinventing it.

## 5. Video composition (length scales with the trip)

- **Flight phase** — the selected trip animates exactly as the live playback already renders
  it, but scoped to this trip's legs: dart flies each leg (`onFly`), contrail trails, legs
  reveal (`onReveal`), and the day/night terminator + sky sweep via
  `onPlayhead(playheadForSample(...))`.
- **Outro phase** — ease to rest, then hold on the trip-stats card for ~2s (~60 frames at 30fps).

**Pacing — scale length to the trip, within limits.** A 2-leg turn and a 15-leg world tour
must not be the same length. Give each flown leg a base on-screen duration, then clamp the
*total* flight time so every clip stays watchable and shareable:

- `flightMs = clamp(legCount × PER_LEG, FLOOR, CEIL)`; `legMs = flightMs / legCount`.
- Defaults (tune after seeing real output): `PER_LEG ≈ 1000ms`, `FLOOR ≈ 6000ms`,
  `CEIL ≈ 18000ms`; plus the ~2s card outro.
- Examples: 2-leg turn → ~6s flying (each leg lingers ~3s) + 2s ≈ **8s**; 15-leg world tour →
  ~15s flying + 2s ≈ **17s**; 25-leg trip → capped ~18s (legs speed up) + 2s ≈ **20s**.

Reuse `buildPlaybackSchedule` with the derived `legMs`. Because the terminator sweeps during
each airborne span, long-haul trips (longer flights, more legs) naturally roll through many
more day/night cycles than a short turn — the big trip *feels* big beyond its length. Total
frames = `(flightMs + outroMs) × fps / 1000` (varies, ~240–600).

## 6. Architecture

> **Amendment (2026-07-03, during planning):** Reading the code showed the dart flight
> (`dart.flyLeg`/`tick`) and camera moves run on `performance.now()` wall-clock tweens, so the
> animation is **not** a pure function of an internal clock. True offline frame-stepping would
> mean reimplementing dart/camera/contrail as clock-injectable — too big for v1. The
> implementation plan therefore uses **real-time capture at a forced 1080p backing store**
> (record the live animation via `captureStream` + `MediaRecorder`, blitted onto a 16:9 stage
> canvas, card outro appended). Same high-res result; it records in real time. The offline
> frame-step idea below is kept for reference / a possible later upgrade. See
> `docs/superpowers/plans/2026-07-03-shareable-trip-video.md`.

New module `src/globe/tripVideo.ts`, roughly:

```ts
recordTripVideo(opts: {
  gl: HTMLCanvasElement            // live WebGL canvas (preserveDrawingBuffer already true)
  renderAt: (elapsedMs: number) => void   // pose the scene deterministically for a given time
  durationMs: number
  fps: number
  width: number                    // 1920
  height: number                   // 1080
  outroCard: HTMLCanvasElement     // the trip-stats card, drawn once up front
  outroFrames: number
  onProgress?: (pct: number) => void
}): Promise<Blob>
```

**Mechanics — record a 2D "stage" canvas, not the GL canvas directly:**

1. Create a 1920×1080 offscreen 2D `stage` canvas; `stream = stage.captureStream(0)`;
   `track = stream.getVideoTracks()[0]` (a `CanvasCaptureMediaStreamTrack`);
   `rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond })`; collect
   `dataavailable` chunks.
2. Resize the globe renderer + camera aspect to 1920×1080 for the capture (restore after).
3. **Flight frames** — for `i` in `0..N-1`:
   `elapsedMs = (i / fps) * 1000` → `renderAt(elapsedMs)` (advances the trip-scoped
   playback sample → `onReveal/onFly/onPlayhead` → forces one synchronous globe render) →
   `stage` `ctx.drawImage(gl, …)` cover-cropped into 16:9 → `track.requestFrame()` →
   `await` one microtask/rAF.
4. **Outro frames** — `ctx.drawImage(outroCard, 0, 0, 1920, 1080)` → `requestFrame()`, repeated
   `outroFrames` times.
5. `rec.stop()` → assemble `Blob` from chunks → resolve.
6. Restore renderer size, camera aspect, and the live scene state.

Recording the 2D stage (rather than the GL canvas) gives us 16:9 crop control and matches how
`composeShareCard` already composites, and lets the flight footage and the card outro share one
capture stream.

`renderAt` is provided by `main.ts`, which owns the globe instance and the playback handlers.
It builds a trip-scoped `PlaybackSchedule`, and for a given `elapsedMs` computes the sample,
calls the same `onReveal/onFly/onPlayhead` used live, then forces one render.

### Key risk — spike this first

globe.gl runs its own internal `requestAnimationFrame` render loop, so we need a reliable way
to force **exactly one synchronous render per frame** that reflects the posed state. Plan
step 1 is a ~30-min spike to confirm the hook — access globe.gl's underlying three.js
`renderer`/`scene`/`camera` and call `renderer.render(scene, camera)` directly after posing,
with globe.gl's own loop paused during capture.

**Fallback if blocked:** drive a real (non-manual) 1× playback and capture via `requestFrame`
on each rAF tick — still 1920×1080 and resolution-deterministic, but may drop frames on slow
machines. Decide at the spike; do not build the rest until the render hook is proven.

## 7. Trip-stats card (outro)

Extend `src/globe/shareCard.ts`:

- Parametrize `composeShareCard` on width/height (currently hard-coded 1200×630) so it can
  render at 1920×1080.
- Add a trip variant (e.g. `composeTripCard(gl, trip, tripStats, lunarLine?)`) showing:
  route `SDF→ANC→HKG`, trip miles (`nm`), legs, block hours — plus the wordmark and
  `globe.crewlu.net`, keeping the Night-Ops footer band.
- Trip stats computed from the trip's legs:
  - `miles` = Σ `leg.miles` (already haversine nm per leg)
  - `legs` = flown-leg count (exclude `leg.dh` deadheads for v1)
  - `blockHours` = Σ `leg.blockMs` / 3.6e6 over flown legs
  - `route` = ordered airports across the trip's legs (`from`…`to`)

## 8. Files touched

- `src/globe/tripVideo.ts` **(new)** — recorder, stage compositing, encode → `Blob`.
- `src/globe/hud.ts` — replace the instant Share with a panel: panel markup,
  `onShareTrip('last' | 'next')`, `onShareImage()`, progress API
  (`setShareProgress(pct)` / reset), enable/disable Next.
- `src/main.ts` — wire the panel: resolve last/next trips, build the trip-scoped `renderAt`,
  call `recordTripVideo`, hand the `Blob` to share/download, iOS fallback to the trip image card.
- `src/globe/shareCard.ts` — parametrize size; add the trip-stats card.
- `src/styles.css` — panel + progress styles (Night-Ops).
- *(maybe)* `src/globe/playback.ts` — export a small pure "sample → pose" helper if it makes
  `renderAt` cleaner; no behavior change to live playback.

## 9. Non-goals (YAGNI)

- No calendar or scrollable trip list — Last/Next only.
- No "career built up to the trip" mode.
- No server-side rendering; no WASM encoder (the image fallback covers iOS).
- No new camera choreography beyond current playback (auto-frame-on-trip is possible later
  polish, not v1).
- Whole-globe image share stays as the secondary option, behavior unchanged.

## 10. Verification

- Demo mode (`?demo=1`) always has trips including one future → exercises both Last and Next.
- Desktop Chrome: create a clip → a 1920×1080 WebM whose length scales with the trip
  (~8–20s) downloads/plays; flight animates then holds on the trip card; all displayed numbers
  are rounded. Check a short turn (~8s) and a long/world trip (~17s) both feel right.
- Confirm capture still relies on `preserveDrawingBuffer: true` (already set for the card).
- iOS Safari / unsupported: confirm graceful fallback to the trip-stats image — no dead-end,
  no thrown errors.
- Perf: ~300 frames render + encode within a few seconds on desktop, progress shown, UI does
  not freeze (yield each frame).

## 11. Open questions for planning

- Exact globe.gl synchronous-render hook, and whether to pause its internal loop during capture
  (resolved by the spike).
- `mimeType` selection order (`video/webm;codecs=vp9` → `vp8` → `video/mp4`) and target
  `videoBitsPerSecond` for 1080p.
- Frame pacing with manual `captureStream(0)` + `requestFrame()` — how the yield between
  frames maps to encoded frame timestamps/duration so the clip runs at true 30 fps (spike).
- Final `PER_LEG` / `FLOOR` / `CEIL` pacing values — dial in against real trips after first output.
- Deadhead handling in the trip-stats card (count/label flown vs rode).
- For multi-day trips, whether to advance the day/night clock during ground time between
  flights (compressed) so the calendar span reads more, or keep the live behavior (clock moves
  only during airborne spans). v1 = live behavior.
