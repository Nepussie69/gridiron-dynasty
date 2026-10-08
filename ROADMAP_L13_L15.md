# Roadmap after L12 (from IDEAS_ROUND2.md and the user's 2026-10-07 picks)

## Status board (updated 2026-10-08)
| Phase | What | Status |
|---|---|---|
| L5–L11 | Long-arc stories, rung jobs, economy, staff room, long game, game day, in-season roster life | ✅ done |
| L11.5 P1 | Moment card, Next play/drive/moment, in-game plan changes | ✅ done |
| L11.5 P2 | More presets, coordinator advice, weekly hours explained | ✅ done |
| L11.5 P3 | Stats (DB yards, TFL, passer rating), front-office staff skills, cap by position, empty trade, mark all read, OVR/POT, wrong-club inbox bug | ✅ done |
| L11.5 P4 | Trade future picks up to 3 drafts ahead | ✅ done |
| L12 P1 | Ratings tab (sortable), rating glossary, engine composites | ✅ done |
| L12 R4 | Ratings inline in Overview, roster Stats tab, coverage grade 0–100 | ✅ done |
| UI | Field: team colors, each club on its own end | ✅ done |
| UI | Game-day screen redesign (one page, plays by drive, tabs) | ✅ done |
| UI | Play animation (runs, routes, YAC, scrambles, sacks, fumbles, returns, kicks) | ✅ done |
| L12 P2 | Practice week, keys to the game | ✅ done |
| L12 P3 | Realistic stat lines: target shares, carry split, tackles/sacks/INTs by position, box-score layout | ✅ done |
| L12 P4 | Every rating counts: E0 fill ratings, E1 offense ratings in the sim | ✅ done |
| L12 P5 | Defense/kicking/general ratings, recalibrate, rating spread probe | ⏳ next |
| L12.5 | Trade desk: deal/player hover cards, find deals for their players, find by position, trade block | ⏳ in progress |
| L12.6 | Live Stats Hub; offseason calendar (FA March, draft April) | ⏳ in progress |
| L13 | Personnel packages, special-teams calls | 🗺 outlined |
| L14 | Trade deadline day, draft-day trades, free-agency frenzy | 🗺 outlined |
| L15 | Development plans (Auto / Select all), scouting travel (Auto), injury decisions, locker room | 🗺 outlined |
| Later | Tags and options, holdouts, hiring the HC, analytics, 3-year cap planner, weather, challenges, trick plays, halftime speech, primetime stakes, ask the GM, bye week, … | 💭 not planned yet |

_Outline only. Each phase becomes a full `NEXT_PHASE_<L>.md` spec (exact files and functions) when it's next, after reading the code it touches._

## L13 — Game-day depth (coaches)
- **Personnel packages**: offense 11 / 12 / 21 (3 WR, 2 TE, 2 RB), defense Base / Nickel / Dime. Decides who's on the field (`topGroup` counts) and the matchups: Dime vs 21 personnel loses the run game,
  Base vs 11 gives up the slot. Set in the game plan and per game-day moment. AI clubs keep a default package derived from their scheme, so AI-vs-AI calibration is unchanged (verify with `__simTest`).
- **Special teams calls**: onside kick, fake punt, fake FG, return strategy (return / fair catch / squib-kick coverage) as game-day moments and call-sheet rules. Fake success odds drop with each use
  (a tendency memory per opponent, like L10's tendency books).
- Acceptance: `__planMatrix` with personnel (no dominant package), `__gameDayEquivalence` n/n.

## L14 — GM market days
- **Trade deadline day**: one event week where AI clubs send a flurry of offers. Contenders buy, losing clubs sell, and rentals (expiring contracts) carry a premium for contenders. Uses the existing `evaluateTrade`.
- **Draft-day trades**: while on the clock, AI clubs offer trade-ups/trade-downs priced with the draft value chart (and L11.5 future picks). A short timer per pick.
- **Free agency frenzy**: a 3-day bidding window at the start of FA. Competing offers, decision deadlines, and players who take less to join a contender (character-driven).

## L15 — Development and scouting with automation
- **Player development plans** (user request: with **Auto** and **Select all per position group** buttons): a focus per young player (footwork, routes, pass-rush moves, coverage…), strengthened by position-coach
  specialties. "Auto" assigns the best focus for each player from his weakest sim-relevant ratings (L12 R3 composites). "Select all" applies one focus to a whole group.
- **Scouting travel budget** (user request: with an **Auto** button): spend the scouting budget on all-star games, pro days and campus visits; coverage decides how sharp each prospect read is.
  "Auto" spreads the budget by the board's top needs.
- Candidates to add: **injury decisions** (play or rest a questionable starter; read quality from the medical staff) and **locker room** (captains, touch complaints, discipline).

## Later / open
Tags and options; holdouts; hiring the HC; analytics department; 3-year cap planner; weather; challenge flags; trick plays; halftime speech; primetime stakes; ask the GM; bye-week plan.
**Every rating in the sim** (user request, 2026-10-07): moved into L12 as P3–P4 (`NEXT_PHASE_L12.md` E0–E3), including the generated-player CTH/SPC/BTK gap.
