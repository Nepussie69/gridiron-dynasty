# NEXT PHASE — L12.11 "You grow too: skill points" (user request, 2026-10-08)

_Planned by Claude Opus 5.5. Implemented by DeepSeek Flash 4.1 in one push. Lint baseline: exactly 4 warnings._

User's words: "every year, based on the goals you hit or accomplishments, get +2 skills or something to add, and make sure these skills grow you as a player."

## Found in code
`career.skills` (`career.ts` `Skills`): evaluation, negotiation, leadership, scheme, recruiting (start `ZERO_SKILLS` 20/15/15/15/15). Growth today: season review `skillDelta` (leadership +1/+3 from wins), scouting accuracy (+2/+4
evaluation), passive gains (L12.9). **Used today:** evaluation (prospect read width, draft/department), scheme + leadership (`userBonusFromSkills`: game edge, development, situational). **Not used at all:** negotiation, recruiting.

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| P1 | Skill points earned each season from goals and accomplishments | P1 | ✅ done — verified (P1) |
| P2 | Spend them: a Skills panel (My Career) with what each point does | P1 | ✅ done — verified (P1) |
| P3 | Every skill does something real (wire negotiation + rename/wire recruiting) | P1 | ✅ done — verified (P1) |
| P4 | Probe: pacing unchanged within ±1 season; effect sizes bounded | P1 | ✅ done — verified (P1) |

## P1 — Earning points (season end, in the season review)
- +2 for each job objective met (`objectives.ts`), +1 for each personal ambition met (`gradeAmbitions`), +1 winning record, +1 playoffs, +2 title, +1 per staff award (`staffAwards`), +1 season question answered "yes",
  +1 Ledger success rate ≥ 60% with ≥ 5 graded calls this season. Cap 8 per season. Shown in the season summary modal ("You earned 5 skill points: 2 objectives, playoffs, …").
- Stored as optional `career.skillPoints?: number` (unspent) and `career.skillLog?: { season; earned; reasons: string[] }[]`.

## P2 — Spending
- My Career → **Skills** card: each skill with its current value (0–99), a ＋ button (1 point = +2 skill, max 99), and a plain line of what it does now and at the next level (computed from the real formulas, e.g.
  "Scheme 62: +1.1 offensive edge per snap → 64: +1.2"). Points can be spent any time; unspent points carry over.
- Rung relevance: a skill your current rung can't use is shown greyed with "used from <rung>" so points aren't wasted blindly (still allowed).

## P3 — Every skill matters (small, bounded effects; user-side only)
- **Evaluation** (today): tighter prospect reads + department grade. Unchanged.
- **Scheme** (today): user coaching edge. Unchanged formula.
- **Leadership** (today): edge, player development, situational. Also: +morale recovery for your players, and culture score (`cultureScore`) +0..4.
- **Negotiation** (new): contract talks — extension and FA asks for your club × (1 − 0.06 × (negotiation − 40)/59) clamped to [0.97, 1.0]… i.e. at most 3% cheaper at 99, never more expensive; AI trade partners accept
  deals within an extra (negotiation − 40)/59 × 2% of value. **This touches contract pricing / trade acceptance for the user only — the user asked for skills to matter (2026-10-08); keep it this small and user-only.**
- **Recruiting** → rename to **Player Development** in the UI (keep the save key `recruiting`): young players on your club grow faster: `developPlayers` growth × (1 + (skill − 40)/59 × 0.08) for your club only.
- Every effect is relative to 40 (a starting coach is ~neutral), uses no rng, and AI clubs are unaffected.

## P4 — Probe
`__skillProbe()`: run `balanceProbe(10)` on seeds 20261004/2222/33333/5150/777 with a policy that spends points evenly; pacing personnel → GM and coach → HC within ±1 season of today; print each skill's effect at 40/70/99.
`careerSmoke(4,'coach')` and `(4,'personnel')` 0/0; `gameDayEquivalence(20)` 20/20 (user bonuses don't affect AI-vs-AI); `simTest` unchanged.

## DO NOT
No rng draws added/removed; no changes to gates, objectives (only read their results), capabilities, AI-vs-AI calibration. Optional save fields only. Canonical player objects. No new dependencies. No temp files in the repo.
Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`, `PLAYTEST_BACKLOG.md`. No git commands.

## Verification log
- **P1** (Flash 18 min, worktree; verified + merged by Claude). Pacing delta 0 on every seed that reaches the top rung; effects at 99: negotiation 3% cheaper asks / +2% trade margin (user only), development ×1.08, leadership +4 culture/morale. Equivalence 20/20, smokes 0/0, calibration unchanged.
