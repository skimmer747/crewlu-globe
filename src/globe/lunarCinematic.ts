import * as THREE from 'three'
import type { Trajectory } from './lunarTrajectory'
import type { MoonMesh } from './moonMesh'

// First-person flight along the lunar free-return path. The camera IS the ship: it rides a
// Catmull-Rom fit of the trajectory with keyframed pacing (beats below), blending its gaze
// between the path ahead, the Moon, and Earth. OrbitControls are suspended for the duration;
// every exit (finish, skip, cancel) restores controls and the camera's up vector.

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
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3)

export interface Gaze { ahead: number; moon: number; earth: number }
interface Beat { dur: number; u1: number; ease: (k: number) => number; look1: Gaze }

// u = arc-length fraction of the path. The Moon loop is only ~1.2% of the path's length, so
// time maps to u through beats: skim/earthrise crawl through that sliver while ascent/return
// sprint across the empty two-hundred-thousand-mile legs. Gaze weights must each sum to 1.
const BEATS: Beat[] = [
  { dur: 3000, u1: 0.012, ease: easeInCubic,    look1: { ahead: 1, moon: 0, earth: 0 } },       // ignition
  { dur: 6000, u1: 0.30,  ease: easeInOutCubic, look1: { ahead: 0.85, moon: 0.15, earth: 0 } }, // ascent
  { dur: 5000, u1: 0.462, ease: easeInOutSine,  look1: { ahead: 0.45, moon: 0.55, earth: 0 } }, // translunar coast
  { dur: 5000, u1: 0.499, ease: easeInOutSine,  look1: { ahead: 0.35, moon: 0.65, earth: 0 } }, // lunar skim
  { dur: 4000, u1: 0.505, ease: easeInOutSine,  look1: { ahead: 0, moon: 0.1, earth: 0.9 } },   // earthrise hold
  { dur: 4000, u1: 0.985, ease: easeInOutCubic, look1: { ahead: 0, moon: 0, earth: 1 } },       // return sprint
]
export const MISSION_TOTAL_MS = BEATS.reduce((s, b) => s + b.dur, 0)

/** Pure timeline lookup: elapsed ms → path fraction + gaze weights. Exported for tests. */
export function missionStateAt(elapsedMs: number): { u: number; look: Gaze } {
  const t = Math.max(0, Math.min(MISSION_TOTAL_MS, elapsedMs))
  let acc = 0
  let u0 = 0
  let look0: Gaze = { ahead: 1, moon: 0, earth: 0 }
  for (const b of BEATS) {
    if (t <= acc + b.dur) {
      const k = (t - acc) / b.dur
      const e = b.ease(k)
      return {
        u: u0 + (b.u1 - u0) * e,
        look: {
          ahead: look0.ahead + (b.look1.ahead - look0.ahead) * k,
          moon: look0.moon + (b.look1.moon - look0.moon) * k,
          earth: look0.earth + (b.look1.earth - look0.earth) * k,
        },
      }
    }
    acc += b.dur; u0 = b.u1; look0 = b.look1
  }
  return { u: BEATS[BEATS.length - 1].u1, look: BEATS[BEATS.length - 1].look1 }
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

const MET_TOTAL_H = 145.2 // a free-return mission is ~6 days, compressed into the flight
const NM_PER_UNIT = 34.4  // 100 scene units = Earth radius = 3,440 NM
const PATH_NM = 415119

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
    // sub-loop resolution or the camera stutters through it.
    curve.arcLengthDivisions = 3000
    const M = new THREE.Vector3(o.moonCenter.x, o.moonCenter.y, o.moonCenter.z)

    // Fly to the pad with globe.gl's own tween, then take manual control.
    const pad = o.traj.points[0]
    deps.globe.pointOfView({ lat: pad.lat, lng: pad.lng, altitude: 0.18 }, 1000)
    await wait(1050)
    if (cancelled) return false

    playing = true
    deps.globe.controls().enabled = false

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
    const startPos = cam.position.clone()
    let elapsed = 0
    let last = performance.now()
    let prevU = 0
    let met = 0
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

      const { u, look } = missionStateAt(elapsed)

      // Position: on the rail, lifted a little — away from Earth on the legs, away from the
      // Moon during the skim so the surface fills the lower frame without clipping.
      const base = curve.getPointAt(u)
      const dM = base.distanceTo(M)
      const wM = proximity(160, 60, dM)
      const pos = base.clone()
        .addScaledVector(base.clone().normalize(), 6 * (1 - wM))
        .addScaledVector(base.clone().sub(M).normalize(), 5 * wM)

      // Gaze: weighted blend of path-ahead / Moon / Earth (the Earth term is the origin —
      // nothing to add).
      const ahead = curve.getPointAt(Math.min(1, u + 0.03))
      const target = new THREE.Vector3()
        .addScaledVector(ahead, look.ahead)
        .addScaledVector(M, look.moon)

      // Up: radial from Earth, handing over to radial-from-Moon up close (prevents the
      // degenerate lookAt when staring at Earth from behind the Moon).
      const up = new THREE.Vector3()
        .addScaledVector(pos.clone().normalize(), 1 - wM)
        .addScaledVector(pos.clone().sub(M).normalize(), wM)
        .normalize()

      // Ease in from wherever the pad tween left us — kills any first-frame snap.
      const blend = easeOutCubic(Math.min(1, elapsed / 800))
      cam.position.copy(startPos.clone().lerp(pos, blend))
      cam.up.copy(up)
      cam.lookAt(target)

      deps.setReveal(Math.min(1, u + 0.04))
      deps.moonMesh.setLabelOpacity(proximity(420, 180, dM))

      // Telemetry: MET runs on the wall clock (it keeps ticking through the earthrise hold);
      // velocity is d(path NM)/d(MET), smoothed for readability.
      const dMetH = (dt * MET_TOTAL_H) / MISSION_TOTAL_MS
      met += dMetH
      const vKt = (Math.abs(u - prevU) * PATH_NM) / Math.max(1e-9, dMetH)
      vShow = vShow * 0.85 + vKt * 0.15
      prevU = u
      const distNm = Math.max(0, (pos.length() - 100) * NM_PER_UNIT)
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
