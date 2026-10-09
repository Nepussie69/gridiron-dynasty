# Futures — the build list, in order (user: "add all your ideas into the futures workflow … as we go down the list one by one", 2026-10-08)

How it works: the orchestrator takes the **top unstarted row**, writes its `NEXT_PHASE_*.md` spec (files, functions, acceptance, DO NOT), sends it to DeepSeek Flash in a worktree, verifies (build, lint 4, real-data calibration in bands, equivalence 20/20, smokes 0/0, browser), merges, rebuilds the 4173 stable build, tells the user, ticks the row, and moves to the next one. The user's playtest requests (`PLAYTEST_BACKLOG.md`) always jump the queue.
Several rows can run in parallel when they touch different files. Status: ⏳ next · 🔨 building · ✅ done.

| # | Feature | What it is | Depends on | Status |
|---|---|---|---|---|
| 1 | **Full playbook + fullback** (`NEXT_PHASE_L12_10.md`) | Route tree (~26 routes), formations × real concepts, FB position, pick formation → play on calls, ratings visible in the animation | P5 ✅, routes ✅ | ✅ P1 + P2 merged |
| 1a | **Playbook mastery that's real** (`NEXT_PHASE_L12_13.md`) | Realistic starting mastery, learning from snaps + production, relative effects for every unit in the sim, readable tooltip | culture | ✅ merged |
| 1a2 | **Stars are rare** (`NEXT_PHASE_L12_15.md`) | ~25–32 players at 90+ (one per club), more 80s; rank order kept | contracts | 🔨 stars4 review/verification |
| 1b | **Real NFL numbers retune** (`NEXT_PHASE_REALISM.md`) | Every team stat to the 2015–2024 NFL averages (passing ~241, comp 64%, sacks 2.4, ypc 4.3, red-zone TD 56% …) | playbook, culture | 🔨 realism calibration |
| 2 | **UI Broadcast 2.0** (`NEXT_PHASE_UI.md`) | TV field (yard numbers, blue LOS + yellow 1st-down line, end zones, camera follow, result toasts), scorebug/dock, dark mode, ⌘K, screen passes | current batch merged | ⏳ |
| 3 | **Personnel packages** (L13) | 11/12/21/22 personnel vs Base/Nickel/Dime; who's on the field and the matchups that follow | 1 | ✅ merged |
| 4 | **Special-teams calls** (L13) | Onside kick, fake punt/FG, return strategy; fakes get scouted (tendency memory) | — | ⏳ |
| 5 | **Challenges & replay** | Throw the red flag on close spots, catches, fumbles; lose a timeout if wrong; booth reviews in the last 2 minutes | — | ⏳ |
| 6 | **Weather & stadiums** | Wind (deep balls, kicks), rain/snow (fumbles, footing), cold, domes; crowd noise → false starts on the road; forecast on Game Plan | — | ⏳ |
| 7 | **Halftime speech** | Fire up / calm / challenge a star / stay the course → morale and second-half edge, can backfire | — | ⏳ |
| 8 | **Primetime & rivalry stakes** | TNF/SNF/MNF and rivalry games swing reputation more; a clutch rating for players | — | ⏳ |
| 9 | **Trade deadline day** (L14) | A live deadline week: contenders buy, rebuilders sell, AI calls you with offers | trade desk ✅ | ✅ merged |
| 10 | **Draft-day trades** (L14) | Trade up/down while on the clock; AI offers by the value chart; timer per pick | calendar ✅ | ✅ merged |
| 11 | **Free-agency frenzy** (L14) | March bidding window: competing offers, deadlines, players choosing money vs fit/winning/culture | calendar ✅, culture K2 | ⏳ |
| 12 | **Contract holdouts, franchise/transition tags, 5th-year options** | Stars want new deals; tag, trade or pay; rookie options | — | ✅ merged |
| 13 | **Development plans** (L15) | Focus per young player (speed, hands, technique …) with Auto / Select all per group; works with the playing-time growth | rookies ✅ | ✅ merged |
| 14 | **Scouting travel budget** (L15) | All-star games, pro days, campus visits with Auto; coverage tightens reads | scouting reads ✅ | ✅ merged |
| 15 | **Injury decisions** (L15) | Play him hurt or sit him: risk of a longer injury, owner pressure in a playoff push | — | ⏳ |
| 16 | **Locker room** (L15) | Leaders and problem players, mentoring rookies (faster growth), morale affecting effort | culture K1/K2 | ✅ merged |
| 17 | **Bye week** | A real choice: rest, install week or self-scout | practice ✅ | ✅ merged |
| 18 | **3-year cap planner** | Future cap hits, dead money and expiring deals before you sign anyone | — | ✅ merged |
| 19 | **Analytics department** | Hire analysts: sharper win probability, 4th-down advice, opponent tendencies | staff redesign | ✅ merged |
| 20 | **Press conferences** (`NEXT_PHASE_L12_17.md`, spec only) | Answers move owner trust, player morale and your profile | — | ⛔ dropped by the user 2026-10-08 |
| 21 | **Coaching tree** | Your coordinators get hired away as head coaches; their success adds to your legacy; poach them back | History ✅ | ✅ merged |
| 22 | **Owner personalities** | Win-now, patient builder, meddler — different firing lines and mandates | — | ✅ merged |
| 23 | **Hall of Fame & legacy** (`NEXT_PHASE_L12_16.md`) | Career timeline, records, HOF vote at retirement (yours and your players'); also persists history/awards across reloads | History ✅ | ✅ merged |
| 24 | **Trick plays** | Flea flicker, reverse, halfback pass, fake spike as calls with surprise value | 1 | ⏳ |
| 25 | **Ask the GM / owner meetings** | Request budget, a star signing or a staff hire; owner reacts by personality | 22 | GM requests ✅ 52d1df7; owner meetings ⏳ |

NFL statistical retuning is approved and running in `wt-realism`.
