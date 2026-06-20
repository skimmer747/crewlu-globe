import type { Leg } from '../model'

export interface Scrubber { mount(host: HTMLElement): void; onScrub(cb: (cutoffMs: number, pct: number, playing: boolean) => void): void; start(): void }

export function createScrubber(legs: Leg[]): Scrubber {
  const t0 = legs.length ? legs[0].t : Date.UTC(2019, 0, 1)
  const t1 = legs.length ? legs[legs.length - 1].t + 86400000 : Date.UTC(2025, 6, 1)
  let cb: (c: number, p: number, playing: boolean) => void = () => {}
  let host!: HTMLElement
  let scrub!: HTMLInputElement
  let barEls: HTMLElement[] = []
  let playing = false, raf = 0

  const valToCutoff = (v: number) => t0 + (v / 1000) * (t1 - t0)

  const lightBars = (cutoff: number) => {
    const span = t1 - t0, NB = barEls.length
    barEls.forEach((b, i) => {
      const bt = t0 + ((i + 0.5) / NB) * span
      b.classList.toggle('on', bt <= cutoff)
      b.classList.toggle('hot', bt <= cutoff && bt > cutoff - (span / NB) * 1.6)
    })
  }

  const emit = (v: number, pl: boolean) => {
    const cutoff = valToCutoff(v)
    scrub.style.setProperty('--p', (v / 10) + '%')
    lightBars(cutoff)
    cb(cutoff, v / 10, pl)
  }

  const stop = () => { playing = false; cancelAnimationFrame(raf); host.querySelector('#play')!.textContent = '▶' }
  const play = () => {
    playing = true; host.querySelector('#play')!.textContent = '❚❚'; let last = 0
    const step = (ts: number) => {
      if (!playing) return; if (!last) last = ts; const dt = ts - last; last = ts
      let v = +scrub.value + dt * 0.07
      if (v >= 1000) { v = 1000; scrub.value = String(v); emit(v, true); stop(); return }
      scrub.value = String(v); emit(v, true); raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }

  return {
    mount(h) {
      host = h
      h.insertAdjacentHTML('beforeend', DOCK_HTML)
      scrub = h.querySelector<HTMLInputElement>('#scrub')!
      barEls = buildHistogram(h.querySelector('#bars')!, legs, t0, t1)
      scrub.addEventListener('input', () => { stop(); emit(+scrub.value, false) })
      h.querySelector('#play')!.addEventListener('click', () => (playing ? stop() : play()))
    },
    onScrub(fn) { cb = fn },
    start() { emit(+scrub.value, false); setTimeout(play, 1000) },
  }
}

function buildHistogram(bars: Element, legs: Leg[], t0: number, t1: number): HTMLElement[] {
  const NB = 46, counts = new Array(NB).fill(0)
  for (const l of legs) counts[Math.min(NB - 1, Math.floor(((l.t - t0) / (t1 - t0)) * NB))]++
  const mx = Math.max(1, ...counts)
  bars.innerHTML = counts.map((c) => `<div class="bar" style="height:${18 + (c / mx) * 82}%"></div>`).join('')
  return Array.from(bars.querySelectorAll<HTMLElement>('.bar'))
}

const DOCK_HTML = `
<div id="dock">
  <div id="dockInner">
    <div id="bars"></div>
    <input id="scrub" type="range" min="0" max="1000" value="300">
    <div id="yrs"><span>2019</span><span>2021</span><span>2023</span><span>2025</span></div>
  </div>
</div>
<button class="btn" id="play">❚❚</button>
`
