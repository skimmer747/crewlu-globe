import type { Trip } from '../data/trips'

export const DAY = 86400000
export const MIN_ACTIVE_MS = 1.5 * DAY
export const GAP_THRESHOLD_MS = 2 * DAY

export interface AxisPiece {
  kind: 'active' | 'gap'
  startMs: number
  endMs: number
  x0: number
  x1: number
  tripId?: string
}
export interface AxisGap { startMs: number; endMs: number; x0: number; x1: number; label: string }
export interface AxisTick { ms: number; x: number; label: string }
export interface TimeAxis {
  domainStart: number
  domainEnd: number
  pieces: AxisPiece[]
  gaps: AxisGap[]
  ticks: AxisTick[]
  dateToX(ms: number): number
  xToDate(x: number): number
}

export const MIN_TICK_DX = 0.045
const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

function monthStarts(start: number, end: number): number[] {
  const out: number[] = []
  const d = new Date(start)
  let y = d.getUTCFullYear(), m = d.getUTCMonth()
  if (Date.UTC(y, m, 1) < start) { m++; if (m > 11) { m = 0; y++ } }
  for (let ms = Date.UTC(y, m, 1); ms <= end; ) {
    out.push(ms)
    m++; if (m > 11) { m = 0; y++ }
    ms = Date.UTC(y, m, 1)
  }
  return out
}
function yearStarts(start: number, end: number): number[] {
  const out: number[] = []
  let y = new Date(start).getUTCFullYear()
  if (Date.UTC(y, 0, 1) < start) y++
  for (let ms = Date.UTC(y, 0, 1); ms <= end; y++, ms = Date.UTC(y, 0, 1)) out.push(ms)
  return out
}
function weekStarts(start: number, end: number): number[] {
  const out: number[] = []
  for (let ms = Math.ceil(start / (7 * DAY)) * (7 * DAY); ms <= end; ms += 7 * DAY) out.push(ms)
  return out
}

export function gapLabel(ms: number): string {
  const days = ms / DAY
  if (days < 14) return `${Math.max(1, Math.round(days))}d off`
  if (days < 60) return `${Math.round(days / 7)} wks off`
  return `${Math.round(days / 30)} mo off`
}

export interface BuildAxisOpts { gapThresholdMs?: number; minActiveMs?: number }

export function buildAxis(domainStart: number, domainEnd: number, trips: Trip[], opts: BuildAxisOpts = {}): TimeAxis {
  const gapThresholdMs = opts.gapThresholdMs ?? GAP_THRESHOLD_MS
  const minActiveMs = opts.minActiveMs ?? MIN_ACTIVE_MS

  const inDomain = trips
    .filter((t) => t.end >= domainStart && t.start <= domainEnd)
    .map((t) => ({ id: t.id, start: Math.max(t.start, domainStart), end: Math.min(t.end, domainEnd) }))
    .sort((a, b) => a.start - b.start)

  type Raw = { kind: 'active' | 'gap'; startMs: number; endMs: number; tripId?: string }
  const raw: Raw[] = []
  let cursor = domainStart
  for (const t of inDomain) {
    if (t.start > cursor) raw.push({ kind: 'gap', startMs: cursor, endMs: t.start })
    raw.push({ kind: 'active', startMs: t.start, endMs: t.end, tripId: t.id })
    cursor = Math.max(cursor, t.end)
  }
  if (cursor < domainEnd) raw.push({ kind: 'gap', startMs: cursor, endMs: domainEnd })
  if (!raw.length) raw.push({ kind: 'gap', startMs: domainStart, endMs: domainEnd })

  const weight = (p: Raw): number => {
    const dur = p.endMs - p.startMs
    return p.kind === 'active' ? Math.max(dur, minActiveMs) : Math.min(dur, gapThresholdMs)
  }
  const totalW = raw.reduce((s, p) => s + weight(p), 0) || 1

  const pieces: AxisPiece[] = []
  let acc = 0
  for (const p of raw) {
    const w = weight(p)
    const x0 = acc / totalW
    acc += w
    const x1 = acc / totalW
    pieces.push({ kind: p.kind, startMs: p.startMs, endMs: p.endMs, x0, x1, tripId: p.tripId })
  }

  const gaps: AxisGap[] = pieces
    .filter((p) => p.kind === 'gap' && p.endMs - p.startMs > gapThresholdMs)
    .map((p) => ({ startMs: p.startMs, endMs: p.endMs, x0: p.x0, x1: p.x1, label: gapLabel(p.endMs - p.startMs) }))

  const dateToX = (ms: number): number => {
    if (ms <= domainStart) return 0
    if (ms >= domainEnd) return 1
    for (const p of pieces) {
      if (ms >= p.startMs && ms <= p.endMs) {
        const span = p.endMs - p.startMs
        return span <= 0 ? p.x0 : p.x0 + ((ms - p.startMs) / span) * (p.x1 - p.x0)
      }
    }
    return 1
  }
  const xToDate = (x: number): number => {
    const c = Math.min(1, Math.max(0, x))
    for (const p of pieces) {
      if (c >= p.x0 && c <= p.x1) {
        const span = p.x1 - p.x0
        return span <= 0 ? p.startMs : p.startMs + ((c - p.x0) / span) * (p.endMs - p.startMs)
      }
    }
    return domainEnd
  }

  const spanDays = (domainEnd - domainStart) / DAY
  let raw_ticks: { ms: number; label: string }[]
  if (spanDays <= 45) {
    raw_ticks = weekStarts(domainStart, domainEnd).map((ms) => {
      const d = new Date(ms); return { ms, label: `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }
    })
  } else if (spanDays <= 18 * 30) {
    const multiYear = new Date(domainStart).getUTCFullYear() !== new Date(domainEnd).getUTCFullYear()
    raw_ticks = monthStarts(domainStart, domainEnd).map((ms) => {
      const d = new Date(ms)
      return { ms, label: multiYear ? `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : MON[d.getUTCMonth()] }
    })
  } else {
    raw_ticks = yearStarts(domainStart, domainEnd).map((ms) => ({ ms, label: String(new Date(ms).getUTCFullYear()) }))
  }
  const ticks: AxisTick[] = []
  for (const tk of raw_ticks) {
    const x = dateToX(tk.ms)
    if (!ticks.length || x - ticks[ticks.length - 1].x >= MIN_TICK_DX) ticks.push({ ms: tk.ms, x, label: tk.label })
  }

  return { domainStart, domainEnd, pieces, gaps, ticks, dateToX, xToDate }
}
