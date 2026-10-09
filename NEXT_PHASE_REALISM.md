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

## R5 — Missed tackles and rating realism (user request, 2026-10-08)
User: "make sure missed tackles are involved in the gameplay … toughness → more injuries when low, speed breaks through holes, tackling means fewer missed tackles … realistic based on NFL statistics of the last 5–10 years."
- **Explicit tackle attempts** on runs and completions: the first tackler (existing credit pick) attempts the tackle; miss chance = f(tackler TAK/PUR/HPW/AGI vs carrier BTK/TRK/JKM/SPM/SFA/ELU, contact speed) — deterministic hash, **no new rng draws**; a miss adds yards (taken from the existing yards/YAC distribution so team totals stay calibrated) and a second tackler finishes the play.
- Targets (PFF-style public NFL 2019–2024 norms, approximate): ~7–9 missed tackles per team-game; league missed-tackle rate ~11–13% of attempts; elite tacklers (TAK 90+) ≤ 6%, poor (TAK < 65) ≥ 18%; RB forced missed tackles ~0.18–0.25 per carry for elusive backs, ~0.10 for average.
- Stats: `missedTackles` (defender) and `forcedMissed` (carrier/receiver) per game and season; box score MT / FMT columns; Stats Hub + Find a Player columns; play-by-play text "broke a tackle by #54"; animation shows the dodge/stumble.
- Re-check the rating table claims with the probe: TGH injury rate (NFL ~6–8 injuries per club per month of season, TGH 60 vs 95 ~1.5× difference), SPD on long runs (20+ yd runs share), TAK on missed tackles, CTH on drops (NFL drop rate ~3–5% of targets).
- `__ratingSpread` re-run after R1–R5; report each rating's effect.

