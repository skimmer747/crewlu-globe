import { geoToCartesian, type Vec3 } from './occlusion'

/**
 * Clip a DOM sky body (Moon, Sun) by the Earth's on-screen silhouette so the limb
 * sweeps across it as it passes behind. `halfSize` is half the element's square box
 * (the body's center in its own local px). Generalized from the Moon's occlusion.
 */
export function clipBehindEarth(opts: {
  el: HTMLElement
  halfSize: number
  lat: number; lng: number; alt: number
  cam: Vec3
  globe: any
  viewport: HTMLElement
  R?: number
}): void {
  const { el, halfSize, lat, lng, alt, cam, globe, viewport } = opts
  const R = opts.R ?? 100
  const camDist = Math.hypot(cam.x, cam.y, cam.z)
  const m = geoToCartesian(lat, lng, alt, R)
  const dx = m.x - cam.x, dy = m.y - cam.y, dz = m.z - cam.z
  const len = Math.hypot(dx, dy, dz) || 1
  const ux = dx / len, uy = dy / len, uz = dz / len
  const tStar = -(cam.x * ux + cam.y * uy + cam.z * uz)
  if (!(tStar > 0 && tStar < len) || camDist <= R) { el.style.clipPath = 'none'; return } // in front -> no clip
  const W = viewport.clientWidth, H = viewport.clientHeight
  const alpha = Math.asin(Math.min(1, R / camDist))
  const fov = ((globe.camera?.()?.fov) ?? 50) * Math.PI / 180
  const Rs = (H / 2) * Math.tan(alpha) / Math.tan(fov / 2) // Earth's silhouette radius on screen (px)
  const ms = globe.getScreenCoords(lat, lng, alt)
  let rx = ms.x - W / 2, ry = ms.y - H / 2
  const dm = Math.hypot(rx, ry) || 1
  rx /= dm; ry /= dm // unit radial: Earth center -> body, screen space
  const Lx = halfSize + rx * (Rs - dm), Ly = halfSize + ry * (Rs - dm)
  const px = -ry, py = rx, S = 800 // keep the half-plane outside the Earth disk
  const pts = [
    [Lx + px * S, Ly + py * S], [Lx - px * S, Ly - py * S],
    [Lx - px * S + rx * S * 2, Ly - py * S + ry * S * 2], [Lx + px * S + rx * S * 2, Ly + py * S + ry * S * 2],
  ].map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')
  el.style.clipPath = `polygon(${pts})`
}

/**
 * Soft-edged version of {@link clipBehindEarth}: instead of a hard polygon clip at the solid
 * limb, fade the body out with a gradient mask across the atmosphere band, so it recedes behind
 * Earth's blue glow rather than looking cut out. The mask lives on `maskEl` in its OWN local px,
 * so for a CSS-scaled body (the Moon) pass the scaled inner element and its `scale`; screen
 * offsets are divided by it. Earth occludes radii < Rs; the body fades in across Rs → Rs+band.
 */
export function featherBehindEarth(opts: {
  maskEl: HTMLElement
  boxHalf: number   // half the maskEl's unscaled local box (px)
  scale: number     // current CSS scale on maskEl
  lat: number; lng: number; alt: number
  cam: Vec3
  globe: any
  viewport: HTMLElement
  R?: number
}): void {
  const { maskEl, boxHalf, scale, lat, lng, alt, cam, globe, viewport } = opts
  const R = opts.R ?? 100
  const setMask = (v: string) => { maskEl.style.maskImage = v; (maskEl.style as any).webkitMaskImage = v }
  const camDist = Math.hypot(cam.x, cam.y, cam.z)
  const m = geoToCartesian(lat, lng, alt, R)
  const dx = m.x - cam.x, dy = m.y - cam.y, dz = m.z - cam.z
  const len = Math.hypot(dx, dy, dz) || 1
  const ux = dx / len, uy = dy / len, uz = dz / len
  const tStar = -(cam.x * ux + cam.y * uy + cam.z * uz)
  if (!(tStar > 0 && tStar < len) || camDist <= R) { setMask('none'); return } // in front -> no mask
  const W = viewport.clientWidth, H = viewport.clientHeight
  const alpha = Math.asin(Math.min(1, R / camDist))
  const fov = ((globe.camera?.()?.fov) ?? 50) * Math.PI / 180
  const Rs = (H / 2) * Math.tan(alpha) / Math.tan(fov / 2) // Earth's silhouette radius on screen (px)
  const ms = globe.getScreenCoords(lat, lng, alt)
  let rx = ms.x - W / 2, ry = ms.y - H / 2
  const dm = Math.hypot(rx, ry) || 1
  rx /= dm; ry /= dm // unit radial: Earth center -> body, screen space
  const band = Rs * 0.16 // fade width ≈ the atmosphere halo, so the Moon fades across the glow
  // Gradient runs along the radial: transparent inside the limb (Rs), opaque past Rs+band.
  // Positions are along the CSS gradient line (length L, centered at L/2) in the maskEl's local px.
  const A = Math.atan2(rx, -ry) // CSS angle: screen dir (rx,ry), y-down, maps to (sinA,-cosA)
  const box = boxHalf * 2
  const L = box * (Math.abs(Math.sin(A)) + Math.abs(Math.cos(A))) || box
  const p0 = (L / 2 + (Rs - dm) / scale).toFixed(1)
  const p1 = (L / 2 + (Rs - dm + band) / scale).toFixed(1)
  setMask(`linear-gradient(${(A * 180 / Math.PI).toFixed(1)}deg, transparent ${p0}px, #000 ${p1}px)`)
}
