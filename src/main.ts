import './styles.css'
import { supabase } from './supabase'
import { requireSession } from './auth/authView'
import { loadAirports } from './data/airports'
import { fetchFlights } from './data/flights'
import { flightsToLegs, statsFor, computeAirportStats } from './data/transform'
import { groupIntoTrips } from './data/trips'
import { beaconHome, defaultWindow, legsInWindow, splitAtPlayhead } from './data/schedule'
import { slerp } from './astro/geo'
import { isOccluded, geoToCartesian } from './globe/occlusion'
import { clipBehindEarth } from './globe/skyOcclusion'
import { createSkyLayer } from './globe/skyLayer'
import { createGlobeScene } from './globe/globeScene'
import { configureArcs, setArcs, configurePointClick } from './globe/arcsLayer'
import { createMoonLayer } from './globe/moonLayer'
import { createBeaconLayer } from './globe/beaconLayer'
import { createDartLayer } from './globe/dartLayer'
import { createHud } from './globe/hud'
import { createTimelineDock, SPEEDS } from './globe/timelineDock'
import { createPlayback } from './globe/playback'
import { createLunarTrajectory, buildTrajectoryPoints, lunarReturns, LUNAR_RETURN_NM } from './globe/lunarTrajectory'

const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const fmt = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2,'0')} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
const pad = (n: number) => String(n).padStart(2, '0')
const fmtDateTime = (ms: number) => { const d = new Date(ms); return `${fmt(ms)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z` }

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
  const airportStats = computeAirportStats(legs)

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
  const dart = createDartLayer()
  const sky = createSkyLayer()
  const lunar = createLunarTrajectory(scene.globe)

  scene.globe
    .htmlElementsData([...sky.data, moon.datum, beacon.datum])
    .htmlLat((d: any) => d.lat).htmlLng((d: any) => d.lng).htmlAltitude((d: any) => d.alt)
    .htmlElement((d: any) => (d.type === 'sky' ? sky.elementFor(d.id) : d.type === 'beacon' ? beacon.el : moon.el))
  beacon.setContrailSink(scene.globe)
  dart.attach(scene.globe)

  // FIX 5: pass real account email and sign-out handler to the HUD chip
  const hud = createHud(hudHost, {
    account,
    onSignOut: async () => { await supabase.auth.signOut(); location.reload() },
  })
  // Occlude DOM sky bodies (Moon, Sun, planets) behind the Earth as the camera moves:
  // big bodies get the limb-clip; tiny ones (planets) just hide when behind.
  const applyOcclusion = () => {
    const cam = scene.cameraPos()
    const fov = ((scene.globe.camera?.()?.fov) ?? 50) * Math.PI / 180
    const halfH = viewport.clientHeight / 2
    const mp = geoToCartesian(moon.datum.lat, moon.datum.lng, moon.datum.alt, 100)
    const dMoon = Math.hypot(mp.x - cam.x, mp.y - cam.y, mp.z - cam.z) || 1
    const physRpx = halfH * Math.tan(Math.asin(Math.min(1, 27.27 / dMoon))) / Math.tan(fov / 2)
    let moonRpx: number
    if (lunarOn) {
      // Lerp from physical size (altitude ~2, just after toggle fires, no balloon) to
      // 80% of Earth's apparent size (altitude 62, full lunar view). Moon grows ~4× while
      // Earth shrinks ~20×, giving a visible "zoom in" effect without the initial blob.
      const dEarth = Math.hypot(cam.x, cam.y, cam.z) || 1
      const altitude = dEarth / 100 - 1
      const earthRpx = halfH * Math.tan(Math.asin(Math.min(1, 100 / dEarth))) / Math.tan(fov / 2)
      const t = Math.max(0, Math.min(1, (altitude - 2) / 60))
      moonRpx = physRpx + t * (0.8 * earthRpx - physRpx)
    } else {
      moonRpx = physRpx
    }
    moon.setScale(Math.min(5, Math.max(0.02, moonRpx / 23.8))) // 23.8px = rendered disk radius at scale 1
    clipBehindEarth({ el: moon.el, halfSize: 42, lat: moon.datum.lat, lng: moon.datum.lng, alt: moon.datum.alt, cam, globe: scene.globe, viewport })
    for (const b of sky.bodies) {
      if (b.occlude === 'clip') clipBehindEarth({ el: b.el, halfSize: b.halfSize, lat: b.datum.lat, lng: b.datum.lng, alt: b.datum.alt, cam, globe: scene.globe, viewport })
      else b.el.style.opacity = isOccluded(cam, b.datum.lat, b.datum.lng, b.datum.alt) ? '0' : '1'
    }
    beacon.refreshOcclusion(cam)
  }
  scene.onCameraChange(applyOcclusion)
  hud.onCenterTap(() => { scene.globe.controls().autoRotate = false; scene.globe.pointOfView({ lat: beacon.pos.lat, lng: beacon.pos.lng, altitude: 1.7 }, 950) })

  configurePointClick(scene.globe, (iata) => {
    if (!iata) { hud.setCityStats(null); return }
    const apt = airports.lookup(iata)
    const stats = airportStats.get(iata)
    if (!apt || !stats) { hud.setCityStats(null); return }
    hud.setCityStats({ iata, city: apt.city ?? iata, country: apt.country ?? '', landings: stats.landings, layoverMs: stats.layoverMs })
  })

  // FIX 6: starfield parallax — drifts at a smaller depth than the globe tilt
  window.addEventListener('mousemove', (e) => {
    const x = e.clientX / window.innerWidth - 0.5, y = e.clientY / window.innerHeight - 0.5
    hud.starfield.style.transform = `translate(${-x * 26}px, ${-y * 26}px)`
  })

  // FIX 7: these listeners and the rAF loop persist for the page lifetime.
  // The app mounts once; if a future sign-out→re-render path is added,
  // they must be torn down to avoid double-binding.
  const loop = () => { beacon.tick(); dart.tick(); beacon.setVeil(dart.presence()); requestAnimationFrame(loop) }; requestAnimationFrame(loop)

  const trips = groupIntoTrips(legs)
  const now = Date.now()
  const win = defaultWindow(legs, trips, now)
  // The window's right edge is the last departure; nudge it out to that final flight's
  // scheduled landing so the timeline can show the trip's last leg (not just its takeoff).
  const lastLeg = legs[legs.length - 1]
  win.end = Math.max(win.end, lastLeg.landing)
  let playhead = Math.min(Math.max(now, win.start), win.end)

  // Where the pilot is at an instant: airborne on a leg (between its scheduled takeoff and landing),
  // or on the ground — taxiing out before takeoff, or sitting at the last arrival.
  const positionAt = (t: number): { latlng: [number, number]; label: string } => {
    let prev: (typeof legs)[number] | null = null
    for (const l of legs) { if (l.t <= t) prev = l; else break }
    if (!prev) { const f = legs[0]; return { latlng: f.s, label: f.from } } // before the first departure
    if (t < prev.takeoff) return { latlng: prev.s, label: prev.from } // pushed back, not yet airborne
    if (t <= prev.landing) {
      const frac = Math.min(1, Math.max(0, (t - prev.takeoff) / Math.max(1, prev.landing - prev.takeoff)))
      return { latlng: slerp(prev.s, prev.e, frac), label: `${prev.from} → ${prev.to}` } // in the air
    }
    return { latlng: prev.e, label: prev.to } // landed, on the ground
  }

  // Arc rebuilds are gated on the solid-count OR the active (in-flight) leg changing.
  // The cheap per-frame updates always run.
  let activeLegId: string | null = null
  let lastSolidCount = -1
  let lastActiveId: string | null = null
  let currentMiles = 0
  let lunarOn = false, revealRaf = 0
  // Rebuild the lunar line + readout from the current miles & Moon position (called on toggle and on every timeline change).
  const refreshLunar = (animate: boolean) => {
    lunar.setPath(buildTrajectoryPoints(moon.datum.lat, moon.datum.lng, moon.datum.alt))
    const laps = lunarReturns(currentMiles)
    hud.setLunarReadout(`DISTANCE FLOWN  ${Math.round(currentMiles).toLocaleString()} NM\nEARTH–MOON RETURN  ${LUNAR_RETURN_NM.toLocaleString()} NM\n= ${laps.toFixed(2)} LUNAR RETURNS`)
    const target = Math.min(1, laps)
    cancelAnimationFrame(revealRaf)
    if (!animate) { lunar.setReveal(target); return }
    const t0 = performance.now()
    const step = (ts: number) => { const f = Math.min(1, (ts - t0) / 1600); lunar.setReveal(f * target); if (f < 1) revealRaf = requestAnimationFrame(step) }
    revealRaf = requestAnimationFrame(step)
  }
  const draw = (full = true) => {
    const inWin = legsInWindow(legs, { start: win.start, end: win.end })
    const { solid, ghost } = splitAtPlayhead(inWin, playhead)
    if (full || solid.length !== lastSolidCount || activeLegId !== lastActiveId) {
      setArcs(scene.globe, solid, ghost, activeLegId)
      const stats = statsFor(solid, meta); hud.setStats(stats); currentMiles = stats.miles
      lastSolidCount = solid.length
      lastActiveId = activeLegId
    }
    scene.setSun(new Date(playhead))
    moon.update(new Date(playhead))
    sky.update(new Date(playhead))
    scene.globe.htmlElementsData([...sky.data, moon.datum, beacon.datum])
    applyOcclusion()
    // During playback show the flying leg's full route; when scrubbing/paused fall back to the
    // exact position (route in the air, city on the ground).
    const active = activeLegId ? legs.find((l) => l.id === activeLegId) : null
    hud.setMoment(active ? `${active.from} → ${active.to}` : positionAt(playhead).label, fmtDateTime(playhead))
    if (lunarOn) refreshLunar(false) // keep the lunar line + readout in sync with the timeline
  }

  // Park the beacon where the pilot physically is right now.
  const home = beaconHome(legs, now)
  if (home) beacon.setAt(home[0], home[1])

  const dock = createTimelineDock({ legs, trips, windowStart: win.start, windowEnd: win.end, playhead, now })

  // Camera zoom tracks leg length: short hops zoom way in, long hauls pull out (lower altitude = closer).
  const altForLeg = (miles: number) => Math.min(2.6, Math.max(0.6, 0.6 + miles * 0.00033))
  const playback = createPlayback({
    legs: () => legsInWindow(legs, { start: win.start, end: win.end }),
    trips: () => trips,
    startIndex: () => splitAtPlayhead(legsInWindow(legs, { start: win.start, end: win.end }), playhead).solid.length,
    baseLegMs: 1200,
    baseDwellMs: 500,
    onReveal: () => { /* arcs are rebuilt by draw() when solid-count changes */ },
    onFly: (leg) => {
      const dur = Math.max(200, 1200 / SPEEDS[dock.state.speedIndex])
      activeLegId = leg.id // paint this leg's arc green while it flies
      beacon.flyLeg(leg, dur)
      dart.flyLeg(leg, dur) // the 3D dart rides the same leg, in sync

      // camera follows the plane to its arrival, zoomed to the leg's length
      scene.globe.pointOfView({ lat: leg.e[0], lng: leg.e[1], altitude: altForLeg(leg.miles) }, dur)
    },
    onPlayhead: (ms) => { playhead = ms; dock.setPlayhead(ms); draw(false) },
    onDone: () => { activeLegId = null; dock.setPlaying(false); draw() },
    onPlayingChange: (p) => { dock.setPlaying(p); if (p) scene.globe.controls().autoRotate = false; else { activeLegId = null; dart.stop(); beacon.halt() } draw() },
  })

  dock.onPlayToggle(() => playback.toggle())
  dock.onSpeed((mult) => playback.setSpeed(mult))
  dock.onSeek((ms) => {
    playhead = ms
    playback.pause()
    // spin the globe to where the pilot would be at that instant, and park the beacon there
    const loc = positionAt(ms)
    beacon.setAt(loc.latlng[0], loc.latlng[1])
    scene.globe.controls().autoRotate = false
    scene.globe.pointOfView({ lat: loc.latlng[0], lng: loc.latlng[1], altitude: 1.7 }, 800)
    draw()
  })
  dock.onWindowChange((s, e) => {
    win.start = s; win.end = e
    playhead = Math.min(Math.max(playhead, s), e)
    playback.pause()
    // The dock manages its own rendering (live shuttle + spring-back); re-rendering it
    // here would fight that animation. We only update the globe to the new window.
    draw()
  })

  // Lunar return trajectory: a NASA-style line whose length = the miles flown, drawn Earth → around
  // the Moon → back. Toggling it pulls the camera into a wide "mission view".
  let savedMaxDist = 0, savedPov: any = null
  hud.onLunarToggle(() => {
    lunarOn = !lunarOn
    hud.setLunarActive(lunarOn)
    const ctr = scene.globe.controls()
    if (lunarOn) {
      playback.pause()
      savedMaxDist = ctr.maxDistance; savedPov = scene.globe.pointOfView()
      ctr.maxDistance = 9000; ctr.autoRotate = false
      scene.globe.pointOfView({ lat: 0, lng: moon.datum.lng + 90, altitude: 62 }, 1400)
      refreshLunar(true)
    } else {
      cancelAnimationFrame(revealRaf)
      lunar.hide()
      ctr.maxDistance = savedMaxDist || 1800
      if (savedPov) scene.globe.pointOfView(savedPov, 1200)
    }
  })

  dock.mount(hudHost)
  draw() // initial paint, paused
}

run().catch((e) => {
  const msg = e && e.message ? e.message : typeof e === 'string' ? e : JSON.stringify(e)
  app.innerHTML = `<div class="auth"><div class="auth-card">Something went wrong loading your globe.<br><small>${msg}</small></div></div>`
})
