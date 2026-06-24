import * as THREE from 'three'
import { slerp } from '../astro/geo'
import type { Leg } from '../model'

// A small 3D delta-dart that flies the active leg: born from nothing at takeoff, grown to
// full size at cruise, shrunk back to nothing on descent — handing off to the beacon pulse.
// Positioned/oriented per-frame against the globe via getCoords; animated from main's rAF loop.

const EARTH_NM = 3440.07      // earth radius in nautical miles (great-circle angle = miles / R)
const BASE = 3.6              // overall size in globe-radius units (globe radius = 100)
const GROW_END = 0.16         // fraction of the leg spent climbing out (scale 0 -> 1)
const SHRINK_START = 0.84     // fraction after which it descends (scale 1 -> 0)
const SKIM_ALT = 0.012        // altitude at the runway ends (globe-radius units)
const MAX_BUMP = 0.34         // cap on the mid-leg cruise climb
const CLIMB = 0.18            // how much of the great-circle angle becomes cruise altitude
const BANK = 0.3             // cruise bank angle (rad, ~17°); eased to level at the runways

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t) }

// Scale envelope across the leg: grow on climb-out, hold at cruise, shrink on descent.
function envelope(p: number): number {
  if (p <= 0 || p >= 1) return 0
  if (p < GROW_END) return smooth(p / GROW_END)
  if (p > SHRINK_START) return smooth((1 - p) / (1 - SHRINK_START))
  return 1
}

// Folded-paper delta: a high central spine (+Y) with wings folding down to the tips, nose
// forward (+Z). The two top panels are shaded as if lit from the left, so the spine crease
// reads as 3D even from straight overhead (the angle the follow-camera usually gives). A
// bright nose gradient, a glowing edge rim, a layered comet tail and an afterburner core.
function buildDart(): any {
  const N = [0, 0.18, 2.0], S = [0, 0.82, -0.95]             // nose, tall spine tail (steep roof)
  const L = [-0.95, -0.32, -1.05], R = [0.95, -0.32, -1.05], B = [0, -0.16, -0.7] // swept wingtips, belly
  const nose = new THREE.Color('#eafff6')
  const leftTop = new THREE.Color('#9effc8'), rightTop = new THREE.Color('#29a574') // strong fake side-lighting
  const belly = new THREE.Color('#1c7350'), back = new THREE.Color('#2a9263')
  const faces: [number[], any][][] = [
    [[N, nose], [L, leftTop], [S, leftTop]],    // left top panel (lit)
    [[N, nose], [S, rightTop], [R, rightTop]],  // right top panel (shaded)
    [[N, nose], [B, belly], [L, belly]],        // left belly
    [[N, nose], [R, belly], [B, belly]],        // right belly
    [[S, back], [L, back], [B, back]],          // back-left
    [[S, back], [B, back], [R, back]],          // back-right
  ]
  const pos: number[] = [], col: number[] = []
  faces.forEach((tri) => tri.forEach(([v, c]) => { pos.push(v[0], v[1], v[2]); col.push(c.r, c.g, c.b) }))

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.computeVertexNormals()

  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })))

  // Glowing edge rim — the spine crease + outline.
  group.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 18),
    new THREE.LineBasicMaterial({ color: '#eafff4', transparent: true, opacity: 0.95 }),
  ))

  // Layered comet tail: wide soft glow + brighter narrow core, flaring at the dart and
  // tapering to a point behind it (tip trailing at -Z).
  const cone = (r: number, len: number, op: number) => {
    const g = new THREE.ConeGeometry(r, len, 16, 1, true)
    g.rotateX(-Math.PI / 2)            // base (wide) toward +Z near the dart, tip trailing (-Z)
    g.translate(0, 0, -len / 2 - 0.45)
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: '#5cff9e', transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }))
  }
  group.add(cone(0.5, 3.4, 0.12))
  group.add(cone(0.22, 2.6, 0.28))

  // Afterburner core.
  const ab = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 12),
    new THREE.MeshBasicMaterial({ color: '#cdfaff', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  ab.position.set(0, 0, -0.8)
  group.add(ab)

  group.scale.setScalar(0)
  group.visible = false
  return group
}

export interface DartLayer {
  object: any
  attach(globe: any): void
  flyLeg(leg: Leg, durationMs: number): void
  tick(): void
  presence(): number   // 0 = absent, 1 = full size — drives the beacon cross-fade
  stop(): void
}

export function createDartLayer(): DartLayer {
  const object = buildDart()
  let globe: any = null
  let flying: { leg: Leg; t0: number; dur: number; ang: number } | null = null
  let pres = 0

  const coords = (lat: number, lng: number, alt: number) => {
    const c = globe.getCoords(lat, lng, alt)
    return new THREE.Vector3(c.x, c.y, c.z)
  }
  // Surface-relative altitude bump so the dart climbs out, cruises high, and descends.
  const altAt = (p: number, ang: number) => SKIM_ALT + Math.min(MAX_BUMP, ang * CLIMB) * Math.sin(Math.PI * clamp01(p))
  const at = (p: number, f: { leg: Leg; ang: number }) => {
    const [lat, lng] = slerp(f.leg.s, f.leg.e, clamp01(p))
    return coords(lat, lng, altAt(p, f.ang))
  }

  const hide = () => { pres = 0; object.visible = false; object.scale.setScalar(0) }

  return {
    object,
    attach(g) {
      globe = g
      g.customLayerData([{}]).customThreeObject(() => object).customThreeObjectUpdate(() => {})
    },
    flyLeg(leg, durationMs) { flying = { leg, t0: performance.now(), dur: Math.max(1, durationMs), ang: leg.miles / EARTH_NM } },
    presence() { return pres },
    stop() { flying = null; hide() },
    tick() {
      if (!flying || !globe) { if (pres !== 0) hide(); return }
      const p = clamp01((performance.now() - flying.t0) / flying.dur)
      pres = envelope(p)
      if (pres <= 0.001) { object.visible = false; object.scale.setScalar(0); if (p >= 1) flying = null; return }

      const pos = at(p, flying)
      // Look a hair up-track to derive a heading; the path's vertical component makes the
      // nose pitch up on climb and down on descent for free.
      const dp = p < 0.5 ? 0.012 : -0.012
      const forward = at(p + dp, flying).sub(pos)
      if (dp < 0) forward.negate()
      if (forward.lengthSq() < 1e-9) forward.set(0, 0, 1)
      forward.normalize()

      const up = pos.clone().normalize()                       // outward from globe centre
      up.sub(forward.clone().multiplyScalar(up.dot(forward))).normalize()  // orthonormalise
      const right = new THREE.Vector3().crossVectors(up, forward).normalize()

      object.position.copy(pos)
      object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward))
      object.rotateZ(BANK * pres)   // bank into cruise (roll about the nose), level for takeoff/landing
      object.scale.setScalar(pres * BASE)
      object.visible = true
      if (p >= 1) { flying = null; hide() }
    },
  }
}
