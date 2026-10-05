# NEXT PHASE — L6 "Every rung is a job"

_Planned by Claude Opus 5.5 on 2026-10-05. Implemented task by task by DeepSeek Flash 4.1 (OpenCode)._
_Starts after L5 (NEXT_PHASE_L5.md) is fully done and committed. Lint baseline: exactly 5 warnings
(PlayerTable.tsx:39, Cap.tsx:22, ui/kit.tsx:371, MatchView.tsx:151, MatchView.tsx:160)._

## Progress

| Task | What | Status |
|---|---|---|
| U0 | **Bug fix:** Finish draft skips user + all later picks | ✅ done — verified (push A) |
| U1 | Ledger kinds + flags (types) | ✅ done — verified (push A) |
| U2 | Scout trust: engine | ✅ done — verified (push A) |
| U3 | Scout trust: store + draft wiring | ✅ done — verified (push A) |
| U4 | Scout trust: UI | ✅ done — verified (push A) |
| U5 | Conviction: engine + ledger payout | ✅ done — verified (push B) |
| U6 | Conviction: draft wiring + vindication | ✅ done — verified (push B) |
| U7 | Conviction: UI | ✅ done — verified (push B) |
| U8 | Your Room: engine | ✅ done — verified (push C) |
| U9 | Your Room: store + season-end wiring (replaces drills) | ✅ done — verified (push C) |
| U10 | Your Room: UI | ✅ done — verified (push C) |
| U11 | Portfolio: engine | ✅ done — verified (push D) |
| U12 | Portfolio: interview wiring | ✅ done — verified (push D) |
| U13 | Portfolio: Interview Prep + résumé UI | ✅ done — verified (push D) |
| U14 | HANDOFF.md docs | ✅ done — verified (push D) |

## Phase goal

Make every rung below GM and Head Coach a real job. Each rung gets three things: **a decision only that job makes**,
**a scarce resource to spend on it**, and **a record that follows you to the next job**.

| # | Feature | Rungs | The decision |
|---|---|---|---|
| G1 | **Grade your scouts** | Asst Dir / Dir of College Scouting (personnel 4–5), plus anyone with `hireStaff` | How much to trust each scout. That sets the department grade your club drafts from. |
| G2 | **Pound the table** | Personnel rungs with `rankBoard` or `setBoard` (4, 5, 6) | 3 conviction tags per draft. These are graded separately. If you were overruled and right, it counts as a vindication. |
| G3 | **Your Room** | Coaching rungs with `developRoom` below HC (5, 6) | Up to 3 focus players and a practice plan (Concentrate or Spread). Development comes from reps you've banked. |
| G4 | **Portfolio interviews** | Everyone | Pick 3 résumé items to pitch, matched to what the hiring club wants. |

How these tie together: G1, G2 and G3 produce portfolio items, and G4 spends them. Doing well at job N is now literally your pitch for job N+1.

**Guardrails:** Every effect is bounded and capped. None of it changes AI teams' logic except the user's own club's
draft grade (G1), which can only get as accurate as the hidden truth. G4 can only **raise** interview fit to the
same maximum that exists today, so promotion pacing can't get faster than its current ceiling. The weekly drills action
used to be farmable (+1 OVR, 4×/week). G3 replaces it with a bounded season-end budget, which is a net nerf.

---

## U0 — Bug fix: "Finish draft" truncates the draft (pre-existing, found in L5 browser test)

**Repro (verified 2026-10-05):** As a GM (any rung with `draft` authority), let the draft auto-complete: click Finish draft, or advance into
the next season without drafting. `simulateRestOfDraft` calls `simUntilUser`, which **breaks as soon as the user's club is on the clock**.
`finishDraft` / `startNextSeason` then force `draftState.complete = true`. Result: only ~70 of ~224 picks are made, the user's club drafts
**nobody**, and every later pick in the league is skipped. Traded picks you hold never resolve in the Trade Tree.

