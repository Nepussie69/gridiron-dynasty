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
| 34 | 2026-10-08 | Make the UI look more modern and advanced (game day field first) | NEXT_PHASE_UI.md U1–U4; U1-U4 all merged to main (U3b command palette/density/charts, U4 screen passes) 2026-10-09 | ✅ main |
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
| 53 | 2026-10-08 | Head coach + GM work together: ask to extend, restructure for a push, go get a trade/FA target, release a player | L12.14 C6 (GM requests desk) | ✅ merged 52d1df7 |
| 54 | 2026-10-08 | Too many franchise players: only a few 90+, more 80s | NEXT_PHASE_L12_15.md S1–S4 (82 at 90+ → 34 at season 1); merged 2262df2; long-term drift fixed stars7+8 (b236d21): active 90+ 22-35 over 12 seasons | ✅ merged |
| 55 | 2026-10-08 | How much each rating matters + table; missed tackles in gameplay; realism vs NFL last 5–10 years | Table given in chat (47/48 ratings in the sim, RTE unused); missed tackles → NEXT_PHASE_REALISM.md R5 | ⏳ with the retune |
| 56 | 2026-10-08 | (new chat) Keep going through the pushes, DeepSeek in parallel, log requests, report every stable-build update | Orchestration continued; 4th parallel push `hof` (FUTURES 23, NEXT_PHASE_L12_16.md) — also fixes history/awards not being saved | ✅ (hof merged) |
| 57 | 2026-10-08 | (screenshot of a call moment) Will the playbook mean more options when I call a play? | Yes: L12.10 B6 in push `anim` (formation → any play from the ~38-play playbook, route diagram) | ✅ merged |
| 58 | 2026-10-08 | Slow down the running animation and make it smooth | Claude: run plays timed from real distances (5.5 yd/s through the hole → 7.5 yd/s top, slows into the tackle), carrier follows a smooth curve with 48 evenly spaced points; max speed 43 → 8.8 yd/s, frame-to-frame jumps 26 → <3 yd/s | ✅ |
| 59 | 2026-10-08 | Everyone's pace/speed based off their rating | L12.10 B5 detail item 1 (SPD → top speed, ACC → burst, every actor distance-timed); push `anim` (replaced playbook2) | ✅ merged |
| 60 | 2026-10-08 | Everything they do in the animation is based off their rating | L12.10 B5 detail items 2–10 (pursuit, routes, line play, carrier moves, throws/catches, tackles, QB, kicks, hover why) | ✅ merged |
| 61 | 2026-10-08 | Slow down the passing animation too, to match the ratings | In push `anim` (B5 item 1 covers every play type: routes at each receiver's SPD/ACC, QB drop/release, ball flight from THP, YAC distance-timed like runs) | ✅ merged |
| 62 | 2026-10-08 | Can the pushes get done earlier? | Added an extra parallel push on an independent FUTURES row; dependent pushes start the moment their blocker merges | ✅ |
| 63 | 2026-10-08 | Don't worry about press conferences | Push `press` stopped, nothing merged; FUTURES row 20 marked dropped | ✅ |
| 64 | 2026-10-08 | (Trade desk screenshot) Too easy to get a franchise QB — should be much harder, based on past NFL trades | Claude: position values (QB ×2.2 … RB ×0.7, K/P ×0.3) + starting-QB premium (85+ ×1.7, 78+ ×1.4); deal finder fills gaps with right-sized picks. Starting QBs now ~2.5–4 firsts, Mahomes not available | ✅ |
| 65 | 2026-10-08 | Trade values seem all wrong (Garrett 99 valued below Ward 90) | Claude: new playerTradeValue — steep at the top (99 ≈ 2× a 90), young players at expected rating, smooth position-specific age decline (no cliff at 30), position value | ✅ |
| 66 | 2026-10-08 | Don't offer same-position players in trade packages unless significantly lower value | Claude: findPackagesFor skips your players at the target's position unless worth < 60% of him | ✅ |
| 67 | 2026-10-08 | Pay QBs closer to real 2025 money (~$55–60M top-5) | Push `qbpay`: top-5 QB AAV $43.2M → $58.2M, cap use 0.80–0.83, dead money fixed (no double count) | ✅ merged 8a8b6cd |
| 68 | 2026-10-08 | Make the Cap screen contract ledger sortable | Claude: every column header sorts (▲/▼), click again to flip | ✅ |
| 69 | 2026-10-08 | Write a ChatGPT handover before 95% usage | Claude: OPENCODE_CONTINUE.md + AGENTS.md (08a896e) | ✅ |
| 70 | 2026-10-08 | Read OPENCODE_CONTINUE.md and take over orchestration | Codex: GM desk published, QB pay independently verified; user requested Claude handover2026-10-09; stars6/realism5 running | 🔨 handed to Claude |
| 71 | 2026-10-08 | Push the current progress to the stable build | Codex: GM desk verified/merged52d1df7; stable4173 serves90508fd | ✅ published |
| 72 | 2026-10-09 | Create a handover for Claude | CLAUDE_HANDOVER.md: live state, runner paths, preserved worktrees, review failures and exact next steps; Codex relinquishes orchestration after documentation | ✅ |
| 73 | 2026-10-09 | Long-term star targets: count active NFL rosters only (not unsigned free agents) | Claude: recorded in NEXT_PHASE_L12_15.md; stars acceptance uses active-roster bands, whole pool diagnostic only | ✅ decided |
| 74 | 2026-10-09 | Update the stable build and keep pushing | Claude: stable4173 rebuilt at e841299 (docs only, same JS); ui1 (UI U1 TV field) launched in parallel with stars6/realism5 | 🔨 |
| 75 | 2026-10-09 | Sort OVR and potential ascending and descending | Claude: Ratings/Stats tables split the OVR/POT header into separate OVR and POT sort buttons (click again flips ▲/▼); roster Overview dropdown gains Potential | ✅ main (not on stable yet) |
| 76 | 2026-10-09 | Hold off updating the stable build; pile up changes so I can find more bugs | Claude: keep merging verified pushes to main; NO stable 4173 rebuild until the user asks (stable stays 4377982) | ✅ standing |
| 77 | 2026-10-09 | Show what deal was made when the GM lands a trade target | Claude: 'GM: Agreed' message lists what we sent (players/picks), to which club, and what we got (gmDesk dealMessage) | ✅ main (not on stable yet) |
| 78 | 2026-10-09 | Put a stable build on GitHub Pages so I don't get kicked out of the game | Claude: live at https://nepussie69.github.io/gridiron-dynasty/ serving stable 4377982 (gh-pages branch, repo public); scripts/publish-pages.sh for updates | ✅ |
| 79 | 2026-10-09 | Punt and kick returns with the player returning | Claude: spec NEXT_PHASE_REALISM.md R6 (real KR/PR from SPD/ACC/AGI/BCV, kickoff returns vs touchbacks, punt returns, returner shown in play text + animation + stats); runs as realism8 (returns incl. return TDs + pick-six/fumble-return TDs close the points gap) | ⏳ queued |
| 80 | 2026-10-09 | Be able to ask for deals for draft picks too | Claude: Find deals (🔍) now on pick rows: shop your pick around the league, or see what it costs to land another club's pick (findDeals/findPackagesFor accept pick ids) | ✅ main (not on stable yet) |
| 81 | 2026-10-09 | Only push to GitHub when I say ok, so I can keep playing before updates | Claude: no git push / Pages publish without an explicit ok per push | ✅ standing |
| 82 | 2026-10-09 | Next play flashes/replays the previous play before the next one | Claude: a finished play no longer restarts when the coached game appends the next plays (MatchView anim effect + auto-advance); next play shows in ~75 ms | ✅ main |
| 83 | 2026-10-09 | Push to GitHub | Claude: user ok — main pushed (26d46bf..c0511ab), Pages republished from c0511ab (index-DB4kJ4Bj.js, verified); 4173 still held at 4377982 | ✅ |
| 84 | 2026-10-09 | Include pressures in game stats and the box score | Claude: spec NEXT_PHASE_REALISM.md R7 (per-dropback pressure from the existing pressure edge, credited to a rusher, PRS in box/season/career/Stats Hub, QB pressured %, fast-sim share; stats only, no outcome change); queued as realism8 (after realism7 finishes the R2 retune) | ⏳ queued |
| 85 | 2026-10-09 | Include hurries in PRS | Claude: R7 spec — every pressure is a sack, QB hit or hurry; PRS = SCK + QBH + HUR; HUR shown in box score, HUR/QBH in season/career/Stats Hub | ⏳ queued with R7 |
| 86 | 2026-10-09 | Include QB sacked in game and statistics | Claude: spec R8 — SK + sack yards in the QB passing line (box score, season, career, Stats Hub), fast-sim share of team sacks taken; queued with realism8 | ⏳ queued |
| 87 | 2026-10-09 | Include receptions allowed too | Claude: box score defense shows REC/TGT + YDS ALW (main); Stats Hub coverage column renamed REC (receptions allowed); simmed-game coverage stats queued as R9 with realism7 | ✅ main / ⏳ R9 |
| 88 | 2026-10-09 | Do the game-plan matchups (double the rusher, target weak CB, shadow WR1, spy QB) actually work in gameplay? | Claude: yes — all four are wired in playsim for the user's coached and simmed games (pressure/receiver pool, weakest-CB coverage + INT risk, CB1 vs WR1, −4 rush/scramble/QB-draw); modest effects | ✅ answered |
| 89 | 2026-10-09 | Push to GitHub | Claude: user ok — main pushed to 124bff0, Pages republished (index-CBs1HQGi.js, verified loads, no errors) | ✅ |
| 90 | 2026-10-09 | After the catch the receiver runs backwards — should go forward or sideways like the NFL | Claude: throw depth sized to the gain (short completions = bubble/flat/screen/quick out, never a blocking route), catch moved earlier on the route when the gain is short, carry speed into YAC, TDs caught in the end zone stay there. 40 games: backward >1 yd after catch 41.9% → 1.2% (max 26 → 2.5 yd); end spots 100% | ✅ main |
| 91 | 2026-10-09 | Find by position: show more players, not just the top ones; make top players more unreachable/rare | Claude: list shows up to 30 gettable players (from the top 60) instead of 8; a club's own 97-99 stars effectively unavailable (×6 unless a rebuilding club with a 29+ player, ×2.4), 93-96 ×2, 90-92 ×1.6; 'rebuilding' is now the league's weakest third by roster strength (was a coin flip on the team id, so half the league incl. PHI counted as rebuilding) | ✅ main |
| 92 | 2026-10-09 | Crowded box-score defense header (REC/TGT, YDS ALW overlapping) | Claude: short headers REC / ALW with hover tooltips, REC column widened for 11/13 values; measured no header overflow | ✅ main |
| 93 | 2026-10-09 | Punt and kick returns — I only ever see touchbacks | Claude: not built yet (sim has no returns); realism8 = returns with a real returner + return TDs/pick-sixes/safeties, launching after realism7 merges | ⏳ realism8 |
| 94 | 2026-10-09 | Lazy play calling: just pick Run or Pass and let the staff choose the best play | Claude: RUN / PASS quick buttons on the play-call card (quickCall.ts: opponent situational tendencies x call matrix + NFL situational norms, rotates among near-best, deterministic); each shows the play it will call | ✅ main (browser click-through pending) |
| 95 | 2026-10-09 | Defense: quick calls blitz / man / zone / 2-high instead of run/pass | Claude: blitz/man/zone/stack already one-tap cards; NEW two-high (Cover 2/4) call queued as R10 (needs matrix + AI tendency changes) | ⏳ R10 |
| 96 | 2026-10-09 | Too many high passer ratings (100-117) vs the NFL? | Claude: yes, unrealistic — fast-sim statAlloc gave passing TDs = points/7*0.72 (all points as TDs, 72% passing) -> ~7.4% TD rate. Now points/7*0.48 pass, 0.25 rush, 0.48 rec (~73% of points from offensive TDs, 66/34 split): ~4.9% TD rate, typical rating ~94 (NFL ~90-93). Stats only, results/rng unchanged | ✅ main (not pushed) |
| 97 | 2026-10-09 | Keep DeepSeek progress going so we can push and queue updates | Claude: running realism9 (pressures), ui4 (screens), fut18 (3-yr cap planner); queued realism10 (two-high), fut3 (personnel packages); all reviewed before merge, pushed only on the user's ok | 🔨 |
| 98 | 2026-10-09 | Team hover card (team ratings/stats); matchup shows league ranks: points/pass/rush yds for offense and defense with #; smaller play-call picker so the field stays visible | Claude: gd1 merged — TeamHoverCard on matchup/standings/schedule, league ranks with # for points/pass/rush offense+defense, compact play-call tray; browser-checked | ✅ main |
| 99 | 2026-10-09 | Two-minute drill: players run out of bounds to stop the clock; add a timeout button | realism11 merged: two-minute hurry-up carriers get out of bounds (~0.6/game, play text says so, clock stops), TIMEOUT (n) button in the game-day dock arms a timeout for the next dead ball; browser-checked | ✅ main |
| 100 | 2026-10-09 | (FUTURES #18) 3-year cap planner | DeepSeek fut18, merged after build/lint review | ✅ main |
| 101 | 2026-10-09 | (FUTURES #3) Personnel packages 11/12/21/22 vs base/nickel/dime | DeepSeek fut3, neutral by default (eq 20/20), merged; calibration re-checked on main | ✅ main |
| 102 | 2026-10-09 | Stats Hub: wrong stats in the wrong columns (Receiving/Defense headers shifted, extra FMT) | Claude: COL_FMT was in both Rushing and Receiving groups with the same id — duplicate React keys left stale header cells; unique ids fmtRush/fmtRec. Verified header = group = row cell counts in all 20 Offense/Defense x position views, switching back and forth | ✅ main |
| 103 | 2026-10-09 | Box score crowded/names squeezed with the new columns | Claude: Defense split into Defense / Pass rush / Coverage blocks (players listed only where they have stats), Returns headers shortened with tooltips, passing line C/ATT YDS TD INT SK RTG; names keep ~140px+ at laptop width | ✅ main |
| 104 | 2026-10-09 | Awards: show who is in the running for each season award during the season | Claude: race merged — Season Honors shows a live Award Race (top 5 for MVP/OPOY/DPOY/OROY/DROY + staff awards, stats, record, score bar), read-only reuse of the season-end scoring; browser-checked | ✅ main |
| 105 | 2026-10-09 | What else to add for realism? -> queue all six | Claude: NEXT_PHASE_REALISM.md R13 season shapes, R14 penalty types, R15 fatigue/snap counts, R16 turnover variety, R17 kicking (blocks/fakes/onside), R18 coaching tendencies; queue5 runs them in order after realism12, snapshot-committed per push for review | ⏳ queued |