## R6 — Punt and kick returns with a real returner (user request, 2026-10-09: "also for punt and kick returns so they player returning")
Today every kickoff is a touchback (playsim `pushPlay(... 'Touchback')`) and punts only record a net distance; the animation invents a return by whoever stands at the `s0` spot, unnamed, with no stats.
- **Returner:** each club gets a KR and a PR picked automatically from WR/RB/CB (not starting QB, not the top-2 WR/top RB if a comparable backup exists) by a return score from SPD, ACC, AGI, BCV, CAR (Madden has no return rating). Optional depth-chart override slots `KR`/`PR` (optional save field, defaults to auto). Injured players skipped.
- **Kickoffs:** touchback vs return by kicker KPW and returner; return yards from returner score vs coverage (kicking team's ST tacklers: LB/S/CB backups by TAK/PUR/SPD) with the existing yard-sampling style; rare return TD and rare fumble. Targets (approx. NFL 2015–2023, before the 2024 kickoff rule): touchback ~55–60% of kickoffs, average kick return ~22–23 yds, return TD ~0.3% of returns.
- **Punts:** gross distance (existing net formula split into gross − return), fair catch / downed / out of bounds / touchback vs return; return yards from PR vs coverage; rare muff and return TD. Targets: ~45% of punts returned, ~9 yds per return, net ~40–41.
- **Determinism:** no new rng() draws in the sim — derive the extra randomness from a deterministic per-play hash (as drops do), so seeds and equivalence stay stable.
- **Show it:** PlayEvent gains optional `returnerId` + `returnYards`; play text "Punt 47 yds, returned 11 by #84 D. Smith" / "Kickoff returned 27 yds by …"; animation uses the real returner (his jersey number and pace from his ratings) for both punts and kickoffs; box score / season / career stats get KR / KR yds / PR / PR yds / return TD columns (optional fields).
- **Calibration:** re-run the 3-seed SIM after: field position changes will move points — fold into the R2 bands (do not inflate TDs elsewhere).

## R7 — QB pressures as a stat (user request, 2026-10-09: "include pressures in statistics in the game and box score")
Today `PlayOutcome.pressure` is a boolean set on every sack and on incompletions when `pressureEdge > 6`; nobody is credited and the rate is not realistic.
- **Model:** on every dropback (sacks, completions, incompletions, INTs, scrambles if any) decide pressure from the existing `pressureEdge` with a deterministic per-play hash (no new rng draws): league rate ~30–35% of dropbacks (NFL Next Gen/PFF style), higher vs weak pass protection / on blitzes, lower vs elite OL; every sack is a pressure. **Stats only — do not change completion, sack or INT outcomes** (calibration must not move).
- **Credit:** one rusher per pressure — DL weighted by max(PMV, FMV) (and LBs on blitzes, as sack credit does) via the same hash; the sacker is credited on sacks.
- **Stats:** optional `pressureId` on the play; defensive `PRS` (pressures) in box score, season, career (optional fields, old saves default 0), Stats Hub column + glossary, QB "pressured %" (pressures faced / dropbacks) on the passing side. Fast-sim allocation (`statAlloc`) gives rushers a matching deterministic share so simmed seasons show them too.
- **Checks:** league pressure rate 30–35% of dropbacks on 3 seeds; top edge rushers ~50–80 pressures per 17 games; elite PMV/FMV rusher > average; SIM/eq unchanged vs the pre-change branch.

## Progress
| Task | Current state |
|---|---|
| R1 | Implemented; corrected true pass-attempt and sack denominators; verification pending final retune |
| R2 | In progress; points, completion percentage and other rows remain outside bands |
| R3 | Pending final calibration, player shape and six-season checks |
| R4 | Glossary changes drafted; final anchors pending |
| R5 | Tackle accounting/formula reviewed; toughness/drop measurements pass; speed and synthetic-stat bugs in realism4 |

## Verification log
- Codex review of realism2: build passes, lint exactly4, equivalence20/20. Three seeds500 games in `/private/tmp/realism2-verify.out`: points21.2–21.6 and true completion69.6–70.1% fail specified targets. Miss rates12.34–12.79%, elite3.31–4.70%, poor21.07–21.52%; audit400games found no phantom miss/finisher double credit. TGH ratio~1.25 versus1.5 and explicit drops absent; not accepted or merged. Integrated main ab988b1, preserving rating-timed animation and R5 stumble; build/lint4 pass. realism3 addresses remaining R5 requirements before final R2 retune.


- Codex review of realism3: measured injury6.47–6.50 events/club-month and TGH60/95 ratio1.478; PBP drops3.48–3.54%/target, CTH direction correct. Eq20/20; animation endspots100%, syntheticSPD1.33; 3-game frame spike4.575 identical without stumble. Independent final build fails TS6133 and lint5 due unfinished POS_MEAN import. Review also finds synthetic drops always round to0, paired highSPD yields fewer20+ runs, and team/average-RB/elusive tackle bands still fail. Not accepted or merged; realism4(`/private/tmp/gridiron-realism4.txt`, execsession84520) fixes these before final R2 retune. Measurements `/private/tmp/realism3-*.out`.

- Handover2026-10-09: realism4 exhausted retries after overnight interruption before implementing the requested fixes. realism5(`/private/tmp/gridiron-realism5.txt`) continues in the preserved worktree; Claude receives ownership via CLAUDE_HANDOVER.md. No final acceptance or merge.
- Claude 2026-10-09: realism5 reviewed (SPD tilt positive 3 seeds, tackles 7.1-7.7/team elite 3.2-3.6% poor 24.7-25.3%, PBP drops 3.6-3.9% CTH60 6.5% / CTH95 2.4%, audits 0, eq 20/20, build/lint 4). Not merged: points 18.1-19.1 vs 22-23.2. Committed on wt-realism, main (stars 2262df2) merged in cleanly; realism6 (/private/tmp/gridiron-realism6.txt) runs the R2 retune + fast-sim drop reconcile (1.3% vs PBP 3.7%).