**Fix (`src/game/engine/draft.ts`):** Rewrite `simulateRestOfDraft(world, career)` to loop until complete:
```ts
export function simulateRestOfDraft(world: World, career: CareerState | null) {
  let guard = totalPicks(world) + 5
  while (!world.draftState.complete && guard-- > 0) {
    simUntilUser(world, career, totalPicks(world))
    if (world.draftState.complete) break
    const teamId = currentTeamId(world)
    if (!teamId) break
    // The user's club is on the clock but the user chose to auto-finish: take best available for them.
    const prospect = bestAvailableFor(world, teamId)
    if (!prospect) { world.draftState.complete = true; break }
    makePick(world, prospect, teamId, career && teamId === career.teamId ? career.gmName : null)
  }
  return world.draftState.complete
}
```
(After U3 lands, the auto-pick should pass the same `gradeOf` the department grade uses. U3 must update this call too.)
**Acceptance:** build + lint. In dev, start a GM career, sim to the offseason, call `__game.getState().finishDraft()`, then check
`__world().players.filter(p => p.origin?.kind === 'draft' && p.origin.season === __world().season).length` ≈ the number of draft picks (~224+comp),
and that the user's club has ≥ 7 rookies.

---

## G0 — Shared type changes (`src/game/types.ts`)
- `LedgerKind` adds `'develop'`: `'grade' | 'recommendation' | 'pick' | 'advice' | 'develop'`.
- `LedgerEntry` adds `conviction?: boolean`, `vindication?: boolean`, `gain?: number`.
- `CareerState` adds:
  - `scoutTrust?: Record<string, 'fade' | 'normal' | 'lean'>` (staffId → trust)
  - `conviction?: { season: number; ids: string[] }` (prospect ids, max 3)
  - `room?: { focus: string[]; plan: 'concentrate' | 'spread'; reps: number }`
