# Primetime & rivalry stakes: FUTURES #8

User (FUTURES list, 2026-10-07): Thursday, Sunday and Monday night games and rivalry games swing reputation, owner trust and morale more. Players get a clutch rating that matters late in close games. Primetime slots appear on the schedule.

## Goal

Some weeks should feel bigger than others. A few games each season are national-TV games, and some are against a rival. Their results move the career needle (profile, job security, squad morale) more than a normal Sunday does, within caps. On the field, a per-player **clutch** rating nudges execution only in late-and-close snaps. With clutch off, the sim is unchanged.

## Already built (extend, do not duplicate)

- **Rivalry games (L9 Z5)**: `src/game/engine/rivalry.ts` has `rivalFor(world, teamId)` and `isRivalryGame(world, career, oppId)`, where a rival is an NPC peer (`Rival` in `types.ts:944`) who now works for that club. The post-game hook is in `gameStore.ts` `advanceWeek` (~l.1419–1442): a win gives `reputation.profile` +1 (at most 2 per season, tracked by `CareerState.rivalWins`) and a moment is logged. Keep this as it is and stack the new swing on top.
- **Division rival**: `ambitions.ts` `divisionRival()` (private) is a hash-picked division opponent used by the `beatRival` ambition. Export it; do not write a second picker.
- **Coach "clutch"**: `playsim.ts` `clutchFor(world, offId, down, yard)` returns the HC/coordinator `situational` edge on money downs and in the red zone. It is passed as the `clutch` arg into `resolvePass` (comp +0.012/unit, INT ×(1−0.03/unit)) and `resolveRun` (edge +1.4/unit). Call sites are at ~l.3389/3390 (2-pt) and ~l.3705/3706 (scrimmage). This is coaching, not players, and it stays.
- **Traits**: `generate.ts` `TRAITS.K` already includes `'Clutch'`. In `style.ts:76`, a trait containing "clutch" gives +0.2 to `contested`. Neither is a rating.
- **Late-game context in the sim**: `GameState` has `qtr`, `clock`, `homeScore`/`awayScore`. `SimEnv.qtr/clock` reaches the resolvers, and `resolveSpecial(..., margin)` already receives the score margin. The moment system (`MomentKind` 'twoMinute', 'fourth', …) is already wired.
- **Schedule**: `generate.ts` `buildSchedule(rng, …)` makes random weekly pairings with byes. `Game` (`generate.ts:28`) has no slot or kickoff field. **Do not add rng draws to schedule or player generation**, because that would reshuffle every seed.
- **Owner/morale levers**: `CareerState.jobSecurity` (season review in `balance.ts` ~l.265, weekly `accrue('owner')` in `gameStore.ts` ~l.785). `Player.morale` (1–100). `lockerRoom.ts` `avgMorale`/`lockerEffort` turn morale into on-field effort only when the user's locker-room toggle is on.
- **Not built**: primetime slots, stakes multipliers, a player clutch rating, late-and-close tracking, and any UI for these.

## Design

1. **Slots.** `Game.slot?: 'TNF' | 'SNF' | 'MNF'`. Each regular-season week gets one game in each slot (no TNF in week 18). A slot goes to the highest "draw" game: the sum of both clubs' preseason `teamStrength`, plus a bonus for a division or rival-coach meeting, with a `hash32(seed, season, week)` tiebreak. No club gets more than 5 primetime games per season. **Flex**: from week 11 on, when a week rolls over, the SNF game two weeks out is re-picked from current records. Everything is hash-based. Old saves are backfilled on load (`ensureSlots`) for unplayed weeks only. UI labels say "Thursday Night", "Sunday Night", "Monday Night" (no network branding).
2. **Stakes.** `stakesFor(world, career, game)` returns `{ slot?, rivalry: 'coach' | 'division' | 'both' | null, mult }`. `mult` is 1.0 for a normal game, 1.5 for primetime, 1.5 for a rivalry and 2.0 when both apply.
3. **Swing (user club only).** After a stakes game, `primetimeSwing(result, margin, stakes)` returns small deltas scaled by `mult`:
   - Win: `profile` +1, `jobSecurity` +1, squad morale +2.
   - Loss: `jobSecurity` −1, morale −1. A loss by 17+ points: −2 / −3.
   - A 1–3 point thriller adds `profile` +1 either way, because the national audience saw it.

   Season caps live in a new optional `CareerState.stakes?: { season, profile, security }`: profile +4, security ±6. This keeps the `balance.ts` review in charge. The rivalry +1 from L9 Z5 still applies. The owner's reaction goes to the inbox through the existing `pushCareerNews`. AI clubs get no swing, so standings and sim are untouched.
