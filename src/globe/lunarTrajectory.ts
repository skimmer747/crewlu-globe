import * as THREE from 'three'
import { geoToCartesian } from './occlusion'

// Earth–Moon round trip ("to the Moon and back"): ~207,560 nm each way.
export const LUNAR_RETURN_NM = 415119

/** How many Earth–Moon round trips a mileage covers. */
export function lunarReturns(miles: number): number {
  return miles / LUNAR_RETURN_NM
}

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const mag = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => { const l = mag(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const lerp = (a: V3, b: V3, f: number): V3 => add(scale(a, 1 - f), scale(b, f))

function cartesianToGeo(p: V3, R: number): { lat: number; lng: number; alt: number } {
  const r = mag(p) || 1
  const lat = 90 - (Math.acos(Math.max(-1, Math.min(1, p[1] / r))) * 180) / Math.PI
  let lng = 90 - (Math.atan2(p[2], p[0]) * 180) / Math.PI
  lng = (((lng % 360) + 540) % 360) - 180
  return { lat, lng, alt: r / R - 1 }
}

export interface GeoPoint { lat: number; lng: number; alt: number }
export interface Trajectory { points: GeoPoint[]; cum: number[]; length: number }

export interface TrajectoryOpts { samples?: number; bulge?: number; loopRadius?: number; R?: number; cam?: { x: number; y: number; z: number }; start?: { lat: number; lng: number } }

function slerpV(a: V3, b: V3, f: number): V3 {
  const d = Math.max(-1, Math.min(1, dot(a, b)))
  const th = Math.acos(d)
  if (th < 1e-6) return a
  const s = Math.sin(th)
  return add(scale(a, Math.sin((1 - f) * th) / s), scale(b, Math.sin(f * th) / s))
}

// Launch/entry arc between a surface point and a deep-space point: the direction turns early
// (f^0.6) while the radius climbs late (f^1.6), so the path can start anywhere on Earth — even
// facing away from the Moon — and arcs over the horizon without ever entering the sphere
// (radius is monotonic and never below the surface, unlike a straight chord).
function sweep(surf: V3, deep: V3, f: number): V3 {
  const dir = slerpV(norm(surf), norm(deep), Math.pow(f, 0.6))
  const r = mag(surf) + (mag(deep) - mag(surf)) * Math.pow(f, 1.6)
  return scale(dir, r)
}

/**
 * One full Earth → loop-around-Moon → Earth "free-return" path, sampled as geo points
 * (lat/lng/alt) with a cumulative 3-D length array so a fraction of the path can be sliced.
 */
export function buildTrajectoryPoints(moonLat: number, moonLng: number, moonAlt: number, opts: TrajectoryOpts = {}): Trajectory {
  const R = opts.R ?? 100
  const N = opts.samples ?? 260
  const loopRadius = opts.loopRadius ?? 45 // radius of the swing around the Moon (scene units; sized to hug the Moon disk, ~28 units equiv at the lunar view)

  const mc = geoToCartesian(moonLat, moonLng, moonAlt, R)
  const M: V3 = [mc.x, mc.y, mc.z]
  const u = norm(M)                                  // Earth -> Moon
  // The loop swings across `w`. Pick `w` perpendicular to BOTH the Earth–Moon line and the
  // view direction, so the swing spreads sideways across the screen and reads as an arc around
  // the Moon. The old north-based `w` sat nearly along the lunar-view camera axis (which is 90°
  // around from the Moon), collapsing the loop edge-on. Fall back to north if no camera given.
  let w: V3
  const cw = opts.cam ? cross(u, norm([opts.cam.x, opts.cam.y, opts.cam.z])) : ([0, 0, 0] as V3)
  if (opts.cam && mag(cw) > 1e-6) {
    w = norm(cw)
  } else {
    let v = sub([0, 1, 0], scale(u, dot([0, 1, 0], u)))
    if (mag(v) < 1e-6) v = sub([1, 0, 0], scale(u, dot([1, 0, 0], u)))
    v = norm(v)
    w = norm(cross(u, v))
  }

  const sideA = add(M, scale(w, -loopRadius))             // out-leg reaches the Moon on this side
  const sideB = add(M, scale(w, loopRadius))             // return-leg departs from the other side
  const anchored = !!opts.start
  const Estart = anchored
    ? (() => { const c = geoToCartesian(opts.start!.lat, opts.start!.lng, 0, R); return [c.x, c.y, c.z] as V3 })()
    : scale(norm(add(u, scale(w, -0.03))), R)  // Earth surface, biased toward side A
  // Anchored missions come home just beside the pad (nudged along w) so out/return don't overlap.
  const Eend = anchored
    ? scale(norm(add(norm(Estart), scale(w, 0.06))), R)
    : scale(norm(add(u, scale(w, 0.03))), R)   //                          toward side B

  const No = Math.floor(N * 0.4), Nl = Math.floor(N * 0.2)
  const pts: V3[] = []
  for (let i = 0; i < No; i++) pts.push(anchored ? sweep(Estart, sideA, i / No) : lerp(Estart, sideA, i / No)) // out to side A
  for (let i = 0; i <= Nl; i++) { const a = -Math.PI / 2 + Math.PI * (i / Nl); pts.push(add(M, add(scale(u, loopRadius * Math.cos(a)), scale(w, loopRadius * Math.sin(a))))) } // around the far side, A -> B
  const Nr = N - pts.length
  for (let i = 1; i <= Nr; i++) pts.push(anchored ? sweep(Eend, sideB, 1 - i / Nr) : lerp(sideB, Eend, i / Nr)) // back from side B

  const points = pts.map((p) => cartesianToGeo(p, R))
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + mag(sub(pts[i], pts[i - 1])))
  return { points, cum, length: cum[cum.length - 1] }
}

/** Geo point at a fraction [0..1] of the path's length. */
export function pointAtFraction(t: Trajectory, fraction: number): GeoPoint {
  const f = Math.max(0, Math.min(1, fraction))
  const target = f * t.length
  let i = 1
  while (i < t.cum.length && t.cum[i] < target) i++
  if (i >= t.points.length) return t.points[t.points.length - 1]
  const a = t.points[i - 1], b = t.points[i]
  const seg = t.cum[i] - t.cum[i - 1] || 1
  const k = (target - t.cum[i - 1]) / seg
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k, alt: a.alt + (b.alt - a.alt) * k }
}

