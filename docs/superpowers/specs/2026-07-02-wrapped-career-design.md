# Wrapped — Always-On Career Features

Date: 2026-07-02
Status: Approved (package 4, part 1 of 2; the scripted year-in-review tour is deferred to Q4)

## Goal

The bragging-rights layer: ALL TIME career mode with an odometer roll-up and conversion lines, records & superlatives with a gold arc spotlight, milestone badges on the timeline that toast during playback, and a fleet lens that colors the map by aircraft type. No camera-riding features (chase cam was removed at user request — playback camera stays as-is).

## Components

1. **Career data module** (`src/data/career.ts`, pure, TDD): `recordsFor(legs)` → longest/shortest leg by miles, most-flown undirected city pair, most-landed airport, distinct tails (requires carrying `tail_number` onto `Leg` — currently fetched and dropped); `milestonesFor(legs)` → threshold crossings with the timestamp of the leg that crossed them (legs 100/250/500/1k/2.5k/5k, each 250k nm, block hours 1k/2.5k/5k/10k/15k/20k, each Earth lap = 21,600 nm), computed over operated (non-deadhead) legs; `fleetStats(legs)` → per-aircraft-type legs/miles/blockMs, ranked. `EARTH_LAP_NM = 21600`.
2. **ALL TIME mode** (HUD `★ ALL TIME` toggle): saves the current window/playhead/camera, snaps the dock window to the whole career (new `dock.setWindow(s, e)`), playhead to the end, camera to a wide view (altitude 2.8), rolls the four stat chips with a 1.6s odometer tween, and shows a conversion line under the miles chip: `= 4.1× AROUND EARTH · 0.66 LUNAR RETURNS` (flew miles; reuses `LUNAR_RETURN_NM`). Toggling off restores everything.
3. **Records panel + gold spotlight**: HUD `⛁ RECORDS` toggle reveals a panel listing the records; tapping the longest/shortest/top-pair rows spotlights the matching arc(s) in gold (`__spot` flag through `combineArcData`/`arcPaint`; other solid arcs dim while a spotlight is active) and flies the camera to the leg's great-circle midpoint. Tapping again (or closing the panel) clears it.
4. **Milestone timeline badges + toasts**: `createTimelineDock` accepts `milestones`; `renderTrack` draws small amber diamonds at their times (window-clipped). During playback, the playhead crossing a milestone fires the existing golden event chip (`hud.setEvent('1,000TH LEG')`).
5. **Fleet lens**: HUD `✈ FLEET` toggle recolors solid arcs by aircraft type using a fixed 5-hue palette ranked by `fleetStats`, with a small legend (top types + block hours) in the panel area. Ghost/active arc treatments unchanged.

## Constraints & fit

Everything through existing seams: arcsLayer data flags, HUD chips (the button column under LUNAR RETURN grows to four), dock config. No new custom 3D layers (dart owns the slot), no canvas transforms, no playback pacing changes. Demo mode gets all of it for free.

## Testing & verification

TDD for career.ts (records on a known fixture incl. deadhead exclusion + undirected pairs; milestone crossing times; fleet ranking + null aircraft normalization) and the arcsLayer spotlight/fleet paint paths. tsc + build gates. Visual verification in `?demo=1` via the localhost preview (ALL TIME roll-up, gold spotlight, badge toasts during playback, fleet colors). No deploy without approval.
