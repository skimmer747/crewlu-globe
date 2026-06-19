import type { AirportCoord } from '../model'

export interface AirportIndex { lookup(iata: string): AirportCoord | undefined; size: number }

export function buildAirportIndex(rows: AirportCoord[]): AirportIndex {
  const map = new Map<string, AirportCoord>()
  for (const r of rows) {
    if (!r.iata || typeof r.lat !== 'number' || typeof r.lng !== 'number') continue
    map.set(r.iata.toUpperCase(), { ...r, iata: r.iata.toUpperCase() })
  }
  return { lookup: (iata) => map.get((iata ?? '').toUpperCase()), size: map.size }
}

/** Load the bundled airports.json and index it. */
export async function loadAirports(url = '/data/airports.json'): Promise<AirportIndex> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`airports.json ${res.status}`)
  return buildAirportIndex((await res.json()) as AirportCoord[])
}
