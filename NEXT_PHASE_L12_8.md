# NEXT PHASE — L12.8 "Scout the other clubs" (user playtest request, 2026-10-08)

_Planned by Claude Opus 5.5. Implemented by DeepSeek Flash 4.1 in one push, **after L12.5 is merged** (it reuses `HoverCard` / `PlayerHoverCard` from L12.5 T1–T2). Lint baseline: exactly 4 warnings._

User's words: "click on teams to see their players and scout them; show their top offensive and defense players and hold mouse over them to highlight their ratings and skills"
(screenshots: the Schedule list with "New York Jets — UP NEXT", and the Game Plan "Up next · Week 2" matchup card).

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| V1 | Team page: click any club anywhere → its roster, top players, scheme, record, cap | P1 | not started |
| V2 | Top 5 offense / top 5 defense on the Game Plan "Up next" card and the team page, with hover ratings | P1 | not started |
| V3 | Scout a club: a "Scout" action (weekly hours) that reveals their tendencies/key-player notes; star to shadow board | P1 | not started |

## V1 — Team page (NEW `src/screens/TeamView.tsx`)
- Store: `viewTeam(teamId)` sets `teamViewId` and switches to a new `ScreenId` `'team'` (not in the sidebar; Back returns to the previous screen). Your own club opens the normal Roster.
- Make club names/crests clickable (`cursor-pointer`, hover underline) in: Schedule rows, Standings rows, Game Plan "Up next" card, Dashboard next-game card, Trade Center partner header, box-score team headers, League screen.
- Page: header (crest, record, division rank, OC/DC schemes and their plan style, team OVR / OFF / DEF via `teamRatings`, cap space); **Top players** (V2); a roster table using the existing `RatingsTable`
  (Overview | Ratings | Stats tabs exactly like Roster, read-only: no depth/release actions); "Trade for…" button per row that opens the Trade Center with that club and player loaded on the Get side.

## V2 — Top players with hover ratings
- `topPlayers(world, teamId, side: 'off' | 'def', n = 5)`: best by OVR among starters (`depthGroup`) on that side; shown as compact chips: OVR badge, name, pos, one headline stat this season.
- Hovering a chip shows `PlayerHoverCard` (L12.5: ratings, composites, contract, fit). Clicking opens the player profile.
- On the **Game Plan "Up next" card**: two rows under the ratings, "Their offense: …5 chips" / "Their defense: …5 chips", plus a "View team" link (V1). Also on the Dashboard's next-game card (top 3 each side).

## V3 — Scout a club
- On the team page and the Up-next card: **Scout {club}** — costs weekly hours like other actions (`spendHours`, use the existing film-read/opponent-read cost if one exists; otherwise 4 hours), once per club per week.
  Reveals for that club this season: offense/defense tendency summary (from the existing tendency/self-scout data the AI uses, e.g. `tendencyRead`/plan presets), their two most-targeted receivers and top pass rusher with
  this season's numbers, and a one-line "how to beat them" from `coordinatorAdvice` for that opponent. Stored as optional `career.scoutedClubs?: { season; week; teamIds: string[] }`.
- No sim effect beyond what existing opponent reads already give (do not add a new edge).

## DO NOT
- No sim changes, no rng, no changes to gates/objectives/capabilities/`evaluateTrade`/contract pricing. Optional save fields only. Canonical player objects. No new dependencies. No temp files in the repo.
- Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`, `PLAYTEST_BACKLOG.md`. No git commands.

**Acceptance:** build + lint 4; clicking NYJ in Schedule opens the Jets page with top 5 O/D and hover cards; Up next card shows chips; Scout spends hours once per week and shows the report.

## Verification log
