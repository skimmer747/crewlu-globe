import type { Leg } from '../model'
import type { Trip } from '../data/trips'
import { buildAxis, type TimeAxis } from './timeAxis'

const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const dayLabel = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
export const SPEEDS = [0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]

export interface DockState { legs: Leg[]; trips: Trip[]; domainStart: number; domainEnd: number; windowStart: number; windowEnd: number; playhead: number; speedIndex: number }

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

export function createTimelineDock(init: { legs: Leg[]; trips: Trip[]; windowStart: number; windowEnd: number; playhead: number }): TimelineDock {
  const legs = init.legs
  const domainStart = legs.length ? legs[0].t : init.windowStart
  const domainEnd = legs.length ? legs[legs.length - 1].t : init.windowEnd
  const state: DockState = {
    legs, trips: init.trips, domainStart, domainEnd,
    windowStart: init.windowStart, windowEnd: init.windowEnd, playhead: init.playhead, speedIndex: 3,
  }
  let axis: TimeAxis = buildAxis(domainStart, domainEnd, init.trips)
  let host!: HTMLElement
  let track!: HTMLElement
  let cbWindow: (s: number, e: number) => void = () => {}
  let cbSeek: (ms: number) => void = () => {}
  let cbToggle: () => void = () => {}
  let cbSpeed: (m: number) => void = () => {}

  const pctToMs = (pct: number) => axis.xToDate(pct)
  const msToPct = (ms: number) => axis.dateToX(ms) * 100

  const segColor = (p: { startMs: number; endMs: number }): string => {
    const inWindow = p.endMs >= state.windowStart && p.startMs <= state.windowEnd
    if (!inWindow) return 'dim'
    if (p.startMs <= state.playhead && p.endMs >= state.playhead) return 'current'
    return p.endMs <= state.playhead ? 'flown' : 'upcoming'
  }

  const renderTrack = () => {
    const segs = axis.pieces.filter((p) => p.kind === 'active').map((p) => {
      const cls = segColor(p)
      return `<div class="seg ${cls}" style="left:${(p.x0 * 100).toFixed(3)}%;width:${((p.x1 - p.x0) * 100).toFixed(3)}%"></div>`
    }).join('')
    const gaps = axis.gaps.map((g) =>
      `<div class="gap" style="left:${(g.x0 * 100).toFixed(3)}%;width:${((g.x1 - g.x0) * 100).toFixed(3)}%"><span class="gaplbl">${g.label}</span></div>`).join('')
    const ticks = axis.ticks.map((t) =>
      `<span class="atick" style="left:${(t.x * 100).toFixed(3)}%">${t.label}</span>`).join('')
    const winL = msToPct(state.windowStart), winR = msToPct(state.windowEnd)
    const ph = msToPct(state.playhead)
    track.innerHTML =
      `<div class="winmask" style="left:0;width:${winL.toFixed(3)}%"></div>` +
      `<div class="winmask" style="left:${winR.toFixed(3)}%;right:0"></div>` +
      gaps + segs +
      `<div class="phead" style="left:${ph.toFixed(3)}%"></div>` +
      `<div class="handle hL" data-h="L" style="left:${winL.toFixed(3)}%"></div>` +
      `<div class="handle hR" data-h="R" style="left:${winR.toFixed(3)}%"></div>` +
      `<div class="axisticks">${ticks}</div>`
    const fromEl = host.querySelector<HTMLElement>('#tlFrom')!
    const toEl = host.querySelector<HTMLElement>('#tlTo')!
    fromEl.textContent = dayLabel(state.windowStart)
    toEl.textContent = dayLabel(state.windowEnd)
  }

  const pointerPct = (clientX: number) => {
    const r = track.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }

  const bindDrag = () => {
    let dragging: 'L' | 'R' | 'P' | null = null
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.classList.contains('handle')) dragging = t.dataset.h as 'L' | 'R'
      else dragging = 'P'
      track.setPointerCapture(e.pointerId)
      move(e)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const ms = pctToMs(pointerPct(e.clientX))
      if (dragging === 'L') { state.windowStart = Math.min(ms, state.windowEnd - 1); state.playhead = Math.max(state.playhead, state.windowStart) }
      else if (dragging === 'R') { state.windowEnd = Math.max(ms, state.windowStart + 1); state.playhead = Math.min(state.playhead, state.windowEnd) }
      else { state.playhead = Math.min(Math.max(ms, state.windowStart), state.windowEnd) }
      renderTrack()
    }
    const up = () => {
      if (!dragging) return
      if (dragging === 'P') cbSeek(state.playhead)
      else cbWindow(state.windowStart, state.windowEnd)
      dragging = null
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
    render() { axis = buildAxis(state.domainStart, state.domainEnd, state.trips); renderTrack() },
    setPlayhead(ms) { state.playhead = ms; renderTrack() },
    setPlaying(playing) { host.querySelector('#tlPlay')!.textContent = playing ? '❚❚' : '▶' },
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
