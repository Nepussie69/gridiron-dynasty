# NEXT PHASE — L7 "The middle of the building"

_Planned by Claude Opus 5.5 on 2026-10-06. Implemented task by task by DeepSeek Flash 4.1 (OpenCode)._
_Lint baseline: exactly 5 warnings (PlayerTable.tsx:39, Cap.tsx:22, ui/kit.tsx:371, MatchView.tsx:151, MatchView.tsx:160)._

## Progress

| Task | What | Push | Status |
|---|---|---|---|
| W0 | First draft class topped up to ≥ 260 prospects | P1 | in progress (P1) |
| W1 | AI clubs spend toward the cap floor | P1 | in progress (P1) |
| W2 | Shadow board: types + engine | P2 | not started |
| W3 | Shadow board: store + season-end grading | P2 | not started |
| W4 | Shadow board: UI | P2 | not started |
| W5 | Extension talks: engine | P3 | not started |
| W6 | Extension talks: store + ledger | P3 | not started |
| W7 | Extension talks: UI | P3 | not started |
| W8 | Cap memo: engine + store + grading | P4 | not started |
| W9 | Cap memo: UI | P4 | not started |
| W10 | Combine week: engine + store | P5 | not started |
| W11 | Combine week: UI | P5 | not started |
| W12 | HANDOFF.md docs | P5 | not started |

## Phase goal

The balance probe shows careers sitting longest at **Director of Player Personnel** (level 6) and **Assistant GM** (level 7). These rungs
have no signature job today. L7 gives each middle personnel rung one decision it alone makes, plus two housekeeping fixes found in playtesting.

| # | Feature | Rung (capability) | The job |
|---|---|---|---|
| W0–W1 | Housekeeping | — | The first draft has 220 prospects for 224 picks; AI payrolls drift to ~59% of the cap over 14 seasons. |
| G1 | **Shadow board** | `proScout` (Dir. Player Personnel, Asst GM, GM) | Rank up to 10 players on *other* clubs or in free agency. Graded on who actually grows. |
| G2 | **Extension talks** | `negotiate` (levels 6–8) | Negotiate second contracts with agents who have personalities, instead of a one-click extend. |
| G3 | **3-year cap memo** | `manageCap` (Asst GM, GM) | Commit to a cap-space outcome and 3 priority extensions each offseason; graded a year later. |
| G4 | **Combine week** | personnel levels 4–5 (`rankBoard`/`setBoard` + `grade`) | A 20-hour budget before the draft: interviews, workouts or film on up to 12 prospects. |

**Guardrails:** No changes to `evaluateTrade`, reputation gates, `roleObjectives` targets/rewards, sim calibration, or `capabilities.ts`/`access.ts`
semantics. Every reward is small (≤ +3 in any reputation dimension per feature per season) and paid at season end. Every new save field is optional.

---

## W0 — First draft class size (`src/game/engine/generate.ts`, `buildWorld`)
`buildWorld` uses `realProspectClass(...)` (220 real prospects) when data is present. The draft has 224+ picks (with comp picks), so the last picks go unused.
After building `draft`, if `draft.length < 260`, append `generateProspectClass(rng, season, 260 - draft.length)`. **Remap the appended prospects' ids**
to `` `dx${season}_${i}` `` (i = index within the appended batch), because generated ids can collide with real ids (`d${season}_${i}`). Keep their order after the real class.
**Acceptance:** build + lint. The orchestrator checks that a new career's `world.draft.length >= 260` and that ids are unique.

## W1 — AI clubs spend toward the cap floor (`src/game/engine/progress.ts`)
`runAIFreeAgency`: after the existing per-position need filling for a club, if that club's used cap (`roster capHit + deadMoney`) is below
`capForSeason(world.season) * CAP_FLOOR_PCT` (`CAP_FLOOR_PCT` from `./cap`), sign up to **3** more free agents from the remaining pool. Choose them best-OVR-first,
any position, skipping K/P, each only if `used + priceFor(p, …) <= capLimit * 0.95`, and with the roster staying ≤ 53. Reuse the existing signing code path / contract construction in that function (`priceFor`, the same contract shape). `runAIFreeAgency` currently has no notion of the user's club, so add an optional second param `skipTeamId?: string` and apply this **floor top-up only** to clubs whose id !== `skipTeamId` (the existing need-filling stays exactly as it is for every club). Pass `career.teamId` from the store call (`src/store/gameStore.ts` ~line 734, `startNextSeason`) and `career.teamId` from `src/game/engine/balance.ts` ~line 305. Leave the dev-probe call at ~2316 as is.
**Acceptance:** build + lint. The orchestrator re-runs `__balanceProbe(14)` and checks `capUsedPct` rises from ~0.59 toward 0.8–0.9 without `teamsOverCap` > 0.

