# Claude handover — Gridiron Dynasty (2026-10-15 ~13:30 AEDT, chat 11)

Read AGENTS.md first. One orchestrator chat at a time. Status = ranked table with ETAs (✅ 🔄 ⏳ ⏸️). Log every user request/landing in PLAYTEST_BACKLOG.md (last row **445**). "push to live" = explicit ok for that one push.

## Goal
NFL-realistic play where every effect comes from the individual players on the play (no averages, big AND symmetric elite-vs-poor spread — defenders count as much as the offence), a realistic 2.5D broadcast, the FUTURES list in order, and the user's playtest fixes.

## Current state
- **Live** = 2d4d039 (pushed 2026-10-15, row 450). Landed this chat: fapool 430, punts 432, ladder 433, J52 WR reads 435, fresh dice per kickoff 437 (orchestrator code: gameStore `rollDice`/`weekSeed`, `gameDay.seed`, `Game.diceSalt`; headless = salt 0), DF2 439, H1 439, P1 playcalling 442, H2 443, rosterfloor 444 (smokes now clean), T1 trick plays 445.
- **check-broadcast fails on main** (67/80, "drawn separation off the recorded one by 0.51 yd p75") — marginal animation checks flip when the play stream changes → **animresid** job is fixing the animation (never thresholds). Hold any push until it lands.
- **Running DeepSeek** (watch the LAST `[push]` line in `~/gridiron-work/logs/<name>.log` + `<name>-verify.out`):
  - **animresid** (prompts/animresid.txt) — continuation running.
  - **speedgap** (prompts/realism-speedgap.txt, logs/speedgap-verify.out) — Tyreek Hill/speed fix. AMENDED after launch (defender speed symmetric, 3×3 carrier×chaser grid): the running try may not have the amendment → if it ends without the defender targets, `cont.sh speedgap /Users/aaron/gridiron-work/prompts/realism-speedgap.txt` (the file now contains the amendment).
  - **futp2** (#26 P2 store, prompts/futp2.txt).
  - **futdf3** (#27 DF3 UI) — FINAL written, NOT yet reviewed/merged.
- Gate helper: `zsh ~/gridiron-work/gate20.sh <worktree> <label>` → logs/<label>-gate20.out (SIM 33333×20 vs `logs/dice-base-sim20.out` = main's sim, eq, smokes). Main's smokes are now CLEAN — any violation is new.

## Decisions and why
- User chose **fresh dice each kickoff** (row 436/437) and **phased emergent plays** (row 438): spec `NEXT_PHASE_EMERGENT.md` (FUTURES #54). P0 (move playLive/paceFor into engine) waits for animresid (same files); prompt ready: `~/gridiron-work/prompts/emerp0.txt`. Each E-phase ships OFF until its bands pass, then flips ON together with E1c (animation draws recorded paths).
- Merge one job at a time: commit in worktree, `git merge --no-edit main` there, resolve as UNION (keep both sides), build, lint 4, gate20, then merge to main. Accept: SIM byte-identical where claimed, eq 20/20, smokes no worse than main, bands no worse by >0.2 (pooled 6-seed drift for single-seed misses).
- Review probe SIGNS, not just gaps (T1 shipped a 20-pt "gap" in the wrong direction).

## Next steps
1. Review + merge **futdf3** (UI: needs a 375px/dark browser check via preview `main-check` after merge). Then queue **H3 UI** (#7) and **T2 UI** (#24) prompts (spec rows in NEXT_PHASE_FUT_HALFTIME.md / _TRICKPLAYS.md; template `prompts/_common-feature-tail.txt`, see futdf3.txt for UI wording).
2. When **animresid** lands: merge, confirm check-broadcast PASS on main, then launch `~/gridiron-work/ds-wt emerp0 /Users/aaron/gridiron-work/prompts/emerp0.txt`.
3. **speedgap**: accept only if carrier AND defender targets pass (Hill ≥14.5 y/c, ≥20% 20+; fast vs slow chaser symmetric; 3×3 grid). Then tell the user the Hill numbers.
4. **futp2** → then P3a/P3b UI.
5. Backlog after that: T3/T4, #39–51, J10b throwaway 2.8% vs NFL 9.1%, run ≤0 14.7% vs 17.8%.

## Gotchas
- DeepSeek often ends early (DRAFT verify) → `~/gridiron-work/cont.sh <name> <ABS prompt>`. It also writes "FINAL" atop DRAFT files — check first ~40 lines for DRAFT/PENDING.
- Monitor watcher in chat 11: grep verify heads + last `[push]` line; re-arm every 30 min.
- ≤5 DeepSeek jobs; queue extras with `nohup zsh ~/gridiron-work/launch-when-slot.sh <name> <ABS prompt> &!`.
- oxlint prints no "problems" line: count lint with `npm run lint 2>&1 | grep -cE ': (warning|error) '` (= 4).
- Stopped 2-day-old orphan sims (T state) hold ~0.1 GB total — harmless, ignore.
- Keep this chat lean: grep verify files, don't cat logs.

## Key files
PLAYTEST_BACKLOG.md 430–445 · NEXT_PHASE_EMERGENT.md · NEXT_PHASE_FUT_{HALFTIME,TRICKPLAYS,PLAYCALLING,DRAFTPHILOSOPHY}.md (progress rows updated) · FUTURES.md (#54 added) · ~/gridiron-work/prompts/ · ~/gridiron-work/scratch/{speed-probe,weave-probe,smoke-cap,replay-probe}.mjs
