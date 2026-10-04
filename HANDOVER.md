# HANDOVER — Gridiron Dynasty

_Last updated: 2026-10-05 · status: **build green, all systems working**_

A football front-office career sim. You start as a grad assistant / local scout and
climb to NFL General Manager (or Head Coach). This file is everything a fresh chat
needs to continue.

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

**Everything builds and runs. Nothing is mid-refactor.** The most recent work —
playbook mastery driven by **collective cohesion** — is complete and verified.

### Just finished: cohesion-based playbook mastery
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

---

## 3. What exists (all working)

### Universe
- **NFL:** all 32 teams, real brands + colours.
- **College:** 138 FBS programs + conferences.
- **Real data** (`public/data/`, sources cached in git-ignored `.cache/`):
  - `madden26.json` — 1,833 NFL players, exact overalls **+ full attribute set**
  - `cfb26.json` — 11,730 FBS players, exact overalls + core attributes
  - `calibration.json` — **NFL** play distributions from **69,682 real plays**
  - `calibration_cfb.json` — **CFB** distributions from **204,489 real plays**
  - Regenerate: `python3 scripts/ingest.py`, `scripts/mine_gamelogs.py`,
    `scripts/mine_cfb.py` (the last needs `pyarrow`).

### Career (two ladders)
- **Coaching:** Grad Assistant → Position Coach → Coordinator → G5 HC → P4 HC →
  NFL Position Coach → NFL Coordinator → NFL Head Coach
- **Personnel:** Local Scout → Area → Regional → National → Asst Dir → Dir College
  Scouting → Dir Player Personnel → Assistant GM → **General Manager**
- **5-dimension reputation:** evaluation · roster · leadership · results · profile
- **Skills:** evaluation · negotiation · leadership · scheme · recruiting
- **Per-role objectives**, **interview carousel** (can lose to a named rival),
  firing/demotion, season-review + job-offer modals, career news in the inbox.

### Salary cap
Market-value contracts, signing-bonus **proration**, **dead money**, restructures,
rookie wage scale, franchise tags, 53-man cutdown to free agency.
Roster shows **Cap Hit · Dead $ · Years**.

### Games
- **Play-by-play engine** (`playsim.ts`): every snap resolved from exact ratings,
  real yardage distributions, coordinator schemes, scheme fit, **and playbook mastery**.
- Calibrated to real per-team-per-game averages (NFL ~22 pts, CFB ~26).
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
- Live box score, **season + career stats** (college and pro), league-wide box scores
  via `statAlloc.ts`, **Stats Hub** leaderboards (season/career × Pro/College).
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
                PlayerProfile, MatchView, SeasonModal, PlanEditor
  screens/      16: career, dashboard, scouting, roster, depth, gameplan, schedule,
                draft, freeagency, trades, cap, staff, inbox, standings, stats,
                awards, league
  game/
    types.ts         Team/Player/Staff/Contract/DraftProspect/CareerState/PlaybookState
    selectors.ts     derived reads
    persistence.ts   IndexedDB save/load
    data/            nflTeams, cfbTeams, ratings, realData, calibration
    engine/
      rng.ts         seeded RNG
      cap.ts         NFL salary cap
      generate.ts    universe builder
      sim.ts         fast score sim + weekly advance + playoffs
      playsim.ts     play-by-play (+ live game-plan hooks)
      gameplan.ts    in-game dials & presets
      coaching.ts    staff quality → on-field effects
      style.ts       archetypes + scheme fit
      playbook.ts    playbook mastery + cohesion
      career.ts      ladders, reputation, objectives, interviews
      stats.ts       per-player stat accumulation
      statAlloc.ts   league-wide distributed box scores
      statsDb.ts     career statistics database + leaderboards
      awards.ts      MVP / All-Pro / Hall of Fame
      hiring.ts      reputation-gated staff hiring
  store/gameStore.ts   Zustand: UI + world + full game loop
  ui/kit.tsx           design system
```

---

## 5. Known caveats

- NFL individual stats for **non-user games** come from the fast allocator
  (statistically realistic, not true play-by-play).
- No FCS tier — the universe is NFL + FBS.
- When editing in tight loops, watch for duplicated JSX/import blocks (has happened).
- Real team names/ratings are for personal, non-commercial use.

---

## 6. Suggested next steps

1. **Surface team cohesion** on the Dashboard / Game Plan (data already computed) —
   a "Culture" panel showing staff tenure and unit continuity.
2. **Cohesion affects games beyond mastery** — e.g. fewer penalties, better
   situational play for settled teams.
3. **Coordinator scheme choice visible in games** — show the installed system on
   the game-plan screen with a fit report for the roster.
4. Trade AI, practice squad / IR rules, compensatory picks.
5. Update `README.md` and `PLAN.md` (both are slightly behind the latest work).
