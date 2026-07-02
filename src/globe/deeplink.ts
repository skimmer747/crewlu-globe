/** Deep-link hash from the iOS app / portal card: `#trip=<trip_id>&play=1`. */
export interface DeepLink { trip: string | null; play: boolean }

export function parseDeepLink(hash: string): DeepLink {
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return { trip: h.get('trip'), play: h.get('play') === '1' }
}
