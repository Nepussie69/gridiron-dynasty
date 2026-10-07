# NEXT PHASE — L11.5 "Playtest 3": game-day polish, more plans, coordinator advice, stats, picks

_Planned by Claude Opus 5.5 on 2026-10-07 from the user's third playtest (screenshots of the call card, weekly hours, front-office staff, cap allocation, trade center, box score, plan screens)._
_Implemented push by push by DeepSeek Flash 4.1. Lint baseline: exactly 5 warnings. Line numbers marked ~ are approximate._

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| Q1 | Neater, easier-to-read moment card | P1 | ✅ done — verified (P1) |
| Q2 | Game-day navigation: Next play / Next drive / Next moment | P1 | ✅ done — verified (P1) |
| Q3 | Adjust the offensive and defensive game plan during the game | P1 | ✅ done — verified (P1) |
| Q4 | More offensive and defensive plan presets (balanced) | P2 | ✅ done — verified (P2) |
| Q5 | Coordinator recommendations ("what the OC/DC think we should do") | P2 | ✅ done — verified (P2) |
| Q6 | Weekly hours: show what each action actually does | P2 | ✅ done — verified (P2) |
| Q7 | Stats: DB yards allowed, tackles for loss, QB passer rating | P3 | ✅ done — verified (P3) |
| Q8 | Front-office staff get front-office skills (no offensive schemes) | P3 | ✅ done — verified (P3) |
| Q9 | Cap allocation by position group | P3 | ✅ done — verified (P3) |
| Q10 | Trade center: empty trade says "They accept" | P3 | ✅ done — verified (P3) |
| Q11 | Trade future picks up to 3 drafts ahead | P4 | not started |
| Q12 | Inbox: "Mark all read" button | P3 | ✅ done — verified (P3) |
| Q13 | Show players as current/ceiling, e.g. `64/80` (depth chart, roster lists, player cards) | P3 | ✅ done — verified (P3) |
| Q14 | **Bug:** opening inbox names the wrong club ("Buffalo Bills leadership…" for a CLE/BAL career) | P3 | ✅ done — verified (P3) |

**Guardrails:** keep L10 determinism (`__gameDayEquivalence` n/n: a stop or pause never draws rng), `__simTest` calibration (AI-vs-AI unchanged), the no-dominant-strategy rule (`__planMatrix`), canonical player objects,
optional save fields. No changes to gates, objectives, capabilities or contract pricing.

---

## P1 — Game day feels good

