// Living contrail behind the dart: a ring buffer of [lat, lng, alt] points with an
// alpha ramp from nothing at the tail to bright at the dart. Pure logic — the paths-layer
// writes (the DOM-churn hot path) are throttled by the caller in main.ts.

export interface ContrailSnapshot { pts: [number, number, number][]; colors: string[] }

const MAX_PTS = 60
const PUSH_MS = 40 // min spacing between recorded points

export interface Contrail {
  push(lat: number, lng: number, alt: number, nowMs: number): boolean
  decay(): boolean
  clear(): void
  size(): number
  snapshot(): ContrailSnapshot | null
}

export function createContrail(): Contrail {
  const pts: [number, number, number][] = []
  let lastPush = -Infinity
  return {
    /** Record a point if the throttle window has elapsed. Returns true when recorded. */
    push(lat, lng, alt, nowMs) {
      if (nowMs - lastPush < PUSH_MS) return false
      lastPush = nowMs
      pts.push([lat, lng, alt])
      if (pts.length > MAX_PTS) pts.shift()
      return true
    },
    /** Drop one point from the tail (post-landing fade). Returns true while points remain. */
    decay() {
      pts.shift()
      return pts.length > 0
    },
    clear() { pts.length = 0; lastPush = -Infinity },
    size() { return pts.length },
    /** Paths-layer datum, or null when there's nothing worth drawing. */
    snapshot() {
      if (pts.length < 2) return null
      const n = pts.length
      const colors = pts.map((_, i) => `rgba(150,220,255,${((0.85 * i) / (n - 1)).toFixed(3)})`)
      return { pts: pts.slice(), colors }
    },
  }
}
