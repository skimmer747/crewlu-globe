import type { Leg } from '../model'

const FLEW = '#5fe0ff'
const DH = '#ffb15f'

export function configureArcs(globe: any) {
  globe
    .arcStartLat((d: Leg) => d.s[0]).arcStartLng((d: Leg) => d.s[1])
    .arcEndLat((d: Leg) => d.e[0]).arcEndLng((d: Leg) => d.e[1])
    .arcColor((d: Leg) => { const c = d.dh ? DH : FLEW; return [c, c] })
    .arcStroke(0.6).arcAltitudeAutoScale(0.45)
    .arcDashLength(0.45).arcDashGap(0.18).arcDashAnimateTime(2600)
    .arcLabel((d: Leg) => `<div style="font-family:monospace;color:#eaf7ff;background:rgba(8,20,34,.85);padding:6px 9px;border:1px solid rgba(47,214,255,.4);border-radius:7px;font-size:11px"><b style="color:#2fd6ff">${d.from} → ${d.to}</b> · ${d.miles.toLocaleString()} nm<br><span style="color:${d.dh ? DH : FLEW};font-size:9px;letter-spacing:1px">${d.dh ? 'DEADHEAD (rode)' : 'FLEW (operated)'}</span></div>`)
    .pointLat((d: { lat: number }) => d.lat).pointLng((d: { lng: number }) => d.lng)
    .pointColor(() => '#fff7e0').pointAltitude(0.012).pointRadius(0.34)
}

export function setArcs(globe: any, legs: Leg[]) {
  globe.arcsData(legs)
  const apts = new Map<string, { lat: number; lng: number }>()
  for (const l of legs) { apts.set(l.from, { lat: l.s[0], lng: l.s[1] }); apts.set(l.to, { lat: l.e[0], lng: l.e[1] }) }
  globe.pointsData([...apts.values()])
}
