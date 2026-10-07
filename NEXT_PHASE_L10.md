# NEXT PHASE — L10 "Game day": coach the big moments

_Planned by Claude Opus 5.5 on 2026-10-07 from `IDEAS_GAMEDAY.md` (the user approved all 10 ideas) plus two bugs. Implemented push by push by DeepSeek Flash 4.1 (OpenCode)._
_Lint baseline: exactly 5 warnings. Line numbers marked ~ are approximate: find code by name._

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| F1 | **Bug:** `TeamGameStats.sacks` counts every sack for BOTH teams | P1 | ✅ done — verified (P1) |
| F2 | **Balance:** "Bend Don't Break" beats every opponent; defensive plan rework + `__planMatrix` probe | P1 | ✅ done — verified (P1) |
| G1 | Resumable sim: `createGame` / `runToMoment` / `answerMoment` / `finishGame` (idea 1) | P1 | ✅ done — verified (P1) |
| G2 | Decisions module + call sheet: 4th down, 2-point tries, AI call sheets (idea 2, engine) | P1 | ✅ done — verified (P1) |
| G3 | Game Day flow in the store + moment card in the match view (idea 1, UI) | P2 | not started |
| G4 | Call-sheet editor on the Game Plan screen (idea 2, UI) | P2 | not started |
| G5 | Film grade for 4th-down and 2-point calls + season reward (idea 10, part 1) | P2 | not started |
| G6 | Halftime adjustments + QB change (ideas 5, 9b) | P3 | not started |
| G7 | Two-minute drill, timeouts, clock moment (idea 7) | P3 | not started |
| G8 | Tendency books, scouting action, self-scout panel (idea 6) | P4 | not started |
| G9 | Play-call cards (offense) and defensive calls (idea 4) | P4 | not started |
| G10 | Opening script (idea 3) | P4 | not started |
| G11 | Matchup assignments (idea 8) | P5 | not started |
| G12 | Workload and DL rotation (idea 9a) | P5 | not started |
| G13 | Film grade for every decision kind (idea 10, part 2) + `__decisionProbe` + docs | P5 | not started |

## Phase goal
Today the user's game is simulated in one call and the match view only **replays** it. L10 makes the sim **pause at big moments** so a head coach or coordinator **calls them**:
4th downs, 2-point tries, halftime adjustments, the 2-minute drill, timeouts, key-down play calls, an opening script, matchups, and workload. Each call is graded after the game.
Fast sim (Advance Week) answers every moment with the user's **standing orders**, so watching is never required and never gives a free edge.

### Design rules (bind every task)
1. **Decisions, not bonuses.** Every option changes a real sim input and has a cost. No option is free.
2. **AI coaches decide with the same functions** (4th down, 2-point, timeouts, halftime, calls), with quality scaled by their staff rating.
3. **No dominant choice.** Rock-paper-scissors matrices are zero-sum, and the AI exploits the user's **tendencies**. Every push must keep `__simTest` calibration.
4. **Deterministic.** Pausing never changes the RNG stream: a moment is checked at the **start** of a loop step, **before** any `rng()` draw in that step.
   Answering every moment with its `defaultId` must give **exactly** the same game as fast sim (G1 acceptance probe).
