import type { Leg } from '../model'
import type { Trip } from '../data/trips'
import { buildAxis, type TimeAxis } from './timeAxis'
import { shuttleRate, clampStart, clampEnd, DAY } from './shuttle'

const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const dayLabel = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
export const SPEEDS = [0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]

export interface DockState { legs: Leg[]; trips: Trip[]; domainStart: number; domainEnd: number; windowStart: number; windowEnd: number; playhead: number; now: number; speedIndex: number }

export interface TimelineDock {
  mount(host: HTMLElement): void
  render(): void
  setPlayhead(ms: number): void
  setPlaying(playing: boolean): void
  setMomentTrip(label: string | null): void
  state: DockState
  onWindowChange(cb: (start: number, end: number) => void): void
  onSeek(cb: (ms: number) => void): void
  onPlayToggle(cb: () => void): void
  onSpeed(cb: (mult: number) => void): void
}

// The window fills the central BAND of the track; the outer INSET strips are the "runway"
// for the outward velocity pull. Bars rest at the band edges.
const INSET = 0.15
const BAND = 1 - 2 * INSET
const MIN_WIN_MS = 1 * DAY
const WIN_THROTTLE_MS = 120 // how often the (heavy) globe callback fires during a live shuttle
const SPRING_MS = 180

export function createTimelineDock(init: { legs: Leg[]; trips: Trip[]; windowStart: number; windowEnd: number; playhead: number; now: number }): TimelineDock {
  const legs = init.legs
  const lastLeg = legs[legs.length - 1]
  const domainStart = legs.length ? legs[0].t : init.windowStart
  // Domain end reaches the last flight's *landing*, so the final leg has room on the track.
  const domainEnd = legs.length ? lastLeg.landing : init.windowEnd
  const state: DockState = {
    legs, trips: init.trips, domainStart, domainEnd,
    windowStart: init.windowStart, windowEnd: init.windowEnd, playhead: init.playhead, now: init.now, speedIndex: 3,
  }
  // For drawing only, stretch each trip to its last leg's estimated landing. The Trip model still
  // ends at the last departure (schedule/focus logic depends on that); this just gives the band
  // room to show the final flight without disturbing trip grouping.
  const drawTrips = (): Trip[] => state.trips.map((t) => {
    const ll = t.legs[t.legs.length - 1]
    return ll ? { ...t, end: Math.max(t.end, ll.landing) } : t
  })
  let axis: TimeAxis = buildAxis(state.windowStart, state.windowEnd, drawTrips())
  let host!: HTMLElement
  let track!: HTMLElement
  let cbWindow: (s: number, e: number) => void = () => {}
  let cbSeek: (ms: number) => void = () => {}
  let cbToggle: () => void = () => {}
  let cbSpeed: (m: number) => void = () => {}

  // content x (0..1, within the window) <-> track fraction (0..1, across the element)
  const cToT = (x: number) => INSET + x * BAND
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  const homeFrac = (bar: 'L' | 'R') => (bar === 'L' ? INSET : 1 - INSET)

  const rebuildAxis = () => { axis = buildAxis(state.windowStart, state.windowEnd, drawTrips()); clampPlayhead() }
  const clampPlayhead = () => { state.playhead = Math.min(Math.max(state.playhead, state.windowStart), state.windowEnd) }

  // Past vs future is anchored to *today* (state.now), not the scrub playhead: trips/flights
  // before now have happened (blue); those after are still scheduled (violet). Scrubbing the
  // playhead never recolors anything.
  const era = (ms: number): 'past' | 'future' => (ms < state.now ? 'past' : 'future')

  interface RenderOpts { renderAxis?: TimeAxis; barLFrac?: number; barRFrac?: number; mask?: { from: number; to: number } }
  const renderTrack = (o: RenderOpts = {}) => {
    const a = o.renderAxis ?? axis
    const barL = o.barLFrac ?? INSET
    const barR = o.barRFrac ?? (1 - INSET)
    const tf = (x: number) => cToT(x) * 100 // content x -> track %
    const trackW = track.clientWidth || 320
    const seg = (x0: number, x1: number, cls: string) => {
      const l = tf(x0), w = tf(x1) - tf(x0)
      return w > 0.01 ? `<div class="seg ${cls}" style="left:${l.toFixed(3)}%;width:${w.toFixed(3)}%"></div>` : ''
    }
    // Trip bands (the whole on-duty span, incl. layovers). A trip straddling "now" is split so its
    // flown part is blue and its not-yet-flown remainder violet; otherwise the band is one era.
    const nowX = a.dateToX(state.now)
    const bands = a.pieces.filter((p) => p.kind === 'active').map((p) =>
      p.startMs < state.now && p.endMs > state.now
        ? seg(p.x0, nowX, 'past') + seg(nowX, p.x1, 'future')
        : seg(p.x0, p.x1, p.startMs >= state.now ? 'future' : 'past'),
    ).join('')
    // Individual flight legs: a slightly darker bar over the band spanning the leg's estimated air
    // time (capped at the next departure), so you can see/scrub the in-air vs on-the-ground stretches.
    const flights = state.legs.map((l, i) => {
      const next = state.legs[i + 1]
      const a0 = l.takeoff, a1 = Math.min(l.landing, next ? next.t : Infinity)
      if (a1 <= state.windowStart || a0 >= state.windowEnd) return ''
      return seg(a.dateToX(Math.max(a0, state.windowStart)), a.dateToX(Math.min(a1, state.windowEnd)), `air ${era(l.takeoff)}`)
    }).join('')
    const gaps = a.gaps.map((g) => {
      const wPct = tf(g.x1) - tf(g.x0)
      // only label a gap wide enough to fit the text (avoids a jumble when zoomed out)
      const lbl = (wPct / 100) * trackW >= 46 ? `<span class="gaplbl">${g.label}</span>` : ''
      return `<div class="gap" style="left:${tf(g.x0).toFixed(3)}%;width:${wPct.toFixed(3)}%">${lbl}</div>`
    }).join('')
    // Pixel-aware de-crowding: drop ticks whose labels would collide at the current width.
    let lastTickPx = -Infinity
    const ticks = a.ticks.filter((t) => {
      const px = cToT(t.x) * trackW
      if (px - lastTickPx < 54) return false
      lastTickPx = px
      return true
    }).map((t) => `<span class="atick" style="left:${tf(t.x).toFixed(3)}%">${t.label}</span>`).join('')
    const ph = cToT(a.dateToX(state.playhead)) * 100
    const mask = o.mask
      ? `<div class="winmask" style="left:${(o.mask.from * 100).toFixed(3)}%;width:${((o.mask.to - o.mask.from) * 100).toFixed(3)}%"></div>`
      : ''
    track.innerHTML =
      mask + gaps + bands + flights +
      `<div class="phead" style="left:${ph.toFixed(3)}%"></div>` +
      `<div class="handle hL" data-h="L" style="left:${(barL * 100).toFixed(3)}%"></div>` +
      `<div class="handle hR" data-h="R" style="left:${(barR * 100).toFixed(3)}%"></div>` +
      `<div class="axisticks">${ticks}</div>`
    host.querySelector<HTMLElement>('#tlFrom')!.textContent = dayLabel(state.windowStart)
    host.querySelector<HTMLElement>('#tlTo')!.textContent = dayLabel(state.windowEnd)
  }

  const rawFrac = (clientX: number, rect: DOMRect) => (clientX - rect.left) / rect.width

  const bindDrag = () => {
    let dragBar: 'L' | 'R' | 'P' | null = null
    let activeId = -1
    let baseAxis: TimeAxis = axis // fixed-scale reference during an inward (positional) drag
    let running = false           // outward velocity loop active
    let raf = 0
    let springRaf = 0
    let lastTs = 0
    let lastWinFire = 0
    let lastRawF = 0
    let lastRect: DOMRect

    const reset = () => { dragBar = null; activeId = -1; running = false; cancelAnimationFrame(raf); cancelAnimationFrame(springRaf) }

    // Tap / drag the track body: scrub the playhead within the window.
    const applyPlayhead = (rawF: number, _rect: DOMRect) => {
      const cx = clamp01((clamp01(rawF) - INSET) / BAND)
      state.playhead = Math.min(Math.max(axis.xToDate(cx), state.windowStart), state.windowEnd)
      renderTrack()
    }

    // Inward push: the edge jumps to the date under the finger on the FIXED base scale.
    // The trimmed-away strip dims; the track rescales only on release.
    const applyPositional = (rawF: number, _rect: DOMRect) => {
      const cx = clamp01((clamp01(rawF) - INSET) / BAND)
      const date = baseAxis.xToDate(cx)
      const barFrac = clamp01(rawF)
      if (dragBar === 'L') {
        state.windowStart = clampStart(date, state.windowEnd, state.domainStart, MIN_WIN_MS)
        clampPlayhead()
        renderTrack({ renderAxis: baseAxis, barLFrac: barFrac, mask: { from: cToT(0), to: barFrac } })
      } else {
        state.windowEnd = clampEnd(date, state.windowStart, state.domainEnd, MIN_WIN_MS)
        clampPlayhead()
        renderTrack({ renderAxis: baseAxis, barRFrac: barFrac, mask: { from: barFrac, to: cToT(1) } })
      }
    }

    const startLoop = () => { if (running) return; running = true; lastTs = performance.now(); raf = requestAnimationFrame(loop) }

    // Outward pull: integrate the edge outward at a speed set by how far past home the finger is.
    const loop = (ts: number) => {
      if (!running || dragBar === null || dragBar === 'P') return
      const dt = Math.min(0.05, (ts - lastTs) / 1000); lastTs = ts
      const rect = lastRect, w = rect.width, rawF = lastRawF
      const home = homeFrac(dragBar)
      const outward = dragBar === 'L' ? rawF < home : rawF > home
      if (!outward) { running = false; applyPositional(rawF, rect); return } // finger crossed back inside
      const overshootPx = Math.abs(rawF - home) * w
      const rate = shuttleRate(overshootPx, INSET * w, state.domainEnd - state.domainStart)
      const delta = rate * dt
      if (dragBar === 'L') state.windowStart = clampStart(state.windowStart - delta, state.windowEnd, state.domainStart, MIN_WIN_MS)
      else state.windowEnd = clampEnd(state.windowEnd + delta, state.windowStart, state.domainEnd, MIN_WIN_MS)
      rebuildAxis()
      const barFrac = clamp01(rawF)
      renderTrack(dragBar === 'L' ? { barLFrac: barFrac } : { barRFrac: barFrac })
      if (ts - lastWinFire > WIN_THROTTLE_MS) { lastWinFire = ts; cbWindow(state.windowStart, state.windowEnd) }
      raf = requestAnimationFrame(loop)
    }

    const springBack = (bar: 'L' | 'R', fromFrac: number) => {
      const home = homeFrac(bar)
      const t0 = performance.now()
      const step = (ts: number) => {
        const k = Math.min(1, (ts - t0) / SPRING_MS)
        const e = 1 - Math.pow(1 - k, 3)
        const cur = fromFrac + (home - fromFrac) * e
        renderTrack(bar === 'L' ? { barLFrac: cur } : { barRFrac: cur })
        if (k < 1) springRaf = requestAnimationFrame(step); else renderTrack()
      }
      springRaf = requestAnimationFrame(step)
    }

    const down = (e: PointerEvent) => {
      if (dragBar) return // ignore a second finger mid-gesture
      cancelAnimationFrame(raf); cancelAnimationFrame(springRaf); running = false // clean slate for a new gesture
      const rect = track.getBoundingClientRect()
      lastRect = rect
      const f = rawFrac(e.clientX, rect)
      lastRawF = f
      const tol = (e.pointerType === 'touch' ? 28 : 12) / rect.width
      const dL = Math.abs(f - INSET), dR = Math.abs(f - (1 - INSET))
      track.setPointerCapture(e.pointerId)
      activeId = e.pointerId
      if (Math.min(dL, dR) > tol) { dragBar = 'P'; applyPlayhead(f, rect); return }
      dragBar = dL <= dR ? 'L' : 'R'
      baseAxis = axis
      // a plain tap on a bar (no move) just springs back; an actual drag does the work
    }

    const move = (e: PointerEvent) => {
      if (!dragBar || e.pointerId !== activeId) return
      const rect = track.getBoundingClientRect()
      lastRect = rect
      const f = rawFrac(e.clientX, rect)
      lastRawF = f
      if (dragBar === 'P') { applyPlayhead(f, rect); return }
      const home = homeFrac(dragBar)
      const outward = dragBar === 'L' ? f < home : f > home
      if (outward) startLoop()
      else { running = false; applyPositional(f, rect) }
    }

    const up = (e: PointerEvent) => {
      if (!dragBar || e.pointerId !== activeId) return
      running = false; cancelAnimationFrame(raf)
      if (dragBar === 'P') { cbSeek(state.playhead); reset(); return }
      const bar = dragBar
      rebuildAxis() // settle: positional drags were rendered on the fixed base scale
      const releaseFrac = clamp01(lastRawF)
      reset()
      cbWindow(state.windowStart, state.windowEnd) // globe -> final window
      springBack(bar, releaseFrac)                 // visual snap-home
    }

    track.addEventListener('pointerdown', down)
    track.addEventListener('pointermove', move)
    track.addEventListener('pointerup', up)
    track.addEventListener('pointercancel', up)
  }

  return {
    state,
    mount(h) {
      host = h
      h.insertAdjacentHTML('beforeend', DOCK_HTML)
      track = h.querySelector<HTMLElement>('#tlTrack')!
      const speed = h.querySelector<HTMLInputElement>('#tlSpeed')!
      speed.value = String(state.speedIndex)
      speed.max = String(SPEEDS.length - 1)
      const speedLbl = h.querySelector<HTMLElement>('#tlSpeedVal')!
      speedLbl.textContent = `${SPEEDS[state.speedIndex]}×`
      speed.addEventListener('input', () => {
        state.speedIndex = +speed.value
        speedLbl.textContent = `${SPEEDS[state.speedIndex]}×`
        cbSpeed(SPEEDS[state.speedIndex])
      })
      h.querySelector('#tlPlay')!.addEventListener('click', () => cbToggle())
      bindDrag()
      renderTrack()
    },
    render() { rebuildAxis(); renderTrack() },
    setPlayhead(ms) { state.playhead = Math.min(Math.max(ms, state.windowStart), state.windowEnd); if (host) renderTrack() },
    setPlaying(playing) { if (host) host.querySelector('#tlPlay')!.textContent = playing ? '❚❚' : '▶' },
    setMomentTrip() { /* moment chip is owned by the HUD; dock exposes window/playhead only */ },
    onWindowChange(cb) { cbWindow = cb },
    onSeek(cb) { cbSeek = cb },
    onPlayToggle(cb) { cbToggle = cb },
    onSpeed(cb) { cbSpeed = cb },
  }
}

const DOCK_HTML = `
<div id="dock">
  <div id="dockInner">
    <div id="tlTrack"></div>
    <div id="tlCtl">
      <button class="btn" id="tlPlay">▶</button>
      <div class="tlspeed"><span class="tlk">SPEED</span><input id="tlSpeed" type="range" min="0" max="7" step="1" value="3"><span id="tlSpeedVal" class="tlv">1×</span></div>
      <div class="tlrange"><span class="tlk">FROM</span><span id="tlFrom" class="tlpill">—</span><span class="tlk">TO</span><span id="tlTo" class="tlpill">—</span></div>
    </div>
  </div>
</div>
`
