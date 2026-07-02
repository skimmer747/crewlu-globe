import * as THREE from 'three'
import { slerp } from '../astro/geo'
import type { Leg } from '../model'

// A small 3D delta-dart that flies the active leg: born from nothing at takeoff, grown to
// full size at cruise, shrunk back to nothing on descent — handing off to the beacon pulse.
// Positioned/oriented per-frame against the globe via getCoords; animated from main's rAF loop.

const EARTH_NM = 3440.07      // earth radius in nautical miles (great-circle angle = miles / R)
// Size scales with the leg's length (globe radius = 100, so surface arc = 100 * angle): a
// short hop gets a small dart, a long haul a larger one — clamped at both ends so it never
// dwarfs a short route or balloons on a transcon.
const SIZE_FRAC = 0.11       // dart length ≈ this fraction of the leg's surface arc...
const MIN_SIZE = 1.3         // ...floored so short hops still show a small dart
const MAX_SIZE = 5.0         // ...and capped so long hauls don't get huge
const GEOM_LEN = 3.05        // nose-to-tail length of the unit geometry
const CLIMB_MS = 20 * 60000   // real-time climb-out duration mapped onto the leg
const DESCENT_MS = 30 * 60000 // real-time descent duration mapped onto the leg
const SKIM_ALT = 0.012        // altitude at the runway ends (globe-radius units)
const MAX_BUMP = 0.34         // cap on the mid-leg cruise climb
const CLIMB = 0.18            // how much of the great-circle angle becomes cruise altitude
const BANK = 0.3             // cruise bank angle (rad, ~17°); eased to level at the runways

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t) }

export interface EnvelopeFractions { growEnd: number; shrinkStart: number }

/**
 * Time-honest climb/descent fractions for a leg: ~20 min of climb and ~30 min of descent
 * as fractions of the actual airborne span, clamped so short hops still animate and a
 * degenerate span can't invert the envelope. A 14-hour leg cruises level for ~13 hours.
 */
export function envelopeFractions(airborneMs: number): EnvelopeFractions {
  const g = Math.min(0.45, Math.max(0.05, CLIMB_MS / Math.max(1, airborneMs)))
  const d = Math.min(0.45, Math.max(0.06, DESCENT_MS / Math.max(1, airborneMs)))
  return { growEnd: g, shrinkStart: 1 - d }
}

// Scale envelope across the leg: grow on climb-out, hold at cruise, shrink on descent.
function envelope(p: number, f: EnvelopeFractions): number {
  if (p <= 0 || p >= 1) return 0
  if (p < f.growEnd) return smooth(p / f.growEnd)
  if (p > f.shrinkStart) return smooth((1 - p) / (1 - f.shrinkStart))
  return 1
}

// Folded-paper delta: a high central spine (+Y) with wings folding down to the tips, nose
// forward (+Z). The two top panels are shaded as if lit from the left, so the spine crease
// reads as 3D even from straight overhead (the angle the follow-camera usually gives). A
// bright nose gradient, a glowing edge rim, a layered comet tail and an afterburner core.
function buildDart(): any {
  const N = [0, 0.18, 2.0], S = [0, 0.82, -0.95]             // nose, tall spine tail (steep roof)
  const L = [-0.95, -0.32, -1.05], R = [0.95, -0.32, -1.05], B = [0, -0.16, -0.7] // swept wingtips, belly
  const nose = new THREE.Color('#ffffff')
  const leftTop = new THREE.Color('#ffffff'), rightTop = new THREE.Color('#a8b8c8') // fake side-lighting (lit vs shaded)
  const belly = new THREE.Color('#5f6e7d'), back = new THREE.Color('#869aab')
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
    new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95 }),
  ))

  // Layered comet tail: wide soft glow + brighter narrow core, flaring at the dart and
  // tapering to a point behind it (tip trailing at -Z).
  const cone = (r: number, len: number, op: number) => {
    const g = new THREE.ConeGeometry(r, len, 16, 1, true)
    g.rotateX(-Math.PI / 2)            // base (wide) toward +Z near the dart, tip trailing (-Z)
    g.translate(0, 0, -len / 2 - 0.45)
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: '#dce9ff', transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }))
  }
  group.add(cone(0.5, 3.4, 0.12))
  group.add(cone(0.22, 2.6, 0.28))

  // Afterburner core.
  const ab = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 12),
    new THREE.MeshBasicMaterial({ color: '#eef6ff', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
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
  geoPos(): [number, number, number] | null // [lat, lng, alt] while flying — feeds the contrail
  stop(): void
}

export function createDartLayer(): DartLayer {
  const object = buildDart()
  let globe: any = null
  let flying: { leg: Leg; t0: number; dur: number; ang: number; frac: EnvelopeFractions } | null = null
  let pres = 0
  let lastGeo: [number, number, number] | null = null

  const coords = (lat: number, lng: number, alt: number) => {
    const c = globe.getCoords(lat, lng, alt)
    return new THREE.Vector3(c.x, c.y, c.z)
  }
  // Surface-relative altitude: climb over the time-based climb fraction, hold a cruise
  // plateau, descend over the descent fraction — no more sine "climb" across a whole leg.
  const altAt = (p: number, ang: number, f: EnvelopeFractions) => {
    p = clamp01(p)
    const rise = smooth(Math.min(1, p / f.growEnd))
    const fall = smooth(Math.min(1, (1 - p) / (1 - f.shrinkStart)))
    return SKIM_ALT + Math.min(MAX_BUMP, ang * CLIMB) * Math.min(rise, fall)
  }
  const at = (p: number, f: { leg: Leg; ang: number; frac: EnvelopeFractions }) => {
    const [lat, lng] = slerp(f.leg.s, f.leg.e, clamp01(p))
    return coords(lat, lng, altAt(p, f.ang, f.frac))
  }

  const hide = () => { pres = 0; lastGeo = null; object.visible = false; object.scale.setScalar(0) }

  return {
    object,
    attach(g) {
      globe = g
      g.customLayerData([{}]).customThreeObject(() => object).customThreeObjectUpdate(() => {})
    },
    flyLeg(leg, durationMs) { flying = { leg, t0: performance.now(), dur: Math.max(1, durationMs), ang: leg.miles / EARTH_NM, frac: envelopeFractions(leg.landing - leg.takeoff) } },
    presence() { return pres },
    geoPos() { return lastGeo },
    stop() { flying = null; hide() },
    tick() {
      if (!flying || !globe) { if (pres !== 0) hide(); return }
      const p = clamp01((performance.now() - flying.t0) / flying.dur)
      pres = envelope(p, flying.frac)
      if (pres <= 0.001) { object.visible = false; object.scale.setScalar(0); if (p >= 1) flying = null; return }

      const [glat, glng] = slerp(flying.leg.s, flying.leg.e, clamp01(p))
      const galt = altAt(p, flying.ang, flying.frac)
      lastGeo = [glat, glng, galt]
      const pos = coords(glat, glng, galt)
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
      const legLen = Math.min(MAX_SIZE, Math.max(MIN_SIZE, SIZE_FRAC * 100 * flying.ang)) // size by leg length
      object.scale.setScalar(pres * legLen / GEOM_LEN)
      object.visible = true
      if (p >= 1) { flying = null; hide() }
    },
  }
}
