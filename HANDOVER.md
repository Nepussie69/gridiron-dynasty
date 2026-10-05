# HANDOVER — Gridiron Dynasty

_Last updated: 2026-10-05 · status: **NFL-only build, green**_
A football front-office career sim. You start at the first **NFL** rung — assistant director of
college scouting (personnel) or NFL position coach (coaching) — and climb to NFL General
Manager / Head Coach. This file is everything a fresh chat needs to continue.

> **The CFB side has been removed.** The universe is 32 NFL clubs only; recruiting, the college
> economy, and the college career rungs are gone. The draft class is still real college players
> entering the NFL. See §2 for the conversion notes.

---

## 1. Environment

**Project dir:** `/Users/aaron/Documents/deepseek-harness/untitled folder`

**Stack:** React 19 · TypeScript · Vite 8 · Tailwind v4 · Zustand · lucide-react

**Node is NOT system-installed.** It lives at `~/.local/node`:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd "/Users/aaron/Documents/deepseek-harness/untitled folder"
npm run dev      # http://127.0.0.1:5173
npm run build    # tsc -b && vite build   ← run after every change
npm run lint
```

> If the browser shows **502**, the dev server died — just `npm run dev` again.

**Dev console probes:** `__simTest(games,'NFL'|'FBS')`, `__staffProbe(n)`,
`__hiringProbe()`, `__simOne(home,away)`.

---

## 2. Current status

**Everything builds and runs.** The most recent work is the **NFL-only conversion**: the CFB
universe, recruiting, and college career rungs were removed, and every career now starts in the
NFL. Build ✅, lint ✅.

### Just finished: NFL-only conversion
- **Universe (`generate.ts`)**: `buildWorld` generates the 32 `NFL_TEAMS` only — no CFB teams,
  rosters, staff, schedule, standings, or playoff. `World.recruits` and `recruitingRank` are gone.
  `generateRecruitClass`, `generateCFBRoster`, `realCfbPlayer` were deleted. `regenerateSchedule`
  and `seedStaffTenure` are NFL-only. Rivals start at the NFL floor.
- **Career (`career.ts`)**: `MIN_NFL_LEVEL = { coach: 5, personnel: 4 }` and `nflLadder(path)`.
  `startCareer` clamps to the NFL floor; `demote`, `applyWilderness`, and `makeSuccessor` all
  clamp to it too. The cross-over block and college-only objectives were removed. NFL rung gates
  were rescaled into a smooth ramp (see §"Balance").
- **Recruiting deleted**: `engine/recruiting.ts`, `screens/Recruiting.tsx`, the store actions
  (`pushRecruit`, `buildRecruitRelation`, `requestRecruitOffer`, `recommendRecruitNIL`,
  `evaluateRecruit`), the `AccessArea 'recruiting'`, the checklist tasks, and the `fundraise`/
  `visit` weekly actions. `Capability` lost `recruit`/`portal`/`nilBudget`.
- **Screens**: Scouting is draft-only; League/Standings/Stats/Awards are NFL-only (toggles
  removed); Dashboard quick actions, News categories, and contacts are pro-flavored.
- **Migration**: `migrateWorld` strips any CFB/FCS teams, rosters, standings, staff, and schedule
  games from a legacy save; `migrateCareer` lifts the level to the NFL floor; `reconcileCareerTeam`
  moves a career off a removed team onto a real NFL club.
- **Verified live**: new worlds are 32 teams / 32 rosters / 32 schedule teams / no `recruits`;
  careers start at level 4 (personnel) or 5 (coach); 3+ season rollovers with no errors; a
  synthetic legacy CFB save migrated to a clean NFL world with a reconciled career.

### Before that: cohesion-based playbook mastery
Mastery is no longer individual loyalty. A player learns through **reps + training**,
but his ceiling is set by **how much his unit and coaches have stayed together**.

- `src/game/engine/playbook.ts` — core of the system:
  - `cohesion(staffTenure, unitAvgYears)` = staffContinuity × unitContinuity
  - `masteryCeiling(fit, cohesion)` — personal fit ceiling scaled by cohesion
    (a churned team reaches only ~half its potential; a settled one reaches full)
  - `gainGameReps`, `gainSeasonTraining`, `refreshCohesion`, `masteryMultiplier`,
    `masteryProgress`, `masteryLabel`, `cohesionLabel`
- `World.staffTenure: Record<string,number>` keyed `` `${teamId}:off|def` ``,
  seeded per team in `generate.ts`; ages up each season, **resets to year 1 when the
  coordinator changes** (detected in `runEndOfRegularSeason` in `gameStore.ts`).
- `PlaybookState` (in `types.ts`): `pct`, `experience`, `reps`, `teamYears`,
  `staffYears`, `cohesion`, `scheme`, `teamId`.
- UI: **Playbook** column in the roster (next to OVR/POT); the player profile shows
  mastery %, game reps, a **Ceiling** number, and a **Team Cohesion** bar with a
  plain-English read.

**Verified:** fresh GM, Josh Allen went **0% → 7% over 6 games**, capped by a
low-cohesion roster. Production multiplier runs **0.90 → 1.18** through the play engine.

### Just finished: culture, trades, and roster rules
- **Culture panel** (`components/CulturePanel.tsx`) on the Dashboard + Game Plan: per-side
  cohesion, staff/unit tenure, average mastery, ideal-fit share, plain-English read.
- **Cohesion now bends the game** beyond mastery — settled teams commit fewer penalties and
  play better on money downs / in the red zone (`coaching.ts` folds cohesion into discipline
  and situational; `playsim.ts` applies a clutch bonus).
- **Scheme Fit Report** (`components/SchemeFitReport.tsx`) on the Game Plan screen; MatchView
  now shows both coordinators' schemes in a top strip.
- **Trade Center is real** (`engine/trade.ts`): partner AI values youth/picks (rebuild) vs.
  veterans (win-now) + positional need, previews a verdict, and executes player/pick swaps.
- **Draft picks are tracked assets** (`engine/picks.ts`): `World.draftPicks`, ownership-aware
  draft order, and **compensatory picks**. Save migration added in `gameStore.hydrate`.
- **Practice squad (16) + injured reserve** with sign/promote/release/place/activate actions,
  surfaced on the Roster screen.
- Dev probes: `__cohesionProbe`, `__draftProbe`, `__draftFlowProbe`, `__seasonProbe`,
  `__tradeProbe`, `__balanceProbe`, `__leaguePbpProbe`, `__leagueWorkerDebug`, `__adviceProbe`,
  `__characterProbe`, `__scoutBiasProbe`, `__rhythmProbe`, `__dominanceProbe`, `__aiManagerProbe`,
  plus `__game` / `__world` handles in DEV.

**Verified:** real-data `simTest(60,'NFL')` still lands at 22.7 pts / 65.4% comp / 42.0%
3rd-down; trade overpay accepted + moved a pick, lowball rejected; PS sign→promote and
IR place→activate all work; 25 comp picks awarded in a season-end clone.

### Just finished: foundation hardening (#2 save/load, #5 balance, #3 league pbp)
- **Saves**: `persistence.ts` now stores `{schemaVersion, savedAt, data}` and rotates a
  **rolling backup**; `hydrate` validates the payload, falls back to the backup, or clears a
  damaged save — never crashes. The career hub shows a **Continue Career** card.
- **Balance harness** `engine/balance.ts` + `__balanceProbe(seasons)` — headless whole-season
  runs reporting scoring, win parity, cap pressure, roster size, promotion pacing. It found and
  we fixed: a player-population collapse (retirement/intake mismatch), cap drift (market values
  not tracking the cap), and a free-agency fill bug (AI signed one player per position).
- **Authentic league sim** `workers/leagueSim.worker.ts` + `engine/leagueSim.ts`: opt-in
  **Fast/Authentic** toggle in the top bar runs every league game through true play-by-play in
  a Web Worker and records real box scores, with fallback to the allocator. `__leaguePbpProbe`.
- Also merged in concurrent work: **role mastery** (`updateRoleMastery`/`masteryCarryOver`,
  `CareerState.roleMastery`), draft pools (`ensureProspectPools`), and `capabilities.ts`.

**Verified:** corrupted primary save recovered from backup; authentic week applied 84 games +
recorded Justin Herbert's stats; `balanceProbe(10)` runs end-to-end.

### Just finished: rungs as jobs (#1 access levels, #2 fog of war, #3 Ledger)
- **Access levels** `engine/access.ts`: `Locked → View → Advise → Decide` per screen area, built
  on `capabilities.ts`. `AccessBadge` shows your level in the top bar per screen; store actions
  (trades, cap moves, staff hires, roster cuts) now refuse when you lack authority.
- **Advise** for the draft: rank a board (`CareerState.userBoard`); `bestAvailableFor` weighs it
  for your club while you lack draft authority, and `simUntilUser` logs whether the NPC Director
  followed or overrode it. `__adviceProbe`.
- **Information quality** `engine/evaluation.ts`: `readProspect` returns a fuzzy grade range
  whose width shrinks with rung + Evaluation skill + scouting; region scope at the low rungs;
  truth/consensus only high enough. The Scouting board and Draft board now show ranges, not raw
  numbers.
- **The Ledger** `engine/ledger.ts` + `screens/Ledger.tsx`: every grade / recommendation / pick /
  advice is dated with the role you held; `gradeLedger` matures calls at season end; career
  batting average and a **My Guys** tab. `CareerState.ledger`.

**Verified:** Local Scout board shows ranges like `91–99` and refuses trades; a recommendation
creates a ledger entry; GM shows "Decision Maker"; `adviceProbe` logged 7 advice entries with 2
followed.

### Just finished: character & evaluating evaluators (#4, #7)
- **Hidden character** `engine/character.ts`: `Character` on every player/prospect, deterministic
  from id. `devModifier`/`bustRisk` feed `developPlayers` (character affects progression + bust
  risk, never current ratings). `makeCharacter` wired into generated prospects and, via a
  post-process, every player. Negative narratives are gated to `generated` players only.
- **Uncover it**: `investigateCharacter` (Work the phones, 1 scouting point) reveals one noisy
  facet; accuracy scales with Evaluation skill + reputation. Shown on the Scouting board.
- **Evaluating the evaluators** `engine/scoutBias.ts`: every staffer has a deterministic
  `ScoutBias`; `scoutReport` files a skewed grade; `recordReport` + `learnedBias` turn their
  Ledger into "Grades X ~N pts high/low". `updateStaffLedgers` runs at season end. A **Staff
  Board** appears on the Scouting screen at Director+ and biases show on the Staff screen.
- **League-health fix**: the balance harness revealed severe **rating inflation** (583 players at
  90+ OVR after 12 seasons) from the generated prospect rating/potential mapping. Retuned →
  **104 stars**, avg OVR 81.8→78.8, cap usage normalized. `__characterProbe` / `__scoutBiasProbe`.

**Verified:** prospects carry hidden character; working the phones revealed a facet; a Director
sees the staff board; 6 evaluators' learned biases read back correctly; 12-season `balanceProbe`
shows 104 stars (was 583).

### Just finished: rung rhythm, people & the world, forks, legacy (#5,#6,#8,#9,#10,#11,#12,#13,#14,#15,#16,#17,#18,#19,#20 + guardrails)
- **Rhythm**: `engine/weekly.ts` (40-hour budget + role menus, annual set pieces, stretch/interim)
  + `components/CareerRhythm.tsx`; store actions `spendHours`/`resolveSetPiece`/`acceptStretch`.
- **People**: `engine/people.ts` (contacts, rival class, media layer, owner personality/mandate,
  mentor + coaching tree) + `components/CareerPeople.tsx`; rivals/era on `World`.
- **Traits/forks/legacy**: `engine/earnedTraits.ts` (deed-based traits that tighten your reads),
  `engine/legacy.ts` (The Wilderness paths + Hall-of-Fame case + successor).
- **Culture**: `engine/culture.ts` (leaders' character × staff leadership × cohesion), shown on the
  Culture panel.
- **College economy (#15) — removed.** The NIL budget, fundraise action, retention/poaching, and
  the whole `engine/recruiting.ts` contest were deleted in the NFL-only conversion.
- **Dense data tables**: `components/DataTable.tsx` (sortable, compact) powers the Scouting board;
  Free Agency uses `PlayerTable`.
- **Eras (#18)**: `World.era` drifts every 6 seasons; biases free-agent pricing.
- **Guardrails**: nav is gated by access (the ladder is the tutorial), **save export/import**,
  `__dominanceProbe` (found air-it-out +1.2 over balanced; run-heavy −7 — a tuning item, not a
  dominant strategy), and AI drafts from noisy consensus grades, not the truth.

**Verified:** nav hides Trade Center / Salary Cap / Draft at Local Scout; Career screen renders
rhythm, contacts, class, mentor, wilderness, traits and legacy; `rhythmProbe`/`dominanceProbe`
return sane data; 8-season `balanceProbe` stays healthy (σ 2.54, cap · 0.96, 53-man rosters).

---

## 3. What exists (all working)

### Universe
- **NFL only:** all 32 teams, real brands + colours, exact Madden 26 ratings. There is no playable
  college league; the draft class is real college players (schools only) entering the NFL.
- **Real data** (`public/data/`, sources cached in git-ignored `.cache/`):
  - `madden26.json` — 1,833 NFL players, exact overalls **+ full attribute set**
  - `cfb26.json` — college players used to build the draft class
  - `calibration.json` — **NFL** play distributions from **69,682 real plays**
  - `calibration_cfb.json` — CFB distributions (shipped; not used by a playable league)
  - Regenerate: `python3 scripts/ingest.py`, `scripts/mine_gamelogs.py`.

### Career (two ladders, NFL-only)
- **Coaching:** NFL Position Coach / QC → NFL Coordinator → **NFL Head Coach**
- **Personnel:** Asst Dir College Scouting → Dir College Scouting → Dir Player Personnel →
  Assistant GM → **General Manager**
- **5-dimension reputation:** evaluation · roster · leadership · results · profile
- **Skills:** evaluation · negotiation · leadership · scheme · recruiting
- **Per-role objectives**, **interview carousel** (can lose to a named rival),
  firing/demotion, season-review + job-offer modals, career news in the inbox.
- **Balance:** gates rescaled to a smooth ramp from the NFL floor. `__balanceProbe` pacing:
  coach reaches NFL HC by ~season 8; personnel reaches GM by ~season 14 (target 10–15).

### Salary cap
Market-value contracts, signing-bonus **proration**, **dead money**, restructures,
rookie wage scale, franchise tags, 53-man cutdown to free agency.
Roster shows **Cap Hit · Dead $ · Years**.

### Games
- **Play-by-play engine** (`playsim.ts`): every snap resolved from exact ratings,
  real yardage distributions, coordinator schemes, scheme fit, **and playbook mastery**.
- Calibrated to real per-team-per-game averages (NFL ~22 pts).
- **2D top-down match viewer** — field, 22 players + ball, animated snaps, live box
  score, play log, playback controls (0.5×–4× speed).
- **Game Plan system** (`gameplan.ts`):
  - **Game Plan tab** (under Team): 8 presets + 4 dials — Run/Pass, Tempo,
    Pass Rush, Coverage. Saved as `defaultPlan`, applied every week.
  - **In-game panel** in the match view: change dials live, the sim re-runs instantly;
    **Lock In Result** to commit.
  - Proven to change outcomes: Run Heavy → 47% run, 9–21 game; Air It Out → 26% run,
    52–10.
- **Coaching effects** (`coaching.ts`): coordinator quality changes play-calling
  edge; position coaches drive **development**; verified **~12-point swing** between
  elite and poor staffs.

### Stats & history
- Live box score, **season + career stats**, league-wide box scores
  via `statAlloc.ts`, **Stats Hub** leaderboards (season/career).
- **Awards** (`awards.ts`): MVP/OPOY/DPOY/ROY, First/Second-Team All-Pro, **Hall of Fame**.
- **Franchise history** per team in the Team Browser.

### Staff
Reputation-gated **hiring market** with live interest %, salary negotiation,
**coordinator scheme choice** at hire time, and firing.

---

## 4. Architecture

```
src/
  components/   AppShell, PlayerTable (+PlaybookCell, DeadMoneyCell, FitBadge),
                PlayerProfile, MatchView, SeasonModal, PlanEditor,
                CulturePanel, SchemeFitReport, AccessBadge, CareerRhythm, CareerPeople
  screens/      18: career, dashboard, ledger, scouting, roster, depth, gameplan, schedule,
                draft, freeagency, trades, cap, staff, inbox, standings, stats,
                awards, league
  game/
    types.ts         Team/Player/Staff/Contract/DraftProspect/CareerState/
                     PlaybookState/DraftPick
    selectors.ts     derived reads
    persistence.ts   IndexedDB save/load
    data/            nflTeams, cfbTeams (draft-class schools), ratings, realData, calibration
    engine/
      rng.ts         seeded RNG
      cap.ts         NFL salary cap
      generate.ts    universe builder
      picks.ts       draft-pick ownership + compensatory picks
      trade.ts       trade value / AI evaluation / execution
      access.ts      rung access levels (Locked/View/Advise/Decide)
      evaluation.ts  information-quality prospect reads (fog of war)
      ledger.ts      career ledger: calls, batting average, My Guys
      character.ts   hidden character (dev curves + bust risk, uncover via phones)
      scoutBias.ts   NPC scout biases + their report ledgers
      weekly.ts      weekly time budget, annual set pieces, stretch assignments
      people.ts      contacts, rivals, media, owner personality, mentor/tree
      earnedTraits.ts traits earned by deeds
      legacy.ts      The Wilderness + Hall-of-Fame case + successor
      culture.ts     culture score from character + leadership + cohesion
      balance.ts     headless multi-season balance harness
      leagueSim.ts   client for the league play-by-play worker
      sim.ts         fast score sim + weekly advance + playoffs
      playsim.ts     play-by-play (+ live game-plan + cohesion hooks)
      gameplan.ts    in-game dials & presets
      coaching.ts    staff quality + cohesion → on-field effects
      style.ts       archetypes + scheme fit
      playbook.ts    playbook mastery + cohesion
      career.ts      ladders, reputation, objectives, interviews
      stats.ts       per-player stat accumulation
      statAlloc.ts   league-wide distributed box scores
      statsDb.ts     career statistics database + leaderboards
      awards.ts      MVP / All-Pro / Hall of Fame
      hiring.ts      reputation-gated staff hiring
  workers/           leagueSim.worker.ts (authentic league play-by-play)
  store/gameStore.ts   Zustand: UI + world + full game loop
  ui/kit.tsx           design system
