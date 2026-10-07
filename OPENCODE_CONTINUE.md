# Continue in OpenCode (DeepSeek Flash 4.1) — start here

_Written 2026-10-06 ~21:55 by Claude Opus 5.5, because Claude's plan usage is nearly used up. Full background: `ORCHESTRATION_HANDOVER.md`._

## You are the orchestrator now
You plan, verify and commit. You can implement small pushes yourself, or delegate a push to a separate Flash run with `~/.claude/bin/ds-push <prompt-file> <label>`
(it needs a long bash timeout of 45+ min; it already redirects stdin from `/dev/null`, which fixed the "startup hang").

## State right now (check with `git log --oneline -5` and `git status`)
| Phase | Status |
|---|---|
| L5–L9 | ✅ all committed |
| L9.5 P1 (R1 game-plan wiring bug, R2 one side per plan) | ✅ `e5dba86` |
| L9.5 P2 (R3 team ratings, R4 box scores) | ✅ `7842153` |
| L9.5 P3 (R5 staff role tabs, R6 staff budget, R7 sortable roster, R8 Fit fix for defenders) | ✅ committed (Claude verified it in the browser on 2026-10-07) |
| **L10 Game day** (`NEXT_PHASE_L10.md`, 5 pushes) | ✅ all committed |
| **L11 In-season roster life** (`NEXT_PHASE_L11.md`, 2 pushes) | ✅ all committed |
| **L11.5 Playtest 3** (`NEXT_PHASE_L11_5.md`, 4 pushes) | **P1 ✅ `05c6b96`; P2 running with Flash (started 2026-10-07 ~20:23 AEDT); P3, P4 not sent.** Check the spec's progress table and `git log` |

## Step 1: done
L9.5 is complete and committed. Nothing is waiting for review.

## Next
- **Continue L11.5** (the user asked for all pushes to be sent and verified, then to be told when done):
  1. If `git status` shows uncommitted `src/` changes and no `opencode-cli run` process is active, the running push (P2) finished: verify it (build, lint 5, diff vs the spec; browser checks via console snippets for the user:
     `__gameDayEquivalence(20)` n/n, `__simTest(200,'NFL')` unchanged ~23.8 pts after the real ratings load, `__planMatrix` with 500+ games for the new presets (Flash flagged Press Man as dominant)), update the spec's progress table +
     verification log, commit.
  2. Send the next push with `~/.claude/bin/ds-push <prompt> <label>`. Prompt = "You are the IMPLEMENTER … active spec NEXT_PHASE_L11_5.md … Implement ONLY push Pn = tasks …" (same template as earlier pushes;
     P2 = Q4, Q5, Q6 · P3 = Q7, Q8, Q9, Q10, Q12, Q13, Q14 · P4 = Q11; HANDOFF.md append-only in P4 only). Verify and commit each. For `__planMatrix` balance calls use 500+ games.
  3. When P4 is committed, tell the user L11.5 is done.
- Verification gotchas: wait for real data before `__simTest`; use 500+ games for balance comparisons (see `ORCHESTRATION_HANDOVER.md` §2).

## Guardrails (unchanged)
No changes to reputation gates, objectives, capabilities, sim constants, `evaluateTrade` or contract pricing without the user's OK. Rewards ≤ +3 per dimension per feature per season.
Every new save field is optional. No new dependencies. Commit after every verified push, and give the user a status table at the end of each push.