5. **Rung scope** (`capabilities(career).planScope`): `'both'` (head coach) answers every moment; `'own-side'` (coordinator) answers only moments on `career.unitFocus`'s side
   (`'off'` → offense calls, 2-minute, offense halftime fixes; `'def'` → defensive calls, defense halftime fixes; `'both'` focus → both sides' calls but still no HC-only moments).
   HC-only moments: `fourth`, `two`, `clock`, `qbChange`. `'none'` → no game day (fast sim only).
6. **At most 8 user moments per game** (plus per-kind caps listed in G1). Past a cap, the standing order answers silently and the decision is logged with `source: 'standing'`.
7. Every new save field is optional (`??=` defaults in `migrateCareer`/`migrateWorld`). Game-day session state is **not** saved: reloading mid-game returns you to the pre-game week.

### Baseline (seed 33333, `__simTest(200,'NFL')` before L10)
points 22.6 · compPct 67.6 · passYds 259 · rushYds 117 · plays 62.8 · ints 0.93 · fgAtt 1.9 · sacks **3.31 (double-counted; F1 makes it ~1.65)**.

---

## P1 — Foundations

### F1 — Sack stat fix (`src/game/engine/playsim.ts` ~679)
`if (out.yards < 0) { offS.sacks += 1; defS.sacks += 1 }` puts each sack on BOTH teams, so home and away always match.
**Fix:** add `sacksTaken: number` to `TeamGameStats` and `emptyStats()`. On a sack: `offS.sacksTaken += 1; defS.sacks += 1` (`sacks` = sacks **made by that team's defense**).
`__simTest` keys stay the same; add `'sacksTaken'` to its key list. Search for any other reader of `TeamGameStats.sacks` (`grep -rn "stats\.\(home\|away\)\.sacks"`) and keep its meaning "sacks by the defense".
**Acceptance:** home and away `sacks` differ in most games, and `__simTest` sacks ≈ half the old value.

### F2 — Defensive plan rework (`src/game/engine/gameplan.ts`, `playsim.ts`)
**Measured (8 opponents × 60 games):** Bend Don't Break allowed the fewest points against **all 8** (on average about 4 pts/game better than Balanced). All-Out Blitz was worst against all 8.
Stack the Box did not change rushing yards at all. **Causes:** `gain * planOverrides.bigPlayRisk` scales **every** completion (zone ≈ ×0.77 on every catch);
`aggression` never touches run defense.
**Fix:**
1. In `resolvePass`, replace `if (gain > 0) gain = Math.round(gain * planOverrides.bigPlayRisk)` with: `if (gain > 15) gain = 15 + Math.round((gain - 15) * planOverrides.bigPlayRisk)`
   (the plan bends only the **explosive part** of a play).
2. In `applyDefPlan`, zone gives up more underneath catches: `compMult = 1 - (cov - 0.5) * 0.14` (zone 1.07, man 0.93).
3. In `resolveRun`, read the defensive plan: `const dp = planFor(defId, 'def')`, and if present, multiply `runDef` by `1 + (dp.aggression - 0.5) * 0.06 - (dp.coverage <= 0 ? 0.03 : 0)`
   (stacking the box stops the run; a soft-zone light box gives up a little on the ground).
4. In `resolvePass`, when the defensive plan's `aggression >= 1.5`, add `+3` to `pressureEdge` (blitz-heavy plans really get home more).
5. NEW dev probe `planMatrix(n = 60)` in `gameStore.ts`, registered as `window.__planMatrix` (DEV block in `main.tsx`). The user's club = `career.teamId`.
   For each of 8 opponents (the first 8 NFL clubs by id, excluding the user's) × each **defensive** preset, it sims `n` games via `setLivePlan({ teamId, off: BALANCED_PLAN, def: preset.plan })`
   and returns `{ [opp]: { [presetLabel]: avgPointsAllowed } , bestCount: { [presetLabel]: numberOfOppsWhereBest }, edgeVsBalanced: { [presetLabel]: avg(points allowed by Balanced − by preset) } }`,
   plus the same for **offensive** presets (avg points scored, `defensePlan = BALANCED`).
**Acceptance (orchestrator tunes the constants above if needed):** no defensive preset is best against more than 5 of 8 opponents, and no preset's `edgeVsBalanced` exceeds +1.5 pts.
`__simTest` (AI vs AI, no live plan) is unchanged by F2.

### G1 — Resumable sim (`src/game/engine/playsim.ts`)
Refactor `simulatePlayByPlay` into a step machine **without changing AI-vs-AI behavior beyond G2's new decisions**.
```ts
export type MomentKind = 'fourth' | 'two' | 'call' | 'defCall' | 'halftime' | 'twoMinute' | 'clock' | 'qbChange'
export interface MomentOption { id: string; label: string; hint: string }
export interface Moment {
  id: string                 // `${kind}-${playIndex}` — unique within a game
  kind: MomentKind
  teamId: string             // the user's club
  qtr: number; clock: string; down: number | null; distance: number | null; yard: number
  us: number; them: number   // score from the user's side
  title: string              // e.g. "4th & 2 at their 38"
  options: MomentOption[]
  defaultId: string          // the standing order's answer
  staffRead?: string         // hint line from the staff (G5 EP numbers, G8 tendency read)
}
export interface DecisionLog { momentId: string; kind: MomentKind; choiceId: string; defaultId: string; source: 'user' | 'standing'; qtr: number; yard: number; down: number | null; distance: number | null; margin: number; outcome?: string; ep?: number }
export interface GameCtx {   // the user's per-game context; omit for AI vs AI
  userTeamId: string
  scope: 'off' | 'def' | 'both' | 'hc'   // 'hc' = head coach (all moments); 'off'/'def'/'both' = coordinator focus
  callSheet: CallSheet                   // G2
  // G6–G12 add optional fields here (script, matchups, usage, read, book)
}
export interface GameState { /* every former local of simulatePlayByPlay: rng, plays, scores, stats, qtr, clock, offId, defId, yard, down, distance, n,
  plus: phase: 'play' | 'try' | 'halftime'; pending: Moment | null; answers: Record<string, string>; momentsUsed: number; kindUsed: Partial<Record<MomentKind, number>>;
  decisions: DecisionLog[]; done: boolean; ctx?: GameCtx; homeId; awayId; tier; pace; passAdj */ }

export function createGame(world: World, homeId: string, awayId: string, seed: number, ctx?: GameCtx): GameState
/** Advance until the user must decide (returns the Moment; state.pending is set) or the game ends (returns null; state.done = true). */
export function runToMoment(world: World, s: GameState): Moment | null
/** Record the user's answer for state.pending (must be one of its option ids); the next runToMoment resumes. */
export function answerMoment(s: GameState, choiceId: string): void
export function finishGame(s: GameState): GameSim   // { homeId, awayId, homeScore, awayScore, plays, stats } + decisions
export function simulatePlayByPlay(world: World, homeId: string, awayId: string, seed: number, ctx?: GameCtx): GameSim {
  const s = createGame(world, homeId, awayId, seed, ctx)
  for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) answerMoment(s, m.defaultId)
  return finishGame(s)
}
```
- `GameSim` gains optional `decisions?: DecisionLog[]`.
- The old loop body becomes a function `step(world, s): 'continue' | 'moment' | 'done'`, called by `runToMoment` in a loop. **Each decision point sits at the start of a step, before any `rng()` call in that step**:
  a helper `decide(world, s, spec) → choiceId | null` returns the answer (from `s.answers[id]`, or the AI/standing function), or sets `s.pending` and returns `null`, in which case `step` returns `'moment'` immediately.
  On resume, the same step re-runs, finds `s.answers[id]`, and continues. Log every user-team decision (user or standing) into `s.decisions`.
- **Phases:** after a touchdown, set `s.phase = 'try'` and end the step; the next step resolves the try (G2). When Q2 ends, set `s.phase = 'halftime'`; the next step runs halftime (G6 adds the moment) and then the Q3 kickoff.
- Moment caps: total 8; per kind `fourth 3, two 2, call 3, defCall 3, twoMinute 2, clock 1, halftime 1, qbChange 1`.
- `ctx` stays a parameter (no new module-level globals). `setLivePlan` / `setUserCoaching` stay as they are.
- The worker (`src/workers/leagueSim.worker.ts`) and every existing caller keep working unchanged (no `ctx` → AI everywhere, so `runToMoment` never returns a moment).
- NEW dev probe `gameDayEquivalence(n = 20)` → `window.__gameDayEquivalence`: for `n` seeds, with a `GameCtx` for the user's club (`scope: 'hc'`, default call sheet),
  game A = `simulatePlayByPlay(..., ctx)`; game B = `createGame` + `runToMoment` loop answering `defaultId`. Return `{ identical: number, total: n }`. **Must be n / n.**

### G2 — Decisions + call sheet (`NEW src/game/engine/decisions.ts`)
```ts
export type FourthStyle = 'conservative' | 'standard' | 'aggressive'
export interface CallSheet { fourth: FourthStyle; twoPoint: 'chart' | 'kick'; timeouts: 'save' | 'aggressive' }
export const DEFAULT_CALL_SHEET: CallSheet = { fourth: 'standard', twoPoint: 'chart', timeouts: 'save' }
export interface Situation { yard: number; down: number; distance: number; qtr: number; clockSec: number; margin: number /* offense score − defense score */ }

/** Expected points for a 1st & 10 at `yard` (0–100 from own goal). Linear model: −0.6 + yard × 0.068 (own 9 ≈ 0, opp 1 ≈ 6.1). */
export function epAt(yard: number): number
/** Chance to convert `distance` yards on one snap: 1 → 0.68, 2 → 0.6, 3 → 0.55, 4 → 0.5, 5 → 0.45, 6–7 → 0.38, 8–10 → 0.3, longer → 0.22. */
export function convertProb(distance: number): number
/** FG make chance, using the same formula as resolveSpecial (pull it out so both share it). */
export function fgProb(yard: number, kickPower: number): number
/** EV of each 4th-down option for the offense (p = convertProb(distance), q = fgProb(yard, kickPower)):
 *  go   = p·epAt(min(99, yard + distance)) − (1 − p)·epAt(100 − yard)
 *  fg   = q·(3 − epAt(25)) − (1 − q)·epAt(100 − yard)        (null when yard < 52)
 *  punt = −epAt(100 − min(80, yard + 40))                       (a 40-yd net punt, touchback at the 20) */
export function fourthDownEV(s: Situation, kickPower: number): { go: number; fg: number | null; punt: number }
export function fourthDownChoice(style: FourthStyle, s: Situation, kickPower: number): 'go' | 'fg' | 'punt'
//   standard: the option with the best EV, but go only when distance <= 4;
//   aggressive: go when go.EV >= best − 0.4 and distance <= 6;
//   conservative: go only when distance <= 1 and yard >= 45; otherwise fg when in range, else punt.
//   Any style: down 4 in Q4 with clock <= 120 and trailing by 1–8 → go (unless a FG ties/wins: margin >= −3 and fg in range → fg).
export function twoPointChoice(rule: 'chart' | 'kick', marginAfterTD: number, qtr: number): 'kick' | 'go2'
//   'chart': go2 when qtr === 4 and marginAfterTD ∈ {−2, −5, −9, −10, +1, +5}; otherwise kick. 'kick': always kick.
export function aiCallSheet(world: World, teamId: string): CallSheet
//   Head coach rating ≥ 82 → aggressive; ≤ 66 → conservative; else standard. twoPoint: 'chart'. timeouts: rating ≥ 75 ? 'aggressive' : 'save'.
```
**Wire into the sim (G1 step):**
- **4th down** replaces the hard-coded `goForIt` rule. FG range stays `yard >= 52`. The offense's sheet: the user's `ctx.callSheet` when the offense is the user's club, else `aiCallSheet(world, offId)`.
  For the user's club, raise a `fourth` moment when `yard >= 35 && distance <= 5`, or `yard >= 52` (otherwise the standing order decides silently).
  Options: `go` ("Go for it"), `fg` (only in range; label "Kick the {dist}-yd FG"), `punt`. `defaultId` = the standing order. `staffRead` = `"Staff EV — Go {+x.x} · FG {+y.y} · Punt {+z.z}"` (one decimal).
- **2-point try** (new for everyone): in the `try` phase (qtr ≤ 4): the scoring team's sheet decides `kick` or `go2`. User's club → a `two` moment (options `kick` "Kick the PAT", `go2` "Go for two").
  `go2`: one snap from the 2: `pickConcept`, then `resolvePass`/`resolveRun` with `yard = 98, distance = 2`; success = `!turnover && yards >= 2` → +2 points. Log a play with `type: 'pat'`, concept "Two-point try",
  result "Two-point try good" / "Two-point try failed". Add `twoAtt` and `twoMade` to `TeamGameStats`.
- Store `CareerState.callSheet?: CallSheet` (default `DEFAULT_CALL_SHEET`).
**Acceptance:** `__gameDayEquivalence(20)` → 20/20. `__simTest(200,'NFL')` on seed 33333: points 21.6–23.6, compPct 66–69.5, plays 60–66. Also report the new 4th-down attempt rate.
`__careerSmoke(6,'coach')` → 0 errors / 0 violations.

---

## P2 — Game day is playable

### G3 — Game Day flow (`gameStore.ts`, `MatchView.tsx`, Dashboard)
- `advanceWeek(opts?: { userSim?: GameSim })`: when `opts.userSim` is given, use it as the user's game result **instead of** calling `simulatePlayByPlay` (everything else in `advanceWeek` stays identical:
  finalize, box score, stats, rivalry, moments, AI weeks, save). When not given, the user's game is `simulatePlayByPlay(world, home, away, seed, userCtx(career))`, so standing orders apply in fast sim.
  `userCtx(career)` builds the `GameCtx` from the career (scope from `planScope` + `unitFocus`; `planScope === 'none'` → no ctx).
- NEW store state `gameDay: { gameId: string; state: GameState; moment: Moment | null } | null` (not persisted). Actions:
  `startGameDay()` (only when `userCtx(career)` exists and the user has an unplayed game this week): `setLivePlan`, `applyUserCoaching`, `createGame` with the same seed as `advanceWeek`
  (`world.seed + week * 7919 + 101`), then `runToMoment`; `set({ gameDay, match: <partial GameSim from finishGame(state) so far> })`.
  `answerGameMoment(choiceId)`: `answerMoment`, then `runToMoment` again, updating `match` with the plays so far. When the game is done: `const sim = finishGame(state)`, `setLivePlan(null)`,
  then `await advanceWeek({ userSim: sim })`, keep the full replay open (`match: sim`), and `gameDay: null`.
  `simGameDayToEnd()`: answer every remaining moment with `defaultId`, then finish as above.
  `abandonGameDay()`: `gameDay: null, match: null` (nothing is recorded; the week is unchanged).
- **Remove** the old live path: `startLiveGame`, `simLiveChunk`, `finishLiveGame`, `startLiveSim`, `liveGame`, and the live `setPlan` re-sim (`setPlan` now only edits `defaultPlan`).
  It re-simulated without the plan (`finishLiveGame` never called `setLivePlan`). Point any UI that used them at the new actions.
- **Dashboard / Advance:** when `userCtx(career)` exists and a game is scheduled this week, show a primary **"Coach the game"** button next to Advance Week (Advance Week = fast sim with standing orders).
- **MatchView in game-day mode** (`gameDay != null`): it animates the plays that exist so far; when it reaches the end and `gameDay.moment` is set, it pauses and shows a **Moment card**
  (title, situation, score, `staffRead`, one button per option with its hint, the standing order marked "Standing order"), plus **"Sim to end (standing orders)"**. Picking an option calls `answerGameMoment`.
  The close button in game-day mode asks to confirm abandoning the game.

### G4 — Call sheet editor (`GamePlanScreen.tsx`)
A **"Call sheet"** card (visible when `userCtx` scope is `'hc'`): three segmented controls: 4th down (Conservative / Standard / Aggressive, each with a one-line explanation of when it goes for it),
2-point (Chart / Always kick), Timeouts (Save / Use aggressively; used from G7). Saves to `career.callSheet` via a NEW store action `setCallSheet(sheet)`.
Coordinators see a read-only line "4th downs and 2-point tries belong to the head coach."

### G5 — Film grade, part 1 (`NEW src/game/engine/film.ts`)
`gradeGame(world, sim: GameSim, userTeamId): { grade: number /* 0–100 */; letter: string; lines: string[] } | null` (null when there were no user decisions).
- For each `fourth` decision: `delta = EV(choice) − EV(best option)` from `fourthDownEV` (≤ 0). Line: "4th & 2 at their 38: went for it (+0.0 vs best)" / "punted (−1.4 EP vs going for it)".
- For each `two` decision: `delta` from a 2-pt model (go2 EV = 2 × 0.48; kick EV = 0.94 × 1; chart situations count the chart choice as best).
- `grade = clamp(80 + Σdelta × 8, 0, 100)`; `letter` from 93 A, 90 A−, 87 B+, 83 B, 80 B−, 77 C+, 73 C, 70 C−, 60 D, else F. User-made and standing decisions both count (the standing orders are yours too).
- Store the result on the user's `Game.film?: { grade: number; letter: string; lines: string[] }` (cleared each season with `box`), show it in the Schedule Box modal and as a card in the post-game
  match view ("Film grade: B+").
- Season reward (in `runEndOfRegularSeason`, once): average film grade ≥ 87 → `leadership +2`; ≥ 80 → `leadership +1`. Push a `seasonMoments` line. (Within the +3 cap.)
**Acceptance (P2):** build + lint 5. Orchestrator: coach a full game in the browser (answer moments, sim to end), and check the result counts exactly once in standings, box, rivalry and stats;
the Replay button still works; abandoning leaves the week unplayed; fast sim and "Sim to end" on a fresh week produce identical scores.

---

## P3 — Halftime and the clock

### G6 — Halftime adjustments + QB change (ideas 5, 9b)
In the `halftime` phase, compute **first-half diagnostics for each club** from the plays so far (`diagnose(plays, teamId)`):
| Problem (trigger) | Fix id | Effect for the rest of the game | Cost |
|---|---|---|---|
| Protection: sacks taken ≥ 2 | `maxProtect` (OFF) | sack chance × 0.6 | deep concepts (depth ≥ 12) lose a target: completion −3% on them |
| Run game stalled: rush avg < 3.5 (≥ 6 att) | `quickGame` (OFF) | passAdj +0.10, short concepts (depth ≤ 8) completion +3% | run edge −2 |
| Their 3rd downs: conv ≥ 50% (≥ 4 att) | `thirdDownHeat` (DEF) | blitz +0.15 on their 3rd downs | `bigPlayRisk` × 1.1 on those snaps |
| Run defense: their rush avg ≥ 5 (≥ 6 att) | `loadTheBox` (DEF) | runDef × 1.08 | coverage × 0.96 |
| Explosives allowed ≥ 2 passes of 25+ | `twoDeep` (DEF) | `bigPlayRisk` × 0.85 | compMult × 1.04 |
| (always available) | `stayCourse` | none | none |
Options = up to 2 diagnosed fixes (the most severe first) + `stayCourse`; if fewer than 2 problems, fill from the pool for the allowed sides, so there are always 3 options.
Coordinators only see their side's fixes. Each option's hint states its effect and its cost. Store adjustments in `s.adjust[teamId]: string[]` and read them in the resolvers.
**AI:** each AI club takes its top diagnosed fix with probability `clamp(0.4 + (hcRating − 60) / 100, 0.2, 0.8)` (an `rng()` draw **after** the user moment is answered), else `stayCourse`.
**QB change** (HC only, after the halftime moment): when the user's QB first-half passer rating < 50 (standard NFL formula from that QB's plays) and a backup QB exists → a `qbChange` moment
(`stay` / `switch`). `switch` makes the backup the QB for the 2nd half (`s.qbOverride[teamId] = backupId`; `topGroup(..., ['QB'], 1)` respects it). After the game, if switched: the starter's `morale −8`,
and a `seasonMoments` line. AI never switches.

### G7 — Two-minute drill, timeouts, clock (idea 7)
- `s.timeouts = { [homeId]: 3, [awayId]: 3 }`, reset at halftime. A timeout makes that play burn at most 6 s of clock.
- **Two-minute moment** (offense side): when the user's club starts a possession with qtr ∈ {2, 4}, clock ≤ 120, and (qtr === 2 or margin ∈ [−8, +3]). Options:
  `hurry` (time per play × 0.45; uses timeouts after plays that gain yards; intProb × 1.15; offensive penalty × 1.3), `normal`, `protect` (only when leading: time × 1.25, passAdj −0.15),
  `fgRange` (normal tempo; as soon as `yard >= 62` take the FG with ≤ 0:30 left or on any 3rd down). The mode lasts until the possession ends. Standing order: trailing → `hurry`, leading → `protect`, else `normal`.
- **Clock moment** (HC, defense): qtr 4, clock ≤ 180, user trailing by 1–8, opponent has the ball, user timeouts > 0 → `useTimeouts` (stop the clock after each opponent play) / `save`.
  Standing order from `callSheet.timeouts`: `aggressive` → `useTimeouts`.
- **AI:** offense in the same 2-minute situation trailing or tied → `hurry`; leading → `protect`. AI defense trailing in Q4 ≤ 180 s uses timeouts when its sheet says `aggressive`, otherwise only in the last 60 s.
**Acceptance (P3):** `__gameDayEquivalence` n/n; `__simTest` within the P1 band; a probe or a log shows timeouts used (~1–3 per team per game) and 2-minute drives.

---

## P4 — Calling plays

### G8 — Tendencies, scouting, self-scout (idea 6)
```ts
type Bucket = '1st' | '2nd-short' | '2nd-long' | '3rd-short' | '3rd-mid' | '3rd-long' | 'redzone'   // short ≤ 3, long ≥ 7; redzone = yard ≥ 80 (overrides)
type OffClass = 'run' | 'short' | 'deep'          // pass depth ≤ 8 = short, ≥ 9 = deep
type DefCall = 'blitz' | 'man' | 'zone' | 'stack'
interface TendencyBook { off: Record<Bucket, Record<OffClass, number>>; def: Record<Bucket, Record<DefCall, number>> }   // counts
```
- **User book:** `World.userBook?: { season: number; teamId: string; book: TendencyBook }`, updated after every user game from that game's snaps (offense: the concept class of each snap; defense: the call used,
  see G9), and reset when the season changes. Mix of moment calls and normal snaps: every snap counts, so plan dials shape tendencies too.
