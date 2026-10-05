# Gridiron Dynasty

A playable football front-office career sim. You begin as an **assistant director of college
scouting** (or an NFL position coach) and climb the ladder to **NFL General Manager** — earning
every promotion with the recommendations you make. One living league — all 32 NFL clubs — with
real ratings and a full NFL salary-cap model.

> **NFL-only build.** The college side of the game has been removed: there is no CFB universe,
> no recruiting screen, and no college career rungs. Every game is an NFL game, and the draft
> class is made of college players entering the league, exactly as in the real NFL draft.

See [`PLAN.md`](./PLAN.md) for the design document and roadmap.

## How to play

1. **New career** — name yourself, pick a track (Personnel or Coaching), and pick an NFL club.
   You start at the first NFL rung of that ladder.
2. **Scouting Board** — spend weekly scouting points to evaluate prospects in the draft class.
   The more you scout, the closer your grade gets to the truth (revealed at 70% confidence).
3. **File recommendations** — Blue Chip (Rd 1), Starter (Rd 2-3), Depth (Rd 4-7), Pass.
4. **Advance Week** — the whole league simulates: NFL games, standings, injuries.
5. **Season's end** — your class is graded. Accurate reads raise your **reputation**; misses
   cost you. A season-review card shows every call.
6. **Offseason** — the draft runs, free agency opens, and job offers arrive based on your
   reputation. Accept a promotion to move up the ladder.
7. **Climb** — the NFL rungs of your track (see *The two ladders*). Once you hold a front-office
   or head-coach role you control the draft, free agency, and the cap.

The sidebar adapts to your rung: locked screens are hidden until you earn the role that owns them.

## The salary-cap pathway

- League cap with ~7%/yr growth and the 89% spending floor
- Market value by overall, position, and age
- Signing-bonus proration (cap hit ≠ AAV), guaranteed money, **dead money**
- Rookie wage scale with a 5th-year option for first-rounders
- Restructures (base → bonus over void years), extensions, franchise-tag valuation
- Tradeable **draft picks** with tracked ownership and **compensatory picks**

## Exact ratings

Rosters use **real, exact ratings** — no approximations:

- **NFL:** all 1,833 Madden NFL 26 players across all 32 teams, with every overall
  *and* full attribute set (SPD, STR, AWR, THP, MAN, ZCV, …) exactly as rated.
- **Draft class:** built from real college players (EA Sports College Football 26, plus 2026
  newcomers) entering the NFL — exact overalls and measurables. In this build the colleges are
  only the prospects' *schools*; there is no playable college league.

**There is no generated/fake rating data anywhere in the league.** Every team and player
is exact.

The data lives in `public/data/*.json` (loaded at boot, so it doesn't bloat the JS bundle).
Regenerate it anytime with:

```bash
python3 scripts/ingest.py          # both datasets
python3 scripts/ingest.py madden   # NFL only
```

To switch to the 2027 editions, change the source URLs at the top of `scripts/ingest.py`.

## The 2D match view

Your team's games are simulated **play by play** and can be watched in a **2D top-down
viewer**:

- Every play is resolved from the **exact player ratings** and **real NFL play-by-play
  distributions** (see below) — pass rush vs. pass protection, QB accuracy vs. coverage,
  run blocking vs. front seven — so a 99-overall edge rusher actually changes the game.
- **Play calls come from the coaches.** The offensive coordinator's scheme (Air Raid,
  Pro Style, Spread, West Coast, RPO Heavy) sets the concept menu and pass/run tendency;
  the defensive coordinator's scheme (4-3, 3-4, 4-2-5, Multiple, Blitz Heavy) sets the
  front, blitz rate, and coverage. The viewer shows both coordinators and their schemes.
- The field renders 22 players + the ball, animating each snap, with a full play log you
  can scrub through. Controls: Prev / Play-Pause / Next, 0.5×–4× speed, and Skip to end.

