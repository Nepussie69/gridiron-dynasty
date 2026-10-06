# Game-day coaching: 10 ideas for more user input (Head Coach / Coordinator)

_Written 2026-10-06 by Claude Opus 5.5 as a candidate **L10** phase. Not a spec yet: turn the chosen ideas into `NEXT_PHASE_L10.md` before sending anything to Flash._

## Where we start
- `simulatePlayByPlay` (playsim.ts) runs a **whole game in one call**. The match view (`MatchView.tsx`) **replays** it; a live plan change only affects later plays of a live sim.
- In-game decisions are hard-coded AI: 4th down (`playsim.ts` ~637: go for it only on short yardage), no 2-point tries, no timeouts, no halftime logic.
- What the user controls today: the game plan (2 dials per side, now wired correctly after L9.5 R1), the weekly wrinkle, the install, prep hours, and the depth chart.
- Design anti-goal (IDEAS_HANDOVER.md): **no twitch gameplay, no on-field control.** So the user **calls the big moments**, not every snap.

## Design rules for every idea
1. **Decisions, not bonuses.** Each call changes a real sim input (a concept, a rule, a matchup) with a visible **trade-off**. No free "+X".
2. **AI coaches use the same functions**, with noise scaled by their coaching rating. The user is better only by deciding better.
3. **No dominant choice.** Every option must lose to something. The opponent adapts to the user's **tendencies** (idea 6).
4. **Deterministic** (seeded rng), with **standing orders** for fast sim, so skipping a game never punishes you.
5. **Rung scope** (`capabilities.planScope`): a coordinator calls **their own side**; the HC calls 4th downs, 2-pointers, clock and halftime, and can **override** a coordinator (at a relationship cost).
6. **A cap on moments**: at most ~6 prompts per game, so a week still takes a minute.

---

## 1. Decision-point engine (the foundation)
Make the sim **resumable**: `simulatePlayByPlay` becomes `startGame()` → `step()` until it hits a **moment**, returns `{ state, moment }`, and `resume(state, choice)` continues.
- **Moments**: a 4th down in plus territory, a 2-point decision, the 2-minute drill (≤ 2:00 in Q2/Q4 in a one-score game), halftime, and a red-zone snap on 3rd/4th down.
- **Fast sim** answers each moment with the user's **standing orders** (idea 2), so results never depend on whether you watched.
- The Watch view becomes the "game day" screen: it plays up to a moment, shows the call card, then continues.
- **Why first:** ideas 2, 4, 5, 7 and 9 all need it. **Risk:** the biggest refactor here; it needs a sim-calibration check (`__simTest`) before and after.

## 2. Fourth-down and two-point call sheet
A pre-game **aggression chart** (a grid of field zone × yards to go → Go / Kick / Punt, plus 2-point rules by score margin) that replaces the hard-coded rule, and is used for standing orders and AI defaults.
- **Live prompts** at the big ones show a **win-probability hint** from your analytics or quality-control staff. Its accuracy scales with the staff hired: a weak staff gives you a fuzzy number.
- **Trade-off:** going for it is often +EV, but a failed attempt in a close loss draws media heat and owner patience. A small job-security or profile hit, inside the existing caps.
- AI coaches get a chart from their personality (aggressive/conservative), which also makes opponents feel different.

## 3. Script the opening drive
Before kickoff, pick the first **8–15 calls** from concepts you've **installed** (install.ts + playbook familiarity).
- Scripted calls get a small **execution edge** (practiced all week), which decays as the defense adjusts after the first drive.
- **Trade-off:** a script built on unfamiliar concepts loses the edge. A script that ignores the opponent's tendencies (idea 6) gets read.
- It gives the Install feature a game-day payoff and the coordinator a weekly ritual.

## 4. Call the play at key moments (the "play-calling" ask)
At a moment (3rd and short, red zone, the last drive), the user picks one of **3 concept cards** drawn from their playbook (e.g. *Mesh*, *Inside Zone*, *Four Verts*, *PA Boot*).
- Each card shows **what your staff sees**: their likely front or coverage and your matchup edge. The opponent DC secretly picks a call from a distribution seeded by **their scheme and tendencies**.
- It works like rock-paper-scissors with information. Concept × call sets the sim's success modifiers (reusing `pickConcept` / `resolvePass` / `resolveRun` inputs).
- **Anti-dominance:** the opponent tracks **your** recent calls in that situation (idea 6), so spamming the best card gets punished.
- A DC rung gets the mirror version: pick the **coverage or pressure** call against their likely play.

