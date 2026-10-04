# GRIDIRON DYNASTY — Handover for Design Ideas

_Purpose of this file: get a fresh model up to speed so it can propose ideas,
not just continue coding. Written 2026-10-05._

---

## 1. What we're building

A **football front-office career sim**, browser-based. You start as a **local scout
at a small college program** and climb to **NFL General Manager** (or a coaching
path to **NFL Head Coach**). Every rung should feel like a distinct, exciting job.

**The hook:** one living universe. High-school recruits → college players → NFL
draft prospects → pros → Hall of Fame. The players you evaluate as a nobody become
the stars you chase a decade later.

**Anti-goals:** no twitch gameplay, no on-field control, no microtransactions.

---

## 2. Where it lives

**Path:** `/Users/aaron/Documents/deepseek-harness/untitled folder`
**GitHub:** https://github.com/Nepussie69/gridiron-dynasty (private)
**Stack:** React 19 · TypeScript · Vite 8 · Tailwind v4 · Zustand

```bash
export PATH="$HOME/.local/node/bin:$PATH"   # Node is NOT system-installed
cd "/Users/aaron/Documents/deepseek-harness/untitled folder"
npm run dev      # http://127.0.0.1:5173
npm run build    # tsc -b && vite build
```

**A 502 means the dev server died** — just `npm run dev` again.
**Dev probes:** `__simTest(games,tier)`, `__staffProbe(n)`, `__hiringProbe()`,
`__balanceProbe(seasons)`, `__leaguePbpProbe(n)`.

---

## 3. What's already built (working)

### Universe & data
- **NFL:** 32 real franchises. **College:** 138 real FBS programs.
- **Exact ratings** from Madden 26 (1,833 NFL players, full attributes) and
  College Football 26 (11,730 college players) — `public/data/*.json`.
- **Real play calibration**: NFL distributions mined from 69,682 real plays;
  college from 204,489 real FBS plays. Sim reproduces real per-game averages.

### The career system
- **Two ladders:** Personnel (scout → GM, 9 rungs) and Coaching (GA → NFL HC, 8 rungs).
- **5-dimension reputation:** evaluation · roster · leadership · results · profile.
- **Skills:** evaluation · negotiation · leadership · scheme · recruiting.
- **Role capabilities** (`capabilities.ts`): one table defining what each rung can
  actually do — grade → rank board → cross-check → run the room → own the class →
  acquire → manage cap → draft.
- **Role-specific objectives** for all 17 rungs (a scout files accurate reports; a
  coordinator ranks a top-third unit; a GM makes the playoffs).
- **Role mastery with carry-over** — excellence in one job boosts reputation in the next.
- **Interview carousel** vs. named rivals; firing and demotion; season-review modals.
- **Cross-over rule:** a college head coach crosses to an **NFL position coach /
  coordinator** — never straight to an NFL HC job.

### The game on the field
- **Play-by-play engine** using exact ratings, real distributions, coordinator
  schemes, scheme fit, and playbook mastery.
- **2D top-down match viewer** with animated snaps and a live box score.
- **Game plans:** run/pass, tempo, pass rush, coverage — settable pre-game and live.
- **Full-league play-by-play** option via a Web Worker (`leagueSim.ts`).

### Roster, cap, stats
- **Salary cap**: market contracts, proration, dead money, restructures, rookie
  wage scale, franchise tags, 53-man cutdown.
- **Coaching effects**: staff quality changes play-calling and player development
  (~12-point swing between elite and poor staffs).
- **Playbook mastery + team cohesion**: how well a unit and staff stay together caps
  how fast players learn the system.
- **Stats**: live box scores, career stats across college and pro, league-wide
  leaderboards, **Stats Hub**, **Awards & Hall of Fame**, franchise history.

### Two distinct prospect pools (just fixed)
- **NFL draft** — draft-eligible *college* players.
- **College recruiting** — *high-school* prospects (age 17-18, noisier evals, star
  ratings, NIL asks). Both auto-regenerate every offseason, with a safety net if a
  pool is exhausted.

### Screens (17)
Career Hub, Dashboard, Scouting, Roster, Depth Chart, Game Plan, Schedule, Draft,
Free Agency, Trade Center, Salary Cap, Staff & Hiring, Inbox, Standings, Stats Hub,
Awards & HOF, Team Browser.

---

## 4. The core design problem right now

