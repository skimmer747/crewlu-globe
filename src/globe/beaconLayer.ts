import { slerp } from '../astro/geo'
import { isOccluded } from './occlusion'
import type { Leg } from '../model'

export interface BeaconLayer {
  datum: { type: 'beacon'; lat: number; lng: number; alt: number }
  el: HTMLElement
  pos: { lat: number; lng: number }
  setAt(lat: number, lng: number): void
  flyLeg(leg: Leg, durationMs?: number): void
  halt(): void
  setVeil(v: number): void
  tick(): void
  refreshOcclusion(cam: { x: number; y: number; z: number }): void
  setContrailSink(globe: any): void
}

export function createBeaconLayer(): BeaconLayer {
  const el = document.createElement('div')
  el.className = 'beacon-wrap'
  el.innerHTML = `<div class="beacon-ring"></div><div class="beacon-ring" style="animation-delay:.85s"></div><div class="beacon-dot"></div>`
  const datum = { type: 'beacon' as const, lat: 38.17, lng: -85.74, alt: 0.02 }
  const pos = { lat: datum.lat, lng: datum.lng }
  let globe: any = null
  let flying: { leg: Leg; t0: number; dur: number } | null = null
  let occluded = false
  let veil = 0 // 0 = visible, 1 = hidden; cross-faded by the dart so the plane dissolves into the pulse

  const applyOpacity = () => { el.style.opacity = occluded ? '0' : String(1 - veil) }

  const layer: BeaconLayer = {
    datum, el, pos,
    setContrailSink(g) {
      globe = g
      g.pathPoints((d: any) => d.pts).pathPointLat((p: any) => p[0]).pathPointLng((p: any) => p[1])
        .pathColor((d: any) => d.colors).pathStroke(3.4).pathPointAlt(0.02).pathTransitionDuration(0)
        .pathsData([])
    },
    setAt(lat, lng) { pos.lat = lat; pos.lng = lng; datum.lat = lat; datum.lng = lng; globe?.htmlElementsData(globe.htmlElementsData()) },
    flyLeg(leg, durationMs = 820) { flying = { leg, t0: performance.now(), dur: durationMs } },
    halt() { flying = null },
    setVeil(v) { veil = Math.min(1, Math.max(0, v)); applyOpacity() },
    tick() {
      if (!flying) return
      const p = Math.min(1, (performance.now() - flying.t0) / flying.dur)
      const at = slerp(flying.leg.s, flying.leg.e, p)
      this.setAt(at[0], at[1])
      if (p >= 1) { this.setAt(flying.leg.e[0], flying.leg.e[1]); flying = null }
    },
    refreshOcclusion(cam) { occluded = isOccluded(cam, datum.lat, datum.lng, datum.alt); applyOpacity() },
  }
  return layer
}
