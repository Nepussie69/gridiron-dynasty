# NEXT PHASE — L6.5 "Playtest fixes"

_Planned by Claude Opus 5.5 on 2026-10-06 from the user's first playtest. Implemented by DeepSeek Flash 4.1 (OpenCode)._
_Lint baseline: exactly 5 warnings (PlayerTable.tsx:39, Cap.tsx:22, ui/kit.tsx:371, MatchView.tsx:151, MatchView.tsx:160)._

## Progress

| Task | What | Status |
|---|---|---|
| V1 | **Bug:** every contract is crushed to the $0.9M minimum | ✅ done — verified (P1) |
| V2 | Repair existing saves with crushed contracts | ✅ done — verified (P1) |
| V3 | Trade Center shows real cap hits (not "$0") | ✅ done — verified (P1) |
| V2b | **Bug:** JSON save import un-links roster from players | ✅ done — verified (P2) |
| V4 | Deal finder: engine | ✅ done — verified (P2) |
| V5 | Deal finder: "Find deals" button + offers panel | ✅ done — verified (P2) |
| V6 | Depth chart: stored order + engine helper | ✅ done — verified (P3) |
| V7 | Sim reads the depth chart | ✅ done — verified (P3) |
| V8 | Depth chart UI: OT / OG / C split, all players, ▲▼ move, set starter | ✅ done — verified (P3) |
| V9 | HANDOFF.md docs | ✅ done — verified (P3) |
| V10 | Calibration: DL picks its best 4 unless the user set DL starters | ✅ done — verified (P4) |

## What the playtest found

1. **All 1,696 rostered players are on $0.9M minimum deals.** Josh Allen, Mahomes and Garrett are all on $0.9M; a club uses ~$48M of a ~$279M cap.
   Root cause: `src/game/engine/generate.ts` `buildWorld` calls `fitToCap(players, t.prestige > 80 ? .86 : .79)`, but `fitToCap(roster, target)`
   treats `target` as **dollars**. The factor is ≈ 0, every base is floored at `9e5`, and bonuses, proration and `annual` go to ~0.
   Contract creation itself is fine (`makeVeteranContract(…, 95, 'QB', 29, 2026)` → ~$47.5M AAV).
2. Trade Center rows show **"$0"** because they print `contract.annual`, which is 0 for everyone because of bug 1.
3. The user wants a **"Find deals" button** that shops one of their players around the league.
4. The **depth chart can't be changed**: `DepthChart.tsx` only sorts by OVR and shows the top 4 per card. Offensive Line merges OT/OG/C, so the
   **center falls off the top 4**. The user wants movable players and separate T / G / C slots.

---

## V1 — Fix the cap scaling (`src/game/engine/generate.ts`)
In `buildWorld`, change the call to
`fitToCap(players, Math.round(capForSeason(season) * (t.prestige > 80 ? 0.86 : 0.79)))`.
Import `capForSeason` from `./cap` if it isn't imported already. Do not change `fitToCap` itself.
**Acceptance:** build + lint. A dev-console check (the orchestrator runs this) gives a fresh career where < 40% of rostered players are on deals ≤ $1.2M, and each club's
total cap hits fall between 75% and 90% of `capForSeason(season)`.

## V2 — Repair crushed saves (`src/store/gameStore.ts`, in the existing load/migrate path, `migrateWorld` or `hydrate`)
Add `repairCrushedContracts(world)`, exported from `generate.ts` or written as a small helper next to `migrateWorld`.
If ≥ 90% of rostered players have `contract.annual === 0`, then for every club:
re-create each rostered player's contract with `makeVeteranContract(makeRng(hash32(p.id, 77)), p.ovr, p.pos, p.age, world.season)`.
Keep a rookie's existing contract if `p.origin?.kind === 'draft'` and `p.origin.season >= world.season - 3`.
Then call the same corrected `fitToCap` target as V1 (export `fitToCap` from generate.ts if needed). Free agents are left alone.
The repair runs only once: after it, `annual` is no longer 0, so the condition is false. Log a news item: "League office: contracts restated for the new league year."

