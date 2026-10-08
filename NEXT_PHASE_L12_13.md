# NEXT PHASE — L12.13 "Playbook mastery that's real" (user request, 2026-10-08)

_Planned by Claude Opus 5.5. Implement with DeepSeek Flash after the `culture` push merges (it uses `teamCohesion`) and before the NFL retune (`NEXT_PHASE_REALISM.md`). Lint baseline 4._
User: "make playbook learning more realistic, make sure it's within the simulation of gameplay, and related to the output/production of the player a little bit." Screenshot: every player at 0–1% "New to system".

## Found in code (`src/game/engine/playbook.ts`, `playsim.ts`, `statAlloc.ts`)
- New careers start everyone at ~0% (initPlaybook from scratch); learning = `REP_GAIN_PER_GAME` 1.6 × age × dev for any game a player appears in, + 14 per offseason; ceiling from scheme fit × cohesion.
- Sim: `famMult` = `masteryMultiplier` (0.90 at 0% → 1.18 at 100%) **absolute**, used only for the QB's pass edge (×90) and the ball carrier's run edge (×40); `statAlloc` uses it in fast-sim shares.

## Tasks
| Task | What | Status |
|---|---|---|
| M1 | Realistic starting mastery at world creation: estimate years in the system per player (rookies 0; others deterministic `hash32(id)` 1..min(age−22, 7), capped by the coordinator's tenure `staffTenure`), seed `experience` accordingly so long-tenured vets land ~60–85%, new arrivals/new coordinators low. One-time migration for saves in season 1 where ≥ 90% of rostered players are < 5% (flag `world.masterySeedV2`). | ✅ merged |
| M2 | Learning tied to snaps and production: per-game gain × snap share (starter ~1.0, rotation ~0.5, a few snaps ~0.15 — from that game's box line or depth rank) × (0.9 + 0.2 × that game's production grade, position-relative) × (1 + (AWR − 70)/200) × position-coach `development`; Install practice ×1.25 stays; offseason training unchanged. Same rng draw count (no rng here at all). | ✅ merged |
| M3 | In the sim, **relative to the league mean** for the position group (an average club = 0): QB reads/accuracy (replaces the absolute QB term), receivers' separation (small), OL pass pro + run block (small), DL/LB/DB run fits and coverage (small), and a mental-error term (pre-snap penalties / blown coverage chance × (1 + (mean − mastery) × k), thresholds only). Keep the overall size of today's QB/carrier effect for a 0→100 swing; new terms each ≤ ±5% relative. Replace `statAlloc`'s absolute `fam` share with the relative one. | ✅ merged |
| M4 | UI: playbook bar tooltip — "72% · +2.1 this season (starter, 15 games) · grows with snaps, good games, AWR, your QB coach, Install weeks · in games: reads +0.8, …"; Roster column sorts by it. | ✅ merged |

## Acceptance
build + lint 4; `simTest(500)` on 33333/2222/5150 unchanged within the current bands (relative terms ⇒ league averages hold); `gameDayEquivalence(20)` 20/20; `careerSmoke(6, both)` 0/0; a probe `__masteryProbe()` printing the league distribution of mastery by position in season 1 and after 3 seasons, and starters vs backups growth.

## DO NOT
No rng draws added/removed; no changes to gates/objectives/capabilities/`evaluateTrade`/contract pricing. Optional save fields only. Canonical player objects. No new dependencies. No temp files in the repo. Do not edit `*.md`. No git commands.


## Verification log
- 2026-10-08 M1–M4 merged (with playbook + culture): build ok, lint 4; 500 games 33333/2222/5150 = 23.6/24.6/25.0 pts, comp 68.1/67.4/68.4%, ypc 4.90/4.81/4.88; eq 20/20; smokes 0/0. Starters' mastery 21 → 62 over 3 seasons, backups 21 → 49. Known: at world creation 6–7-year vets are capped at ~45–72% by the cohesion cap (spec said up to 85%); they reach the band by season 3.