- `src/screens/Ledger.tsx` `KIND_META` gets `develop: { label: 'Develop', tone: 'win' }`. (It's typed `Record<LedgerKind…>`, so the build fails until this is added; do it in U1.)
- `src/game/engine/ledger.ts` `gradeLedger`: at the top of the loop, add `if (e.kind === 'develop') continue`, so develop entries
  never count toward the hit rate. Also return `newly: LedgerEntry[]` (entries that got `hit` set in this call) alongside
  the existing fields. This is additive; existing callers are unaffected.

---

## G1 — Grade your scouts

**Today:** `scoutBias.ts` gives every evaluator a hidden bias, and `learnedBias` reveals it over time on the Scouting "Staff Board".
Knowing the bias changes nothing.

**New:** You set a **trust** level on each evaluator: Fade ×0.5, Normal ×1, or Lean on ×2. The trust-weighted average of their reports is
the **department grade**. Your club's draft-room AI ranks prospects by the department grade instead of the public consensus whenever the
club is picking without you (you lack `draft` authority, or simulated picks). Calibrating trust well means your club drafts closer to the truth.

**Engine — NEW `src/game/engine/department.ts`:**
```ts
export const TRUST_WEIGHT = { fade: 0.5, normal: 1, lean: 2 } as const
export function canSetTrust(career: CareerState): boolean   // capabilities(career).can has 'assignScouts' or 'hireStaff'
export function departmentGrade(world: World, career: CareerState, p: DraftProspect): number | null
  // evaluators = (world.staff[career.teamId] ?? []).filter(isEvaluator); null if none.
  // weighted mean of scoutReport(m, p) with TRUST_WEIGHT[career.scoutTrust?.[m.id] ?? 'normal']; Math.round.
export function calibrationGain(world: World, career: CareerState): number
  // Over the first 40 prospects in world.draft: mean |departmentGrade − trueGrade| using all-'normal' weights,
  // minus the same using career.scoutTrust. Positive = your trust settings beat the default. Round to 1 decimal.
```

**Draft wiring (`src/game/engine/draft.ts`):** `bestAvailableFor(world, teamId, advice?, gradeOf?: (p: DraftProspect) => number)`.
Score with `(gradeOf ? gradeOf(p) : p.grade)` instead of `p.grade`. In `simUntilUser`, when `career && teamId === career.teamId`,
pass `gradeOf = (p) => departmentGrade(world, career, p) ?? p.grade`. Import from `./department`. Check for a cycle: department.ts may import
`capabilities` and `scoutBias`, but NOT `draft.ts`.

**Store (`gameStore.ts`):** a new action `setScoutTrust(staffId: string, level: 'fade' | 'normal' | 'lean')`. It is guarded by `canSetTrust`
and updates `career.scoutTrust` immutably. In `runEndOfRegularSeason`, if `canSetTrust(career)` and `calibrationGain(world, career) >= 1`,
add `{ evaluation: 2, leadership: 1 }` to that season's reputation delta (use the same delta-merge pattern the ambitions grading uses) and push a
`seasonMoments` line: "Your read on the staff sharpened the department board (+X pts accuracy)."

**UI (`src/screens/Scouting.tsx` `StaffBoard`):** If `canSetTrust`, each evaluator row gets 3 small toggle chips (Fade / Normal / Lean on) wired to
`setScoutTrust`. Add a top row showing **"Department grade: N"** from `departmentGrade`. Keep the existing hint text.

---

## G2 — Pound the table (conviction)

**New:** On the Scouting class board, a personnel rung with `rankBoard` or `setBoard` can tag up to **3 prospects** as **Conviction** for the
current draft. This reuses the existing per-row "Quick" column pattern.
- **Advise mode** (you lack `draft` authority): when your club is on the clock in `simUntilUser`, the Director takes a conviction prospect if one is
  available and its department/public grade is within 10 of the best available pick's score. The chance is `adviceWeight(career) + 0.2` (cap 0.95),
  rolled with `makeRng(world.seed + world.season * 97 + world.draftState.pickIndex)()`. Pick the highest-graded conviction prospect.
- **Every conviction prospect gets a ledger entry when he is drafted by anyone**: kind `'advice'`, `conviction: true`, `playerId: 'pl_' + prospect.id`
  (drafted players' ids are `pl_${prospect.id}`; see `prospectToPlayer`), and `accepted = (draftedBy === career.teamId)`.
  The existing `gradeLedger` grades it after 2 NFL seasons (OVR ≥ 78 = hit).
- **Vindication:** a conviction entry with `accepted === false` that becomes a hit gets `vindication = true` and the outcome text
  "Called it — {name} became a {ovr} OVR player in {team abbr}. Your club passed."

**Engine — NEW `src/game/engine/conviction.ts`:**
```ts
export const MAX_CONVICTION = 3
export function canConvict(career: CareerState): boolean  // personnel && (can has 'rankBoard' || 'setBoard')
export function convictionIds(world: World, career: CareerState): string[] // ids only if career.conviction?.season === world.season, else []
export function convictionPick(world: World, career: CareerState, best: DraftProspect, gradeOf: (p: DraftProspect) => number, roll: number): DraftProspect | null
export function logConvictionPicks(world: World, career: CareerState): number // pushes entries for conviction prospects drafted & not yet logged; returns count
export function convictionPayout(newly: LedgerEntry[]): { rep: Partial<Reputation>; lines: string[] }
  // per newly graded conviction entry: hit → +2 evaluation +1 profile; vindication hit → +2 evaluation +3 profile; miss → −1 profile.
  // Also sets e.vindication = true and the outcome text on vindication hits.
```
To dedupe, `logConvictionPicks` skips any prospect that already has a ledger entry with `conviction && prospectId === p.id`.

**Wiring:**
- `simUntilUser` (advise branch): after computing `prospect = bestAvailableFor(...)`, if `career && teamId === career.teamId && !canDraft(career)`,
  `prospect = convictionPick(...) ?? prospect`.
- Call `logConvictionPicks(world, career)` in the store's `draftProspect`, `simToMyPick`, `finishDraft`, and in `startNextSeason` before the draft data rolls over.
- `runEndOfRegularSeason`: take `newly` from the `gradeLedger` call, run `convictionPayout(newly)`, merge its rep into the season delta, and add its lines to `seasonMoments`.
- Store action: `toggleConviction(prospectId)`, guarded by `canConvict`. It resets the list if `career.conviction?.season !== world.season`, caps at 3, and toasts when full.

**UI:** In `Scouting.tsx`, add a flame/star toggle in each class-board row's Quick column when `canConvict` (use `stopPropagation` like the
existing quick buttons), plus a header chip "Conviction 2/3". In `Ledger.tsx`, conviction entries show a "Conviction" badge (gold), and vindications show "Called it" (win).

---

## G3 — Your Room

**New (coaching, `developRoom` and level < 7):** Your **room** is the players on your club on your side of the ball
(`unitFocus` off → `side === 'OFF'`, def → `'DEF'`, otherwise non-`'ST'`), age ≤ 26, `ovr < pot`, sorted by `pot − ovr` descending, at most 10.
You choose up to **3 focus players** and a **plan**:
- **Concentrate:** the season's development budget goes to the focus players, up to **+3 each**.
- **Spread:** budget + 2 points handed out one at a time across the whole room, **+1 max each**.

The weekly **Run drills** action (already limited to once a week by L5 T13) now **banks a rep** (`room.reps += 1`, max 17) instead of
adding +1 OVR on the spot.

**Engine — NEW `src/game/engine/room.ts`:**
```ts
export function hasRoom(career: CareerState): boolean   // path coach && can has 'developRoom' && level < 7
export function roomPlayers(world: World, career: CareerState): Player[]
export function roomBudget(career: CareerState): number // Math.round(Math.min(room.reps,17)/17 * 6 * (0.6 + skills.leadership/250))
export function applyRoomDevelopment(world: World, career: CareerState): { gains: { id: string; name: string; from: number; to: number }[] }
  // Concentrate: split budget evenly across focus players still in roomPlayers (Math.floor; leftover to the first), each min(+3, pot−ovr).
  // Spread: budget+2 points round-robin over roomPlayers, +1 max each, never above pot.
  // Mutates player.ovr. Pure otherwise.
```

**Wiring:**
- `spendHours` `'drills'`: replace the direct OVR bump with `room.reps = Math.min(17, (room.reps ?? 0) + 1)`. Note: "Drills: N reps banked for your room."
  If `!hasRoom(career)`, keep the old note "No room to run." and don't spend hours. (Coordinators/position coaches only.)
- `runEndOfRegularSeason`: right **after** `developPlayers(world)` and before objectives, if `hasRoom(career)`, run `applyRoomDevelopment`.
  For each gain ≥ 2, `pushLedger` kind `'develop'`, `playerId`, `gain`, note `"Developed {name}: {from} → {to}"`.
  Add a `seasonMoments` line summarising the gains. The gains feed L5's `developedCount` naturally.
- `startNextSeason`: reset `room.reps = 0` and filter `focus` to players still in `roomPlayers`.
- Store actions: `toggleRoomFocus(playerId)` (max 3) and `setRoomPlan(plan)`. Both are guarded by `hasRoom`.

**UI — NEW `src/components/RoomCard.tsx`, shown on Dashboard when `hasRoom`:** a title "Your Room"; the list of room players (name, pos, age, OVR→POT,
focus toggle); a Concentrate/Spread segmented toggle with one-line explanations; "Reps banked: N / 17"; and "Projected budget: N pts".
Match the dense Card style used elsewhere.

---

## G4 — Portfolio interviews

**Today:** `makeInterview` (career.ts) gives a flat `citations = 2 + min(10, hits)` bonus. You click "Sit for the interview" and it rolls.

**New:** Before the roll you pick **up to 3 portfolio items** to pitch. Items carry tags, and each club wants certain tags (owner personality + rung).
Matching items count double.

**Engine — NEW `src/game/engine/portfolio.ts`:**
```ts
export type PitchTag = 'eye' | 'builder' | 'winner' | 'teacher' | 'conviction'
export interface PortfolioItem { id: string; label: string; detail: string; tags: PitchTag[]; strength: 1 | 2 | 3; season: number }
export function portfolioItems(world: World, career: CareerState): PortfolioItem[] // sorted strength desc then season desc, max 12
export function teamWants(offer: JobOffer, path: CareerPath): PitchTag[]
export function pitchBonus(offer: JobOffer, path: CareerPath, items: PortfolioItem[], pickedIds: string[]): { bonus: number; matched: string[] }
```
Item sources (ids must be stable, e.g. `led_<entry.id>`, `trade_<rec.id>`, `hist_<season>`):
- Ledger `pick` or `recommendation` with `hit` → tags `['eye']`, strength 3 if the player's current OVR ≥ 88, else 2.
- Ledger conviction hits → `['eye','conviction']`, strength 3. Vindications → `['conviction','eye']`, strength 3, label prefixed "Called it: ".
- Ledger `develop` entries → `['teacher']`, strength 2 if `gain >= 3`, else 1.
- Trade Tree (`tradeTree` from L5's `tradeTree.ts`, flattened) with verdict `'Won'` → `['builder']`, strength 3.
- `career.history` rows: parse `record` "W-L"; a winning record → `['winner']` strength 1, and ≥ 11 wins → strength 2.
- Do NOT read hidden truth for item strength beyond what the ledger already exposes.

`teamWants`: owner personality computed **locally** as `(['meddling','patient','cheap','win-now'] as const)[hash32(offer.teamId, 61) % 4]` (same formula as `people.ts`/`makeInterview`; do NOT import people.ts — it imports career.ts, which would create a cycle) → win-now `['winner','builder']`, patient `['eye','teacher']`, cheap `['builder','eye']`,
meddling `['conviction','winner']`. Then add `'teacher'` if `path === 'coach'`, else `'eye'` (dedupe).

`pitchBonus`: for each picked id (first 3 only) found in `items`, add `strength × (tags ∩ wants ≠ ∅ ? 2 : 1)`. bonus = `Math.min(10, sum)`.

**Wiring (`career.ts` `makeInterview`):** add an optional 4th param `pitch?: string[]`. Keep the old `citations` value as `baseline`.
If `pitch?.length`, `citations = Math.max(baseline, 2 + pitchBonus(offer, career.path, portfolioItems(world, career), pitch).bonus)`.
The pitch can only help, and the max stays 12. Keep the existing `rounds`/`fit` logic. Avoid an import cycle: portfolio.ts must not import career.ts.
If it needs `tradeTree`, that's fine (tradeTree.ts doesn't import career.ts; verify).

**Store:** `acceptOffer(offer, pitch?: string[])` (interface + implementation) passes `pitch` to `makeInterview`. On a win, the toast appends
`" Your pitch landed: {matched joined}."` when anything matched.

**UI:**
- NEW `src/components/InterviewPrep.tsx`: props `{ offer, onCancel }`. It shows the club crest and title, "What they want" (tag chips), and
  `portfolioItems` as checkable rows (max 3, with matching rows highlighted). It shows a live "Pitch strength +N", and a primary button "Interview"
  that calls `acceptOffer(offer, picked)`.
- `SeasonModal.tsx` (~line 256) and `Career.tsx` (~line 421): the existing "Sit for the interview" button opens `InterviewPrep` for that offer
  (local `useState<JobOffer | null>`) instead of calling `acceptOffer` directly. If `portfolioItems` is empty, keep the direct call.
- NEW `src/components/PortfolioCard.tsx` on Career.tsx (near LegacyCard): "Your Résumé", the top 6 items with tag chips. Empty state:
  "Nothing on the résumé yet — hits, developed players and won trades land here."

---

## TASK LIST — after EVERY task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings
- **U0** Draft truncation bug fix (see U0 section).
- **U1** G0 type changes + `KIND_META.develop` + `gradeLedger` (`develop` skip, `newly` return).
- **U2** Create `department.ts`. No callers yet.
- **U3** `bestAvailableFor` gets the `gradeOf` param; `simUntilUser` uses the department grade for the user's club; add the store action `setScoutTrust`; season-end calibration reward.
- **U4** StaffBoard trust chips + department grade row.
- **U5** Create `conviction.ts` (all functions, including `convictionPayout`).
- **U6** `simUntilUser` conviction override; `logConvictionPicks` calls in the 4 store spots; payout in `runEndOfRegularSeason`; the `toggleConviction` action.
- **U7** Conviction toggles + chip on Scouting; Conviction / Called it badges on Ledger.
- **U8** Create `room.ts`.
- **U9** Drills banks reps; `applyRoomDevelopment` + develop ledger entries at season end; `startNextSeason` reset; the `toggleRoomFocus` / `setRoomPlan` actions.
- **U10** `RoomCard.tsx` on Dashboard.
- **U11** Create `portfolio.ts`.
- **U12** `makeInterview` pitch param; `acceptOffer(offer, pitch?)`.
- **U13** `InterviewPrep.tsx` (wired into SeasonModal + Career offers) and `PortfolioCard.tsx` on Career.
- **U14** Append "L6 Every rung is a job" (G1–G4, key files) to HANDOFF.md → Done.

## DO NOT
- No git commands. The orchestrator commits after each verified push.
- Do not change reputation gates, `roleObjectives` targets/rewards, `capabilities.ts`/`access.ts` semantics, `evaluateTrade`, or sim/balance constants.
- Do not change AI teams' draft logic except through `gradeOf` for the **user's** club.
- Do not let a pitch lower fit below today's `citations` value, and do not raise its 12-point ceiling.
- Every new save field is optional; old saves must load. No new dependencies. Do not fix the baseline lint warnings. Do not reformat unrelated code.
- Do not edit NEXT_PHASE.md, NEXT_PHASE_L5.md or NEXT_PHASE_L6.md.

## Verification log
- **Push A** (browser): GM auto-finish draft now makes 220/220 available picks (was 70); user club gets 7 rookies; every rookie carries `pickId`; `setScoutTrust` stores trust. Note: the prospect class (220) is smaller than the pick count (224, comp picks), so the last 4 picks go unused. This is a pre-existing class-size issue and is not fixed here.
- **Push B** (browser, Asst Dir rung): conviction capped at 3 (4th refused); after auto-finish the Director took 2 of 3 tagged prospects; all 3 logged as conviction ledger entries (2 accepted, 1 passed). Claude fixed the gap where `gradeLedger` overwrote "Called it" outcome text (`ledger.ts`: skip the outcome refresh when `e.vindication`).
- **Push C** (browser, NFL position coach, 17 banked reps): Concentrate → focus player 82→84 + develop ledger entry; Spread → +1 spread, no entries (gains < 2, by design); no reps → no gains; Dashboard shows Your Room; second drills per week refused. Claude fixes: (1) Spread no longer grants +2 with zero reps; (2) the room is computed after season-end aging, so the age cap is 27 at that point and focus players are looked up on the full roster (previously 26-year-old focus players aged out and got nothing); (3) the F5 dev baseline age is aligned to ≤ 26 to match the room.
- **Push D** (browser): Interview Prep opens from the offer button and shows the club's wants (Eye for talent, Developer), with résumé items marked MATCH. Pitching 2 developed-player items → "Pitch strength +4"; the interview rolled vs a rival. The Résumé card renders on Career.
- **Balance probe after L6** (14 seasons, automated play; it does not use trust, conviction, room or pitches):
  | seed | personnel → GM | coach → HC |
  |---|---|---|
  | 20261004 | 8 | 10 |
  | 111 | 10 | 12 |
  | 2222 | 5 | never (14) |
  | 33333 | 6 | 14 |
  Personnel is now **faster than the 10–15 target** (median ~7). Pre-L6 probes (11 → 14) were run while the draft truncation bug starved the user's club of rookies.
  The likely driver is U0, which lets the club actually draft. Not tuned here: gate changes are out of scope and need a user decision.
