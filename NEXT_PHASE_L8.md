# NEXT PHASE — L8 "The staff room"

_Planned by Claude Opus 5.5 on 2026-10-06. Implemented task by task by DeepSeek Flash 4.1 (OpenCode)._
_Lint baseline: exactly 5 warnings (PlayerTable.tsx:39, Cap.tsx:22, ui/kit.tsx:371, MatchView.tsx:151, MatchView.tsx:160)._

## Progress

| Task | What | Push | Status |
|---|---|---|---|
| Y1 | Weekly wrinkle: engine | P1 | ✅ done — verified (P1) |
| Y2 | Weekly wrinkle: store + sim hook + UI | P1 | ✅ done — verified (P1) |
| Y3 | Install plan: engine + store + sim hook | P2 | in progress (P2) |
| Y4 | Install plan: UI | P2 | in progress (P2) |
| Y5 | Starter pitch (position coach): engine + store | P3 | not started |
| Y6 | Starter pitch: depth chart UI | P3 | not started |
| Y7 | Red flag (take him off the board): engine + ledger | P4 | not started |
| Y8 | Red flag: draft wiring + UI | P4 | not started |
| Y9 | HANDOFF.md docs | P4 | not started |

## Phase goal

L6 and L7 gave the **personnel** middle rungs signature jobs. L8 does the same for the **coaching** side (NFL Position Coach = coach level 5,
NFL Coordinator = coach level 6, Head Coach = 7), and adds the last personnel idea from the list (red flags).

| # | Feature | Rung | The decision |
|---|---|---|---|
| K1 | **Weekly wrinkle** | `callPlays` (Coordinator, HC) | Each week, pick one wrinkle for the game plan. A fresh wrinkle gives a small edge; reusing it decays as opponents get the film. |
| K2 | **Install plan** | `installScheme` (Coordinator, HC) | Each offseason: a **Lean** install (fast start, flat finish) or a **Full** install (slow start, strong finish). |
| K3 | **Starter pitch** | `developRoom` without `callPlays` (Position Coach) | Once a week, pitch a starter for your side of the ball to the coordinator. Accepted pitches change the real depth chart. |
| K4 | **Red flag** | personnel with `rankBoard` or `setBoard` | Up to 2 prospects per draft taken off your club's board. Graded later: did he bust elsewhere? |

**Sim hook (K1, K2):** the sim already takes a per-game user coaching bonus. `src/store/gameStore.ts` `applyUserCoaching(career)` (~line 1705) calls
`setUserCoaching({ teamId, off, def, development, situational })` from `src/game/engine/playsim.ts`, and `ocEffect` adds `off`/`def` to the user club's
`offEdge`/`defEdge` (roughly a −6..+6 scale). K1 and K2 add to `off`/`def` there and nowhere else. **Hard cap:** the combined K1+K2 bonus is clamped to **[−0.6, +1.5]** per side.
AI clubs are unaffected, so league calibration can't move.

**Guardrails:** No changes to reputation gates, `roleObjectives`, `capabilities.ts`/`access.ts`, `evaluateTrade`, or sim constants. Rewards ≤ +3 per dimension per feature per season.
Every new save field is optional.

---

## K1 — Weekly wrinkle (Y1–Y2)

**Wrinkles** (the side follows `career.unitFocus`; HC / `'both'` picks one per side):
- Offense: `motion` "Motion & shifts", `playaction` "Play-action shots", `tempo` "Tempo package", `unbalanced` "Unbalanced line"
- Defense: `simpressure` "Simulated pressure", `bracket` "Bracket their WR1", `disguise` "Disguised coverage", `runblitz` "Run blitz"

**Edge rule (decays with film):** for each wrinkle, let `uses` = how many times it has been chosen in the **last 4 weeks** (not counting this week).
Edge = `[1.0, 0.6, 0.3, 0.0][min(uses, 3)]`. A wrinkle not used for 4+ weeks is fresh again. No wrinkle chosen → 0.
The effect is: always rotating = +1.0, always the same = +0 by week 4. The best play is to rotate, and that's the whole point.

