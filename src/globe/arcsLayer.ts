import type { Leg } from '../model'
import { MAX_CRED_DELTA_MS } from '../data/transform'

const FLEW = '#5fe0ff'
const DH = '#ffb15f'
const GHOST_FLEW = 'rgba(95,224,255,0.18)'
const GHOST_DH = 'rgba(255,177,95,0.18)'
const ACTIVE_FROM = 'rgba(60,255,140,0.30)' // active leg: dim at departure ...
const ACTIVE_TO = '#5cff9e'                  // ... bright at arrival, so the green points the way it's going

type ArcLeg = Leg & { __ghost?: boolean; __active?: boolean }

export function arcPaint(d: ArcLeg): [string, string] {
  if (d.__active) return [ACTIVE_FROM, ACTIVE_TO] // green gradient along the arc, brightening toward the destination
  if (d.__ghost) { const g = d.dh ? GHOST_DH : GHOST_FLEW; return [g, g] }
  const c = d.dh ? DH : FLEW
  return [c, c]
}

const fmtDelta = (ms: number): string => {
  const sign = ms < 0 ? '−' : '+'
  const m = Math.round(Math.abs(ms) / 60000)
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
const fmtBlock = (ms: number): string => {
  const m = Math.round(ms / 60000)
  return `${Math.floor(m / 60)}+${String(m % 60).padStart(2, '0')}`
}

/** "OFF +0:14 · ON −0:06 · BLOCK 7+42 (SKED 7+55)" — deltas only where both sides exist
 *  and the difference is credible (garbage timestamps produce ±hours-scale noise). */
export function legDeltaLine(d: Leg): string {
  const parts: string[] = []
  const cred = (a: number | null, s: number | null): a is number =>
    a != null && s != null && Math.abs(a - s) <= MAX_CRED_DELTA_MS
  if (cred(d.act.off, d.sched.off)) parts.push(`OFF ${fmtDelta(d.act.off - d.sched.off!)}`)
  if (cred(d.act.on, d.sched.on)) parts.push(`ON ${fmtDelta(d.act.on - d.sched.on!)}`)
  let block = `BLOCK ${fmtBlock(d.blockMs)}`
  const schedBlock = d.sched.in != null && d.sched.out != null ? d.sched.in - d.sched.out : null
  if (schedBlock != null && Math.abs(schedBlock - d.blockMs) >= 60000) block += ` (SKED ${fmtBlock(schedBlock)})`
  parts.push(block)
  return parts.join(' · ')
}

export function combineArcData(solid: Leg[], ghost: Leg[], activeId?: string | null): ArcLeg[] {
  return [
    ...solid.map((l) => (activeId && l.id === activeId ? { ...l, __active: true } : l)),
    ...ghost.map((l) => ({ ...l, __ghost: true })),
  ]
}

export function configureArcs(globe: any) {
  globe
    .arcStartLat((d: Leg) => d.s[0]).arcStartLng((d: Leg) => d.s[1])
    .arcEndLat((d: Leg) => d.e[0]).arcEndLng((d: Leg) => d.e[1])
    .arcColor((d: ArcLeg) => arcPaint(d))
    .arcStroke((d: ArcLeg) => (d.__active ? 0.5 : d.__ghost ? 0.3 : 0.4))
    .arcAltitudeAutoScale(0.45)
    .arcDashLength((d: ArcLeg) => (d.__active ? 1 : d.__ghost ? 0.25 : 0.45)) // active: solid & still
    .arcDashGap((d: ArcLeg) => (d.__active ? 0 : d.__ghost ? 0.5 : 0.18))
    .arcDashAnimateTime(2600)
    .arcLabel((d: ArcLeg) => {
      const hue = d.dh ? DH : FLEW
      const status = d.__ghost
        ? (d.dh ? 'UPCOMING · DEADHEAD' : 'UPCOMING · FLIGHT')
        : (d.dh ? 'DEADHEAD (rode)' : 'FLEW (operated)')
      const delta = d.__ghost ? '' : `<br><span style="color:#9fd8c0;font-size:9px;letter-spacing:1px">${legDeltaLine(d)}</span>`
      return `<div style="font-family:monospace;color:#eaf7ff;background:rgba(8,20,34,.85);padding:6px 9px;border:1px solid rgba(47,214,255,.4);border-radius:7px;font-size:11px"><b style="color:#2fd6ff">${d.from} → ${d.to}</b> · ${d.miles.toLocaleString()} nm<br><span style="color:${hue};font-size:9px;letter-spacing:1px">${status}</span>${delta}</div>`
    })
    .pointLat((d: { lat: number }) => d.lat).pointLng((d: { lng: number }) => d.lng)
    .pointColor(() => '#fff7e0').pointAltitude(0.012).pointRadius(0.6)
}

export function setArcs(globe: any, solid: Leg[], ghost: Leg[] = [], activeId?: string | null) {
  globe.arcsData(combineArcData(solid, ghost, activeId))
  const apts = new Map<string, { lat: number; lng: number; iata: string }>()
  for (const l of solid) {
    apts.set(l.from, { lat: l.s[0], lng: l.s[1], iata: l.from })
    apts.set(l.to, { lat: l.e[0], lng: l.e[1], iata: l.to })
  }
  globe.pointsData([...apts.values()])
}

export function configurePointClick(globe: any, onSelect: (iata: string | null) => void) {
  globe.onPointHover((d: any) => { if (d) onSelect(d.iata) })
  globe.onPointClick((d: any) => onSelect(d?.iata ?? null))
  globe.onGlobeClick(() => onSelect(null))
}
