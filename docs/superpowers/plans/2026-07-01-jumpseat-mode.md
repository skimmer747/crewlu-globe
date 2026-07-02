# Jumpseat Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demo mode, share card, OG tags, deep links per `docs/superpowers/specs/2026-07-01-jumpseat-mode-design.md`.

**Architecture:** `src/data/demoFlights.ts` (pure runtime generator, unit-tested against the real airport index), `src/globe/shareCard.ts` (canvas compositor), `src/globe/deeplink.ts` (pure hash parser, unit-tested), wiring in `main.ts` (demo branch before auth, share button, deep-link window/playback), `hud.ts` SHARE button, `authView.ts` demo link, `globeScene.ts` preserveDrawingBuffer, `index.html` OG meta + `public/og/globe-og.jpg` (generated from demo mode in the harness).

**Tech Stack:** vanilla TS, canvas 2D, navigator.share. Branch `feature/jumpseat-mode`. No deploy without approval.

### Task 1 (TDD): demo generator + deep-link parser
- [ ] `tests/demoFlights.test.ts`: ≥50 rows; every departure/arrival IATA resolves in the real `public` airports index (load via `buildAirportIndex` fixtures or the actual loader data file); rows chronological by scheduled_block_out; every actual within ±6h of scheduled; at least 3 deadheads; at least one future trip (scheduled-only rows, no actuals); trip_ids group into ≥8 trips.
- [ ] `tests/deeplink.test.ts`: parses `#trip=T12&play=1` → `{trip: 'T12', play: true}`; empty/garbage hash → `{trip: null, play: false}`.
- [ ] Implement `demoFlights(): FlightRow[]` + `parseDeepLink(hash: string)`. Commit.

### Task 2: demo wiring + auth link
- [ ] `main.ts`: `const demo = new URLSearchParams(location.search).get('demo') === '1'`; skip `requireSession` + session fetch in demo; `flights = demo ? demoFlights() : await fetchFlights(supabase)`; account chip `DEMO · GET CREWLU` → opens `https://crewlu.net`.
- [ ] `authView.ts`: `<a class="link" href="?demo=1">view a demo globe →</a>` under the sign-in button. Commit.

### Task 3: share card
- [ ] `globeScene.ts`: `Globe({ rendererConfig: { preserveDrawingBuffer: true } })`.
- [ ] `shareCard.ts`: `composeShareCard(gl: HTMLCanvasElement, o: {miles, airports, countries, hours, lunarLine}): HTMLCanvasElement` — 1200×630, cover-crop drawImage, bottom gradient `#04111f`, wordmark, stat row, lunar line, `globe.crewlu.net`.
- [ ] `hud.ts`: SHARE navbtn + `onShare(cb)`; `main.ts`: compose → `toBlob` → `navigator.share({files:[File]})` when `canShare`, else download `crewlu-globe.jpg`. Commit.

### Task 4: OG meta + asset + deep links
- [ ] `main.ts`: apply `parseDeepLink(location.hash)` after trips: snap window to the trip, playhead to trip start; `play` skips cold-open and starts playback after mount.
- [ ] `index.html`: og:title/description/url/image (+twitter:card) pointing at `https://globe.crewlu.net/og/globe-og.jpg`.
- [ ] Generate `public/og/globe-og.jpg` from demo mode in the harness (compose via shareCard, extract dataURL, write file). Commit.

### Task 5: gate + verify + report
- [ ] `npm test` + `npm run build`; harness: `?demo=1` renders without auth (stats plausible), share button produces a card, `#trip=...&play=1` auto-plays; cleanup; report. Deploy only on approval.