**Types:** `CareerState.wrinkles?: { season: number; history: { week: number; side: 'off' | 'def'; id: string }[]; pick?: { off?: string; def?: string; week: number } }`.
**Engine — NEW `src/game/engine/wrinkle.ts`:** `OFF_WRINKLES`, `DEF_WRINKLES` (id, label, blurb), `canWrinkle(career)` (has `callPlays`),
`wrinkleEdge(career, side, id, week): number`, `wrinkleBonus(career, week): { off: number; def: number }` (from `pick` if `pick.week === week`).
**Store:**
- `pickWrinkle(side, id)`, guarded by `canWrinkle`. A coordinator may only pick for `unitFocus`'s side; HC for both. It sets `pick` for the current `world.week`.
  A new season resets `history`.
- In `advanceWeek`, after the user's game is simulated, append this week's picks to `history` (keep the last 8 entries) and clear `pick`.
- `applyUserCoaching(career)`: add `wrinkleBonus(career, world.week)` to `off`/`def` (via the shared clamp, see K2). If the career gets no coaching bonus today
  (path not coach or level < 2), K1 still applies when `canWrinkle` (an HC/coordinator always has path coach, so this is moot).
  Also make sure the **live game** path (`startLiveSim`, ~line 695–709) calls `applyUserCoaching(career)` before simulating, if it doesn't already.

**UI — NEW `src/components/WrinkleCard.tsx` on `src/screens/GamePlanScreen.tsx`** (when `canWrinkle`):
"This week's wrinkle", showing 4 buttons per allowed side. Each shows the label, a one-line blurb, and its **current edge** as a chip (Fresh +1.0 / +0.6 / +0.3 / Scouted 0).
The selected one is highlighted. A footer reads "Opponents study film — rotate your wrinkles."

**Acceptance:** build + lint. The orchestrator checks that picking the same wrinkle 4 weeks running gives edges 1.0 → 0.6 → 0.3 → 0, that rotating keeps 1.0, and that `__simTest` (AI-only) is unchanged.

---

## K2 — Install plan (Y3–Y4)

In the **offseason**, a career with `installScheme` chooses an install for the coming season:
- **Lean** (`lean`): weeks 1–8 → +0.6, weeks 9+ → 0.
- **Full** (`full`): weeks 1–4 → −0.4, weeks 5–8 → +0.2, weeks 9+ → +0.8.
- None chosen → 0 all season.
It applies to the coordinator's `unitFocus` side, or to both sides for an HC / `'both'`.

**Types:** `CareerState.install?: { season: number; plan: 'lean' | 'full' }`. The plan is chosen in the offseason for `world.season + 1` and locks once chosen.
**Engine — NEW `src/game/engine/install.ts`:** `canInstall(world, career)` (`installScheme` + offseason + not chosen for next season), `installEdge(plan, week)`,
`installBonus(career, world): { off: number; def: number }` (applies when `install.season === world.season`).
**Shared clamp:** in `applyUserCoaching`, compute `extra = wrinkleBonus + installBonus` per side, clamp each side to **[−0.6, +1.5]**, and add it to `off`/`def`.
**Store:** `chooseInstall(plan)`, guarded.
**UI:** an `InstallCard` on GamePlanScreen in the offseason when `canInstall`, with two cards explaining the curves. During the season, show a small "Install: Lean — week 6 of 8 hot" status.

---

## K3 — Starter pitch (Y5–Y6)

A **Position Coach** (coach career with `developRoom` and **without** `callPlays`) can, **once per week**, pitch a starter on the Depth Chart for any position on their side
(`unitFocus` off → OFF positions, def → DEF positions, otherwise both). The coordinator decides:
- Pitched player P and current starter S at that position (`depthAt(...)[0]`). If P is already the starter, refuse ("He's already your starter.").
- If `P.ovr < S.ovr - 4`, refuse outright ("The coordinator won't bench a {S.ovr} for a {P.ovr}.").
- Otherwise the accept chance = `clamp(0.35 + career.reputation.leadership / 150 + (P.ovr - S.ovr) * 0.04, 0.1, 0.9)`,
  rolled with `makeRng(world.seed + world.season * 977 + world.week * 31 + hash32(P.id, 5))()`.
- Accepted → `setStarterInDepth(world, career.teamId, pos, P.id)`, then toast "Coordinator bought it: {P} starts at {pos}."
  Count accepted pitches this season in `career.pitches = { season, accepted }`. At season end, add `{ leadership: Math.min(3, accepted) }` to the rep delta.
