# GRIDIRON DYNASTY — Design & Build Plan

A football front-office management sim. You start as a nobody in college football and
climb the ladder — position coach → coordinator → college head coach → NFL exec → NFL
General Manager. The core of the game is **decisions**: who to scout, recruit, draft,
sign, cut, hire, and pay.

Working title: **Gridiron Dynasty**
Doc version: v0.1 (planning)

---

## 1. Vision

| Pillar | What it means |
|---|---|
| **Climb** | A real career ladder. Every job is a stepping stone. Reputation, not a difficulty slider, gates your next job. |
| **Decide** | No twitch gameplay. You win by evaluating people: players, coaches, scouts, fits. |
| **Build** | Roster construction is the whole game — cap, contracts, draft capital, scheme fit, culture. |
| **Universe** | One living world. High school → college → pro. The same players age through every tier. |

**Anti-pillars:** no play-calling, no on-field control, no micro-transactions, no live
multiplayer. It's a single-player, browser-first, data-dense sim.

---

## 2. The Universe (structure)

Three connected tiers, one shared player simulation.

### Tier 1 — College Football (FBS + FCS)
- **FBS:** ~134 teams across real conference brands:
  SEC, Big Ten, Big 12, ACC, Pac-12 (rebuilt), AAC, Mountain West, Sun Belt, MAC,
  Conference USA, plus Independents (Notre Dame, UConn, etc.).
- **FCS:** a condensed tier (e.g. Big Sky, CAA, MVFC, SoCon, Southland) so a true
  "small school" start is possible. *(Not yet shipped — the current universe is NFL + FBS.)*
- Coaches have **schemes** (Air Raid, Pro Style, Spread Option, 3-4, 4-2-5…).
- Recruiting, transfer portal, NIL budget, conference titles, CFP (12-team).

### Tier 2 — The NFL
- **32 teams**, 2 conferences × 4 divisions (NFC/AFC East-North-South-West).
- Real team brands + colors, real city/team identity, generated rosters.
- Salary cap, 53-man roster + practice squad, franchise tag, comp picks.
- 18-week season, 7-team playoff bracket, Super Bowl, draft (7 rounds).

### Tier 3 — The Player Pipeline
Players are one continuous population:
```
High School recruit → College player (0-4 yrs) → Draft prospect → NFL player → Retired/veteran
```
Attributes, potential, and injury history carry across tiers. A 5-star QB you missed
in recruiting can be the #1 pick four years later. This continuity is the game's hook.

### Career ladder (the "work your way up" spine)
```
  COLLEGE                                    NFL
  ───────                                    ───
  Grad Assistant / Analyst
      ↓
  Position Coach
      ↓
  Coordinator (OC / DC)          ──→    Position Coach / Quality Control
      ↓                                     ↓
  College Head Coach (G5 school)  ──→    Coordinator
      ↓                                     ↓
  College HC (Power 4)            ──→    Director of Player Personnel / Scout
      ↓                                     ↓
  Blue-blood HC                   ──→    Assistant GM
                                            ↓
                                        GENERAL MANAGER  →  Executive of the Year / Dynasty
```
Two viable paths: **Coach track** and **Personnel/Scout track**. Both end at GM, but the
skills, staff, and decision flavor differ. Reputation earned in one tier follows you.

---

## 3. Game Loops

### Weekly loop (in-season)
1. Read inbox / news.
2. Review last game, injuries, depth chart.
3. Set lineup / game plan emphasis + practice focus.
4. Advance week → sim other games → standings update.

### Annual calendar (the heart of the sim)
```
Feb–Mar  Free Agency + Trades
Apr      NFL Draft
May–Jul  OTA / Camp / Roster cuts
Aug      Preseason → 53-man cutdown
Sep–Jan  Season → Playoffs → Super Bowl
Feb      Staff hiring/firing carousel, awards, owner review
```
College calendar: Recruiting (Dec/Feb signing day), Portal windows, Spring ball, Fall camp, CFP.

### Career loop
- You are judged by **owner/stakeholder expectations**, not just wins.
- Performance → reputation → job offers/interviews in the offseason.
- Get fired? You drop a tier and rebuild. Career never hard-resets.

---

## 4. UI / UX Design Direction

**Concept:** a modern *scouting room / front office terminal* — data-dense but calm.
Reference points: FM26's principles (**Efficiency, Familiarity, Predictability**),
ZenGM's clean sortable tables, and NFL broadcast graphics.

### Visual language
- Dark, low-glare base (`#0B0E14` → `#141A24`) for long sessions.
- **Team theming:** primary/secondary colors drive accents, header, charts. Switching
  teams re-skins the app instantly.
- Typography: a condensed display font for headers/numbers (sports-broadcast feel),
  a clean sans for body. Tabular numerals everywhere.
- Color semantics: green = positive cap/grade, amber = caution/injury, red = negative,
  conference/division color chips for standings.
