import * as THREE from 'three'
import type { Trajectory } from './lunarTrajectory'
import type { MoonMesh } from './moonMesh'
import { buildDart } from './dartLayer'

// Chase-cam flight along the lunar free-return path. The dart (the same ship that flies legs)
// rides the trajectory; the camera orbits it with keyframed pacing (beats below) — ahead of it
// looking back at the shrinking Earth on ascent, swinging around it at the turnaround, tight
// behind it over the lunar surface. OrbitControls are suspended for the duration; every exit
// (finish, skip, cancel) restores controls, the camera's up vector, and removes the ship.

export interface CineDeps {
  globe: any
  moonMesh: MoonMesh
  onFrame(): void                    // per-frame side effects (occlusion + shader refresh)
  onTelemetry(text: string): void
  onEvent(text: string): void
  setReveal(f: number): void         // trajectory dashes reveal just ahead of the ship
}

export interface CinePlayOpts {
  traj: Trajectory
  moonCenter: { x: number; y: number; z: number }
  milesFraction: number | null       // 0..1 → "YOU ARE HERE" callout as we pass it; null = none
}

export interface LunarCinematic {
  play(opts: CinePlayOpts): Promise<boolean> // resolves false if cancelled
  cancel(): void
  skip(): void
  isPlaying(): boolean
  totalMs: number
}

const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const easeInOutSine = (k: number) => -(Math.cos(Math.PI * k) - 1) / 2
const easeInCubic = (k: number) => k * k * k

// Camera rig relative to the ship: `theta` is the azimuth of the camera around the ship's up
// axis, in degrees from dead-ahead (0 = in front, looking back at the ship; 180 = classic
// chase). `dist`/`rise` are scene units. The camera always LOOKS AT the ship, so theta really
// chooses the backdrop: small theta puts the flown path + Earth behind the ship, big theta
// puts the destination ahead of it.
export interface CamRig { theta: number; dist: number; rise: number }
interface Beat { dur: number; u1: number; ease: (k: number) => number; cam1: CamRig }

// u = arc-length fraction of the path. The Moon loop is only ~1.2% of the path's length, so
// time maps to u through beats: skim/earthrise crawl through that sliver while ascent/return
// sprint across the empty two-hundred-thousand-mile legs.
const BEATS: Beat[] = [
  { dur: 3000, u1: 0.012, ease: easeInCubic,    cam1: { theta: 30, dist: 20, rise: 9 } },   // ignition: hover ahead, dart + pad below
  { dur: 6000, u1: 0.30,  ease: easeInOutCubic, cam1: { theta: 38, dist: 24, rise: 7 } },   // ascent: Earth shrinks behind the ship
  { dur: 5000, u1: 0.462, ease: easeInOutSine,  cam1: { theta: 165, dist: 26, rise: 8 } },  // coast: swing around the ship to face the Moon
  { dur: 5000, u1: 0.499, ease: easeInOutSine,  cam1: { theta: 178, dist: 22, rise: 6 } },  // lunar skim: tight chase over the surface
  { dur: 4000, u1: 0.505, ease: easeInOutSine,  cam1: { theta: 135, dist: 24, rise: 8 } },  // earthrise: side angle — ship, limb, Earth
  { dur: 4000, u1: 0.985, ease: easeInOutCubic, cam1: { theta: 178, dist: 27, rise: 10 } }, // return sprint: chase home
]
export const MISSION_TOTAL_MS = BEATS.reduce((s, b) => s + b.dur, 0)
const CAM0: CamRig = { theta: 30, dist: 20, rise: 9 }

/** Pure timeline lookup: elapsed ms → path fraction + camera rig. Exported for tests. */
export function missionStateAt(elapsedMs: number): { u: number; cam: CamRig } {
  const t = Math.max(0, Math.min(MISSION_TOTAL_MS, elapsedMs))
  let acc = 0
  let u0 = 0
  let cam0 = CAM0
  for (const b of BEATS) {
    if (t <= acc + b.dur) {
      const k = (t - acc) / b.dur
      const e = b.ease(k)
      return {
        u: u0 + (b.u1 - u0) * e,
        cam: {
          theta: cam0.theta + (b.cam1.theta - cam0.theta) * k,
          dist: cam0.dist + (b.cam1.dist - cam0.dist) * k,
          rise: cam0.rise + (b.cam1.rise - cam0.rise) * k,
        },
      }
    }
    acc += b.dur; u0 = b.u1; cam0 = b.cam1
  }
  return { u: BEATS[BEATS.length - 1].u1, cam: BEATS[BEATS.length - 1].cam1 }
}

