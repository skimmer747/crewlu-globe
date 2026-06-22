// Pure helpers for the timeline shuttle-zoom interaction. No DOM — unit-tested.

export const DAY = 86_400_000

export interface ShuttleOpts {
  deadZonePx?: number // ignore tiny overshoot near the bar's home
  targetSec?: number  // seconds to cross `spanMs` at a full-pull
  exponent?: number   // >1 => accelerating curve
}

/**
 * Outward-pull velocity for a shuttle bar, in ms of timeline per real second.
 * Gentle near home (fine control), ramping up the further the pointer is pushed.
 *
 * @param overshootPx how far the pointer is past the bar's home, outward (px). <= deadzone => 0.
 * @param runwayPx    overshoot (px) at which max speed is reached.
 * @param spanMs      full data span (domainEnd - domainStart) — sets the max speed.
 */
export function shuttleRate(overshootPx: number, runwayPx: number, spanMs: number, opts: ShuttleOpts = {}): number {
  const deadZone = opts.deadZonePx ?? 5
  const targetSec = opts.targetSec ?? 2.5
  const exponent = opts.exponent ?? 2
  if (overshootPx <= deadZone || runwayPx <= deadZone) return 0
  const frac = Math.min(1, (overshootPx - deadZone) / (runwayPx - deadZone))
  const eased = Math.pow(frac, exponent)
  return eased * (spanMs / targetSec)
}

/** Clamp a moved start (From) edge within [domainStart, windowEnd - minWinMs]. */
export function clampStart(start: number, windowEnd: number, domainStart: number, minWinMs: number): number {
  return Math.min(Math.max(start, domainStart), windowEnd - minWinMs)
}

/** Clamp a moved end (To) edge within [windowStart + minWinMs, domainEnd]. */
export function clampEnd(end: number, windowStart: number, domainEnd: number, minWinMs: number): number {
  return Math.max(Math.min(end, domainEnd), windowStart + minWinMs)
}
