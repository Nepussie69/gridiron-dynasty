# Playtest backlog — every user request, where it went, and its status

_Kept by the orchestrator. Newest at the bottom. Each request is turned into a spec task for DeepSeek Flash (or done directly by the orchestrator when small). Status: ⏳ queued / 🔨 building / ✅ done (commit)._

| # | Date | Request (user's words, short) | Where | Status |
|---|---|---|---|---|
| 1 | 2026-10-08 | Numbers on the players on the field | Claude, MatchView + jersey.ts | ✅ 10c7eb8 |
| 2 | 2026-10-08 | After a moment the Play button doesn't work | Claude, MatchView | ✅ 10c7eb8 |
| 3 | 2026-10-08 | Field goals not kicked on the right line (extra points from own 2) | Claude, playAnim (sim record fix pending) | ✅ 10c7eb8 |
| 4 | 2026-10-08 | Space to pause/start gameplay | Claude, MatchView | ✅ 10c7eb8 |
| 5 | 2026-10-08 | Box score updates with where we are in the game | Claude, MatchView | ✅ c34772a |
| 6 | 2026-10-08 | Call every play: offense / defense / all | Claude, playsim ctx.callAll + picker | ✅ 86b1c28 |
| 7 | 2026-10-08 | Play log shows only live + past plays | Claude, MatchView | ✅ ae568dd |
| 8 | 2026-10-08 | Hover a found deal to see the full deal | L12.5 T1 | 🔨 building |
| 9 | 2026-10-08 | Hover players to see ratings without clicking | L12.5 T2 | 🔨 building |
| 10 | 2026-10-08 | Find deals for opposing players | L12.5 T3 | 🔨 building |
| 11 | 2026-10-08 | Trade for a position | L12.5 T4 | 🔨 building |
| 12 | 2026-10-08 | Trade block tab | L12.5 T5 | 🔨 building |
| 13 | 2026-10-08 | Stats not updated live; offense/defense stats, sort by position — redo the stats screen | L12.6 S1 | 🔨 building |
| 14 | 2026-10-08 | Draft in April, not during the season; same with true free agency | L12.6 C1–C2 | 🔨 building |
| 15 | 2026-10-08 | In-season FA is fine, but released players must properly sign and play for another team | L12.6 C3 + `__faFlowProbe` | 🔨 building |
| 16 | 2026-10-08 | Rookies too highly rated; rely on ceiling, grow with stats/experience | L12.7 D1–D4 | 🔨 building |
| 17 | 2026-10-08 | Click teams to see/scout their players; top O/D players with hover ratings (also on Up next card) | L12.8 V1–V3 | ⏳ after L12.5 merge |
| 18 | 2026-10-08 | Potential/ceiling in a colour bubble by how good it is | Claude, kit.tsx OvrBadge | ✅ (this commit) |