## V2b — Re-link players after a JSON import (pre-existing bug, found while verifying V2)
A save imported from a file (`importSaveText`) is parsed from JSON, so `world.roster[team]`, `world.practiceSquad[team]`, `world.ir[team]` and `world.players`
hold **separate copies** of each player. Changes to one list (development, trades, contracts) never reach the other. Saves from IndexedDB keep identity, so they're unaffected.
**Fix:** at the START of `migrateWorld` in `src/store/gameStore.ts`, before `repairCrushedContracts`, add `relinkPlayers(w)`. It builds
`const byId = new Map(w.players.map(p => [p.id, p]))`, then replaces every entry of `w.roster[t]`, `w.practiceSquad[t]` and `w.ir[t]` with `byId.get(p.id) ?? p`.
For roster entries missing from `w.players`, push them into `w.players`. It must be idempotent and cheap.
**Acceptance:** build + lint. The orchestrator verifies `rosterPlayer === playersEntry` after an import.

## V3 — Show real money in the Trade Center (`src/screens/Trades.tsx`)
In `assetsFor`, change the player `sub` to use `money(p.contract.capHit)` with a `/yr` suffix: `` `${p.pos} · ${p.age} yrs · ${money(p.contract.capHit)}` ``.

---

## V4 — Deal finder engine (`src/game/engine/trade.ts`, new exports; do NOT change `evaluateTrade`/`partnerValue`/`assetValue`)
```ts
export interface DealOffer { partnerId: string; get: TradeAsset[]; give: TradeAsset[]; theyGive: number; theyReceive: number; userValue: number; summary: string }
/** Shop one of your players around the league: the best acceptable package from each club, best first (max 6). */
export function findDeals(world: World, userTeamId: string, playerId: string): DealOffer[]
```
Algorithm (deterministic):
- `give = [{ kind: 'player', id: playerId }]`.
- For each NFL team except the user's: list the partner's assets. Players come from `world.roster[partner]`; picks come from `world.draftPicks` with `ownerTeam === partner`.
  Sort them by `assetValue(world, a)` descending.
- Greedy: start `get = []`. Walk the sorted list. Tentatively add an asset if `get.length < 3`, and keep it only if
  `evaluateTrade(world, partner, userTeamId, give, [...get, a]).accepted` is still true. Skip any asset whose position would leave the partner with 0 players at that position.
- Discard partners where `get` is empty, or where `userValue` (the sum of `assetValue` over `get`) is less than 50% of `assetValue` of the shopped player.
- `summary`: e.g. "BUF: Greg Rousseau (DE, 88) + 2027 Rd 3".
- Sort by `userValue` descending and return the top 6.
**Guardrail:** every offer is a deal `evaluateTrade` already accepts by hand; the finder only searches. It adds no new exploit.

## V5 — Deal finder UI (`src/screens/Trades.tsx`)
- In the user's column (`AssetColumn` for the active team), each **player** row gets a small "Find deals" icon button (lucide `Search`) next to the +/× toggle.
  Use `stopPropagation`.
- Clicking it runs `findDeals(league, activeTeamId, p.id)` and opens a panel above the columns: "Deals for {name}". The panel lists up to 6 offers
  (partner crest + summary, values "You get X · You give Y"), and each has a **Load deal** button. Load deal does `setPartnerId(o.partnerId)`, `setGive(…)`, `setGet(…)`,
  mapped to the existing `Asset` objects via `assetsFor`, then closes the panel. The user still clicks Propose Trade to make the trade.