- **AI tendencies** are derived, not tracked: `aiTendency(world, teamId, bucket)` from the OC style (`passRate`, concept depths) and DC style (`blitz`, `manCoverage`, `runFit`) with the down-and-distance shifts
  `pickConcept` already uses.
- **Scouting action:** NEW weekly action `tendencies` ("Opponent film", cost 8, requires `callPlays`). The first purchase this week stores `career.oppRead = { week, oppId, sharp: false }`; a second makes it sharp.
  A read shows the opponent's top tendency per bucket with ±15% noise (fuzzy) or ±5% (sharp), deterministic from `world.seed + week`.
- **Self-scout panel** (Game Plan screen): the user book's top tendency per bucket, flagged "Predictable" when one class is ≥ 70% with ≥ 8 snaps.
- **AI exploits the user:** when the AI picks a call against the user (G9) in a bucket where the user book has ≥ 8 snaps, it shifts weight `w = clamp(0.15 + (dcRating − 60) / 200, 0.1, 0.35)`
  toward the counter of the user's most frequent class.

### G9 — Play-call cards and defensive calls (idea 4)
**Matrix** (`decisions.ts`, zero-sum per row; the edge is added to the offense):
| offense \ defense | blitz | man | zone | stack |
|---|---|---|---|---|
| run | +2 | +1 | 0 | −3 |
| short | +3 | −2 | +1 | −2 |
| deep | −1 (sack chance × 1.3) | +2 | −3 | +2 |
`callEdge` effects: pass → `talentEdge += callEdge * 1.5` and `compProb += callEdge * 0.012`; run → `edge += callEdge * 1.6`. **Only on snaps where the user made a call** (a `call` or `defCall` moment,
or a scripted snap in G10). AI vs AI snaps use no matrix, so calibration is unchanged.
- **`call` moment** (offense side): user offense with (down 3 and distance ≤ 3), or (yard ≥ 80 and down ≥ 3), or (qtr 4, clock ≤ 120, margin ∈ [−8, 0]). It comes **after** a `fourth` moment answered `go`.
  Options = 3 cards from the user OC style's concepts: the best-fit run, the best short pass, the best deep pass (fall back to any concept of that class). Card hint = `staffRead` from the scouted read
  ("They blitz 41% on 3rd & short") or "No read on their tendencies". The AI defense draws its call from `aiTendency` + exploitation (G8) with `rng()` — drawn **after** the answer.
  Standing order = the concept `pickConcept` would have chosen (so fast sim is unchanged).
