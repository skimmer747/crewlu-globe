# Realistic Moon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-drawn SVG Moon with a photographic near-side disc shaded by an astronomically correct phase terminator, with zero change to positioning, sizing, occlusion, or the phase chip.

**Architecture:** A one-off Python script projects the near side of Solar System Scope's equirectangular Moon map (CC-BY-4.0, same source as the Earth textures) into `public/textures/moon-disc.webp`. `moonLayer.ts` swaps its inline SVG for a `<canvas>` in the same 84px box: photo disc → dark-side path (limb arc + terminator half-ellipse from a new pure `terminator()` helper) filled at 0.86 alpha (earthshine) with a blurred penumbra edge. Backing resolution re-buckets with zoom (256→1024); redraws happen only on bucket or 0.1%-illumination changes.

**Tech Stack:** TypeScript/Vite, vitest, Canvas 2D, Python 3 + Pillow (asset generation only).

**Spec:** `docs/superpowers/specs/2026-07-02-realistic-moon-design.md`

**File map:**
- Modify: `src/astro/moon.ts` — add pure `terminator()` (Task 1)
- Modify: `tests/moon.test.ts` — terminator tests (Task 1)
- Create: `scripts/make-moon-disc.py` + `public/textures/moon-disc.webp` (Task 2)
- Modify: `.gitignore` — ignore the downloaded source map cache (Task 2)
- Modify: `src/globe/moonLayer.ts` — canvas rendering (Task 3)
- Modify: `src/styles.css:19-21` area — glow + canvas rules (Task 3)
- Modify: `src/globe/hud.ts:164` — credit line (Task 4)

**Repo:** everything below runs in `/Users/toddanderson/Dev/crewlu-globe`.

---

### Task 1: `terminator()` phase-geometry helper (TDD)

**Files:**
- Modify: `tests/moon.test.ts`
- Modify: `src/astro/moon.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/moon.test.ts` (it already imports from `../src/astro/moon`; extend the import and add a describe block):

```ts
import { subLunarPoint, moonPhase, terminator } from '../src/astro/moon'
```

```ts
describe('terminator', () => {
  it('new moon: dark ellipse spans the disc (b = 1)', () => {
    expect(terminator(0, false).b).toBeCloseTo(1)
  })
  it('full moon: no dark region (b = -1)', () => {
    expect(terminator(1, true).b).toBeCloseTo(-1)
  })
  it('quarter moon: straight terminator (b = 0)', () => {
    expect(terminator(0.5, false).b).toBeCloseTo(0)
  })
  it('crescent bulges toward the lit side (b > 0), gibbous toward the dark side (b < 0)', () => {
    expect(terminator(0.25, false).b).toBeCloseTo(0.5)
    expect(terminator(0.75, false).b).toBeCloseTo(-0.5)
  })
  it('dark limb is on the right exactly when waning', () => {
    expect(terminator(0.3, true).darkOnRight).toBe(true)
    expect(terminator(0.3, false).darkOnRight).toBe(false)
  })
  it('clamps out-of-range illumination', () => {
    expect(terminator(-0.2, false).b).toBe(1)
    expect(terminator(1.4, false).b).toBe(-1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/moon.test.ts`
Expected: FAIL — `terminator` is not exported.

- [ ] **Step 3: Implement `terminator()`**

Append to `src/astro/moon.ts`:

```ts
export interface Terminator { b: number; darkOnRight: boolean }

/** Terminator ellipse for a unit-radius disc. `b = 1 − 2·illum` is the signed
 *  semi-minor axis: > 0 bulges toward the LIT side, extending the dark region
 *  past center (crescent); < 0 bulges toward the dark side, shrinking the dark
 *  region to a sliver (gibbous). Dark area fraction = ½ + b/2 = 1 − illum.
 *  darkOnRight keeps the old sliding-shadow convention: waning ⇒ dark limb right. */
export function terminator(illum: number, waning: boolean): Terminator {
  const f = Math.min(1, Math.max(0, illum))
  return { b: 1 - 2 * f, darkOnRight: waning }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/moon.test.ts`
