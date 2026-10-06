# HANDOFF — Gridiron Dynasty

## Objective
NFL-only front-office career sim. Current push: build the 20-idea "shape of the game"
roadmap (a Claude-generated list) in agreed layers, keeping build/lint green and the
game's guardrails intact.

## Constraints / requirements
- NFL-only universe (no CFB/recruiting). Legacy saves auto-migrate.
- Keep `npm run build` green and `npm run lint` clean — 5 pre-existing warnings are the baseline.
- Preserve guardrails: no league rot, **no dominant strategy**, AI from imperfect scouting,
  saves small + exportable. Pacing target ~10–15 seasons to GM.
- Node at `~/.local/node` (not system). Repo has many uncommitted changes; nothing committed.
- Layered build agreed with user: deep systems (#6, #14, multi-scenario #16, #18 seeds) DEFERRED.
- #14 (self-scouting chess / tendency exploitation) deferred for guardrail risk (dominant strategy).

## Decisions made
- Build the 20 ideas in layers: L1 spine → L2 personal → L3 systems → L4 presentation-only #4.
- Defer #6 transaction trees, #14 self-scouting chess, multi-scenario #16, #18 seeded runs.
- #4 (reputation) will be presentation-only: keep the 5 rep bars as the engine (they gate
  promotions/balance), add human quotes on top — do NOT rip out the bars.
- #20 pulled the "season question" slice of #11 forward (generated + answered in the recap).

## Done
- **HC/GM authority model** (earlier session): HC = full football-ops control + advise-only on
  roster/cap; GM = final call on roster/cap + out of football ops. `capabilities.ts` + `access.ts`;
  fixed stale duplicate helpers in `career.ts`; role-aware UI copy on Cap/Free Agency.
- **Prestige-gated jobs** (earlier session): New Career list = 8 lowest-prestige clubs;
  in-career offers gated by reputation via `prestigeCeiling()`/`pickInterestedTeam()`. Probe:
  GM ~season 11, HC ~season 10, 0 over cap.
- **L1 spine DONE + verified**:
  - #1 verb per rung — `RungVerb` on `CareerTier`, `VERB_BLURB`, `verbFor()`; shown on Career.
  - #2 one big decision/week — `engine/dilemma.ts` + `components/WeeklyDecision.tsx` + store
    `resolveDilemma`. Culture effects route into leaders' `character` (culture is derived).
  - #8 ghost GM — `engine/ghost.ts`; recorded in `runEndOfRegularSeason`; `GhostCard` on Career.
- **L2 personal DONE + verified**:
  - #5 fingerprints — `PlayerOrigin` stamped on draft/FA/UDFA/trade; `originTag()` in selectors;
    rendered in `MatchView` box score. Verified in DOM.
  - #19 office scene — `components/OfficeScene.tsx` on Dashboard; verified per rung
    (p4 Cubicle, p5 Draft Room, p8 War Room, c5 Position Room, c7 HC Office).
  - #20 season-in-90s — `engine/recap.ts` (season question, moments, headline, fingerprints) +
    store wiring + rebuilt `SeasonModal` review branch. Verified: all five beats render.
- **L3 systems DONE + verified**:
  - #11 personal ambitions — `engine/ambitions.ts` (`makeAmbitionPool`, `gradeAmbitions`,
    `MAX_AMBITIONS=3`), types `Ambition`/`AmbitionKind`, store `pickAmbition`/`dropAmbition`,
    cleared each `startNextSeason`, graded in `runEndOfRegularSeason` (small rep rewards), recap
    beat in `SeasonModal`, `components/AmbitionsCard.tsx` on Career. Verified: pool of 6 (priority
    goals first), pick → 2/3 badge, season reset, 0/2 and 3/3 grading paths, rep aggregation.
  - #17 legacy paths — `engine/legacyPaths.ts` (`legacyProfile`) scoring Champion / Builder /
    Talent Finder / Tree Grower / Lifer from history + ledger + tree; `components/LegacyCard.tsx`
    on Career with leader + evidence + five bars. Verified: leader/evidence/bars correct.