- **`defCall` moment** (defense side): opponent on 3rd down with yard ≥ 40, or qtr 4 with clock ≤ 120 and the user leading by 1–8. Options `blitz`, `man`, `zone`, `stack`
  (hint = the read of their offense). The AI offense's class is drawn from `aiTendency` (+ exploitation of the user's defensive book). Standing order = the call implied by the user's defensive plan
  (`aggression ≥ 1.5` → blitz, `coverage ≤ 0.3` → zone, `coverage ≥ 1.7` → man, `aggression ≥ 1.2` → stack, else zone).
- Log the call, the opponent's call and the matrix result in the `DecisionLog` (`outcome: 'won' | 'lost' | 'push'`).

### G10 — Opening script (idea 3)
`CareerState.script?: string[]` (≤ 8 concept names from the user OC style; offense scope only). Game Plan card "Opening script": pick concepts in order from the style's list (add / remove / reorder).
In the game, the user's first 8 offensive snaps (outside moments) use the scripted concept in order. Scripted snap edge: `+2` on snaps 1–4, `+1` on 5–8, ×1.5 when `career.install?.plan === 'full'` for the current season. **Predictability:** 3+ consecutive scripted snaps of the same class → those snaps face the AI's best counter call (matrix applies).
After the user's first possession the script still runs but with no edge.