Expected: PASS (all existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add tests/moon.test.ts src/astro/moon.ts
git commit -m "feat(astro): terminator() — signed semi-minor axis of the phase terminator"
```

---

### Task 2: Moon disc asset + generation script

**Files:**
- Create: `scripts/make-moon-disc.py`
- Create: `public/textures/moon-disc.webp` (generated)
- Modify: `.gitignore`

- [ ] **Step 1: Write the projection script**

Create `scripts/make-moon-disc.py`:

```python
#!/usr/bin/env python3
"""Project the near side of an equirectangular Moon map into a square
orthographic disc with transparent corners.

Source: Solar System Scope 2k_moon.jpg (CC-BY-4.0) — same source & license as
the Earth textures; credited in the HUD tip. Downloaded on first run and
cached next to this script (cache is gitignored).

Output: public/textures/moon-disc.webp, 1024x1024 RGBA.
Usage:  python3 scripts/make-moon-disc.py
"""
import math, os, urllib.request
from PIL import Image

SRC_URL = 'https://www.solarsystemscope.com/textures/download/2k_moon.jpg'
CACHE = os.path.join(os.path.dirname(__file__), '.cache-2k_moon.jpg')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures', 'moon-disc.webp')
SIZE = 1024   # output edge (px)
SS = 2        # supersampling factor (renders at 2048, LANCZOS down to 1024)

def load_map():
    if not os.path.exists(CACHE):
        print('downloading', SRC_URL)
        req = urllib.request.Request(SRC_URL, headers={'User-Agent': 'crewlu-globe asset build'})
        with urllib.request.urlopen(req) as r, open(CACHE, 'wb') as f:
            f.write(r.read())
    return Image.open(CACHE).convert('RGB')

def main():
    src = load_map()
    sw, sh = src.size
    px = src.load()
    big = SIZE * SS
    out = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    opx = out.load()
    r = big / 2
    for j in range(big):
        y = (j + 0.5 - r) / r        # -1..1, screen-down
        for i in range(big):
            x = (i + 0.5 - r) / r    # -1..1, screen-right
            d2 = x * x + y * y
            if d2 > 1.0:
                continue             # outside the limb -> stays transparent
            z = math.sqrt(1.0 - d2)  # toward viewer
            lat = math.asin(-y)      # screen-up = +latitude
            lon = math.atan2(x, z)   # near side centered on lon 0
            u = (lon / (2 * math.pi) + 0.5) * (sw - 1)
            v = (0.5 - lat / math.pi) * (sh - 1)
            opx[i, j] = px[int(u), int(v)] + (255,)
    out = out.resize((SIZE, SIZE), Image.LANCZOS)  # supersample -> anti-aliased limb
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT, 'WEBP', quality=88, method=6)
    print('wrote', os.path.abspath(OUT), os.path.getsize(OUT), 'bytes')

if __name__ == '__main__':
    main()
```

Append to `.gitignore`:

```
scripts/.cache-*
```

- [ ] **Step 2: Run the script**

Run: `python3 scripts/make-moon-disc.py`
Expected: `downloading https://...` then `wrote .../public/textures/moon-disc.webp <bytes> bytes`. The 2048² pure-Python loop takes ~15–40 s. (Pillow 11.3.0 with WEBP support is confirmed installed.)

- [ ] **Step 3: Verify the asset**

Run: `python3 -c "from PIL import Image; im = Image.open('public/textures/moon-disc.webp'); print(im.size, im.mode)" && ls -la public/textures/moon-disc.webp`
Expected: `(1024, 1024) RGBA`; file size roughly 80–250 KB. If > 300 KB, lower `quality` to 80 and re-run.

- [ ] **Step 4: Commit**

```bash
git add scripts/make-moon-disc.py public/textures/moon-disc.webp .gitignore
git commit -m "feat(assets): photographic near-side Moon disc (Solar System Scope, CC-BY-4.0)"
```

---

### Task 3: Canvas Moon rendering in `moonLayer.ts`

**Files:**
- Modify: `src/globe/moonLayer.ts` (full rewrite below — file is 50 lines today)
- Modify: `src/styles.css` (the `.moon-*` block at lines 19–21)

**Contract that must NOT change** (main.ts:112–115 and skyOcclusion depend on it): `.moon-wrap` and `.moon-scale` stay 84×84 px; the disc renders at radius 34/120 of the box (23.8 px at scale 1); `MoonLayer.scaleEl`, `.scale`, `.datum`, `update()`, `refreshOcclusion()`, `setScale()` keep their exact signatures.

- [ ] **Step 1: Rewrite `src/globe/moonLayer.ts`**

Replace the entire file with:

```ts
import { subLunarPoint, moonPhase, terminator } from '../astro/moon'
import { isOccluded } from './occlusion'

const MOON_ALT = 59.3 // real Moon distance ≈ 60.3 Earth-radii from center (alt is from the surface)
const BOX = 84        // CSS box (px) — .moon-wrap / .moon-scale / canvas all share it
const DISC_R = 34 / 120 // disc radius as a fraction of the box (23.8px at scale 1, same as the old SVG)

export interface MoonLayer {
  datum: { type: 'moon'; lat: number; lng: number; alt: number }
  el: HTMLElement
  scaleEl: HTMLElement  // inner element carrying the CSS scale — the occlusion mask target
  scale: number         // current scale factor applied to scaleEl
  update(date: Date): void
  refreshOcclusion(cam: { x: number; y: number; z: number }): void
  setScale(k: number): void
}

export function createMoonLayer(): MoonLayer {
  const el = document.createElement('div')
  el.className = 'moon-wrap'
  el.innerHTML = `<div class="moon-scale"><div class="moon-glow"></div><canvas class="moon-canvas" width="256" height="256"></canvas></div><div class="chip moon-chip">🌖 WANING GIBBOUS · 78%</div>`
  const scaleEl = el.querySelector<HTMLElement>('.moon-scale')!
  const canvas = el.querySelector<HTMLCanvasElement>('.moon-canvas')!
  const chip = el.querySelector<HTMLDivElement>('.moon-chip')!
  const datum = { type: 'moon' as const, lat: 0, lng: 0, alt: MOON_ALT }
  let curK = 1
  let illum = 0.78, waning = true // last phase; drives draw() and its dedupe key
  let bucket = 256                // canvas backing resolution (re-buckets with zoom)
  let drawnKey = ''               // skip redraws when nothing visible changed

  // Photo texture loads async; until it decodes we draw the old flat-gradient disc
  // so the Moon never blanks out, then redraw for real.
  const photo = new Image()
  let photoReady = false
  photo.onload = () => { photoReady = true; draw() }
  photo.src = '/textures/moon-disc.webp'

  const nextBucket = (px: number) => px <= 256 ? 256 : px <= 512 ? 512 : 1024

  function draw() {
    const key = `${bucket}|${Math.round(illum * 1000)}|${waning}|${photoReady}`
    if (key === drawnKey) return
    drawnKey = key
    if (canvas.width !== bucket) { canvas.width = bucket; canvas.height = bucket }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const S = bucket, c = S / 2, r = S * DISC_R
    ctx.clearRect(0, 0, S, S)

    // 1) sunlit disc: the photo, clipped to the limb (flat gradient until it decodes)
    ctx.save()
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.clip()
    if (photoReady) ctx.drawImage(photo, c - r, c - r, r * 2, r * 2)
    else {
      const g = ctx.createRadialGradient(c - r * .35, c - r * .45, r * .1, c, c, r * 1.4)
      g.addColorStop(0, '#fbfdff'); g.addColorStop(.6, '#dde6f2'); g.addColorStop(1, '#aebcd0')
      ctx.fillStyle = g; ctx.fillRect(c - r, c - r, r * 2, r * 2)
    }
    ctx.restore()

    // 2) night side: dark-side limb arc + terminator half-ellipse, filled at .86 so the
    //    surface stays faintly visible (earthshine). Soft penumbra via canvas blur filter
    //    (pre-Safari-18 ignores ctx.filter -> hard terminator edge, acceptable fallback).
    const t = terminator(illum, waning)
    if (t.b > -1 + 1e-3) {
      const sgn = t.darkOnRight ? 1 : -1
      const blur = Math.max(1, S * 0.012)
      const R2 = r + blur * 2 // overshoot the limb so the blur never lightens the dark limb edge
      ctx.save()
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.clip()
      ;(ctx as any).filter = `blur(${blur}px)`
      ctx.beginPath()
      ctx.moveTo(c, c - R2)
      ctx.arc(c, c, R2, -Math.PI / 2, Math.PI / 2, sgn < 0) // top -> dark-side limb -> bottom
      // terminator back up: half-ellipse of half-width |b|·r; crescents bulge toward the
      // lit side (-sgn), gibbous toward the dark side (+sgn)
      const a = Math.abs(t.b) * r
      const bulgeRight = (t.b < 0 ? sgn : -sgn) > 0
      if (bulgeRight) ctx.ellipse(c, c, a, R2, 0, Math.PI / 2, -Math.PI / 2, true)
      else ctx.ellipse(c, c, a, R2, 0, Math.PI / 2, Math.PI * 1.5, false)
      ctx.closePath()
      ctx.fillStyle = 'rgba(7,11,20,0.86)'
      ctx.fill()
      ;(ctx as any).filter = 'none'
      ctx.restore()
    }
  }
  draw()

  return {
    datum, el, scaleEl,
    get scale() { return curK },
    update(date) {
      const p = subLunarPoint(date); datum.lat = p.lat; datum.lng = p.lng
      const ph = moonPhase(date)
      illum = ph.illum; waning = ph.waning
      chip.textContent = `${ph.icon} ${ph.name} · ${Math.round(ph.illum * 100)}%`
      draw() // no-op unless illum moved >= 0.1%
    },
    refreshOcclusion(cam) { el.style.opacity = isOccluded(cam, datum.lat, datum.lng, datum.alt) ? '0' : '1' },
    setScale(k) {
      curK = k
      scaleEl.style.transform = `scale(${k})`
      const want = nextBucket(BOX * k * (window.devicePixelRatio || 1))
      if (want !== bucket) { bucket = want; draw() }
    },
  }
}
```

