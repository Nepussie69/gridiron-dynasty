# NEXT PHASE — L11 "In-season roster life": fix free signings, add Waiver Tuesday

_Planned by Claude Opus 5.5 on 2026-10-07. Implemented push by push by DeepSeek Flash 4.1 (OpenCode)._
_Lint baseline: exactly 5 warnings. Line numbers marked ~ are approximate: find code by name._

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| W1 | **Bug:** signing a released/cut free agent gives a $0, 0-year contract | P1 | not started |
| W2 | Waiver Tuesday engine: in-season releases go on waivers; claims by waiver priority | P1 | not started |
| W3 | AI in-season injury moves (sign a replacement, release a surplus player onto waivers) | P1 | not started |
| W4 | Waiver Wire UI, user claims, news, `__waiverProbe`, docs | P2 | not started |

## Phase goal
The season is now coached game by game (L10), but the roster is frozen between Week 1 and the offseason: AI clubs never react to injuries, and a cut player can be re-signed for nothing.
L11 makes the in-season roster live: a priced signing for every free agent, a **waiver wire** every Tuesday where the worst teams get first pick of released players, and AI clubs that replace injured starters.

**Guardrails (unchanged):** no changes to reputation gates, objectives, capabilities, sim constants, `evaluateTrade` or contract pricing formulas (reuse `priceFor`/`marketAAV`).
Every new save field is optional (`??=` in `migrateWorld`/`migrateCareer`). Roster entries must stay the canonical `world.players` objects (move objects between lists; never copy them).
Every roster stays 45–60 (the smoke probe checks it). No dominant strategy: claiming must cost something (you take on the contract) and priority favors bad teams.

---

## P1

### W1 — Priced free-agent signings (bug)
**Repro (verified by the orchestrator):** release Nate Wiggins (79 OVR, $1.09M cap hit, 4 years), then `signFreeAgent` him: he comes back with `capHit 0, years 0`, a free season.
`releasePlayer` and `trimNflRosters`/`tickAllContracts` zero the contract (`years: 0, base: [0], capHit: 0`), and `signFreeAgent` keeps whatever contract the player carries.
**Fix:**
1. `progress.ts`: export `priceFor` as `export function marketPrice(p: Player, season: number): number` (same formula; keep `priceFor` as an internal alias or replace its uses).
2. NEW `export function freeAgentContract(p: Player, season: number, week: number, phase: 'regular' | 'offseason' | string): Contract` in `src/game/engine/cap.ts` (or `progress.ts` if `cap.ts` would import a cycle):
   one year, `annual = marketPrice(p, season)`, `base = [annual]`, `signingBonus 0`, `proration 0`, `guaranteed 0`, `length 1`, `years 1`, `voidYears 0`, `signedThrough = season`,
   and `capHit = annual` in the offseason, or `Math.round(annual × (18 − week + 1) / 18)` during the regular season (pro-rated for the weeks left).
