# NEXT PHASE — L7.5 "League economy fixes"

_Planned by Claude Opus 5.5 on 2026-10-06 after L7 verification. Implemented by DeepSeek Flash 4.1 (OpenCode)._
_Lint baseline: exactly 5 warnings (PlayerTable.tsx:39, Cap.tsx:22, ui/kit.tsx:371, MatchView.tsx:151, MatchView.tsx:160)._

## Progress

| Task | What | Push | Status |
|---|---|---|---|
| X1 | AI clubs swap cheap depth for better free agents when under the cap floor | P1 | ✅ done — verified |
| X2 | AI stops re-signing the user's club when the user owns contracts | P1 | ✅ done — verified |
| X3 | Week-12 "expiring contracts" inbox warning | P1 | ✅ done — verified |
| X4 | HANDOFF.md docs | P1 | ✅ done — verified |

## Problems (found while verifying L7)

1. **Payroll drift.** Over a 14-season balance probe, league cap usage drifts to ~59–61% of the cap. L7's W1 cap-floor top-up in `runAIFreeAgency`
   (`src/game/engine/progress.ts`) only signs while `roster.length < 53`, but AI rosters average ~54.8 players (mostly cheap depth), so it almost never fires.
2. **AI re-signs the user's players.** `runAIResign(world)` (called in `src/store/gameStore.ts` `runEndOfRegularSeason`, ~line 2000) loops over **every** NFL club,
   including the user's. A GM's expiring players get quietly re-signed, and it even satisfied a cap-memo priority the user never acted on.

---

## X1 — Depth-for-talent swaps (`src/game/engine/progress.ts`, inside the existing W1 top-up block in `runAIFreeAgency`)
The block currently loops `while (topUps < 3 && roster.length < 53 && usedCap() < capLimit * CAP_FLOOR_PCT)`. Change it so a full roster can **swap**:
- The loop condition becomes `while (topUps < 3 && usedCap() < capLimit * CAP_FLOOR_PCT)`.
- Find `cand` exactly as now (best-OVR free agent, not K/P, fits `usedCap() + priceFor(...) <= capLimit * 0.95`). If none, `break`.
- If `roster.length >= 53`, find a **release candidate**: the lowest-OVR player on `roster` such that
  (a) `counts[p.pos] > (ROSTER_FLOOR[p.pos] ?? 2)`,
  (b) `p.contract.capHit <= 2_000_000`,
  (c) `p.ovr <= cand.ovr - 3`, and
  (d) he is not a starter: `depthAt(world, t.id, p.pos).findIndex(x => x.id === p.id) >= STARTERS[p.pos]` (import `depthAt`, `STARTERS` from `./depth`).
  If there's no release candidate, `break`. Otherwise release him **exactly the way `trimNflRosters` does** (splice from roster, `counts[pos] -= 1`, `teamId = null`, zeroed contract,
  push to `world.freeAgents`), then sign `cand` as the block already does.
- `skipTeamId` still exempts the user's club. Keep everything else (`taken`, `ledgerFreeAgent`, the final `world.freeAgents` filter) the same.
  Make sure a player released here is never re-picked as `cand` in the same pass: he's pushed to `world.freeAgents`, not `freeCopy`, so this already holds. Don't add him to `freeCopy`.
**Acceptance:** build + lint. The orchestrator re-runs `__balanceProbe(14)` and expects `capUsedPct` well above 0.61 (target 0.75–0.9), `teamsOverCap` 0, `avgRosterSize` ≈ 53–55,
and GM pacing still ~9–12.

## X2 — The user's club re-signs its own players when the user owns contracts
- `runAIResign(world: World, skipTeamId?: string)`: skip the club whose `t.id === skipTeamId` (the whole club). Nothing else changes.
- In `src/store/gameStore.ts` `runEndOfRegularSeason` (~line 2000): pass `career.teamId` **only when** the career owns contracts:
  `const ownsContracts = capabilities(career).can.has('negotiate') || capabilities(career).can.has('manageCap')`, then
  `runAIResign(world, ownsContracts ? career.teamId : undefined)`. Scouts and coaches keep today's behaviour: the NPC front office re-signs for them.
- Do **not** pass it in `src/game/engine/balance.ts` (the probe simulates a competent front office) or in the dev probe at ~2511.
**Acceptance:** build + lint. The orchestrator checks that a GM career's expiring players are not auto-extended at season end, and that a scout career's still are.

## X3 — Expiring-contracts warning (`src/store/gameStore.ts`, `advanceWeek`)
When the user owns contracts (same `ownsContracts` test) and `world.week === 12` during the regular season, push one news item (category `'Roster'`, `teamId: career.teamId`):
headline `"{n} contracts expire after this season"`, body listing up to 6 names with OVR, e.g. "Njoku (TE, 89), Bitonio (OG, 85)… Extend them from the Cap screen or they hit free agency."
Only players on the user's club with `contract.years <= 1` and `ovr >= 70` count. If `n === 0`, push nothing. Fire once per season: guard with an id like
`` `expiring_${world.season}` `` and skip if `world.news` already has it.
**Acceptance:** build + lint.

## X4 — Docs
Append "L7.5 League economy fixes" (X1–X3) under Done in HANDOFF.md.

After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings.
Never run `npm run dev` or any watch command. No git commands.

## DO NOT
- Do not change `trimNflRosters`, `priceFor`, `marketAAV`, `fitToCap`, the need-filling part of `runAIFreeAgency`, reputation gates, objectives, or sim calibration.
- Do not pass `skipTeamId` to `runAIResign` from balance.ts or the dev probes.
- Every new save field is optional. No new dependencies. Do not fix the baseline lint warnings. Do not reformat unrelated code. Do not edit any NEXT_PHASE*.md.

## Verification log
- **X1** probe: capUsedPct 0.59–0.61 → **0.76–0.84** across 5 seeds; overCap 0; avg roster ~55; avgNflPoints ~21.
- **X2/X3** (browser): a GM career gets "3 contracts expire after this season" in week 12, and un-extended players reach free agency (0/3 kept). A scout career has no warning, and the NPC front office still re-signs (1/3).
- **Pacing regression (needs a user decision):** personnel → GM by seed: 20261004: 14 · 111: never (14) · 2222: never (16, stuck at L6 all career) · 33333: 9 · 5150: 10.
  Better-funded AI clubs make the probe's club win less, so it stalls at **Director of Player Personnel** (the gate for Asst GM is roster 55 / leadership 52 / profile 60).
  The probe does not use L6/L7 rep sources (shadow board, extension talks, conviction), so real play is faster. Fix options are presented to the user.
