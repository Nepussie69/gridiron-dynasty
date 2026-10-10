# Challenges & replay review — FUTURES #5

User (FUTURES list, 2026-10-07): throw the red flag on close spots, catches and fumbles; lose a timeout if you're wrong; booth reviews inside the last 2 minutes and on all scores and turnovers.
Spec written 2026-10-11.

## Goal

Close plays sometimes get the wrong call on the field. Booth reviews fix these automatically in their domain. Everywhere else the hurt club has to decide whether to throw the red flag, with a staff read of the replay. A wrong challenge costs a timeout, and the decision is graded in film. Under the rule below, outcomes reproduce the calibrated sim exactly with reviews off, and stay inside the NFL bands with reviews on.

## What exists (audit 2026-10-11; extend these, do not duplicate)

- No challenge or replay-review code anywhere in the engine, store or UI. `src/game/engine/redflag.ts` is the **draft** red flag (K4 prospect tags) and has nothing to do with this feature. Leave it alone and avoid a name clash: the new module is `review.ts`.
- Timeouts: `GameState.timeouts` / `timeoutsUsed` (reset at halftime), `wantsTimeout` and `usedTimeout` (playsim.ts ~3183–3221), and the dock's manual timeout `manualTimeout` + `gameStore.callTimeout` (~1626). `ScoreBlock` already draws `TimeoutPips`.
- Moments: `decide()` / `DecisionSpec` / `MomentKind` / `MOMENT_CAPS` / `TOTAL_MOMENT_CAP` (playsim.ts ~2626–2900). Moments must sit **before any rng draw** in a step. Moment ids are `${kind}-${s.plays.length}`, and the store rebuilds a game by replaying answers (gameStore.ts ~1514–1532).
- Per-play deterministic hash `h01(key)`. The scrimmage-apply block at the end of `step()` (after `chargeSnaps`, ~3708–3845) is **rng-free**: clock, `usedTimeout`, team stats, safety, TD, turnover and downs.
- Player stats are derived from the `Play` records (stats.ts), so a replaced play record keeps box scores consistent automatically. Team stats (`statFor`) are mutated in place.
- `analyticsRating(world, teamId)` (analytics.ts) is available for the replay-read quality. The call sheet (`CallSheet` in decisions.ts) is edited in `GamePlanScreen.CallSheetCard` and `CallSheetRow`. `film.ts` grades `DecisionLog` entries.
- Redesigned game day (branch `ui-redesign`): `MatchView` has `MomentCard`, a `playToast`/`TOAST_TONE` result toast and the dock Timeout button. The kit has `ScoreBlock` (src/ui/ScoreBlock.tsx), `Controls` (SegmentedControl, OptionCard, IconButton), `Overlay` (ConfirmSheet, Sheet) and `Kpi` (VerdictChip, DivergingMeter).

## Design

**Truth-first rule (keeps calibration).** The resolved `PlayOutcome` is the truth, which is what the sim was calibrated on. A new officiating layer marks some plays *close* (hash) and, on a fraction of them, produces a different on-field ruling (`alt`). Close kinds in v1 are scrimmage plays only (run/pass). Kicks and penalties are out of scope.
- `spot`: the gain is within 1 yd of the line to gain, and the ruling is moved 1 yd across it in either direction.
- `catch`: a contested completion (non-TD, no fumble) ruled incomplete, or a contested incompletion (has a target, not an INT) ruled a catch at `passDepth`, clamped short of the goal line.
- `fumble`: a true lost fumble on a run or catch (not `defTD`) ruled "down by contact", or a ruled fumble whose truth is "down" (booth domain only).
- `goalLine`: a true TD with the carrier stopped in the last yard ruled down at the 1, or a ruling of TD whose truth is down at the 1 (booth domain only).

**Booth domain:** the last 2:00 of Q2 and Q4, all of OT, every play *ruled* a score and every play *ruled* a turnover. On a close play here the booth always reviews, the **truth is applied** and `Play.review` records the ruling and the result ("Ruled a fumble, reversed: down by contact" / "Confirmed"). This is display-only, so outcomes are identical to reviews off.

