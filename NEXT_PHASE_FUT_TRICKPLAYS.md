# Trick plays — FUTURES #24

User (FUTURES list, 2026-10-08): flea flicker, reverse, halfback pass and fake spike as calls with surprise value. Opponents scout them (tendency memory, like the special-teams fakes from #4). Feeds coach playcalling (#26) later.

## Goal

Four limited-use calls that are worth most when the defense isn't expecting them. Each one has a real payoff, a real failure mode and a scouting cost: if you use it, the league remembers. They come with a staff read so the user knows when the look is right. The AI uses them at NFL rates and the 31 NFL bands still hold.

## What already exists (audit 2026-10-11, main 645645a; redesign on branch `ui-redesign` d1e17c5)

- **There is no trick-play code.** Grepping for flea/reverse/halfback/spike in `src/` finds nothing. There is no real spike either: two-minute (`playsim.ts:checkTwoMinute`) offers hurry/normal/protect/FG only, so a fake spike needs a real spike to imitate (T1).
- **Surprise and scouting machinery to reuse, not copy:** `engine/specialCalls.ts` holds `STMemory`/`STTeamRecord`, `alertness`, `stRecordText`, `alertFakeEdge`. `world.stMemory` is an optional save field (`generate.ts`, reset each season). `Play.stAttempt` records attempts, `gameStore.ts:recordSpecialAttempts` folds the user's game in, and `chooseFourth` cuts the AI fake rate by `(1 − 0.5·alert)` with an `h01` hash and no rng draw.
- **Call path:** in `playsim.ts:step()`, `callTriggered` sends a `'call'` moment via `decide()` with `callCards()` (PLAYBOOK). The answer goes through `conceptFromPlaybook`, then `callEffect(offClass, aiDef)` from the `decisions.ts` CALL_MATRIX (edges ±3), then `resolvePass`/`resolveRun`. Standing orders come from `ctx.script` or `pickConcept`. `CallEffect = {edge, sackMult}`.
- **Data/animation:** `data/playbookData.ts` (PLAYBOOK, `SCHEME_MENUS` drive the AI concept pick, so they must not change; Jet Sweep already exists as a normal run). `components/playAnim.ts` draws any play from `playbookPlay(concept).assignments`.
- **UI:** `MatchView.tsx:MomentCard` → `CallPicker` (formation tabs) and `QuickCallBar`. `GamePlanScreen.tsx:SpecialTeamsCard` shows a "Predictable" badge and `oppSt` scouting text. The redesigned versions (kit `Card/OptionGroup/OptionCard/SegmentedControl/Badge/VerdictChip`) live on `ui-redesign` (D5 MatchView, D6 GamePlan).
- Backlog/ideas: IDEAS_ROUND2 #8 ("limited-use, work best when rare; using one makes the next easier to read"), ROADMAP "Later". No PLAYTEST_BACKLOG row yet, so add one when this launches.

## Design

| Call | Resolves as | Eligible | Best vs / worst vs | Failure mode |
|---|---|---|---|---|
| **Flea flicker** | handoff, RB pitches back, QB deep shot (depth ~24) | any down, not inside opp 10 | stack, blitz / twoHigh, zone | longer hold → `sackMult` 1.4; exchange fumble ~2% |
| **Reverse** | handoff to RB, RB hands to WR going the other way (outside run, WR carrier) | not 3rd/4th & 7+ | blitz, man, a fast-pursuing D / zone, stack | big loss share up; exchange fumble ~2.5% |
| **Halfback pass** | toss to RB, RB throws (passer = RB, uses RB `THP`/`TAS`, fallback 45) | RB on field, not 3rd & 10+ | stack (run look) / twoHigh | INT ×1.8 with a weak arm, then a throwaway/sack |
| **Fake spike** | QB fakes the spike, quick fade/slant | Q2/Q4 ≤ 1:00, clock running, user offense in hurry | defense relaxed for the spike / alert defense | almost none tactically; burns the surprise for the season |

Plus a **real Spike** (user only, same window): stops the clock, costs a down, ~3 s, counts as an incomplete pass attempt (NFL convention). A spike earlier in the half makes a fake spike more believable (+0.15 fit).

**Surprise model** (pure arithmetic in a new `engine/trickPlays.ts`, no rng):
`surprise = fit(situation, defCall) × (1 − alert) × gameDecay × (1 − 0.2·recog)`
- `fit` 0–1 comes from down/distance/field plus the D call multipliers in the table (×1.3 good look, ×0.5 bad look).
- `alert` = scouting memory (below).
- `gameDecay` = 0.6 for the 2nd trick in a game and 0.3 for the same trick twice.
- `recog` = the existing `recognition(dl, lbs, saf)` relative.
- Effect: `edge = −3 + 9·surprise` (range −3…+6), added to the normal `callEffect`. Kind-specific `sackMult`/INT/fumble mods apply when surprise < 0.4.
- Exchange fumbles use `h01(\`${n}:trick:${kind}:fum\`)` with the existing `fumbleRecovery`.
- An installed trick (game-plan package, below) gets +1 edge. A trick that isn't installed can't be called.

**Tendency memory (extends #4, no new store):**
- `STTeamRecord` gets an optional `tricks?: Partial<Record<TrickKind, number>>`. Old saves stay valid.
- `alertness()` (ST) is left **unchanged**, so ST outcomes don't move.
- New `trickAlert(rec, kind) = clamp(0.45·same + 0.15·otherTricks + 0.1·fakes, 0, 1)` and `trickRecordText(rec)` ("1 flea flicker · 1 reverse — alert").
- `Play.trick?: TrickKind` is set on every trick snap, and `recordSpecialAttempts` also folds `p.trick`.
- In the game, `GameState.tricksUsed[club]` drives `gameDecay`.

## Engine hooks

- `engine/trickPlays.ts` (new): `TrickKind`, `TRICKS` meta (label, hint, base concept, eligibility), `trickFit`, `trickSurprise`, `trickEffect` → `{edge, sackMult, intMult, fumbleRate}`, `trickAlert`, `trickRecordText`, `trickOptions(world, s, offId, pkg)` → `MomentOption[]` with surprise %, and `aiTrickCall(world, s, offId)` → `TrickKind|null` (the #26 hand-off API, also used by a delegated OC).
- `data/playbookData.ts`: a separate `TRICK_PLAYS: PlaybookPlay[]` (named "Flea Flicker", "Reverse", "HB Pass", "Fake Spike", "Spike") with assignments and an optional `trick` field. **Do not add to `PLAYBOOK` or `SCHEME_MENUS`.** `conceptFromPlaybook`/`playbookPlay` also look up `TRICK_PLAYS`.
- `playsim.ts:step()` (small hooks only):
  - In the `callTriggered` branch, append `trickOptions` (ids `trick:<kind>`, plus `spike` when eligible) to the options. A `trick:` answer sets `concept`/`trick` and folds `trickEffect` into `call`.
  - In the standing-order branch, `ctx.ocTricks && aiTrickCall(...)`. AI clubs use `aiTrickCall` only after T4 (`TRICK.aiRate`, default 0 until then).
  - Optional trailing params: `resolvePass(... passerOverride?)` for the HB pass, credited `qbId` = RB, and `resolveRun(... carrierOverride?)` for the reverse (WR3, else WR2).
  - Spike: a short branch before the snap: no resolver, `passAtt+1`, down+1, clock −3, `pushPlay` type `'pass'` with result "Spike".
- `GameCtx`: `tricks?: TrickKind[]` (this week's package), `ocTricks?: boolean`. `GameState.tricksUsed`. `Play.trick`.
- `gameStore.ts`: `setTrickPackage` / `setOcTricks` on `career` (optional fields in `types.ts`), passed through `userCtx`. `recordSpecialAttempts` folds tricks. Leave `quickCall.ts` alone (tricks are never a quick call).

## UI touchpoints (redesigned screens, kit in `src/ui`)

- **GamePlanScreen → new `TrickPlaysCard`** (in `src/components/TrickPlaysCard.tsx`, mounted next to `SpecialTeamsCard`, hidden when `planScope === 'none'`):
  - `OptionGroup`/`OptionCard` to install up to **2** of the 4 tricks this week, each with a one-line hint and an opponent alert `VerdictChip` (Fresh / Seen / Alert).
  - A "Let the OC call one" toggle.
  - A "Predictable" `Badge` when your own trickAlert is ≥ 0.34.
  - `StudyOpponentCard`/`oppSt` adds `trickRecordText` for the opponent.
- **MatchView → `CallPicker`:** a "Tricks" tab after the formation tabs that lists only installed tricks plus Spike/Fake spike when eligible. Each shows a surprise meter (`Badge` tone good/warn/bad + %) and the staff line in `staffRead` ("They've seen your reverse — alert"). The play log/toast marks the snap "TRICK". Post-game film (`film.ts`) gets one line per trick (won/lost).
- Desktop + 375 px, light/dark, `.broadcast` scope. No raw hex outside the field-art allowlist (D5 check-hex).

## Calibration impact

- **T1–T3 change nothing for the harness.** Tricks come only from user moments or `ctx.ocTricks`, and `TRICK.aiRate = 0`. The default sim must be byte-identical: same points, eq 20/20.
- **T4** turns on AI tricks at NFL rates, about **0.15–0.25 trick snaps per team-game** in total (reverse ≈ flea > HB pass ≫ fake spike ≈ 0.01). The trigger is an `h01` gate on the snap *after* `pickConcept` has drawn, so the rng stream is untouched. The rate is scaled by coach aggressiveness and cut by `(1 − 0.5·trickAlert)`.
- Target trick outcomes: flea comp ~48%, YPA 10–12, INT ~5%; reverse 6–8 ypc with ~25% losses; HB pass comp ~50%.
- That is under 0.4% of snaps, so the bands should not move. If any band fails, lower `TRICK.aiRate`. Never retune core constants for this.

## Phases (DeepSeek jobs, non-overlapping files)

| Job | Base | Files (only these) | Notes |
|---|---|---|---|
| **T1 engine** | main | new `engine/trickPlays.ts`; `engine/playsim.ts` (hooks only); `engine/specialCalls.ts` (type + text); `data/playbookData.ts`; `store/gameStore.ts`; `game/types.ts`; `engine/film.ts` | user tricks + spike, memory, OC standing order, `aiRate` 0 |
| **T2 UI** | `ui-redesign` (or main once the redesign merges) after T1 merges | new `components/TrickPlaysCard.tsx`; `screens/GamePlanScreen.tsx`; `components/MatchView.tsx` | runs in parallel with T3 |
| **T3 animation** | main after T1, **after animc4 merges** | `components/playAnim.ts` only | pitch-back, WR reverse handoff, RB throw, spike/fake-spike motion; end spots 100% |
| **T4 AI rates** | main after T1 | `engine/trickPlays.ts` (`aiTrickCall`, `TRICK`), the one AI hook line in `playsim.ts` | the only job allowed to move calibration |

## Acceptance

- `npm run build` passes and `npm run lint` shows exactly 4 warnings.
- Calibration: `REPO=<tree> ~/.local/node/bin/node --import ~/gridiron-work/loader.mjs ~/gridiron-work/calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4`.
  - T1–T3: identical to the main baseline, eq 20/20, smokes 0/0.
  - T4: 31/31 bands × 3 seeds and the trick rate in the target range.
  - Animation end spots 100% (`~/gridiron-work/anim.mjs`).
- Probe (scratch script, forced trials per kind × D call × alert 0/0.5/1):
  - surprise and edge are monotone in alert and gameDecay;
  - outcome distributions match the targets;
  - HB pass credits the RB's passing line (box score, passer rating unaffected for the QB);
  - reverse credits the WR rush;
  - spike = an incomplete attempt, down+1, ≤3 s;
  - memory records, survives save/reload, and resets each season;
  - an old save without the fields loads;
  - `alertness()` (ST) is unchanged by trick counts.
- Orchestrator browser check: Tricks tab in a live call, the install card, opponent alert text, and a trick animation. Desktop/375, light/dark.

## Risks

- `playsim.ts` is hot (realism/kickoff/animc workers). Keep hooks small, keep the logic in `trickPlays.ts`, and rebase T1 onto the current main.
- T2 targets redesigned files that exist only on `ui-redesign`. Building it on main means redoing it later.
- A spike counted as a pass attempt lowers the user team's comp%. That is correct NFL convention, but show it in the box score note.
- Tricks must not leak into `SCHEME_MENUS`/`callCards()`, or the AI concept pick and calibration shift.
- #26 must call `trickOptions`/`aiTrickCall` and not fork them.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| T1 engine · T2 UI · T3 animation · T4 AI rates | ⏳ |