### Q1 — Moment card redesign (`MatchView.tsx` `MomentCard`)
The current card repeats the staff read on every option ("No read on their tendencies" three times) and packs everything in one row. New layout:
- **Header row:** "YOUR CALL" badge, the title in plain words ("3rd & 1 at their 45"), and on the right three small chips: `Q1 12:43`, the score `0-0`, and the field position.
- **Staff read line** once, under the title, with an icon ("No scouting read — buy Opponent film to see their tendencies" when there is none).
- **Option cards** in a grid (2–4 per row), each with: the label (big), a one-line description of what it is (for play calls, from the concept: "Inside run between the tackles", "Quick crossing routes", "Four receivers deep"; for others, the option's hint),
  and a small "Standing order" tag on the default. No repeated read lines.
- "Sim to end (standing orders)" moves to the navigation bar (Q2).
Add a `description` per concept in `OFF_STYLES` (`playsim.ts`; a short phrase per concept) and use it as the card hint for `call` moments.

### Q2 — Game-day navigation (`playsim.ts`, store, `MatchView.tsx`)
Add a stop granularity to the engine: `export function runUntil(world, s, stop: 'play' | 'drive' | 'moment'): Moment | null`.
- `'play'`: run one `step` that produces a play (or a moment) and stop. `'drive'`: run until the possession changes, a moment, or the game ends. `'moment'`: as `runToMoment` today.
- Stopping is checked **between steps**, never inside one, so no rng is drawn differently: `__gameDayEquivalence` must stay n/n.
- Store: `gameDayAdvance(stop)` replaces the automatic run-to-moment after each answer; when the game ends it finishes exactly as today (`advanceWeek({ userSim })`).
- MatchView game-day bar: **Next play**, **Next drive**, **Next moment**, **Sim to end (standing orders)**. The replay animates the new plays; a pending moment shows the card.
- `startGameDay` runs to the end of the **first drive** (not straight to the first moment), so the user sees the game start.

### Q3 — In-game plan adjustments
In game-day mode, a collapsible **Game plan** panel in the match view (Offense / Defense tabs, reusing `PlanEditor` with `side`), editable whenever the game is paused (between Next actions).
A change calls a NEW store action `setGameDayPlan(side, plan)`, which updates `setLivePlan` for the rest of the game (it applies from the next snap) and records `{ qtr, clock, side, preset }` in a list shown in the
post-game film card ("Switched to Hurry Up at Q4 2:10"). It does **not** change `defaultPlan` (next week starts from the saved plan). Coordinators can edit only their side.
Because plays are now simulated only up to the next stop (Q2), the change genuinely affects what comes next.
**Acceptance (P1):** build + lint 5; `__gameDayEquivalence(20)` 20/20; `__simTest` unchanged; orchestrator coaches a game using Next play/drive/moment and a mid-game plan change.

---

## P2 — Plans and staff advice

### Q4 — More presets (`gameplan.ts`)
Add 3 offensive and 3 defensive presets, built only from the existing dials (`passBias`, `tempo`, `aggression`, `coverage`) so no sim change is needed:
- Offense: **Quick Game** (`passBias 0.6, tempo 0.3`: short, rhythm throws), **Play-Action Shots** (`passBias −0.6, tempo −0.2`: run to set up the deep ball), **Ball Control** (`passBias −0.8, tempo −0.6`).
- Defense: **Two-High Shell** (`aggression 0.3, coverage 0.3`), **Press Man** (`aggression 0.8, coverage 2`), **Fire Zone** (`aggression 1.5, coverage 0.5`).
Each gets a clear blurb. **Acceptance:** `__planMatrix` (500+ games per preset, use the probe in chunks): no preset best against more than 5 of 8 opponents, none more than +1.5 margin over Balanced.
If one is, adjust that preset's dial values (not the sim).

### Q5 — Coordinator recommendations (`NEW src/game/engine/advice.ts`, `GamePlanScreen.tsx`)
`coordinatorAdvice(world, career, oppId): { side: 'off' | 'def'; coach: string; presetId: string; reason: string; confidence: 'high' | 'medium' | 'low' }[]`:
- The OC reads the matchup: their defense's weakest unit (`teamRatings` + DC style: blitz-heavy → Quick Game; weak secondary → Play-Action Shots / Air It Out; strong pass rush vs weak OL → Run Heavy/Quick Game; leading-style
  clock teams → Ball Control). The DC does the same against their offense (Air Raid → Two-High Shell; run-first → Stack the Box; weak OL → Fire Zone/All-Out Blitz).
- **Quality scales with the coordinator's rating:** below 70 the advice is sometimes generic ("Balanced"), and `confidence` drops. Deterministic (seeded by week + team).
- Replace the "Coordinator Notes" card text with the advice: "**Jaxon Kowalski (OC): Play-Action Shots.** Their safeties are slow (DEF 72): play-action should open the deep ball." plus an **Apply** button
  that sets the preset as the week's plan. Also show it on the game-day Game plan panel (Q3).
- Advice must not be a free dominant edge: it only picks among presets that are already balanced (Q4), so following it is a reasonable default, not an exploit.

### Q6 — Weekly hours explain themselves (`weekly.ts`, the "This Week" card)
Each action tile shows its real effect under the label (from the code today): Study film "+1 Evaluation skill"; Cross-check reports "+1 Profile"; Run drills "Bank development reps for your room";
Film session "+1 Scheme skill"; Opponent film "Reveal this week's opponent tendencies (2nd buy: sharp read)"; Scouts meeting "+1 Profile, learn a scout's bias"; Agent calls "+1 Roster";
Owner meeting "+2 job security". Add an `effect` field to `WeeklyAction` and render it. After a purchase, the tile shows "Done ×N this week".

---

## P3 — Stats, staff, cap, trade UI

### Q7 — Defensive and QB stats (`playsim.ts`, `stats.ts`, box score, stats hub)
- Add `coverId?: string` to pass `Play`s: the defender in coverage on the target (CB for WR targets by depth order, S on deep throws ≥ 15 air yards, LB on RB/TE short targets).
  Pick it **after** the outcome from the existing groups without new `rng()` draws (deterministic by target slot), so calibration and equivalence don't move.
