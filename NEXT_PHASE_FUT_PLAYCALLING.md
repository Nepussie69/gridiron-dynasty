# Coach playcalling — FUTURES #26

User (FUTURES list, 2026-10-10, backlog 142): as head coach, or as a coordinator who keeps the call sheet, call plays yourself in live games. That means a down-and-distance call sheet, a formation and concept from your playbook, an audible menu, and handing play-calling to a coordinator per side or per situation. When you don't call, AI coordinators call by scheme and tendency.

## Already built (extend, do not duplicate)

- **Every-snap calling.** `CareerState.callMode` ('off' | 'def' | 'both'; unset = key moments) → `GameCtx.callAll`. Triggers live in the playsim snap step (`callTriggered` / `defCallTriggered`, ~L3500). `decide()` lifts `MOMENT_CAPS` for that side. `isPlayCall` keeps calls off the total cap. Store: `gameStore.setCallMode(mode, keepPlays)` re-sims from the play on screen and logs `gameDay.callSwitches`. UI: `MatchView.tsx: CallModePicker` (Key moments / Every O / Every D / Every snap).
- **Formation → play.** `callCards()` offers the whole `PLAYBOOK` (`src/game/data/playbookData.ts`, `FORMATIONS` × plays with personnel, depth, yac). The choice resolves through `conceptFromPlaybook`. `MatchView.tsx: CallPicker` groups plays by formation with `RouteDiagram`, and `QuickCallBar` handles "just run / just pass" (`engine/quickCall.ts: quickOffCall`).
- **Call matrix + tendencies.** `decisions.ts`: `Bucket`/`bucketFor` (7 down-distance buckets), `OffClass`, `DefCall`, `callEffect`, `bestCounterCall`, `defCallForPlan`, `coachTendency`, `aiCallSheet`. playsim has `aiTendency`, `drawAIDefCall` / `drawAIOffClass` (rng, drawn after the user answers) and `exploitDefCall` / `exploitOffClass`. Exploits read the user's season book, which `gameStore` builds (~L394) from `Play.offClass` / `Play.defCall`. The `tendencyRead` staff line is on the card.
- **Standing orders = the coordinators.** A user-team snap you don't call runs `pickConcept(s.rng, offStyle(...))` (the OC's scheme menu, `SCHEME_MENUS`), or `defCallForPlan(plan)` on D. AI clubs call by scheme and tendency already. A standing call gets **no matrix edge** (same as a fast sim).
- **Pre-game.** `CallSheet` (4th / 2-pt / timeouts, `setCallSheet`), `GamePlan` (`gameplan.ts`, `PlanEditor`), the opening script (`career.script`, G10), personnel packages (`ctx.personnel`, L13) and matchups/usage. `userCtx()` (gameStore ~L3826) builds `GameCtx` from `capabilities(career).planScope` + `career.unitFocus`, with scope 'hc' | 'off' | 'def' | 'both'.
- **Ledger** kind `playCall` (`ledger.ts` ~L266). `DecisionLog.vs/outcome` already grades calls for film.

Missing pieces: a per-situation sheet, per-situation delegation, coordinators calling *from your sheet*, and audibles.

## Design

1. **PlayCallingPlan** (new optional `CareerState.playCalling`; old saves stay valid):
   ```ts
   type CallSituation = Bucket | 'twoMinute'
   interface PlayCallingPlan {
     callers: { off: Partial<Record<CallSituation, 'me' | 'staff'>>; def: Partial<Record<CallSituation, 'me' | 'staff'>> }
     sheet: { off: Partial<Record<Bucket, string[]>>; def: Partial<Record<Bucket, DefCall[]>> } // ≤4 plays / ≤3 calls
     checks?: Record<string, string> // play → check-with-me play (override of checkFor)
     audibles: 'off' | 'qb' | 'ask'  // default 'off'
   }
   ```