3. `signFreeAgent` (store): build `freeAgentContract(...)` **before** the cap check, check `cap.space >= contract.capHit`, then assign it. The Free Agency screen's button checks the same number
   (show the pro-rated cap hit in the button's disabled state).
4. `signToPracticeSquad`: practice-squad deals get `freeAgentContract` too, but with `annual = 250_000` (PS salary; still pro-rated).
**Acceptance:** release → re-sign a player: he returns with `years 1` and a non-zero cap hit equal to the pro-rated market price; build + lint 5.

### W2 — Waiver Tuesday (`NEW src/game/engine/waivers.ts`)
```ts
export interface WaiverEntry {
  playerId: string
  fromTeamId: string
  season: number
  week: number             // the week the player was placed on waivers
  contract: Contract       // the ORIGINAL contract (a claiming club takes it over)
  deadBooked: number       // dead money the releasing club was charged at release
  claims: string[]         // club ids that put in a claim (the user's club included)
}
export function waiverPriority(world: World): string[]                        // NFL club ids, worst win% first; ties: lower point differential, then id
export function placeOnWaivers(world: World, p: Player, fromTeamId: string, original: Contract, deadBooked: number): void
export function aiWaiverClaims(world: World, skipTeamId?: string): void        // AI clubs add their claims to open entries
export function processWaivers(world: World): { claimed: { playerId: string; teamId: string }[]; cleared: string[] }
```
- **Types:** `World.waivers?: WaiverEntry[]` (`??= []`).
- **Releasing in season:** in the store's `releasePlayer`, when `world.phase === 'regular'`: book the dead money exactly as today, keep a copy of the original contract (`{ ...p.contract }`, a plain data copy is fine),
  remove the player from the roster, set `p.teamId = null`, and call `placeOnWaivers` instead of pushing to `freeAgents`. Offseason releases are unchanged (straight to free agency).
  `placeOnWaivers` keeps the player object in `world.players` (it never leaves) and records the entry.
- **Processing ("Tuesday"):** at the start of `advanceWeek` for the regular season (before any game is simulated), call `aiWaiverClaims(world, career.teamId)` then `processWaivers(world)` for entries placed in an
  **earlier** week. For each entry, in `waiverPriority` order, the first claimant that can afford it wins: needs `cap.space >= contract.capHit` and a roster under 53 (an AI club at 53 first releases its
  lowest-OVR player at a position above `ROSTER_FLOOR`, which goes on waivers itself). The winner gets the player with the **original contract**, and the releasing club's `deadMoney` is reduced by
  `deadBooked` (the claimer took the contract over). Set `p.origin = { kind: 'waiver', season, by: winnerName, fromTeamId }` (add `'waiver'` to the origin kind union if needed).
  Unclaimed: the player goes to `freeAgents` with the zeroed contract (as today; W1 prices him when someone signs him) and the dead money stays.
  Processed entries are removed. Waivers older than 2 weeks never linger.
- **AI claims (`aiWaiverClaims`):** an AI club claims an entry when it has cap room, at most **one claim per club per week**, and either it has fewer healthy players than `STARTERS[pos]` at the player's
  position, or the player's OVR is ≥ its weakest healthy starter at that position + 2. Deterministic: no rng.
- **Offseason:** at `startNextSeason` (and at the end of the regular season), any remaining waiver entries clear to free agency.

### W3 — AI in-season injury moves (`waivers.ts` or `progress.ts`)
`export function aiInjuryMoves(world: World, skipTeamId?: string): void`, called in `advanceWeek` right after `processWaivers`:
for each AI NFL club, if a starter (by `depthAt`, within `STARTERS[pos]`) is injured with `games >= 3` and the club has fewer healthy players at that position than `STARTERS[pos] + 1`:
sign the best free agent at that position whose `freeAgentContract` cap hit fits the club's space (at most one signing per club per week). If the roster then exceeds 53, release its lowest-OVR player
at a position above `ROSTER_FLOOR` onto waivers (`placeOnWaivers`, booking dead money as a normal release). Deterministic: no rng. Skip the user's club.
**Acceptance (P1):** build + lint 5. Orchestrator: `__careerSmoke(6,'personnel')` and `(6,'coach')` 0 errors / 0 violations (rosters 45–60, canonical objects, cap ≤ 105%); a 17-week season shows AI waiver
claims and injury signings in a probe; a user release in season lands on waivers and a claiming club takes over the original contract.

---

## P2

### W4 — Waiver Wire UI, claims, news, probe, docs
- **Store actions:** `claimWaiver(playerId)` / `cancelWaiverClaim(playerId)` (need `canSignFreeAgents(career)`; at most 3 open user claims; the claim stays until Tuesday).
- **Free Agency screen:** a "Waiver Wire" card above the free-agent table: this week's entries (player, position, OVR, age, the original contract's cap hit and years, the releasing club),
  **your waiver priority** ("You pick 14th of 32"), and a Claim / Cancel button per row (disabled with a reason when you lack authority, cap room, or a roster spot).
- **News / moments:** when the user wins a claim: a news item and a `seasonMoments` line ("Claimed {name} off waivers from the {Team}."); when they lose one: "{Team} claimed {name} ahead of you."
  When an AI club claims a player the user released: news "{Team} claimed {name} off waivers."
- **Probe:** `waiverProbe(weeks = 17)` → `window.__waiverProbe`: on a fresh career's world, run AI injury moves and AI claims + processing for `weeks` weeks (simulate injuries with `healAfterWeek` between weeks),
  and report `{ releases, claims, cleared, injurySignings, maxRoster, minRoster }`.
- **Docs:** append an "L11 In-season roster life" section under Done in `HANDOFF.md` (append only).

---

## PUSHES
**P1 = W1, W2, W3** · **P2 = W4**
After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings. Never run `npm run dev` or any watch command. No git commands.

## DO NOT
- Do not change `marketAAV`, `capScale`, `deadMoney`, `evaluateTrade`, gates, objectives, capabilities or sim constants. Do not change L10 game-day code.
- Do not copy player objects into rosters (move the canonical object). Do not leave temp/probe files in the repo.
- Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md` or `IDEAS_*.md`. `HANDOFF.md`: append only, and only in W4.
- No new dependencies. Do not fix the baseline lint warnings. Do not reformat unrelated code.

## Verification log
