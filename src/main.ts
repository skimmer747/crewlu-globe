import './styles.css'
import { supabase } from './supabase'
import { requireSession } from './auth/authView'
import { loadAirports } from './data/airports'
import { fetchFlights, fetchTripBases } from './data/flights'
import { flightsToLegs, statsFor, computeAirportStats } from './data/transform'
import { groupIntoTrips } from './data/trips'
import { beaconHome, defaultWindow, legsInWindow, splitAtPlayhead } from './data/schedule'
import { slerp } from './astro/geo'
import { isOccluded, geoToCartesian } from './globe/occlusion'
import { clipBehindEarth, featherBehindEarth } from './globe/skyOcclusion'
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
import { createContrail } from './globe/contrail'
import { sunElevationDeg } from './astro/sun'
import { demoFlights } from './data/demoFlights'
import { parseDeepLink } from './globe/deeplink'
import { recordsFor, milestonesFor, fleetStats, EARTH_LAP_NM } from './data/career'
import { composeShareCard, composeTripCard } from './globe/shareCard'
import { resolveShareTrips, tripLabel, tripCardStats, pickTripSpeedIndex } from './data/shareTrips'
import { recordTripVideo, canRecordVideo } from './globe/tripVideo'

const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const fmt = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2,'0')} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
const pad = (n: number) => String(n).padStart(2, '0')
const fmtDateTime = (ms: number) => { const d = new Date(ms); return `${fmt(ms)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z` }
const MOON_EARTH_RATIO = 0.2 // Moon's on-screen size as a fraction of Earth's apparent size (both scale together at every zoom; bigger = larger Moon)

const app = document.querySelector<HTMLDivElement>('#app')!