- Charts: bars, radar (player skills), and sparklines. No 3D.
- Player cards look like **scouting dossiers** with a grade badge and trait chips.

### Layout shell
```
┌──────────────────────────────────────────────────────────────┐
│ TOP BAR: Team crest · Name · Cap space · Record · Week/Season │
├──────────┬───────────────────────────────────────────────────┤
│ SIDEBAR  │  CONTENT AREA                                     │
│ Dashboard│  ┌ tabs / breadcrumb ┐                           │
│ Roster   │  screens render here                              │
│ Depth    │                                                   │
│ Staff    │                                                   │
│ Scouting │                                                   │
│ Draft    │                                                   │
│ Recruit  │                                                   │
│ Free Agt │                                                   │
│ Trades   │                                                   │
│ Cap      │                                                   │
│ Schedule │                                                   │
│ Standings│                                                   │
│ League   │                                                   │
│ Inbox    │                                                   │
├──────────┴───────────────────────────────────────────────────┤
│ STATUS: Advancing week… | notification toasts                 │
└──────────────────────────────────────────────────────────────┘
```

### Screen inventory (MVP targets)
| # | Screen | Key content |
|---|---|---|
| 1 | **Career Hub / New Game** | Pick start tier + job, coach archetype, name/identity |
| 2 | **Dashboard** | Record, next game, owner expectations, news feed, cap snapshot |
| 3 | **Roster** | Sortable table: pos, age, OVR/POT, contract, cap hit, morale |
| 4 | **Depth Chart** | Drag-to-order depth, scheme fit warnings |
| 5 | **Staff** | Hire/fire HC/OC/DC/scouts, coaching tree, salary pool |
| 6 | **Scouting** | Big board, grades, confidence level, scout assignments |
| 7 | **Draft** | 7-round board, trades, pick-value chart, GM tendency AI |
| 8 | **Recruiting** *(college)* | Recruit list, visits, NIL budget, commit % |
| 9 | **Free Agency** | Market list, negotiation, competing offers |
| 10 | **Trades** | Two-sided trade builder + trade value calculator |
| 11 | **Cap / Finance** | Cap sheet, dead money, extensions, restructures |
| 12 | **Schedule / Results** | Week-by-week, box scores |
| 13 | **Standings / Bracket** | Divisions, seeds, playoff bracket |
| 14 | **League / Teams** | Browse all teams, rosters, history |
| 15 | **Player Profile** | Bio, ratings, contract, stats, scouting report |
| 16 | **Inbox / News** | Offers, press, transactions, owner notes |

---

## 5. Technical Plan

### Recommended stack
- **React + TypeScript + Vite** — fast, previewable, easy to wrap as desktop later.
- **Tailwind CSS** + a small in-house component kit (buttons, tables, tabs, badges).
- **Zustand** (+ immer) for game state; selectors keep re-renders cheap.
- **Persistence:** IndexedDB (via Dexie) for full save/load; export/import JSON save files.
- **Seeded RNG** (`seedrandom`) so a save's universe is reproducible.
- **Sim engine in a Web Worker** so long season sims never freeze the UI.
- Charts: Recharts (or hand-rolled SVG for the lightweight pieces).

### Architecture
```
src/
  app/            routing, shell, theming
  ui/             component kit (Table, Card, Badge, Tabs, Modal, Sparkline)
  screens/        one folder per screen above
  game/
    model/        types: Team, Conference, Player, Staff, Contract, DraftPick
    data/         seeded universe: NFL teams, CFB teams/conferences, name pools
    gen/          player + staff generators (distributions by position)
    sim/          game sim, season sim, progression, injuries, awards
    decisions/    draft AI, FA negotiation, trade valuation, recruiting AI
    career/       reputation, expectations, job market, carousel
  store/          zustand slices + persistence
  workers/        sim.worker.ts
```

### Data reality / licensing note
- **Team names + conferences:** fine for a personal project; I'll include a flag to swap
  to fictional city/team names if you ever want to distribute it.
- **Player names:** I recommend **procedurally generated players** (name pools) rather than
  real rosters. It avoids likeness/licensing issues, scales infinitely across decades, and
  fits the "living pipeline" design. Real *staff* names could be added later the same way.

---

## 6. Build Phases

| Phase | Focus | Deliverable | Status |
|---|---|---|---|
| **0** | Plan + scaffold | Repo, stack, theme tokens, app shell | ✅ Done |
| **1** | UI first | Every screen navigable, broadcast-booth design system | ✅ Done |
| **2** | Data + universe | Teams, real ratings (Madden 26 / CFB 26), rosters, contracts, schedules | ✅ Done |
| **3** | Sim engine | Game sim, weekly advance, standings, playoffs, champions, awards | ✅ Done |
| **4** | Decision systems | Scouting, draft, free agency, cap moves, staff | ✅ Done |
| **5** | Career layer | Scout→GM ladder, reputation, job offers, multi-season | ✅ Done |
| **6** | Polish | IndexedDB autosave, season-review modal, toasts | ✅ Done |
| **7** | Front-office depth | Team cohesion (culture + on-field effects), trade AI with pick ownership, practice squad / IR, compensatory picks | ✅ Done |