```

---

## 5. Known caveats

- NFL individual stats for **non-user games** come from the fast allocator
  (statistically realistic, not true play-by-play).
- **NFL-only:** there is no FCS/FBS universe, no recruiting, and no college career rungs. A few
  defensive `tier !== 'NFL'` branches and the `'FBS' | 'FCS'` type remain as safe no-ops.
- When editing in tight loops, watch for duplicated JSX/import blocks (has happened).
- Real team names/ratings are for personal, non-commercial use.

---

## 6. Suggested next steps

**Completed this cycle:** culture panel, cohesion on-field effects, scheme fit report,
trade AI + pick ownership + comp picks, practice squad / IR, foundation hardening
(versioned/backed-up saves + Continue, balance harness, authentic league worker), and the
README/PLAN/HANDOVER doc refresh.

**Roadmap status:** all 20 ideas are implemented and the three tuning targets are addressed:
- **Offensive balance** — added play-action (run-heavy passing bonus) and box-light (pass-heavy run
  bonus); `__dominanceProbe` now reports **no dominant plan** (balanced 55% / air-it-out 51% /
  run-heavy 47% win rate; win spread 8).
- **Career pacing** — relaxed rung gates + fast-track skip-a-rung offers + stronger scouting
  rep gains; `__balanceProbe` now reaches **GM in 14 seasons** for a strong career (target 10–15).
- **Deeper AI** — `runAIResign` (clubs re-sign their own expiring starters) and `runAITrades`
  (AI-to-AI swaps each offseason), plus a star premium in trade valuation. `__aiManagerProbe`.

1. **Draft to your scheme** — surface scheme fit on the Draft board / Scouting so you draft
   players who fit the coordinator's system (data is already in `style.ts`).
2. **Trade depth** — a trade block, multi-team bidding, and cap validation on acquired deals.
3. **Practice-squad development** — tie weekly PS reps to player growth and game-day
   elevations (currently PS is a development holding pen only).
4. **Cohesion in opponent scouting** — show the opponent's culture read on the Game Plan so
   continuity becomes a matchup edge.
5. **Season-long cohesion trends** — track cohesion over time as a first-class career stat.