Watch any of your games from the **Schedule** screen with the **Watch** button, or let it
open automatically after you advance the week.

## The climb (career system)

You start at the **true bottom** — a Grad Assistant / Local Scout making $40–45k — and work
your way to running an NFL franchise. Two ladders, both ending at the top of the sport.

### Reputation is four-dimensional

Advancement is not one number. Five reputation dimensions each gate different jobs:

| Reputation | Raised by | Gates |
|---|---|---|
| **Evaluation** | scouting hit rate, accurate grades | scouting roles |
| **Roster Building** | draft classes, cap health, free agency | personnel roles |
| **Leadership** | wins, staff, player development | coordinator / exec roles |
| **Results** | wins, playoff berths, championships | upper rungs |
| **Profile** | exceptional seasons, pedigree, championships | interview invitations |

### Skills develop over a career

`Evaluation · Negotiation · Leadership · Scheme · Recruiting` — these grow with performance
and shape what roles you're suited for.

### The two ladders

This build is NFL-only, so each ladder begins at its first NFL rung. The college rungs remain
in the data but are unreachable — a career never starts or drops below the NFL floor.

**Personnel** (front office → GM):
```
Asst. Dir. College Scouting → Dir. College Scouting
  → Dir. Player Personnel → Assistant GM → GENERAL MANAGER
```

**Coaching** (on-field → NFL HC):
```
NFL Position Coach / Quality Control → NFL Coordinator → NFL HEAD COACH
```

### The realistic grind — with a fast lane

Progression is a real grind *by default*, but **excellence accelerates it**:

- Grade a class at **80%+ accuracy** and you gain **Profile** — connections that open doors.
- Win a **championship** and your Profile jumps +12 — blue-bloods start calling.
- Choosing the **right program** (prestige-matched) and developing the right **skills**
  shortens the path.
- Stumble badly and you can be **fired and demoted** a rung.

Promotion happens through an **offseason carousel** with a real interview:

- Jobs open when your reputation clears the rung.
- **Accepting an offer means sitting for an interview against a named rival candidate.**
  Your reputation *fit* for the role is rolled against the rival's strength — you can lose
  the job to someone else and stay put.
- **Per-role objectives** give each season explicit goals, and the season-review card tracks
  every one: a scout must "file 6 graded recommendations" and hit 65% accuracy; a
  **coordinator must field a top-10 unit** (ranked against the whole tier); a head coach must
  win 9 games. Meeting them pays reputation.
- **Career milestones hit your inbox** — a season-review note every year, plus items when you
  make the playoffs, win a title, or **get fired and demoted**.

## The rungs are jobs

A rung isn't a label — it changes what you're allowed to do, what you can see, and what gets
remembered about you.

- **Four access levels on every screen: Locked → View → Advise → Decide.** A Local Scout can
  *view* the draft board; a cross-checker can *advise* (rank a board the Director weighs against
  consensus); the Director *decides*. The top bar shows your current level for the screen you're
  on, and blocked actions explain themselves.
- **Information quality is the real promotion.** You never see raw Madden numbers on a prospect —
  you see what *your* evaluation produces. A Local Scout sees wide ranges (e.g. `82–91`) and only
  his region; a National Scout sees tighter reads nationwide; a Director sees the staff consensus
  with disagreements flagged. The true grade only surfaces at the very top (or near-total
  confidence). Scouting sharpens the range; your **Evaluation** skill narrows it for good.
- **The Ledger.** Every grade, recommendation, draft pick, and piece of advice is date-stamped
  with the role you held. Years later it comes back — "You graded him a 2nd-rounder as an Area
  Scout in 2027; he's a starter now." The Ledger screen shows your career **batting average** and
  a **My Guys** tab that follows everyone you championed for their whole career.

Advice is graded too: when an NPC Director follows or overrides your board, it's logged and
judged — the stepping stone made literal.

