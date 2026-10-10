# Injury decisions — FUTURES #15

User (FUTURES list, 2026-10-08): play him hurt or sit him; risk of a longer injury, a performance penalty, owner pressure in a playoff push, medical staff advice.

## Already built (extend, do not duplicate)

- **Weekly injuries:** `src/game/engine/sim.ts:healPlayers` (via `simWeek`/`healAfterWeek`). Every week it ticks `p.injured.games` down, then rolls new minor injuries (`INJ_BASE 0.029`, TGH-scaled, practice `injuryMult`), with `games` 1–3 and `note` from `pickNote`. **One `rng()` draw per healthy rostered player, so the draw count depends on who is `injured`.**
- **Injury shape:** `src/game/types.ts` Player `injured?: { games; note }`. Anyone with `injured` is out: `depth.ts:depthAt` filters, `returns.ts`, `statAlloc.ts`, `playsim.ts:posRatingAvg`/fill-to-eleven (~l.310, 838, 931, 973).
- **User levers already in place:** the practice plan (`practice.ts:practiceInjuryMult`, Rest heal) and Rest bye (`bye.ts`); RB workload risk (`gameStore.ts` advanceWeek ~l.1338, G12); IR place/activate (`gameStore.ts` ~l.3280; `Roster.tsx:InjuredReserveCard`); AI fills injured starters (`waivers.ts:aiInjuryMoves`).
- **Narrative stand-in:** `dilemma.ts` template `injuryGamble` ("Play him / Sit him") uses a **made-up** player (`aPlayer(rng)`) and only moves rep/security/culture. It is retired by this feature (Phase B).
- **Owner and race:** `owner.ts:ownerPersonality` (`win-now`, `meddling`, `patient`, `cheap`), `career.jobSecurity`, `playoffs.ts:playoffPicture` (`inTheHunt`, `eliminated`, clinch markers), `voices.ts` owner lines.
- **Ratings funnel:** `src/game/data/ratings.ts:playerAttrs` feeds both `playsim.ts:mkAttrs` and `statAlloc.ts:mkAttrs`, so one hook there reaches the play-by-play and fast sims.
- **Missing:** no injury status (Q/D/Out), no medical staff (no `StaffRole` for it; `people.ts` "Strength Coach" is only a contact), no per-player play/sit choice, no aggravation, and no playing-hurt penalty.

## Design

1. **Injury report (user club, weekly).** Each injured player gets a status from the games he would still miss **for this week's game**: `Questionable` (would miss 1), `Doubtful` (would miss 2), `Out` (3+ or on IR, no choice). One helper, `gameStatus(p, world, career)`, decides this. It must give the same answer for the fast path (which heals in `simWeek` *before* the user game) and the coached path (game played *before* `advanceWeek` heals). Choice per Q/D player: **Sit** (default, today's behaviour) or **Play hurt**.
2. **Playing hurt.** For the user's game only, the player counts as available and carries `hurt = { status, note, penalty }`. `playerAttrs` scales his physical ratings (SPD, ACC, AGI, STR, JMP, plus his position's key such as THP/CAR/RBK) by `1 − penalty`. The penalty is Q 4%, D 8%, ±1 point by medical grade. Hurt QBs and RBs also take −5% THP or CAR. Nothing else changes, and there are no new `rng()` draws.
3. **Aggravation (longer injury).** After the user game, a deterministic `hash32(p.id, season, week, 'aggr')` roll with chance Q 12% / D 25% × TGH mult (the same formula as `healPlayers`) × medical mult (A 0.8 · B 0.9 · C 1.0 · D 1.25). On a hit, `injured.games += 2–6` from the hash. A Doubtful player also has a 1-in-6 chance that the injury becomes season-ending (`games = 99`, note "… (aggravated)"). Otherwise `injured` comes back unchanged and heals on the normal clock.
4. **Medical staff advice.** `medicalGrade(world, teamId)` gives A–D, deterministic from `hash32(teamId)` with a `cheap` owner one grade lower. Rest weeks and a Rest bye do not change it. The staff's advice line ("Cleared with a brace — 1 in 9 re-injury risk", "We advise against it") shows the true risk for A/B. C/D grades round it into coarse words, with the wording chosen by hash. This exposes `medicalGrade` as a seam so FUTURES #28 can later make it a hireable Head Trainer. No new `StaffRole` in v1.
5. **Owner pressure in a playoff push.** "Push" means week ≥ 12, the user club is `inTheHunt` and has not clinched. In a push, sitting a Q starter whose OVR ranks in the club's top 22 costs `jobSecurity` −1 (−2 for a `win-now` or `meddling` owner), with an owner voice line. A `patient` owner pays a +1 leadership rep when you sit him. Aggravating a starter: player morale −8 and culture −1. Playing hurt and winning: security +1. Total security from injury calls is capped at ±3 per week. These rules are tunable in the module's constants.
6. **AI clubs never play hurt in v1** (league injuries, depth and calibration are unchanged). A later AI option sits behind a flag that defaults off.

## Engine hooks

