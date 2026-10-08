# NEXT PHASE — L12.7 "Rookies earn it" (user playtest request, 2026-10-08)

_Planned by Claude Opus 5.5. Implemented by DeepSeek Flash 4.1 in one push. Lint baseline: exactly 4 warnings._

User's words: "rookies have way too high of ratings — they need to rely on potential or ceiling instead, and use stats or experience to be able to hit that."
Screenshot: a 5th-round CB (pick 169) at 87 OVR, a 2nd-round DE at 92.

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| D1 | Real-data prospects convert college OVR to an NFL rookie OVR + a ceiling (POT) | P1 | not started |
| D2 | Young players grow toward POT with playing time and production, not just age | P1 | not started |
| D3 | Show it: Draft board "Now / Ceiling", profile development line, season-end growth report | P1 | not started |
| D4 | Probe: league talent stays level over 8 seasons; rookie OVR distribution by round | P1 | not started |
| D5 | Scouting reads on the NFL scale: **Now** and **Ceiling** ranges side by side, fuzzy by scouting confidence | P2 | not started |

## Found in code
- `realProspectClass` (`generate.ts` ~515) sets prospect `ovr: p.ovr` straight from **CFB 26** (college scale: top players 85–95) and `pot: ovr + 0..9`; `prospectToPlayer` (`draft.ts` ~134) then makes the
  pro `ovr = min(pot, ovr + 3)`. So college stars enter the NFL at 85–95. (Generated classes, `generateProspectClass`, already use `ovr = 48 + grade·0.24` ≈ 60–72 and are fine.)
- `developPlayers` (`progress.ts`) grows every player ≤ 24 by 34–54% of `pot − ovr` per year, 25–26 by 20–35%, regardless of whether he played.

## D1 — Rookie OVR and ceiling (real-data classes)
- Keep the prospect's college numbers for scouting (`grade`, `trueGrade` unchanged — they drive draft order, the department, conviction and the Ledger; do NOT change them).
- New pure helper `rookieRatings(prospect, classRank, classSize): { ovr; pot }` in `draft.ts`, used by `prospectToPlayer` for **every** prospect (real and generated):
  - `pot` (the ceiling) = `clamp(round(58 + (prospect.pot − 60) · 0.95), 60, 97)` for real-data prospects (college pot 99 → 95, 90 → 86.5, 80 → 77); generated prospects keep their `pot`.
  - `ovr` by the prospect's **true-grade rank in his class** (so a steal stays a steal), interpolated: rank 1 → 79, rank 5 → 76, rank 32 → 71, rank 64 → 67, rank 100 → 64, rank 160 → 60, rank 224+ → 55;
    then `ovr = min(ovr, pot − 3)` and never below 50. Deterministic (no rng); ±1 jitter from `hash32(prospect.id)` allowed.
  - Generated prospects: `ovr` = the lower of today's value and the curve value.
- `attrs`: rookies built from real CFB players carry no NFL `attrs`, so `playerAttrs` generates them from `ovr` — that's correct; don't copy college attrs.
- The rookie contract (`makeRookieContract(pick)`) is unchanged.
- Migration: existing saves keep their current rookies (no retro-change).

## D2 — Growth from experience
In `developPlayers`, for players **≤ 26** replace the age-only fraction with an experience-weighted one. Use the season's stats line (`p.stats` entry for `world.season`, level NFL) and the depth chart at season end:
- `games` = games played that season; `starter` = he was within `STARTERS[pos]` on his club's depth chart (use `depthAt`) at season end; `production` = a position-relative 0–1 score from his season line
  (QB passer rating, RB yards/carry + yards, WR/TE yards per target + yards, OL/DL/LB/DB games started proxy via tackles/sacks/INT/PD/coverage grade; keep it simple and documented; 0.5 when no line).
- `experience = clamp(0.45·min(1, games/14) + 0.35·(starter ? 1 : 0) + 0.20·production, 0, 1)`.
- Age ≤ 24: `growth fraction = 0.10 + 0.40·experience + rng()·0.12` (was 0.34 + rng()·0.2). Ages 25–26: `0.06 + 0.26·experience + rng()·0.08`. Same `rng()` draw count per player as today.
  A rookie who sits all year still grows a little (practice); a starter who produces grows fastest. Coaching `dev` and character `devModifier` multiply as today. Never above `pot`.
