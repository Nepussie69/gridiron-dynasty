# NEXT PHASE — L12.6 "Live stats and a real calendar" (user playtest requests, 2026-10-08)

_Planned by Claude Opus 5.5 from the user's screenshots. Implemented by DeepSeek Flash 4.1. Lint baseline: exactly 4 warnings._

User's words: "no stats are updated to live weeks and just have offensive stats and defensive stats and can sort based on positions too … redo the stats screen";
"make sure draft is in april not during the season, it doesn't make sense, same with true free agency".

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| S1 | Stats Hub rebuilt: live season stats (updated every week), Offense / Defense / Kicking tabs, position filter, sortable columns, team filter, qualifier | P1 | ✅ done — verified (P1) |
| C1 | Offseason calendar: Re-sign (Feb) → Free agency (Mar) → Draft (Apr) → Camp (Aug) → season | P2 | not started |
| C2 | The draft only happens in April (stage `draft`); in season the Draft screen is a read-only scouting board | P2 | not started |
| C3 | Free agency: the market of expiring contracts opens in March; in season only the street / waiver pool (L11) | P2 | not started |

---

## P1 — S1 Stats Hub (`src/screens/StatsHub.tsx`; UI only)
**Bug today:** the hub reads `statsDb`, which is written at season end (`recordPlayerSeasons`), so during a season it shows "0 players". Live numbers are already on each player: `player.stats` (`SeasonStats[]`, the current season's
entry is updated after every week by `recordGameStats` / `recordBoxLines`) — the roster Stats tab (`src/components/StatsTable.tsx`) already uses them.
- **Source:** current season → every NFL player in `world.players` (rostered and free agents) with a `stats` entry for `world.season`, level 'NFL' (a player traded mid-season can have one entry per team: sum them and show
  the current club). Past seasons → `statsDb.players[*].seasons` for that season. Career → sum of all seasons in `statsDb` plus the live season.
- **Header:** scope chips `Season <year>` (default, live) | past seasons (a select listing `seasonsRecorded`) | `Career`. Subtitle: "Through week N" for the live season.
- **Tabs:** **Offense** | **Defense** | **Kicking** (only if FG/punt stats exist on `SeasonStats`; otherwise omit the tab — do not add new stat fields).
  - Offense columns: Player, Team, Pos, GP, then Passing (C/ATT, Comp %, YDS, TD, INT, RTG), Rushing (ATT, YDS, Y/A, TD), Receiving (TGT, REC, YDS, Y/R, TD). Group headers over the column groups.
  - Defense columns: Player, Team, Pos, GP, TCK, TFL, SCK, INT, PD, and coverage (TGT allowed, CMP allowed, YDS allowed, TD allowed, COV grade via `coverageGrade`) where present.
- **Position filter chips** per tab: Offense ALL / QB / RB / WR / TE; Defense ALL / DL (DE+DT) / LB / CB / S. A position preset also picks a sensible default sort (QB → pass YDS, RB → rush YDS, WR/TE → rec YDS, DL → SCK,
  LB → TCK, CB/S → INT then COV) and hides column groups that are all zero for that position (e.g. QB hides receiving).
- **Sorting:** click any column header: desc, then asc (▲/▼); players with no attempts for that stat sort last both ways (same rule as StatsTable). Default: Offense → total yards from scrimmage + pass yards; Defense → TCK.
- **Team filter** (select: All teams / each club) and a **qualifier** toggle "Qualified only" (on by default for rate stats: QB ≥ 10 att per team game played, RB ≥ 6 carries/game, receivers ≥ 2 targets/game; when off, everyone with ≥ 1 attempt).
- Sticky header + sticky player column, horizontal scroll inside the card only, 50 rows with "Show more". Click a row → `selectPlayer(id)` (existing profile). Your club's players get the team-soft background.
- Reuse `StatsTable.tsx` column definitions (export them) instead of duplicating; keep the roster Stats tab working as today.

---

## P2 — C1–C3 Offseason calendar (store, `TopBar`/header, Draft, FreeAgency)
Today: `endSeason` sets `world.phase = 'offseason'`; the draft class for the coming April is created by `refreshProspectClass` at `startNextSeason`, and **nothing stops `draftProspect` / `simToMyPick` /
`finishDraft` during the regular season** (the user drafted all 7 picks in week 2). Free agency is one undivided offseason; `runAIFreeAgency` runs inside `startNextSeason`.

