# Special-teams calls — FUTURES #4

User (FUTURES list, 2026-10-07; launched 2026-10-10): onside kick, fake punt/FG, return strategy; fakes get scouted (tendency memory).

## Already built (R17, unmerged realism chain — base for this work)

- AI situational onside kicks in `resolveKickoff` (trailing ≤10 late in Q4, `R17.onsideRate`/`onsideRecover`).
- AI fakes from 4th & short in plus territory, and the user's **Fake punt / Fake FG** option in the 4th-down moment.

Do not re-implement these; extend them.

## Build

1. **User kickoff call.** When the user's club kicks off, offer a kickoff moment through the existing `decide()` moment system, at the same situations other moments ask (late/close games always, otherwise respect the user's existing moment/auto settings): **Deep kick** (default), **Squib**, **Onside**, and **Surprise onside** (only when *not* in an obvious onside situation). Outcomes per-play hash (`h01`), no rng draws:
   - Expected onside: recovery ~10–15% (R17 rate), receiving club gets good field position when it fails.
   - Surprise onside: higher recovery (~45–55%) but a failed one gives the opponent the ball near midfield; recovery is cut if the opponent has scouted you (see 4).
   - Squib: no touchback, short return, receiving club starts ~own 30–35 on average.
   - Kicker KAC/KPW and the kicking club's coverage nudge the rates within those bands.
2. **Return strategy on the game plan sheet.** Per club, separate kickoff and punt return strategy: **Take touchbacks / fair catch (safe)**, **Default**, **Aggressive** (returner brings it out more, longer average but more variance and higher fumble share). Bounded, football-plausible effects in the existing return resolver (`returnYards`/touchback decision). AI clubs use Default. **With every club on Default, outcomes must equal the pre-feature baseline exactly.**
3. **Kick strategy on the game plan sheet.** Kickoff: **Touchback (default)** / **Directional/pooch** (fewer touchbacks, lower avg return). Punt: **Default** / **Directional** (fewer returns, slightly shorter net). Default = baseline.
4. **Tendency memory.** Record per-club special-teams surprises (fakes, onsides, surprise onsides) by season in the world (optional save field; old saves valid). Opponents who have seen a club try them recently are "alert": fake success and surprise-onside recovery drop in a bounded way. Surface it: the pregame/analytics opponent scouting (FUTURES #19) shows the opponent's ST tendencies ("2 fakes this season — alert"), and the user's own report warns when they have become predictable. AI clubs' fake/onside choices consult the memory too.
5. **UI.** Game-plan sheet gets a compact Special Teams section (kick strategy, KR strategy, PR strategy with one-line hints). The kickoff moment uses the existing moment card. Desktop and 375px, light/dark, reuse existing kit components.

## Constraints

- Base: realism snapshot `1cbd4dd` (contains R17). Two other workers are editing `playsim.ts` (realism calibration; kickoff restart in `restartAfterFieldGoal`/`stepClock`/`stepHalftime`). Put new logic in a new module (e.g. `src/game/engine/specialCalls.ts`) and keep `playsim.ts` edits to small hooks so they merge cleanly.
- No rng draws added/removed; per-play hashes only. Preserve R15–R18 features, user packages, shared actual11, injuries/rotation.
- No sim retuning beyond the bounded effects above; defaults reproduce baseline.

## Acceptance

- Build, lint exactly 4.
- Real-data 33333/2222/5150 ×500 `--eq --smoke=coach:4,personnel:4`: with defaults, outcomes identical to the `1cbd4dd` baseline (22.2/21.9/22.3); eq 20/20; smokes 0/0; animation end spots 100%.
- Probes: each kickoff call's recovery/start-spot distribution over many forced trials; each return/kick strategy shifts touchback %, return avg and fumble share in the stated direction and within bounds; tendency memory records attempts, persists across save/reload, lowers fake/surprise success when alert, appears in the scouting text; old save without the fields loads.
- Orchestrator browser check: game-plan Special Teams section and the kickoff moment, desktop/375px, light/dark.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-10 |
| Implementation (wt-stcalls from 1cbd4dd) | ⏳ |
