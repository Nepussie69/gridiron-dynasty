# Animation realism — ratings- and call-driven NFL animation, calibrated (FUTURES #30)

User (2026-10-10): "try and get all these similar things within normal NFL gameplay within the animation … correlate it to their ratings and skills as a player … the most realistic animation possible based off who the players are and the coaches' calls." And: physics-driven animation is wanted, but "find a way to include the stats calibration with the animation."

## Principle

Every movement on screen is explained by **who the players are** (canonical `playerAttrs` ratings, never raw Madden fields — derived SRR/MRR/DRR/CIT/IBL etc. come from `src/game/data/ratings.ts`) and **what the coaches called** (concept, personnel, blitz/coverage call, play action, tempo, halftime fixes, user moments). Nothing is random-looking: deterministic per-play hashes only, no `rng()` draws.

Calibration is a first-class constraint at every stage: the 31 NFL bands × 3 seeds × 500 games, equivalence 20/20, smokes 0/0 and end-spot match are acceptance gates for every phase, exactly like the engine.

## Architecture

### 1. Matchup script (shared foundation)

Before drawing a play, build a `MatchupScript` from the recorded `Play` + the 22 actual actors (`ctx.actors`, the shared actual-11 from the engine) + the calls:
- every player's **assignment** (pass set / run block scheme / route / man target / zone landmark / rush lane / blitz gap / contain / spy / return lane …),
- every **matchup pair** (blocker↔rusher incl. doubles, receiver↔defender, carrier↔tackler, gunner↔jammer),
- each matchup's **edge** = rating differential for that matchup type (table below), and the **outcome constraint** it must satisfy from the recorded play (e.g. "rusher X beats tackle Y at 2.6 s" for a recorded sack; "target separation ≤ 0.8 yd at catch" for a contested completion).

### 2. Ratings → motion library (`src/components/anim/`)

One shared, tested module mapping ratings to physical parameters, replacing ad-hoc constants:

| Parameter | Ratings |
|---|---|
| top speed, acceleration, deceleration | SPD, ACC, AGI, (weight/height) |
| change of direction / cut sharpness, break crispness | COD, AGI, route rating for the depth (SRR <7 yd, MRR 7–14, DRR 15+ — same split as `playsim.ts`) |
| reaction delay (diagnose → move) | AWR, PRC (play recognition), ZCV/MCV for coverage |
| engagement strength / leverage | PBK·PBP·PBF vs PRS·PMV·FMV (pass), RBK·RBP·RBF·IBL vs BSH·STR (run) |
| shed / beat time | PMV/FMV/BSH vs blocker's matching rating |
| ball skills | CTH, CIT, SPC, JMP, (defender) PRC·MCV·ZCV for PBU/INT |
| ball-carrier moves | JKM, SPM, SFA, TRK, BTK, BCV, CAR |
| tackling / pursuit | TAK, HPW, PUR, STR |
| QB | THP, SAC/MAC/DAC, TOR, PAC, AWR, TUP (throw under pressure), release time |
| stamina effect late in drives / games | STA (existing stamina model) |

### 3. Calls → play shape

Concept → routes/run scheme; personnel → who is on the field; coverage call (man / zone / disguise; Cover 0/1/2/3/4 shells) → alignments, rotation, landmarks; blitz → who rushes and from where; play action / screen / RPO / QB keep timing; tempo and two-minute → huddle vs line-up; user moments and halftime fixes (max protect = TE/RB stay in, quick game = shorter drops, load the box = 8 in the box, two-deep = shell) change the shape visibly. Pre-snap: motion, press vs off, safety depth, showing vs disguising pressure.

## Calibration with physics — the staged path

Physics is the goal; the sim stays the source of truth until physics *proves* it reproduces the same NFL statistics. Three modes, behind one flag, each measured by the existing harness:

**Mode A — Explained (current, harden it).** The engine decides the result; the animation explains it through the matchup script. Stats are untouched by construction. Phases 1–6 below deliver this first.