/** Mission elapsed time, hours → "HHH:MM:SS". Exported for tests. */
export function fmtMet(hours: number): string {
  const s = Math.floor(hours * 3600)
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  return `${String(hh).padStart(3, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

// smoothstep that ramps 0→1 as x falls from `far` to `near`.
const proximity = (far: number, near: number, x: number) => {
  const k = Math.max(0, Math.min(1, (far - x) / (far - near)))
  return k * k * (3 - 2 * k)
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const MET_TOTAL_H = 145.2   // a free-return mission is ~6 days, compressed into the flight
const NM_PER_UNIT = 34.4    // 100 scene units = Earth radius = 3,440 NM
const PATH_NM = 415119
const SHIP_SCALE = 1.85     // dart geometry is ~3 units nose-to-tail → ~5.6 units, reads at chase distance
const D2R = Math.PI / 180

export function createLunarCinematic(deps: CineDeps): LunarCinematic {
  let playing = false
  let cancelled = false
  let raf = 0
  let skipping = false
  let resolveRun: ((ok: boolean) => void) | null = null
  let cleanups: (() => void)[] = []

  const stop = (ok: boolean) => {
    cancelAnimationFrame(raf)
    for (const fn of cleanups) fn()
    cleanups = []
    if (playing) {
      playing = false
      deps.globe.controls().enabled = true
      deps.globe.camera().up.set(0, 1, 0) // OrbitControls assumes world-up; a tilted up axis corrupts orbiting
    }
    resolveRun?.(ok)
    resolveRun = null
  }

  // Fast-forward: a flat 40× time multiplier finishes any remaining flight in well under a
  // second at 60fps, and still converges under heavy rAF throttling (a decaying-budget ramp
  // burned its whole budget in one throttled frame).
  const skip = () => { if (playing) skipping = true }

  async function play(o: CinePlayOpts): Promise<boolean> {
    if (playing) return false
    cancelled = false
    skipping = false

    const pts = o.traj.points.map((p) => { const c = deps.globe.getCoords(p.lat, p.lng, p.alt); return new THREE.Vector3(c.x, c.y, c.z) })
    const curve = new THREE.CatmullRomCurve3(pts)
    // Default arc-length sampling (200) aliases the tiny moon loop; the earthrise crawl needs
    // sub-loop resolution or the ship stutters through it.
    curve.arcLengthDivisions = 3000
    const M = new THREE.Vector3(o.moonCenter.x, o.moonCenter.y, o.moonCenter.z)

    // Fly to the pad with globe.gl's own tween, then take manual control.
    const pad = o.traj.points[0]
    deps.globe.pointOfView({ lat: pad.lat, lng: pad.lng, altitude: 0.18 }, 1000)
    await wait(1050)
    if (cancelled) return false

    playing = true
    deps.globe.controls().enabled = false

    // The ship: our own dart instance on the trajectory (the custom-layer slot stays with
    // the leg-flying dart).
    const ship = buildDart()
    ship.visible = true
    deps.globe.scene().add(ship)
    cleanups.push(() => { deps.globe.scene().remove(ship) })

    // Tap anywhere that isn't an interactive HUD element → fast-forward to the end.
    const onTap = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('button, a, .sharepanel, .lunartel, #rail, #moment')) return
      skip()
    }
    window.addEventListener('pointerdown', onTap, true)
    cleanups.push(() => window.removeEventListener('pointerdown', onTap, true))

    // ?cineHold=0.7 freezes the timeline at that fraction (screenshot/debug); release with
    // `__cineGo = true` in the console.
    const holdParam = new URLSearchParams(location.search).get('cineHold')
    const holdMs = holdParam != null ? Math.max(0, Math.min(1, parseFloat(holdParam) || 0)) * MISSION_TOTAL_MS : null

    const cam = deps.globe.camera()
    // Smoothed rig state: seeded from wherever the pad tween left the camera, so the first
    // frames glide into the chase instead of snapping. The smoothing time-constants below also
    // carry the camera through every beat transition.
    const smPos = cam.position.clone()
    const smTarget = curve.getPointAt(0).clone()
    const smUp = cam.up.clone()
    let elapsed = 0
    let last = performance.now()
    let prevU = 0
    let vShow = 0
    let saidHere = false

    const run = (now: number) => {
      if (!playing) return
      let dt = Math.min(100, now - last) // hidden-tab clamp: the flight pauses instead of jump-cutting
      last = now
      if (skipping) dt *= 40
      elapsed += dt
      if (holdMs != null && !(window as any).__cineGo) elapsed = Math.min(elapsed, holdMs)
      elapsed = Math.min(MISSION_TOTAL_MS, elapsed)

      const { u, cam: rig } = missionStateAt(elapsed)

      // Ship on the rail.
      const shipPos = curve.getPointAt(u)
      const dM = shipPos.distanceTo(M)
      const wM = proximity(160, 60, dM)
      const forward = curve.getTangentAt(u).normalize()
      // Up: radial from Earth, handing over to radial-from-Moon during the skim, then
      // orthonormalized against the flight direction.
      const upRef = new THREE.Vector3()
        .addScaledVector(shipPos.clone().normalize(), 1 - wM)
        .addScaledVector(shipPos.clone().sub(M).normalize(), wM)
        .normalize()
      const up = upRef.clone().addScaledVector(forward, -upRef.dot(forward)).normalize()
      const right = new THREE.Vector3().crossVectors(up, forward).normalize()
      ship.position.copy(shipPos)
      ship.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward))
      // Born on the pad, dissolved just before the settle (mirrors the dart↔beacon handoff).
      const grow = Math.min(1, elapsed / 900)
      const fade = Math.max(0, Math.min(1, (MISSION_TOTAL_MS - elapsed) / 800))
      ship.scale.setScalar(SHIP_SCALE * grow * fade)

      // Camera: orbit the ship — azimuth theta from dead-ahead, plus rise along up.
      const th = rig.theta * D2R
      const desiredPos = shipPos.clone()
        .addScaledVector(forward, Math.cos(th) * rig.dist)
        .addScaledVector(right, Math.sin(th) * rig.dist)
        .addScaledVector(up, rig.rise)
      const desiredTarget = shipPos.clone().addScaledVector(forward, 3)
      smPos.lerp(desiredPos, Math.min(1, dt / 220))
      smTarget.lerp(desiredTarget, Math.min(1, dt / 220))
      smUp.lerp(up, Math.min(1, dt / 300)).normalize()
      cam.position.copy(smPos)
      cam.up.copy(smUp)
      cam.lookAt(smTarget)

      deps.setReveal(Math.min(1, u + 0.04))
      deps.moonMesh.setLabelOpacity(proximity(420, 180, dM))

      // Telemetry: MET is derived from the timeline (it freezes with a hold and jumps with a
      // skip); velocity is d(path NM)/d(MET), smoothed for readability.
      const met = (elapsed * MET_TOTAL_H) / MISSION_TOTAL_MS
      const dMetH = (dt * MET_TOTAL_H) / MISSION_TOTAL_MS
      const vKt = (Math.abs(u - prevU) * PATH_NM) / Math.max(1e-9, dMetH)
      vShow = vShow * 0.85 + vKt * 0.15
      prevU = u
      const distNm = Math.max(0, (shipPos.length() - 100) * NM_PER_UNIT)
      deps.onTelemetry(`MET T+ ${fmtMet(met)}\nVEL ${Math.round(vShow).toLocaleString()} KT\nEARTH DIST ${Math.round(distNm).toLocaleString()} NM`)

      if (o.milesFraction != null && !saidHere && u >= o.milesFraction) {
        saidHere = true
        deps.onEvent(`YOU ARE HERE · ${Math.round(o.milesFraction * 100)}% OF A LUNAR RETURN`)
      }

      deps.onFrame()

      if (elapsed >= MISSION_TOTAL_MS) { stop(true); return }
      raf = requestAnimationFrame(run)
    }
    raf = requestAnimationFrame(run)
    return new Promise<boolean>((res) => { resolveRun = res })
  }

  return {
    play,
    cancel() { cancelled = true; stop(false) },
    skip,
    isPlaying: () => playing,
    totalMs: MISSION_TOTAL_MS,
  }
}
