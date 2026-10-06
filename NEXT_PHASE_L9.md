# NEXT PHASE — L9 "The long game"

_Planned by Claude Opus 5.5 on 2026-10-06. Implemented task by task by DeepSeek Flash 4.1 (OpenCode)._
_Lint baseline: exactly 5 warnings (PlayerTable.tsx, Cap.tsx, ui/kit.tsx, MatchView.tsx ×2). Line numbers may drift; the count must stay 5._

## Progress

| Task | What | Push | Status |
|---|---|---|---|
| Z1 | Career smoke-test probe `__careerSmoke` | P1 | in progress (P1) |
| Z2 | Staff awards: engine + season-end wiring | P2 | not started |
| Z3 | Staff awards: Awards screen + recap + résumé | P2 | not started |
| Z4 | Owner counteroffer when a rival club comes calling | P3 | not started |
| Z5 | Rivalry games against your NPC rivals' clubs | P3 | not started |
| Z6 | HANDOFF.md docs | P3 | not started |

## Phase goal

L6–L8 gave every rung a job. L9 is about the **long arc**: recognition for doing those jobs well, reasons to stay or leave, and the rivals you started
with becoming real opponents. It also adds a **smoke-test probe** that drives every L5–L8 feature for many seasons, so this growing pile of systems stays healthy.

Existing systems to build on (don't rebuild them): the Wilderness and Hall of Fame case (`legacy.ts`), the coaching tree (`people.ts` `growCoachingTree`),
NPC rivals (`World.rivals`, `Rival { id, name, path, level, teamId, reputation, startSeason }`, advanced by `advanceRivals` in `runEndOfRegularSeason`),
player awards (`awards.ts`), and job offers (`generateJobOffers`, the offers modal in `SeasonModal.tsx` and `Career.tsx`).

**Guardrails:** No changes to reputation gates, objectives, capabilities/access, sim constants, `evaluateTrade`, or contract pricing. Rewards ≤ +3 per dimension per feature per season.
Every new save field is optional.

---

## Z1 — Career smoke-test probe (`src/store/gameStore.ts` + `src/main.tsx`)
`export async function careerSmoke(seasons = 6, path: 'personnel' | 'coach' = 'personnel', seed = 4242): Promise<SmokeReport>`, registered as `window.__careerSmoke` in `main.tsx`
inside the existing `if (import.meta.env.DEV)` block (same pattern as `__balanceProbe`).

It starts a career with `useGame.getState().startCareer({ name: 'Smoke', path, archetype: path === 'coach' ? 'off' : 'scout', teamId: 'CLE', seed, startLevel })`, with
`startLevel = path === 'coach' ? 5 : 4`. Then for each season:
1. **Exercise every feature the current rung can use**, through the store actions. Each call is wrapped in try/catch, recording `{ season, week, action, error }` on throw:
   `setScoutTrust`, `toggleConviction` (2 top prospects), `toggleRedFlag` (top-64 prospect), `toggleShadowBoard` (3 outside players), `toggleRoomFocus`/`setRoomPlan`,
   `spendHours('drills')`, `pickWrinkle` (rotate ids weekly), `chooseInstall('full')` in the offseason, `pitchStarter` (first backup on the pitch side), `combineAction` (in the offseason),
   `fileCapMemo` (offseason), `offerExtension` (one expiring player at 100% of `marketAsk`, mid guarantee), and `findDeals` on one player (engine call).
   Skip anything whose guard (`canX`) is false.
2. Advance the weeks with `advanceWeek()` (await it) until the offseason, dismissing modals. If offers appear, accept the first through `acceptOffer(o)` so the career climbs.
   Then `finishDraft()` and one more `advanceWeek()` into the next season.
3. **Invariants**, checked after each season, appending a string per violation:
   - every reputation value is a finite number in 0–100;
   - every club roster has 45–60 players;
   - no club's cap hits + dead money exceed 105% of `capForSeason(season)`;
   - every `world.roster` entry is the same object as its `world.players` entry;
   - `world.draft` ids are unique;
   - `career.shadowBoard` length ≤ 10, `career.conviction.ids` ≤ 3, `career.redFlags.ids` ≤ 2;
   - the wrinkle/install extra bonus is within [−0.6, +1.5].

Return `{ seasons, path, finalLevel, errors: [...], violations: [...], featuresExercised: Record<string, number> }` (a count per action that ran without throwing).
**Acceptance:** build + lint. The orchestrator runs `await __careerSmoke(6,'personnel')` and `await __careerSmoke(6,'coach')`. Report any errors honestly; do NOT hide failures.

---

## Z2–Z3 — Staff awards

At the end of each regular season (`runEndOfRegularSeason`, after standings are final and before they reset), award:
| Award | Candidates | Score |
|---|---|---|
| **Executive of the Year** | every club's GM (the user if `isGM(career)` at their club; otherwise the club's `'General Manager'` staff member, or `"{Team} GM"` if none) | `wins + 0.5 × (wins − lastWins)` |
| **Coach of the Year** | every club's head coach (the user if HC) | `wins + 0.5 × (wins − lastWins)` |
| **Assistant Coach of the Year** | every club's OC and DC (the user if coordinator, on their `unitFocus` side) | OC: league rank by `pointsFor` (1 = best); DC: by `pointsAgainst` (1 = fewest). Score = `33 − rank`; take the best |
| **Rising Star** | the user (only if personnel level ≤ 6 or coach level ≤ 5), plus every rival with `level <= 6` | user: `objectivesDone × 10 + overall rep gain this season`; rival: `reputation − prevReputation` (store `prevReputation` before `advanceRivals`) |

