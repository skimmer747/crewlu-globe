# Celestial Sky — Design Spec

**Date:** 2026-06-20
**Status:** Approved (brainstorm)

## Goal

Let the user zoom the globe way out and see the **Sun, Moon, and all seven planets** placed at their **real positions in the sky**, for the **timeline's current date/time** — an Earth-centric planetarium. Scrubbing the timeline shifts the whole sky to match that moment.

## Framing (decided)

- **Earth-centric planetarium**, not an orrery. Earth stays the center; bodies sit in the real directions they'd appear in the sky, on a large "sky sphere" around Earth.
- **Timeline-synced**: every body's position is computed for the playhead date/time, exactly like the existing day/night Sun (`subsolarPoint`) and Moon (`subLunarPoint`).
- **Planets:** all seven — Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune — each with a name label.
- **ISS:** explicitly **deferred** to a separate follow-up (it needs near-present orbital data and can't be placed accurately for historical/future timeline dates).

## Non-goals

- No orrery / sun-centric solar-system view.
- No ISS in this iteration.
- No arc-second precision. Naked-eye sky accuracy (≤ ~0.5°) is the target.

## Architecture

### 1. Ephemeris — `src/astro/planets.ts` (new, pure, unit-tested)

Low-precision Keplerian method (Meeus / Standish mean elements):

1. Per planet: mean orbital elements (a, e, i, L, ϖ, Ω) with linear time rates, evaluated at the date (centuries since J2000).
2. Solve Kepler's equation (Newton iteration) for the eccentric anomaly → heliocentric position in the planet's orbital plane → rotate into heliocentric ecliptic coordinates.
3. Compute Earth's heliocentric ecliptic position the same way; subtract → **geocentric** ecliptic vector to the planet.
4. Convert geocentric ecliptic → equatorial (obliquity ε) → right ascension / declination.
5. Convert RA/Dec → **sub-point** (geographic lat/lng where the body is at the zenith) using GMST — the same final step `subsolarPoint` already does.

Exposed API (shape):
```ts
export type PlanetId = 'mercury'|'venus'|'mars'|'jupiter'|'saturn'|'uranus'|'neptune'
export interface SkyPoint { lat: number; lng: number }      // sub-point (deg)
export function planetSubpoint(id: PlanetId, date: Date): SkyPoint
export const PLANET_IDS: PlanetId[]                          // ordered
```
Pure functions, no DOM. **Tested** against published almanac RA/Dec (or sub-point) for each planet on a fixed reference date, asserting agreement within ~0.5°.

The Sun reuses the existing `subsolarPoint`. (The Moon already has `subLunarPoint`.)

### 2. Sky rendering — `src/globe/skyLayer.ts` (new)

Creates DOM overlays for the Sun + 7 planets and exposes them to globe.gl's `htmlElementsData` (alongside the existing Moon and beacon).

- **Sky sphere:** each body's datum uses a large altitude (`SKY_ALT`, ~7 Earth-radii) so it reads as distant sky. Because the camera orbits Earth's center (no translation), parallax at this radius is negligible and the on-screen *direction* is what matters.
- **Planets:** a small colored dot + a name label. Per-planet color (e.g. Mercury grey, Venus pale-gold, Mars rusty, Jupiter tan, Saturn gold, Uranus pale-cyan, Neptune blue). Dots are fixed screen size (DOM) so they read as "stars," not balloons.
- **Sun:** a bright glowing disk at the sub-solar point (visually consistent with the existing day/night lighting direction).
- **Labels:** small, fixed-size, beneath/beside each body. **Fade in as the camera zooms out** (above a distance threshold) so they don't clutter the close-up Earth view.
- `update(date: Date)`: recompute every body's sub-point (planets via `planetSubpoint`, Sun via `subsolarPoint`) and write `datum.lat/lng`. Called from `main`'s `draw()` so the sky tracks the playhead.

Interface (shape):
```ts
export interface SkyLayer {
  data: SkyDatum[]                 // for htmlElementsData
  elementFor(d: SkyDatum): HTMLElement
  update(date: Date): void
  bodies: { datum: SkyDatum; el: HTMLElement; halfSize: number }[]  // for occlusion
}
export function createSkyLayer(): SkyLayer
```
where `SkyDatum = { type: 'sky'; id: PlanetId | 'sun'; lat; lng; alt }`.

### 3. Occlusion — generalize the Moon's limb-clip

The Moon's `applyMoonOcclusion` (currently inline in `main.ts`) is lifted into a reusable helper:

```ts
// src/globe/skyOcclusion.ts  (or exported from skyLayer)
export function clipBehindEarth(el: HTMLElement, halfSize: number,
  cam: Vec3, camDist: number, globe: any, viewport: HTMLElement,
  lat: number, lng: number, alt: number): void
```
It applies the same screen-space limb-clip (hide the part overlapping Earth's on-screen disk while the body is on the far side) to the Sun and each planet, parameterized by the element's half-size (the Moon used 42 for its 84px box). The Moon switches to this shared helper. So **every sky body slides behind Earth's edge** — no popping.

### 4. Zoom out — `src/globe/globeScene.ts`

Raise `controls().maxDistance` from `600` to `~2500` (tunable) so the camera can pull back to reveal the sky. `SKY_ALT` is chosen so the sky sphere sits beyond `maxDistance` (camera stays inside it, looking out at the bodies). `minDistance` unchanged.

### 5. Wiring — `src/main.ts`

- Build the sky layer; merge its `data` into the `htmlElementsData` array (currently `[moon.datum, beacon.datum]` → `[...sky.data, moon.datum, beacon.datum]`) and extend `htmlElement` dispatch to return sky elements for `type:'sky'`.
- In `draw()`: `sky.update(new Date(playhead))` and apply `clipBehindEarth` to every sky body (and the Moon) each frame.
- Label fade: in the camera-change / draw path, set a CSS class or opacity on labels based on `camDist` vs a threshold.

## Data flow

```
playhead date ──> sky.update(date) ──> per body: ephemeris sub-point ──> datum.lat/lng
              ──> globe.htmlElementsData(...) repositions DOM bodies
camera change ──> clipBehindEarth(each body) ──> limb occlusion + label fade
```

Same cadence as the existing Moon/day-night updates; no new timers.

## Performance

~9 DOM bodies (Sun + 7 planets + Moon) + beacon, updated per frame during playback. Each ephemeris call is a handful of trig ops + one Kepler Newton solve (~3 iterations); 7 planets ≈ negligible. No throttling needed; if ever required, planets move slowly and could update less often.

## Testing

- **`tests/planets.test.ts`** — for a fixed reference date, assert each planet's computed sub-point (or RA/Dec) matches a published almanac value within ~0.5°. Assert determinism and that `PLANET_IDS` covers all seven.
- Ephemeris is fully pure → unit-tested. The DOM sky layer, occlusion, label fade, and zoom feel are verified live (auth-gated app).

## Edge cases

- A body behind the Earth (far side / below the local horizon) → clipped/hidden by `clipBehindEarth`.
- Daytime: planets/Sun still placed correctly; the Sun is bright, planets near the Sun may overlap — acceptable (true to life).
- Very wide zoom-out: Earth small, sky bodies surround it; day/night shader and starfield backdrop unchanged.
- Labels overlapping when bodies cluster (e.g., several planets near the Sun) — accept for v1; revisit if noisy.

## Tunables (dial in live)

Max zoom-out distance, `SKY_ALT` (sky radius), per-planet dot size & color, the Sun's size/glow, label fade threshold.

## Follow-up (out of scope here)

- **ISS:** live "now" position via a current TLE / API, decoupled from the timeline — its own spec.
