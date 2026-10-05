# NEXT PHASE — L5 "Long-arc stories"

_Planned by Claude Opus 5.5 on 2026-10-05. Implemented task by task by DeepSeek Flash 4.1 (OpenCode)._
_Baseline: commit `f16a75d`. `npm run build` green; `npm run lint` = 5 pre-existing warnings
(PlayerTable.tsx:39, Cap.tsx:22, ui/kit.tsx:371, MatchView.tsx:151, MatchView.tsx:160)._

> This is the **active** spec. (`NEXT_PHASE.md` currently holds a separate DeepSeek-drafted "Phase 7"
> plan, kept for reference — do not implement from it.)

## Progress

| Task | What | Status |
|---|---|---|
| T1 | Trade types | ✅ done — verified (push 1) |
| T2 | Pick → player link | ✅ done — verified (push 1) |
| T3 | tradeTree engine | ✅ done — verified (push 1) |
| T4 | Store wiring for trades | ✅ done — verified (push 1) |
| T5 | Trade Tree tab | ✅ done — verified (push 1) |
| T6 | Seed helpers + determinism | ✅ done — verified (push 2) |
| T7 | Seed UI | ✅ done — verified (push 2) |
| T8 | Scenario engine | ✅ done — verified (push 3) |
| T9 | Scenario store wiring | ✅ done — verified (push 3) |
| T10 | Scenario UI | ✅ done — verified (push 3) |
| T11 | Scouting subtitle copy fix | later |
| T12 | Objective metrics engine (cap health + development) | later |
| T13 | Rewire hardcoded objectives + dev baseline snapshot | later |
| T14 | "Your job this week" callout on Career | later |
| T15 | HANDOFF.md docs | later |

## Phase goal

