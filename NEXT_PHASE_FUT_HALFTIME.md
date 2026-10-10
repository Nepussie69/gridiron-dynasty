# Halftime speech — FUTURES #7

User (FUTURES list, 2026-10-08): Fire up / calm / challenge a star / stay the course → morale and a second-half edge, can backfire. Ties into the locker room (FUTURES 16 ✅) and owner personalities (FUTURES 22 ✅).

## Already built — extend, do not duplicate

- **Halftime phase** `playsim.ts:stepHalftimePhase` (L10 G6): X&O adjustment card (`buildHalftimeSpec`, `diagnose`, `FIX_META` incl. a `stayCourse` fix id), AI fixes (`rollAIHalftime`, the only halftime `rng()` draw), then the HC-only QB-change card (`buildQbSpec`). Flags `halfAdjustDone` / `qbChangeChecked` on `GameState`.
- **Moments** `decide()` + `DecisionSpec`, `MOMENT_CAPS` (halftime 1, qbChange 1), `TOTAL_MOMENT_CAP = 8` (play calls exempt via `isPlayCall`), `scopeAllows` (side `'hc'` = head coach only), `logDecision` → `s.decisions` → `film.ts` grades (`halftimeImproved`, line ~251).
- **Coaching edge** `playsim.ts:ocEffect(world, teamId)` → `offEdge`/`defEdge`, read in `resolvePass` (~1634) and `resolveRun` (~2043). `SimEnv` / `envFor(s)` carry per-step game context.
- **Locker room** `lockerRoom.ts`: `LockerRoomState` (captains, mentors, opt-in `effort`), `leaderScore`, `problemScore` / `PROBLEM_MIN`, `rankedLeaders`, `problemPlayers`, `avgMorale` (top 22), `lockerEffort` (morale → ±1.2 edge, opt-in). UI `LockerRoomCard.tsx` (Team → Development).
- **Morale writers** in `gameStore.ts` post-game block (~1330: benched QB −8, `qbSwitchLine` → `logMoment`). Player `morale` 1–100 also feeds `negotiation.ts`.
- **Owner** `owner.ts`: `ownerPersonality(teamId)` (pure hash: meddling / patient / cheap / win-now), `ownerProfile`; career `jobSecurity` 0–100.
- **Skills** `career.skills.leadership` (`skills.ts`, `leadershipEdge`, `leadershipMoraleBonus`).

Nothing named "speech" exists. The existing **Stay the course** option is an X&O fix; the speech is a separate, motivational card.

## Design

1. **The speech card (HC only).** New `MomentKind 'speech'`, side `'hc'`, cap 1, **exempt from `TOTAL_MOMENT_CAP`** (like play calls) so it can never crowd out existing moments. Asked at every halftime when the user is head coach; order in `stepHalftimePhase`: adjustments → QB change → speech (new flag `speechDone`, optional, `?? false`). `defaultId: 'stayCourse'`. Options:
   - **Fire them up** — lands when trailing/tied and the room isn't already hot; backfires (over-amped) when leading big or room morale ≥ 85.
   - **Calm them down** — lands after a sloppy half (≥ 2 turnovers or ≥ 4 penalties) or a narrow lead; backfires (reads as giving up) when trailing by 10+.
   - **Challenge {star}** — one target: the user's highest-OVR starter (QB/RB/WR/TE/EDGE/DT/LB/CB/S) with the weakest first-half line vs his role (reuse `firstHalfPasserRating`; ypc; targets/catches; tackles/sacks from `s.plays`), never the QB just benched. Lands for high `leaderScore` + morale ≥ 60; backfires for `problemScore ≥ PROBLEM_MIN` or morale < 45.
   - **Stay the course** — no effect, no risk; exactly baseline.