export interface LunarTrajectory {
  setPath(t: Trajectory): void
  setReveal(fraction: number): void // 0..1 of the path length
  setMarker(fraction: number | null): void // "YOU ARE HERE" glow on the path; null hides it
  tick(nowMs: number): void // pulses the marker; no-op when hidden
  hide(): void
}

/**
 * Renders the trajectory as a true 3-D dashed line (depth-occluded by the Earth).
 * The line is added directly to globe.gl's THREE scene rather than via the custom-layer
 * slot — that slot is a single global accessor owned by the flight dart (dartLayer), and
 * sharing it makes whichever module registers last hijack the other's object.
 */
export function createLunarTrajectory(globe: any): LunarTrajectory {
  let traj: Trajectory | null = null
  let line: any = null
  const mat = new THREE.LineDashedMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.95, dashSize: 70, gapSize: 45, depthWrite: false })

  const indexForFraction = (f: number): number => {
    if (!traj) return 0
    const target = Math.max(0, Math.min(1, f)) * traj.length
    let k = 1
    while (k < traj.cum.length && traj.cum[k] <= target) k++
    return k
  }

  const removeLine = () => {
    if (line) { globe.scene().remove(line); line.geometry.dispose(); line = null }
  }

  let marker: any = null
  const MARKER_SIZE = 60
  const markerTexture = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30)
    g.addColorStop(0, 'rgba(255,215,120,1)'); g.addColorStop(0.35, 'rgba(255,215,120,0.55)'); g.addColorStop(1, 'rgba(255,215,120,0)')
    x.fillStyle = g; x.fillRect(0, 0, 64, 64)
    return new THREE.CanvasTexture(c)
  })()
  const removeMarker = () => {
    if (marker) { globe.scene().remove(marker); marker.material.dispose(); marker = null }
  }

  return {
    setPath(t) {
      traj = t
      const pos: number[] = []
      for (const p of t.points) { const c = globe.getCoords(p.lat, p.lng, p.alt); pos.push(c.x, c.y, c.z) }
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      removeLine()
      line = new THREE.Line(geom, mat)
      line.computeLineDistances()
      line.geometry.setDrawRange(0, 0)
      globe.scene().add(line)
    },
    setReveal(fraction) {
      if (!line || !traj) return
      line.geometry.setDrawRange(0, indexForFraction(fraction))
    },
    setMarker(fraction) {
      if (fraction == null || !traj) { removeMarker(); return }
      if (!marker) {
        marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture, transparent: true, depthWrite: false }))
        globe.scene().add(marker)
      }
      const p = pointAtFraction(traj, fraction)
      const c = globe.getCoords(p.lat, p.lng, p.alt)
      marker.position.set(c.x, c.y, c.z)
      marker.scale.set(MARKER_SIZE, MARKER_SIZE, 1)
    },
    tick(nowMs) {
      if (!marker) return
      const k = 1 + 0.18 * Math.sin(nowMs / 260)
      marker.scale.set(MARKER_SIZE * k, MARKER_SIZE * k, 1)
    },
    hide() { removeLine(); removeMarker() },
  }
}

/** Slice the path to a fraction [0..1] of its length (for the "extend to your mileage" reveal). */
export function sliceTrajectory(t: Trajectory, fraction: number): GeoPoint[] {
  const f = Math.max(0, Math.min(1, fraction))
  if (f <= 0) return []
  const target = f * t.length
  const out: GeoPoint[] = []
  for (let i = 0; i < t.points.length; i++) {
    if (t.cum[i] <= target) out.push(t.points[i])
    else {
      // interpolate the final partial point so the tip lands exactly at the fraction
      const a = t.points[i - 1], b = t.points[i]
      const seg = t.cum[i] - t.cum[i - 1] || 1
      const k = (target - t.cum[i - 1]) / seg
      out.push({ lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k, alt: a.alt + (b.alt - a.alt) * k })
      break
    }
  }
  return out
}
