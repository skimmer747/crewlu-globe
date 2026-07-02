import type { Leg } from '../model'
import { MAX_CRED_DELTA_MS } from '../data/transform'

const FLEW = '#5fe0ff'
const DH = '#ffb15f'
const GHOST_FLEW = 'rgba(95,224,255,0.18)'
const GHOST_DH = 'rgba(255,177,95,0.18)'
const ACTIVE_FROM = 'rgba(60,255,140,0.30)' // active leg: dim at departure ...
const ACTIVE_TO = '#5cff9e'                  // ... bright at arrival, so the green points the way it's going

type ArcLeg = Leg & { __ghost?: boolean; __active?: boolean; __spot?: boolean; __dim?: boolean; __fleet?: number }

const SPOT_FROM = 'rgba(255, 215, 120, 0.35)' // record spotlight: gold, brightening toward arrival
const SPOT_TO = '#ffd778'
const DIMMED = 'rgba(120, 160, 190, 0.10)'    // everything else recedes while a spotlight is on
/** Fleet lens palette, indexed by fleet rank (0 = most-flown type). */
export const FLEET_HUES = ['#5fe0ff', '#ffd778', '#c792ea', '#7ddc8f', '#ff9e9e']
const FLEET_OTHER = '#9fb3c4'

export function arcPaint(d: ArcLeg): [string, string] {
  if (d.__active) return [ACTIVE_FROM, ACTIVE_TO] // green gradient along the arc, brightening toward the destination
  if (d.__ghost) { const g = d.dh ? GHOST_DH : GHOST_FLEW; return [g, g] }
  if (d.__spot) return [SPOT_FROM, SPOT_TO]
  if (d.__dim) return [DIMMED, DIMMED]
  if (d.__fleet !== undefined) { const c = d.__fleet >= 0 ? FLEET_HUES[d.__fleet % FLEET_HUES.length] : FLEET_OTHER; return [c, c] }
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

export interface ArcPaintOpts { spotIds?: Set<string>; fleetRank?: Map<string, number> }

export function combineArcData(solid: Leg[], ghost: Leg[], activeId?: string | null, opts?: ArcPaintOpts): ArcLeg[] {
  const spotting = !!opts?.spotIds?.size
  const tag = (l: Leg): ArcLeg => {
    if (activeId && l.id === activeId) return { ...l, __active: true }
    if (spotting) return opts!.spotIds!.has(l.id) ? { ...l, __spot: true } : { ...l, __dim: true }
    if (opts?.fleetRank) {
      const type = (l.aircraft ?? '').trim().toUpperCase() || 'UNK'
      return { ...l, __fleet: opts.fleetRank.get(type) ?? -1 }
    }
    return l
  }
  return [
    ...solid.map(tag),
    ...ghost.map((l) => ({ ...l, __ghost: true })),
  ]
}

export function configureArcs(globe: any) {
  globe
    .arcStartLat((d: Leg) => d.s[0]).arcStartLng((d: Leg) => d.s[1])
    .arcEndLat((d: Leg) => d.e[0]).arcEndLng((d: Leg) => d.e[1])
    .arcColor((d: ArcLeg) => arcPaint(d))
    .arcStroke((d: ArcLeg) => (d.__active ? 0.5 : d.__spot ? 0.6 : d.__ghost ? 0.3 : 0.4))
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

export function setArcs(globe: any, solid: Leg[], ghost: Leg[] = [], activeId?: string | null, opts?: ArcPaintOpts) {
  globe.arcsData(combineArcData(solid, ghost, activeId, opts))
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