2. **Outcome = landed / flat / backfired**, decided by `hash32` (`rng.ts`) on the game key + team + `'speech'` — **no `rng()` draw added or removed**. Land chance = base by fit (good fit ~60%, neutral ~40%, bad ~25%) + HC leadership (`leadershipEdge` scale, ≤ +10%) + named captains with `leaderScore ≥ 70` (+3% each, ≤ +9%) − problem players on the core 22 (−3% each, ≤ −9%) − repetition (−10% per same speech in the last 3 games). Backfire chance ~10% good fit, ~20% neutral, ~35% bad fit; rest flat.
3. **Second-half edge** (Q3, Q4, OT; user's club only): landed +0.6 to +1.0 on the speech's side(s) (fire up/calm: both units; challenge: the star's unit, +1.0); backfired −0.4 to −0.8; flat 0. Clamped to [−0.8, +1.0], applied in-game via `SimEnv.speech`, separate from (and not stacking into) the pre-game `applyUserCoaching` clamp.
4. **Aftermath (post-game, store).** Morale deltas on canonical roster players: landed → core 22 +2 (+1 more on a win); backfired → core −2; challenge landed → star +5, backfired → star −6 (problem player −8); calm/fire-up flat → 0. Feeds `avgMorale` → `lockerEffort` (when opted in) and contract talks — this is the locker-room tie-in. One `logMoment` line: "Halftime: you challenged Jones — he answered: 2 sacks after the break."
5. **Owner reaction** (`ownerPersonality`, bounded ±1 `jobSecurity` per game): meddling owner sends a suggestion that appears in the staff read when trailing ("Owner: light a fire under them"); ignoring it and losing −1. Win-now: a backfire in a loss −1. Patient: no penalty, a landed speech with ≥ 2 mentees playing +1 culture line only. Cheap: no reaction.
6. **AI clubs always stay the course** (no edge) in this phase → AI-vs-AI calibration and league results are untouched. AI speeches are a possible follow-up, only with a zero-mean probe.
7. **Standing order** (Game Plan): "Halftime speech when simmed: Stay the course (default) / Let the staff read the room" — the second picks the best-fit option as the standing answer. Default reproduces baseline.

## Engine hooks

- **New** `src/game/engine/halftimeSpeech.ts` (pure, no rng): `SpeechId`, `speechCandidates(world, plays, teamId)`, `speechFit(...)`, `buildSpeechOptions(...)` (labels, risk tags), `speechOutcome(world, teamId, id, ctx, key)` → `{ id, result, off, def, starId?, line }`, `withSpeech(eff, env, teamId)` (returns `ocEffect` copy with edges adjusted when `env.qtr ≥ 3`), `speechAftermath(world, result, won)` → morale deltas + line, `speechFilmLine(...)`.
- `playsim.ts` (small hooks only): `MomentKind` += `'speech'`; `MOMENT_CAPS.speech = 1`; cap exemption next to `isPlayCall`; `GameState.speech?: Record<teamId, SpeechResult>`, `speechDone?`; `GameCtx.speech?: { leadership, captainIds, recent: SpeechId[], auto: 'stay' | 'staff' }`; build card in `stepHalftimePhase`; `envFor` passes `speech`; wrap the 2+2 `ocEffect` calls in `resolvePass`/`resolveRun` with `withSpeech`; `finishGame` copies `speech` onto `GameSim` (optional field).
- `film.ts`: a `d.kind === 'speech'` line (landed + won the 2H → +1.0; backfired → −1.0).
- `lockerRoom.ts`: optional `LockerRoomState.speeches?: { week, id, result, starId? }[]` (season-scoped, cap 17) + `recentSpeeches(lr, n)`.
- `gameStore.ts`: `userCtx` fills `ctx.speech`; post-game block (~1330, same place as `switchedQb`) applies `speechAftermath`, appends to `lockerRoom.speeches`, owner ±1, `logMoment`; career `halftimeAuto?: 'stay' | 'staff'`.
- Probe `src/game/engine/speechProbe.ts`, registered in `main.tsx` as `__speechProbe` (next to `__lockerRoomProbe`).

## UI touchpoints (redesigned screens, kit in `src/ui/kit.tsx`)

- **MatchView `MomentCard`**: `speech` icons in the kind→icon map (~1368; e.g. Flame / Wind / Target / Anchor from lucide), each option's hint plus a risk `Badge` (Fits / Risky / Likely backfires); staff read shows room morale, captains, owner note. After the answer, a one-line toast "Speech landed / fell flat / backfired" and a small `Chip` beside the user's club on the scorebug for the second half.
- **LockerRoomCard**: "Halftime speeches" row — this season's record as `Badge`s (landed / flat / backfired) and the repetition warning.
- **GamePlanScreen**: the standing-order select in the existing game-management section (`Card` + `SectionTitle`), one-line hint.
- Desktop and 375px, light/dark; reuse kit components only.

## Calibration impact

AI clubs never speak and the user default is Stay the course → AI-vs-AI games and default user games are **identical** to the current main baseline; no `rng()` draws are added, so paused/full equivalence holds. Effects exist only in user games with a non-default choice, bounded by the [−0.8, +1.0] second-half clamp. Keep NFL bands by checking that a forced "always best-fit speech" season moves user 2H point differential by ≤ +2.5/game and total points stay in band.

## Phases (DeepSeek jobs)

| Job | Files (exclusive) | Depends |
|---|---|---|
| **H1 engine** | new `halftimeSpeech.ts`, new `speechProbe.ts`, `playsim.ts` hooks, `film.ts`, `main.tsx` (1 line) | main |
| **H2 store + room + owner** | `gameStore.ts`, `lockerRoom.ts`, `types.ts` (career `halftimeAuto?`) | H1 merged |
| **H3 UI** | `MatchView.tsx`, `LockerRoomCard.tsx`, `GamePlanScreen.tsx` | H1 merged; may run parallel to H2 using the field names above, merge after H2 |

Coordinate with any open `playsim.ts` worker (passid2, v1, b2 worktrees): keep H1's `playsim.ts` diff to the hooks listed.

## Acceptance

- `npm run build` passes; `npm run lint` exactly 4 warnings.
- Real-data `~/gridiron-work/calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4`: outcomes identical to the pre-H1 main baseline; eq 20/20; smokes 0/0; all NFL bands; animation end spots 100%.
- `__speechProbe` (≥ 400 forced user halftimes per option per seed): land/flat/backfire rates within ±5% of the design for good/neutral/bad fit; landed 2H edge shifts user 2H point differential +0.5 to +2.5; backfired −0.5 to −2.0; Stay the course = baseline exactly; no rng draw count change; repetition penalty applies.
- Morale deltas land on canonical roster objects and show in `avgMorale`; `lockerRoom.speeches` and `halftimeAuto` survive save/reload; an old save without them loads; owner ±1 per game max; coordinators (scope off/def/both) never see the card.
- Orchestrator browser check: speech card at halftime, toast + scorebug chip, Locker Room record, Game Plan standing order — desktop/375px, light/dark.

## Risks

- Moment overload at halftime (up to three cards): the speech is exempt from the total cap and counts as a key moment (still asked under "Key moments only"), so keep its card compact.
- Edge stacking with `lockerEffort` and wrinkles: the speech uses its own clamp and Q3+ only; probe the combined worst case.
- Hidden rng drift: any `rng()` call in the speech path breaks equivalence — hash only.
- Challenge target data: first-half defensive stats may be thin; fall back to highest-OVR starter.
- Save compatibility: every new field optional; old in-progress gameDay states default `speechDone` false only while `phase === 'halftime'`.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| H1 engine | ⏳ |
| H2 store + room + owner | ⏳ |
| H3 UI | ⏳ |
