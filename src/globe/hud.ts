import type { Stats } from '../model'

function fmtLayover(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rm = m % 60
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`
  const d = Math.floor(h / 24), rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

export interface CityStatsData { iata: string; city: string; country: string; landings: number; layoverMs: number }

export interface Hud {
  root: HTMLElement
  setStats(s: Stats): void
  setMoment(location: string, dateTime: string): void
  setCityStats(data: CityStatsData | null): void
  onCenterTap(cb: () => void): void
  onLunarToggle(cb: () => void): void
  setLunarActive(active: boolean): void
  setLunarReadout(text: string): void
  starfield: HTMLElement
}

export function createHud(host: HTMLElement, opts?: { account?: string; onSignOut?: () => void }): Hud {
  host.insertAdjacentHTML('beforeend', HUD_HTML)
  const q = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!
  const moment = q<HTMLDivElement>('#momentChip')
  moment.style.pointerEvents = 'auto'  // critical: parent panel is pointer-events:none

  const accountEl = q<HTMLElement>('#account')
  accountEl.textContent = opts?.account ?? 'Signed in'
  if (opts?.onSignOut) {
    accountEl.style.pointerEvents = 'auto'
    accountEl.style.cursor = 'pointer'
    accountEl.title = 'Sign out'
    accountEl.addEventListener('click', opts.onSignOut)
  }

  const cityChip = q<HTMLDivElement>('#cityChip')
  q('#cClose').addEventListener('click', () => { cityChip.style.display = 'none' })

  return {
    root: host,
    starfield: q('#stars'),
    setStats(s) {
      q('#sMiles').textContent = s.miles.toLocaleString()
      q('#sApts').textContent = String(s.airports)
      q('#sCountries').textContent = String(s.countries)
      q('#sHours').textContent = s.hours.toLocaleString()
      q('#sMilesSub').textContent = `FLEW ${Math.round(s.flewMiles).toLocaleString()} · RODE ${Math.round(s.rodeMiles).toLocaleString()}`
      q('#sOnTime').textContent = s.onTimePct != null ? `ON-TIME ARR ${s.onTimePct}%` : ''
    },
    setMoment(location, dateTime) {
      q('#mDate').textContent = location
      q('#mSub').textContent = dateTime
    },
    setCityStats(data) {
      if (!data) { cityChip.style.display = 'none'; return }
      q('#cIata').textContent = data.iata
      q('#cCity').textContent = data.city + (data.country ? ' · ' + data.country : '')
      q('#cLandings').textContent = String(data.landings)
      q('#cLayover').textContent = fmtLayover(data.layoverMs)
      cityChip.style.display = 'block'
    },
    onCenterTap(cb) { moment.addEventListener('click', cb) },
    onLunarToggle(cb) { q('#lunarBtn').addEventListener('click', cb) },
    setLunarActive(active) { q('#lunarBtn').classList.toggle('on', active); q<HTMLElement>('#lunarReadout').style.display = active ? 'block' : 'none' },
    setLunarReadout(text) { q('#lunarReadout').textContent = text },
  }
}

const HUD_HTML = `
<div id="stars"></div>

<div class="tick" style="top:16px;left:16px;border-top:1.6px solid;border-left:1.6px solid"></div>
<div class="tick" style="top:16px;right:16px;border-top:1.6px solid;border-right:1.6px solid"></div>
<div class="tick tick-b" style="left:16px;border-bottom:1.6px solid;border-left:1.6px solid"></div>
<div class="tick tick-b" style="right:16px;border-bottom:1.6px solid;border-right:1.6px solid"></div>

<div class="hud" style="top:24px;left:52px;font-size:14px;font-weight:700;color:#eaf7ff">CREWLU<span style="color:#2fd6ff"> ·</span> FLIGHT&nbsp;GLOBE</div>
<div id="account" class="hud" style="top:25px;right:50px">Signed in</div>
<div class="hud" style="top:50px;left:52px;display:flex;gap:18px;font-size:9px;letter-spacing:1px">
  <span><span style="display:inline-block;width:18px;height:2px;background:#5fe0ff;vertical-align:middle;margin-right:6px;box-shadow:0 0 6px #5fe0ff"></span>FLEW</span>
  <span><span style="display:inline-block;width:18px;height:2px;background:#ffb15f;vertical-align:middle;margin-right:6px;box-shadow:0 0 6px #ffb15f"></span>DEADHEAD</span>
</div>

<div id="lunar" class="hud" style="top:74px;left:52px;pointer-events:auto">
  <button id="lunarBtn" class="navbtn">◓ LUNAR RETURN</button>
  <div id="lunarReadout" class="lunartel" style="display:none"></div>
</div>

<div id="rail">
  <div class="chip" style="text-align:right"><div class="sv" id="sMiles">—</div><div class="sl">NAUTICAL MILES</div><div class="sl" id="sMilesSub" style="margin-top:3px"></div></div>
  <div class="chip" style="text-align:right"><div class="sv" id="sApts">—</div><div class="sl">AIRPORTS</div></div>
  <div class="chip" style="text-align:right"><div class="sv" id="sCountries">—</div><div class="sl">COUNTRIES</div></div>
  <div class="chip" style="text-align:right"><div class="sv" id="sHours">—</div><div class="sl">BLOCK HOURS</div><div class="sl" id="sOnTime" style="margin-top:3px"></div></div>
</div>

<div id="moment">
  <div class="chip" id="momentChip" style="cursor:pointer"><div class="sv" id="mDate" style="font-size:16px">—</div><div class="sl" id="mSub">—</div>
    <div class="sl" style="margin-top:7px;color:#5cff9e;opacity:.9">⌖ TAP TO CENTER ON ME</div></div>
  <div class="chip" id="cityChip" style="display:none;pointer-events:auto">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div class="sv" id="cIata" style="font-size:22px;letter-spacing:2px">—</div>
      <div id="cClose" style="font-size:10px;color:#5fb8e0;letter-spacing:1px;cursor:pointer;padding:2px 4px">✕</div>
    </div>
    <div class="sl" id="cCity" style="margin-top:3px">—</div>
    <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">
      <div><div class="sv" id="cLandings" style="font-size:17px">—</div><div class="sl">LANDINGS</div></div>
      <div><div class="sv" id="cLayover" style="font-size:17px">—</div><div class="sl">LAYOVER</div></div>
    </div>
  </div>
</div>

<div id="tip">DRAG TO SPIN · SCROLL TO ZOOM · MOVE MOUSE FOR PARALLAX</div>
`
