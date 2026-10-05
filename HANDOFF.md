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
