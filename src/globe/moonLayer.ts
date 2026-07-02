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
  photo.onerror = () => console.warn('moon-disc.webp failed to load — using gradient fallback')
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
      ctx.filter = `blur(${blur}px)`
      ctx.beginPath()
      ctx.moveTo(c, c - R2)
      ctx.arc(c, c, R2, -Math.PI / 2, Math.PI / 2, sgn < 0) // top -> dark-side limb -> bottom
      // terminator back up: half-ellipse of half-width |b|·r; crescents bulge toward the
      // lit side (-sgn), gibbous toward the dark side (+sgn)
      // terminator with true radiusY = r so thin-crescent horns pinch to the poles;
      // lineTo legs stitch the r <-> R2 gap along the centerline (zero enclosed area)
      const a = Math.abs(t.b) * r
      const bulgeRight = (t.b < 0 ? sgn : -sgn) > 0
      ctx.lineTo(c, c + r)
      if (bulgeRight) ctx.ellipse(c, c, a, r, 0, Math.PI / 2, -Math.PI / 2, true)
      else ctx.ellipse(c, c, a, r, 0, Math.PI / 2, Math.PI * 1.5, false)
      ctx.lineTo(c, c - R2)
      ctx.closePath()
      ctx.fillStyle = 'rgba(7,11,20,0.86)'
      ctx.fill()
      ctx.filter = 'none'
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
