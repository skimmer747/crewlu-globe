import * as THREE from 'three'
import type { Trajectory } from './lunarTrajectory'
import type { MoonMesh } from './moonMesh'
import { buildDart } from './dartLayer'

// "Fly the racetrack to your earned spot" chase cinematic. The dart rides the lunar-return
// circuit (out → around the Moon → back → around the Earth → out again…) and PARKS at the
// odometer's exact spot. Time is COST-WARPED along the path: proximity to the Moon or Earth
// slows the clock (savorable flybys, visible Earth turns) while the empty transit legs cruise
// — so every lap's Moon pass gets real screen time no matter how tiny it is in distance.
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
  metHours: number        // simulated mission-elapsed-time span (scales with laps)
}

export interface Pacing { flyMs: number; parkMs: number; totalMs: number; uAt(elapsedMs: number): number }

export interface LunarCinematic {
  play(opts: CinePlayOpts): Promise<boolean> // resolves false if cancelled
  cancel(): void
  skip(): void
  isPlaying(): boolean
  timingFor(traj: Trajectory, moonCenter: { x: number; y: number; z: number }, stopFraction: number): Pacing
}

const smooth01 = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t) }

/**
 * Eased-endpoints constant-cruise profile: accelerate over the first `a`, hold speed, brake
 * over the last `a`. Unlike easeInOutCubic, the middle is CONSTANT speed — multi-lap flights
 * don't rush their middle laps. s(0)=0, s(1)=1, monotonic. Exported for tests.
 */
export function trapezoid(k: number, a = 0.15): number {
  k = Math.max(0, Math.min(1, k))
  let s: number
  if (k < a) s = (k * k) / (2 * a)
  else if (k <= 1 - a) s = a / 2 + (k - a)
  else { const q = 1 - k; s = a / 2 + (1 - 2 * a) + (a / 2 - (q * q) / (2 * a)) }
  return s / (1 - a)
}

const MS_PER_COST = 0.62      // pacing knob: cruise ≈ 0.62ms per scene-unit of weighted path
const MIN_FLY_MS = 8000
const MAX_FLY_MS = 42000
const PARK_MS = 3500

/**
 * Cost-warped time→position mapping. `weight[i]` is the time-cost multiplier of the segment
 * ending at point i (1 = cruise). uAt() returns the path-length fraction at an elapsed time,
 * following a trapezoid velocity profile over the cost domain. Exported for tests.
 */
export function buildPacing(cum: number[], weight: number[], stopFraction: number): Pacing {
  const n = cum.length
  const length = cum[n - 1] || 1
  const cost: number[] = [0]
  for (let i = 1; i < n; i++) cost.push(cost[i - 1] + (cum[i] - cum[i - 1]) * Math.max(1, weight[i] ?? 1))
  const stop = Math.max(0, Math.min(1, stopFraction))
  const stopDist = stop * length
  // cost at the stop distance (interpolated)
  let j = 1
  while (j < n && cum[j] < stopDist) j++
  const seg = j < n ? (cum[j] - cum[j - 1]) || 1 : 1
  const stopCost = j < n ? cost[j - 1] + ((stopDist - cum[j - 1]) / seg) * (cost[j] - cost[j - 1]) : cost[n - 1]

  const flyMs = Math.min(MAX_FLY_MS, Math.max(MIN_FLY_MS, stopCost * MS_PER_COST))
  const uAt = (elapsedMs: number): number => {
    if (elapsedMs >= flyMs || stopCost <= 0) return stop
    const target = trapezoid(Math.max(0, elapsedMs) / flyMs) * stopCost
    // binary search the cost array
    let lo = 0, hi = n - 1
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (cost[mid] < target) lo = mid; else hi = mid }
    const cseg = (cost[hi] - cost[lo]) || 1
    const dist = cum[lo] + ((target - cost[lo]) / cseg) * (cum[hi] - cum[lo])
    return Math.min(stop, dist / length)
  }
  return { flyMs, parkMs: PARK_MS, totalMs: flyMs + PARK_MS, uAt }
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

const NM_PER_UNIT = 34.4
const SHIP_SCALE = 1.85
const D2R = Math.PI / 180

