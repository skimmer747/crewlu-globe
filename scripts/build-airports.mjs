// scripts/build-airports.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DUTY = '/Users/toddanderson/Dev/Duty/Duty'

// --- 1. App International JSON ---
const intl = JSON.parse(readFileSync(join(DUTY, 'Data/InternationalAirports.json'), 'utf8')).airports
  .map(a => ({ iata: a.iata, lat: a.latitude, lng: a.longitude, city: a.city, country: a.country }))

// --- 2. App hardcoded dict (regex the Swift AirportData(...) literals) ---
const swift = readFileSync(join(DUTY, 'Utils/AirportDataProvider.swift'), 'utf8')
const re = /AirportData\(name:[^,]*,\s*iata:\s*"([A-Z0-9]{3})"[^)]*?city:\s*"([^"]*)"[^)]*?country:\s*"([^"]*)"[^)]*?latitude:\s*([-\d.]+),\s*longitude:\s*([-\d.]+)/g
const hard = []
for (const m of swift.matchAll(re)) hard.push({ iata: m[1], city: m[2], country: m[3], lat: +m[4], lng: +m[5] })

// --- 3. OurAirports global (download CSV once to scripts/ourairports.csv) ---
let ours = []
const csvPath = join(here, 'ourairports.csv')
if (existsSync(csvPath)) {
  const lines = readFileSync(csvPath, 'utf8').split('\n')
  const head = lines[0].split(',').map(s => s.replace(/"/g, ''))
  const iLat = head.indexOf('latitude_deg'), iLng = head.indexOf('longitude_deg')
  const iIata = head.indexOf('iata_code'), iMuni = head.indexOf('municipality'), iCountry = head.indexOf('iso_country')
  for (let n = 1; n < lines.length; n++) {
    const c = lines[n].match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)?.map(s => s.replace(/,$/, '').replace(/^"|"$/g, '')) ?? []
    const iata = c[iIata]
    if (iata && iata.length === 3 && c[iLat] && c[iLng])
      ours.push({ iata, lat: +c[iLat], lng: +c[iLng], city: c[iMuni], country: c[iCountry] })
  }
} else {
  console.warn('scripts/ourairports.csv not found — download https://davidmegginson.github.io/ourairports-data/airports.csv into scripts/ before running. Proceeding with app data only.')
}

// --- 4. Merge: app data wins on conflict ---
const byIata = new Map()
for (const a of ours) byIata.set(a.iata.toUpperCase(), a)
for (const a of [...intl, ...hard]) byIata.set(a.iata.toUpperCase(), a)
const merged = [...byIata.values()].map(a => ({ iata: a.iata.toUpperCase(), lat: +a.lat, lng: +a.lng, city: a.city, country: a.country }))

writeFileSync(join(here, '../public/data/airports.json'), JSON.stringify(merged))
console.log(`airports.json: ${merged.length} airports (app: ${intl.length + hard.length}, ours: ${ours.length})`)