---

## P5 — Matchups, workload, and the full film grade

### G11 — Matchup assignments (idea 8)
`CareerState.matchups?: { off?: 'doubleRusher' | 'targetWeakCB'; def?: 'shadowWR1' | 'spyQB' }`, set on the Game Plan screen (scope-limited). Effects for the user's club only:
- `doubleRusher`: the opponent's best pass rusher counts at 50% in `pressure`; the target pool drops to the top 3 receivers.
- `targetWeakCB`: on 35% of passes (rng) coverage uses their weakest CB's `MCV`, and on those passes `intProb × 1.15` (safety help).
- `shadowWR1`: when their WR1 is targeted, coverage uses your CB1's `MCV` × 1.05; when anyone else is, `coverSkill × 0.96`.
- `spyQB`: their `scramble` mod × 0.5, and `QB Draw`/`RPO` concepts get `edge −3`; `pressure −4` (one fewer rusher).

### G12 — Workload and DL rotation (idea 9a)
`CareerState.usage?: { rb: 'normal' | 'feature' | 'committee'; dl: 'starters' | 'rotate' }`:
- RB: `feature` = RB1 gets every carry (run edge +1); `normal` = RB2 gets 20% of carries; `committee` = RB2 40% (run edge −0.5).
  After the user's game, an injury roll for RB1 (`feature` 6%, `normal` 2.5%, `committee` 1%) → `injured = { games: 1 + floor(rng × 3), note }` (deterministic rng).