export function createLunarCinematic(deps: CineDeps): LunarCinematic {
  let playing = false
  let cancelled = false
  let raf = 0
  let skipping = false
  let resolveRun: ((ok: boolean) => void) | null = null
  let cleanups: (() => void)[] = []

  const scenePts = (traj: Trajectory) =>
    traj.points.map((p) => { const c = deps.globe.getCoords(p.lat, p.lng, p.alt); return new THREE.Vector3(c.x, c.y, c.z) })

  // Per-point time-cost weights: hug the Moon → ~35× slower clock (savor the flyby); rounding
  // low over Earth → ~4× (watch the turn); empty transit → 1× (cruise).
  const pacingFor = (pts: any[], traj: Trajectory, M: any, stopFraction: number): Pacing => {
    const weight = pts.map((p) => 1 + 34 * proximity(200, 60, p.distanceTo(M)) + 3 * proximity(500, 130, p.length()))
    return buildPacing(traj.cum, weight, stopFraction)
  }

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

    const pts = scenePts(o.traj)
    const M = new THREE.Vector3(o.moonCenter.x, o.moonCenter.y, o.moonCenter.z)
    const pacing = pacingFor(pts, o.traj, M, o.stopFraction)
    const curve = new THREE.CatmullRomCurve3(pts)
    curve.arcLengthDivisions = 3000

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
    const holdMs = holdParam != null ? Math.max(0, Math.min(1, parseFloat(holdParam) || 0)) * pacing.totalMs : null

    const cam = deps.globe.camera()
    const smPos = cam.position.clone()
    const smTarget = curve.getPointAt(0).clone()
    const smUp = cam.up.clone()
    // Parallel-transported ship frame (deriving up from the radial tumbles on the climb-out).
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
      elapsed = Math.min(pacing.totalMs, elapsed)

      const u = pacing.uAt(elapsed)
      const parked = elapsed >= pacing.flyMs
      const parkK = parked ? smooth01((elapsed - pacing.flyMs) / pacing.parkMs) : 0

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

      // Camera rig: swing from ahead to behind during the launch, then chase. Near either
      // body, pull back + lift + frame the body so flybys and Earth turns read as orbits
      // around SOMETHING rather than a tight tail-chase.
      const fp = Math.min(1, elapsed / pacing.flyMs)
      let theta = 30 + (172 - 30) * smooth01(Math.min(1, fp / 0.2))
      let dist = 30 + (42 - 30) * smooth01(Math.min(1, fp / 0.35))
      let rise = 11 + (13 - 11) * smooth01(fp)
      if (parked) {
        if (dM < 220) { theta = 172 + (110 - 172) * parkK; dist = 42 + (34 - 42) * parkK; rise = 13 + (10 - 13) * parkK }
        else { theta = 172 + (162 - 172) * parkK; dist = 42 + (48 - 42) * parkK; rise = 13 + (15 - 13) * parkK }
      }
      const moonView = wM
      const th = theta * D2R
      const desiredPos = shipPos.clone()
        .addScaledVector(forward, Math.cos(th) * (dist + moonView * 70))
        .addScaledVector(right, Math.sin(th) * (dist + moonView * 70))
        .addScaledVector(shipUp, rise + moonView * 22)
      const desiredTarget = shipPos.clone()
        .addScaledVector(forward, parked && dM >= 220 ? 60 : 3)
        .lerp(M, moonView * 0.65) // near the Moon: frame the pass around the Moon itself
      smPos.lerp(desiredPos, Math.min(1, dt / 220))
      smTarget.lerp(desiredTarget, Math.min(1, dt / 220))
      smUp.lerp(shipUp, Math.min(1, dt / 300)).normalize()
      cam.position.copy(smPos)
      cam.up.copy(smUp)
      cam.lookAt(smTarget)

      deps.setReveal(u)
      deps.moonMesh.setLabelOpacity(proximity(420, 180, dM))

      // Telemetry.
      const metFrac = pacing.totalMs > 0 ? elapsed / pacing.totalMs : 0
      const dMetH = (dt * o.metHours) / Math.max(1, pacing.totalMs)
      const vKt = (Math.abs(u - prevU) * o.traj.length * NM_PER_UNIT) / Math.max(1e-9, dMetH)
      vShow = vShow * 0.85 + (parked ? 0 : vKt) * 0.15
      prevU = u
      const distNm = Math.max(0, (shipPos.length() - 100) * NM_PER_UNIT)
      deps.onTelemetry(`MET T+ ${fmtMet(metFrac * o.metHours)}\nVEL ${Math.round(vShow).toLocaleString()} KT\nEARTH DIST ${Math.round(distNm).toLocaleString()} NM`)

      deps.onFrame()

      if (elapsed >= pacing.totalMs) { stop(true); return }
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
    timingFor(traj, moonCenter, stopFraction) {
      const pts = scenePts(traj)
      return pacingFor(pts, traj, new THREE.Vector3(moonCenter.x, moonCenter.y, moonCenter.z), stopFraction)
    },
  }
}