**The career ladder is still mostly labels.** A design doc
(`CAREER_ROLES_PLAN.md`, in the repo) diagnoses this: levels 5-8 of the personnel
track were mechanically identical until Phase 1 landed. Phase 1 gave every rung its
own capabilities and objectives — but the **screens don't change** as you climb, and
**nothing stops a rung feeling like "waiting."**

**The user's central want, in their words:**
> "Each role has a significant role in building a team. Being great at each task
> will improve you on the next one. I want every job to feel like an exciting stage
> of learning and a stepping stone to the next role."

---

## 5. Research already done (don't redo this)

- **Real scouting department structure** (from a former Bears Director of College
  Scouting): area scouts hold a fixed region for years for *relationships*; a weekly
  call system; a December "cross-check phase" eliminating ~1,000 prospects to ~450;
  **character evaluation matters more than talent** ("most busts are character
  failures"); position coaches vet 15-20 prospects and interview them.
- **The college game is a genuinely different job**: no salary cap but **NIL
  collectives, revenue-sharing payroll, the transfer portal, retention, donors**.
  College HC is "CEO-like"; NFL coaches are given a roster.
- **Cross-over is real both ways**: a college Director of Player Personnel was hired
  by the Ravens; the Jaguars hired Power 5 recruiting directors. Cal hired Ron Rivera.
- **The GM job is now a corporate executive role** — CEO/CFO/COO, ~$400M payroll,
  deliverable is "a winning team", not tape work.

Full citations in `CAREER_ROLES_PLAN.md`.

---

## 6. Where ideas would help most

Ranked by likely impact. **Think about these, not the codebase.**

### A. Making each rung feel like a real job
- How do we make a **Local Scout** feel different from a **National Scout** without
  new screens? (Scope limits? Different information quality? Different time horizon?)
- Should each rung have **its own mini-game** — a scout's board, a coordinator's
  install week, a GM's cap crunch?
- How do we make **failure** interesting rather than punishing?

### B. The "stepping stone" feeling
- How do you *show* a player that being good at job N is building toward job N+1?
- Should roles have **visible skill trees** or **mentors**?
- Is there a way to make **reputation feel alive** — rival execs, media, job rumours?

### C. College vs. NFL identity
- How much should the **college game differ mechanically** from the NFL?
  (Recruiting vs. drafting, NIL vs. cap, retention vs. re-signing.)
- Should a full career be playable **entirely in college**?

### D. Long-arc pacing
- How many seasons *should* it take to reach GM? What keeps season 12 interesting?
- What makes a player start a **second career** after being fired?
- Should there be **legacy** — your protégés coaching elsewhere, your players in the HOF?

### E. What's missing from the genre
- Football Manager and OOTP have decades of design behind them. What do they do that
  this doesn't? What do they do that we should *deliberately avoid*?

---

## 7. Constraints to respect

- **Browser app**, single-player, no backend.
- **Data is real** (team names, player ratings) — personal/non-commercial use only.
- The sim is **calibrated to real statistics** — don't break that casually.
- It should stay **readable**: dense tables, broadcast styling, no cartoons.
- The user likes the **long climb** — don't collapse the ladder to 3 rungs.

---

## 8. Open questions the user has already raised

1. Should **college football** be a full alternate career, not a tutorial?
2. How do we stop the mid-ladder rungs feeling like filler?
3. Can **coaches and players building culture together** be a deeper mechanic?
4. Should **character** (not just talent) drive prospect outcomes — per the research,
   most busts are character failures?

---

## 9. Document map

| File | What it is |
|---|---|
| `README.md` | Player-facing overview |
| `HANDOVER.md` | Technical handover (for continuing the build) |
| `CAREER_ROLES_PLAN.md` | **Career design doc with research + proposal** |
| `PLAN.md` | Original project plan and phasing |
| `scripts/*.py` | Data ingestion (Madden 26 / CFB 26 / play-by-play mining) |
| `src/game/engine/*.ts` | All game systems |

---

## 10. One-paragraph summary for a model joining cold

Gridiron Dynasty is a browser football management sim where you climb from local
college scout to NFL GM. The engine is genuinely deep — real ratings, real
statistical calibration, play-by-play, a full cap model, career stats and a Hall of
Fame. The **weak point is the career's feel**: the rungs don't yet play differently
enough, and the user wants each job to feel like an exciting, meaningful stage that
teaches you something for the next one. The research is done; the mechanics exist;
what's needed is **design imagination** about progression, identity, and long-term
motivation.
