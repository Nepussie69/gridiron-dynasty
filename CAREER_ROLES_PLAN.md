# Career Roles — Design Doc v2

_Status: PROPOSAL — nothing built from this yet._
_Goal: every rung is a distinct, exciting stage; excellence at one rung unlocks the next._

---

## 1. Research findings (what the jobs actually are)

**NFL scouting department** (from Greg Gabriel, former Bears Director of College Scouting,
plus Senior Bowl staff bios and league reporting):

- **Scouting Assistant → Area Scout.** The entry rungs. Area scouts are assigned a
  fixed **region** (Northeast, Southeast, West Coast, Midwest, Southwest, Mountain).
  They keep that region year after year, because **relationships** at schools are what
  surface real information. ~35 schools, 3 visits/yr to majors, 2+ to mid-majors.
- **The weekly loop:** scout calls his director weekly to flag players the GM/HC should
  see. This starts when camps open in August and runs through Thanksgiving.
- **Cross-check phase (December):** the staff meets for ~a week and **eliminates** ~1,000
  players down to ~450–500 — removing bad scheme fits and character risks. Then each scout
  is assigned a **cross-check position** (the same one every year — he becomes the expert)
  and studies 30 players at that position, 4–6 games each.
- **Character matters more than talent.** The director's own words: "they could miss on
  the talent evaluation because we had others to cross check that area. They had to be
  completely accurate on character evaluation." **Most busts are character failures.**
- **National Scout / Senior National Scout** = cross-checks across the country, position
  expertise, works the all-star games and combine.
- **Director of College Scouting** owns the board and the system; promotes to
  **Asst. Director** first (the Bears example: area → senior national → asst. director).
- **Coaches join late:** after the season, each **position coach** gets 15–20 prospects to
  vet — watch tape, work them at the combine/pro day, **interview them** — because
  *"you can never take a player that a coach doesn't want to work with."*
- **Director of Player Personnel** handles **pro scouting + contracts** — free agents,
  extensions, and scouting the other 31 rosters.
- **GM** is now a **corporate executive** job (CEO/CFO/COO): ~$400M player payroll,
  hundreds of employees, and the deliverable is simply *a winning team*. Less tape,
  more leadership.

**Coaching**:
- **Coordinator** designs and (often) calls the game; some HCs take play-calling, leaving
  the coordinator to run practice, install, and personnel packages.
- **Head Coach** owns **game management** (clock, 4th down, 2-pt), the staff, and the
  program — not necessarily the play sheet.
- Position coaches develop a room and vet draft prospects at their position.

---

## 2. The problem with the current build

The ladder is **labels, not experiences**. Audit:

| Level | Actually different? |
|---|---|
| Personnel 0–3 | Objectives: "file graded recommendations" |
| Personnel 5,6,7,8 | **Identical** — same screens, same "graded class + win%" objective |
| Coaching 1 vs 2 | Identical objectives; 3,4,5,6,7 all "win games + scout a class" |

Only `canDraft` (5+) and `canSignFA` (6+) gate anything real. Nothing rewards
*doing your actual job well*.

---

## 3. Design principles

