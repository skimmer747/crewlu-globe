import { slerp } from '../astro/geo'
import { isOccluded } from './occlusion'
import type { Leg } from '../model'

export interface BeaconLayer {
  datum: { type: 'beacon'; lat: number; lng: number; alt: number }
  el: HTMLElement
  pos: { lat: number; lng: number }
  setAt(lat: number, lng: number): void
  flyLeg(leg: Leg, durationMs?: number): void
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
  let contrailClearAt = 0

  const setContrail = (dep: [number, number], head: [number, number], dh: boolean) => {
    const N = 28, pts: [number, number][] = [], colors: string[] = []
    const base = dh ? '255,190,120' : '170,245,255'
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1); const p = slerp(dep, head, f); const a = Math.pow(f, 1.5)
      pts.push(p); colors.push(`rgba(${f > 0.9 ? '255,255,255' : base},${(0.95 * a).toFixed(3)})`)
    }
    globe?.pathsData([{ pts, colors }])
  }

  const layer: BeaconLayer = {
    datum, el, pos,
    setContrailSink(g) {
      globe = g
      g.pathPoints((d: any) => d.pts).pathPointLat((p: any) => p[0]).pathPointLng((p: any) => p[1])
        .pathColor((d: any) => d.colors).pathStroke(2.8).pathPointAlt(0.02).pathTransitionDuration(0)
        .pathsData([])
    },
    setAt(lat, lng) { pos.lat = lat; pos.lng = lng; datum.lat = lat; datum.lng = lng; globe?.htmlElementsData(globe.htmlElementsData()) },
    flyLeg(leg, durationMs = 820) { flying = { leg, t0: performance.now(), dur: durationMs } },
    tick() {
      if (flying) {
        const p = Math.min(1, (performance.now() - flying.t0) / flying.dur)
        const at = slerp(flying.leg.s, flying.leg.e, p)
        this.setAt(at[0], at[1]); setContrail(flying.leg.s, at, flying.leg.dh)
        if (p >= 1) { this.setAt(flying.leg.e[0], flying.leg.e[1]); contrailClearAt = performance.now() + 700; flying = null }
      } else if (contrailClearAt && performance.now() > contrailClearAt) { globe?.pathsData([]); contrailClearAt = 0 }
    },
    refreshOcclusion(cam) { el.style.opacity = isOccluded(cam, datum.lat, datum.lng, datum.alt) ? '0' : '1' },
  }
  return layer
}