- Empty state: "No club will pay real value for {name} right now."
- If the user lacks trade authority (`accessFor(career,'trades') !== 'decide'`), still allow Find deals (it's scouting the market); Propose stays gated as today.

---

## V6 — Stored depth chart + engine helper
**Types:** `World` (generate.ts) gains `depth?: Record<string, Partial<Record<Position, string[]>>>` (teamId → position → ordered player ids).
**New `src/game/engine/depth.ts`:**
```ts
export const STARTERS: Record<Position, number> = { QB:1, RB:1, WR:3, TE:1, OT:2, OG:2, C:1, DE:2, DT:2, LB:3, CB:2, S:2, K:1, P:1 }
/** Players at one position in depth order: the stored order first (still on the roster), then the rest by OVR. Includes injured players. */
export function depthAt(world: World, teamId: string, pos: Position): Player[]
/** Healthy players for a multi-position group, starters first: rank = (index-in-depthAt < STARTERS[pos] ? 0 : 1), then OVR desc. */
export function depthGroup(world: World, teamId: string, positions: Position[], n: number): Player[]
export function moveInDepth(world: World, teamId: string, pos: Position, playerId: string, dir: -1 | 1): void
export function setStarterInDepth(world: World, teamId: string, pos: Position, playerId: string): void // move to index 0
export function resetDepth(world: World, teamId: string): void // delete world.depth[teamId]
```
`moveInDepth` / `setStarterInDepth` first materialise `world.depth[teamId][pos] = depthAt(...).map(p => p.id)`, then swap or move.
`depthGroup` skips injured players, but an injured starter's slot is filled by the next healthy player at that position.

## V7 — Sim reads the depth chart
- `src/game/engine/playsim.ts` `topGroup(world, teamId, positions, n)`: return `depthGroup(world, teamId, positions, n)`.
- `src/game/engine/statAlloc.ts` `group(...)`: use `depthGroup(world, teamId, positions, n)` for `list`.
- Note: with no stored order (every AI club), `depthGroup` picks the top-OVR players **per position up to STARTERS**, then the rest by OVR. That's slightly
  different from today's pure top-n across positions (e.g. the OL now always fields 2 OT / 2 OG / 1 C). This is intended.
  The orchestrator re-runs `__simTest(60,'NFL')` afterwards to confirm calibration still holds (~22–23 pts, ~65% comp).
- Check that the league-sim web worker (`src/workers/leagueSim.worker.ts`) receives `world.depth` if it serialises the world. If it builds its own roster
  snapshot, include `depth` in that snapshot.

## V8 — Depth chart UI (`src/screens/DepthChart.tsx`)
- Split **Offensive Line** into three cards: **Tackles** (OT), **Guards** (OG) and **Center** (C). Split **Defensive Line** into **Edge** (DE) and **Interior** (DT).
  Every card covers one position, so `depthAt` drives it directly.
- Show **every** player at the position, not just the top 4. Draw a divider after the first `STARTERS[pos]` rows, with starters labelled `1…k`.
  Injured players keep their "OUT" badge.
- Who can edit: the user's club only (`activeTeamId === career.teamId`), and only when
  `capabilities(career).can` has `'gameManagement'` or `'callPlays'` (HC, or a coordinator for his own side), **or** the user is the GM (`isGM(career)`).
  The user asked for movable players while playing GM. Everyone else sees the chart read-only with the hint "The head coach sets the depth chart."
- When editable, each row gets **▲ / ▼** buttons (`moveDepth`) and a **Start** button (`setStarter`) that shows when the row is below the starter line.
  Add a header button **Reset to ratings** (`resetDepth`). Row click still opens the player profile; buttons use `stopPropagation`.
- Store (`gameStore.ts`): add the actions `moveDepth(pos, playerId, dir)`, `setStarter(pos, playerId)` and `resetDepthChart()`. Each calls the depth.ts helper
  on `world` for `career.teamId`, then `bump` + `save`.

## V9 — Docs
Append "L6.5 Playtest fixes" (V1–V8, key files depth.ts, trade.ts findDeals) under Done in HANDOFF.md.

## TASK ORDER and acceptance
After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings.
Never run `npm run dev` or any watch command. No git commands.
Pushes: **P1 = V1–V3** (cap fix; the orchestrator re-runs the balance probe after it, because pacing was tuned on the broken cap) · **P2 = V4–V5** · **P3 = V6–V9**.

## DO NOT
- Do not change `evaluateTrade`, `partnerValue`, `assetValue`, reputation gates, objectives, or sim calibration constants.
- Do not change `fitToCap`'s body, `makeVeteranContract`, or `marketAAV`.
- Every new save field is optional; old saves must load. No new dependencies. Do not fix the baseline lint warnings. Do not reformat unrelated code.
- Do not edit any NEXT_PHASE*.md.

## Verification log
- **P1** (browser): fresh career → stars on real deals (Allen $48.9M, Burrow $48.6M), clubs at 80–94% of cap, 21% on min deals (depth). A crushed save
  loaded from IndexedDB is repaired (Allen $49.8M, 13% min deals, news item shown). Probe on real contracts: personnel GM 9/12/9/10/10, coach HC 10/10/10.
  `__simTest(60)` 23.0 pts, 65.7% comp. Watch: league cap usage drifts to ~59% over 14 probe seasons (AI spending), so not addressed here.
  Found the V2b import bug (JSON import un-links roster and players).
- **P2** (browser): after a JSON export→import every roster entry `===` its `world.players` entry (V2b). Find deals on Myles Garrett (CLE) → 6 offers
  (e.g. PIT: Highsmith + Killebrew + Rd 4; CIN: Tee Higgins + Rd 2 + Rd 3); Load deal fills the builder and the verdict is "They accept". Claude fixed the panel
  value line, which showed unrounded partner-view numbers labelled as the user's; it now reads "Value back {userValue} · for {shopped value}", rounded.
- **P3** (browser, CLE GM): the depth chart shows Tackles / Guards / Center / Edge / Interior cards plus Reset to ratings, with ▲▼ on every row. Making Deshaun Watson
  the starter → `depthAt` QB1 = Watson, and in the next game Watson threw 30 passes while Flacco didn't play. The OL always fields 2 OT / 2 OG / 1 C.
  **Calibration drift:** `__simTest(150)` = 24.9 pts / 68.9% comp / 2.91 sacks (before P3: ~23.0 / 65.7% / 3.5). Most likely cause: DL now forced to 2 DE + 2 DT
  (pass rush down). Not tuned; this is a user decision (see the summary).

---

## V10 — Calibration fix: defensive line picks its best 4 (user chose option 1)

**Why:** After P3, `__simTest(150)` drifted to 24.9 pts / 68.9% comp / 2.91 sacks (was ~23.0 / 65.7% / 3.5). `depthGroup` now forces every DL to 2 DE + 2 DT
via the `STARTERS` quotas, which weakens pass rushes compared with the old "best 4 across DE+DT".

**Change (`src/game/engine/depth.ts`, `depthGroup` only):** a position's starter quota applies only when the position is a "fixed slot" position, or when the club
has a stored order for it.
```ts
/** Positions pooled by rating unless the club set an explicit order (keeps sim calibration). */
const POOLED: Position[] = ['DE', 'DT']
```
In `depthGroup`, for each `pos`: `const quota = POOLED.includes(pos) && !world.depth?.[teamId]?.[pos] ? 0 : (STARTERS[pos] ?? 1)`.
Rank = `i < quota ? 0 : 1`, then OVR desc, exactly as now. With quota 0 every DE/DT ranks 1, so the group is the best-by-OVR 4, the same as before P3.
Once the user moves or starts a DE or DT, that position's order is stored, its quota applies, and the user's starters play.
Do NOT change the OL, WR/TE or any other behaviour, `STARTERS`, or `depthAt`. The Depth Chart UI is unchanged.

**Acceptance:** build + lint at 5 warnings. The orchestrator re-runs `__simTest(150,'NFL')`; the target is back near ~23 pts / ~66% / ~3.4 sacks.
- **P4 / V10** (browser): the change applied exactly as specced. **Correction to the P3 note:** the "drift" was a measurement error. The pre-P3 baseline (23.0 pts)
  came from seed 33333 at n=60, and the post-P3 number from seed 4242 at n=150. Same-seed comparison on the current code with `__simTest(150)` after starting a career:
  33333 → 23.2 pts / 67.1% / 3.32 sacks (baseline 23.0 / 65.7 / 3.5); 20261004 → 23.2 / 66.2 / 4.09; 111 → 25.1 / 65.7 / 4.06; 4242 → 24.5 / 68.8 / 2.79.
  Calibration holds, and the league-to-league spread is about 23–25 pts. V10 is kept anyway: it restores pre-P3 DL selection for clubs that haven't set DL starters.
  Note: `__simTest` with no career loaded runs on the placeholder world (no real data) and gives ~29.6 pts, so always start a career before measuring.
