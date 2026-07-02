# Realistic Moon — Design

**Date:** 2026-07-02
**Status:** Approved (approach A of A/B/C: photo texture + correct terminator; mini-3D and improved-SVG rejected)

## Problem

The Moon overlay is a hand-drawn SVG: a radial-gradient disc, four flat gray circles standing in for craters, and a phase "shadow" that is a dark circle slid horizontally by illuminated fraction. The slid circle produces geometrically wrong crescents and the whole disc reads as illustrated, not real.

## Goal

A photographic Moon with an astronomically correct phase terminator, at any zoom scale, with zero changes to the positioning, sizing, and occlusion architecture around it.

## Non-goals

- No second WebGL context / three.js sphere (rejected approach B).
- No change to the phase chip ("🌖 WANING GIBBOUS · 78%") — kept exactly as is.
- No change to `MOON_EARTH_RATIO` sizing, `featherBehindEarth` occlusion, sub-lunar positioning, or the lunar trajectory line.
- No libration or position-angle-of-bright-limb accuracy; the terminator axis stays vertical with the existing dark-on-right-when-waning convention.

## Asset pipeline

- `scripts/make-moon-disc.py` (committed, one-off, Python 3 + Pillow): orthographically projects the **near side** of Solar System Scope's moon map (equirectangular, CC-BY-4.0 — the same source and license as the Earth textures) into a square disc image. For each output pixel inside the unit disc: `z = √(1−x²−y²)`, `lat = asin(y)`, `lon = atan2(x, z)` (near side centered at lon 0), sampled with 2×2 supersampling. Corners transparent.
- Output: `public/textures/moon-disc.webp`, 1024×1024, alpha, target ≲200 KB.
- HUD credit line in `src/globe/hud.ts` becomes `EARTH & MOON IMAGERY · SOLARSYSTEMSCOPE.COM · CC-BY-4.0`.

## Phase geometry (pure helper, TDD)

New export in `src/astro/moon.ts`:

```ts
/** Terminator ellipse for a disc of radius 1. b ∈ [−1, 1] is the signed
 *  semi-minor axis of the terminator: b = 1 − 2·illum. |b| is the ellipse
 *  half-width; sign > 0 bulges toward the LIT side, extending the dark region
 *  past center (crescent, illum < ½); sign < 0 bulges toward the dark side,
 *  shrinking the dark region to a sliver (gibbous). Area check: dark fraction
 *  = ½ + b/2 = 1 − illum. darkOnRight mirrors the existing convention:
 *  waning ⇒ dark limb on the right. */
export function terminator(illum: number, waning: boolean): { b: number; darkOnRight: boolean }
```

The dark region of the disc is bounded by the limb semicircle on the dark side and the terminator half-ellipse (semi-major = r vertical, semi-minor = |b|·r horizontal). `illum = 0` → full disc dark; `illum = 1` → no dark region; `illum = 0.5` → straight terminator (b = 0).

## Rendering (`src/globe/moonLayer.ts`)

- The inline `MOON_DISK` SVG is replaced by a `<canvas>` inside `.moon-scale`, same 84 px box, same 47.6 px visual disc diameter (radius = 34/120 of the box) — so `boxHalf: 42`, `setScale`, and the feather mask are untouched. The outer glow is kept (slightly toned down) as a CSS radial-gradient layer behind the canvas.
- Draw order per render: photo disc (clipped to circle) → dark-side path filled `rgba(7,11,20,0.86)` so the shadowed surface stays faintly visible (earthshine) → soft penumbra by compositing the shadow through `ctx.filter = 'blur(…)'` scaled to backing resolution (old Safari without canvas filter support degrades to a hard terminator edge — acceptable).
- **Crispness vs. zoom:** backing resolution re-buckets with the current CSS scale and devicePixelRatio — `clamp(nextPow2(discPx × dpr), 256, 1024)`. Redraw only when (a) the resolution bucket changes via `setScale`, or (b) illuminated fraction quantized to 0.1 % changes via `update(date)`. Timeline playback therefore costs ~zero; a redraw is one `drawImage` + one path fill.
- Texture loads async (`Image` from `/textures/moon-disc.webp`); until it decodes, render the disc as the current flat gradient fallback so the Moon never disappears. On decode, redraw.
- `update(date)` keeps setting `datum.lat/lng` from `subLunarPoint` and the chip text from `moonPhase` exactly as today.

## Testing & verification

1. Vitest (`src/astro/moon.test.ts` additions): `terminator()` at illum 0 / 0.25 / 0.5 / 0.75 / 1, waxing vs waning — asserts b sign/magnitude and darkOnRight; existing `moonPhase`/`subLunarPoint` tests untouched.
2. `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
3. Visual in `?demo=1` preview (port 8798): disc shows real maria; scrub the timeline across several days and confirm the terminator sweeps correctly; fly the camera so the Moon passes behind Earth and confirm the feather fade still works; zoom into lunar mode to confirm crispness at large scales.
4. Screenshot for user review; expect a brightness/contrast/glow fine-tuning round before deploy.

## Deploy gate

Only after visual approval: `npm run deploy`, then cache-safe verify per the standard pipeline (new hashed bundle live via `?cb=` first, `moon-disc.webp` 200, no canonical URL polled before the Pages build reports `built`).
