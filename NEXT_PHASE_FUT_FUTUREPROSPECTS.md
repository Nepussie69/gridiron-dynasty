# Future draft prospects tab — FUTURES #29

User (2026-10-10, backlog 142): a **Future classes** tab on the Draft screen. Next year's class (and a thin 2-years-out class) is visible early, with fog-of-war grades that firm up as you scout. The watch list carries over, and underclassmen make declare decisions. Before generating anything new, check whether future classes already exist in the world.

## Audit: what exists (extend, don't duplicate)

- **No future classes exist in the world.** `World.draft: DraftProspect[]` (`engine/generate.ts` World) holds only the current class. `progress.ts:refreshProspectClass` **replaces** it at every rollover with `generateProspectClass(makeRng(world.seed + (world.season + 1) * 65537), world.season + 1, max(400, draft.length))`. The rollover order is `gameStore.ts` ~1812 `world.season += 1`, then ~1830 refresh. `balance.ts:resetSeason` uses the same call. `ensureProspectPools` is only a mid-cycle refill.
- **Real-data underclassmen are thrown away.** `generate.ts:realProspectClass` keeps only `cls === 'JR' | 'SR'` from `data.cfb`. FR/SO are dropped, and `data.cfb` is not stored on `World`. Seeding from them is out of scope (see Risks).
- **Key fact for this spec:** the next class is a pure function of `(world.seed, season, count)`. We can **derive** it early with the identical seed instead of storing a second roster. Promoting it without overlays is then byte-identical to today.
- **Fog of war already exists.** `evaluation.ts:readProspect` uses a rung base width × `confidence` × eval skill × `traitRangeFactor` × `scoutTravel.coverageFactor`. `consensus` shows at level ≥3 or confidence ≥70, and the truth shows at Director or confidence ≥92. Scope comes from `inProspectScope` / `capabilities.ts`, and access from `access.ts:accessFor(career,'draft')`.
- **Scouting action:** `gameStore.ts:scoutProspect` costs 1 `scoutingPoints`, closes 40% of the gap to `trueGrade` with a hash jitter, adds +24 confidence and +20 scoutConfidence, and works on `world.draft` only. Related: `combine.ts` (12 prospects), `scoutTravel.ts`, `scoutBias.ts:recordReport`, `department.ts:departmentGrade`.
- **No watch list exists.** The nearest things are season-scoped `career.userBoard`, `conviction {season,ids}` and `redFlags {season,ids}` (types.ts ~648–655). `DraftProspect.classYear` exists (FR/SO/JR/SR), but there is no declare concept. `committedTo`/`relations`/`offered` are college-mode leftovers, and we do not reuse them.
- **UI (ui-redesign):** `Draft.tsx` has `PageHeader` with a `SegmentedControl` List/Cards, `FilterChip` position chips (backlog 148), `Badge` and `NeutralChip`. The kit `src/ui/Controls.tsx` has `Tabs`, `IconButton`, `FilterChip` and `OptionCard`. `src/ui/kit.tsx` has `Card`, `SectionTitle`, `Badge`, `Chip` and `Stat`. `usePhone()` comes from `ui/hooks`.

## Design

1. **Derived future classes.** New `src/game/engine/futureClasses.ts` with these functions:
   - `nextClassSeed(world)` and `nextClassCount(world)` mirror refresh's arithmetic exactly. Refresh is refactored to call them.
   - `futureClass(world, 1)` is the full next class (`generateProspectClass` with the refresh seed, season `world.season + 1`, label as refresh does).
   - `futureClass(world, 2)` is the **thin** class: the top 60 by consensus of the class at season +2 (same generator, its own seed formula). It is memoized per `(seed, season, yearsOut)`.
   - Nothing roster-sized is saved. Only overlays are persisted (step 4).
2. **Fog of war (wider than the current class).** `readFuture(career, p, yearsOut)` wraps `readProspect` and multiplies the width ×1.8 (next year) or ×2.6 (2 years out). It shows `consensus` only as a round band ("Day 1 / Day 2 / Day 3 look") until the class is current. The truth is never shown early.
   - **Scouting a future prospect** costs 1 scouting point and closes 20% (next) or 10% (+2) of the gap. Confidence gains +12 or +6, capped at 60 or 35 until promotion. It uses the same hash-jitter pattern as `scoutProspect` and makes no rng draws.
   - `scoutTravel` and `combine` stay current-class only.
3. **Watch list carries over.** Add `career.prospectWatch?: string[]` (ids, max 30), with no season scope. IDs are deterministic (`d${season}_${i}`), so a watched future prospect keeps his id when promoted. At promotion, watched ids still in the class are appended to `userBoard` if the user keeps a board, and they get a "Watched" chip on the board. Drafted or retired ids drop off quietly.
4. **Overlays (optional save fields; old saves load unchanged).**
   - `world.futureScout?: Record<id, { myGrade; confidence; scoutConfidence }>`
   - `world.futureReturners?: DraftProspect[]` (season-tagged)
   - On `DraftProspect`: `declare?: 'undecided' | 'declared' | 'returning'` and `returnedFrom?: number`
   - At refresh, `promoteNextClass(world, generated)` applies the scouting overlay by id and swaps in returners (step 5), then clears the consumed overlay. **With no overlays it returns `generated` untouched.**
