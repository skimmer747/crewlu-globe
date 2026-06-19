const D2R = Math.PI / 180

export interface Vec3 { x: number; y: number; z: number }

export function geoToCartesian(lat: number, lng: number, alt: number, R = 100): Vec3 {
  const phi = (90 - lat) * D2R
  const theta = (90 - lng) * D2R
  const r = R * (1 + alt)
  return { x: r * Math.sin(phi) * Math.cos(theta), y: r * Math.cos(phi), z: r * Math.sin(phi) * Math.sin(theta) }
}

/** True if the Earth sphere (radius R) lies between the camera and the point. */
export function isOccluded(cam: Vec3, lat: number, lng: number, alt: number, R = 100): boolean {
  const m = geoToCartesian(lat, lng, alt, R)
  const dx = m.x - cam.x, dy = m.y - cam.y, dz = m.z - cam.z
  const a = dx * dx + dy * dy + dz * dz
  const b = 2 * (cam.x * dx + cam.y * dy + cam.z * dz)
  const c = cam.x * cam.x + cam.y * cam.y + cam.z * cam.z - R * R
  const disc = b * b - 4 * a * c
  if (disc <= 0) return false
  const sq = Math.sqrt(disc)
  const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a)
  return (t1 > 1e-4 && t1 < 0.9999) || (t2 > 1e-4 && t2 < 0.9999)
}
