# Draft philosophy by GM role + coaching staff — FUTURES #27

User (FUTURES list, 2026-10-10; backlog 142): set a draft philosophy (BPA / need / scheme fit / trade-down volume / traits-vs-production / character risk). The scouting director, personnel director, AGM and the coaching staff each hold their own view, argue in the draft room, and the board is weighted by who has authority at your career level. Builds on career philosophy, conviction/red-flag tags and staff.

## Goal

Turn the draft from "one grade + a flat need bonus" into a room of people with stances. Your stance counts as much as your seat allows: an Assistant Director gets heard, a GM decides. The room's blended stance changes **only your own club's picks** (AI clubs keep their current logic unless you turn on the optional AI identities). Every pick shows who won the argument and why, and the existing ledger grades the outcome.

## Already built (extend, do not duplicate)

- **Pick scoring:** `draft.ts:bestAvailableFor(world, teamId, advice?, gradeOf?)`. Score = grade + need bonus 6 (`teamNeeds`) + position premium 2 (QB/DE/OT/CB) + board advice `adviceWeight × max(4, 30 − 4·idx)`. This is the hook point.
- **Your club's simulated picks:** `draft.ts:simUntilUser`. It uses `department.ts:departmentGrade` (G1 trust-weighted evaluator grades), skips `redflag.ts:redFlagIds` (K4) and lets the Director follow a `conviction.ts:convictionPick` (G2; seeded through a local `makeRng(world.seed + season·97 + pickIndex)`, not the world rng). It logs `advice` ledger entries.
- **Authority:** `access.ts:accessFor(career,'draft')` gives locked/view/advise/decide. `capabilities.ts:canDraft` / `rankBoard` / `setBoard`. Coach L7 HC = draft *advise*; personnel L8 GM = *decide*. Ladder titles are in `career.ts:PERSONNEL_LADDER` (L4 Asst Dir College Scouting, L5 Dir College Scouting, L6 DPP, L7 AGM, L8 GM).
- **Staff stance seeds:** `types.ts:StaffMember.focus` (Scout: College East/West/Pro/**Character**; DPP/GM: Pro scouting/Negotiation/**Cap**/**Analytics**). `scoutBias` axis (speed/size/**production**/conference/**character**). `hiring.ts:frontOfficeProfile`. Coaches have `scheme`. `StaffRole` has no Scouting-Director or AGM role.
- **Career philosophy:** `people.ts:PHILOSOPHIES` (tape/measurables/character/analytics) via `mentorFor`, shown in `CareerPeople.tsx`. `types.ts:790 career.philosophy?: string` (#14) is declared but **never written**. Leave it alone.
- **Scheme fit:** `style.ts:schemeFit(p: Player, scheme, side)` reads only `p.traits[0]`, and prospects have `traits`.
- **Character:** `character.ts:riskLabel`, `DraftProspect.characterReads` (uncovered, noisy facets). Only *visible* reads may drive stances (no truth leakage).
- **Draft-day trades:** `draftTrades.ts:buildDraftTradeDownOffers(world, userTeamId, limit = 4)` and store `acceptDraftTradeOffer(id)`. The sim never trades on its own.
- **Voices/UI:** `voices.ts:Voice` (role, name, quote, tone). Draft War Room `screens/Draft.tsx` and Scouting conviction/red-flag menus `screens/Scouting.tsx` were redesigned on **`ui-redesign` (d1e17c5, not yet merged to main)**, with kit `AccessBanner`, `KpiStrip`, `SegmentedControl`, `Sheet`, `ConfirmSheet`, `People.tsx:Avatar`, `Kpi.tsx:VerdictChip/DivergingMeter/TierScale`, `Controls.tsx:OptionGroup/OptionCard`.
- Smoke `exerciseOncePerSeason` (gameStore ~6664) already exercises setScoutTrust/toggleConviction/toggleRedFlag.

## Design

**Philosophy vector** (new `src/game/engine/draftRoom.ts`, `type DraftPhilosophy`). Each axis has 3 steps; the middle step is the current sim's behavior.
| Axis | Steps (default **bold**) | Score effect (bounded) |
|---|---|---|
| Board | BPA / **Balanced** / Need | need bonus 2 / **6** / 11 |
| Scheme fit | Ignore / **Light** / Heavy | 0 / **0** / +3 when `schemeFit(...)=1` vs OC/DC scheme for the prospect's side |
| Trade-down volume | Stand pat / **Open** / Accumulate | offers shown 2 / **4** / 6. Accumulate also lets the room take a trade-down (below) |
| Traits vs production | Traits / **Neutral** / Production | ±min(4, (pot−ovr−classMean)/3) vs ±min(4, (production−62)/9) |
| Character risk | Avoid / **Neutral** / Gamble | Avoid: −6 for a visible read `riskLabel ∈ {Elevated, High}` and −3 for a visible facet `Red flag`. Gamble: +2 on those (talent discount) |
The sum of philosophy deltas is clamped to **±12**, so grade still dominates. An all-default vector adds exactly 0.

**Seats and stances.** `roomSeats(world, career)` returns 4–6 seats: Scouting Director (top-rated `Scout`), Personnel Director (`Director of Player Personnel`), AGM (no StaffRole: a hash-named NPC from `hash32(teamId,'agm')`, like the voices.ts rival), GM (`General Manager`), Head Coach, plus the coordinator whose side has the biggest need. When the user holds a seat, the user's own philosophy fills it. NPC stances are deterministic, with no rng draws:
- Scout focus Character → Avoid. Bias production → Production, speed/size → Traits.
- DPP/GM focus Cap/Analytics → Accumulate + BPA. Negotiation → Open.
- HC: mentor philosophy maps tape → Production, measurables → Traits, character → Avoid, analytics → BPA. Scheme fit is Heavy.
- Coordinators: Need + Heavy fit.
- The remaining axes come from `hash32(staff.id, axisIndex)` with a 60% weight toward the default.

**Authority weights** (`seatWeights(career)`) sum to 1. The pen holder gets 0.45 and the user gets `adviceWeight(career)` scaled by rung:
| Your rung | Your weight | Pen |
|---|---|---|
| Personnel L4 (advise) | 0.10–0.20 | GM |
| L5 Dir College Scouting | 0.20–0.30 (you own the board order) | GM |
| L6 DPP | 0.30–0.40 | GM |
| L7 AGM | 0.45 (co-pen; GM breaks ties) | GM |
| L8 GM (decide) | 1.0 for your own clicks. Auto/clock picks use your vector at 0.7 + room 0.3 | you |
| Coach L6 coordinator | 0.10 (only your side's positions) | GM |
| Coach L7 HC (advise) | 0.35 | GM |
The blended vector is a weighted mean per axis, rounded to a step.

**Argument.** `roomArgument(world, career, k = 3)` gives each seat its top guy by `grade + delta(seatVector)`, a one-line reason built from the axis that moved him most ("He fits the 3-4 — we need edge help"), and a `consensus` flag. The pick is `bestAvailableFor(..., tilt = blendedDelta)`. After the pick a ledger `advice` note names the seat whose guy went ("The AGM's call won the room"). No new LedgerKind is needed.

**Room trade-down** (Accumulate only, while advising, your club on the clock in sim): take the best `buildDraftTradeDownOffers` offer when its value is ≥ 1.08× and the blended top guy is still within 4 points of the best grade 3 slots later. The choice is deterministic: `h01(seed, season, pickIndex)` < blended trade weight. It reuses the `acceptDraftTradeOffer` internals (factored, not copied).

**Activation and baseline.** Tilt applies only when `career.draftPhilosophy?.season === world.season` (you set it this draft). Otherwise the room argues on screen but picks use today's exact path. Old saves are valid (new fields optional). AI clubs are untouched. Optional `career.aiDraftIdentities` (off; same pattern as `deadlineAI`) gives AI GMs a hashed vector in a later phase.

## Engine hooks

- `draft.ts:bestAvailableFor`: new optional 5th param `tilt?: (p) => number`, added to the score. With it absent the scoring is byte-identical.
- `draft.ts:simUntilUser` / `simulateRestOfDraft`: for `teamId === career.teamId` and an active philosophy, pass `roomTilt(world, career)`. Keep the red-flag/conviction order (red flag first, then tilt, then conviction).
- `style.ts:schemeFit`: widen the param to `Pick<Player,'traits'>` (type-only change).
- `types.ts` CareerState: `draftPhilosophy?: DraftPhilosophy & { season: number }` and `aiDraftIdentities?: boolean`.
- Store: `setDraftPhilosophy(axis, step)` (gated `canAdvise(career,'draft') || canDecide`) and `setAiDraftIdentities(v)`. Smoke `exerciseOncePerSeason` adds `setDraftPhilosophy` (Board→Need, Character→Avoid).

## UI touchpoints (ui-redesign kit; base DF3 on `ui-redesign` or on main after it merges)

- **Draft.tsx (War Room):** add a `Room` option to the existing view `SegmentedControl` (List / Cards / Room). Room view is a new `components/DraftRoom.tsx`: one row per seat (`Avatar`, title, stance `VerdictChip`s for non-default axes, an authority bar that `DivergingMeter` restyles as %, "our guy" with grade). It has a consensus/split banner, and the pen holder's line is highlighted. On phone the seats stack and the argument sits in a `Sheet`.
- **Scouting.tsx:** a "Draft philosophy" card next to the conviction/red-flag counters, using `OptionGroup` + `OptionCard` for 5 axes × 3 steps with a one-line hint each. An `AccessBanner` shows your weight ("Your voice: 25% — the GM holds the pen").
- **Staff.tsx:** each front-office/coach card gets a compact stance chip row (max 2 non-default axes).
- Desktop + 375px, light/dark, no horizontal scroll. Reuse kit only, no new primitives.

## Calibration impact

None on game sim: the draft runs offseason and calibration measures fresh-world games. AI picks do not change (they only shift downstream when your club takes a different player). With `draftPhilosophy` unset, all 224 picks are identical to main. No world-rng draws are added or removed (`hash32`/`h01` only), so `--eq` stays 20/20. Personnel smoke only gains a `setDraftPhilosophy` count.

## Phases (DeepSeek jobs, non-overlapping files per parallel lane)

| Job | Files | Depends |
|---|---|---|
| **DF1** engine + state: philosophy, seats, weights, tilt, argument, store actions, smoke | new `engine/draftRoom.ts`; `draft.ts`, `style.ts`, `types.ts`, `gameStore.ts` | main |
| **DF2** room trade-down + Accumulate offer limit + ledger notes | `draftRoom.ts`, `draftTrades.ts`, `draft.ts`, `gameStore.ts` (factor accept internals) | DF1 |
| **DF3** UI (parallel with DF2) | new `components/DraftRoom.tsx`, new `components/DraftPhilosophyCard.tsx`; `screens/Draft.tsx`, `Scouting.tsx`, `Staff.tsx` | DF1, ui-redesign |
| DF4 (optional) AI draft identities toggle (off by default) | `draftRoom.ts`, `draft.ts`, Draft.tsx toggle | DF2, DF3 |

## Acceptance

- `npm run build` passes, `npm run lint` shows **exactly 4** warnings.
- `node ~/gridiron-work/calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4` (via the loader in OPENCODE_CONTINUE.md): points and NFL bands identical to the before-run on main (`~/gridiron-work/logs/<job>-calib-before.out`), eq 20/20, smokes 0 errors / 0 violations, `setDraftPhilosophy` ≥ 4.
- Probe (`~/gridiron-work/draftroom-probe.mjs`, 3 seeds × full draft):
  1. Philosophy unset → all 224 picks identical to main.
  2. Need vs BPA moves your club's picks toward roster holes (need-hit rate rises).
  3. Avoid → zero visible-High-risk picks by your club.
  4. Heavy fit → fit-1 share rises.
  5. Seat weights sum to 1 at every rung on both paths, and the user's weight rises monotonically L4→L8.
  6. Accumulate → ≥ 1 room trade-down across seeds, never at Stand pat.
  7. Save/reload keeps `draftPhilosophy`, and an old save loads.
- Browser check by the orchestrator: Room view + philosophy card + staff chips, desktop/375, light/dark.

## Risks

- **Truth leakage:** stances must read `characterReads`/`myGrade`, never `character`/`trueGrade`. The probe greps draftRoom.ts.
- **Redesign drift:** Draft/Scouting/Staff differ between main and ui-redesign. Base DF3 on ui-redesign and merge it after the redesign lands.
- **Over-steering:** the ±12 clamp keeps elite talent from sliding. Watch that QB/premium picks are not lost to Need.
- **Conflicts with conviction/red flag:** red flag always wins, and conviction is still offered after the tilt. Do not double-count `adviceWeight` (board advice and seat weight both use it). Use the seat weight for the tilt only.
- The new AGM NPC must not collide with a voices.ts name. Use a distinct hash salt.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| DF1 / DF2 / DF3 / DF4 | ⏳ |