**Mode B — Guided physics.** A real 2-D physics step (positions, velocities, acceleration limits, collisions/engagements, ball flight) runs every frame from the ratings library, with a light **controller** that steers toward the recorded outcome (e.g. biases the losing blocker's leverage so the recorded sacker wins at roughly the recorded time). Gates: end spot exact, result identical, and the **steering effort** stays small (measured: mean and p95 corrective force per play; plays needing large correction are logged as "physics disagrees with the sim", which is itself calibration data). Stats unchanged by construction; motion is now physical.

**Mode C — Calibrated physics.** Physics decides the outcome. To keep stats calibrated:
1. **Headless physics sim** — the same physics step runs without rendering, fast enough for the calibration harness (target: 3 seeds × 500 games in under ~10 min; budget per play measured).
2. **Shadow calibration** — while the engine still owns results, run physics headless on the same plays and compare distributions with the engine and with the 31 NFL bands (completion %, YPA, YPC, sacks, pressures, missed-tackle %, explosive plays, INTs, PBUs, return yards, scoring). Fit the physics parameters (the ratings → motion constants) with deterministic sweeps until physics alone passes all bands on all seeds. Same honesty rules as the engine: no seed overrides, no band or stat-definition changes, ratings directions preserved (better player → better outcome, measured).
3. **Fast-sim consistency** — league games that are not animated keep the fast engine, re-fitted so its distributions match the physics distributions (the existing `gameDayEquivalence` extends to physics-vs-fast); otherwise a watched game and a simmed game would disagree.
4. **Switch** — only when physics passes every gate on all seeds does it become the result owner for animated games (behind the flag, user-visible setting "Engine: classic / physics"); the classic engine remains as fallback and as the fast sim.

The sim's existing decisions (play calls, 4th-down, clock, penalties, injuries, personnel) stay in the engine in every mode — physics only resolves the snap-to-whistle outcome.

## Phases (each a separate DeepSeek job, verified before the next)

| # | Phase | Contents | Key measured checks |
|---|---|---|---|
| 1 | Foundation | `MatchupScript`, ratings → motion library, migrate existing build* functions onto it without changing results | anim end spots 100%, calibration identical, no frozen carriers / overlaps, speed ≤ rating limits |
| 2 | Line play + QB | pass sets, slides, doubles/chips (#152), stunts, rush moves by PMV/FMV/BSH, pocket movement, step-up/scramble, release timing; blitz pickup | time-to-pressure vs rush-rating edge correlation; % sacks by doubled rusher; recorded sacker visibly wins |
| 3 | Routes + coverage | route running vs MCV separation (#153), man trail/hip pocket, zone landmarks + break on ball (#151), shells/rotations, contested catches, PBU/INT positioning | separation-at-break vs (route − MCV) correlation; separation-at-catch by result; every route covered |
| 4 | Run game | zone vs gap schemes, pulls, double to linebacker, back's vision/cutbacks (BCV), cut-off/seal blocks, box count from calls | yards-before-contact vs (run block − box) correlation; cutback rate vs BCV |
| 5 | After the catch + tackling | jukes/spins/stiff arms/trucks by rating, broken tackles = recorded missed tackles, pursuit angles (PUR), gang tackles, carrier never freezes (#150) | broken tackle shown ⇔ recorded MT (100%); tackler arrival within pace limits |
| 6 | Special teams + pre/post snap | lanes, wedges, gunners vs jammers, returner lane choice by vision, onside/squib looks (FUTURES #4), motion, huddle/tempo, celebrations | all kick plays end spots exact; KR/PR identity = sim returner |
| 7 | Mode B guided physics | physics step + controller | steering effort mean/p95, % plays physics-disagrees, all mode-A checks |
| 8 | Mode C shadow + switch | headless physics, shadow calibration, fast-sim refit, flag/setting | **31/31 bands × 3 seeds × 500 from physics alone**, physics↔fast equivalence, ratings-direction tests, performance budget |

Jobs already queued/running on `wt-animcontact` (animcontact3 = #150/#151, animcontact4 = #152/#153) are early pieces of phases 2, 3 and 5; Phase 1 folds them into the shared library.

## Review tooling

- **Probe** (`animRealismProbe`): per-phase metrics above over thousands of recorded plays and several seeds.
- **Play gallery** (dev route): recorded plays filtered by matchup type (sacks, doubles, contested catches, broken tackles, cutbacks, returns), playable in MatchView for visual review at desktop/375px, light/dark.
- Ratings-direction tests: swap a player's rating up/down on the same recorded play and assert the visual edge moves in the right direction.

## Acceptance (every phase)

Build, lint exactly 4; real-data calibration 3 × 500 with `--eq --smoke=coach:4,personnel:4` identical to the pre-phase baseline in modes A/B (and passing all bands in mode C); anim end spots 100%; phase-specific probe numbers; orchestrator browser check of the play gallery and live MatchView.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-10 |
| animcontact3 (#150/#151) | 🔨 running on wt-animcontact |
| animcontact4 (#152/#153) | 📋 staged |
| Phases 1–8 | ⏳ after the held animation work is integrated with the accepted realism engine |