1. **Every rung removes a restriction AND adds a new decision.**
2. **Every rung has one unique verb** — the thing only that job does.
3. **Each rung teaches the skill the next rung needs.** (This is your "great at each
   task improves you on the next one.")
4. **Success is measured by the job's own metric**, not "win %" repeated.
5. **Character, not just talent, drives outcomes** — straight from the research.

---

## 4. Skill-carryover: how rung N makes rung N+1 easier

The spine of the design. Each role produces a **carried skill** that is *required*
at the next level, so being excellent now literally helps later.

| Rung | You practise | Carries forward as |
|---|---|---|
| Local Scout | Raw evaluation volume | **Accuracy** → better board position next rung |
| Area Scout | Region + relationships | **Information quality** → cross-checks are easier |
| Regional Scout | Ranking vs. consensus | **Board-building** → you can defend picks |
| National Scout | Cross-checking others | **Adjudication** → you run the room |
| Asst. Dir College Scouting | Directing a staff | **Delegation** → you own the class |
| Dir College Scouting | Owning the board | **Accountability** → the GM trusts your board |
| Dir Player Personnel | Pro scouting + contracts | **Acquisition** → cap/FA control |
| Asst. GM | Running the building | **Executive range** → GM candidate |
| GM | Everything | Championships |
| GA | Preparation & service | **Trust** → position-coach shot |
| Position Coach | Developing a room | **Production** → coordinator shot |
| Coordinator | Scheme + play calling | **Unit results** → HC shot |
| G5 HC | Doing more with less | **Program-building** → P4 shot |
| P4 HC | Performing under pressure | **Elite recruiting** → NFL shot |
| NFL Position Coach | Elite standards | **Credibility** → NFL coordinator |
| NFL Coordinator | Top-level scheme | **League-wide résumé** → HC interviews |
| NFL HC | Ownership | Super Bowls |

**Implementation:** a `skills` block already exists (evaluation, negotiation, leadership,
scheme, recruiting). Add **role mastery** — a per-role competence score that rises with
role-specific success and **bonuses the next role's starting point**.

---

## 5. The two ladders (revised with real mechanics)

### A. PERSONNEL TRACK

#### 0. LOCAL SCOUT — *the grind*
- **Verb:** Watch tape; build a raw grade book.
- **Action:** Grade prospects with **low information** (wide error bars, hidden truth).
- **Restriction:** see ~12 prospects. No board.
- **Metric:** grade **accuracy**.
- **Carries:** evaluation skill.

#### 1. AREA SCOUT — *own a region*
- **Verb:** Cover a region; work relationships.
- **Action:** **Pick a region** (different density/competition). Weekly **area-report**
  decisions: which schools/players to flag for the GM.
- **Twist:** you're graded on **character intel**, not just talent (research-backed).
- **Metric:** find a **diamond** (low-consensus player who hits) + intel accuracy.
- **Restriction:** no board control — you file, someone else ranks.
- **Carries:** information quality.

#### 2. REGIONAL SCOUT — *build the board*
- **Verb:** Rank prospects against each other.
- **Action:** **Stack your board** vs. the **consensus board**; publish where you disagree.
- **Metric:** **board accuracy** vs. actual draft outcomes.
- **Carries:** conviction/board skill.

#### 3. NATIONAL SCOUT — *cross-check*
- **Verb:** Verify colleagues' work nationally.
- **Action:** **Cross-check** assigned reports — **agree or overrule**. Pick a
  **cross-check position** you keep year after year (research-backed).
- **Metric:** how often your overrules were right.
- **Carries:** adjudication skill.

#### 4. ASST. DIRECTOR OF COLLEGE SCOUTING — *run the room*
- **Verb:** Direct the staff.
- **Action:** **Assign scouts to regions**; run the **December elimination meeting**
  (cut 1,000 → 450 from your game's prospect pool); reconcile conflicting reports.
- **Metric:** department accuracy + is the board ready by draft day.
- **Carries:** delegation.

#### 5. DIRECTOR OF COLLEGE SCOUTING — *own the class*
- **Verb:** The board is yours.
- **Action:** **Set the final board**; the GM drafts from it. Position coaches vet
  their 15–20 (research) — you reconcile their input.
- **Metric:** **draft-class production** (how your board's players turn out).
- **Carries:** accountability at scale.

#### 6. DIRECTOR OF PLAYER PERSONNEL — *pro + college*
- **Verb:** Acquire talent.
- **Action:** **Free agency, trades, extensions**; scout other rosters.
- **Metric:** roster quality + **cap health**.
- **Carries:** the money/acquisition skill.

#### 7. ASSISTANT GENERAL MANAGER — *run the building*
- **Verb:** Execute the vision across departments.
- **Action:** cap, staff input, draft execution — **GM approves the big calls**.
- **Metric:** front-office efficiency.
- **Carries:** executive range.

#### 8. GENERAL MANAGER — *final say*
- **Verb:** Own the franchise.
- **Action:** everything + **owner expectations** + your job on the line.
- **Metric:** championships, sustained contention.

### B. COACHING TRACK

#### 0. GRADUATE ASSISTANT — *the gopher*
- **Verb:** Prepare others; learn the building.
- **Action:** **Run the scout team** — simulate the opponent to prep starters.
- **Metric:** did the players you prepped improve?
- **Carries:** trust.

#### 1. POSITION COACH — *own a room*
- **Verb:** Develop a position group.
- **Action:** **Develop a room** — set focus (technique/film/conditioning); your group's
  potential rises or stalls. **Vet 15–20 draft prospects** at your position (research).
- **Metric:** **produce pro players** (2 drafted).
- **Carries:** development.

#### 2. OFFENSIVE/DEFENSIVE COORDINATOR — *call the plays*
- **Verb:** Design and call the game.
- **Action:** **Live game plan** (built) + **install a scheme** + **unit rankings**.
  Some HCs take the play sheet — decide whether to delegate.
- **Metric:** **top-third unit** + roster scheme mastery.
- **Carries:** scheme + unit results.

#### 3. GROUP OF FIVE HEAD COACH — *build a program*
- **Verb:** Run a program with fewer resources.
- **Action:** **Hire staff**, **recruit**, own game management.
- **Metric:** win the conference / beat your prestige.
- **Carries:** program-building.

#### 4. POWER FOUR HEAD COACH — *perform under pressure*
- **Verb:** Compete at the top.
- **Action:** blue-blood expectations, recruiting battles, media heat.
- **Metric:** make the playoff.
- **Carries:** elite recruiting + pressure.

#### 5. NFL POSITION COACH / QUALITY CONTROL — *cross over*
- **Verb:** Prove you belong.
- **Action:** develop one NFL room; every rep on film.
- **Metric:** your room's production.
- **Carries:** credibility.

#### 6. NFL COORDINATOR — *scheme at the top*
- **Verb:** Call plays vs. elite minds.
- **Action:** game plan, personnel packages, install.
- **Metric:** top-10 NFL unit.
- **Carries:** league résumé.

#### 7. NFL HEAD COACH — *answer to the owner*
- **Verb:** Everything, with a target on your back.
- **Action:** staff, scheme, **game management**, expectations.
- **Metric:** Super Bowl contention.

---

## 6. Cross-over: college football is a different job

The two worlds are **not the same career with different logos**. Moving between them
should be a *decision with trade-offs*, not a ladder rung.

### 6.1 How they actually differ (research)

| | **NFL** | **College** |
|---|---|---|
| Roster | Given to you | **You build it** — HS recruiting + portal + retention |
| Money | **Salary cap**, contracts, dead money | **NIL collectives + revenue-sharing payroll**, no hard cap |
| Acquisition | Draft + free agency | **Recruiting visits, NIL pitches, transfer portal** |
| Retention | Re-sign / franchise tag | **Re-recruit your own players every year** (portal risk) |
| Job shape | Specialist | **CEO-like** — fundraising, donors, alumni, compliance |
| Player evaluation | Film + character | Film + character + **projection 2–4 yrs out** |

Sources: The Athletic on the college GM role; JMCO on college GM responsibilities;
USC's GM job description (NIL budget, donor relations); Dartmouth on the
NFL-coach-as-CEO vs. college-coach-as-CEO distinction.

### 6.2 Real crossover paths (both directions)

Documented examples:
- **College → NFL:** Southern Miss's Director of Player Personnel was hired by the
  **Ravens** as a personnel assistant. The Jaguars hired **Power 5 recruiting directors**
  into personnel roles (Drew Hughes: Florida → Tennessee → South Carolina → Jaguars).
- **NFL → College:** Programs increasingly **prioritise NFL-experience hires** to run
  the portal/NIL era. Cal hired **Ron Rivera** (former NFL HC) as GM.

**Design implication:** crossover should be **lateral, with a translation penalty**, not
a promotion. You keep your reputation but your *skills* partially don't transfer.

### 6.3 Translation rules

When crossing over, skills convert — imperfectly:

| Skill | College → NFL | NFL → College |
|---|---|---|
| Evaluation | ✅ transfers fully | ✅ transfers fully |
| Scheme | ✅ transfers | ✅ transfers |
| Leadership | ✅ transfers | ✅ transfers |
| **Recruiting** | ⚠️ → becomes "**Pro scouting**" at 60% value | ⚠️ starts near 0 — must learn it |
| **Negotiation** | ✅ NIL instincts help with contracts | ⚠️ cap/contracts is a new discipline |

**Carried reputation** stays; **role mastery** partly resets. This is the drama: an
NFL exec taking over a college program must *learn to recruit*, and a college star
taking an NFL job must *learn the cap*.

### 6.4 The cross-over rungs

Insert explicit crossover roles so the move is a *stage*, not a jump:

**Personnel — college → NFL:**
- College **Director of Player Personnel** → **NFL Player Personnel Assistant / Coordinator**
  (a step *down* in title, up in league — exactly the Southern Miss → Ravens path)
- Then Area Scout → Regional → Director track in the NFL

**Personnel — NFL → college:**
- NFL **Area/National Scout** → college **Director of Player Personnel** (roster + NIL)
- Then → college **GM** (the newest, fastest-growing front-office job)

**Coaching — both ways:**
- College **Position Coach / Coordinator** → NFL **Quality Control / Position Coach**
  (already in the ladder)
- NFL **Position Coach / Coordinator** → college **Coordinator** → **HC**
- College **HC** → NFL **Coordinator** → NFL HC (the classic path)

### 6.5 A college GM role (currently missing)

The research is emphatic: **college GM is now its own job** — roster construction,
portal, NIL payroll, retention, donors. It's distinct from NFL GM (no cap, but a
recruiting/NIL economy) and distinct from Director of Player Personnel.

Add it to the personnel ladder for college roles:
- **College GM**: own the 85-man roster, NIL budget, portal strategy, retention.
  Win condition: **roster talent + retention rate + class ranking**, not wins.

### 6.6 What this means for the game

1. **Crossover offers appear** at the right rungs (in both directions), with a
   **stated penalty and upside** so the player chooses knowingly.
2. **Skills translate partially** (see 6.3) — the carting cost is the challenge.
3. **A college career is a viable full path** to the NFL, not just a starting tutorial:
   HS recruiting → portal → college GM/HC → NFL.
4. **Different success metrics per world** — wins matter less in college
   front-office roles; roster and retention matter more.

---

## 7. New mechanics this requires

### 6.1 `roleCapabilities(career)` — one gate table
Replace scattered `canDraft`/`canSignFA` with:

```
grade, rankBoard, crossCheck, assignScouts, setBoard,
proScout, negotiateContracts, manageCap, draft, signFreeAgents,
developRoom, callPlays, installScheme, hireStaff, recruit, setExpectations
```

### 6.2 Scope shrinks as you climb
- **Local Scout:** 12 prospects.
- **Area Scout:** one region's prospects.
- **Regional/National:** many regions.
- **Director+:** the whole pool.
- Coordinators see **their side only** of the game plan; HCs see both.

### 6.3 Role mastery → next-role head start
A per-role competence score. High competence in role N gives a **reputation and
skill bonus** starting role N+1 — the literal "great at each task helps the next".

### 6.4 Character evaluation
Per the research, prospects carry a hidden **character/intel** rating. Scouts who
report character accurately are rewarded more than those who nail only talent.
A character bust on your board costs you disproportionately.

### 6.5 Role-specific objectives
One per rung (metrics above). The `Objective` type + grading already exist.

---

## 8. Sequencing

| Phase | Work | Payoff |
|---|---|---|
| **1** | `roleCapabilities` table + role-specific objectives + role mastery carry-over | Kills "5–8 are identical"; every rung has a goal. No new screens. |
| **2** | Scope limits (12 → region → national) | Makes rungs 0–2 a real climb |
| **3** | Scout loop: grade → board → cross-check → elimination meeting | Makes rungs 0–5 feel like the real job |
| **4** | Character/intel system | Research-backed depth + bust drama |
| **5** | Coordinator panel polish + room development | Coaching rungs 1–2 |
| **6** | HC panel (staff + recruiting + both units) | Coaching rungs 3–4 |
| **7** | Role-specific news & feedback | Sells the fiction |

**Start with Phase 1.** It alone fixes the biggest problem. Then play a full career in
each track and see where it's still thin before building the panels.

---

## 9. Open questions

1. **Scope limits** — fun constraint or annoying handicap? Playtest rungs 0–1.
2. **Half-season stints?** If a rung has little to do, a shorter stay might beat a
   dull 17 weeks.
3. **Keep 8 rungs?** Fewer/meatier is tempting, but you like the long climb.
4. **Should NFL HC and GM diverge?** HC = wins + culture; GM = roster + cap. Same
   endpoint, different decision texture.

---

## Sources
- Greg Gabriel, former Director of College Scouting, Chicago Bears — *"An Insider's Guide
  into the NFL Scouting Process"*, Bleacher Report (region structure, weekly calls,
  cross-check positions, character emphasis, coach vetting).
- *The Athletic* — how NFL scouts craft reports (summer reports, area assignment);
  *"The evolution of the college football general manager"* (NIL, portal, revenue share).
- Senior Bowl 2027 scouting staff bios — real career paths (scouting assistant → area
  scout → national → director).
- Scouting Academy, *NFL General Manager Role* (50+ execs) — GM as corporate executive.
- JMCO — college GM responsibilities; USC GM job description (NIL budget, donors).
- SuperTalk Mississippi — college DPP → Baltimore Ravens (crossover evidence).
- Jaguars PR — Drew Hughes, Power 5 recruiting director → NFL personnel coordinator.
- Dartmouth Sports Analytics — college coach as "CEO", NFL coach given a roster.
- CBS Sports 2026 coordinator grades; Acme Packing Co. — play-caller vs. coordinator split.