- **New module `src/game/engine/injuryCalls.ts`:** the types; `gameStatus`, `medicalGrade`, `aggravationRisk`, `hurtPenalty`, `medicalAdvice`, `inPlayoffPush`, `ownerPressure`; `activatePlayHurt(world, career)`, which clears `injured` into `p.hurtSaved` and sets `p.hurt` for chosen players; `restorePlayHurt(world, career, won)`, which puts `injured` back, runs aggravation, returns log/inbox lines and pressure deltas, and clears `hurt`/`hurtSaved`. Pure, with no rng.
- **`types.ts`:** optional `Player.hurt?`, `Player.hurtSaved?`, `CareerState.injuryCalls?: Record<playerId, 'play'>` (cleared each week). Old saves stay valid.
- **`ratings.ts:playerAttrs`:** apply `hurt.penalty` when present, as one small block after the devRatings fold.
- **Store `gameStore.ts`:**
  - Add the action `setInjuryCall(playerId, 'play' | 'sit')`.
  - Fast path: `activatePlayHurt` right before `simulatePlayByPlay` (~l.1290), which runs after `simWeek` has healed. `restorePlayHurt` goes after the user-game post-processing (`recordGameStats`, `growPlaybookFromGame`).
  - Coached path: `activatePlayHurt` in the game-day start before `createGame` (~l.1573) and before the rebuild `createGame` (~l.1522). `restorePlayHurt` goes at the very top of `advanceWeek` when `opts.userSim` is set, **before `simWeek`/`healAfterWeek`**, so `healPlayers` sees the same `injured` set and the rng draw count holds.
  - Apply the deltas through the existing `jobSecurity`/rep/culture/`logMoment` paths, plus an `Injury` inbox item.

## UI touchpoints (redesigned screens; build on `ui-redesign`, using the kit from `src/ui/kit.tsx`)

- **New `src/components/InjuryReport.tsx`:**
  - A `Card` + `SectionTitle` "Injury report" with one row per injured player: `Avatar`, name/pos, a `Badge` (Q warn / D loss / OUT loss) with the note and games, and the medical grade `Chip` plus the advice line.
  - A `SegmentedControl` Sit / Play hurt, disabled for Out. Choosing Play hurt on a Doubtful player opens a `ConfirmSheet` whose `Consequence` list shows the risk, penalty and owner pressure.
  - On phone (`usePhone`) the rows stack, with 44px controls and a 12px text floor.
- **Mounts:**
  - `GamePlanScreen.tsx`: the report card above the plan sheet.
  - `Dashboard.tsx`: a one-line "2 questionable — decide on Game Plan" when calls are pending.
  - `DepthChart.tsx`: the OUT badge becomes "Q · playing" when chosen.
  - `PlayerProfile.tsx`: the status badge.
- **Recap:** the aggravation or "played through it" line arrives via `logMoment`/inbox. MatchView needs no change.

## Calibration impact

The default is Sit for everyone and AI clubs never play hurt, so league stats, injury rates and every NFL band are **byte-identical** to the base. Play hurt affects one club-game and adds no rng draws. Aggravation is hash-based and applied outside `healPlayers`, following the same precedent as the G12 RB workload injury. The bands stay green because nothing league-wide moves; the equivalence probe stays n/n because both paths activate and restore at matching points.

## Phases (DeepSeek jobs, non-overlapping files)

| Job | Files (only these) | Base |
|---|---|---|
| **A engine** | new `src/game/engine/injuryCalls.ts`, new `src/game/engine/injuryProbe.ts`, `src/game/types.ts` (optional fields), `src/game/data/ratings.ts` (penalty block) | main |
| **B wiring** | `src/store/gameStore.ts`, `src/main.tsx` (register `__injuryCallProbe`), `src/game/engine/dilemma.ts` (drop `injuryGamble` from the pool; keep the selection hash so other cards keep their weeks) | A merged |
| **C UI** | new `src/components/InjuryReport.tsx`, `src/screens/GamePlanScreen.tsx`, `src/screens/Dashboard.tsx`, `src/screens/DepthChart.tsx`, `src/components/PlayerProfile.tsx` | A merged, on ui-redesign; reads the store action by its agreed name `setInjuryCall` / `career.injuryCalls` |

B and C run in parallel worktrees (`ds-wt`) after A. They merge B then C, and the orchestrator re-verifies on main.

## Acceptance

- `npm run build` passes; `npm run lint` shows **exactly 4** warnings.
- Real-data 33333/2222/5150 ×500 `--eq --smoke=coach:4,personnel:4` (`~/gridiron-work/calib.mjs`):
  - Outcomes are **identical** to the base commit's recorded numbers with defaults, and the 31 NFL bands are unchanged.
  - eq 20/20, smokes 0/0, animation end spots 100%.
- `__injuryCallProbe(n)` (forced trials, default grade C):
  - Aggravation rate: Q 10–14%, D 22–28%, and it falls as TGH rises.
  - Grade A < D risk.
  - The penalty applies only while `hurt` is set.
  - No player has `hurt`/`hurtSaved` after `advanceWeek`, on both paths.
  - The `healPlayers` draw count and the next-week world hash match a Sit run.
  - `gameStatus` agrees on the fast and coached paths.
  - Owner pressure fires only in a push and stays within the cap.
  - An old save without the fields loads.
- Orchestrator browser check: the Game Plan injury report, Doubtful confirm sheet, Dashboard nudge and depth badge at desktop and 375px, light and dark. Coach one CLE game with a Q starter playing hurt.

## Risks

- **Heal ordering asymmetry** (fast heals before the user game, coached after). If `gameStatus` is wrong, a "1 game" player shows Questionable when he would be healthy anyway. Probe both paths.
- **A missed restore leaves a player permanently healthy.** Restore must also run on an abandoned or forfeited game day and on save/reload mid-game, so `restorePlayHurt` is idempotent and is also called from load-normalisation.
- `playerAttrs` is also used by UI rating displays, so ratings show penalised only while the game is active. That is acceptable but must not leak into `ovr` or contracts.
- `gameStore.ts` and `playsim.ts` are hot files (V1, B2, anim jobs). B keeps store edits to small hooks; `playsim.ts` is not touched.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| A engine | ⏳ |
| B wiring | ⏳ |
| C UI | ⏳ |
