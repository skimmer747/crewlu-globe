import * as THREE from 'three'
import type { Trajectory } from './lunarTrajectory'
import type { MoonMesh } from './moonMesh'
import { buildDart } from './dartLayer'

// "Fly to your earned spot" chase cinematic. The dart rides a progress path and PARKS at the
// fraction your mileage reached — it does not come home. The camera swings behind it during
// climb-out, chases it outbound, then eases to a settle framing over the parked ship (the Moon
// a distant goal ahead if you haven't reached it; the near side + Apollo sites if you have).
// OrbitControls are suspended for the duration; every exit restores controls, up, and the ship.

export interface CineDeps {
  globe: any
  moonMesh: MoonMesh
  onFrame(): void
  onTelemetry(text: string): void
  setReveal(f: number): void // bright line grows to the ship; ghost shows the rest
}

export interface CinePlayOpts {
  traj: Trajectory
  moonCenter: { x: number; y: number; z: number }
  stopFraction: number   // 0..1 of the path — where the ship parks
  reachedMoon: boolean    // did the mileage reach the Moon (enables the close-up crawl)
}

export interface LunarCinematic {
  play(opts: CinePlayOpts): Promise<boolean> // resolves false if cancelled
  cancel(): void
  skip(): void
  isPlaying(): boolean
  timingFor(stopFraction: number): { flyMs: number; parkMs: number; totalMs: number }
}

const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const smooth01 = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t) }

/** Flight timing from how far the ship travels: farther = a bit longer, capped. Exported for tests. */
export function missionTiming(stopFraction: number): { flyMs: number; parkMs: number; totalMs: number } {
  const f = Math.max(0, Math.min(1, stopFraction))
  const flyMs = 9000 + f * 15000 // 9s (parks early) → 24s (full coil)
  const parkMs = 3500
  return { flyMs, parkMs, totalMs: flyMs + parkMs }
}

/** Ship's path fraction at an elapsed time: eases 0→stopFraction over the fly, then parks. Exported for tests. */
export function shipUAt(elapsedMs: number, stopFraction: number, timing = missionTiming(stopFraction)): number {
  if (elapsedMs >= timing.flyMs) return stopFraction
  return stopFraction * easeInOutCubic(Math.max(0, elapsedMs) / timing.flyMs)
}