| # | Feature | Why |
|---|---|---|
| F1 | **Trade Tree** (#6) | GMs are remembered for trades. Presentation + bookkeeping only, so no dominant-strategy risk. |
| F2 | **Seeded runs** (#18) | A seed you can see, copy and re-enter means you can replay or share a league. |
| F3 | **Start scenarios** (light #16) | Opt-in starting situations; they change the starting state only, never the rules. Standard Climb stays the default. |
| F4 | **Copy fix** | One college-flavoured Scouting subtitle. Real NFL job titles are kept. |
| F5 | **Living objectives** (bug fix) | `roleObjectives` hardcodes "Keep the cap healthy" as 60/60 and 65/65, so it **always passes** (a free reward). Every "Develop 2 …" objective is hardcoded to 0/2, so it **always fails**. Both now read real numbers. |

Deferred: #14 self-scouting chess (dominant-strategy risk); deep multi-scenario rules.

---

## F1 — Trade Tree

**Player-facing:** The Ledger gets a third tab, **Trade Tree**. Every trade you made shows Gave / Got.
Picks show what they became. Each side shows its current value, with a verdict:
Won / Even / Lost, or Too early for 2 seasons. A trade that sends out assets you got in an earlier trade is nested under that trade.

**Types (`src/game/types.ts`):** `TradeAssetSnap { kind; id; label; resolvedPlayerId?; resolvedName? }`,
`TradeRecord { id; season; week; partnerId; gave; got; parentIds }`, `PlayerOrigin.pickId?`,
`CareerState.trades?` (capped at 60). `World.draftPickIds?: string[]` (in `generate.ts`), parallel to `draftOrder`.

**Draft (`draft.ts`):** `buildDraftOrder` also returns `ids`; `initDraft` stores `world.draftPickIds`; `makePick`
stamps `pickId: world.draftPickIds?.[pickIndex]` (read before `advancePick`). The gameStore migration (~1551) sets it too.

**Engine `src/game/engine/tradeTree.ts`:** `snapAsset`, `recordTrade` (call BEFORE `executeTrade`; parentIds =
earlier records whose `got` holds an id in this `give`), `resolveTradePicks` (match `p.origin?.pickId`),
`sideValue` (`playerTradeValue` for live players / resolved picks, `pickTradeValue` for unused picks, else 0),
`tradeVerdict` (<2 seasons → Too early; ratio got/gave >1.25 Won, <0.8 Lost, else Even), `tradeTree` (roots = no parents).

**Store:** `proposeTrade` records the trade and appends it to `career.trades` immutably. Call `resolveTradePicks` in
`draftProspect`, `simToMyPick`, `finishDraft`, and in `startNextSeason` before `freshDraftPicks`.

**UI (`Ledger.tsx`):** Tab `'trades'` labelled "Trade Tree". Render the tree recursively, with children indented.
Verdict badge tones: Won=win, Lost=loss, Even=neutral, Too early=info. Empty state: "No trades yet — trade authority unlocks higher up the ladder."

---

## F2 — Seeded runs

**Engine `src/game/engine/seed.ts`:**
```ts
export function parseSeed(input: string): number | null   // '' → null; digits → Number % 2147483647; else hash32(trimmed upper) % 2147483647
export function formatSeed(seed: number): string           // 'GD-' + seed.toString(36).toUpperCase()
export function parseSeedCode(code: string): number | null // 'GD-XXXX' → base36 decode; else parseSeed
```
**Store:** `startCareer` opts gain `seed?: number` (in both the interface and the implementation):
`buildWorld(seed ?? (Date.now() % 2147483647), getRealData())`. Replace both `Math.random()` calls in `gameStore.ts`:
- media layer (~584): `makeRng(world.seed + world.season * 911 + world.week * 13 + 1)() < 0.6`
- scoutProspect jitter (~757): `(makeRng(hash32(p.id, world.season * 31 + (p.confidence | 0)))() - 0.5) * 6`

**UI:** CareerHub Advanced section gets a "World seed" input (blank means random), a hint "Same seed → same league. Leave blank for random.",
and red text for an invalid seed. Pass `seed: parseSeedCode(seedText) ?? undefined`. The Career.tsx header card shows
"World seed GD-…" with a Copy button (clipboard call in try/catch, then `showToast('Seed copied')`), using `useWorld().seed`.

---

## F3 — Start scenarios (light)

| id | Title | Path / level | Team | Starting state |
|---|---|---|---|---|
| `climb` | Standard Climb | user's choice | user's choice | unchanged |
| `hotSeat` | Hot Seat | coach / 7 | pool pick | jobSecurity 38; expectation "Playoffs this year — or we make a change." |
| `capHell` | Cap Hell | personnel / 8 | pool pick | jobSecurity 55; dead money = 12% of `capForSeason(world.season)`; expectation "Get us healthy without bottoming out." |
| `rebuild` | The Long Rebuild | personnel / 8 | forced lowest-prestige club | jobSecurity 85; expectation "Three-year plan. Build it through the draft." |

**Types:** `export type ScenarioId = 'climb' | 'hotSeat' | 'capHell' | 'rebuild'`; `CareerState.scenario?: ScenarioId`.

**Engine `src/game/engine/scenarios.ts`:** `Scenario` interface, `SCENARIOS`, `scenarioById` (falls back to climb),
and `applyScenario(world, career, s)`. It sets only jobSecurity, ownerExpectation and scenario, plus the dead money. It must not touch gates, balance or AI.

**Store:** `startCareer` opts gain `scenarioId?`. The scenario's path and level override the inputs, and the existing seedRep loop seeds the reputation.
`forceLowestPrestige` → `[...NFL_TEAMS].sort((a,b)=>a.prestige-b.prestige)[0].id`. Run `applyScenario` before the seasonQuestion line.

**UI:** CareerHub gets 4 radio cards (archetype-picker style). A non-climb pick locks the path and level ("Set by scenario"), and `rebuild` also locks the team.
The button reads "Begin: {title}". Add a muted note: "Scenarios skip the climb — the Standard Climb is the intended way to play."
Career.tsx shows a scenario Badge when the scenario is not climb.

---

## F4 — Copy fix
`src/screens/Scouting.tsx` ~169 subtitle → "Evaluating this year's draft class. Spend points to sharpen the range, then file your call."

---

## F5 — Living objectives (bug fix)

**Bug:** In `src/game/engine/career.ts` `roleObjectives`:
- personnel case 6: `mk('health', 'Keep the cap healthy', 60, 60, …)` and case 7: `… 65, 65 …` (always done)
- coach cases 0, 1, 5: `mk('develop', …, 2, 0, …)` (never done)

**Fix: targets, labels, ids and repReward weights stay exactly the same. Only `current` becomes real.**

**Types (`src/game/types.ts`):** `CareerState.devBaseline?: Record<string, number>`. It maps playerId → OVR at
season start, for young players on your side of the ball (≤ ~30 entries).

**Engine — NEW `src/game/engine/objectives.ts`** (must NOT import `career.ts`; career.ts imports this file):
```ts
/** 0–100. Over the cap → ≤45 (fails both targets); tight → 55–95; $8M+ space → 100. */
export function capHealth(world: World, teamId: string): number
/** Players on your side of the ball, age ≤ 25, at season start: { id: ovr }. */
export function snapshotDevBaseline(world: World, career: CareerState): Record<string, number>
/** How many baseline players are still on your team and gained ≥ 4 OVR since the snapshot. */
export function developedCount(world: World, career: CareerState): number
```
- `capHealth`: `const c = summarizeCap(world.roster[teamId] ?? [], world.deadMoney[teamId] ?? 0, world.season)`;
  `const m = c.space / 1_000_000`. If `c.overTheCap`, return `clamp(Math.round(20 + m), 0, 45)`.
  Else if `m < 8`, return `clamp(Math.round(55 + m * 5), 55, 95)`. Else return 100. (Import `summarizeCap` from `./cap` and `clamp` from `./rng`.)
- "Your side": `career.unitFocus === 'off'` → `p.side === 'OFF'`; `'def'` → `p.side === 'DEF'`; otherwise (or undefined) any side except `'ST'`.
- `developedCount`: if `!career.devBaseline`, return 0. Otherwise count ids in the baseline where the player is on `world.roster[career.teamId]` and `p.ovr - base >= 4`.

**Wiring:**
- `career.ts` `roleObjectives`: personnel cases 6/7 `current` → `capHealth(_world, career.teamId)` (rename `_world` → `world`
  if lint complains). Coach cases 0/1/5 `current` → `developedCount(world, career)`. Change nothing else.
- `gameStore.ts`: set `devBaseline: snapshotDevBaseline(world, career)` in `startCareer` (after the career object
  exists, alongside `seasonQuestion`). In `startNextSeason`, set `devBaseline: snapshotDevBaseline(world, seasonCareer)` on the new season career,
  using the post-rollover world. `developPlayers` already runs before objectives are graded in `runEndOfRegularSeason`
  (~1645 vs ~1717), so season-end grading sees this season's growth.
- Note: development applies at season end, so "Develop 2" reads 0/2 during the season. That's expected; the label is unchanged.

**UI (`src/screens/Career.tsx`):** Above the existing objectives card, add one line: **"Your job this week: {label} ({current}/{target})"**.
Use the first objective with `!done`, preferring the highest `current/target` ratio. Skip the `security` objective unless it is the only one left. If all are done: "Every objective met — keep it rolling."

**Migration:** `devBaseline` is optional; a missing baseline means 0 developed until the next season starts. Nothing else is persisted.

**Guardrail check:** Reward weights and targets are unchanged. Cap health is a band, not "maximise space", so it can't be farmed by gutting the roster
(the floor still applies). Pacing note: coaches can now *earn* the develop reward (+3 leadership) and personnel can now *fail* cap health,
so the net pacing shift is small and goes in both directions. The orchestrator will run a balance probe after T13.

---

## TASK LIST — build green + lint at the 5-warning baseline after EVERY task
- **T1** Trade types. **T2** Pick → player link. **T3** tradeTree engine. **T4** Store wiring. **T5** Trade Tree tab.
- **T6** seed.ts + `startCareer` seed opt + remove both `Math.random()` calls (`grep -rn "Math.random" src` returns nothing).
- **T7** Seed UI (CareerHub input, Career.tsx seed line + copy).
- **T8** scenarios.ts + types. **T9** Scenario store wiring. **T10** Scenario UI + badge.
- **T11** Copy fix.
- **T12** Create `src/game/engine/objectives.ts` (F5) + `CareerState.devBaseline?` type. No callers yet.
- **T13** Rewire `roleObjectives` (only the 5 hardcoded `current` values) + snapshot `devBaseline` in `startCareer` and `startNextSeason`.
  ALSO (anti-farm guard): in `gameStore.ts` `spendHours`, the `'drills'` action may run **once per week**. If `career.weekFlags?.drills`
  is already true, toast "Drills already run this week." and return without spending hours; otherwise set the flag with the existing
  `withFlag(career, 'drills')` helper. Also fix its broken sort comparator `(_a, b) => b.pot - b.ovr` → `(a, b) => (b.pot - b.ovr) - (a.pot - a.ovr)`.
  *Check:* `grep -nE "60, 60|65, 65|, 2, 0," src/game/engine/career.ts` returns nothing.
- **T14** "Your job this week" callout on Career.tsx.
- **T15** Append "L5 Long-arc stories" (F1–F5) to HANDOFF.md → Done.

## DO NOT
- No git commands (commit/reset/checkout/stash). The orchestrator handles git.
- Do not touch the 5 reputation bars or the semantics of capabilities.ts/access.ts, trade evaluation, balance constants, sim calibration, or promotion gates.
- Do not rename the real NFL job titles. No new dependencies. Do not touch `public/data/*` or `scripts/*`.
- Do not fix the baseline lint warnings, and do not reformat unrelated code. Every new save field is optional.
