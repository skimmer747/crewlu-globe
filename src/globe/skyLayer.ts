import { subsolarPoint } from '../astro/sun'
import { planetSubpoint, PLANET_IDS, type PlanetId } from '../astro/planets'

// Altitude of the "sky sphere" (Earth radii). Must sit beyond the camera's maxDistance
// so the camera stays inside it and looks out at the bodies in their real sky directions.
export const SKY_ALT = 250 // far out so the Sun reads as distant sky (don't bunch near Earth when zoomed way out)
// Planets ride just over the Earth so they cross the front of the disk as it spins (distant points
// can't — by geometry they project off to the sides). Their HUD overlays keep them visible in front.
export const PLANET_ALT = 0.55

export interface SkyDatum { type: 'sky'; id: string; lat: number; lng: number; alt: number }
export interface SkyBody { id: string; datum: SkyDatum; el: HTMLElement; halfSize: number; occlude: 'clip' | 'hide' }
export interface SkyLayer {
  data: SkyDatum[]
  bodies: SkyBody[]
  elementFor(id: string): HTMLElement
  update(date: Date): void
}

const PLANETS: Record<PlanetId, { name: string; color: string; size: number }> = {
  mercury: { name: 'MERCURY', color: '#b8b2a8', size: 6 },
  venus: { name: 'VENUS', color: '#f3e7bd', size: 9 },
  mars: { name: 'MARS', color: '#e07a4a', size: 7 },
  jupiter: { name: 'JUPITER', color: '#d8be94', size: 9 },
  saturn: { name: 'SATURN', color: '#e6d49a', size: 8 },
  uranus: { name: 'URANUS', color: '#a9e3ea', size: 6 },
  neptune: { name: 'NEPTUNE', color: '#7b97ff', size: 6 },
}

export function createSkyLayer(): SkyLayer {
  const bodies: SkyBody[] = []

  // Sun — a glowing disk at the sub-solar point.
  const sunEl = document.createElement('div')
  sunEl.className = 'sky-body sky-sun'
  sunEl.innerHTML = `<div class="sky-label">SUN</div>`
  bodies.push({ id: 'sun', datum: { type: 'sky', id: 'sun', lat: 0, lng: 0, alt: SKY_ALT }, el: sunEl, halfSize: 30, occlude: 'clip' })

  // Planets — colored dots with name labels.
  for (const id of PLANET_IDS) {
    const p = PLANETS[id]
    const el = document.createElement('div')
    el.className = 'sky-body sky-planet'
    el.style.width = el.style.height = `${p.size}px`
    el.style.background = p.color
    el.style.boxShadow = `0 0 7px 1px ${p.color}`
    el.innerHTML = `<div class="sky-label">${p.name}</div>`
    bodies.push({ id, datum: { type: 'sky', id, lat: 0, lng: 0, alt: PLANET_ALT }, el, halfSize: p.size / 2, occlude: 'hide' })
  }

  const byId = new Map(bodies.map((b) => [b.id, b.el]))
  const byIdBody = new Map(bodies.map((b) => [b.id, b]))

  return {
    data: bodies.map((b) => b.datum),
    bodies,
    elementFor(id) { return byId.get(id)! },
    update(date) {
      const sun = byIdBody.get('sun')!
      const s = subsolarPoint(date)
      sun.datum.lat = s.lat; sun.datum.lng = s.lng
      for (const id of PLANET_IDS) {
        const b = byIdBody.get(id)!
        const sp = planetSubpoint(id, date)
        b.datum.lat = sp.lat; b.datum.lng = sp.lng
      }
    },
  }
}
