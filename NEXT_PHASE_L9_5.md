# NEXT PHASE — L9.5 "Playtest 2 fixes"

_Drafted by Claude Opus 5.5 on 2026-10-06 from the user's second playtest. Send after L9 P2–P3 land (see ORCHESTRATION_HANDOVER.md)._
_Lint baseline: exactly 5 warnings. Line numbers marked ~ are approximate (L9 shifted gameStore.ts by ~70 lines): find the code by name._

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| R1 | **Bug:** game plans are wired to the wrong teams | P1 | ✅ done — verified (P1) |
| R2 | Offense plan shows only offense dials, defense plan only defense dials | P1 | ✅ done — verified (P1) |
| R3 | Team rating comparison on the Game Plan "Up Next" card | P2 | ✅ done — verified (P2) |
| R4 | Store a box score for every user game + "Box" button on Schedule | P2 | ✅ done — verified (P2) |
| R5 | Staff screen: role groups (filter tabs) for current staff and hiring candidates | P3 | ✅ done — verified (P3) |
| R6 | Staff budget headroom formula (shows $0 for most clubs) | P3 | ✅ done — verified (P3) |
| R7 | Sortable roster table columns (asc → desc → default) | P3 | ✅ done — verified (P3) |
| R8 | **Bug:** the Fit column shows "—" for every defender | P3 | ✅ done — verified (P3) |

