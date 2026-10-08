# NEXT PHASE — "Real NFL numbers" retune (user-approved, 2026-10-08)

_Planned by Claude Opus 5.5. User: "retune NFL passing yards to the NFL and all other statistics based off the last 10 years of the NFL". This is the approval to change existing sim constants
(the old "don't retune team calibration" guardrail is lifted for this push only). Implement with DeepSeek Flash **after the `playbook` and `culture` pushes merge** (they also touch playsim.ts). Lint baseline 4._

## Targets — NFL 2015–2024 average, per team per game (regular season; approximate, from league team totals on pro-football-reference.com / nfl.com)
| Stat | Target | Band | Today (seed 33333) |
|---|---|---|---|
| Points | 22.6 | ±0.6 | 23.7 |
| Offensive plays (incl. sacks) | 63.5 | ±1.5 | 65.0 |
| Pass attempts | 34.7 | ±1.5 | ~36 |
| Completion % | 64.3 | ±1.0 | 67.9 |
| **Gross passing yards** | **241** | ±8 | 262 |
| Net passing yards (minus sack yards) | 225 | ±8 | — |
| Yards per attempt (gross) | 6.95 | ±0.25 | ~7.3 |
| Passing TD | 1.55 | ±0.15 | ~1.8 |
| Interceptions | 0.80 | ±0.10 | 0.94 |
| **Sacks taken** | **2.40** | ±0.20 | 1.37 |
| Rush attempts | 26.8 | ±1.5 | ~25.4 |
| Rushing yards | 114 | ±6 | 122 |
| Yards per carry | 4.27 | ±0.12 | 4.84 |
| Rushing TD | 0.80 | ±0.12 | ~1.09 |
| Total yards | 340 | ±12 | ~385 |
| First downs | 20.0 | ±1.0 | ~21 |
| 3rd-down conversion % | 39 | ±2 | ~44 |
| Red-zone TD % (TD per trip) | 56 | ±5 | ~92 (bug-level high) |
| FG attempts / made | 1.8 / 1.53 (85%) | ±0.2 / ±3% | ~1.8 / 1.4 |
| XP % | 94 | ±2 | — |
| Lost fumbles | 0.55 | ±0.12 | — |
| Turnovers (INT + lost fumbles) | 1.35 | ±0.15 | — |
| Penalties / yards | 6.0 / 52 | ±0.8 / ±8 | — (the sim has pre-snap 5-yd penalties only) |
| Punts | 4.0 | ±0.4 | — |
| Time of possession | 30:00 | — | — |

## Tasks
- R1: `__simTest` gains every row above (gross + net pass yards, red-zone trips/TD%, penalties, punts, lost fumbles) and prints target/band/✅.
- R2: retune **existing constants** in `playsim.ts` (completion base, YPA/YAC, sack base, INT base, run yards, red-zone finishing, 3rd-down, penalty rate/types, pace) until all rows sit inside their bands on seeds 33333, 2222 and 5150 (500 games each). Prefer the few base constants over many tweaks; keep every L12 relative rating term and its weight.
- R3: re-check `__statShape` (player distributions) and update its bands to NFL 2015–2024 player norms where a team retune moves them (top receiver ~70 yds median, RB1 ~60 yds, QB ~240 passing yds); `gameDayEquivalence(20)` 20/20; `__planMatrix` no dominant preset; `careerSmoke(6, both paths)` 0/0; career pacing unchanged ±1 season.
- R4: update `NEXT_PHASE_L12.md`'s E3 anchors note and the in-game glossary/tooltips that quote league numbers.
- No rng draws added or removed; AI and user use the same constants.

## Verification log
