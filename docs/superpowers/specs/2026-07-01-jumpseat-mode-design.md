# Jumpseat Mode — Demo Globe + Share Loop

Date: 2026-07-01
Status: Approved (package 3 of 4)

## Goal

Open the two closed doors: visitors from crewlu.net's portal card currently hit a login wall (give them `?demo=1` — a fully live globe on synthetic data, no account), and owners who love the globe have nothing to post (give them a SHARE card, real OG unfurls, and deep links from the iOS app).

## Components

1. **Demo mode `?demo=1`** (`src/data/demoFlights.ts` + `main.ts`): a runtime generator returns ~60 `FlightRow`s of a plausible UPS 74Y line anchored to `Date.now()` — SDF hub turns, an ANC–HKG–CGN world tour, commercial deadheads, realistic OFF/ON delays, and a future scheduled trip so ghost arcs show. Generated at load (never stale), passed through the exact real pipeline (`flightsToLegs` → everything). `main.ts` parses `location.search` BEFORE `requireSession`; demo skips auth and Supabase entirely. Account chip reads `DEMO · GET CREWLU` and clicks through to crewlu.net. The sign-in card gains a "view a demo globe →" link.
2. **Share card** (`src/globe/shareCard.ts` + HUD button): `rendererConfig: { preserveDrawingBuffer: true }` on the Globe constructor; SHARE button under LUNAR RETURN composites the WebGL canvas (cover-cropped) onto a 1200×630 2D canvas with a bottom gradient, the CREWLU wordmark, the four stats, the lunar-returns line, and `globe.crewlu.net` — then `navigator.share({ files })` with an `<a download>` fallback.
3. **OG tags** (`index.html` + `public/og/globe-og.jpg`): static og/twitter meta pointing at a canned share-card JPEG generated once from demo mode — bare links finally unfurl.
4. **Deep links** (`main.ts`): `#trip=<trip_id>&play=1` — window snaps to that trip, playhead to its start; `play=1` skips the cold-open and starts playback. The iOS app opens one URL; Supabase's persisted session means no re-login. `?demo=1#play=1` is a self-running kiosk for the crewlu.net portal card.

## Explicitly out

Replay Reel video export (timeboxed out per the roadmap — the still card is 70% of the loop for 20% of the work); pointing crewlu.net's portal card at `?demo=1` (separate repo, do after deploy).

## Testing & verification

Vitest: demo generator invariants (row count, all IATAs resolve against the real airport index, chronological, delays within ±6h credibility, future trip present, deadheads flagged); deep-link hash parser (pure). Harness/browser: demo mode renders without auth, share card composes (visual), deep link plays. tsc + build gates. No deploy without approval.

## Risks

Demo data must read as a plausible UPS line to the exact audience that would mock it — reviewed leg-by-leg. `preserveDrawingBuffer` costs a little GPU headroom (accepted). Demo creates an unauthenticated code path — it must never touch Supabase (guard: demo skips client creation entirely... the module-level `supabase.ts` client still constructs; acceptable, it just makes no calls).
