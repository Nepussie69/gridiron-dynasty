# Emergent play resolution — phased E1 / E2 / E3 (FUTURES #54)

User decision (2026-10-15): **"make every play dynamic"** → *phased emergent*: move each contest of a
play off the outcome-first statistical roll and onto the live 22-man field, one at a time, each phase
calibrated to the NFL bands before the next: **E1** after the catch / after the line, **E2** route vs
coverage, **E3** OL vs DL. Research draft only — no source changed. Lines are `main` @ `wt/emergentspec`.


## Orchestrator decisions (2026-10-15, on top of the research draft)

1. **Sequencing.** P0 (move `playLive.ts`/`paceFor` into `engine/`) waits until the `animresid` job (check-broadcast residuals, edits `playAnim.ts`/`playLive.ts`) has merged. Then P0 → E1a → E1b → E1c → E1d, one job each; E2/E3 only after E1 is calibrated and ON.
2. **Default.** Each phase ships OFF (byte-identical) until its bands pass on the 3×500 panel; the phase that passes calibration flips its default ON in the same push (that is the point of the feature — the user asked for every play to be dynamic). OFF stays available as a dev toggle.
3. **Individual spread (user directive, 2026-10-11).** Beyond monotone: same play/seed, carrier SPD/ACC 95 vs 75 → breakaway (≥20 yd) rate at least 3× apart; tackler PUR/AWR/SPD 90 vs 60 on the same pursuit → angle success ≥ 15 pts apart and missed-tackle rate ≥ 10 pts apart; OL RBK 90 vs 60 vs the same DL → block-win/hold time clearly separated. Report n per group, grouped by the actual man on the rep.
4. **What the user sees.** E1c is the visible payoff: the animation draws the field's recorded paths (the tackle happens where the defender actually got there). Until E1c lands the animation keeps choreographing; do not ship E1 ON without E1c in the same release.
5. **Gates per phase.** build, lint 4, OFF byte-identical (SIM 33333×20), eq 20/20, smokes no worse than main, check-broadcast with the phase OFF and ON, `calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4` ≤ 2× main's wall clock, every band in or no worse than main by > 0.2 (pooled 6-seed drift for single-seed misses).
## Goal

Today `resolveRun` / `resolvePass` draw a yardage bucket from a real NFL CDF, *then* name the tackler,
the missed-tackle list, the OOB flag and the scorer from ratings + hashes, and the animation
(`playAnim.ts:buildPlayAnim` 1649) is choreographed to act that decision out. The goal is to invert this
one contest at a time: the men on the field (own SPD/ACC/AGI/STA, pursuit angles, blocks, contact)
produce the yards, tackler, misses and OOB; the CDF becomes a calibration target. Byte-identical when
off, inside today's NFL bands, ≤ 2× the calibration time, `eq 20/20` intact.

## What already exists

### 1. Current model map (file:function:line)

Everything below is reached through `playsim.ts:step()` (7263) → `resolveRun` (5185) / `resolvePass` (4082);
the coached (moment) game and the AI-vs-AI play-by-play game run the **same** `step()`/resolvers.

**Run yards.** `sampleYards(rng,false,edge*0.25*wx,stack,yard,tier)` (2529) samples the League run CDF
(`cal.runCdf`, `src/game/data/calibration.ts`) — `r = rng()` (2537), talent tilt `r**(1/(1+tilt))`
(`R2.talentTilt` 445), `sampleBucket`, `bucketYards` (calibration.ts:144, one more `rng()` per
non-`0`/non-`-6-` bucket) plus a red-zone re-bucket draw when `yard≥80` (2549). Then, in `resolveRun`:
×`R2.runGainCal` 0.78 (5406), short-yardage push (5409), `rbAfterContact` (5411), featured/FB bonuses,
a **Jind penetration** rep (5424–5434, hashes only: `penWinner` = hash-picked POA DL/LB via
`penDefBlend` vs `penBlkBlend`/`penBackBlend`), clamp −10…90, 3rd-down money yards, then the **J8a
long-run chase** (5448–5462: `chaseTailMult(runClose)` 2107, `R2.explosiveCal`, `R2.rzRunDamp`), the
**J8a open-field TD logit** (5471–5476: `chaseTdProb` 2094, hash `${n}:${defId}:chasetd`), the **J3b
goal-line stuff** (5486–5496: `glStuffChance`), then fumble (`rng()` 5504), OOB, tackler, miss, TD.
Ratings feeding `edge` (5395): `runBlock` (OL `RBK`/`IMP`, 5350), `elusiveness` (BCV/JKM/TRK/SPD +
`rbElusivenessExtras`, 5372), `runDef` (DL `BSH`/`TAK` + LB, 5355), `lbsDef` (LB `TAK`/`PUR` + J8a2 read),
style/fit/scheme, coach edges, mastery, box load, spy, fatigue (`fatDiff`), weather.