2. **"My sheet" call mode.** `callMode` gains `'sheet'`. A snap stops for you when its situation (`bucketFor`, or 'twoMinute' = Q2/Q4 ≤2:00) is `'me'` on that side. Existing key-moment triggers still ask. An empty `callers` therefore equals 'key' exactly. Scope rules are unchanged (`scopeAllows`): an OC user edits only offense, a DC user only defense, and HC ('hc') edits both, which is "keeping the call sheet" or handing it off per side.
3. **Coordinator calls from your sheet.** A staff-called user snap in a bucket with sheet plays draws `pickConcept` **as today** (the rng draw is kept, then discarded). It then picks from the sheet by `h01(\`${s.n}:sheet:${offId}\`)`, weighted 4:3:2:1 by sheet order. On defense, the standing `defCallForPlan` becomes a hash pick from the D sheet. There is still no matrix edge on staff calls. With an empty sheet the behaviour is unchanged. Plays whose formation needs a FB (`formationHasFullback`) when the club has none fall back to the drawn concept.
4. **Audibles** (user-made calls only):
   - The **look** is the already-drawn `aiDef`, shown truthfully with p = clamp(0.55 + (QB AWR−70)·0.01 + (oppRead.sharp ? 0.10 : 0), 0.5, 0.85) by hash. Otherwise a disguise is shown: man↔zone, blitz↔stack, twoHigh↔zone.
   - `'qb'`: there is no pause. The QB checks to `checkFor(play)` (the opposite class from the same formation, or `checks` override) when `callEdge(check, look) > callEdge(call, look)` and a hash gate on AWR passes.
   - `'ask'`: a new `MomentKind 'audible'` card shows "Look: two-high, 6 in box" with **Keep / Check to X / Kill to hot** (the shortest pass in the formation).
   - The matrix then applies `callEffect(finalClass, aiDef)` against the **true** call. Only one edge applies per snap, so it never stacks.
   - D side (`'ask'` only): after `drawAIOffClass` + concept, the card shows the offense's formation/personnel, with **Stay / Rotate (twoHigh) / Pressure (blitz) / Load box (stack)**.
   - `Play.concept`/`offClass` record the final call, so the book, the AI exploit and the animation all see the audible.
5. **AI coordinators:** no change to AI-vs-AI selection (`pickConcept`, `aiTendency`, `drawAI*`). The card and play log name the caller ("OC: Mesh", "DC: Cover 2 zone") from `coordRating`/staff names.

## Engine hooks (keep playsim edits to small hooks; new logic in `src/game/engine/playcalling.ts`)

- `playcalling.ts` (new): the types above, plus `normalizePlayCalling`, `callerFor(ctx, side, bucket, twoMin)`, `sheetPick(list, key)`, `checkFor(play)`, `hotFor(formation)`, `lookFor(def, awr, sharp, key)`, `qbCheck(...)`, `audibleOptions(...)` and `defAudibleOptions(...)`. All pure and hash-based, with **no rng**.
- `playsim.ts`:
  - `GameCtx.calling?: PlayCallingPlan`.
  - `GameState.callLooks?: Record<string, { def?: DefCall; cls?: OffClass; concept?: string }>`: cache the drawn AI call **before** the audible `decide`, so re-entry after a pause never redraws.
  - Add `'audible'` to `MomentKind` / `MOMENT_CAPS` / `isPlayCall`.
  - Call `callerFor` in the two trigger expressions, and add the sheet override after the standing draw.
  - Optional `DecisionLog.audible?: { from: string; to: string; look: DefCall }`.
- `types.ts`: `CareerState.playCalling?`, and `callMode` adds `'sheet'`. `ledger.ts`: the playCall entry adds "audibles N (won W)".

## UI touchpoints (redesigned screens, kit from `src/ui/` on `ui-redesign`)

