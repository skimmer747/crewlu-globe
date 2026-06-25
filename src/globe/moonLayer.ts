import { subLunarPoint, moonPhase } from '../astro/moon'
import { isOccluded } from './occlusion'

const MOON_ALT = 59.3 // real Moon distance ≈ 60.3 Earth-radii from center (alt is from the surface)

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
  el.innerHTML = `<div class="moon-scale">${MOON_DISK}</div><div class="chip moon-chip">🌖 WANING GIBBOUS · 78%</div>`
  const scaleEl = el.querySelector<HTMLElement>('.moon-scale')!
  const shadow = el.querySelector<SVGCircleElement>('.moonShadow')!
  const chip = el.querySelector<HTMLDivElement>('.moon-chip')!
  const datum = { type: 'moon' as const, lat: 0, lng: 0, alt: MOON_ALT }
  let curK = 1

  return {
    datum, el, scaleEl,
    get scale() { return curK },
    update(date) {
      const p = subLunarPoint(date); datum.lat = p.lat; datum.lng = p.lng
      const ph = moonPhase(date)
      const dx = (ph.waning ? 1 : -1) * ph.illum * 60
      shadow.setAttribute('cx', String(60 + dx))
      chip.textContent = `${ph.icon} ${ph.name} · ${Math.round(ph.illum * 100)}%`
    },
    refreshOcclusion(cam) { el.style.opacity = isOccluded(cam, datum.lat, datum.lng, datum.alt) ? '0' : '1' },
    setScale(k) { curK = k; scaleEl.style.transform = `scale(${k})` },
  }
}

const MOON_DISK = `<svg viewBox="0 0 120 120" width="84" height="84" style="overflow:visible">
    <defs>
      <radialGradient id="mGlow" cx="50%" cy="50%" r="50%"><stop offset="40%" stop-color="rgba(220,235,255,.4)"/><stop offset="100%" stop-color="rgba(180,210,255,0)"/></radialGradient>
      <radialGradient id="mFace" cx="38%" cy="34%" r="75%"><stop offset="0%" stop-color="#fbfdff"/><stop offset="60%" stop-color="#dde6f2"/><stop offset="100%" stop-color="#aebcd0"/></radialGradient>
      <clipPath id="mClip"><circle cx="60" cy="60" r="34"/></clipPath>
    </defs>
    <circle cx="60" cy="60" r="58" fill="url(#mGlow)"/><circle cx="60" cy="60" r="34" fill="url(#mFace)"/>
    <g clip-path="url(#mClip)" fill="#b9c6d8" opacity=".5"><circle cx="50" cy="48" r="6"/><circle cx="68" cy="66" r="8"/><circle cx="55" cy="74" r="4"/><circle cx="72" cy="45" r="3.5"/></g>
    <g clip-path="url(#mClip)"><circle class="moonShadow" cx="34" cy="58" r="34" fill="#070b14" opacity=".84"/></g>
  </svg>`
