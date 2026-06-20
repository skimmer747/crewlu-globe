import type { Stats } from '../model'

export interface Hud {
  root: HTMLElement
  setStats(s: Stats): void
  setMoment(location: string, dateTime: string): void
  onCenterTap(cb: () => void): void
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

  return {
    root: host,
    starfield: q('#stars'),
    setStats(s) {
      q('#sMiles').textContent = s.miles.toLocaleString()
      q('#sApts').textContent = String(s.airports)
      q('#sCountries').textContent = String(s.countries)
      q('#sHours').textContent = s.hours.toLocaleString()
    },
    setMoment(location, dateTime) {
      q('#mDate').textContent = location
      q('#mSub').textContent = dateTime
    },
    onCenterTap(cb) { moment.addEventListener('click', cb) },
  }
}

const HUD_HTML = `
<div id="stars"></div>

<div class="tick" style="top:16px;left:16px;border-top:1.6px solid;border-left:1.6px solid"></div>
<div class="tick" style="top:16px;right:16px;border-top:1.6px solid;border-right:1.6px solid"></div>
<div class="tick" style="bottom:104px;left:16px;border-bottom:1.6px solid;border-left:1.6px solid"></div>
<div class="tick" style="bottom:104px;right:16px;border-bottom:1.6px solid;border-right:1.6px solid"></div>

<div class="hud" style="top:24px;left:52px;font-size:14px;font-weight:700;color:#eaf7ff">CREWLU<span style="color:#2fd6ff"> ·</span> FLIGHT&nbsp;GLOBE</div>
<div id="account" class="hud" style="top:25px;right:50px">Signed in</div>
<div class="hud" style="top:50px;left:52px;display:flex;gap:18px;font-size:9px;letter-spacing:1px">
  <span><span style="display:inline-block;width:18px;height:2px;background:#5fe0ff;vertical-align:middle;margin-right:6px;box-shadow:0 0 6px #5fe0ff"></span>FLEW</span>
  <span><span style="display:inline-block;width:18px;height:2px;background:#ffb15f;vertical-align:middle;margin-right:6px;box-shadow:0 0 6px #ffb15f"></span>DEADHEAD</span>
</div>

<div id="rail">
  <div class="chip" style="text-align:right"><div class="sv" id="sMiles">—</div><div class="sl">NAUTICAL MILES</div></div>
  <div class="chip" style="text-align:right"><div class="sv" id="sApts">—</div><div class="sl">AIRPORTS</div></div>
  <div class="chip" style="text-align:right"><div class="sv" id="sCountries">—</div><div class="sl">COUNTRIES</div></div>
  <div class="chip" style="text-align:right"><div class="sv" id="sHours">—</div><div class="sl">BLOCK HOURS</div></div>
</div>

<div id="moment">
  <div class="chip" id="momentChip" style="cursor:pointer"><div class="sv" id="mDate" style="font-size:16px">—</div><div class="sl" id="mSub">—</div>
    <div class="sl" style="margin-top:7px;color:#5cff9e;opacity:.9">⌖ TAP TO CENTER ON ME</div></div>
</div>

<div id="tip">DRAG TO SPIN · SCROLL TO ZOOM · MOVE MOUSE FOR PARALLAX</div>
`