**Challenge domain** (everything else): the **ruling is applied**. A pending review keeps the truth outcome plus a small snapshot. At the start of the next step, before any rng draw, the hurt club may challenge:
- Eligible only if the club has ≥1 timeout and challenges left: 2 per game, plus a 3rd only after winning both. Never in the booth window or OT.
- The user's club (HC scope) gets a moment of kind `challenge`, side `hc`: **Throw the red flag** / **Let it go**. `staffRead` gives the replay read, e.g. "Replay booth: 72% he was down before the ball came out." The read is centred ~0.72 on a mis-call and ~0.32 on a correct call, with hash noise that shrinks as `analyticsRating` rises (about ±0.25 at 40, ±0.10 at 90).
- The standing order (Sim to end, coordinator rungs, the AI) throws when read ≥ threshold. The threshold comes from the new call-sheet row **Red flag**: Aggressive 0.55 / Standard 0.65 / Conservative 0.78. AI clubs derive it from `coachTendency`, with a hash-based coin on top so AI clubs also make some wrong challenges.
- Result: a mis-call is reversed with probability ~0.85 (otherwise "stands, inconclusive"), and a correct call always stands. Reversed: restore the snapshot and re-apply the truth through the shared apply function. Stands: the challenger loses a timeout and a challenge. If that timeout was armed as a manual timeout, it is disarmed.
- Rates (constants in `review.ts`, tuned only via the probe, never by touching the sim): close-play and mis-call rates per kind, set so the challenge domain gives roughly 0.3–0.6 coach challenges per game at ~35–55 % success and the booth gives ~1.0–1.6 stoppage reviews per game. These are approximate recent-NFL figures. The orchestrator confirms them against the NFL Football Operations replay data before C2 tuning.

## Engine hooks

- **New `src/game/engine/review.ts`:** `REVIEW` constants, `setReplayReview(on)` / `getReplayReview()` (default on; off means no close plays at all), `inBoothWindow(s)`, `closeKind(s, out)`, `officiate(world, s, out, fourthChoice)` → `{ applied, truth, review }`, `replayRead(world, teamId, wrong, key)`, `challengeThreshold(sheet)`, `aiThrows(world, s, club, read)`, `resolveChallenge(pending, key)`. No rng: `h01` keys `${s.n}:${club}:<tag>` only.
- **`playsim.ts` (small hooks only):**
  - **Extraction:** pull the post-`chargeSnaps` block of `step()` out into `applyScrimmageOutcome(world, s, out, fourthChoice, offId, defId)`. This is mechanical, with no behaviour change.
  - **In `step()`:** call `officiate()` before applying. If the play lands in the challenge domain, store `s.review = { playIdx, truth, snap }`, where `snap` holds the scores, `offId`/`defId`, yard, down, distance, phase, clock, timeouts, timeoutsUsed, manualTimeout, `driveSnaps`, `twoMinMode` and the two `TeamGameStats` clones.
  - **`checkChallenge(world, s)`:** runs in `step()` right after the phase dispatch and before `if (s.clock <= 0)`. It builds the `DecisionSpec` and calls `decide()`.
  - **Reversal:** restore the snapshot, `s.plays.pop()`, then `applyScrimmageOutcome(truth)` and copy `review` metadata onto the new record. `plays.length` is unchanged, so moment ids and rebuilds stay stable.
  - **Types and counters:**
    - `MomentKind` gains `'challenge'`, with `MOMENT_CAPS.challenge = 3` and exemption from `TOTAL_MOMENT_CAP` (like play calls).
    - `Play.review?: { by: 'booth' | string; kind; ruling: string; outcome: 'reversed' | 'stands' | 'confirmed'; read?: number }`.
    - `GameState.review?` and `GameState.challenges?: Record<club, { left; won; lost }>` are set in `createGame`. Challenges are not reset at halftime.
- **`decisions.ts`:** `CallSheet.challenges?: 'aggressive' | 'standard' | 'conservative'` (optional, so old saves are valid), the `DEFAULT_CALL_SHEET` value and `aiCallSheet`.
- **`film.ts`:** grade `challenge` decisions: a reversal earns a plus, a lost timeout a minus, and passing on a reversible call costs a little. **`recap.ts`:** an optional line for a game-turning reversal.

## UI touchpoints (redesign kit, `ui-redesign` branch)

- `MomentCard` (MatchView) for kind `challenge`: red-flag accent, the replay read as a `DivergingMeter` + `VerdictChip` ("Likely reversed"), two `OptionCard`s, and the cost line "Costs a timeout if it stands (2 left)".
- **New `src/components/ReviewCard.tsx`:** an overlay over the field with the sequence "UNDER REVIEW: ruled catch at the 34" → "REVERSED: incomplete" / "CALL STANDS: BUF lose a timeout". It also shows a small `Badge` "Booth" or "Challenge" on the play toast and the drive log. After a reversal the view jumps to the corrected end frame and does **not** re-animate (backlog 82).
- `ScoreBlock` (src/ui/ScoreBlock.tsx): an optional `challenges` prop drawing flag pips beside `TimeoutPips`.
- `GamePlanScreen.CallSheetCard`: a new `CallSheetRow` **Red flag** (SegmentedControl) with a one-line hint.
- Box score line "Challenges 1/2 won".
- Desktop and 375 px, light and dark, with no horizontal scroll and 44 px tap targets on phone.
- C4 (optional): a dock **Red flag** `IconButton` after any challengeable play, with `gameStore.throwFlag()` mirroring `callTimeout` and `GameState.manualChallenge`.