- [ ] **Step 2: Update the Moon CSS**

In `src/styles.css`, replace lines 19–20:

```css
.moon-wrap{position:relative;width:84px;height:84px;pointer-events:none;transition:opacity .25s ease}
.moon-scale{width:84px;height:84px;transform-origin:center}
```

with:

```css
.moon-wrap{position:relative;width:84px;height:84px;pointer-events:none;transition:opacity .25s ease}
.moon-scale{position:relative;width:84px;height:84px;transform-origin:center}
.moon-glow{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(220,235,255,.32) 38%,rgba(180,210,255,0) 95%)}
.moon-canvas{position:absolute;inset:0;width:100%;height:100%}
```

(`.moon-chip` on line 21 stays untouched. The glow is the old SVG `mGlow` re-expressed in CSS, slightly toned down: alpha .40 → .32.)

- [ ] **Step 3: Type-check, test, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: no type errors; all tests pass (nothing imports the removed `MOON_DISK`); build succeeds. `main.ts:112` (`setScale`) and `:115` (`featherBehindEarth` on `scaleEl` with `boxHalf: 42`) compile unchanged — the interface is identical.

- [ ] **Step 4: Commit**

```bash
git add src/globe/moonLayer.ts src/styles.css
git commit -m "feat(moon): photographic disc + correct terminator on canvas, replaces hand-drawn SVG"
```

---

### Task 4: HUD credit line

**Files:**
- Modify: `src/globe/hud.ts:164`

- [ ] **Step 1: Extend the imagery credit**

In `src/globe/hud.ts` line 164, change:

```
EARTH IMAGERY · SOLARSYSTEMSCOPE.COM · CC-BY-4.0
```

to:

```
EARTH & MOON IMAGERY · SOLARSYSTEMSCOPE.COM · CC-BY-4.0
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/globe/hud.ts
git commit -m "chore(hud): credit Moon imagery alongside Earth (CC-BY-4.0)"
```

---

### Task 5: Visual verification (user approval gate)

**Files:** none (verification only)

- [ ] **Step 1: Start the in-app preview**

Use the `globe` launch config (`preview_start name:globe`), then navigate the preview pane to `http://localhost:8798/?demo=1`. (Preview pane only displays localhost; the moon is in the top-right sky area.)

- [ ] **Step 2: Verify the disc**

Screenshot: real maria visible on the disc, photographic look, no flat gray circles. Terminator matches the chip (e.g. chip says WANING GIBBOUS · 78% → dark sliver on the right, terminator bulging toward it, dark side faintly visible).

- [ ] **Step 3: Verify phase sweep**

Scrub the timeline dock across several days (drive via the speed slider `input` event or button `.click()` — synthetic PointerEvents on `#tlTrack` silently fail). Confirm the terminator sweeps and the chip stays in sync.

- [ ] **Step 4: Verify occlusion + zoom**

Drag the globe so the Moon passes behind the Earth: it must still feather out across the atmosphere glow (no hard edge, no rectangle). Zoom in/out: the disc stays crisp as the backing bucket steps 256→512→1024 (watch for a visible pop; if one shows, note it for tuning).

- [ ] **Step 5: Present screenshots to the user**

Expect a brightness/contrast/glow tuning round. **Do not deploy without explicit user approval.**

---

### Task 6: Deploy (ONLY after user approval in Task 5)

- [ ] **Step 1: Deploy**

Run: `npm run deploy`
Expected: vite build + gh-pages publish.

- [ ] **Step 2: Cache-safe verify**

Wait for `gh api repos/skimmer747/crewlu-globe/pages/builds/latest --jq .status` = `built`, then (cache-busted first, per the poisoning lesson):

```bash
CB=$RANDOM
curl -s "https://globe.crewlu.net/?cb=$CB" | grep -o 'assets/index-[^"]*\.js'   # hash changed vs previous deploy
curl -s -o /dev/null -w '%{http_code}\n' "https://globe.crewlu.net/textures/moon-disc.webp?cb=$CB" -r 0-0   # 200/206
```

Expected: new bundle hash; texture reachable.
