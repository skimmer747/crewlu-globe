// Records the live globe (already rendering at high-res backing store) into a 16:9 stage
// canvas via MediaRecorder. Real-time capture: a 2D stage canvas is fed each animation frame
// (blit the GL canvas, cover-cropped), then the trip-stats card for the outro. The animation
// is wall-clock-driven, so we record rather than frame-step.

const MIMES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']

export function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

/** True when this browser can produce a video (both the recorder and canvas capture exist). */
export function canRecordVideo(): boolean {
  return pickMime() != null && typeof (HTMLCanvasElement.prototype as any).captureStream === 'function'
}

export interface TripVideoOpts {
  gl: HTMLCanvasElement
  width: number
  height: number
  fps: number
  flightMs: number
  outroMs: number
  play: () => void
  stop: () => void
  drawOutro: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  drawOverlay?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void // drawn over each flight frame (From→To etc.)
  onProgress?: (pct: number) => void
}

export interface CanvasRecOpts {
  gl: HTMLCanvasElement
  width: number
  height: number
  fps: number
  totalMs: number
  onStart?: () => void
  // blit() cover-crops the live GL canvas onto the stage; call it (or not) per frame.
  drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, elapsedMs: number, blit: () => void): void
  onProgress?: (pct: number) => void
}

/** Real-time canvas capture: stage canvas + MediaRecorder, one drawFrame per rAF. */
export async function recordCanvas(o: CanvasRecOpts): Promise<Blob> {
  const mime = pickMime()
  if (!mime) throw new Error('MediaRecorder unsupported')

  const stage = document.createElement('canvas'); stage.width = o.width; stage.height = o.height
  const ctx = stage.getContext('2d')!
  const stream = (stage as any).captureStream(o.fps) as MediaStream
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>((res) => { rec.onstop = () => res() })

  const blit = () => {
    const s = Math.max(o.width / o.gl.width, o.height / o.gl.height)
    const dw = o.gl.width * s, dh = o.gl.height * s
    ctx.drawImage(o.gl, (o.width - dw) / 2, (o.height - dh) / 2, dw, dh)
  }

  rec.start()
  o.onStart?.()
  const t0 = performance.now()

  await new Promise<void>((resolve) => {
    const frame = () => {
      const elapsed = performance.now() - t0
      o.drawFrame(ctx, o.width, o.height, elapsed, blit)
      o.onProgress?.(Math.min(0.99, elapsed / o.totalMs))
      if (elapsed >= o.totalMs) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  rec.stop()
  await stopped
  o.onProgress?.(1)
  return new Blob(chunks, { type: mime })
}

export async function recordTripVideo(o: TripVideoOpts): Promise<Blob> {
  const blob = await recordCanvas({
    gl: o.gl, width: o.width, height: o.height, fps: o.fps,
    totalMs: o.flightMs + o.outroMs,
    onStart: o.play,
    drawFrame: (ctx, w, h, elapsed, blit) => {
      if (elapsed < o.flightMs) { blit(); o.drawOverlay?.(ctx, w, h) }
      else o.drawOutro(ctx, w, h)
    },
    onProgress: o.onProgress,
  })
  o.stop()
  return blob
}