### C1 — Stages
- New optional `world.offseasonStage?: 'resign' | 'freeAgency' | 'draft' | 'camp'` (migrate: an offseason save without it → `'draft'` if the draft isn't complete, else `'camp'`). `endSeason` sets `'resign'`.
- In the offseason the **Advance** button steps one stage (label changes: "To free agency ▸", "To the draft ▸", "To camp ▸", "Start season ▸"):
  - `resign` (**Feb**, "Re-sign window"): your expiring players can be re-signed / extended (existing flows); AI re-signs already happen at season end (unchanged). FA signings are **closed**.
  - → `freeAgency` (**Mar**, "Free agency"): the FA pool (players whose contracts expired + existing FAs) opens for signing. Leaving this stage runs `runAIFreeAgency(world, career.teamId)` (moved out of `startNextSeason`).
  - → `draft` (**Apr**, "Draft"): the draft is live. Advancing with the draft unfinished completes it (`simulateRestOfDraft` + `runUDFAs`, as `startNextSeason` does today) after a confirm.
  - → `camp` (**Aug**, "Training camp"): UDFAs signed, `runAITrades(world)` (moved here), FA still open (leftovers). Advance → `startNextSeason()`.
- `startNextSeason()` must still work from **any** stage (probes `careerSmoke`, `balanceProbe` and fast paths call it directly): it runs whatever stages were skipped, in order, exactly once
  (AI free agency, draft completion + UDFAs, AI trades), then the existing new-season code. Track with `world.offseasonDone?: { fa?: boolean; draft?: boolean; trades?: boolean }` (optional; cleared at season start).
- The header (where it shows "Week 2 · @ NYJ") shows the stage in the offseason: "FEB · RE-SIGN", "MAR · FREE AGENCY", "APR · DRAFT", "AUG · CAMP". Inbox gets one news item per stage change.
- **Move `refreshProspectClass`** so the next class exists all season for scouting (keep it at season start as today), but its `draftState` is not actionable until the stage is `draft`.

### C2 — Draft only in April
- `draftProspect`, `simToMyPick`, `finishDraft`, and any draft-day action are no-ops unless `world.phase === 'offseason' && stageOf(world) === 'draft'` (helper `draftOpen(world)` in `draft.ts`). Show a toast if called otherwise.
- Draft screen when closed: a banner "The draft is in April — scout the class now" (in season) or "The draft opens in April (N stages away)" (offseason before the draft); the prospect board stays visible for ranking /
  conviction / red flags / advise (unchanged); **Sim to my next pick** and **Complete the draft** disabled with that reason as `title`.
- Make sure the AI never drafts in season either (`simUntilUser` is only reached through the gated actions — verify no other caller runs in season).
- Pick ownership and trades of future picks are unchanged.

### C3 — Free agency in March
- In the regular season the FA screen keeps L11 behaviour (street free agents, Waiver Wire, pro-rated one-year deals). Players whose contracts expire at season end join the pool at `endSeason` as today, but
  `signFreeAgent` is blocked during `resign` (toast: "Free agency opens in March"); the FA screen shows the pool as a preview with that banner.
- From `freeAgency` on, signing works as today (offseason pricing via `freeAgentContract(p, season, week, phase)` unchanged).
- AI clubs sign free agents when the `freeAgency` stage ends (see C1), not before — so the user gets first crack in March.
- **User (2026-10-08): "free agency can be during the season, but make sure proper free agency — players get released and can start playing for another team — is working."** Verify and fix the whole path in season:
  a user or AI release → waiver wire (L11) → unclaimed players clear to `world.freeAgents` on Waiver Tuesday → the user can sign them (FA screen) and **AI clubs sign them when they need a body** (`aiInjuryMoves`
  and any AI depth signing) → the signed player is on the new club's roster, in `world.players` with the right `teamId`, shows on its depth chart and **actually plays** (appears in that club's box scores the
  next week). Add a dev probe `__faFlowProbe()` that releases a starter from an AI club and from the user club, advances two weeks, and reports each player's path (waivers → FA/claimed → club → snaps played).

### Acceptance (P2)
build + lint 4; `careerSmoke(4,'personnel')` and `careerSmoke(4,'coach')` 0 errors / 0 violations (probe drives the stages via `startNextSeason`); in a regular-season week, `draftProspect` / `finishDraft` change nothing;
stepping the offseason with Advance goes Feb → Mar → Apr → Aug → week 1, with AI free agency, draft and AI trades each run exactly once; `__simTest` unchanged (no sim change).

## DO NOT
- No sim changes (`playsim.ts`, `sim.ts`, `statAlloc.ts`), no rng draws added or removed, no changes to gates, objectives, capabilities, `evaluateTrade`, contract pricing, draft AI logic, or AI free-agency logic (only *when* it runs).
- Optional save fields only; canonical player objects; no new dependencies; no temp files in the repo.
- Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`. No git commands.

## Verification log
- **P1** (Flash 11 min, worktree; verified by Claude). Build + lint 4. Browser: week 4, Offense QB list live (Mahomes 98/150 1069), Qualified only, team filter, Past seasons select. Columns moved to `statsColumns.ts` (lint rule). Kicking tab omitted (no FG fields). Found: AI QBs show 0 rushing (fast-sim `statAlloc` gives QBs no carries) → backlog #24.