- Rejected → toast "Coordinator passed: sticking with {S}."
- Either way, set `weekFlags.pitch = true` (one pitch per week).
**Engine — NEW `src/game/engine/pitch.ts`:** `canPitch(career)`, `pitchSide(career)`, `judgePitch(world, career, pos, playerId): { accepted: boolean; message: string } | { error: string }`.
**Store:** `pitchStarter(pos, playerId)`.
**UI (`src/screens/DepthChart.tsx`):** when `canPitch` and the card's position is on the pitch side, rows below the starter show a **Pitch** button (disabled after this week's pitch).
The read-only hint stays for other positions.

---

## K4 — Red flag (Y7–Y8)

Personnel rungs that can `rankBoard` or `setBoard` may **red-flag up to 2 prospects** per draft (the same Scouting class board Quick column as Conviction, with a 🚩 toggle).
A prospect can't be both Conviction and Red-flagged.
- Your club's simulated picks (`simUntilUser` for `career.teamId`) **skip** red-flagged prospects. If the user drafts one manually, toast a warning but allow it.
- When a red-flagged prospect is drafted by **another** club, push a ledger entry `{ kind: 'advice', redFlag: true, playerId: 'pl_' + id, accepted: true, note: 'Red flag: you took him off the board.' }`
  (mirror `logConvictionPicks`; dedupe by `prospectId`).
- **Grading (`ledger.ts` `gradeEntry`):** for `advice` entries with `redFlag`, after 2 NFL seasons, **hit = `p.ovr < 75`** (he busted, you were right), instead of the normal `>= 78`.
  Outcome texts: "Red flag held: {name} stalled at {ovr}." / "Red flag missed: {name} became a {ovr}."
- **Payout** at season end (same place as `convictionPayout`): each newly graded red-flag hit → `{ evaluation: 2 }`, each miss → `{ profile: -1 }`; cap evaluation at +3/season.

**Types:** `LedgerEntry.redFlag?: boolean`; `CareerState.redFlags?: { season: number; ids: string[] }`.
**Engine — NEW `src/game/engine/redflag.ts`:** `MAX_RED_FLAGS = 2`, `canRedFlag`, `redFlagIds`, `logRedFlags(world, career)`, `redFlagPayout(newly)`.
**Wiring:** `toggleRedFlag(prospectId)` store action (refuses if the prospect is in `convictionIds`; `toggleConviction` should likewise refuse red-flagged ones). Call `logRedFlags` wherever
`logConvictionPicks` is called. `bestAvailableFor` stays untouched: filter red-flagged ids out of the candidate list in `simUntilUser` for the user's club only, by passing a
filtered `gradeOf` that returns `-999` for red-flagged ids.
**UI:** the 🚩 toggle and a "Red flags n/2" chip on the Scouting class board; Ledger badges "Red flag" (warn) and "Red flag held" (win).

## Y9 — Docs
Append "L8 The staff room" (K1–K4, key files wrinkle.ts, install.ts, pitch.ts, redflag.ts and the cards) under Done in HANDOFF.md.

## PUSHES
**P1 = Y1–Y2** · **P2 = Y3–Y4** · **P3 = Y5–Y6** · **P4 = Y7–Y9**
After **every** task: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` → green, exactly 5 warnings. Never run `npm run dev` or any watch command. No git commands.

## DO NOT
- Do not change `coachEffect`, `userBonusFromSkills`, `ocEffect`'s structure, sim constants, reputation gates, objectives, capabilities/access, `bestAvailableFor`, or `evaluateTrade`.
- Do not let K1+K2 exceed [−0.6, +1.5] per side, and do not apply them to any club but the user's.
- Every new save field is optional. No new dependencies. Do not fix the baseline lint warnings. Do not reformat unrelated code. Do not edit any NEXT_PHASE*.md.

## Verification log
- **P1** (browser, NFL coordinator, offense): same wrinkle 5 weeks → 1.0 / 0.6 / 0.3 / 0 / 0; rotating 4 wrinkles stays 1.0 every week; history persists across weeks (8 kept);
  an offense coordinator can't pick a defensive wrinkle; the WrinkleCard renders on Game Plan with edge chips. `__simTest(150)` seed 33333: 22.9 pts / 67.6% / 3.33 sacks (AI-only, unchanged).
