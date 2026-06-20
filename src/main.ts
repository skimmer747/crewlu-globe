import './styles.css'
import { supabase } from './supabase'
import { requireSession } from './auth/authView'
import { loadAirports } from './data/airports'
import { fetchFlights } from './data/flights'
import { flightsToLegs, statsFor } from './data/transform'
import { groupIntoTrips } from './data/trips'
import { beaconHome, focusTrip, defaultWindow, legsInWindow, splitAtPlayhead } from './data/schedule'
import { createGlobeScene } from './globe/globeScene'
import { configureArcs, setArcs } from './globe/arcsLayer'
import { createMoonLayer } from './globe/moonLayer'
import { createBeaconLayer } from './globe/beaconLayer'
import { createHud } from './globe/hud'
import { createTimelineDock, SPEEDS } from './globe/timelineDock'
import { createPlayback } from './globe/playback'

const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const fmt = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2,'0')} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` }

const app = document.querySelector<HTMLDivElement>('#app')!

async function run() {
  await requireSession(app)

  // FIX 5: get the signed-in email for the account chip
  const { data: sess } = await supabase.auth.getSession()
  const account = sess.session?.user?.email ?? 'Signed in'

  app.innerHTML = '<div id="viewport" style="position:fixed;inset:0"><div id="globe" style="width:100%;height:100%"></div></div><div id="hud" style="position:fixed;inset:0;pointer-events:none"></div>'
  const viewport = app.querySelector<HTMLDivElement>('#viewport')!
  const host = app.querySelector<HTMLDivElement>('#globe')!
  const hudHost = app.querySelector<HTMLDivElement>('#hud')!

  const [airports, flights] = await Promise.all([loadAirports(), fetchFlights(supabase)])
  const { legs, dropped } = flightsToLegs(flights, airports)
  if (dropped) console.warn(`${dropped} legs dropped (unresolved airports or undated rows)`)

  // FIX 4: empty-account state — render friendly panel and bail before building the globe/scrubber
  if (legs.length === 0) {
    app.innerHTML = `<div class="auth"><div class="auth-card">
      <div class="auth-brand">CREWLU<span>·</span>FLIGHT GLOBE</div>
      <p class="auth-sub">No flights to show yet</p>
      <p style="color:#9fc4e6;font-size:12px;line-height:1.6">Import your trips in the Crewlu app and they'll appear here on your globe.</p>
      <button id="signout" class="link">Sign out</button>
    </div></div>`
    app.querySelector('#signout')!.addEventListener('click', async () => { await supabase.auth.signOut(); location.reload() })
    return
  }

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

  // FIX 5: pass real account email and sign-out handler to the HUD chip
  const hud = createHud(hudHost, {
    account,
    onSignOut: async () => { await supabase.auth.signOut(); location.reload() },
  })
  scene.onCameraChange(() => { moon.refreshOcclusion(scene.cameraPos()); beacon.refreshOcclusion(scene.cameraPos()) })
  hud.onCenterTap(() => { scene.globe.controls().autoRotate = false; scene.globe.pointOfView({ lat: beacon.pos.lat, lng: beacon.pos.lng, altitude: 1.7 }, 950) })

  // FIX 6: starfield parallax — drifts at a smaller depth than the globe tilt
  window.addEventListener('mousemove', (e) => {
    const x = e.clientX / window.innerWidth - 0.5, y = e.clientY / window.innerHeight - 0.5
    hud.starfield.style.transform = `translate(${-x * 26}px, ${-y * 26}px)`
  })

  // FIX 7: these listeners and the rAF loop persist for the page lifetime.
  // The app mounts once; if a future sign-out→re-render path is added,
  // they must be torn down to avoid double-binding.
  const loop = () => { beacon.tick(); requestAnimationFrame(loop) }; requestAnimationFrame(loop)

  const trips = groupIntoTrips(legs)
  const now = Date.now()
  const win = defaultWindow(legs, trips, now)
  let playhead = Math.min(Math.max(now, win.start), win.end)

  const tripLabelFor = (ms: number): string | null => {
    const t = focusTrip(trips, ms)
    return t ? `trip to ${t.dest}` : null
  }

  // Arc rebuilds are gated on the solid-count changing (the only moment the
  // solid/ghost partition can change). The cheap per-frame updates always run.
  let lastSolidCount = -1
  const draw = (full = true) => {
    const inWin = legsInWindow(legs, { start: win.start, end: win.end })
    const { solid, ghost } = splitAtPlayhead(inWin, playhead)
    if (full || solid.length !== lastSolidCount) {
      setArcs(scene.globe, solid, ghost)
      hud.setStats(statsFor(solid, meta))
      lastSolidCount = solid.length
    }
    scene.setSun(new Date(playhead))
    moon.update(new Date(playhead))
    scene.globe.htmlElementsData([moon.datum, beacon.datum])
    moon.refreshOcclusion(scene.cameraPos()); beacon.refreshOcclusion(scene.cameraPos())
    hud.setMoment(fmt(playhead), tripLabelFor(playhead), playback.isPlaying() ? 'PLAYING' : 'PAUSED')
  }

  // Park the beacon where the pilot physically is right now.
  const home = beaconHome(legs, now)
  if (home) beacon.setAt(home[0], home[1])

  const dock = createTimelineDock({ legs, trips, windowStart: win.start, windowEnd: win.end, playhead })

  const playback = createPlayback({
    legs: () => legsInWindow(legs, { start: win.start, end: win.end }),
    trips: () => trips,
    startIndex: () => splitAtPlayhead(legsInWindow(legs, { start: win.start, end: win.end }), playhead).solid.length,
    baseLegMs: 1200,
    baseDwellMs: 500,
    onReveal: () => { /* arcs are rebuilt by draw() when solid-count changes */ },
    onFly: (leg) => beacon.flyLeg(leg, Math.max(200, 1200 / SPEEDS[dock.state.speedIndex])),
    onPlayhead: (ms) => { playhead = ms; dock.setPlayhead(ms); draw(false) },
    onDone: () => { dock.setPlaying(false); draw() },
    onPlayingChange: (p) => { dock.setPlaying(p); draw() },
  })

  dock.onPlayToggle(() => playback.toggle())
  dock.onSpeed((mult) => playback.setSpeed(mult))
  dock.onSeek((ms) => { playback.pause(); playhead = ms; draw() })
  dock.onWindowChange((s, e) => {
    playback.pause()
    win.start = s; win.end = e
    playhead = Math.min(Math.max(playhead, s), e)
    dock.render()
    draw()
  })

  dock.mount(hudHost)
  draw() // initial paint, paused
}

run().catch((e) => {
  const msg = e && e.message ? e.message : typeof e === 'string' ? e : JSON.stringify(e)
  app.innerHTML = `<div class="auth"><div class="auth-card">Something went wrong loading your globe.<br><small>${msg}</small></div></div>`
})
