# NEXT PHASE — L12.9 "No busywork; a coach's résumé; culture that counts" (user playtest, 2026-10-08)

_Planned by Claude Opus 5.5. Implemented by DeepSeek Flash 4.1. Lint baseline: exactly 4 warnings._

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| H1 | Remove the weekly-hours "This Week" card; its effects become passive or move to where they belong | P1 | ✅ done — verified (P1) |
| L1 | Ledger for the coaching track: coaching calls dated and graded; "Success Rate" | P1 | ✅ done — verified (P1) |
| K1 | Unit cohesion in the sim: a newer unit commits slightly more penalties/fumbles (relative to league mean) | P2 (after L12 P5) | not started |
| K2 | Culture discount on contracts + FA interest | — | **blocked: needs the user's OK (contract pricing)** |

## H1 — Remove the hours system (user: "I don't like this part of the game" → chose "Remove it")
Today: `weeklyActions(career)` (`src/game/engine/weekly.ts`) lists 8–10 actions costing hours from `WEEK_HOURS` (40); `spendHours(id)` in the store applies: film/road +1 Evaluation skill, phones = a prospect's
character read, crosscheck/scouts +1 Profile (scouts also reveals a scout's bias), drills = +1 room rep, install +1 Scheme skill, tendencies = this week's opponent read (`career.oppRead`, 2nd buy sharp),
agent +1 Roster rep, owner +2 job security. The card lives in `src/components/CareerRhythm.tsx` ("This Week").
- **Remove** the hours card, `spendHours`, the hours badge and every "hours" mention in the UI. Keep `hoursLeft`/`weekActionCounts` fields readable in old saves (ignored).
- **Keep progression pacing identical.** First measure, with the current code, what the probes' hours policy yields per week on average for each rung (`careerSmoke` / `balanceProbe` — see how they call `spendHours`)
  and record the personnel → GM / coach → HC pacing on seeds 20261004, 2222, 33333, 5150, 777 (`balanceProbe(10, path)`). Then replace the spending with **passive weekly gains** of the same average size, applied
  in `advanceWeek` for the rungs that had the action (fractional amounts accumulate in an optional `career.passiveBank?: Record<string, number>` and pay out whole points). Re-run the pacing probe: every seed within ±1 season of before.
- Actions that were *choices* move to where they belong, free:
  - **Opponent film** → Game Plan screen "Study {opponent}" button (free, once a week gives the read; a second click the same week gives the sharp read) — same `career.oppRead` effect as today.
  - **Work the phones** (character read) → a "Character read" button on the prospect panel in Scouting, max 2 per week (`weekFlags`), same reveal logic.
  - **Scouts meeting** bias reveal → passive: one scout's bias revealed every 4 weeks for rungs that had it.
  - **Run drills** → the room banks 1 rep per week automatically (rungs with `developRoom`).
- `careerSmoke` must stop calling `spendHours` and still exercise the moved actions; 0 errors / 0 violations.

## L1 — Ledger for coaches (+ "Success Rate", already renamed)
- New ledger entry kinds for the coaching track (append to the existing ledger, graded like other calls, shown in "All calls" with a filter chip "Coaching"):
  `fourth` (your 4th-down call: graded by the outcome vs the EP model's recommendation — hit if the EP choice agreed or the play converted), `two` (2-pt try), `playCall` (per game: won/lost/push count from the
  call matrix — one entry per game, hit if won ≥ lost), `keys` (W2 grades: hit when both keys hit, miss when none), `film` (game film grade ≥ B = hit, ≤ D = miss), `pitch` (an accepted starter pitch: graded at
  season end by the player's snaps/production).
- The Ledger header adapts by track: coaching shows "Calls this season / Success rate / Best call / Worst call"; personnel keeps today's. Empty state explains what will appear for the current role.
- Cap: at most ~6 entries per game so the list stays readable; group by week.

## K1 — Cohesion in the sim (P2, only after L12 P5 is merged)
- `teamCohesion(roster, staffTenure, teamId).avg` (0–1) per side. In `playsim.ts` add a relative term vs the league mean cohesion (compute the mean once per game from all clubs, or a constant measured offline):
  pre-snap penalty chance × (1 + (mean − cohesion) × 0.6) and fumble chance × (1 + (mean − cohesion) × 0.4), clamped ±25%. No new rng draws (thresholds only). AI clubs too.
- Re-run calibration (3 seeds, 500 games): inside the L12 E3 bands. Equivalence 20/20.
- Fix the Culture card text so every line describes a real effect.

## DO NOT
- No changes to gates, objectives, capabilities, `evaluateTrade`, contract pricing (K2 is blocked), draft AI. No rng draws added or removed. Optional save fields only. Canonical player objects. No new deps. No temp files in the repo.
- Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`, `PLAYTEST_BACKLOG.md`. No git commands.

## Verification log
- **P1** (Flash 12 min, ran out of steps with Ledger.tsx mid-edit; Claude finished the list: All/Coaching filter, role-aware empty state, pos/college only when present). Passive gains: 1 point per former action every 6 weeks (`career.passiveBank`), scout bias every 4 weeks, drills +1 rep/week; Study opponent on Game Plan; Character read free 2/week. Note: `balanceProbe` never used hours, so pacing is unchanged by construction (personnel→GM 9/7/7/7, coach→HC 10 on the tested seeds); real careers lose the old repeatable hour spends (owner +2 job security etc.). Coach Ledger: 4th-down/2-pt/play-call/keys/film/pitch entries (≤6 per game), graded. Equivalence 20/20, smokes 0/0. Browser: no hours card; after 2 weeks the Ledger shows 4th-down calls vs staff EV and film grades.