- New per-player stat lines: `defYdsAllowed`, `defTargets`, `defComp` (for the coverage defender), `tfl` (the first tackler on a run with yards < 0; sacks also count as TFL).
- QB **passer rating** (standard NFL formula) computed from each QB line; shown in the box score passing table ("RTG") and the stats hub.
- Box score DEFENSE table: TCK, TFL, SCK, INT, and a new coverage line "YDS ALW" for DBs.

### Q8 — Front-office staff skills (`types.ts` `StaffMember`, `hiring.ts`, `Staff.tsx`)
Scouts, the Director of Player Personnel and the GM show an offensive scheme ("Air", "West") and a coaching specialty ("Play Calling", "Red Zone") that make no sense for them.
Give front-office roles their own fields: `focus` (Scout: "College East / College West / Pro / Character"; DPP: "Pro scouting / Negotiation / Cap / Analytics") instead of `scheme`, and front-office specialties
("Talent ID", "Character reads", "Negotiation", "Cap management", "Analytics") instead of coaching ones. Generate them in hiring for those roles; migrate existing ones (derive from id hash, deterministic).
The staff card shows FOCUS instead of SCHEME for these roles. Optionally let the user **change a front-office staffer's focus** once per season (no cost beyond the action).
Keep any existing mechanic that reads `scheme` for coaches untouched.

### Q9 — Cap allocation by position group (`Cap.tsx`)
Replace OFF/DEF/ST bars with position groups: QB, RB, WR, TE, OL, DL, LB, CB, S, K/P (sum of current cap hits per group), sorted by the order above, each with $ and % of the cap. Keep the OFF/DEF/ST
totals as a small summary line.

### Q10 — Empty trade (`Trades.tsx`)
With nothing selected the card says "THEY ACCEPT". Show "Add players or picks to build a trade" and keep Propose disabled until both sides have something (or at least one side, per current rules).

### Q12 — Inbox "Mark all read" (`Inbox.tsx`, store)
A **Mark all read** button in the inbox header (and an unread count). Marks every news item read (use the existing read flag; add an optional `read?: boolean` on news items if there is none, plus a store action
`markAllNewsRead()`). The sidebar/top-bar unread badge updates.

### Q13 — Current/ceiling ratings
Wherever a player's OVR badge appears alone (depth chart rows, roster tables' OVR cell, player cards, draft/FA lists), show **`OVR/POT`** (e.g. `64/80`): OVR in the existing badge, then a muted `/80`.
Use the same POT value the roster table already shows (for draft prospects, the scouted potential the UI already displays, never the hidden true value). Keep the separate POT column where it exists.

### Q14 — Opening inbox names the wrong club (bug)
The seeded week-1 inbox includes "Buffalo Bills leadership sets expectations" (OWNER) for careers at other clubs. Find where the opening news is generated (search for "leadership sets expectations") and use the
user's club (`career.teamId`) for every club-specific seeded item; do the same for any other hard-coded team in seeded news.

---

## P4 — Future picks

### Q11 — Trade picks up to 3 drafts ahead (`picks.ts`, `startNextSeason`, `Trades.tsx`, trade valuation)
Today `startNextSeason` replaces `world.draftPicks` with `freshDraftPicks(season + 1)`, so traded future picks can't exist.
- Keep a **rolling window** of picks for the next 3 drafts: at career start create picks for `season + 1 … season + 3`; at `startNextSeason`, drop picks for drafts already held, **keep** existing future picks
  (with their current owners), and add the new `season + 3` set. `ensureDraftPicks` creates any missing year. Migration: legacy saves get the missing years created (owned by the original team).
- Draft order/usage keeps using the picks whose `season` is the upcoming draft.
- **Value:** a pick's trade value is discounted by how far away it is: next draft ×1.0, two drafts ×0.8, three drafts ×0.65, applied in the shared pick-value function used by both the UI and AI evaluation
  (a value input, not a change to the trade logic). The Trade Center lists picks grouped by year ("2027 · 2028 · 2029").