**Chase (J8A, 1911 block).** `pickPursuers` (2121, hash-picked LB/S/CB across the whole second/third
level), `chaseInfo` (2078) → carrier top speed from `SPD`+`ACC` burst (`chaseTargetMph`), pursuer speed
from `PUR`/`AWR` (`pursuerEffSpeed`), a head start and an angle; `chaseTailMult` (2107) applies a
1–3-pursuer shrink to the tail; `chaseTdProb` (2094) is the NFL with_yd_to_goal logit.
**All of J8a is hash-only, no `rng()` draw.**

**Credited tackler.** `runTackler` (3228): group weights LB 45/DL 25/S 20/CB 10 shifted by gain, then a
hash-picked man inside the group weighted by `eff(p,TAK/PUR/SPD/PRC/BSH)` with a `J8A.deciderBoost` for
the man who decided the play (long gain → `runClose.chaser`; else J8a2 `readKey`; else `poiDl/poiLb`);
`penWinner` takes a loss. Pass: `passTackler` (3260) — the cover man plus support safeties/LBs weighted
by `proximityWeight` (cover distance + own PUR/SPD/TAK).

**Missed tackles (one shared per-player math — reuse, never duplicate).** `missRate` (3310) =
`R2.missBase` + carrier term `(elusiveRating−79)*missCarDiff` + defender term `(79−tackleRating)*missDefDiff`
+ J3b spread; `elusiveRating` (3299: BTK/TRK/JKM/SPM/SFA/SPD; QB variant), `tackleRating` (3292:
TAK/PUR/HPW/AGI); `tackleMissChance` (3339) adds open-field `gain` openness and a pass bump;
`missExtraYards` (3355, hash), `finishTackler` (3378, hash). On a run this fires only when
`gain > -3` and a tackler exists; the pass path uses it after `tacklerYacShrink` (1863, defender TAK) and
`tacklerHitPower` (1872) for the strip.

**YAC.** `resolvePass` samples the *completion* CDF with `catchSkill` tilted (5037), trims ×
`R2.passGainCal`, applies `bigPlayRisk` over 15, ×`R2.explosiveCal`, then the J8a pass chase
(5051: `passClose`, `chaseTdProb`, `chaseCaughtExtra`), then the style YAC bonus
(5059: `tacBias`/`elusiveness`, **2 `rng()` draws**), RZ damp, position tuning (RB/TE), `depthAwareGain`
reshape, `tacklerYacShrink` (5081), miss (`passmt`), muff/strip.

**Out of bounds / TD.** `oobRate` (3189) per concept+position, hash `${n}:${offId}:oob`; a forced-out
runner is credited to a defender only under `CLOCK_ON` (J6). A TD is implied by `yard+gain≥100` (no
tackler credited), gated by the J8a chase logit, J3B and `R2.rz*Damp`; fumble/pick-six/return TDs: hashes.

**`rng()` draw budget per play (seed-stream shape — must not change for `eq`).**
Run: `sampleYards` 1 + `bucketYards` 1 (+1 RZ) + short-yardage 1 (≤2 yd only) + fumble 1 + `timeUsed` 1
+ committee 1 (user clubs only) ≈ **5–7**. Pass: `blitzRoll` 1 (4267) + one `rng()` per scored receiver
(4395) + `intProb` 1 (4996) + `compProb` 1 (5035) + `sampleYards`/bucket 2 (+1 RZ) + YAC 2 (5059) +
`tu` 1 (5104, reused as `timeUsed`) ≈ **9–12**. Everything else on both paths is `hash32`/`h01`
(`rng.ts:34`, `playsim.ts:912`, `hashPick` 1881, `hashPickN` 2020) with **no draw**.

