// Departure/arrival city name tags, anchored to the globe itself (not the fixed HUD) so they
// sit right under the airport and travel with it as the globe rotates. Two fixed slots — one
// per end of whichever leg is currently active — reused across legs rather than recreated.

const LABEL_ALT = 0.006 // a hair above the airport puck's altitude (0.002) so it never z-fights

export interface CityLabelDatum { type: 'cityLabel'; id: 'from' | 'to'; lat: number; lng: number; alt: number }

export interface CityLabels {
  data: CityLabelDatum[]
  elementFor(id: 'from' | 'to'): HTMLElement
  setLegs(from: { lat: number; lng: number; text: string } | null, to: { lat: number; lng: number; text: string } | null): void
}

export function createCityLabels(): CityLabels {
  const makeEl = () => {
    const wrap = document.createElement('div')
    wrap.className = 'city-label-wrap'
    wrap.innerHTML = `<div class="city-label"></div>`
    return wrap
  }
  const els = { from: makeEl(), to: makeEl() } as const
  const inner = { from: els.from.querySelector<HTMLElement>('.city-label')!, to: els.to.querySelector<HTMLElement>('.city-label')! }
  const data: CityLabelDatum[] = [
    { type: 'cityLabel', id: 'from', lat: 0, lng: 0, alt: LABEL_ALT },
    { type: 'cityLabel', id: 'to', lat: 0, lng: 0, alt: LABEL_ALT },
  ]
  const datumById = { from: data[0], to: data[1] } as const

  // We toggle our own active/inactive state on the INNER text element, never on the wrap.
  // three-globe (via CSS2DRenderer) owns the wrap's `display`: it positions it and, critically,
  // sets display:none for endpoints behind the Earth — refreshed every frame because main re-feeds
  // htmlElementsData each frame. Writing the wrap's display here would race that per-frame hide and
  // un-hide far-side labels at a stale, frozen transform (the "Dubai floats over Louisville" bug).
  const apply = (id: 'from' | 'to', v: { lat: number; lng: number; text: string } | null) => {
    if (!v) { inner[id].style.display = 'none'; return }
    datumById[id].lat = v.lat
    datumById[id].lng = v.lng
    inner[id].textContent = v.text
    inner[id].style.display = 'block'
  }

  return {
    data,
    elementFor(id) { return els[id] },
    setLegs(from, to) { apply('from', from); apply('to', to) },
  }
}