- DL: `starters` = pressure −3 in Q4 (fatigue); `rotate` = pressure −1.5 in Q1–Q3 and +1.5 in Q4.

### G13 — Film grade, part 2 + dominance probe + docs
- `gradeGame` adds: `call`/`defCall` (+2 per won call, −2 per lost), halftime (fix applied and the targeted metric improved in the 2nd half: +2; otherwise 0), 2-minute (drive scored: +2),
  timeouts (got the ball back with ≥ 0:40: +1), QB switch (2nd-half passer rating of the new QB > the starter's 1st half: +2, else −2).
- NEW dev probe `decisionProbe(n = 100)` → `window.__decisionProbe`: for each `call` option class (always run / always short / always deep / always the standing order) and each `defCall`
  (always blitz/man/zone/stack/standing), sim `n` games against 4 opponents with every other moment on standing orders, and report the average point margin.
  **Acceptance:** no "always X" policy beats the standing order by more than +1.5 points per game.
- Docs: append "L10 Game day" under Done in `HANDOFF.md` (moments, the step machine, decisions.ts, film.ts, probes).

---

## PUSHES
**P1 = F1, F2, G1, G2** · **P2 = G3, G4, G5** · **P3 = G6, G7** · **P4 = G8, G9, G10** · **P5 = G11, G12, G13**
After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings. Never run `npm run dev` or any watch command. No git commands.

## DO NOT
- Do not change reputation gates, objectives, capabilities/access, `evaluateTrade`, contract pricing, or calibration tables in `src/game/data/`.
  Sim changes are limited to what this spec lists; keep `__simTest` within the stated band.
- Do not consume `rng()` before a moment check within a step (it breaks determinism).
- Do not persist game-day session state. Every new save field is optional.
- No new dependencies. Do not fix the baseline lint warnings. Do not reformat unrelated code. Do not edit any NEXT_PHASE*.md or IDEAS_*.md.

## Verification log
- **P1** (Flash 12 min; browser-verified by Claude on 2026-10-07). F1: `__simTest` sacks 3.31 → 1.57 (no longer double-counted); home ≠ away in most games.
  F2: defensive presets after the rework (`__planMatrix`, user margin): best counts Blitz 4 / Balanced 3 / Stack 1 / BDB 0, edges +0.31 / 0 / −0.58 / −1.57 (was BDB best vs 8/8, ~+4 pts).
  **Orchestrator addition to F2:** offense presets were dominated by pass-heavy plans (Air It Out +2.4, Hurry Up +2.3 margin vs Balanced, best vs 8/8 between them, 8 opps × 100 games), because
  passing out-earns running and nothing taxed a predictable plan. Added a pass-lean tax in `resolvePass` for a user plan with `passBias > 0`: `PASS_LEAN_PRESSURE = 4` (pressureEdge per point),
  `PASS_LEAN_COMP = 0.024` (completion), `PASS_LEAN_EDGE = 0.6` (talentEdge). Tuned (3/0.015/0 → +2.56, 5/0.035/1.5 → −2.84) to Air It Out +0.76, Hurry Up +1.02, Clock Killer −0.34, Run Heavy −0.10
  (best counts 3/3/0/0, Balanced 2). AI-vs-AI is untouched (plans are user-only).
  `planMatrix` fixed by the orchestrator to judge both sides by the user's point margin (Flash's version ranked offense by fewest points).
  G1: `__gameDayEquivalence(20)` 20/20; with a user ctx there are ~4–5 moments a game (fourth + two), and answering against the standing order changes results.
  Orchestrator fix: `two` moments only ask in the 2nd half or when the chart says go2 (they were spending both caps on Q1 PATs). G2: `__simTest` seed 33333 = 23.4 pts / 67.4% / 62.1 plays (in band);
  AI 4th-down go rate ~19%. `__careerSmoke(6,'coach')` 0 errors / 0 violations; `__balanceProbe(14,'coach')` seasonsToTop 10 (unchanged). Build + lint 5.