## Calibration impact

- Reviews off: byte-identical to base.
- Booth domain: outcome-identical even with reviews on, because the truth is applied.
- The only drift is challenge-domain mis-calls that stand (unchallenged or inconclusive) and timeouts lost early. Keep it to |Δ| ≤ 0.15 points, ≤ 0.03 giveaways and ≤ 0.5 pt 3rd-down conversion per team-game versus reviews off.
- Missed fumbles favour the offence, so keep fumble mis-calls rarer than spot and catch mis-calls, whose two directions cancel. If a band moves, **lower the mis-call rates; never retune the sim.**

## Phases (DeepSeek jobs; files never overlap within a wave)

| Job | Base / worktree | Files | Content |
|---|---|---|---|
| C1 engine core | main **after passid2 merges** (it edits playsim.ts) | playsim.ts, new review.ts, decisions.ts (type only), new scripts/probe-review.mjs | apply-block extraction, `officiate`, booth domain (display-only), all new types incl. `Play.review`, `MomentKind 'challenge'`, `CallSheet.challenges` |
| C2 challenges | same worktree after C1 review | playsim.ts, review.ts, decisions.ts, film.ts, recap.ts | `checkChallenge`, snapshot/reversal, AI + standing policy, timeout cost, 3rd challenge, rate tuning via probe |
| C3 UI (parallel with C2, needs C1 types) | ui-redesign with C1 merged in | new ReviewCard.tsx, MatchView.tsx (≤40-line hooks), src/ui/ScoreBlock.tsx, GamePlanScreen.tsx | moment card, review overlay, flag pips, Red flag row. Coordinate with the Broadcast B-phases on MatchView. |
| C4 dock flag (optional) | after C2 + C3 merged | gameStore.ts, playsim.ts (hook), MatchView.tsx (dock) | manual red flag on any eligible play |

## Acceptance

- Build passes; lint exactly 4.
- Real-data calibration 33333/2222/5150 ×500 `--eq --smoke=coach:4,personnel:4`:
  - **C1** with reviews on, and **C2** with reviews off: outcomes identical to the base.
  - **C2** with reviews on: all applicable NFL bands pass on all 3 seeds, deltas reported against the limits above.
  - Every run: eq 20/20, smokes 0/0, animation end spots 100 %.
- `probe-review.mjs` over ≥2,000 games reports:
  - close plays, booth reviews, challenges, success %, timeouts lost and reversals by kind, all inside the target ranges;
  - zero challenges inside the 2:00 window, in OT, with 0 timeouts or with 0 challenges left;
  - a 3rd challenge only after two wins;
  - a user moment only when the user's club is hurt and eligible;
  - reversal equivalence: the state after a reversal equals a forced-correct-call run on key fields and box score;
  - rebuild determinism: answering, then rebuilding from answers, gives identical plays;
  - an old save (no new fields) loads.
- Orchestrator browser check (C3/C4), on desktop and at 375 px, light and dark:
  - the challenge moment, both results and a booth reversal toast;
  - the flag pips and the call-sheet row;
  - no replay flash, and no console errors.

## Risks

- **Extracting the apply block from `step()`:** this can regress silently. The C1 identity gate (calibration identical) is the guard. No rng is drawn in the apply or reversal paths.
- **Reversal and the store rebuild:** a reversal must keep `plays.length` and the moment ids stable. Mutating play records mid-view can retrigger the animation (backlog 82).
- **Concurrent edits:** passid2 and Broadcast B1 also touch playsim.ts/playAnim.ts, and B2/B6 touch MatchView. Keep hooks small, and put the UI in ReviewCard.tsx.
- **Turnover drift** from missed fumbles that stand: cap the fumble mis-call rate.
- **Moment fatigue:** challenge moments are capped at 3 per game and exempt from the total cap so they never crowd out halftime or a 2-point try. "Key moments only" still asks.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| C1 engine core | ⏳ waits for passid2 merge |
| C2 challenges | ⏳ |
| C3 UI | ⏳ |
| C4 dock flag (optional) | ⏳ |