5. **Underclassmen declare.**
   - Current-class JR/SO prospects carry `declare: 'undecided'`. The Future tab shows a fogged **leaning** for next-year underclassmen ("Leaning declare"), clear only at confidence ≥50.
   - **Deadline:** the regular season → playoffs transition (NFL mid-January), before the `resign` stage. Each undecided prospect declares with `p = clamp(0.35 + (trueGrade − 60) × 0.03, 0.15, 0.95)` via `h01(id, season)`.
   - **Grade-preserving swap.** A returner is replaced in place in `world.draft` by a generated senior. The replacement copies `trueGrade`/`pot`/`ovr`/`grade`/`generated`, so the class size and its `trueGrade` multiset are unchanged. That keeps `draft.ts:rookieRatings`/`trueGradeRank` identical.
   - The returner moves to `futureReturners` with `classYear` +1 and replaces the next-class prospect with the same `trueGrade` (nearest if none).
   - `userBoard`/`conviction`/`redFlags` ids that point at a returner are filtered out.
   - **News:** the inbox gets "X declares / returns to school" for watched prospects, and the league feed gets a headline for top-32 decisions.

## Engine hooks (small, mergeable)

- `progress.ts:refreshProspectClass`: compute via `nextClassSeed/Count`, then `world.draft = promoteNextClass(world, …)`. That is about 3 lines. `balance.ts` inherits it, and its overlays are empty, so the output is identical.
- The store's season-advance at the regular season → playoffs edge calls `runDeclareDeadline(world, career)` from `futureClasses.ts`. It makes no rng draws and does not touch `playsim.ts`, `sim.ts` or `leagueSim.ts`.

## UI touchpoints (ui-redesign kit, desktop + 375px, light/dark)

- **`Draft.tsx`:** kit `Tabs` under `PageHeader` with **This class | Next year | 2 years out**. The existing board is unchanged under "This class".
- **New `src/screens/draft/FutureClasses.tsx`:**
  - Reuses the `FilterChip` position row and the List/Cards `SegmentedControl` (cards on `usePhone()`).
  - Each row shows name, pos, college, classYear, the round-band look, the fog range "68–79" with a confidence bar, a declare/leaning `Badge`, a watch `IconButton` (star), and **Scout (1 pt)**. Locked or no-points states use the existing tooltip copy from `Scouting.tsx`.
  - "2 years out" adds a one-line note: "Early look — top 60 only, reads are rough".
- **Current board:** a "Watched" `Chip`, and a `declare` `Badge` on underclassmen until the deadline.

## Calibration impact (NFL bands stay green)

- Game sims are untouched: there are no `playsim`/resolver edits and no rng draws added or removed. Real-data 33333/2222/5150 ×500 `--eq --smoke=coach:4,personnel:4` must equal the base commit's baseline exactly. Record it before starting; the last noted value was 22.5/21.9/22.3. eq must be 20/20 and smokes 0/0.
- Season bands (`balance.ts` activeSeasons, 60–79 tiers) are protected because the promoted class has the same size and `trueGrade` multiset with or without declares (the grade-preserving swap). Rookie ratings are rank-based, so the rookie bands are identical. Only names and identities move.

## Phases (DeepSeek jobs, non-overlapping files)

| Job | Base | Files | Content |
|---|---|---|---|
| FP1 engine | main | NEW `engine/futureClasses.ts`; `progress.ts` (refresh hook only); `types.ts` (optional fields) | derive, fog read, promote, declare deadline, swap |
| FP2 store | main after FP1 | `gameStore.ts` (actions `scoutFuture`, `toggleWatch`, deadline call, `migrateWorld`/`migrateCareer` defaults, dev probe `window.__futureProbe`), `main.tsx` (DEV register) | wiring + probe |
| FP3 UI | ui-redesign (∥ FP2, codes to FP1 types) | NEW `screens/draft/FutureClasses.tsx`; `Draft.tsx` (tabs + chips only) | screens |

## Acceptance

- `npm run build` passes. `npm run lint` shows **exactly 4** warnings.
- Calibration exactly as above (identical ×500, eq 20/20, smokes 0/0, animation end spots 100%). `runBalance` activeSeasons is unchanged against the base.
- `__futureProbe` checks the following:
  - (a) `futureClass(world,1)` deep-equals what `refreshProspectClass` produces with empty overlays.
  - (b) A scouted future prospect keeps its `myGrade`/confidence after promotion, and confidence never exceeds the cap early.
  - (c) The watch list survives two rollovers and save/reload (IDB), and promoted ids land on `userBoard`.
  - (d) Declare rate by grade bucket is monotone. The class length and sorted `trueGrade` are identical before and after the deadline. No board, conviction or red-flag id points at a returner.
  - (e) A returner appears in the next class with `returnedFrom`.
  - (f) An old save without the fields loads.
- Orchestrator browser check: the three tabs, scout/watch flow, and declare badges at desktop and 375px, light and dark, with no overflow or console errors.

## Risks

- **Seed drift.** If anyone changes refresh's seed or count, previews stop matching the promoted class. Mitigation: shared helpers plus probe (a).
- **Wrong rollover edge.** `gameStore` rollover is ~1812–1830. The ui-redesign merge from main must keep the hook.
- **Real-data FR/SO from `data.cfb`** would make the first future classes real players, but that breaks seed identity. It is a later option behind a world flag.
- **Coach-track careers** see a read-only tab (scouting locked as on `Scouting.tsx`). An area scout's `inProspectScope` region limit applies to future classes too.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| FP1 / FP2 / FP3 | ⏳ |