## 5. Halftime adjustments
At the half, the staff shows a **diagnostic** built from first-half stats: "Their DE has beaten your RT for 2 sacks", "They're 6/7 on 3rd down vs Cover 3", "Your run game is averaging 2.1".
- Pick **1 of 3 adjustments** (e.g. chip help on the RT, a quick-game emphasis, max protect). Each **fixes one problem and costs something elsewhere** (max protect = fewer routes = fewer explosives).
- AI coaches make an adjustment too, quality scaled by rating. This was already on the backlog as "the coordinator's halftime adjustments".

## 6. Opponent tendency report and self-scouting
Weekly prep: spend **prep hours** (existing `spendHours`) to reveal the opponent's **tendencies**: blitz rate on 3rd and long, coverage by down, run/pass by personnel.
- More hours or a better quality-control coach give **sharper** reads. The read feeds the hint lines on the call cards (ideas 4 and 5).
- **Self-scouting:** your own tendencies accumulate across the season and opponents exploit them. Breaking a tendency on purpose (calling against type) is a real choice.
- This is the safe version of the deferred **#14 self-scouting**: the dominant read is prevented **because** opponents learn your habits.

## 7. Two-minute drill and clock management
Add **3 timeouts per half** and clock calls to the sim. In a 2-minute moment, choose: **hurry up / spike / use a timeout / run the clock / play for a FG vs a TD / kneel**.
- Defensively: **use timeouts to get the ball back** versus save them.
- **Trade-off:** hurry-up raises turnover and penalty risk; running the clock leaves points on the table.
- These are short, high-drama decisions that make close games feel coached.

## 8. Matchup assignments
Weekly matchup calls: **shadow their WR1 with your best CB**, **double-team their best pass rusher**, **feature the hot-hand RB**, **target their weakest DB**.
- These map to concrete sim inputs: target selection weights in `resolvePass`, and pressure versus protection for a doubled rusher.
- **Trade-off:** doubling one rusher frees another; shadowing leaves your CB2 on their WR2. The sim already models pressure and coverage per player, so the cost is real.
- A coordinator owns their side's assignments; the HC approves or overrides them.

## 9. Usage and in-game personnel
**Workload choices** (a snap share for the star RB, a DL rotation for fresh legs) trade production against injury and fatigue risk.
- **Bench a struggling QB at half** (a moment from idea 1): it can save the game, but hits the locker room (culture.ts) and that player's trust.
- This ties the depth chart and culture into game day without micromanaging every snap.

## 10. Post-game film grade for your calls
After each game, grade the **decisions you made**: "Your 4th-down calls added +2.1 expected points", "Max protect at half cut sacks from 3 to 0", "Your 3rd-and-short calls went 1 for 4 (they read your Inside Zone tendency)".
- It's the feedback loop that teaches the systems. It feeds the **coordinator/HC job metric** and résumé (objectives/portfolio) **within the existing reward caps**, and it gives the staff awards (L9) something real to judge.

---

## Suggested phasing (if approved)
| Push | Ideas | Why this order |
|---|---|---|
| P1 | 1 decision-point engine + 2 4th-down/2-pt chart + 10 film grade (4th downs only) | Foundation plus the simplest, highest-drama decision; calibration check before going further |
| P2 | 5 halftime + 7 two-minute/timeouts | Uses the moments engine; closes the "halftime adjustments" backlog item |
| P3 | 6 tendencies/self-scout + 4 play-call cards + 3 opening script | The play-calling core; tendencies ship first so the cards can't be spammed |
| P4 | 8 matchups + 9 usage/personnel | Deeper weekly layer once game day is stable |

**Balance checks to run each push:** `__simTest` league calibration unchanged for AI-vs-AI; `__balanceProbe` pacing unchanged; a "dominant choice" probe (always pick the same option for 200 seeded games against varied opponents: no single choice should win more than ~+1 win per season over a sensible mix).