### The career ladder (implemented)

```
Local Scout → Area Scout → Regional Scout → National Scout
   → Assistant Director of College Scouting → Director of College Scouting
   → Director of Player Personnel → Assistant General Manager → General Manager
```

You start as a **local scout at a small FCS program**. Each season you scout a
prospect class, file recommendations (Blue Chip / Starter / Depth / Pass), and at
season's end your hit rate is graded — moving your reputation, which unlocks job
offers at the next rung. Front-office control (draft, free agency, contract moves)
unlocks as you climb.

### Salary-cap model (implemented)

- League cap with ~7% annual growth and the 89% spending floor
- Market AAV by overall / position / age
- Signing-bonus **proration** so cap hit ≠ AAV
- **Rookie wage scale** — slotted 4-year deals, 5th-year option for Round 1
- Guaranteed money, **dead money** on release, cap savings
- **Restructures** that convert base salary into bonus over void years
- Extensions and franchise/transition tag valuation
- Per-unit cap allocation and cap-health indicators


### Team cohesion / culture (implemented)

- Playbook mastery is capped by **cohesion = staff continuity × unit continuity**
  (`engine/playbook.ts`): a player learns through reps and training, but his ceiling is set by
  how long his unit and coaches have stayed together. A churned team reaches ~half its potential;
  a settled one reaches full.
- The **Culture** panel on the Dashboard and Game Plan surfaces staff tenure, unit continuity,
  average mastery, and ideal-fit share for both sides of the ball.
- Cohesion also bends the sim: settled teams commit **fewer penalties** and execute better on
  **money downs and in the red zone** (`engine/coaching.ts`, `engine/playsim.ts`).

### Trades, draft capital & roster rules (implemented)

- **Draft picks are tracked assets** with an owner (`engine/picks.ts`), so picks can be traded
  forward. The draft order is built from pick ownership, and **compensatory picks** are awarded
  to clubs with net free-agent losses, placed at the end of a round.
- **Trade AI** (`engine/trade.ts`) values assets from the other club's perspective — rebuilding
  vs. win-now, youth vs. veterans, positional need — and the Trade Center previews the verdict
  (accept / close / decline) before you commit. Player trades move contracts and reset playbook
  mastery, as a new system would.
- **Practice squad** (up to 16) and **injured reserve** are modelled with promote / release /
  place / activate actions and active-roster spot rules.

### What Phase 1 delivered
- Local, self-contained Node v24 toolchain at `~/.local/node` (no system changes).
- Vite + React 19 + TypeScript + Tailwind v4 project, builds clean.
- Broadcast-booth design system (`src/ui/kit.tsx`) with team-color theming.
- App shell: broadcast scoreboard top bar, grouped sidebar nav, toast system.
- 15 screens: Career Hub, Dashboard, Roster, Depth Chart, Schedule, Standings,
  Scouting, Draft, Recruiting, Free Agency, Trades, Salary Cap, Staff, League, Inbox.
- Player profile drawer with Madden/CFB-style attributes.
- Deterministic seeded universe: 32 NFL teams + ~120 CFB programs, generated rosters,
  staff, standings, draft board, recruits, free agents, and news.
- Ratings sourced from curated **Madden NFL 26** / **College Football 26** values
  (`src/game/data/ratings.ts`), with a per-position attribute schema ready for the
  full data pipeline.

---

## 7. Locked Decisions
1. **Platform/stack:** Web app — React + TypeScript + Vite + Tailwind CSS.
2. **Career model:** Full climb — coach path *and* personnel/scout path, both ending at NFL GM.
3. **Player data:** Real NFL + college team names and real player rosters.
   - **Ratings:** **exact real ratings** are ingested by `scripts/ingest.py` into
     `public/data/madden26.json` (1,833 Madden NFL 26 players — overall + full attribute
     set) and `public/data/cfb26.json` (138 teams / 11,730 College Football 26 players +
     2026 FBS newcomers from CFB 27 — overall + core attributes + class + measurables).
     The world generator builds real rosters from these; there is no generated rating data.
     The career starts at a Group of Five program so the entry path is exact too.
   - Data pipeline (Phase 2): ingest full Madden 26 / CFB 26 rosters (overall + attribute
     set) plus public sources (nflverse, ESPN, CollegeFootballData API). Bundle a static
     snapshot so the app works offline.
   - Note: real rosters/ratings are for personal/non-commercial use; a fictional-name
     toggle remains a future option if this is ever distributed.
4. **Visual direction:** Bright "broadcast-booth" — light theme styled like NFL TV
   graphics. Bold team colors, high contrast, scoreboard energy. Team theming re-skins
   the app from the active team's primary/secondary colors.
5. **v1 slice (Phase 1):** Full navigable UI shell, all 16 screens, mock/seeded data.