4. **Clutch rating.** `clutchOf(p)` is 1–99 and is pure. It is built from `hash32(p.id)` (spread centred on 50), plus +12 for the `'Clutch'` trait, plus `AWR` (from `attrs`) above or below the position mean ×0.15, plus `p.clutchAdj ?? 0` (new optional `Player.clutchAdj`, ±15). It is not stored and uses no rng. Each season, `clutchAdj` drifts ±1–3 from the player's late-and-close results (QB comp%/INT, K FG%, skill-player catches/fumbles in those snaps), computed from the existing play logs.
5. **Late and close.** Q4 with ≤5:00 left, or OT, and a margin of ≤8. Edge = offence key-player clutch (QB on passes or the carrier on runs, weight 0.6; primary target 0.4) minus the defence's top-3 clutch, all relative to the **league mean** (`ratingMeans`-style cache). Scaled ×0.02 and clamped to ±0.6 "clutch units", then added to the existing `clutch` arg. FGs in late-and-close use the kicker's clutch to move make probability by up to ±3 points via the existing `margin` path. Primetime itself does **not** change on-field play.
6. **Toggle.** `setClutch(on)` follows the `setStamina` pattern, default on. With it off, play-by-play is identical to the pre-feature build.

## Engine hooks

- New `src/game/engine/primetime.ts`: `assignSlots(world)`, `ensureSlots(world)`, `flexSlots(world, week)`, `slotOf(game)`, `rivalryKind(world, career, oppId)`, `stakesFor`, `primetimeSwing`.
- New `src/game/engine/clutch.ts`: `clutchOf`, `isLateClose(s)`, `clutchEdge(world, s, offId, defId, kind)`, `kickClutch`, `setClutch/getClutch`, `seasonClutchAdjust(world)`.
- `generate.ts`: `Game.slot?`. Call `assignSlots` after `buildSchedule` in world creation and in the new-season rebuild (~l.864). Export `divisionRival` from `ambitions.ts`.
- `playsim.ts` (small hooks only): add `+ clutchEdge(...)` at the two resolver call-site pairs, and a kicker term in `resolveSpecial`'s FG branch. Add no new rng draws.
- `gameStore.ts` `advanceWeek`: apply the swing next to the L9 Z5 rivalry block, call `flexSlots` at week rollover, call `ensureSlots` on load, and call `seasonClutchAdjust` at season rollover. `types.ts`: `Player.clutchAdj?` and `CareerState.stakes?`.

## UI touchpoints (redesigned screens, `src/ui` kit, ui-redesign branch)

- **Schedule.tsx**: a slot `Badge` ("Sunday Night") and a "Rivalry" `Badge` on each week row. The up-next row shows the stakes line.
- **Dashboard / CareerHub** next-game card: a stakes `Chip` (for example "Monday Night · rival coach Vance"). Tapping it opens a short `Sheet` that explains the swing and the caps used so far this season.
- **GamePlanScreen**: one stakes line in the header. **PlayerProfile / PlayerCard**: a `RatingTile` "Clutch" with a late-and-close line ("4/5 FG, 2 GW drives"). **Roster** gets an optional sortable column.
- **MatchView**: a slot label in the header or scorebug only. Wait until broadcast B2 (`src/components/broadcast/`) is wired, and do not touch that folder.
- Every surface must work on desktop and at 375px (44px taps, 12px floor), in light and dark.

