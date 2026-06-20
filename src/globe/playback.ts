import type { Leg } from '../model'
import type { Trip } from '../data/trips'

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
    const boundary = i < legs.length - 1 && legs[i + 1].tripId !== legs[i].tripId
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
