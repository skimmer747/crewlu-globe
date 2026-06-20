import './styles.css'
import { supabase } from './supabase'
import { requireSession } from './auth/authView'
import { loadAirports } from './data/airports'
import { fetchFlights } from './data/flights'
import { flightsToLegs, legsUpTo, statsFor } from './data/transform'
import { createGlobeScene } from './globe/globeScene'
import { configureArcs, setArcs } from './globe/arcsLayer'
import { createMoonLayer } from './globe/moonLayer'
import { createBeaconLayer } from './globe/beaconLayer'
import { createHud } from './globe/hud'
import { createScrubber } from './globe/scrubber'

const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const fmt = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2,'0')} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` }

const app = document.querySelector<HTMLDivElement>('#app')!

async function run() {
  await requireSession(app)

  app.innerHTML = '<div id="viewport" style="position:fixed;inset:0"><div id="globe" style="width:100%;height:100%"></div></div><div id="hud" style="position:fixed;inset:0;pointer-events:none"></div>'
  const viewport = app.querySelector<HTMLDivElement>('#viewport')!
  const host = app.querySelector<HTMLDivElement>('#globe')!
  const hudHost = app.querySelector<HTMLDivElement>('#hud')!

  const [airports, flights] = await Promise.all([loadAirports(), fetchFlights(supabase)])
  const { legs, dropped } = flightsToLegs(flights, airports)
  if (dropped) console.warn(`${dropped} legs dropped (unresolved airports)`)
  const meta = airports

  const scene = createGlobeScene(host, viewport)
  configureArcs(scene.globe)
  const moon = createMoonLayer()
  const beacon = createBeaconLayer()

  scene.globe
    .htmlElementsData([moon.datum, beacon.datum])
    .htmlLat((d: any) => d.lat).htmlLng((d: any) => d.lng).htmlAltitude((d: any) => d.alt)
    .htmlElement((d: any) => (d.type === 'beacon' ? beacon.el : moon.el))
  beacon.setContrailSink(scene.globe)

  const hud = createHud(hudHost)
  scene.onCameraChange(() => { moon.refreshOcclusion(scene.cameraPos()); beacon.refreshOcclusion(scene.cameraPos()) })
  hud.onCenterTap(() => { scene.globe.controls().autoRotate = false; scene.globe.pointOfView({ lat: beacon.pos.lat, lng: beacon.pos.lng, altitude: 1.7 }, 950) })

  const loop = () => { beacon.tick(); requestAnimationFrame(loop) }; requestAnimationFrame(loop)

  let lastRevealed = 0
  const scrubber = createScrubber(legs)
  scrubber.mount(hudHost)
  scrubber.onScrub((cutoff, pct, playing) => {
    const shown = legsUpTo(legs, cutoff)
    setArcs(scene.globe, shown)
    hud.setStats(statsFor(shown, meta))
    hud.setMoment(fmt(cutoff), pct)
    scene.setSun(new Date(cutoff))
    moon.update(new Date(cutoff))
    scene.globe.htmlElementsData([moon.datum, beacon.datum])
    moon.refreshOcclusion(scene.cameraPos()); beacon.refreshOcclusion(scene.cameraPos())
    if (shown.length > lastRevealed) { const leg = shown[shown.length - 1]; playing ? beacon.flyLeg(leg) : beacon.setAt(leg.e[0], leg.e[1]) }
    else if (shown.length < lastRevealed) { const leg = shown[shown.length - 1]; if (leg) beacon.setAt(leg.e[0], leg.e[1]) }
    lastRevealed = shown.length
  })
  scrubber.start()
}

run().catch((e) => { app.innerHTML = `<div class="auth"><div class="auth-card">Something went wrong loading your globe.<br><small>${String(e)}</small></div></div>` })