---

## G1 — Shadow board (W2–W4)

**Player-facing:** Rungs with `proScout` get a **Shadow Board** card on the Free Agency screen and the Trades screen (sidebar or top card). You can rank up to **10**
players who are **not** on your club (other clubs' rosters or free agents). Add a player with a ☆ button on any non-own player row in Trades (their column) and Free Agency.
At season end each entry is graded. A **hit** is a player who gained ≥ 3 OVR since you added him, or who is ≥ 85 OVR and ≤ 27 years old. If your club acquires a shadow-board
player (trade or signing), his origin note gets "(from your shadow board)", and that counts as a hit at season end if he's ≥ 78 OVR.

**Types (`src/game/types.ts`):**
```ts
export interface ShadowEntry { playerId: string; name: string; pos: string; ovrAtAdd: number; season: number }
// CareerState:
shadowBoard?: ShadowEntry[]   // max 10
```
**Engine — NEW `src/game/engine/shadow.ts`:**
```ts
export const MAX_SHADOW = 10
export function canShadow(career: CareerState): boolean           // capabilities(career).can.has('proScout')
export function toggleShadow(world: World, career: CareerState, playerId: string): { board: ShadowEntry[]; message: string }
  // refuses own-club players ("He's already yours."), caps at 10 ("Your shadow board holds 10."), toggles off if present
export function gradeShadowBoard(world: World, career: CareerState): { hits: number; total: number; rep: Partial<Reputation>; lines: string[] }
  // hit rules above; rep: hits >= 5 → { roster: 2, evaluation: 1 }; hits 3–4 → { roster: 1 }; else {}.
  // lines: one per hit, e.g. "Shadow board: Tee Higgins grew 81 → 85."
export function isOnShadowBoard(career: CareerState, playerId: string): boolean
```
**Store:** `toggleShadowBoard(playerId)`, guarded by `canShadow`, with a toast of the message. In `runEndOfRegularSeason` (after `developPlayers`), if `canShadow(career)`:
merge `gradeShadowBoard(...).rep` into the season delta, push its lines to `seasonMoments`, and for each hit push a ledger entry
`{ kind: 'recommendation', recommendation: 'Starter', playerId, name, pos, college: '—', note: 'Shadow board hit', hit: true }` so it feeds the Résumé (portfolio
already picks up hit recommendations). Then drop entries for players who retired. In `proposeTrade` and `signFreeAgent`, if the incoming player `isOnShadowBoard`,
append " (from your shadow board)" to a new optional `PlayerOrigin.note?: string`.
**UI:** NEW `src/components/ShadowBoardCard.tsx` lists entries in order (name, pos, team abbr or "FA", OVR now vs at add, age) with a remove ✕. It's shown on
`FreeAgency.tsx` and `Trades.tsx` when `canShadow`. Add the ☆ toggle button (filled when on the board) to partner-column rows in `Trades.tsx` and to rows in
`FreeAgency.tsx`, using `stopPropagation`.

---

## G2 — Extension talks (W5–W7)

**Player-facing:** For rungs with `negotiate`, the Cap screen's **Extend** button opens **Extension Talks** instead of extending instantly. Each player has an agent
with a personality: **Hardball** (asks 112% of market, needs ≥ 100% of ask), **Market** (asks 104%, needs ≥ 95%), or **Loyal** (asks 98%, needs ≥ 90%, +5% leeway
if `morale >= 75`). You set **years** (1–5), **AAV** (a slider from 80% to 120% of the ask, 1% steps) and **guarantees** (Low 30% / Mid 50% / High 70% of total value).
Each guarantee level above Low counts as +4% of ask toward acceptance; years ≥ 4 counts −3% for players aged ≥ 29 (they want security, but the agent wants a big total
too). You get **3 offers per player per season**; after the 3rd rejection the player won't talk again this season. If you lack `manageCap` (Dir. Player Personnel),
an accepted deal goes to the GM, who signs off only if AAV ≤ 110% of market and the deal fits under the cap. Otherwise the toast says "The GM killed the deal: {reason}."

**Engine — NEW `src/game/engine/negotiation.ts`:**
```ts
export type AgentStyle = 'hardball' | 'market' | 'loyal'
export function agentStyle(playerId: string): AgentStyle          // (['hardball','market','loyal'] as const)[hash32(playerId, 131) % 3]
export function marketAsk(p: Player, season: number): number       // round(marketAAV(p.ovr, p.pos, p.age) * capScale(season) * styleMult / 1e5) * 1e5
export interface ExtensionOffer { years: number; aav: number; guarantee: 'low' | 'mid' | 'high' }
export function judgeOffer(p: Player, season: number, offer: ExtensionOffer): { accepted: boolean; pctOfAsk: number; needed: number; message: string }
export function buildExtension(p: Player, season: number, offer: ExtensionOffer): Contract  // new contract starting next season, like extendContract's shape: base escalates, guaranteed = total * pct
```
`buildExtension` must produce the same `Contract` shape `extendContract` returns (read `extendContract` in `cap.ts` and mirror its fields: `years`, `length`, `base[]`,
`signingBonus`, `proration`, `guaranteed`, `capHit` via `recomputeCapHit`, `annual`, `signedThrough`, `voidYears`). The extension keeps the current year's
contract and adds `offer.years` years. If unsure, call `extendContract(...)`, then overwrite `annual` and scale `base` so the new years average `offer.aav`.

**Types:** `CareerState.talks?: Record<string, { season: number; tries: number; closed?: boolean }>` (playerId →). `LedgerKind` adds `'contract'`. `LedgerEntry` adds
`aav?: number`, `ovrAtSign?: number`.

**Store:** a new action `offerExtension(playerId, offer)`:
- Guard: `capabilities(career).can.has('negotiate')`; the player is on the user's club with `contract.years <= 2`.
- `talks` bookkeeping: a new season resets tries. If `tries >= 3` or `closed`, toast "His camp has stopped taking calls this season."
- `judgeOffer`. On rejection: tries++, closed at 3, toast the message (e.g. "Hardball agent: 94% of ask won't do it.").
- On acceptance: if the career lacks `manageCap`, run the GM check (AAV ≤ 110% of `marketAAV × capScale` and `summarizeCap(...).space + current capHit − new capHit ≥ 0`).
  If it passes (or the career has `manageCap`), set `p.contract = buildExtension(...)` and push a ledger entry
  `{ kind: 'contract', playerId, name, pos, college: '—', aav: offer.aav, ovrAtSign: p.ovr, note: 'Extended {name}: {years} yrs, {money(aav)}/yr' }`.
- Keep the existing `extendPlayer` action untouched (the Cap screen just stops calling it for `negotiate` rungs).

**Ledger grading (`ledger.ts` `gradeEntry`):** `contract` entries are graded once ≥ 2 seasons have passed since `e.season`. Hit = the player is still in `world.players`
with `ovr >= (e.ovrAtSign ?? 0) - 2`. Outcome text: "Extension held up: {name} still a {ovr} OVR." or "Extension aged badly: {name} down to {ovr}."
**Portfolio (`portfolio.ts` `ledgerItems`):** `contract` hits → tags `['builder']`, strength 2.
**Ledger.tsx `KIND_META`:** `contract: { label: 'Contract', tone: 'info' }`.

**UI — NEW `src/components/ExtensionTalks.tsx`:** a modal or Card that opens from Cap.tsx. It shows the player header, agent style chip, ask (`money`), tries left (3 − tries),
the years select, the AAV slider showing $ and % of ask, the guarantee segmented control, a live "Projected cap hit next year", and an **Make offer** button.
In `Cap.tsx`, the Extend button calls `extendPlayer` exactly as today when the career lacks `negotiate`. Otherwise it opens ExtensionTalks (the button is enabled for `contract.years <= 2`).

---

## G3 — 3-year cap memo (W8–W9)

**Player-facing:** In the **offseason**, a `manageCap` rung files a **Cap Memo** on the Cap screen. It has three parts:
1. **Next season's year-end cap space** forecast: *Tight* (< $5M) / *Comfortable* ($5–25M) / *Flush* (> $25M).
2. Up to **3 priority extensions** (players on your club with `contract.years <= 2`).
3. One sentence of intent (free text, max 120 chars, display only).

The memo is locked once filed. At the **next** season's end it is graded:
- forecast bucket correct (from `summarizeCap(...).space` at that moment) → `{ roster: 2, leadership: 1 }`;
- each priority player who is still on the club AND whose `contract.signedThrough` increased since filing → `{ roster: 1 }` (max 3).
Also add a seasonMoments line and a ledger `advice` entry: "Cap memo: forecast {bucket} — {right/wrong}; {n}/{k} priorities extended."

**Types:** `CareerState.capMemo?: { filedSeason: number; bucket: 'tight' | 'comfortable' | 'flush'; priorities: { playerId: string; signedThrough: number }[]; note: string; graded?: boolean }`.
**Engine — NEW `src/game/engine/capMemo.ts`:** `canFileMemo(world, career)` (has `manageCap`, `world.phase === 'offseason'`, and no ungraded memo filed this offseason),
`spaceBucket(space)`, `gradeCapMemo(world, career): { rep; lines; summary } | null` (only if `!graded` and `world.season === filedSeason + 1`).
**Store:** `fileCapMemo(bucket, priorityIds, note)`, guarded. In `runEndOfRegularSeason`, `gradeCapMemo`, merge rep, set `graded: true`.
**UI:** a `CapMemoCard` in `Cap.tsx`. In the offseason, if `canFileMemo`, show the form. Once filed, show the locked memo and its status ("Graded at the end of {season}").

---

## G4 — Combine week (W10–W11)

**Player-facing:** In the **offseason before the draft** (`world.phase === 'offseason' && world.draftState.pickIndex === 0`), personnel levels 4–5 get a **Combine Week**
card on the Scouting screen, once per season, with **20 hours**:
- **Interview** (4 h): reveal one character facet at accuracy 0.85 using `revealFacet` (same as `investigateCharacter`, but the fixed accuracy replaces the skill-based one).
- **Workout** (3 h): `myGrade` moves 60% of the way to `trueGrade`, and `confidence +30` (cap 100).
- **Film** (5 h): `myGrade = trueGrade ± 2` (seeded jitter) and `confidence = max(confidence, 85)`.

You can work on at most **12 distinct prospects**. No points are spent: the combine replaces scouting points that week.
**Types:** `CareerState.combine?: { season: number; hoursLeft: number; seen: string[] }`.
**Engine — NEW `src/game/engine/combine.ts`:** `COMBINE_HOURS = 20`, `COMBINE_COST = { interview: 4, workout: 3, film: 5 }`, `combineOpen(world, career)`,
`applyCombine(world, career, prospectId, kind, rng): { career: CareerState; message: string } | { error: string }`.
The rng for each action is `makeRng(world.seed + world.season * 433 + hash32(prospectId + kind, 3))`.
**Store:** `combineAction(prospectId, kind)`.
**UI:** NEW `src/components/CombineCard.tsx` on `Scouting.tsx` when `combineOpen`. It shows hours left, prospects seen (n/12), and a search/select of the class board plus the
three action buttons with their costs. Each result is a toast.

---

## W12 — Docs
Append "L7 The middle of the building" (W0–W11, key files shadow.ts, negotiation.ts, capMemo.ts, combine.ts and their components) under Done in HANDOFF.md.

## PUSHES
- **P1 = W0, W1** (the orchestrator re-runs the balance probe and the cap-usage check after it)
- **P2 = W2–W4** · **P3 = W5–W7** · **P4 = W8–W9** · **P5 = W10–W12**

After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings.
Never run `npm run dev` or any watch command. No git commands.

## DO NOT
- Do not change `evaluateTrade`, `partnerValue`, `assetValue`, reputation gates, `roleObjectives` targets/rewards, `capabilities.ts`/`access.ts`, sim calibration,
  `marketAAV`, `makeVeteranContract`, or `fitToCap`.
- Do not remove the existing `extendPlayer` action.
- Every new save field is optional; old saves must load. No new dependencies. Do not fix the baseline lint warnings. Do not reformat unrelated code.
- Do not edit any NEXT_PHASE*.md.