## R1 — Game plan wiring bug (critical)
`src/game/engine/playsim.ts` keeps `LIVE_PLAN = { offTeamId, defTeamId, off, def }`, and `planFor(teamId)` returns `off` for `offTeamId` and `def` for `defTeamId`.
`src/store/gameStore.ts` `advanceWeek` (~line 606) calls `setLivePlan({ offTeamId: career.teamId, defTeamId: <opponent>, off: plan.off, def: plan.def })`.
**Result:** the user's DEFENSIVE plan is applied to the OPPONENT (both their offense and defense), and the user's club uses its OFFENSIVE plan's pass-rush/coverage dials when defending.
**Fix:** change `LivePlan` to `{ teamId: string; off: GamePlan; def: GamePlan }` (the user's club only), and `planFor(teamId, side: 'off' | 'def')`. Then:
offense lookups (`passBias` ~396/462, `timeScale` ~537, `passAdj` ~601) use side `'off'` with the offense team id; defense lookups (`applyDefPlan` ~318, blitz ~357) use side `'def'` with the defense team id.
The opponent gets no plan (null → neutral). Update every `setLivePlan` caller: gameStore ~606, live sim ~1874, dev probe ~2667.
**Acceptance:** build + lint; `__simTest` (AI-only) unchanged. Orchestrator check: setting an extreme user def plan (aggression 2) raises the user's sacks/blitzes, not the opponent's.

## R2 — One side per plan (`src/components/PlanEditor.tsx`, `src/screens/GamePlanScreen.tsx`)
`PlanEditor` gets a `side: 'off' | 'def'` prop. Offense shows only **Run/Pass** and **Tempo**, with offense presets (Balanced, Run Heavy, Air It Out, Clock Killer, Hurry Up).
Defense shows only **Pass Rush** and **Coverage**, with defense presets (Balanced, All-Out Blitz, Bend Don't Break, Stack the Box). Hidden dials keep their current values.
The "What this does" panel and the Coordinator Notes (`describePlan`) only describe the side's own dials (add `describePlan(plan, side)`).
Split `PLAN_PRESETS` by a `side` field.

## R3 — Team rating comparison (`GamePlanScreen.tsx` "Up Next" card)
NEW `teamRatings(world, teamId): { off: number; def: number; overall: number }` in `src/game/engine/depth.ts`. Offense = mean OVR of
`depthGroup(world, teamId, ['QB'],1) + ['RB'],1 + ['WR','TE'],4 + ['OT','OG','C'],5`; defense = `['DE','DT'],4 + ['LB'],3 + ['CB'],3 + ['S'],2`; overall = mean of all 22.
Show both clubs' OFF / DEF / OVR on the card, plus two matchup lines: "Your offense {x} vs their defense {y}" and "Your defense vs their offense", each with a ▲/▼ edge chip.

## R4 — Box score for every user game
Today the **Watch** button (`openMatch`, gameStore ~706) re-simulates the game with today's rosters and no plan/coaching context, so the replay can differ from the real result,
and no box score is saved. **Fix:**
- `Game` (generate.ts) gains `box?: { players: PlayerBoxScore[]; team: Record<string, { passYds: number; rushYds: number; turnovers: number; sacks: number }> }`.
  In `advanceWeek` (~line 627, right after `sim.box = boxScore(world, sim)`), store `userGame.box`: player lines with any non-zero stat, plus team totals summed from them.
  Keep boxes only for the **current season**: clear `box` from games when `startNextSeason` runs.
- `src/screens/Schedule.tsx`: played user games get a **Box** button that opens a modal reusing the `BoxScore` component from `MatchView.tsx` (export it)
  with `game.box.players`, plus a team-totals strip. Rename "Watch" to **Replay** with a tooltip "Re-simulated — may differ from the final."

## R5 — Staff role groups (`src/screens/Staff.tsx`)
Filter tabs above both the current-staff grid and the hiring candidates: **All · Head Coach · Coordinators (OC/DC/ST) · Position Coaches (QB/OL/DL/Secondary…) · Front Office & Scouting (GM/DPP/Scouts)**.
Within a group, candidates sort by OVR desc. Remember the selected tab per session in `localStorage` (try/catch).

## R6 — Staff budget headroom
`Staff.tsx` ~line 27: `localeBudget = prestige * 0.28M − payroll` gives $0 for most clubs (CLE prestige 58 → $16.2M vs $17.6M payroll). It's display-only (hiring doesn't enforce it).
Change it to `Math.round((18 + prestige * 0.3) * 1_000_000) - payroll` (CLE → ~$35.4M budget). Do not add enforcement.

## R7 — Sortable roster columns (`src/components/PlayerTable.tsx`)
Clicking a header cycles **ascending → descending → default order**, with an ▲/▼ indicator. Sortable: Player (name), Age, OVR, POT, Dev, Playbook %, Cap Hit, Dead $, Yrs, and Fit (Ideal > Good > Poor).
Mirror the `sortValue` approach in `src/components/DataTable.tsx`. Sorting state is local to the table.

## R8 — Fit "—" for defenders
`FitBadge` (PlayerTable.tsx ~27) uses `defScheme` for DEF players, but the callers don't pass it. Pass the club's DC scheme (`world.staff[teamId]` role `'Defensive Coordinator'` `.scheme`)
wherever `PlayerTable` is rendered with `showFit`. Also `fitLabel(player, scheme)` calls `schemeFit(p, scheme)` with the default side 'OFF'. Pass the player's side so DEF uses `DEF_FIT`.

## PUSHES
**P1 = R1, R2** (game-plan wiring + one-side plans) · **P2 = R3, R4** (ratings + box scores) · **P3 = R5–R8** (staff groups, budget, sortable roster, Fit fix)
After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings. Never run `npm run dev` or any watch command.

## DO NOT
No changes to sim constants, gates, objectives, capabilities, evaluateTrade, contract pricing. No git commands. Every new save field is optional. Do not edit NEXT_PHASE*.md.

## Verification log
- **P1** (browser, BAL vs IND, 150 seeded games each; the `ds-push` runner hit 2 startup hangs on `--standalone`, so it now uses the shared service by default). **Before R1:** an extreme user DEF plan raised the USER's
  passing yards 265 → 376 (the opponent's defense ran the user's plan). **After R1:** neutral 221/224 (user/opp pass yds) · user Balanced = identical to neutral · user DEF blitz+press → opp 290, user 226 ·
  user DEF soft zone → opp 186, user 217 · user OFF Air It Out → user 299, opp 221. Plans now only affect the side they belong to. R2: offense tab shows Run/Pass + Tempo + 5 presets, defense shows Pass Rush + Coverage + 4 presets; notes are one-sided.
  **Watch:** soft zone (opp 17.5 pts) vs all-out blitz (24.1) against this opponent: check that no defensive preset is dominant across opponents (a balance question for a later phase; planEffects untouched).
- **P2** (browser): the first 2 tries hung at startup. Root cause: `opencode run` blocks reading an inherited, never-closing stdin; fixed with `< /dev/null` in `ds`/`ds-push`, and the next run started in 10 s.
  R3: `teamRatings` BAL 84.6/84.3/84.5 vs IND 79.7/79.5/79.6 (OFF/DEF/OVR); shown on Up Next. R4: after a real `advanceWeek`, `game.box` holds 23 player lines + team totals that match the final;
  the Schedule **Box** modal shows both strips + box scores; **Replay** has the tooltip. Note: the spec's slices total 23 players (11 OFF + 12 DEF), not 22; harmless.
  **Open question for later:** the sim's `TeamGameStats.sacks` showed identical home/away values in every test game, while the box score's `defSacks` differ, so `TeamGameStats.sacks` may be miscounted. Not fixed here.
- **P3** (Flash; reviewed by the OpenCode backup chat, then browser-verified by Claude on 2026-10-07): R5: all 5 role tabs filter both My Staff and the Hiring Market (Coordinators shows only OC/DC/ST;
  Position Coaches only QB/OL/DL coaches), and the choice persists in `localStorage` (`gd.staff.roleGroup`). R6: CLE budget shows **$13.8M of headroom** (was $0). R7: Age ▲ 21,22… ▼ 41,35… then back to default.
  R8: the roster Fit column labels every non-specialist (51 Ideal/Good, 2 "—" for K/P); defenders were all "—" before. `__careerSmoke(6,'coach')` and `(6,'personnel')`: 0 errors, 0 violations. **L9.5 complete.**