- Players on practice squads count as `games = 0`, `starter = false`.
- Store each player's last growth on the player as optional `p.lastGrowth?: { season; from; to; experience }` (for D3).

## D3 — UI
- **Draft board / prospect rows / your selections:** show "Now ~NN · Ceiling NN" (from `rookieRatings`, using the scouted grade rank instead of the true rank so it doesn't leak truth: rank by `myGrade ?? grade`).
  Keep the existing grade range badge, labelled "Prospect grade".
- **Player profile:** for players ≤ 26, a "Development" line: "Ceiling 86 · grew +5 last season (starter, 15 games)" or "needs snaps to grow" when experience < 0.3.
- **Season-end inbox item** for the user's club: "Development report" listing your players ≤ 26 with `from → to` and the reason (starter / rotation / barely played).

## D4 — Probe
`__rookieProbe(seasons = 8)` (dev global, offline-safe): (a) the rookie OVR distribution by round for one draft (median, p10, p90 per round — target: R1 median 72–76, R3 64–68, R7 55–60; no rookie > 80);
(b) league average OVR of each club's starters (by `STARTERS`) per season over `seasons` seasons — must stay within ±1.5 of season 1 (talent doesn't drain or inflate); (c) the share of rookies who reach POT − 3 within
4 seasons, split by starters vs bench in their first two years (starters should get there clearly more often).
If (b) drifts, tune only the D2 fractions (not retirements, not D1).

## D5 — Scouting reads on the NFL scale (user follow-up, 2026-10-08)
User: "rookies definitely need a much lower rating; also show potential and current rating next to each other but don't give it away too much" (screenshot: Scouting "Class board · by your read" showing 96–99, 95–97 …).
- Today `readProspect` (`evaluation.ts`) returns a range around `myGrade ?? grade` on the **college** scale. Keep `grade`/`myGrade`/`trueGrade` and all the logic that uses them (sorting, the Ledger, conviction,
  department, red flags) unchanged — this is display only.
- New `readRookieRanges(career, p): { now: [lo, hi]; ceiling: [lo, hi] }` in `evaluation.ts`: map the read's centre through D1's `rookieRatings` (rank the prospect by the read centre within the class) to get an
  NFL **Now** midpoint and **Ceiling** midpoint; half-widths = `read width × 0.8` for Now and `read width × 1.4` for Ceiling (ceilings are harder to call), at least ±1 / ±2; clamp 45–97. Never reveal the exact
  `trueGrade`-based numbers unless `read.truth` is already visible (Director / ≥ 92% confidence) — then show the exact pair.
- UI: everywhere a prospect's read badge shows today (Scouting class board, prospect panel "Your Range", Draft board rows, Your selections, Combine card): replace the single college range with two small bubbles side by side,
  **NOW 64–69** and **CEIL 80–88**, each coloured by its midpoint with `gradeColor` (same colours as `OvrBadge`); tooltip explains "Rookie rating range / ceiling range — tighter as you scout him".
  The column header becomes "Now · Ceiling"; sorting by it sorts by the read centre (unchanged order).
- Drafted players (D1) land inside (or near) the shown ranges for a well-scouted prospect — verify on 10 picks in the probe.

## Acceptance
build + lint 4; `__rookieProbe(8)` inside its targets; `careerSmoke(6,'personnel')` and `(4,'coach')` 0/0; `__simTest` season-1 calibration unchanged (no sim change; rookies only enter after the first draft);
`gameDayEquivalence(20)` 20/20.

## DO NOT
- No sim changes (`playsim.ts`, `sim.ts`, `statAlloc.ts`); no rng draws added or removed in `developPlayers` (same count per player); no changes to `grade`/`trueGrade`, draft AI, gates, objectives, capabilities,
  `evaluateTrade`, contract pricing, retirements.
- Optional save fields only; canonical player objects; no new dependencies; no temp files in the repo.
- Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`, `PLAYTEST_BACKLOG.md`. No git commands.

## Verification log
