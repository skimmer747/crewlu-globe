import type { Stats } from '../model'

// 1200x630 share card: the live WebGL frame, cover-cropped, with a Night-Ops footer band
// carrying the wordmark, career stats, and the lunar line. Needs the globe constructed
// with rendererConfig { preserveDrawingBuffer: true } or drawImage reads black.

const W = 1200, H = 630

export function composeShareCard(gl: HTMLCanvasElement, stats: Stats, lunarLine: string): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = W; out.height = H
  const ctx = out.getContext('2d')!

  ctx.fillStyle = '#04111f'
  ctx.fillRect(0, 0, W, H)

  // Cover-crop the globe frame into the card.
  const scale = Math.max(W / gl.width, H / gl.height)
  const dw = gl.width * scale, dh = gl.height * scale
  ctx.drawImage(gl, (W - dw) / 2, (H - dh) / 2, dw, dh)

  // Footer band.
  const grad = ctx.createLinearGradient(0, H - 190, 0, H)
  grad.addColorStop(0, 'rgba(4,17,31,0)')
  grad.addColorStop(0.45, 'rgba(4,17,31,0.82)')
  grad.addColorStop(1, 'rgba(4,17,31,0.96)')
  ctx.fillStyle = grad
  ctx.fillRect(0, H - 190, W, 190)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#eaf7ff'
  ctx.font = '700 30px ui-monospace, Menlo, monospace'
  ctx.fillText('CREWLU', 48, H - 116)
  const w1 = ctx.measureText('CREWLU').width
  ctx.fillStyle = '#2fd6ff'
  ctx.fillText(' · FLIGHT GLOBE', 48 + w1, H - 116)

  const stat = (label: string, value: string, x: number) => {
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 34px ui-monospace, Menlo, monospace'
    ctx.fillText(value, x, H - 56)
    ctx.fillStyle = '#8fb8cf'
    ctx.font = '600 13px ui-monospace, Menlo, monospace'
    ctx.fillText(label, x, H - 30)
  }
  stat('NAUTICAL MILES', Math.round(stats.miles).toLocaleString(), 48)
  stat('AIRPORTS', String(stats.airports), 420)
  stat('COUNTRIES', String(stats.countries), 640)
  stat('BLOCK HOURS', stats.hours.toLocaleString(), 860)

  ctx.fillStyle = '#5cff9e'
  ctx.font = '600 15px ui-monospace, Menlo, monospace'
  ctx.fillText(lunarLine, 48, H - 152)

  ctx.fillStyle = '#5fb8e0'
  ctx.font = '600 14px ui-monospace, Menlo, monospace'
  const url = 'globe.crewlu.net'
  ctx.fillText(url, W - 48 - ctx.measureText(url).width, H - 30)

  return out
}