- AI clubs may also trade future picks (they come out of the same pool).
**Acceptance:** trade a 2029 2nd-round pick, advance 2 seasons: the receiving club owns it in the 2029 draft. `__careerSmoke(6,'personnel')` 0/0. Draft ids stay unique.

---

## PUSHES
**P1 = Q1, Q2, Q3** · **P2 = Q4, Q5, Q6** · **P3 = Q7, Q8, Q9, Q10, Q12, Q13, Q14** · **P4 = Q11**
After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings. Never run `npm run dev` or any watch command. No git commands.

## DO NOT
- Do not change gates, objectives, capabilities, contract pricing, or the AI-vs-AI sim (calibration). Do not draw rng at a stop or pause boundary.
- Do not copy player objects. No new dependencies. Do not fix the baseline lint warnings. Do not leave temp files in the repo.
- Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md` or `IDEAS_*.md`. `HANDOFF.md`: append only (one "L11.5" section, in the last push).

## Verification log
- **P1** (Flash 9 min; browser-verified by Claude on 2026-10-07). `__gameDayEquivalence(20)` 20/20; `__simTest` unchanged (23.8 / 66.8% / 64.5). Game day starts after the first drive (or at the first moment);
  Next play adds exactly one play; Next drive runs to a change of possession or stops early at a moment ("3rd & 1 at their 1"); a mid-game switch to Hurry Up was logged (Q1 13:27). The card shows chips
  (Q1 9:48 · 0-0 · IND 1), the read once, a grid of options with descriptions and the Standing order tag; the nav bar disables Next while a call is pending. `__careerSmoke` coach 0/0.
  **Orchestrator polish:** concept descriptions rewritten to explain each play ("Quick slant" → "One-step slant: ball out fast"; "Screen to the back" → "Dump to the back behind blockers: punishes the blitz").
- **P2** (Flash 23 min; browser-verified by Claude on 2026-10-07). `__planMatrix` paired seeds, 800 games per preset (BUF, seed 33333): offense best-count max 4/8 (Hurry Up, Quick Game), max edge +1.35 (Hurry Up);
  defense max 4/8 (All-Out Blitz), max edge +1.23. Press Man set to coverage **1.8** (Flash: at 2.0 it was best vs 7/8, +2.14). `__simTest` unchanged (23.8 / 66.8% / 64.5 / 1.75 sacks); `__gameDayEquivalence(20)` 20/20.
  Advice card + Apply sets `defaultPlan` (Stack the Box applied); weekly tiles show the effect and "Done ×1 this week".
  **Orchestrator fixes:** the weak-secondary reason now quotes the DB rating; the DC's "their run game" branch read *their linebackers* — now reads their RB; the OC no longer recommends Run Heavy (−3.9 vs Balanced) or
  Ball Control (−2.5): strong fronts → Quick Game, run-first opponents → Balanced. **Balance note for later:** run-leaning offensive presets are all below Balanced (Run Heavy −3.9, Clock Killer −3.5, Ball Control −2.5, Play-Action −1.2).
- **P3** (Flash 7.5 min, hit its step limit after Q7 + half of Q8; continuation 6.5 min for the rest; browser-verified by Claude on 2026-10-07). `__simTest(200)` seed 33333 identical (23.8 / 66.8% / 64.5 / 1.75 / 0.97 INT / 4.84 ypc);
  `__gameDayEquivalence(20)` 20/20; `__careerSmoke(2,'personnel')` 0/0. Box score: passer rating matches the NFL formula (28/33, 290, 3 TD, 0 INT → 133.6); coverage lines (targets/comp/yds) credited by slot; TFL on sacks and
  negative runs. Cap shows QB…K/P groups with $ and % plus the OFF/DEF/ST line; staff cards show FOCUS (Scout: College East/West/Pro/Character; DPP: Pro scouting/Negotiation/Cap/Analytics) with a once-per-season change;
  empty trade says "Add players or picks to build a trade"; Mark all read → 0 unread (the sidebar badge was dead before, now counts unread news); depth chart shows `72/74`; a CLE career's opening inbox says "Cleveland Browns".
  **Orchestrator fix:** a run's TFL now goes to the same defender credited with the tackle (Flash used `t[0]`).
  **Found (pre-existing sim issue, moved to L12 E1):** one receiver gets a median 72% of his team's targets per game (argmax target pick), so coverage stats concentrate on one defender.
