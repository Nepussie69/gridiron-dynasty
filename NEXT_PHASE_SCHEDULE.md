# NFL-style schedule (backlog 227)

Requested 2026-10-11. Today `buildSchedule` (`src/game/engine/generate.ts:516`) pairs the 32 clubs at random every week, so a club can play the same opponent back-to-back or three times in a season and division games aren't guaranteed. Replace it with the NFL formula.

## Design

Each club plays 17 games across 18 weeks, with one bye:

| Games | Opponents |
|---|---|
| 6 | Division rivals, home and away |
| 4 | Every club in one other division of the same conference (rotates over 3 seasons) |
| 4 | Every club in one division of the other conference (rotates over 4 seasons) |
| 2 | Same-finish clubs from the two same-conference divisions not played above |
| 1 | 17th game: a same-finish club from a cross-conference division not played above (rotates) |

- **Home/away:** 8 or 9 home games per club. The 17th game's host alternates by conference each season.
- **Same-finish games:** they use last season's division finish. Record `world.divisionFinish: Record<teamId, 1|2|3|4>` at every place that resets standings for a new season, before the reset: `balance.ts resetSeason`, `gameStore.ts` ~1851, `gameStore.ts` ~7150 and any others found. The first season (and old saves without the field) falls back to prestige order within the division.
- **Rotation key:** `world.season`, so the matchups are a pure function of season plus finishes.
- **Week assignment:**
  - Deterministic from `makeRng(world.seed + world.season * 8161)` (same seed as today).
  - Byes fall in weeks 5–14, at most 6 clubs per week.
  - Each club plays at most once per week and every non-bye week.
  - No club meets the same opponent in consecutive weeks.
  - The two division meetings are at least 3 weeks apart.
  - At least one round of division games falls in weeks 15–18.
  - Repair or retry until valid. Must finish in under 50 ms.
- **Game shape:** keep `Game.id` = `g_${week}_${home}_${away}` and every field it has today. `tier` is unchanged.
- **World generation must not change anything else:** `generateWorld` currently draws the schedule from the main world `rng`. Keep the main rng stream identical: call the old random builder and discard its result, or draw the same count. Only `world.schedule` may differ; rosters, staff, dead money and free agents must be byte-identical to main for the same seed.
- **Primetime:** `assignSlots` still runs after the build, and `MAX_PRIMETIME` and slot rules still hold. Flex is unchanged.
- **Old saves:**
  - A save mid-season keeps its current schedule.
  - The new formula applies from the next `regenerateSchedule`.
  - A missing `divisionFinish` falls back to prestige order.

## Calibration impact

Pairings change, so calibration is **not** byte-identical. Gate: all bands pass on the 3 seeds and eq stays 20/20. Report league-wide deltas against `~/gridiron-work/logs/main-after-c1p1-calib.out`.

Expected shifts are small. Division games are closer to even, so watch the competitive-balance and win-spread bands. If a band fails, do not retune the sim; report it.

## Phases

| Phase | Files | Deliverable |
|---|---|---|
| S1 `nfl-schedule` | `generate.ts` (new `buildNflSchedule` or a `schedule.ts` module), `balance.ts`, `gameStore.ts` (finish capture + migration), `types.ts` (World field) | Formula, week assignment, finishes, probe |
| S2 (later, optional) | `Schedule.tsx` | "Division" tag on division games; opponent-group legend |

## Acceptance (probe `~/gridiron-work/logs/schedule-s1-probe.mjs`)

- Covers 3 seeds × 4 consecutive seasons (rotation).
- For every club:
  - 17 games, 1 bye in weeks 5–14, 8–9 home games.
  - Exactly 6 division games, home and away vs each rival.
  - 4+4 rotation division games as specified; 3 same-finish games.
  - No duplicate opponent other than division rivals.
  - No back-to-back repeat; division meetings ≥ 3 weeks apart.
- Every week: each non-bye club plays exactly once.
- Determinism: the same seed and season give an identical schedule.
- World generation: everything except `schedule` is byte-identical to main for 3 seeds.
- Primetime probe still passes: one game per slot per week, no Thursday game in week 18, no club over 5.
- An old save loads and advances a season.
- Build passes, lint exactly 4.
- Calibration gate as above.

## Progress

| Phase | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| S1 nfl-schedule | ✅ 2026-10-11 merged (probe 8/8, 1200-case stress 0 failures, calibration unchanged — harness pairs its own games; random-slate fallback added by orchestrator) |
| S2 schedule-ui | ⏳ |