**Pre-resolver front end (do not disturb):** `step()` picks the concept (`pickConcept` 2892,
`weightedPick` 2937, `pickConceptOfClass` 3041); target selection draws one `rng()` per receiver
(`scored` 4395) and *reuses* them as the softmax uniform — one extra/removed draw breaks the stream.

**Fast path.** `statAlloc.ts:291 allocateTeamGame` allocates the league's other box lines from the game
score (rushYds 331, `rushYds/4.35` carries 358, team missed tackles 479–508) and imports the **same**
`carrierMissRate`/`defenderMissRate` (statAlloc.ts:23, 177, 483–485), reconciling each side's forced
misses (756, 811). `eq 20/20` compares it with the play-by-play lines, so every E-phase must move both.

### 2. Live-field capability (what can already move men, deterministic, engine-safe?)

`src/components/playLive.ts` is a real continuous motion engine and it is **already DOM-free** (its only
import is `import type { Player }`) and deterministic (`hashN`, no `rng()`):

- `LiveField` (165): map of `Agent`s, 20 Hz `LIVE_DT=0.05` (126), accel-limited `steer` (351), blockers
  `approach` with lead (338), contact at 1.05 yd → `engage` (377) → `Pair` with `PAIR_GAP=0.88` (128),
  double teams + `climb` (494), hand-fight jostle and drive from a `PairPlan` (85, `movePair` 448),
  `shedAt` from a plan the caller builds from ratings, `onShed`/`onRelease` callbacks, `keepOut` ring
  (305, pursuers run alongside the scripted carrier and never reach him early), `run(t1)`/`closeAll`.
- `pursue(carrier,{keep,lead,speed,side,intercept})` (553): intercept/cutoff on the carrier's line, a
  real pursuit angle with a `lead` (~0.85) and a side, braking into a ring.
- `holdSpot` (608), `phases` (618), `livePos` (140), `liveVel` (157), `where`/`future`/`velOf`.
- `playReturn.ts:runReturnField` (128) drives all 21 other men for kicks/punts (lanes, wall/wedge,
  jammers vs gunners, protectors vs rushers) and only *reads* the recorded spot, contact time and
  tackler from the builder.
- `playAnim.ts` builds every other play: `paceFor` (674) gives top speed `6.6+(SPD−60)*0.088` capped by
  `ROLE_CAP` and per-position accel caps (`ACC_CAP`), fatigue via `animRatings.ts:fatiguePace` (61) /
  `fatigueMap` (39); `buildPlayAnim` (1649) scripts the carrier/passer path, runs the field to
  `tackleFrom = max(holeT*0.5, liveTo−1.4)` (2578, `field.run(tackleFrom)` 2809, `noContactAfter`), then
  `hitAndRide` (3818) brings the **credited** tackler in and caps everyone at the whistle — the animation
  is told the answer.

Speed: presentation path, built per play for the broadcast, not on the sim's hot path; a headless E1
field is a fraction of it (16–27 agents × 60–120 ticks ≈ 1–3k agent-updates/play, pure arithmetic).

**What is missing to decide instead of draw:** (a) it lives in `components/`, not `engine/`; (b) the
carrier/passer are *scripted* and the ring makes contact impossible; (c) `PairPlan.drive`/`shedAt` come
from the caller, not from a block win computed in the field; (d) no contact → tackle-attempt resolution
and no termination rule; (e) start positions are chosen by the animation, not stored on the `Play`; (f) no
`Play` field carries a path, tackler-by-contact or OOB-out-of-the-field.

## Design

### E1 — the pursuit field (after the line / after the catch)

New `src/game/engine/emergent.ts` (pure, no React/DOM, imports `rng.ts`, `playLive` moved to
`engine/liveField.ts`, `paceFor` moved to `engine/pace.ts` so the engine and `playAnim.ts` share ONE
speed function). Exported, default OFF:

```ts
export const EMERGENT = { on: false, dt: 0.05, farDt: 0.25, contactR: 0.9, tackleR: 0.75,
  pursuitLead: 0.85, leadAwrW: 0.3, shedW: 0.02, blockHoldBase: 0.9, burstW: 1.0,
  missGainW: 0.004, sidelineSlack: 0.4, maxT: 9, tailCap: 1.15, tailLo: 0.55 }
export function setEmergentE1(on: boolean): void
export function getEmergentE1(): boolean
```