`lastWins` comes from a new optional `World.lastWins?: Record<string, number>`, written at the end of the award step (wins this season) and read next season (missing → treat improvement as 0).
Ties go to the higher `wins`, then alphabetical. **Deterministic, no rng.**

**Engine — NEW `src/game/engine/staffAwards.ts`:** `computeStaffAwards(world, career, objectivesDone, repGain): StaffAward[]` with `StaffAward { season; award; name; teamId; isUser: boolean; line: string }`.
**Types:** `World.staffAwards?: StaffAward[]` (keep the last 40), `World.lastWins?`, `CareerState.honors?: { season: number; award: string }[]`.
**Wiring:** push the awards to `world.staffAwards`. For each award the user wins: add `{ profile: 2 }` (+1 more for Executive/Coach of the Year, total max +3), push an honor and a `seasonMoments`
line ("You were named Coach of the Year."), and add a news item. Add the awards to the season summary if `SeasonSummary` has a natural slot, as an optional field.
**Portfolio (`portfolio.ts`):** each honor → `{ tags: ['winner'], strength: 3, label: award + ' ' + season }`.
**UI (`src/screens/Awards.tsx`):** a new card "Front Office & Staff Awards", listing the latest season's 4 winners (award, name, team crest/abbr, and a gold "You" badge when `isUser`)
and a collapsible history. **SeasonModal:** if the user won anything, add one gold line in the review.

---

## Z4 — Owner counteroffer
When season-end job offers are generated for the user (wherever `offers` are set in `runEndOfRegularSeason`), and **all** of these hold: `offers.length > 0`,
`career.jobSecurity >= 55`, `ownerPersonality(career.teamId) !== 'cheap'`, and no counter was made this season, the current owner makes a **counteroffer**:
`{ salaryRaise: 0.25, jobSecurity: +15, leadership: +1 }`.
**Types:** `CareerState.counter?: { season: number; taken?: boolean }`.
**Engine — NEW `src/game/engine/counter.ts`:** `counterOffer(world, career, offers): { raisePct: number; security: number; text: string } | null` (text uses the owner personality,
e.g. "The owner wants you here long-term: a 25% raise and a vote of confidence.").
**Store:** the action `acceptCounter()` applies `salary × 1.25`, `jobSecurity = min(100, js + 15)` and `leadership + 1`, marks `taken`, clears `offers`, closes the modal, and pushes a moment
"You stayed: {owner} matched with a raise." It is valid only while the counter is live this season.
**UI:** in the offers view (SeasonModal offers branch and the Career.tsx offers list), show a distinct **"Counteroffer — stay with the {Team}"** card above the job offers, with an **Accept counter** button.

## Z5 — Rivalry games
A **rivalry game** is a regular-season game between the user's club and a club where a rival currently works (`world.rivals.some(r => r.teamId === opp)`).
- Dashboard: if next week's opponent is a rivalry, show a small banner "Rivalry week: {rival name} ({rivalTitle(r)}) and the {Opp}". (`rivalTitle` is in people.ts.)
- After the user's game (`advanceWeek`), if it was a rivalry and the user's club won, add `{ profile: 1 }` (max +2 per season, tracked in `CareerState.rivalWins?: { season: number; wins: number }`) and a moment
  "Beat {rival}'s {Opp}." If it lost, add a moment "{rival} got the better of you." with no penalty.
**Engine — NEW `src/game/engine/rivalry.ts`:** `rivalFor(world, teamId): Rival | undefined`, `isRivalryGame(world, career, oppId)`.

## Z6 — Docs
Append "L9 The long game" (Z1–Z5, key files staffAwards.ts, counter.ts, rivalry.ts, plus the smoke probe) under Done in HANDOFF.md.

## PUSHES
**P1 = Z1** (the orchestrator uses the probe to verify everything after it) · **P2 = Z2–Z3** · **P3 = Z4–Z6**
After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings. Never run `npm run dev` or any watch command. No git commands.

## DO NOT
- Do not change reputation gates, objectives, capabilities/access, sim constants, `evaluateTrade`, contract pricing, `advanceRivals`'s logic, or `generateJobOffers`.
- The smoke probe must not swallow failures silently: every caught error goes into `errors`.
- Every new save field is optional. No new dependencies. Do not fix the baseline lint warnings. Do not reformat unrelated code. Do not edit any NEXT_PHASE*.md.
