# NEXT PHASE — L12.12 "History" tab (user request, 2026-10-08)

_Planned by Claude Opus 5.5. Implemented by DeepSeek Flash 4.1 in one push. Lint baseline: exactly 4 warnings._

User's words: "include the character history and what they have done, and team record and offense or defense stats through the years — might be smart to have a tab".

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| Y1 | New **History** screen (sidebar, under Career): You · Team · Year by year | P1 | not started |
| Y2 | Team season stats recorded every year (offense + defense, with league ranks) | P1 | not started |
| Y3 | Your career timeline: jobs, records, outcomes, awards, skill growth, best Ledger calls, players you drafted/signed who became starters | P1 | not started |

## Found in code
`career.history` = `{ season, team, role, record, outcome }[]` (one per season); `statsDb.teams` = `TeamSeasonRecord` (season, team, W–L, PF/PA, team OVR, playoffs, champion) written at year end by
`recordTeamSeasons`; player seasons in `statsDb.players` + live `player.stats`. Team offense/defense yards are **not** stored per season today.

## Y2 — Team season stats (`statsDb.ts`)
- Extend `TeamSeasonRecord` with optional fields filled at year end by `recordTeamSeasons` (and computed live for the current season, not saved): `passYds, rushYds, totalYds, passTD, rushTD, giveaways,
  sacksTaken` (offense, summed from the club's player season lines for that season), and `ydsAllowed, passYdsAllowed, rushYdsAllowed, takeaways, sacks, defTD?` (defense: from the club's defenders' lines and/or
  the opponents' lines in that club's games), plus `ranks: { pf; pa; offYds; defYds }` (1 = best of 32). Old records simply lack them (UI shows "—").
- No change to how stats are recorded per game; only aggregation at season end. No rng.

## Y1 — History screen (NEW `src/screens/History.tsx`, `ScreenId` 'history', sidebar entry "History" under Career)
- **You** tab: header card (name, current job, seasons, career W–L, playoff trips, titles, promotions/firings), then a **timeline** (one row per season, newest first): season, club crest, role, record, outcome,
  reputation change, skill growth that season (`skillLog` if present from L12.11, else omit), awards (staff awards), objectives met / ambitions met, best and worst Ledger call that season.
- **Team** tab (club select, default your current club; any club works — reuse it for L12.8 team pages later): year-by-year table — season, W–L, PF, PA, point diff, playoffs/title badges, team OVR, and
  offense (total yds, pass, rush, rank) / defense (yds allowed, pass, rush, takeaways, sacks, rank) column groups with a toggle **Offense | Defense | Both**; best season highlighted. Small sparkline of wins per year.
- **Year by year** tab: pick a season → the league standings snapshot for that year (from `statsDb.teams`), your club's top 5 players by position group from `statsDb.players` that season, and its champion.
- Responsive (tables scroll inside the card), theme tokens, sortable columns like the Stats Hub.

## Y3 — "What you've done"
- From `career.ledger`: players **you** drafted/signed/traded for who became starters (by depth chart at any season end) with their seasons and current OVR — "My guys" summary (top 10) on the You tab.
- Count: picks made, trades made, FA signings, extensions, coached games, 4th-down calls (and success rate), film grade average.

## DO NOT
No sim changes, no rng, no changes to gates/objectives/capabilities/`evaluateTrade`/contract pricing. Optional save fields only. Canonical player objects. No new dependencies. No temp files in the repo.
Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`, `PLAYTEST_BACKLOG.md`. No git commands.
**Acceptance:** build + lint 4; after `careerSmoke(3,'coach')`-style 3 simulated seasons (offline), History shows 3 timeline rows and the Team tab shows 3 seasons with offense/defense numbers and ranks.

## Verification log