`resolveRun` calls `emergentRun(inp)` and `resolvePass` calls `emergentYac(inp)` **in place of** the
yardage/chase/tackler/miss/OOB block, only when `EMERGENT.on && E1_ON`; with the toggle off every line
below is skipped and the current code runs byte-identically.

**Field input** (all data the engine already has): the carrier (J8a/personnel pick, `mkAttrs` + `fatOn`),
`defEleven` with the concept/personnel alignment (the formation tables the animation already uses), the
front blockers (`ol`, `te`, `fb`, `rb[1]` lead), the LOS (`yard`), the seed `${n}:${defId}`, and the
J8a2 read/bite/alley picks (readKey 2333, `bitesAt` 2281) so the read-loop story still shows.

**Motion.** Each man gets `paceFor(p, pos)` (own SPD/ACC) scaled by `fatiguePace(fatOn[id])`. The
carrier accelerates along his gap/aim line with a burst from ACC/AGI/BCV; defenders take a first-step
delay and a wrong-step vector when `bitesAt`, then `pursue` on an intercept angle whose `lead` is
`pursuitLead + leadAwrW*(AWR−70)/30` (a good read takes the true angle, a poor one undercuts — the same
idea as `pursue`'s `lead`, driven by AWR/PUR instead of a literal). Blockers fire to their man; on
contact (<1.05 yd) a `Pair` forms and its centre drives by `(RBK*0.7+IMP*0.3) − (BSH*0.5+STR*0.5)` —
exactly the `runBlock`/`runDef` ratings the sim uses — with a `hashR` jostle; `shedAt` is the block-win
time from the same blend, so `PairPlan`/`onShed` no longer need the caller's guess.

**Contact → result.** A free defender closing to `contactR` becomes the *attempt*:
`tackleMissChance(def, carrier, relGain, passing)` (3339, unchanged, with `openness` fed by the real
closing speed and angle cosine rather than the sampled gain). Miss → the carrier keeps running with a
burst (`burstW`), the defender gets `recover`/`freedAt` like `LiveField.release` (530) and the next
pursuer attempts; hit → the carrier's velocity is killed at `tackleR` and that defender is credited.
Sideline: the carrier's y leaves `[1,52.3]` → OOB (no tackler unless `CLOCK_ON`; J6 unchanged).
End zone: x reaches the goal → TD, tackler `undefined`. Termination: no free defender within reach and
`t > maxT` → the chase resolves as `tailLo + (tailHi−tailLo)*h01(...)` capped at the current gain (a
one-line fallback so a field bug can never produce a 99-yd play).
`yards = round(finalX − yard)` (a catch starts at the catch point + the air yards the pass path already
computed), so `passDepth`/air-yards stay the existing `depthAwareGain` shape.

**Output** → the existing `PlayOutcome` fields (`yards`, `tackleIds`, `missedTackleIds`,
`forcedMissedIds`, `outOfBounds`, `carrierId`, `scorerId`, plus new `carryPath?: LPt[]` and
`fieldPaths?: Record<string, LPt[]>` for the animation) plus `missExtra` counts so `stats.ts` TFL and
MT counting is untouched.

**Determinism.** E1 adds **zero `rng()` draws**: every man's speed, angle, block win, shed time, contact
outcome and burst comes from `h01(\`${n}:${defId}:e1:<man>:<slot>\`)` / `hash32` — the same pattern as
J8a/J8a2/Jind. The draws the replaced block used are still consumed in the same order (the values are
read into the seed of the field), so the seed stream keeps its exact length and order and
`eq 20/20` holds by construction. Toggles: `setEmergentE1(false)` ⇒ the resolver never enters the block.

### E2 — route vs coverage (shorter)

Replaces the coverage model at 4720–4745 (`muSep`, `sepYd`, `coverTag` from `MATCHUPS_ON`) and the
`compProb` block (4892–4942) with an actual route: the receiver's route from `data/routes.ts`
(`routeForCandidate`, assignments from `playbookData.ts`) run at his own pace/ACC/AGI (cut sharpness from
AGI/DRR), the cover defender mirroring on the same field with `PRC`/`AWR` read delay and `SPD/ACC/AGI`
phase; separation at the catch = the distance between them when the ball arrives (arrival time from
`passAir`/depth). `compProb` becomes P(catch | sep, CTH/SPC, contest) inside the existing
`MU.compMin…compMax` window; bust/miscall are today's `h01` breakdowns. The incomplete branch
(`pbuId`, `dropId`, `eyeJumpId`) and `passClose` reuse the same field.
**Depends on E1** (field + shared pace/`Pair` code). **Risks:** completion % and YPA are the most
tightly banded numbers in the sim; a mirror that is too good shrinks separation and the whole pass game.
Calibrate only the separation→catch transfer inside `EMERGENT`, keep `MU_CENTER.comp` (3514) as the
league anchor, and require the three-seed 500-game `--eq` panel plus the YPA/completion bands before
merging.

### E3 — OL vs DL (shorter)

Replaces the J8b rep model (`rushMatchups`, called at 4100 under `PROT_ON`) and `pressureEdge` (4294) /
`sackChance` (4323) with a real pass set: each OL's set (PBK/PBW/IMP) vs his assigned rusher's
(PMV/FMV/BSH/STR), a pocket that collapses by the men who actually lost their rep, and
`timeToPressureS` read off the field instead of a blended edge. `j13` slide/protection, J37 pair
chemistry (`olHandoffChem`) and J8c credit all stay as inputs.
**Depends on E1 + E2** (the QB has to move in the same field as the routes). **Risks:** sacks are a
small count (2.6/game band) — a field that is 1 s too slow or fast moves sack% far more than a yard
of run; gate on sack%, pressure rate and time-to-throw.

## Engine hooks (all additive, one file per phase)

| Hook | Where |
|---|---|
| move `playLive.ts` → `engine/liveField.ts` (re-export from the component path) | `src/components/playLive.ts` (1 file, type-only import today) |
| move `paceFor`/`ACC_CAP`/`ROLE_CAP` → `engine/pace.ts` | `playAnim.ts:674` imports it |
| `EMERGENT` const + `setEmergentE1` + `emergentRun`/`emergentYac` | new `src/game/engine/emergent.ts` |
| `resolveRun`: replace 5400–5530 (yardage/chase/TD/GL/OOB/tackler/miss) when on | `playsim.ts:5185` |
| `resolvePass`: replace 5037–5100 (YAC gain/chase/shrink/miss) when on | `playsim.ts:4082` |
| `PlayOutcome.carryPath` / `fieldPaths` | `playsim.ts:2667` |
| `Play` save field (optional, ignored by old saves) | `playsim.ts` `Play` type + `stats.ts` |
| fast path mirror (recompute the rush/YAC/miss split) | `statAlloc.ts:291,331,479` |
| probe | new `~/gridiron-work/emergent-probe.mjs` |

## Calibration impact

E1 moves, and must re-centre **inside `EMERGENT` only** (one exported object; nothing else tuned):
YPC (calib ≈ 4.17 / probe ≈ 4.28 today), run ≤0 rate **17.8%**, ≥10-yd rate **10.6%**, YAC/catch,
breakaway TDs (the `chaseTdProb` logit is the anchor), **missed tackles 7–9/game** and rush TD. Today's
`R2.runGainCal` (493), `R2.explosiveCal`, `R2.rzRunDamp`, `J8A.tdScale`/`chaseLo/Hi` and `PEN.mag`
become **OFF-path only** (they stay in the file; E1's knobs replace them), so the OFF path cannot drift.
Order of centring: (1) `shedW`/`blockHoldBase` so block wins land in the NFL pressure/hold bands;
(2) `pursuitLead`/`leadAwrW` + `burstW` for YPC and the ≤0/≥10 shape; (3) `contactR`/`tackleR` +
`missGainW` for MT/game; (4) `tailCap`/`maxT` for the breakaway TD rate. Every step: `calib.mjs
33333,2222,5150 500 --eq --smoke=coach:4,personnel:4` (≈6 s/seed today) plus the shape probe.
**Elite-vs-poor probe** (`emergent-probe.mjs`): same play/seed, carrier SPD 95↔75 → breakaway (≥20 yd)
and TD-rate delta monotone and wider than today's; a 60-PUR/SPD LB2 vs a 90-AWR/90-PUR safety on the same
pursuit → angle success (closing to `tackleR` inside `maxT`) separates by ≥15 pts. Perf: bracketed in the
probe (E1 on/off, same seeds), budget **≤ 0.35 ms/play** (≤ ~50% added on the 500-game run) via the
far-man `farDt=0.25` step and a closed-form solve once the nearest free defender is >3 yd away.

## Phases

| Phase | Files (main touch) | Status |
|---|---|---|
| P0 groundwork (move `liveField`/`paceFor` to engine, no behaviour change) | `components/playLive.ts`, `components/playAnim.ts`, `engine/liveField.ts` (new), `engine/pace.ts` (new) | ✅ merged 2026-10-15 (row 466) |
| E1a field, run only (`emergentRun`, tackler/miss/OOB out of contact, OFF default) | `engine/emergent.ts` (new), `playsim.ts:5185–5595` | not started |
| E1b E1 on the pass YAC segment (+`carryPath` recorded) | `engine/emergent.ts`, `playsim.ts:5037–5100` | not started |
| E1c animation draws the recorded path instead of choreographing (`carryPath`/`fieldPaths` → movers; `hitAndRide` only as a fallback) | `components/playAnim.ts:1649,2809,3818` | not started |
| E1d fast-path mirror (rush/YAC/MT split) + calibrate | `statAlloc.ts:291–520` | not started |
| E2 route vs coverage | `engine/emergent.ts`, `playsim.ts:4720–4945`, `data/routes.ts` | not started |
| E3 OL vs DL | `engine/emergent.ts`, `playsim.ts:4100–4330` | not started |

## Acceptance

- `npm run build` passes; `npm run lint` = the repo's expected warning count (4 today).
- OFF byte-identical: a hash over the resolved `PlayOutcome` JSON for the three seeds with E1 off must match `main`.
- `calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4`: **eq 20/20**, points in the 22–23.2 band, plus the run/tackle bands above; ≤ 2× the wall-clock of the same run on `main`.
- Anim probe (`animProbe.ts` ANIM line, `anim.mjs`): recorded end spots 100%, kick/punt/pass contact counts unchanged, frame Δ within today's band; the new path fields must not break old saves (missing `carryPath` → today's choreography).
- Elite-vs-poor probe monotone as above; no new warnings; `PLAYTEST_BACKLOG.md` row added.

## Risks

1. **Calibration drift** — E1 is the whole run game; a field that is 2% off on block wins moves YPC, ≤0%, MT and TD rate at once. Mitigation: one knob object, fixed order of centring, OFF path untouched, and the fast path re-mirrored in the same push.
2. **Perf** — 500 games ≤ 2×; mitigate with `farDt`, only the 5 nearest defenders at `dt`, and a closed-form tail when nobody can reach; measure in the probe, not by feel.
3. **Determinism** — zero added `rng()` draws, and the replaced draws are still consumed in order; every tie-break is `hash32`/`h01` on `${n}:${defId}`. A single `Math.random` or a `sort` without a total order breaks `eq 20/20`; add a unit that runs a snap twice and diffs.
4. **Moment/coached path** — the user's game reaches `resolveRun`/`resolvePass` through the same `step()`, so E1 changes the user's plays too. Any per-phase toggle must gate both; a moment must never show a field result computed from a different actor set than the boxes it writes.
5. **Save compatibility** — `carryPath`/`fieldPaths` are optional; old saves (and `null` paths) fall back to today's choreography; do not bump the save schema for presentation data.
6. **Check/broadcast assumptions** — `animProbe.ts`, `animContactProbe.ts`, `check-broadcast` checks and `playReturn.ts` all assume the builder choreographs the credited tackler and the recorded spot. E1c must keep those contracts (`tackleFrom`, `hitAndRide`, `closeAll`) as a fallback path and the probes must be run with E1 both on and off.

## Progress

| Date | Item | Result |
|---|---|---|
| 2026-10-15 | research draft written (this file) | CURRENT MODEL + live-field audit done; E1/E2/E3 designed; no source touched |
| 2026-10-15 | P0 groundwork (emerp0) | ✅ pure move: liveField.ts + pace.ts in engine; check-broadcast 85/85, eq 20/20, anim probe identical. Leftover P0.1: animProbe.ts imports components |
| 2026-10-15 | user: prioritise emergent, run phases in parallel | E3 ✅ merged OFF (row 480); E2 (emere2) running; E3 queued in parallel in own files (emergentRoute.ts / emergentRush.ts), OFF default until a joint calibration; E1a after qbrun merge, E1b after speedgap merge; blitzrush / livetele3 / sideways held |