async function run() {
  // Jumpseat Mode: ?demo=1 rides a synthetic UPS line through the real pipeline —
  // no account, no Supabase calls. Everything downstream is identical.
  const demo = new URLSearchParams(location.search).get('demo') === '1'
  let account = 'DEMO · GET CREWLU'
  if (!demo) {
    await requireSession(app)
    // FIX 5: get the signed-in email for the account chip
    const { data: sess } = await supabase.auth.getSession()
    account = sess.session?.user?.email ?? 'Signed in'
  }

  app.innerHTML = '<div id="viewport" style="position:fixed;inset:0"><div id="globe" style="width:100%;height:100%"></div></div><div id="hud" style="position:fixed;inset:0;pointer-events:none"></div><div id="acquiring">ACQUIRING TELEMETRY <span class="acq-cursor">▌</span></div>'
  const viewport = app.querySelector<HTMLDivElement>('#viewport')!
  const host = app.querySelector<HTMLDivElement>('#globe')!
  const hudHost = app.querySelector<HTMLDivElement>('#hud')!

  const [airports, flights, baseByTrip] = await Promise.all([
    loadAirports(),
    demo ? Promise.resolve(demoFlights()) : fetchFlights(supabase),
    // base-at-the-time map for RECORDS; failure degrades to no exclusion, never blocks the globe
    demo ? Promise.resolve(new Map<string, string>())
         : fetchTripBases(supabase).catch((e) => { console.warn('trip bases unavailable', e); return new Map<string, string>() }),
  ])
  app.querySelector('#acquiring')?.remove()
  if (demo) for (const f of flights) if (f.trip_id) baseByTrip.set(f.trip_id, 'SDF') // demo line is SDF-based
  const { legs, dropped } = flightsToLegs(flights, airports, baseByTrip)
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
  // (in demo mode the chip is a call-to-action that opens crewlu.net instead)
  const hud = createHud(hudHost, {
    account,
    onSignOut: demo
      ? () => { window.open('https://crewlu.net', '_blank', 'noopener') }
      : async () => { await supabase.auth.signOut(); location.reload() },
  })
  // Occlude DOM sky bodies (Moon, Sun, planets) behind the Earth as the camera moves:
  // big bodies get the limb-clip; tiny ones (planets) just hide when behind.
  const applyOcclusion = () => {
    const cam = scene.cameraPos()
    // The Moon's on-screen size is locked to a fixed fraction of the Earth's apparent size
    // — the SAME formula in both normal and lunar modes — so the two always scale together:
    // zoom out and both shrink at the same ratio, zoom in and both grow. No mode-dependent
    // jump when toggling lunar return. MOON_EARTH_RATIO is the single size knob.
    const fov = ((scene.globe.camera?.()?.fov) ?? 50) * Math.PI / 180
    const halfH = viewport.clientHeight / 2
    const dEarth = Math.hypot(cam.x, cam.y, cam.z) || 1
    const earthRpx = halfH * Math.tan(Math.asin(Math.min(1, 100 / dEarth))) / Math.tan(fov / 2)
    // Cap of 10 is just a safety ceiling (only reached when Earth fills the whole viewport,
    // where the Moon is off-screen anyway). A lower cap froze the Moon at a fixed size while
    // zoomed in, so it couldn't shrink with Earth until Earth had nearly caught down to it.
    moon.setScale(Math.min(10, Math.max(0.02, (MOON_EARTH_RATIO * earthRpx) / 23.8))) // 23.8px = rendered disk radius at scale 1
    // Feather the Moon behind Earth (soft fade across the atmosphere) instead of a hard limb clip,
    // so it recedes behind the blue glow rather than looking cut out. Mask rides the scaled inner el.
    featherBehindEarth({ maskEl: moon.scaleEl, boxHalf: 42, scale: moon.scale, lat: moon.datum.lat, lng: moon.datum.lng, alt: moon.datum.alt, cam, globe: scene.globe, viewport })
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
  // The contrail rides the dart: points recorded while it flies, tail-decayed after landing.
  // pathsData writes are throttled to ~25fps (known DOM-churn hot path) and skipped when empty.
  const contrail = createContrail()
  let lastTrailWrite = 0
  let lastTrailN = 0
  const loop = () => {
    beacon.tick(); dart.tick(); beacon.setVeil(dart.presence())
    const nowMs = performance.now()
    const g = dart.geoPos()
    if (g) contrail.push(g[0], g[1], g[2], nowMs)
    else if (contrail.size()) contrail.decay()
    if (nowMs - lastTrailWrite >= 40) {
      lastTrailWrite = nowMs
      const snap = contrail.snapshot()
      const n = snap ? snap.pts.length : 0
      if (n > 0 || lastTrailN > 0) scene.globe.pathsData(snap ? [snap] : [])
      lastTrailN = n
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  const trips = groupIntoTrips(legs)
  const now = Date.now()
  const win = defaultWindow(legs, trips, now)
  // The window's right edge is the last departure; nudge it out to that final flight's
  // scheduled landing so the timeline can show the trip's last leg (not just its takeoff).
  const lastLeg = legs[legs.length - 1]
  win.end = Math.max(win.end, lastLeg.landing)
  if (demo) win.start = legs[0].t - 12 * 3600 * 1000 // demo: show the whole line, not just the current trip
  let playhead = Math.min(Math.max(now, win.start), win.end)

  // Deep link (#trip=<id>&play=1): snap the window to that trip and cue the playhead.
  const link = parseDeepLink(location.hash)
  const linkedTrip = link.trip ? trips.find((t) => t.id === link.trip) : undefined
  if (linkedTrip) {
    const lastTripLeg = linkedTrip.legs[linkedTrip.legs.length - 1]
    win.start = linkedTrip.start - 12 * 3600 * 1000
    win.end = lastTripLeg.landing + 12 * 3600 * 1000
    playhead = linkedTrip.start
  }

  // Where the pilot is at an instant, OOOI-phased: taxi-out (out -> off), airborne
  // (off -> on), taxi-in (on -> in), or parked at the last arrival.
  const positionAt = (t: number): { latlng: [number, number]; label: string } => {
    let prev: (typeof legs)[number] | null = null
    for (const l of legs) { if (l.t <= t) prev = l; else break }
    if (!prev) { const f = legs[0]; return { latlng: f.s, label: f.from } } // before the first departure
    if (t < prev.takeoff) return { latlng: prev.s, label: `${prev.from} · TAXI OUT` } // pushed back, not yet airborne
    if (t <= prev.landing) {
      const frac = Math.min(1, Math.max(0, (t - prev.takeoff) / Math.max(1, prev.landing - prev.takeoff)))
      return { latlng: slerp(prev.s, prev.e, frac), label: `${prev.from} → ${prev.to}` } // in the air
    }
    if (t <= prev.in) return { latlng: prev.e, label: `${prev.to} · TAXI IN` } // landed, rolling to the gate
    return { latlng: prev.e, label: prev.to } // parked
  }

  // Arc rebuilds are gated on the solid-count OR the active (in-flight) leg changing.
  // The cheap per-frame updates always run.
  let activeLegId: string | null = null
  let spotIds: Set<string> | null = null
  let fleetOn = false
  let lastSolidCount = -1
  let lastActiveId: string | null = null
  let currentMiles = 0
  let lastStats: ReturnType<typeof statsFor> | null = null
  let lunarOn = false, revealRaf = 0
  // Rebuild the lunar line + readout from the current miles & Moon position (called on toggle and on every timeline change).
  const refreshLunar = (animate: boolean) => {
    // Orient the swing to face the lunar-return vantage (camera sits at lat 0, lng moonLng+90).
    // Use that deterministic direction rather than the live camera, which is still mid-fly-in.
    const camDir = geoToCartesian(0, moon.datum.lng + 90, 0, 100)
    lunar.setPath(buildTrajectoryPoints(moon.datum.lat, moon.datum.lng, moon.datum.alt, { cam: camDir }))
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
      setArcs(scene.globe, solid, ghost, activeLegId, { spotIds: spotIds ?? undefined, fleetRank: fleetOn ? fleetRank : undefined })
      const stats = statsFor(solid, meta); hud.setStats(stats); currentMiles = stats.flewMiles; lastStats = stats
      hud.setConversions(allTime ? `${(currentMiles / EARTH_LAP_NM).toFixed(1)}× EARTH · ${lunarReturns(currentMiles).toFixed(2)} MOON` : '')
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

  // Wrapped career layer: records, milestone crossings, fleet breakdown (operated legs only).
  const career = { records: recordsFor(legs), milestones: milestonesFor(legs), fleet: fleetStats(legs) }
  const fleetRank = new Map(career.fleet.map((f, i) => [f.type, i]))

  const dock = createTimelineDock({ legs, trips, windowStart: win.start, windowEnd: win.end, playhead, now, milestones: career.milestones })

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
    onPlayhead: (ms) => { checkMilestones(playhead, ms); playhead = ms; dock.setPlayhead(ms); draw(false); checkGoldenHour(ms) },
    onDone: () => { activeLegId = null; dock.setPlaying(false); draw() },
    onPlayingChange: (p) => { dock.setPlaying(p); if (p) scene.globe.controls().autoRotate = false; else { activeLegId = null; dart.stop(); beacon.halt() } draw() },
  })

  // Golden-hour callouts: fire when the replayed flight crosses the terminator. Thanks to
  // actual OOOI times the crossing lands where (and when) it really happened. Sign flips are
  // tracked per active leg so leg-boundary position jumps never fire a phantom sunrise.
  let elevLegId: string | null = null
  let prevElev = 0
  let lastEventAt = 0
  const hemi = (v: number, pos: string, neg: string) => `${Math.abs(Math.round(v))}°${v >= 0 ? pos : neg}`
  const checkGoldenHour = (ms: number) => {
    if (!activeLegId) { elevLegId = null; return }
    const loc = positionAt(ms).latlng
    const elev = sunElevationDeg(loc[0], loc[1], ms)
    if (elevLegId !== activeLegId) { elevLegId = activeLegId; prevElev = elev; return }
    const now = performance.now()
    if (prevElev < 0 !== elev < 0 && now - lastEventAt > 1500) {
      lastEventAt = now
      hud.setEvent(`${elev >= 0 ? 'SUNRISE' : 'SUNSET'} · ${hemi(loc[0], 'N', 'S')} ${hemi(loc[1], 'E', 'W')}`)
    }
    prevElev = elev
  }

  // ---- Share: interactive trip video (falls back to a still image) ----
  const shareTrips = resolveShareTrips(trips, now)
  hud.onShareOpen(() => hud.setShareTrips(
    shareTrips.last ? tripLabel(shareTrips.last) : null,
    shareTrips.next ? tripLabel(shareTrips.next) : null,
  ))

  const glCanvas = () => host.querySelector('canvas') as HTMLCanvasElement

  const shareOrDownload = async (blob: Blob, filename: string, title: string) => {
    const file = new File([blob], filename, { type: blob.type })
    const nav: any = navigator
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title }) } catch { /* dismissed */ }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    }
  }

  const lunarLineFor = (miles: number) =>
    `${Math.round(miles).toLocaleString()} NM FLOWN · ${lunarReturns(miles).toFixed(2)} LUNAR RETURNS`

  // Present the finished clip inline (preview + explicit Save/Share). We do NOT auto-fire the
  // save: navigator.share and programmatic downloads need a live user activation, which the
  // long (~10-20s) render has already consumed — so the user taps Save/Share within a fresh
  // gesture. Showing the <video> also lets us SEE whether capture worked (empty => diagnostics).
  let lastVideoUrl: string | null = null
  const presentTripVideo = (blob: Blob, filename: string, route: string) => {
    console.log('[share] recorded', blob.type, blob.size, 'bytes')
    if (lastVideoUrl) { URL.revokeObjectURL(lastVideoUrl); lastVideoUrl = null }
    const box = document.createElement('div')
    if (!blob.size) {
      const e = document.createElement('div')
      e.style.cssText = 'font:600 10px ui-monospace,Menlo,monospace;letter-spacing:1px;color:#ff9f6f'
      e.textContent = "Recording came out empty on this browser — tell me and I'll switch capture modes."
      box.appendChild(e); hud.setShareResult(box); return
    }
    const url = URL.createObjectURL(blob); lastVideoUrl = url
    const kb = blob.size / 1024
    const sizeLabel = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`

    const vid = document.createElement('video')
    vid.src = url; vid.controls = true; vid.autoplay = true; vid.muted = true; vid.loop = true
    ;(vid as any).playsInline = true
    vid.style.cssText = 'width:100%;border-radius:8px;display:block;background:#04111f'
    box.appendChild(vid)

    const meta = document.createElement('div')
    meta.style.cssText = 'margin-top:6px;font:600 10px ui-monospace,Menlo,monospace;letter-spacing:1px;color:#7fb8d4'
    meta.textContent = `${route} · ${sizeLabel}`
    box.appendChild(meta)

    const btn = 'display:block;width:100%;text-align:center;margin-top:8px;padding:9px 12px;border-radius:9px;font:700 12px ui-monospace,Menlo,monospace;letter-spacing:1px;cursor:pointer;text-decoration:none'
    const dl = document.createElement('a')
    dl.href = url; dl.download = filename; dl.textContent = '⤓ SAVE VIDEO'
    dl.style.cssText = `${btn};background:#103a2a;border:1px solid #2f7d55;color:#7dffb0`
    box.appendChild(dl)

    const file = new File([blob], filename, { type: blob.type })
    const nav: any = navigator
    if (nav.canShare?.({ files: [file] })) {
      const sh = document.createElement('button')
      sh.textContent = '⇪ SHARE'
      sh.style.cssText = `${btn};margin-top:6px;background:#0d2a3d;border:1px solid #2fd6ff;color:#7fdcff`
      sh.addEventListener('click', async () => { try { await nav.share({ files: [file], title: `My ${route} trip` }) } catch { /* dismissed */ } })
      box.appendChild(sh)
    }
    hud.setShareResult(box)
  }

  // The "just the image" secondary link keeps the original career-card behaviour.
  hud.onShareImage(() => {
    if (!lastStats) return
    const card = composeShareCard(glCanvas(), lastStats, lunarLineFor(currentMiles))
    card.toBlob((b) => { if (b) shareOrDownload(b, 'crewlu-globe.jpg', 'My CrewLu Flight Globe') }, 'image/jpeg', 0.9)
    hud.closeSharePanel()
  })

  let recording = false
  hud.onShareTrip(async (which) => {
    if (recording) return
    const trip = which === 'last' ? shareTrips.last : shareTrips.next
    if (!trip) return
    recording = true
    hud.setShareResult(null)

    const cardStats = tripCardStats(trip)
    const legCount = cardStats.legs || trip.legs.length
    // Cinematic pacing: take the auto-picked speed and slow it ~80% for the video.
    const VIDEO_SLOWDOWN = 5
    const speed = SPEEDS[pickTripSpeedIndex(legCount, SPEEDS, 1200)] / VIDEO_SLOWDOWN
    const flightMs = legCount * (1200 / speed)
    // Camera follows via the dock speed index; pick the nearest real SPEEDS entry to `speed`
    // so the per-leg camera move roughly tracks the (now slower) flight time.
    let camIdx = 0
    for (let i = 1; i < SPEEDS.length; i++) if (Math.abs(SPEEDS[i] - speed) < Math.abs(SPEEDS[camIdx] - speed)) camIdx = i
    const card = composeTripCard(glCanvas(), cardStats, lunarLineFor(cardStats.nm))

    if (!canRecordVideo()) {
      card.toBlob((b) => { if (b) shareOrDownload(b, 'crewlu-trip.jpg', `My ${cardStats.route} trip`) }, 'image/jpeg', 0.9)
      hud.closeSharePanel(); recording = false; return
    }

    const savedStart = win.start, savedEnd = win.end, savedPlayhead = playhead
    const savedSpeedIdx = dock.state.speedIndex
    const hostW = host.clientWidth, hostH = host.clientHeight
    win.start = trip.legs[0].t; win.end = trip.legs[trip.legs.length - 1].t
    // Start the playhead a hair before the first departure so the FIRST leg animates too.
    // splitAtPlayhead is inclusive (l.t <= playhead), so playhead == firstLeg.t would count
    // leg 0 as already-flown and playback would begin at leg 1, skipping its flight.
    playhead = win.start - 1; dock.state.speedIndex = camIdx
    playback.setSpeed(speed)
    draw(true)

    scene.globe.renderer().setSize(1920, 1080, false)
    scene.globe.postProcessingComposer().setSize(1920, 1080)
    scene.globe.camera().aspect = 16 / 9; scene.globe.camera().updateProjectionMatrix()

    try {
      const blob = await recordTripVideo({
        gl: glCanvas(), width: 1920, height: 1080, fps: 30, flightMs, outroMs: 2000,
        play: () => playback.play(), stop: () => playback.pause(),
        drawOutro: (ctx, w, h) => ctx.drawImage(card, 0, 0, w, h),
        onProgress: (p) => hud.setShareProgress(p),
      })
      hud.setShareProgress(0)
      presentTripVideo(blob, `crewlu-trip.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, cardStats.route)
    } catch (err) {
      console.error('[share] recording failed', err)
      hud.setShareProgress(0)
      const e = document.createElement('div')
      e.style.cssText = 'font:600 10px ui-monospace,Menlo,monospace;letter-spacing:1px;color:#ff9f6f'
      e.textContent = 'Recording failed on this browser (see console).'
      hud.setShareResult(e)
    } finally {
      scene.globe.width(hostW).height(hostH)
      scene.globe.postProcessingComposer().setSize(hostW, hostH)
      scene.globe.camera().aspect = hostW / hostH; scene.globe.camera().updateProjectionMatrix()
      win.start = savedStart; win.end = savedEnd; playhead = savedPlayhead
      dock.state.speedIndex = savedSpeedIdx; playback.setSpeed(SPEEDS[savedSpeedIdx])
      playback.pause(); draw(true)
      recording = false
    }
  })

  // Milestone toasts: playhead sweeping past a career crossing fires the golden event chip.
  const checkMilestones = (fromMs: number, toMs: number) => {
    if (toMs <= fromMs) return
    for (const m of career.milestones) {
      if (m.t > fromMs && m.t <= toMs) { hud.setEvent(m.label); break }
    }
  }

  // ALL TIME: whole-career view with an odometer roll-up and conversion lines.
  let allTime = false
  let savedView: { start: number; end: number; playhead: number; pov: any } | null = null
  const runOdometer = (from: { miles: number; hours: number; airports: number; countries: number }) => {
    const to = lastStats
    if (!to) return
    const t0 = performance.now()
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1600)
      const e = 1 - Math.pow(1 - k, 3)
      const mix = (a: number, b: number) => a + (b - a) * e
      hud.setStats({
        ...to,
        miles: Math.round(mix(from.miles, to.miles)),
        hours: Math.round(mix(from.hours, to.hours)),
        airports: Math.round(mix(from.airports, to.airports)),
        countries: Math.round(mix(from.countries, to.countries)),
      })
      if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  hud.onAllTime(() => {
    allTime = !allTime
    hud.setAllTimeActive(allTime)
    if (allTime) {
      playback.pause()
      savedView = { start: win.start, end: win.end, playhead, pov: scene.globe.pointOfView() }
      const before = lastStats ?? { miles: 0, hours: 0, airports: 0, countries: 0 }
      win.start = legs[0].t - 12 * 3600 * 1000
      win.end = legs[legs.length - 1].landing + 12 * 3600 * 1000
      playhead = win.end
      dock.setWindow(win.start, win.end)
      dock.setPlayhead(playhead)
      scene.globe.controls().autoRotate = true
      scene.globe.pointOfView({ lat: 25, lng: scene.globe.pointOfView().lng, altitude: 2.8 }, 1400)
      draw()
      runOdometer(before)
    } else {
      if (savedView) {
        win.start = savedView.start; win.end = savedView.end; playhead = savedView.playhead
        dock.setWindow(win.start, win.end)
        dock.setPlayhead(playhead)
        scene.globe.pointOfView(savedView.pov, 1200)
      }
      draw()
    }
  })

  // RECORDS: superlatives panel; tapping a row spotlights the arc(s) in gold.
  let recordsOn = false
  const midOf = (l: (typeof legs)[number]) => slerp(l.s, l.e, 0.5)
  const recRow = (label: string, value: string, ids: string[], mid: [number, number], miles: number) =>
    `<div class="wrow" data-spot="${ids.join(',')}" data-lat="${mid[0].toFixed(2)}" data-lng="${mid[1].toFixed(2)}" data-alt="${altForLeg(miles).toFixed(2)}">${label}<br><b>${value}</b></div>`
  const buildRecordsPanel = () => {
    const r = career.records
    const rows: string[] = []
    if (r.longest) rows.push(recRow('LONGEST LEG', `${r.longest.from} → ${r.longest.to} · ${Math.round(r.longest.miles).toLocaleString()} NM`, [r.longest.id], midOf(r.longest), r.longest.miles))
    if (r.shortest) rows.push(recRow('SHORTEST LEG', `${r.shortest.from} → ${r.shortest.to} · ${Math.round(r.shortest.miles).toLocaleString()} NM`, [r.shortest.id], midOf(r.shortest), r.shortest.miles))
    if (r.topPair) {
      const sample = legs.find((l) => l.id === r.topPair!.legIds[0])!
      rows.push(recRow('TOP CITY PAIR', `${r.topPair.a} ⇄ ${r.topPair.b} · ${r.topPair.count}×`, r.topPair.legIds, midOf(sample), sample.miles))
    }
    if (r.topAirport) rows.push(`<div class="wrow">MOST LANDINGS<br><b>${r.topAirport.iata} · ${r.topAirport.landings}</b></div>`)
    rows.push(`<div class="wrow">TAILS FLOWN<br><b>${r.distinctTails}</b></div>`)
    return rows.join('')
  }
  hud.onRecords(() => {
    recordsOn = !recordsOn
    hud.setRecordsActive(recordsOn)
    if (recordsOn) {
      fleetOn = false; hud.setFleetActive(false)
      hud.setPanel(buildRecordsPanel())
    } else {
      spotIds = null
      hud.setPanel(null)
    }
    draw()
  })
  let lastSpotKey = ''
  hud.onPanelSpot((el) => {
    const ids = (el.dataset.spot ?? '').split(',').filter(Boolean)
    if (!ids.length) return
    const key = ids.join(',')
    if (spotIds && key === lastSpotKey) { spotIds = null; lastSpotKey = ''; el.classList.remove('spotted') }
    else {
      spotIds = new Set(ids)
      lastSpotKey = key
      el.parentElement?.querySelectorAll('.wrow').forEach((n) => n.classList.remove('spotted'))
      el.classList.add('spotted')
      scene.globe.controls().autoRotate = false
      scene.globe.pointOfView({ lat: +el.dataset.lat!, lng: +el.dataset.lng!, altitude: +el.dataset.alt! }, 1100)
    }
    draw()
  })

  // FLEET: recolor the map by aircraft type, with a ranked legend.
  const FLEET_HUES = ['#5fe0ff', '#ffd778', '#c792ea', '#7ddc8f', '#ff9e9e']
  hud.onFleet(() => {
    fleetOn = !fleetOn
    hud.setFleetActive(fleetOn)
    if (fleetOn) {
      recordsOn = false; spotIds = null
      hud.setRecordsActive(false)
      const legend = career.fleet.slice(0, 5).map((f, i) =>
        `<div class="wrow"><span style="color:${FLEET_HUES[i]}">■</span> ${f.type}<br><b>${f.legs} LEGS · ${Math.round(f.blockMs / 3600000).toLocaleString()} HRS</b></div>`).join('')
      hud.setPanel(legend)
    } else {
      hud.setPanel(null)
    }
    draw()
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

  // Cold-open: the career draws itself on — arcs dash in chronologically while the camera
  // dives from high orbit to the beacon. Reduced-motion (or a trivial history) skips straight
  // to the normal first paint.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const introSolid = splitAtPlayhead(legsInWindow(legs, { start: win.start, end: win.end }), playhead).solid
  if (linkedTrip && link.play) {
    // Deep-linked auto-play: skip the cold-open, fly the trip.
    draw()
    playback.play()
  } else if (reduceMotion || introSolid.length < 2) {
    draw() // initial paint, paused
  } else {
    scene.globe.controls().autoRotate = false
    scene.globe.pointOfView({ lat: beacon.pos.lat, lng: beacon.pos.lng, altitude: 4.5 }, 0)
    scene.globe
      .arcDashLength(1).arcDashGap(2)
      .arcDashInitialGap((d: any) => 1 + (d.__order ?? 0) * 0.12)
      .arcDashAnimateTime(2200)
      .arcsData(introSolid.map((l, i) => ({ ...l, __order: i })))
    scene.setSun(new Date(playhead))
    scene.globe.pointOfView({ lat: beacon.pos.lat, lng: beacon.pos.lng, altitude: 1.7 }, 2600)
    setTimeout(() => {
      configureArcs(scene.globe) // restore the normal arc recipe
      scene.globe.controls().autoRotate = true
      draw()
    }, 2800)
  }
}

run().catch((e) => {
  const msg = e && e.message ? e.message : typeof e === 'string' ? e : JSON.stringify(e)
  app.innerHTML = `<div class="auth"><div class="auth-card">Something went wrong loading your globe.<br><small>${msg}</small></div></div>`
})
