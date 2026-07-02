# Wrapped Career Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ALL TIME mode, records + gold spotlight, milestone badges/toasts, fleet lens per `docs/superpowers/specs/2026-07-02-wrapped-career-design.md`.

**Architecture:** Pure career math in `src/data/career.ts` (TDD). Leg gains `tail`. Arc paint variants (`__spot`, fleet ranking) flow through the existing `combineArcData`/`arcPaint`/`setArcs` seam (TDD on the pure paint helpers). UI wiring in `hud.ts` (three new toggles + panels), `timelineDock.ts` (`setWindow`, milestone diamonds), `main.ts` (mode state machine, odometer tween, spotlight camera, milestone toasts).

**Tech Stack:** vanilla TS, vitest. Branch `feature/wrapped-career`. No deploy without approval.

### Task 1 (TDD): tail on Leg + career.ts
- [ ] Leg gains `tail: string | null` (model + transform map + one test line).
- [ ] `tests/career.test.ts`: recordsFor fixture (longest/shortest by miles; undirected top pair counts both directions; top airport by landings; distinct tails; deadheads excluded from records but pair counts?? — records are operated-only, document); milestonesFor (leg-count and Earth-lap crossings land on the crossing leg's landing time; deadheads excluded); fleetStats (ranked, null → 'UNK', blockMs summed).
- [ ] Implement `src/data/career.ts` (`EARTH_LAP_NM`, `recordsFor`, `milestonesFor`, `fleetStats`). Commit.

### Task 2 (TDD): arc paint variants
- [ ] Tests: `arcPaint({__spot:true})` → gold pair; solid non-spot while `spotActive` → dimmed; fleet mode paints by rank palette; ghosts/active unchanged.
- [ ] Implement in arcsLayer: `combineArcData(solid, ghost, activeId, opts?: { spotIds?: Set<string>; fleetRank?: Map<string, number> })` tagging `__spot`/`__dim`/`__fleet`; `arcPaint` handles gold/dim/fleet palette; `setArcs` passes opts. Commit.

### Task 3: dock `setWindow` + milestone diamonds
- [ ] TimelineDock: `setWindow(s, e)` (set state, rebuildAxis, renderTrack); init accepts `milestones: {t, label}[]`; renderTrack emits `<span class="mstone">` at their positions; styles.css diamond (amber, rotated square, above track).
- [ ] Commit.

### Task 4: HUD toggles + panels
- [ ] hud.ts: `★ ALL TIME`, `⛁ RECORDS`, `✈ FLEET` navbtns in the button column; `onAllTime/onRecords/onFleet(cb)`; `setAllTimeActive/setRecordsPanel(html|null)/setFleetLegend(html|null)`; conversions sub-line `#sConvert` under miles chip + `setConversions(text)`. Records panel rows carry `data-spot` handled via one delegated click → `onRecordSpot(cb(ids: string[], mid: [lat,lng], miles: number))`.
- [ ] Commit.

### Task 5: main.ts wiring
- [ ] Career data computed once (`recordsFor/milestonesFor/fleetStats` on full legs).
- [ ] ALL TIME: save/restore {win, playhead, pov}; dock.setWindow; odometer tween (1.6s rAF, interpolate miles/hours/airports/countries into hud.setStats, final = real stats); setConversions with flew miles (`EARTH_LAP_NM`, `LUNAR_RETURN_NM`).
- [ ] Records: panel build from recordsFor; spotlight state `spotIds` feeding draw()→setArcs opts; camera fly to slerp midpoint at `altForLeg(miles)`; clear on second tap/panel close/window change.
- [ ] Fleet: toggle feeding `fleetRank` into draw; legend via fleetStats top 4.
- [ ] Milestones: pass to dock; in `onPlayhead`, prev→current crossing fires `hud.setEvent(label)` (rate-limited by the chip's own 3s life).
- [ ] Commit.

### Task 6: verify + gate
- [ ] `npm test`, tsc, build. Preview `?demo=1`: ALL TIME rolls up and restores; records spotlight golds the longest leg and dims others; fleet lens recolors; milestone diamond visible and toasts during playback. Report; deploy only on approval.
