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
| 8 | 2026-10-08 | Hover a found deal to see the full deal | L12.5 T1 | ✅ merged |
| 9 | 2026-10-08 | Hover players to see ratings without clicking | L12.5 T2 | ✅ merged |
| 10 | 2026-10-08 | Find deals for opposing players | L12.5 T3 | ✅ merged |
| 11 | 2026-10-08 | Trade for a position | L12.5 T4 | ✅ merged |
| 12 | 2026-10-08 | Trade block tab | L12.5 T5 | ✅ merged |
| 13 | 2026-10-08 | Stats not updated live; offense/defense stats, sort by position — redo the stats screen | L12.6 S1 | ✅ 1726392 |
| 14 | 2026-10-08 | Draft in April, not during the season; same with true free agency | L12.6 C1–C2 | ✅ merged |
| 15 | 2026-10-08 | In-season FA is fine, but released players must properly sign and play for another team | L12.6 C3 + `__faFlowProbe` | ✅ merged |
| 16 | 2026-10-08 | Rookies too highly rated; rely on ceiling, grow with stats/experience | L12.7 D1–D4 | ✅ 2097501 |
| 17 | 2026-10-08 | Click teams to see/scout their players; top O/D players with hover ratings (also on Up next card) | L12.8 V1–V3 | ✅ merged |
| 18 | 2026-10-08 | Potential/ceiling in a colour bubble by how good it is | Claude, kit.tsx OvrBadge | ✅ (this commit) |
| 19 | 2026-10-08 | Rookies need much lower ratings; show current + potential side by side without giving it away | L12.7 D1 ✅ + D5 (follow-up push) | ✅ merged |
| 20 | 2026-10-08 | "Batting average" → a football term | Claude: "Success Rate" (Ledger.tsx) | ✅ (this commit) |
| 21 | 2026-10-08 | What is the Ledger? Make it work for the coaching track (coach calls graded) | L12.9 L1 | ✅ merged |
| 22 | 2026-10-08 | Is Culture linked to the actual game? (cohesion/culture are display-only today) | L12.9 K1–K2 | ✅ merged |
| 23 | 2026-10-08 | Doesn't like the weekly hours card → remove it | L12.9 H1 | ✅ merged |
| 24 | 2026-10-08 | (found in QA) AI QBs show 0 rushing in the Stats Hub — fast-sim stat allocation gives QBs no carries | statAlloc follow-up | ✅ merged |
| 25 | 2026-10-08 | Routes should look like real routes and move more smoothly | DeepSeek push 'routes' | ✅ merged |
| 26 | 2026-10-08 | Every year, goals/accomplishments earn skill points; skills must grow you | L12.11 P1–P4 | ✅ merged |
| 27 | 2026-10-08 | Include all routes and all plays (Madden 26 style) | L12.10 B1–B4, B6 (generic football concepts; EA data not copied) | ⏳ after P5 + routes |
| 28 | 2026-10-08 | All ratings transfer to animations, stats and play | L12 P4 ✅ + P5 🔨 (play/stats); L12.10 B5 (animation) | ⏳ |
| 29 | 2026-10-08 | History tab: character history and what they've done, team record, offense/defense stats through the years | L12.12 Y1–Y3 | ✅ merged |
| 30 | 2026-10-08 | Trade Center columns: position select + order by rating | with L12.8 push (Trades.tsx) | ✅ merged |
| 31 | 2026-10-08 | Rescale my save's rookies drafted before the fix (user approved) | Claude: rescaleLegacyRookies in migrateWorld (one-time flag rookieScaleV2) | ✅ (this commit) |
| 32 | 2026-10-08 | Find a Player tab: all players, ratings or stats, position select, sort any column asc/desc | DeepSeek push 'findplayer' | ✅ merged |
| 33 | 2026-10-08 | Playoff hunt chart per division and conference like the NFL (+ found: seeding ignored division winners) | DeepSeek push 'playoffs' | ✅ merged |
| 34 | 2026-10-08 | Make the UI look more modern and advanced (game day field first) | NEXT_PHASE_UI.md U1–U4 | ⏳ after running pushes merge |
| 35 | 2026-10-08 | Unit Grades: show each position and overall | Claude: Dashboard position grades (10 groups, league rank) + overall badge | ✅ (this commit) |
| 36 | 2026-10-08 | Hover a player's name (roster etc.) for complete ratings, skills, contract | Claude: PlayerName hover on Roster + Depth chart (Find a Player/teams pushes use PlayerHoverCard) | ✅ |
| 37 | 2026-10-08 | Smaller, slightly transparent hover box | Claude: 264px, 80% opacity + blur, 6-col ratings | ✅ |
| 38 | 2026-10-08 | Make fullback a position | L12.10 B0 (Utility/Blocking RBs → FB) | ⏳ with the playbook push |
| 39 | 2026-10-08 | Stars / higher-rated players less of a find on the trade block | Claude: ≤2 stars (88+, only moving-on clubs, rotate monthly), ≤8 at 80–87 | ✅ |
| 40 | 2026-10-08 | Call-mode buttons seemed to do nothing / make it apply straight away | Claude: switching rebuilds the game to the play on screen (deterministic replay of your answers, verified identical) and applies the mode to the very next snap; call card pops up | ✅ |
| 41 | 2026-10-08 | Redesign Staff & Hiring: easier to navigate/hire, readable skills and stats | DeepSeek push 'staff' (org chart + table, market filters + compare vs current holder, plain effects, hover) | ✅ merged |
| 42 | 2026-10-08 | Space pauses the play/animation exactly where it is (in game) | Claude: freeze/resume mid-play in MatchView | ✅ |
| 43 | 2026-10-08 | Culture discount only for clubs that won heaps in the last 3 years or have top offense/defense, by the player's side of the ball | L12.9 K2 (approved rule) | ✅ merged |
| 44 | 2026-10-08 | Add all the ideas into a futures workflow, go down the list one by one | FUTURES.md (25 rows, ordered) | ✅ |
| 45 | 2026-10-08 | Retune passing yards and all stats to the last 10 years of the NFL (approved) | NEXT_PHASE_REALISM.md R1–R4 | ⏳ right after playbook + culture merge |
| 46 | 2026-10-08 | Make sure everything done is on the stable build | 4173 rebuilt at every merge (now 6e81328 = main) | ✅ ongoing |
| 47 | 2026-10-08 | Blitz only shows 4 rushers | Claude: plays record `blitz`; animation sends 1–2 LBs (+ sometimes a S) at the QB | ✅ |
| 48 | 2026-10-08 | Every O / D / all snap stopped asking after a couple of calls (went automated) | Claude: per-game cap of 2 play calls lifted in every-snap modes (full game: 86 O calls, 47 D calls) | ✅ |
| 49 | 2026-10-08 | Make playbook learning realistic, in the gameplay sim, tied to player production | NEXT_PHASE_L12_13.md M1–M4 | ✅ merged |
| 50 | 2026-10-08 | (seen in the screenshot) Dead money looks too large (e.g. $115.5M on a $45.6M cap hit) | L12.14 C3 | ✅ merged |
| 51 | 2026-10-08 | How do extensions work; can the head coach ask the GM to push for one | L12.14 C4–C5 | ✅ merged |
| 52 | 2026-10-08 | Keep the cap at 2025 ($279.2M), never increase it per year | L12.14 C1–C2 | ✅ merged |
| 53 | 2026-10-08 | Head coach + GM work together: ask to extend, restructure for a push, go get a trade/FA target, release a player | L12.14 C6 (GM requests desk) | ⏳ after contracts P1 |
| 54 | 2026-10-08 | Too many franchise players: only a few 90+, more 80s | NEXT_PHASE_L12_15.md S1–S4 (82 at 90+ today → ~25–32) | ⏳ after contracts merges |
| 55 | 2026-10-08 | How much each rating matters + table; missed tackles in gameplay; realism vs NFL last 5–10 years | Table given in chat (47/48 ratings in the sim, RTE unused); missed tackles → NEXT_PHASE_REALISM.md R5 | ⏳ with the retune |
| 56 | 2026-10-08 | (new chat) Keep going through the pushes, DeepSeek in parallel, log requests, report every stable-build update | Orchestration continued; 4th parallel push `hof` (FUTURES 23, NEXT_PHASE_L12_16.md) — also fixes history/awards not being saved | 🔨 ongoing |
| 57 | 2026-10-08 | (screenshot of a call moment) Will the playbook mean more options when I call a play? | Yes: L12.10 B6 in push `anim` (formation → any play from the ~38-play playbook, route diagram) | 🔨 building |
| 58 | 2026-10-08 | Slow down the running animation and make it smooth | Claude: run plays timed from real distances (5.5 yd/s through the hole → 7.5 yd/s top, slows into the tackle), carrier follows a smooth curve with 48 evenly spaced points; max speed 43 → 8.8 yd/s, frame-to-frame jumps 26 → <3 yd/s | ✅ |
| 59 | 2026-10-08 | Everyone's pace/speed based off their rating | L12.10 B5 detail item 1 (SPD → top speed, ACC → burst, every actor distance-timed); push `anim` (replaced playbook2) | 🔨 building |
| 60 | 2026-10-08 | Everything they do in the animation is based off their rating | L12.10 B5 detail items 2–10 (pursuit, routes, line play, carrier moves, throws/catches, tackles, QB, kicks, hover why) | 🔨 building |
| 61 | 2026-10-08 | Slow down the passing animation too, to match the ratings | In push `anim` (B5 item 1 covers every play type: routes at each receiver's SPD/ACC, QB drop/release, ball flight from THP, YAC distance-timed like runs) | 🔨 building |
| 62 | 2026-10-08 | Can the pushes get done earlier? | Added an extra parallel push on an independent FUTURES row; dependent pushes start the moment their blocker merges | ✅ |
| 63 | 2026-10-08 | Don't worry about press conferences | Push `press` stopped, nothing merged; FUTURES row 20 marked dropped | ✅ |
| 64 | 2026-10-08 | (Trade desk screenshot) Too easy to get a franchise QB — should be much harder, based on past NFL trades | Claude: position values (QB ×2.2 … RB ×0.7, K/P ×0.3) + starting-QB premium (85+ ×1.7, 78+ ×1.4); deal finder fills gaps with right-sized picks. Starting QBs now ~2.5–4 firsts, Mahomes not available | ✅ |
| 65 | 2026-10-08 | Trade values seem all wrong (Garrett 99 valued below Ward 90) | Claude: new playerTradeValue — steep at the top (99 ≈ 2× a 90), young players at expected rating, smooth position-specific age decline (no cliff at 30), position value | ✅ |
| 66 | 2026-10-08 | Don't offer same-position players in trade packages unless significantly lower value | Claude: findPackagesFor skips your players at the target's position unless worth < 60% of him | ✅ |
