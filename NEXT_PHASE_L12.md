# NEXT PHASE — L12 "Know your players, own your week": ratings tab, rating glossary, practice week, keys to the game, every rating counts

_Planned by Claude Opus 5.5 on 2026-10-07 from the user's picks in IDEAS_ROUND2.md plus their request for a sortable ratings view._
_Implemented push by push by DeepSeek Flash 4.1. Lint baseline: exactly 5 warnings. Starts after L11.5 is committed. Roadmap for L13–L15: `ROADMAP_L13_L15.md`._

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| R1 | Roster **Ratings** tab: every rating as a column, click to sort ascending/descending | P1 | ✅ done — verified (P1) |
| R2 | Rating glossary: full names + what each rating does in the sim (tooltips, help panel, player profile) | P1 | ✅ done — verified (P1) |
| R4 | Orchestrator polish (user request): key ratings inline in Overview when one position is filtered; a **Stats** tab (season stats by position, sortable) + a stat option in the sort dropdown; **coverage grade 0–100** per game (passer rating allowed when targeted, + INT/incompletions, − TD/explosives; INTs credited to the coverage defender) in the box score (COV), Stats tab and profile | P1 | not started |
| R3 | "Engine composites": the exact scores the sim builds from ratings (QB accuracy, separation, pass rush…) as sortable columns | P1 | ✅ done — verified (P1) |
| W1 | Practice week: Balanced / Install / Sharpen / Rest, each week | P2 | not started |
| W2 | Keys to the game: pick 2 before kickoff, graded after, builds trust | P2 | not started |
| E0 | Every player carries every rating his position uses (generated players included) | P3 | not started |
| E1 | Offense ratings in the sim: QB, RB, receivers, OL | P3 | not started |
| E2 | Defense, kicking and general ratings in the sim: DL, LB, CB, S, K/P, STA, TGH | P4 | not started |
| E3 | Recalibrate to today's numbers; glossary and ⚙ marks updated to "every rating counts" | P4 | not started |

**Guardrails:** keep L10 determinism (`__gameDayEquivalence` n/n), `__simTest` calibration (AI-vs-AI unchanged), `__planMatrix` no-dominant-strategy, canonical player objects, optional save fields.
User-only sim bonuses stay inside the existing clamp (wrinkle + install + practice ∈ [−0.6, +1.5] per side). Rewards ≤ +3 per reputation dimension per feature per season. No changes to gates, objectives,
capabilities, contract pricing or `playsim.ts` formulas **in P1–P2**. P3–P4 are the one approved exception (the user asked on 2026-10-07 for every rating to matter): they edit `playsim.ts`/`sim.ts`, and must end
with league calibration back where it is today (see E3).

---

## P1 — Ratings you can read and sort

### R2 — Rating glossary (`NEW src/game/data/ratingInfo.ts`) — do this first, R1/R3 use it
`export const RATING_INFO: Record<string, { name: string; what: string; sim?: string }>` for every key that appears in `ATTRIBUTE_SCHEMA` **and** every key in the real data
(`public/data/madden26.json` players carry 41 keys: ACC AGI AWR BCV BSH BTK CAR COD CTH DAC FMV HPW IMP JKM JMP KAC KPW MAC MCV PAC PBK PMV PRC PRS PUR RBK RLS SAC SFA SPC SPD SPM STA STR TAK TGH THP TOR TRK TUP ZCV,
plus CIT, DRR, MRR, SRR, RTE, IBL, PUR, RUN from the schema).
- `name`: full name ("Short Accuracy"). `what`: one plain sentence ("Accuracy on throws under 10 yards").
- `sim`: ONLY where `playsim.ts`/`statAlloc.ts` actually reads the key, a short line on how it's used, taken from the code (e.g. SAC: "30% of QB accuracy, which drives completion %, interception risk and yards";
  PBK: "Average of the starting OL = pass protection vs the pass rush (sacks, pressure)"; MCV: "Corners' man coverage; weighted by how much man the DC plays"). Keys the engine doesn't read get no `sim`
  and the UI shows "Not used by the game sim yet". Use the table in the orchestrator's notes below as the source of truth for `sim` lines.
- **Player profile** (`PlayerProfile.tsx`): attribute bars show the full name on hover (`title`), and a small dot marks ratings the sim uses.