## Calibration impact

Slots use no rng and the swing is career-only, so they have zero sim impact. Clutch is zero-mean against the league mean, touches about 6–8% of snaps, and is clamped, so expect points to move less than ±0.1. Gates:
- `setClutch(false)` must give outputs **identical** to the pre-feature main.
- With clutch on, 3 seeds × 500 must stay within ±0.2 of main's recorded baseline, with every NFL band no worse than main.

## Phases (DeepSeek jobs, non-overlapping files)

| Job | Base | Files | Content |
|---|---|---|---|
| P1 `prime-eng` | main | `primetime.ts` (new), `generate.ts`, `ambitions.ts`, `gameStore.ts` | Slots, flex, backfill, stakes, swing + caps, inbox note, probe script |
| P2 `clutch-eng` (parallel) | main | `clutch.ts` (new), `playsim.ts`, `types.ts`, `ratingMeans.ts` | Rating, late-and-close edge, kicker term, toggle, probe |
| P3 `clutch-season` | main after P1+P2 | `clutch.ts`, `gameStore.ts` (rollover line only) | Season `clutchAdj` drift from play logs, late-and-close tallies selector |
| P4 `prime-ui` | ui-redesign after V1 + main merge | `Schedule.tsx`, `Dashboard.tsx`, `CareerHub.tsx`, `GamePlanScreen.tsx` | Badges, stakes chip and sheet |
| P5 `clutch-ui` (parallel to P4) | same | `PlayerProfile.tsx`, `PlayerCard.tsx`, `Roster.tsx` | Clutch tile, late-and-close line, column. MatchView label only after B2 merges |

## Acceptance

- `npm run build` passes and `npm run lint` shows **exactly 4** warnings.
- Calibration uses `~/gridiron-work/calib.mjs` with real data, seeds 33333/2222/5150 ×500, `--eq --smoke=coach:4,personnel:4`. Clutch off gives results identical to the main baseline. Clutch on stays within ±0.2 points with no band worse. eq 20/20, smokes 0/0, animation end spots 100% (`anim.mjs`).
- Probes (P1/P2):
  - Every regular-season week has exactly one game per slot (none for TNF in week 18) and no club has more than 5 primetime games.
  - Re-running `assignSlots` gives identical slots, and schedule pairings are byte-identical to pre-feature.
  - An old save without the new fields loads and gets backfilled.
  - Swing deltas match the table and the season caps hold over a forced 17-game run. The L9 Z5 rival +1 still fires once per win, up to 2.
  - The clutch distribution has mean ≈ 50 and SD 10–14, and `'Clutch'`-trait kickers average higher.
  - Over 2,000 forced late-and-close snaps, high-clutch vs low-clutch QB comp% differs by 1–3 points and INT% moves the other way. Outside late-and-close the edge is always 0.
- Orchestrator browser check (P4/P5): Schedule, next-game card, stakes sheet, player clutch tile. Desktop and 375px, light and dark, no console errors.

## Risks

- **`playsim.ts` merge pressure** from realism and broadcast work. Keep P2 to the call-site additions plus one FG term, with all logic in `clutch.ts`.
- **Double counting.** The coach `clutchFor` and player clutch both feed one arg. The clamp and league-mean centring keep the sum bounded. Add a probe for the sum.
- **Reputation inflation.** The swing could swamp the season review. The caps and the career-only scope handle this. Watch the `profile` distribution over a 10-season smoke.
- **Hidden-rating creep.** Clutch is shown as a read (tile plus results), not as a lever the user can trade on. It never feeds OVR, value or contracts in this phase.
- **Branding.** Use generic night names in UI and news; do not use network or league trademarks.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| P1 prime-eng | ⏳ |
| P2 clutch-eng | ⏳ |
| P3 clutch-season | ⏳ |
| P4 prime-ui | ⏳ |
| P5 clutch-ui | ⏳ |
