import type { Leg } from '../model'

const FLEW = '#5fe0ff'
const DH = '#ffb15f'
const GHOST_FLEW = 'rgba(95,224,255,0.18)'
const GHOST_DH = 'rgba(255,177,95,0.18)'

type ArcLeg = Leg & { __ghost?: boolean }

export function arcPaint(d: ArcLeg): [string, string] {
  if (d.__ghost) { const g = d.dh ? GHOST_DH : GHOST_FLEW; return [g, g] }
  const c = d.dh ? DH : FLEW
  return [c, c]
}

export function combineArcData(solid: Leg[], ghost: Leg[]): ArcLeg[] {
  return [...solid, ...ghost.map((l) => ({ ...l, __ghost: true }))]
}

export function configureArcs(globe: any) {
  globe
    .arcStartLat((d: Leg) => d.s[0]).arcStartLng((d: Leg) => d.s[1])
    .arcEndLat((d: Leg) => d.e[0]).arcEndLng((d: Leg) => d.e[1])
    .arcColor((d: ArcLeg) => arcPaint(d))
    .arcStroke((d: ArcLeg) => (d.__ghost ? 0.3 : 0.6))
    .arcAltitudeAutoScale(0.45)
    .arcDashLength((d: ArcLeg) => (d.__ghost ? 0.25 : 0.45))
    .arcDashGap((d: ArcLeg) => (d.__ghost ? 0.5 : 0.18))
    .arcDashAnimateTime(2600)
    .arcLabel((d: ArcLeg) => {
      const hue = d.dh ? DH : FLEW
      const status = d.__ghost
        ? (d.dh ? 'UPCOMING · DEADHEAD' : 'UPCOMING · FLIGHT')
        : (d.dh ? 'DEADHEAD (rode)' : 'FLEW (operated)')
      return `<div style="font-family:monospace;color:#eaf7ff;background:rgba(8,20,34,.85);padding:6px 9px;border:1px solid rgba(47,214,255,.4);border-radius:7px;font-size:11px"><b style="color:#2fd6ff">${d.from} → ${d.to}</b> · ${d.miles.toLocaleString()} nm<br><span style="color:${hue};font-size:9px;letter-spacing:1px">${status}</span></div>`
    })
    .pointLat((d: { lat: number }) => d.lat).pointLng((d: { lng: number }) => d.lng)
    .pointColor(() => '#fff7e0').pointAltitude(0.012).pointRadius(0.34)
}

export function setArcs(globe: any, solid: Leg[], ghost: Leg[] = []) {
  globe.arcsData(combineArcData(solid, ghost))
  const apts = new Map<string, { lat: number; lng: number }>()
  for (const l of solid) { apts.set(l.from, { lat: l.s[0], lng: l.s[1] }); apts.set(l.to, { lat: l.e[0], lng: l.e[1] }) }
  globe.pointsData([...apts.values()])
}