- **L4 presentation DONE + verified**:
  - #4 voices — `engine/voices.ts` (`careerVoices`, `Voice`): six voices (owner, veteran leader,
    rising player, agent, beat writer, division-rival GM) with quotes driven by real state:
    jobSecurity + owner personality, leadership + win%, `origin.by` (#5 tie-in), roster/negotiate
    rep, profile rep, results rep + ghost delta. Bars untouched (presentation only). Names stable
    per career; quotes deterministic. `components/VoicesCard.tsx` ("What They're Saying") on Career.
    Verified: card renders 6 voices; branch tests (low security → loss tone, high rep → win/gold
    quotes, your draftee → gold "He drafted me…"); deterministic; owner name stable across seasons.
- **Quick scout buttons** (user request, post-roadmap): `Scouting.tsx` Class Board rows get a "Quick"
  column — Scout (1 pt) + Work the phones (1 pt) without opening the report; `stopPropagation` keeps
  the row closed; dim at 0 points (click still toasts), disabled when access is locked / character
  fully uncovered. Verified in DOM: conf 14→38, pts −1, charReads +1, row not expanded, 0-pt toast.
- **L5 "Long-arc stories" DONE** (T1–T15; spec `NEXT_PHASE_L5.md`; checkpoint `f16a75d`; build green, lint = 5 baseline warnings):
  - F1 **Trade Tree** (#6) — `engine/tradeTree.ts` (snapAsset, recordTrade, resolveTradePicks, sideValue,
    tradeVerdict, tradeTree) + types, store wiring, Trade Tree tab in `Ledger.tsx`.
  - F2 **Seeded runs** (#18) — `engine/seed.ts` (parseSeed/formatSeed/parseSeedCode); seed opt on `startCareer`,
    both `Math.random()` calls removed; seed input on CareerHub; seed line + copy on Career.
  - F3 **Start scenarios** (#16 light) — `engine/scenarios.ts` (climb/hotSeat/capHell/rebuild) + types,
    store wiring, CareerHub radio cards, Career badge.
  - F4 **Copy fix** — Scouting subtitle → "Evaluating this year's draft class. Spend points to sharpen
    the range, then file your call."
  - F5 **Living objectives** — new `engine/objectives.ts` (`capHealth`, `snapshotDevBaseline`,
    `developedCount`); `roleObjectives` now reads real cap health (personnel 6/7) and development
    (coach 0/1/5); `CareerState.devBaseline` snapshotted in `startCareer`/`startNextSeason`;
    "Your job this week" line on Career; drills limited to once per week + sort comparator fixed.
  - Key files: `src/game/engine/tradeTree.ts`, `src/game/engine/seed.ts`, `src/game/engine/scenarios.ts`,
    `src/game/engine/objectives.ts`.
- **L6 "Every rung is a job" DONE** (U0–U14; spec `NEXT_PHASE_L6.md`; build green, lint = 5 baseline warnings):
  - U0 **Draft truncation fix** — `simulateRestOfDraft` loops to completion, auto-picking best-available for
    the user's club when they auto-finish; all ~220 available picks now resolve and the club drafts ≥ 7 rookies.
  - G1 **Grade your scouts** — `engine/department.ts` (`TRUST_WEIGHT`, `canSetTrust`, `departmentGrade`,
    `calibrationGain`); `bestAvailableFor` takes a `gradeOf` so the user's club drafts from the trust-weighted
    department board; `setScoutTrust` action; season-end calibration reward; StaffBoard trust chips + grade row.
  - G2 **Pound the table** — `engine/conviction.ts` (`canConvict`, `convictionIds`, `convictionPick`,
    `logConvictionPicks`, `convictionPayout`); the Director weighs up to 3 tagged prospects in advise mode;
    every tagged prospect is logged as an `advice` ledger entry and graded 2 NFL seasons later; vindications
    flip the outcome to "Called it"; `toggleConviction` action; Scouting toggles + "Conviction n/3" chip;
    Ledger "Conviction" / "Called it" badges.
  - G3 **Your Room** — `engine/room.ts` (`hasRoom`, `roomPlayers`, `roomBudget`, `applyRoomDevelopment`);
    weekly Run drills banks a rep (max 17) instead of +1 OVR; the season-end budget goes to up to 3 focus
    players (Concentrate) or spreads +1 across the room; develop ledger entries; `toggleRoomFocus` /
    `setRoomPlan`; `components/RoomCard.tsx` on Dashboard.
  - G4 **Portfolio interviews** — `engine/portfolio.ts` (`PitchTag`, `PortfolioItem`, `portfolioItems`,
    `teamWants`, `pitchBonus`; owner personality computed locally with `hash32`); `makeInterview` takes an
    optional `pitch` and only raises citations (never below baseline, capped at 12); `acceptOffer(offer, pitch?)`
    with a "Your pitch landed" toast; `components/InterviewPrep.tsx` (wired into SeasonModal + Career offers)
    and `components/PortfolioCard.tsx` ("Your Résumé") on Career.
  - Key files: `src/game/engine/department.ts`, `src/game/engine/conviction.ts`, `src/game/engine/room.ts`,
    `src/game/engine/portfolio.ts`, `src/components/InterviewPrep.tsx`, `src/components/RoomCard.tsx`,
    `src/components/PortfolioCard.tsx` (plus `draft.ts`, `career.ts`, `store/gameStore.ts` wiring).
  - U15 Personnel gates 5–8 retuned after the draft fix (GM median ≈ season 10 across 6 seeds).

- **L6.5 "Playtest fixes" DONE** (V1–V8; spec `NEXT_PHASE_L6_5.md`; build green, lint = 5 baseline warnings):
  - V1/V2 **Cap fix** — `buildWorld` now targets `capForSeason(season) × (0.79–0.86)` dollars, so stars sit on
    real deals (Allen $48.9M) and clubs use ~80–94% of the cap; `repairCrushedContracts` restates crushed saves
    once (news item logged). V3 — Trade Center player rows show real `contract.capHit` per year.
  - V2b **JSON import re-link** — `relinkPlayers(w)` at the top of `migrateWorld` makes every roster/squad/IR entry
    `===` its `world.players` entry after an export→import.
  - V4/V5 **Deal finder** — `findDeals(world, teamId, playerId)` in `trade.ts` shops a player and returns the best
    acceptable package per club (max 6, `evaluateTrade`-accepted only); "Find deals" button + "Deals for {name}"
    panel in `Trades.tsx` (Load deal fills the builder).
  - V6 **Depth engine** — new `engine/depth.ts` (`STARTERS`, `depthAt`, `depthGroup`, `moveInDepth`,
    `setStarterInDepth`, `resetDepth`) + optional `World.depth` (team → position → ordered player ids).
  - V7 **Sim reads depth** — `playsim` `topGroup` and `statAlloc` `group` now use `depthGroup`, so even an AI club
    with no stored order fields 2 OT / 2 OG / 1 C by default; the league-sim worker snapshot carries `world.depth`.
  - V8 **Depth chart UI** — `DepthChart.tsx` rebuilt: one card per position (Tackles OT, Guards OG, Center C,
    Edge DE, Interior DT + QB/RB/WR/TE/LB/CB/S/K/P); **every** player listed with a Bench divider at
    `STARTERS[pos]`, injured OUT badge, ▲/▼ move buttons and a Start button, plus a "Reset to ratings" header
    button. Editable only for the user's own club when the role can `gameManagement`/`callPlays` or is GM;
    everyone else sees read-only + "The head coach sets the depth chart." Store gains `moveDepth`, `setStarter`,
    `resetDepthChart`.
  - Key files: `src/game/engine/depth.ts`, `src/game/engine/playsim.ts`, `src/game/engine/statAlloc.ts`,
    `src/game/engine/trade.ts`, `src/screens/DepthChart.tsx`, `src/screens/Trades.tsx`, `src/store/gameStore.ts`.

## In progress
- (none) — **all four layers complete.** User said they will test L4 after the build.

## Next move
1. Await user's test pass on L4 (voices card on Career).
2. Optional deferred bucket (only if user re-opens): #6 transaction trees, #14 self-scouting chess,
   multi-scenario #16, #18 seeded runs.
3. If asked to commit: repo is on `main`, everything uncommitted — review `git status` first.

## Key files
- `src/game/engine/ambitions.ts` — #11 ambition pool + grading.
- `src/game/engine/legacyPaths.ts` — #17 legacy-path scoring.
- `src/game/engine/voices.ts` — #4 six reputation voices (presentation only).
- `src/game/engine/recap.ts` — #20/#11 season question, moments, headline, fingerprint summary.
- `src/game/engine/dilemma.ts` — #2 weekly decision engine.
- `src/game/engine/ghost.ts` — #8 ghost-GM projection/verdict.
- `src/game/engine/career.ts` — ladders + `RungVerb`/`VERB_BLURB`/`verbFor`; gates; offers.
- `src/game/engine/capabilities.ts` — role → capability table (**single source of truth**).
- `src/game/engine/access.ts` — locked/view/advise/decide per area; HC/GM special cases.
- `src/game/types.ts` — `PlayerOrigin`, `WeeklyDilemma`, `GhostSeason`, `SeasonQuestion`,
  `SeasonMoment`, `Ambition`.
- `src/game/selectors.ts` — `originTag()`, `playerById()`.
- `src/store/gameStore.ts` — `SeasonSummary` (+ recap/ambition fields), `pickAmbition`/`dropAmbition`,
  resolveDilemma, ghost/recap wiring, `startNextSeason`, `runEndOfRegularSeason`.
- `src/components/SeasonModal.tsx` — #20 broadcast recap incl. ambitions beat.
- `src/components/AmbitionsCard.tsx`, `LegacyCard.tsx`, `VoicesCard.tsx` — #11/#17/#4 UI on Career.
- `src/components/WeeklyDecision.tsx`, `OfficeScene.tsx` — #2 and #19 UI (Dashboard).
- `src/components/MatchView.tsx` — #5 fingerprints in the box score.
- `src/screens/Career.tsx` — verb header, AmbitionsCard, GhostCard, LegacyCard.
- `src/screens/Dashboard.tsx` — hosts OfficeScene + WeeklyDecision.

## Open questions / risks
- **Uncommitted work**: many modified/untracked files; nothing committed. Review `git status` first.
- **Guardrail watch**: #8 ghost must stay a verdict, not a scoring target; #14 deferred entirely.
- **Balance probe** `__balanceProbe(seasons, path)` is slow (~60s); run into a global and poll.
- Real job titles ("Director of College Scouting") and one Scouting subtitle remain college-flavored
  (cosmetic; user may want rewording).
- DOM-verification gotcha: `innerText` reflects CSS `uppercase`; match case-insensitively.

## Next phase planned
- **Phase 7 — "Proof & Memory"** spec is in **`NEXT_PHASE.md`** (repo root). Five features:
  F1 living role objectives (real, live metrics — fixes the hardcoded `health 60/60` and
  `develop 0/2`), F2 NFL-only ladder identity (display-only), F3 transaction trees (#6, bounded
  at 500), F4 seeded runs (#18), F5 scheme fit on the Scouting/Draft board. 17 ordered tasks
  (T1–T17) with per-task acceptance checks, plus a Do-NOT list.
- Baseline: build green, lint = 5 warnings. Implementation has **not** started.
- #14 self-scouting chess stays deferred (guardrail: no provable anti-dominant design);
  #16 multi-scenario and practice-squad development were excluded from this phase.

## Next phase planned — L5 "Long-arc stories"
Spec + ordered task list (T1–T12) in **`NEXT_PHASE.md`** (planned by Claude Opus 5.5; implemented by
DeepSeek Flash 4.1 via OpenCode). Features: F1 Trade Tree (#6), F2 seeded runs (#18), F3 light start
scenarios (#16), F4 Scouting subtitle copy fix. #14 stays deferred. Checkpoint commit before L5: `f16a75d`.
