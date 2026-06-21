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