- **Game Plan → Situational**: new `src/components/PlayCallingCard.tsx` mounted beside `CallSheetCard`.
  - A "Who calls it" grid has one row per `BUCKET_LABEL` + Two-minute and Off/Def columns, each a `SegmentedControl` Me/Staff.
  - Each sheet row shows its plays as `Chip`s. A **+** opens a `Sheet` with formation `Tabs` → `OptionCard` plays + `RouteDiagram` (reuse `CallPicker`'s grouping), and D rows use `OptionGroup` of `DEF_CALL_LABEL`.
  - The audibles control is a `SegmentedControl` Off / QB checks / Ask me. Check-with-me overrides go in the same Sheet.
  - Respect `disabled` / planScope like the other cards.
- **Game day (`MatchView.tsx`)**:
  - `CallModePicker` adds "My sheet".
  - `CallPicker` opens on a **Sheet** tab with this bucket's plays first, then formations. `QuickCallBar` is unchanged.
  - `MomentCard` renders `audible` with the look line + options (icons via `optionIcon`) and a "QB checked to X" toast in 'qb' mode.
  - Check desktop + 375px, light/dark.

## Calibration impact (NFL bands stay green)

- AI-vs-AI paths are untouched, with no rng draws added or removed anywhere. The sheet override and the audible use `h01`/`hash32` only. The audible re-entry uses the cached look.
- Defaults are `playCalling` unset and `audibles 'off'`, with `callMode` as before. They reproduce the **current main baseline exactly**: record points ×3 seeds in Progress at branch time, eq 20/20, coach/personnel smokes 0/0.
- User-team ceiling: with a full sheet + 'qb' audibles, the user team's points/game rise ≤ +2.0 and its ypp ≤ +0.4 vs default over 500 games. Above that, cut the truthful-look band or the QB gate. The existing tendency book + `exploitDefCall` punishes a narrow sheet.

## Phases (DeepSeek jobs, non-overlapping files)

| Job | Base | Files | Content |
|---|---|---|---|
| P1 engine | main | `engine/playcalling.ts` (new), `engine/playsim.ts` (hooks only), `game/types.ts`, `engine/ledger.ts`, `engine/playcallingProbe.ts` (new) | Design 1–5, probes |
| P2 store | main after P1 | `store/gameStore.ts` | `setPlayCalling` (normalize, `withFlag 'gameplan'`), `userCtx` passes `calling`, `setCallMode('sheet')` + re-sim/callSwitches carry it, load-normalize |
| P3a plan UI | ui-redesign after P2 merged in | `components/PlayCallingCard.tsx` (new), `screens/GamePlanScreen.tsx` (mount line) | Game Plan card |
| P3b game-day UI | ui-redesign after P2 merged in | `components/MatchView.tsx` | Picker mode, Sheet tab, audible card, toast |

P3a and P3b run in parallel worktrees. Avoid `resolvePass`/`resolveRun`, because active b2/v1/passid2 worktrees may be editing them.

## Acceptance

- `npm run build` passes, and `npm run lint` shows **exactly 4** warnings.
- Real-data 33333/2222/5150 ×500 `--eq --smoke=coach:4,personnel:4`: with defaults, outcomes are identical to the main baseline, eq 20/20, smokes 0/0, animation end spots 100%.
- Probes (`playcallingProbe.ts`):
  - (a) 'sheet' with empty callers ≡ 'key' (play-by-play hash equal over 200 user games).
  - (b) Callers ask only in 'me' situations plus key moments.
  - (c) Staff snaps in a sheeted bucket use only sheet plays, and the rng call count per game is unchanged.
  - (d) 'qb' check rate 10–30% of user calls, and the matrix win rate rises ≤ 8 pts.
  - (e) 'ask' pause/answer equals the same choices replayed through `setCallMode` re-sim, with no drift.
  - (f) User-team ceiling as above.
  - (g) An old save without `playCalling` loads, and the plan survives save/reload.
- Orchestrator browser check: the Game Plan card and the game-day sheet tab + audible card, desktop/375px, light/dark, HC and OC/DC careers.

## Risks

- Rng drift on pause/re-entry is fixed by caching in `callLooks`. Any new rng draw breaks eq, so review the playsim diff line by line.
- `MatchView.tsx` diverged heavily on `ui-redesign` (~470 lines), so do UI only on that base. GamePlanScreen is redesigned there too.
- Exploit loop (always calling the counter): bounded by the single edge, the disguised look and the book-driven AI exploit. Watch probe (f).
- Overlap: trick plays (#24) slot in as playbook plays. Coordinator hiring (#28) should later feed `lookFor`/`qbCheck` via `coordRating`. #30 animates the final concept, so no extra hook is needed.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| P1 engine | ⏳ |
| P2 store | ⏳ |
| P3a / P3b UI | ⏳ |