- **Character is a hidden second rating.** Film shows talent; character (work ethic,
  coachability, maturity, off-field risk) is hidden and decides whether the talent ever arrives
  — it drives the development curve and bust risk, never the current rating, so the sim stays
  calibrated. You uncover it by **working the phones** (one facet at a time, sharper with a good
  **Evaluation** skill). For real named players, invented off-field incidents are never used —
  those narratives are reserved for generated players.
- **You evaluate the evaluators.** Every NPC scout has a blind spot — one overrates speed, one
  loves the blue bloods, one is soft on character. Their filed grades are skewed by it, and as a
  Director/GM you see their **staff board** and their **Ledger**, not the truth. Over seasons you
  learn "Scout B grades athletic testing ~5 high" and shade their grades accordingly.

## The rhythm of the job

A rung isn't just a permission set — it's a job with a weekly rhythm and a year of its own.

- **A weekly time budget (#5).** ~40 hours a week and a menu that changes by role: study film,
  work the phones, drive the region, cross-check reports, run drills, meet the scouts, take
  agent calls, meet the owner. The job is choosing what *not* to do.
- **One annual set piece (#6).** A "boss fight" per rung each season — lock your region board,
  the Director's board meeting, March cap crunch, install week, draft day.
- **Stretch assignments & interim jobs (#8).** Every so often your boss hands you a task from the
  rung above ("run the Southeast cross-check", "call the defense for a week"). How it goes
  shapes your promotion case.
- **Same event, different seat (#20).** The draft pays off at every rung — you get a ping when one
  of your guys comes off the board, and the seat you watch from depends on how far you've climbed.

## The people and the world

- **Contacts (#9)** — relationships with high-school coaches, trainers, NFL scouts and agents
  that travel with you and climb the ladder alongside you.
- **Mentors & a coaching tree (#11)** — every boss has a philosophy that shapes how you build; the
  assistants you develop eventually run their own clubs.
- **A rival class (#12)** — NPCs who started the climb the same year you did, on the same leaderboard.
- **A media layer (#13)** — beat writers, a national insider, and the "rising execs" and "GM
  candidates" lists your Profile earns.
- **Bosses with agendas (#14)** — owners are meddling, patient, cheap, or win-now. Interviews
  weigh your **Ledger receipts** against what they care about.
- **Traits earned by deeds (#10)** — "Diamond Digger", "Burned by the Stopwatch" — each stamped with
  where you earned it, each changing how you read prospects.
- **Getting fired is a fork (#17)** — The Wilderness: a year on TV, consulting for a rival, joining
  an agency, or the UFL.
- **Big boards are dense sortable tables** — the draft class and free agents render as compact,
  click-to-sort rows (not cards), so you can scan hundreds of names fast.
- **Eras (#18)** — the league's market drifts over the decades; positions rise and fall in value.
- **Legacy & succession (#19)** — a résumé case (rings, Ledger hits, players in Canton, your tree),
  a Hall-of-Fame vote, then keep playing as your protégé.

## Player & coach styles

**Coaching styles drive play calling.** Five OC schemes (Air Raid, Pro Style, Spread, West
Coast, RPO Heavy) set the concept menu and pass/run tendency; five DC schemes (4-3, 3-4,
4-2-5, Multiple, Blitz Heavy) set the front, blitz rate, man vs. zone, and run fit.

**Player archetypes change outcomes.** The archetype and traits from Madden 26 / CFB 26 feed
directly into the sim (`style.ts`):

- **Deep Threat** receivers get more deep targets and separation on verticals
- **Playmaker / YAC** types add yards after the catch
- **Physical / Contested** receivers win tight coverage
- **Improviser / Dual Threat** QBs scramble and complete more off-script
- **Power Backs** finish short-yardage and break tackles; **Elusive** backs rip off chunk runs
- **Speed Rushers** generate more pressure; **Ball Hawks** and **Shutdown** corners take the ball away

**Scheme fit matters.** Each archetype is rated against the coordinator's system. A
Deep Threat in an Air Raid is *Ideal*; the same player in a West Coast offense is *Poor* —
and that shows up as a target/carry-share and production swing. The player profile shows
the fit rating.

## Awards & Hall of Fame

Selected from real production at the end of every season (`awards.ts`):

- **MVP, Offensive POY, Defensive POY, and Rookie of the Year**, with the headline stat line.
- **First- and Second-Team All-Pro** — a full offense and defense, chosen by position-aware
  production score, never the same player twice.
- **Hall of Fame** — legends are enshrined automatically once their career clears a
  weighted bar (volume + peak honours + championships), and stay enshrined forever.
- Verified: a simulated NFL season produced Baker Mayfield as MVP (5,294 yds, 40 TD),
  Chris Jones as DPOY (17 sacks), and full All-Pro teams.

## Scheme-fit warnings

The Roster has a **Fit** column that flags how well each player suits your coordinators'
systems — offense graded against the OC, defense against the DC.

- **Ideal** — a perfect archetype match (a Deep Threat in an Air Raid).
- **Good** — workable; plays at ~70% of the familiarity ceiling.
- **Poor** — a genuine mismatch that will underperform until he learns it.

This connects directly to playbook familiarity: fit sets the *ceiling* a player can reach
the longer he stays in your system.

## Coaching & staff matter on the field

Staff quality is no longer cosmetic — it changes games:

- **Coordinator quality** shifts play-calling edge: a 95-rated OC helps your QB, a 55-rated
  one costs you drives. The DC edge cuts the other way.
- **Position coaches** drive **player development** — a strong staff grows young players
  faster (up to ×1.35) and slows veteran decline.
- **Head coach + special teams** quality affects **penalties and discipline** — and so does
  **team cohesion**: settled rosters commit fewer flags and execute better in the clutch.
- Verified: across 100 simulated games, **elite staffs outscored poor staffs 25.8 to 13.8** —
  roughly a 12-point swing.

**Your own skills count.** Holding a coaching role (coordinator or higher) feeds your
**Scheme** and **Leadership** skills into your team's play-calling edge, development, and
situational decisions — so developing your skills literally makes your unit better.

The **Staff & Hiring** screen now shows your staff's on-field impact and grade
(Elite / Strong / Average / Poor), and hiring is interactive:

- **Hiring Market** lists real candidates with a live **interest %** and **asking salary**.
- Coaches weigh **your destination's prestige**, **your reputation**, and **the money**.
  Elite coaches turn down weak programs — you can lowball the slider or pay above ask.
- Offers can **fail**: a candidate may be "intrigued but takes another job," or hold out
  for more money. Verified: a Local Scout at a low-prestige program attracts ~60-rated
  coaches at 58% interest; a Power Four head coach attracts ~69-rated coaches at 87%.
- **Let go** any coach, and they return to the open market.

## Stats: game, season, and career

Every play is attributed to individual players, producing:

- **Live box score** in the match viewer — passing (C/ATT, YDS, TD, INT), rushing
  (CAR/YDS/TD), receiving (REC/YDS/TD), and defense (TCK/SCK/INT) for both teams.
- **Season stats** rolled up per player.
- **Career stats** on the player profile, with a per-season table.
- **Stats Hub** — league leaderboards plus a persistent **career statistics database**:
  single-season or career leaders for passing, rushing, receiving, and defense, across every
  season played.
- **League-wide box scores** — every game in the NFL produces individual
  stats (via a fast talent-weighted allocator), so leaderboards fill out across the whole
  league, not just your team. Verified: a full NFL season produces realistic leaders
  (J.J. McCarthy, 4,633 pass yards) with your own game using true play-by-play.
- **Franchise history** — the Team Browser shows each club's season-by-season record,
  scoring, team rating, playoff berths, and championships.

## Scheme choice & playbook mastery

When you hire a coordinator you **choose the scheme** they install (Air Raid, Pro Style,
Spread, West Coast, RPO Heavy on offense; 4-3, 3-4, 4-2-5, Multiple, Blitz Heavy on defense).

Mastery is no longer individual loyalty — it's **collective continuity**. A player learns the
system through **reps and training**, but his ceiling is set by **how much his unit and coaches
have stayed together** (`src/game/engine/playbook.ts`):

- `cohesion = staffContinuity × unitContinuity` — replace the offense every year and the QB
  never gets comfortable; change coordinators every season and nobody ever masters the book.
- A player's **personal fit** sets his ceiling; **cohesion scales how much of it is reachable**.
  A churned team tops out at roughly half its potential; a settled one reaches full.
- Mastery feeds production directly (a **0.90 → 1.18** multiplier through the play engine),
  so continuity is a real on-field strategy: keep your system and your core together.

The player profile shows mastery %, game reps, the reachable **Ceiling**, and a **Team Cohesion**
bar with a plain-English read.

## Team cohesion (culture)

Cohesion isn't just for the playbook. The **Culture** panel — on the **Dashboard** and the
**Game Plan** screen — shows your staff continuity and unit continuity for both sides of the
ball, with a read on each unit. Continuity now bends the game itself:

- **Discipline:** settled teams commit noticeably fewer penalties; churned ones flag more.
- **Situational play:** settled teams execute better on money downs and in the red zone
  (a small boost to conversions and a reduction in back-breaking turnovers).

The panel is driven entirely by data already computed per player — no separate bookkeeping.

## Trades, practice squad & injured reserve

The **Trade Center** is a real two-sided market, not a mock-up:

- **Every draft pick is a tracked asset** with an owner, so picks can be traded years forward
  (including compensatory picks). The draft order is built from actual pick ownership, with
  traded picks keeping their original slot.
- **Trade AI** values assets from the other club's perspective: rebuilding teams covet youth
  and picks, win-now teams prefer proven veterans, and everyone pays a premium for a position
  of need. The screen previews their verdict (accept / close / decline) before you commit.
- **Compensatory picks** are awarded at season's end to clubs that lose more qualifying free
  agents than they sign, placed at the end of a round like the real rule.

Roster management goes beyond the 53:

- **Practice squad** (up to 16) develops young players without an active roster spot; promote
  them when they're ready.
- **Injured reserve** opens an active roster spot while a player heals, and he can be activated
  once healthy.


## Real-stat calibration

The sim doesn't guess at yardage — it samples the **actual NFL distribution** mined from
**69,682 real plays** (nflverse play-by-play, 2024–2025 seasons). Player talent tilts the
curve; the shape comes from real football.

Mined into `public/data/calibration.json` (`scripts/mine_gamelogs.py`):
- Run and pass yardage distributions (bucket → probability)
- Completion rate (64.5%), sack rate (6.9%/dropback), interception rate (2.1%/attempt)
- Run/pass tendency by down (1st: 53/47, 2nd: 41/59, 3rd: 26/74)
- Red-zone and goal-line run/pass splits and TD rates
- Third-down conversion rate (43.5%), penalty rates and yardage

Resulting per-team-per-game averages vs. real NFL:

| Stat | Sim | Real |
|---|---|---|
| Points | 22.3 | 21.7 |
| Plays | 62.4 | 62 |
| Pass att | 34.7 | 34 |
| Completion % | 67.5 | 64.5 |
| Rush att | 23.6 | 27 |
| Rush yards | 115 | 113 |
| First downs | 20.4 | 19 |
| 3rd-down % | 43.4 | 43.5 |

The **college** calibration mined from real FBS plays is still shipped and used to shape the
draft class's college production flavor, but there is no playable college league in this build.

Regenerate the NFL table with:

```bash
python3 scripts/mine_gamelogs.py   # NFL  (nflverse 2024-2025)
```

It downloads its source data to `.cache/` (git-ignored).

## Running it

Node isn't installed system-wide on this machine; a self-contained copy lives at
`~/.local/node`.

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm install        # first time only
npm run dev        # http://127.0.0.1:5173
```

Other scripts:

```bash
npm run build      # type-check (tsc) + production build
npm run preview
npm run lint
```

Your career **autosaves** to IndexedDB on every action. The save is **versioned** with a
**rolling backup**: if a save is ever corrupted, the game silently falls back to the previous
good copy and tells you. On launch you get a **Continue Career** card showing the role, team,
and season — or start fresh. Reload anytime and pick up where you left off.

## Authentic league simulation

By default, only *your* game is true play-by-play; the rest of the league uses a fast
statistical allocator (realistic, but not literal snaps). Flip the **Fast Sim / Authentic Sim**
toggle in the top bar to run **every game in the league through the real play-by-play engine**:

- Simulated in a **Web Worker**, so the season never freezes the UI.
- Real per-player box scores are recorded for every game — leaderboards and storylines across
  the whole NFL reflect actual snaps.
- It's heavier, so it's opt-in; if the worker is unavailable the game transparently falls back
  to the fast allocator.

## Balance harness (dev)

A headless harness (`src/game/engine/balance.ts`) runs whole seasons with no UI and reports the
metrics that decide whether the long arc is fun — scoring, win parity, cap pressure, roster
sizes, and promotion pacing. Run it from the dev console with `__balanceProbe(10)`. It's how
the foundation was tuned (it surfaced and fixed a player-population collapse, cap drift, and a
free-agency fill bug).

## Project structure

```
src/
  components/         AppShell, PlayerTable, PlayerProfile, SeasonModal,
                      MatchView, PlanEditor, CulturePanel, SchemeFitReport
  game/
    types.ts          Domain types (Team/Player/Staff/Contract/DraftPick/…)
    selectors.ts      Derived reads (cap, standings, schedule, needs)
    persistence.ts    IndexedDB save/load
    data/             NFL teams, Madden 26 ratings, calibration
    engine/
      rng.ts          Seeded RNG + helpers
      cap.ts          NFL salary-cap model
      generate.ts     Universe generation (32 NFL teams, rosters, contracts, draft class, schedule)
      picks.ts        Draft-pick ownership + compensatory picks
      trade.ts        Trade valuation, AI evaluation, execution
      sim.ts          Game/week/season/playoff simulation
      playsim.ts      Play-by-play engine (+ live game-plan + cohesion hooks)
      gameplan.ts     In-game dials & presets
      coaching.ts     Staff quality + cohesion → on-field effects
      style.ts        Archetypes, scheme fit
      playbook.ts     Playbook mastery + cohesion (culture)
      progress.ts     Player development, contracts, scouting evaluation
      career.ts       NFL career ladders, reputation, objectives, interviews
      draft.ts        Rookie draft, contracts, AI front offices
      stats.ts        Per-player stat accumulation
      statAlloc.ts    League-wide distributed box scores
      statsDb.ts      Career statistics database + leaderboards
      awards.ts       MVP / All-Pro / Hall of Fame
      hiring.ts       Reputation-gated staff hiring
      balance.ts      Headless multi-season balance harness
      leagueSim.ts    Client for the league play-by-play worker
  workers/            leagueSim.worker.ts (authentic league sim)
  screens/            One file per screen
  store/gameStore.ts  Zustand store: UI + world + the full game loop
  ui/kit.tsx          Design system
```

## Notes

- Real team brands; **exact real ratings** for the NFL (Madden NFL 26), ingested by
  `scripts/ingest.py`. The NFL universe is 100% exact — no generated ratings. You start at the
  first NFL rung of your chosen track.
- Intended for personal, non-commercial use.