### R1 — Roster Ratings tab (`Roster.tsx`, NEW `src/components/RatingsTable.tsx`)
- A tab switch at the top of the roster list: **Overview** (today's table, unchanged) | **Ratings**.
- Ratings tab uses the existing side/position/search filters. Add **position groups** to the position chips for this tab: QB, RB, WR, TE, OL (OT+OG+C), DL (DE+DT), LB, CB, S, K/P.
- Columns: Name, Pos, Age, `OVR/POT` (as Q13 in L11.5), Fit (existing `fitLabel(schemeFit(...))`), then **every rating for that group**: the `ATTRIBUTE_SCHEMA` keys first, then any extra keys the
  group's real players carry that matter for the group (`RATING_COLUMNS` per group, defined in `ratingInfo.ts`; QB adds ACC, TOR, TUP, SFA; RB adds CTH, BTK, CAR, ACC, COD; WR/TE add CTH, SPC, BTK, RLS, ACC, COD; OL adds nothing (PBK/RBK/IMP are already in the schema);
  DL adds ACC, PRC; LB adds ACC, HPW; CB adds ACC, COD; S adds ACC, HPW). Missing values show "–" (generated players only carry the schema keys) and sort last in both directions.
- Values come from the same merge the sim uses: `{ ...attributesFor(p.id, p.pos, p.ovr), ...(p.attrs ?? {}) }` (export a helper `playerAttrs(p)` from `ratings.ts`; do NOT change `playsim.ts`'s own `mkAttrs`).
- **Sorting:** click a header to sort descending, click again for ascending (arrow ▲/▼ on the active column); default OVR desc. Sticky header and sticky name column; horizontal scroll inside the card only.
- Cells are tinted by value (≥90 elite, ≥80 good, ≥70 ok, <70 muted) using existing theme tokens.
- With "ALL" selected show the universal columns only: SPD, STR, AGI, AWR, ACC (when present).
- Header `title` tooltip = `RATING_INFO[key].name — what (sim)`. A "What do these mean?" toggle opens a panel listing the group's ratings with name / what / sim line.
- Clicking a row opens the existing player profile, as in Overview.

### R3 — Engine composites (`ratingInfo.ts`, `RatingsTable.tsx`)
Pure functions that reproduce the sim's own blends (copied weights, no import from `playsim.ts`, and `playsim.ts` is NOT edited):
- QB **Accuracy** = SAC·0.30 + MAC·0.30 + DAC·0.25 + AWR·0.15
- WR/TE/RB **Separation (short / mid / deep)** = route(SRR / MRR / DRR)·0.5 + SPD·0.3 + AGI·0.2
- WR/TE/RB **Hands** = CTH·0.5 + SPC·0.2 + BTK·0.3
- RB **Elusiveness** = BCV·0.35 + JKM·0.20 + TRK·0.25 + SPD·0.20
- OL **Pass pro** = PBK; **Run block** = RBK·0.7 + IMP·0.3
- DL **Pass rush** = max(PMV, FMV); **Run stop** = BSH·0.5 + TAK·0.5
- LB **Run fit** = TAK·0.6 + PUR·0.4
- CB/S/LB **Man** = MCV, **Zone** = ZCV
- K/P **Leg** = KPW·0.5 + KAC·0.5
Missing inputs use 70, exactly like the sim, and the column header says so in its tooltip. These appear as the first rating columns (bold) for the group and are sortable like the rest.
**Acceptance (P1):** build + lint 5; a WR group sorts by DRR both ways with "–" last; composites match a hand calculation for one real player; `__simTest` unchanged (no sim file touched).

---

## P2 — Own the week (coaches)

### W1 — Practice week (`NEW src/game/engine/practice.ts`, store, `WeeklyChecklist`/This Week card)
For careers with `callPlays` (coordinator, HC). Each in-season week pick one practice plan (default **Balanced**, kept week to week):
| Plan | This week's edge (your side(s)) | Other effect |
|---|---|---|
| Balanced | 0 | — |
| Sharpen | +0.4 | your club's weekly injury chance ×1.5 |
| Install | −0.1 | next week +0.3; playbook mastery gain ×1.25 this week |
| Rest | −0.2 | injury chance ×0.6; injured players heal 1 extra game 25% of the time; fatigue −10 |
- `practiceEdge(career, world)` returns `{ off, def }` for the sides `installSides(career)` gives; add it to `extra` in the store next to wrinkle + install, **inside the same clamp** `[−0.6, +1.5]`, and add it to the
  smoke check at ~3793 (violation if outside). AI clubs never get a practice edge.
- Injury chance: in the weekly injury loop (`sim.ts` ~88), multiply the threshold **for the user's club only** (`rng() < 0.012 * mult`). The number of `rng()` draws must not change.
  Extra healing must use a deterministic hash (`player.id + week`), not `rng()`.
- Save: `career.practice?: { plan; week; season }` (optional). Install's "next week +0.3" is read from the previous week's plan.
- UI: a 4-option segmented card in This Week with each plan's effect text, and the current week's choice shown on the game-day header.

### W2 — Keys to the game (`NEW src/game/engine/keys.ts`, `GamePlanScreen.tsx`, `film.ts` card, store)
Before kickoff (game plan screen, and the game-day pre-snap panel) the user picks **2 keys** from 8, each graded from the final box score:
`turnovers` (win the turnover battle), `run120` (rush for 120+), `stopRun` (hold them under 90 rushing), `sacks3` (3+ sacks), `wr1` (their top WR under 60 yards), `third40` (convert 40%+ on 3rd down),
`clean` (allow ≤1 sack), `redzone` (score a TD on every red-zone trip; at least 1 trip).
- Each key shows a staff estimate ("Likely / Coin flip / Long shot") from a deterministic matchup read (`teamRatings` of both sides; no rng).
- After the game: the film card shows each key ✅/❌ with the actual number. Both hit → +1 leadership; one hit → 0; none → −1 (capped at +3 / −3 per season via `career.keysLedger?: { season; net }`).
  Coordinators only pick keys for their side (offense: run120, third40, clean, redzone, turnovers; defense: stopRun, sacks3, wr1, turnovers).
- **No sim effect.** Keys never change the game; they're a promise you're graded on. AI clubs don't pick keys.
- If the user doesn't pick, nothing is graded (no penalty). Save field optional: `career.keys?: { week; season; ids: string[] }`.
**Acceptance (P2):** build + lint 5; `__gameDayEquivalence(20)` 20/20; `__simTest` unchanged; `__careerSmoke(4,'coach')` 0/0 including the new clamp check; one coached week with Sharpen shows the edge,
one game with 2 keys graded correctly against the box score.

---

---

## P3–P4 — Every rating counts (user request, 2026-10-07)
Today the sim reads about 25 of the ratings; the rest (ACC, COD, STR, JMP, STA, TGH, THP, TOR, TUP, PAC, CAR, SPM, SFA, CIT, RLS, PRS, PRC, HPW, IBL, …) are shown only.
Goal: every rating a position carries changes something on the field, in a way a football fan would expect, **without moving league averages**.

**Design rules (all of E1–E2):**
- **Relative terms only.** Each new effect is `(rating − POS_MEAN[pos][key]) × weight`, where `POS_MEAN` is a constant table (NEW `src/game/engine/ratingMeans.ts`) computed once from the real Madden 26 data
  (Flash: compute it offline from `public/data/madden26.json`, starters only = top-N by OVR per team per position, and paste the numbers in). An average player at his position adds 0, so league averages hold.
- **No new `rng()` draws, ever.** Ratings change probabilities, yard terms and who-gets-credit picks; they never add or remove a draw (keeps determinism and the equivalence test simple).
- **Small weights.** One new rating alone moves its outcome by at most ~±10% relative between a 60 and a 95 player. The existing heavy terms (accuracy, separation, PBK vs rush, MCV/ZCV) stay the main drivers.
- Every new term is a named helper in `playsim.ts` with a one-line comment, so the glossary can quote it.

### E0 — Fill the ratings (`src/game/data/ratings.ts`)
`ATTRIBUTE_SCHEMA` gets the extra keys per position (**append to the end of each list**: `attributesFor` jitters by key index, so appending keeps every existing generated value identical).
QB + ACC, TOR, TUP, BTK · RB + ACC, COD, CTH, SPM, SFA, BTK · WR + ACC, COD, CTH, SPC, RLS, BTK · TE + ACC, CTH, SPC, PBK, BTK · OT/OG/C + nothing new ·
DE/DT + ACC, PRC · LB + ACC, HPW, PMV, FMV · CB + ACC, COD, PRC · S + ACC, HPW, JMP · K/P + nothing new. Every position also gets STA and TGH (appended last).
Real players already carry all 41 keys, so for them nothing changes. This also closes the gap where generated receivers read CTH/SPC/BTK as a flat 70.

### E1 — Offense (P3)
| Rating | Where it acts |
|---|---|
| QB THP | Deep throws (≥15 air yds): + to separation-vs-coverage edge and fewer INTs on deep balls; short throws unaffected |
| QB TUP | When `pressureEdge > 0`, part of the pressure penalty to completion is removed (good TUP = less drop-off under pressure) |
| QB TOR, SPD, ACC, BTK | Sack escape: `sackChance` × (1 − small mobility term). TOR also lifts completion on throws made under pressure |
| QB PAC | Scales the existing play-action bonus (`playAction`, `playActionComp`) ×0.7–1.3 |
| QB AWR | Already in accuracy; also lowers INT chance slightly |
| RB CAR | Fumble chance × (1 + (mean − CAR)/100); keeps the style factor |
| RB SPM, SFA, COD, ACC, BTK | Join elusiveness (SPM/SFA/COD small; BTK = yards after contact on runs ≥ 3) |
| RB/TE/WR CTH | Catch: incompletion share on catchable balls (part of `compProb`), for the target only |
| WR/TE CIT | On tight coverage (coverage edge > 0) adds to completion; SPC/JMP add on deep throws |
| WR RLS vs CB PRS | When the defense plays man (`dStyle.manCoverage` high or Press Man preset): RLS − PRS of the coverage defender (L11.5 Q7 `coverId`) adds to short-route separation |
| WR/TE ACC, COD | Join separation (small) |
| TE RBK, IBL; OL STR, AWR | TE joins run blocking at 15% weight; OL STR helps short-yardage runs (≤2 to go); OL AWR blunts the blitz bonus (`blitz ? 9 : 0` → 9 × (1 − AWR term)) |

**E1 also fixes target concentration (found in L11.5 P3 verification).** `resolvePass` picks the receiver with the top score (`route·0.6 + SPD·0.25 + styleBonus + fit·16 + rng()·12`); the fixed terms
outweigh the 0–12 noise, so one receiver gets a median **72%** of his team's targets per game (≥10% of games: 100%). NFL: the top receiver averages ~25–30%. Replace the argmax with a **weighted pick**
(weight = `exp((score − maxScore) / τ)` over the same scored list; choose with the SAME `rng()` draws already made — e.g. use the first receiver's draw as the uniform for the pick and keep the per-receiver
draws as they are, so the draw count is unchanged). Tune τ so the median top share lands at **0.30–0.40** over 120 team-games, then re-check calibration (comp% moves when worse receivers see the ball).
Add a probe `__targetShare(games)` that reports the median / p90 top-receiver share.

### E2 — Defense, kicking, general (P4)
| Rating | Where it acts |
|---|---|
| DL SPD, ACC | Pass rush: join `pressureVals` (small); DL STR vs OL STR adds to rush on power-move rushers |
| DL/LB PUR, SPD | Caps long runs: the run's big-play tail shrinks with pursuit (like `bigPlayRisk` does for passes) |
| DL/LB/S PRC | Play-action and screens lose part of their bonus vs good recognition; LB PRC joins run fit |
| LB BSH | Joins second-level run fit (with TAK/PUR) |
| LB MCV | Man coverage on RB/TE targets (today only CB MCV counts) |
| LB PMV/FMV | Pressure when the call is a blitz (blitz plays add LB rush to `pressure`) |
| CB PRS | Press: short separation down vs man; deep big-play risk up a little if the WR wins (RLS) |
| CB/S JMP, PRC | Interception chance: replaces part of the trait-only `ballHawk` with ratings (keeps the trait bonus) |
| CB/S TAK, S HPW | YAC after a catch shrinks with the tackler's TAK; HPW adds a small forced-fumble chance on catches (uses the existing fumble draw path, no new draw) |
| S SPD | Deep-ball big-play cap (with AWR, already used) |
| K KAC/KPW | Already used; K AWR adds a small late-game (Q4, ≤ 3 pts margin) accuracy term |
| STA (all) | Fatigue: in Q4 a unit's edge drops by `(mean − STA)` × small weight (works with the L10 DL rotation) |
| TGH (all) | Weekly injury roll threshold per player × (1 + (mean − TGH)/150) — same number of draws |
| STR, AGI, ACC (all others) | Folded into the position terms above; nothing is left "shown only" |

### E3 — Recalibrate and document (P4)
- With **all** of E1–E2 in, `__simTest(500,'NFL')` on seed 33333 must land at **23.8 ± 0.4 pts, 66.8 ± 0.7% comp, 64.5 ± 1 plays, 1.75 ± 0.15 sacks, 0.97 ± 0.12 INT, ypc 4.84 ± 0.15**,
  and on seeds 2222 and 5150 within the same bands of their own pre-change values (record them first). If off, scale the new terms' weights (never the old constants).
- `__planMatrix` re-run (800 games per preset): no preset best vs > 5 of 8, none > +1.5 over Balanced. `__gameDayEquivalence(20)` 20/20. `__careerSmoke(6,'personnel')` and `(6,'coach')` 0/0.
- Spread check (new): a probe `__ratingSpread()` that swaps one starter for a ±15 version of himself in one rating and reports the point-margin change over 300 paired games, for ~10 key ratings, so we can see each one matters
  (expect +0.2 to +1.5 pts each) and none is huge (> 3 pts).
- `RATING_INFO.sim` lines and the Ratings tab ⚙ marks updated so every rating shows what it does.
**Acceptance (P3):** build + lint 5; equivalence 20/20; calibration within the bands above with only E0+E1 (re-tune E1 weights if needed). **(P4):** everything in E3.

## Orchestrator notes: what each rating does today (source for `RATING_INFO.sim`)
From `playsim.ts` (play-by-play, used for every game) and `statAlloc.ts` (how season stats are shared between players):
- QB: SAC/MAC/DAC/AWR → accuracy (30/30/25/15) → completion %, interceptions, yards. THP → share of passing stats (statAlloc). SPD/AGI/RUN/PAC/STR not read.
- Receivers: SRR/MRR/DRR (by throw depth ≤7 / 8–14 / 15+) 50%, SPD 30%, AGI 20% → separation; route + SPD also decide who gets targeted. CTH 50% / SPC 20% / BTK 30% → yards after the catch.
  CTH + SPD → share of receiving stats. CIT, RTE, JMP not read.
- RB: BCV 35 / JKM 20 / TRK 25 / SPD 20 → elusiveness (run yards). BCV + SPD → share of rushing stats. CAR not read (fumbles come from the back's style, not CAR).
- OL: PBK average → pass protection vs the rush. RBK 70 / IMP 30 → run blocking.
- DL: best of PMV/FMV per lineman, averaged → pass rush (sacks, pressure). BSH 50 / TAK 50 → run defense.
- LB: TAK 60 / PUR 40 → run defense at the second level; ZCV → zone coverage.
- CB: MCV → man coverage (weighted by how much man the DC plays); ZCV → zone coverage.
- S: ZCV → zone; AWR → a small extra coverage bonus.
- TAK 50 / PUR 30 → share of tackles (statAlloc).
- K/P: KPW 50 / KAC 50 → field-goal make chance and range; KPW → punt distance; KAC → extra points.

## PUSHES
**P1 = R2, R1, R3** · **P2 = W1, W2** · **P3 = E0, E1** · **P4 = E2, E3**
After every task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings. Never run `npm run dev` or any watch command. No git commands.

## DO NOT
- P1–P2: do not edit `playsim.ts` formulas or `statAlloc.ts`. P3–P4: only add the new relative terms; do not change existing constants. Do not change gates, objectives, capabilities, contract pricing, or AI-vs-AI calibration. Do not add or remove `rng()` draws anywhere (all pushes).
- Do not copy player objects. No new dependencies. Do not fix the baseline lint warnings. No temp files in the repo.
- Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md` or `IDEAS_*.md`. `HANDOFF.md`: append only (one "L12" section, in the last push).

## Verification log
- **P1** (Flash 10 min; browser-verified by Claude on 2026-10-07). 48 rating keys in `RATING_INFO`, 28 with a `sim` line. Roster → Ratings → DL shows Pass rush / Run stop composites then SPD…PRC;
  PMV sorts 87→… desc and 68→… asc; header tooltip "Power Moves — … sets the pass rush". Mahomes Accuracy 92 = hand calc. No sim file touched.
  **Orchestrator fix:** the K/P Leg composite defaults to 78 (as the sim does), not 70. **Note:** real players carry no DRR/MRR/SRR/CIT/RTE, so those columns show the derived values the sim also uses.
  **Also on 2026-10-07 (user request, Claude):** game-day screen redesign, one page, commit 5502792.