/** Mission elapsed time, hours → "HHH:MM:SS". Exported for tests. */
export function fmtMet(hours: number): string {
  const s = Math.floor(hours * 3600)
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  return `${String(hh).padStart(3, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

const proximity = (far: number, near: number, x: number) => {
  const k = Math.max(0, Math.min(1, (far - x) / (far - near)))
  return k * k * (3 - 2 * k)
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const MET_TOTAL_H = 145.2
const NM_PER_UNIT = 34.4
const PATH_NM = 415119
const SHIP_SCALE = 1.85
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
      deps.globe.camera().up.set(0, 1, 0)
    }
    resolveRun?.(ok)
    resolveRun = null
  }

  const skip = () => { if (playing) skipping = true }

  async function play(o: CinePlayOpts): Promise<boolean> {
    if (playing) return false
    cancelled = false
    skipping = false
    const timing = missionTiming(o.stopFraction)

    const pts = o.traj.points.map((p) => { const c = deps.globe.getCoords(p.lat, p.lng, p.alt); return new THREE.Vector3(c.x, c.y, c.z) })
    const curve = new THREE.CatmullRomCurve3(pts)
    curve.arcLengthDivisions = 3000
    const M = new THREE.Vector3(o.moonCenter.x, o.moonCenter.y, o.moonCenter.z)

    // Fly to the pad with globe.gl's own tween, then take manual control.
    const pad = o.traj.points[0]
    deps.globe.pointOfView({ lat: pad.lat, lng: pad.lng, altitude: 0.18 }, 1000)
    await wait(1050)
    if (cancelled) return false

    playing = true
    deps.globe.controls().enabled = false

    const ship = buildDart()
    ship.visible = true
    deps.globe.scene().add(ship)
    cleanups.push(() => { deps.globe.scene().remove(ship) })

    const onTap = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('button, a, .sharepanel, .lunartel, #rail, #moment')) return
      skip()
    }
    window.addEventListener('pointerdown', onTap, true)
    cleanups.push(() => window.removeEventListener('pointerdown', onTap, true))

    const holdParam = new URLSearchParams(location.search).get('cineHold')
    const holdMs = holdParam != null ? Math.max(0, Math.min(1, parseFloat(holdParam) || 0)) * timing.totalMs : null

    const cam = deps.globe.camera()
    const smPos = cam.position.clone()
    const smTarget = curve.getPointAt(0).clone()
    const smUp = cam.up.clone()
    // Parallel-transported ship frame (see prior fix): carries over each frame, settles gently
    // toward radial-up — deriving up from the radial degenerates on the near-vertical climb-out.
    const shipUp = new THREE.Vector3()
    {
      const f0 = curve.getTangentAt(0).normalize()
      const seed = Math.abs(f0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
      shipUp.copy(seed.addScaledVector(f0, -seed.dot(f0)).normalize())
    }
    let elapsed = 0
    let last = performance.now()
    let prevU = 0
    let vShow = 0

    const run = (now: number) => {
      if (!playing) return
      let dt = Math.min(100, now - last)
      last = now
      if (skipping) dt *= 40
      elapsed += dt
      if (holdMs != null && !(window as any).__cineGo) elapsed = Math.min(elapsed, holdMs)
      elapsed = Math.min(timing.totalMs, elapsed)

      const u = shipUAt(elapsed, o.stopFraction, timing)
      const parked = elapsed >= timing.flyMs
      const parkK = parked ? smooth01((elapsed - timing.flyMs) / timing.parkMs) : 0

      // Ship on the rail.
      const shipPos = curve.getPointAt(u)
      const dM = shipPos.distanceTo(M)
      const wM = proximity(160, 60, dM)
      const forward = curve.getTangentAt(Math.min(0.9999, u + 1e-4)).normalize()
      const upRef = new THREE.Vector3()
        .addScaledVector(shipPos.clone().normalize(), 1 - wM)
        .addScaledVector(shipPos.clone().sub(M).normalize(), wM)
      shipUp.addScaledVector(forward, -shipUp.dot(forward)).normalize()
      const bias = upRef.addScaledVector(forward, -upRef.dot(forward))
      if (bias.lengthSq() > 0.1) {
        shipUp.lerp(bias.normalize(), Math.min(1, dt / 1500))
        shipUp.addScaledVector(forward, -shipUp.dot(forward)).normalize()
      }
      const right = new THREE.Vector3().crossVectors(shipUp, forward).normalize()
      ship.position.copy(shipPos)
      ship.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, shipUp, forward))
      const grow = Math.min(1, elapsed / 900)
      ship.scale.setScalar(SHIP_SCALE * grow)

      // Camera rig around the ship. Fly: swing from ahead (30°) to behind (172°) in the first
      // third, distance easing out. Park: ease to a settle — orbit toward the near side if we
      // reached the Moon (shows the Apollo sites), else hold behind with the Moon goal ahead.
      const fp = Math.min(1, elapsed / timing.flyMs)
      let theta = 30 + (172 - 30) * smooth01(Math.min(1, fp / 0.32))
      let dist = 30 + (42 - 30) * smooth01(Math.min(1, fp / 0.5))
      let rise = 11 + (13 - 11) * smooth01(fp)
      if (parked) {
        if (o.reachedMoon) { theta = 172 + (110 - 172) * parkK; dist = 42 + (34 - 42) * parkK; rise = 13 + (10 - 13) * parkK }
        else { theta = 172 + (162 - 172) * parkK; dist = 42 + (48 - 42) * parkK; rise = 13 + (15 - 13) * parkK }
      }
      const th = theta * D2R
      const desiredPos = shipPos.clone()
        .addScaledVector(forward, Math.cos(th) * dist)
        .addScaledVector(right, Math.sin(th) * dist)
        .addScaledVector(shipUp, rise)
      const desiredTarget = shipPos.clone().addScaledVector(forward, parked && !o.reachedMoon ? 60 : 3) // parked-in-transit: look past the ship to the Moon goal
      smPos.lerp(desiredPos, Math.min(1, dt / 220))
      smTarget.lerp(desiredTarget, Math.min(1, dt / 220))
      smUp.lerp(shipUp, Math.min(1, dt / 300)).normalize()
      cam.position.copy(smPos)
      cam.up.copy(smUp)
      cam.lookAt(smTarget)

      deps.setReveal(u)
      deps.moonMesh.setLabelOpacity(o.reachedMoon ? proximity(420, 180, dM) : 0)

      // Telemetry.
      const metFrac = timing.totalMs > 0 ? elapsed / timing.totalMs : 0
      const dMetH = (dt * MET_TOTAL_H) / Math.max(1, timing.totalMs)
      const vKt = (Math.abs(u - prevU) * PATH_NM) / Math.max(1e-9, dMetH)
      vShow = vShow * 0.85 + (parked ? 0 : vKt) * 0.15
      prevU = u
      const distNm = Math.max(0, (shipPos.length() - 100) * NM_PER_UNIT)
      deps.onTelemetry(`MET T+ ${fmtMet(metFrac * MET_TOTAL_H)}\nVEL ${Math.round(vShow).toLocaleString()} KT\nEARTH DIST ${Math.round(distNm).toLocaleString()} NM`)

      deps.onFrame()

      if (elapsed >= timing.totalMs) { stop(true); return }
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
    timingFor: missionTiming,
  }
}
