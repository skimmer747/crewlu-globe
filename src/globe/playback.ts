import type { Leg } from '../model'
import type { Trip } from '../data/trips'

const tripKey = (l: Leg): string => l.tripId ?? l.id

export interface PlaybackSample { index: number; phase: 'draw' | 'dwell'; frac: number; done: boolean }
export interface PlaybackSchedule {
  totalMs: number
  count: number
  timeAtIndex(index: number): number
  sampleAt(elapsedMs: number): PlaybackSample
}

export function buildPlaybackSchedule(
  legs: Leg[],
  _trips: Trip[],
  opts: { legMs: number; dwellMs: number },
): PlaybackSchedule {
  const { legMs, dwellMs } = opts
  const drawStart: number[] = new Array(legs.length)
  let cursor = 0
  for (let i = 0; i < legs.length; i++) {
    drawStart[i] = cursor
    cursor += legMs
    const boundary = i < legs.length - 1 && tripKey(legs[i + 1]) !== tripKey(legs[i])
    if (boundary) cursor += dwellMs
  }
  const totalMs = legs.length ? cursor : 0

  return {
    totalMs,
    count: legs.length,
    timeAtIndex(index) {
      if (!legs.length) return 0
      return drawStart[Math.max(0, Math.min(index, legs.length - 1))]
    },
    sampleAt(elapsedMs) {
      if (!legs.length) return { index: 0, phase: 'dwell', frac: 1, done: true }
      if (elapsedMs >= totalMs) return { index: legs.length - 1, phase: 'dwell', frac: 1, done: true }
      let i = 0
      while (i + 1 < legs.length && drawStart[i + 1] <= elapsedMs) i++
      const local = elapsedMs - drawStart[i]
      if (local < legMs) return { index: i, phase: 'draw', frac: legMs ? local / legMs : 1, done: false }
      return { index: i, phase: 'dwell', frac: 1, done: false }
    },
  }
}

export interface Playback {
  play(): void
  pause(): void
  toggle(): void
  setSpeed(mult: number): void
  isPlaying(): boolean
}

export interface PlaybackController {
  legs: () => Leg[]          // window legs, chronological; MUST return the same-length array between play() and pause()/done()
  trips: () => Trip[]
  startIndex: () => number   // resume: count of legs already solid (playhead-derived)
  baseLegMs: number
  baseDwellMs: number
  onReveal: (solidCount: number) => void
  onFly: (leg: Leg) => void
  onPlayhead: (ms: number) => void
  onDone: () => void
  onPlayingChange: (playing: boolean) => void
}

export function createPlayback(c: PlaybackController): Playback {
  let raf = 0, playing = false, speed = 1
  let sched: PlaybackSchedule | null = null
  let t0 = 0, baseElapsed = 0, lastIndex = -1

  const build = () => buildPlaybackSchedule(c.legs(), c.trips(), { legMs: c.baseLegMs / speed, dwellMs: c.baseDwellMs / speed })

  const frame = (ts: number) => {
    if (!playing || !sched) return
    const e = baseElapsed + (ts - t0)
    const s = sched.sampleAt(e)
    const curLegs = c.legs()
    if (s.index !== lastIndex) {
      lastIndex = s.index
      c.onReveal(s.index + 1)
      const leg = curLegs[s.index]
      if (leg) c.onFly(leg)
    }
    const cur = curLegs[s.index]
    if (cur) c.onPlayhead(cur.t)
    if (s.done) { playing = false; c.onPlayingChange(false); c.onDone(); return }
    raf = requestAnimationFrame(frame)
  }

  const play = () => {
    const legs = c.legs()
    if (!legs.length) return
    sched = build()
    const si = Math.min(Math.max(0, c.startIndex()), legs.length - 1)
    baseElapsed = si >= legs.length - 1 ? 0 : sched.timeAtIndex(si)  // at end -> restart from beginning
    lastIndex = -1
    playing = true
    c.onPlayingChange(true)
    t0 = performance.now()
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(frame)
  }
  const pause = () => { if (!playing) return; playing = false; cancelAnimationFrame(raf); c.onPlayingChange(false) }

  return {
    play, pause,
    toggle() { playing ? pause() : play() },
    setSpeed(mult) {
      speed = mult
      if (playing && sched) {
        const curIdx = lastIndex < 0 ? 0 : lastIndex
        sched = build()
        baseElapsed = sched.timeAtIndex(curIdx)
        t0 = performance.now()
      }
    },
    isPlaying() { return playing },
  }
}
