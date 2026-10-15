# Claude handover — Gridiron Dynasty (2026-10-15 ~14:10 AEDT, chat 12)

Read AGENTS.md first. One orchestrator chat at a time. Status = ranked table with ETAs (✅ 🔄 ⏳ ⏸️). Log every user request/landing in PLAYTEST_BACKLOG.md (last row **462**). "push" / "push to live" = explicit ok for that one push (`git push origin main` + `zsh scripts/publish-pages.sh $(git rev-parse HEAD)`; verify live bundle strings with curl).

## Goal
NFL-realistic play where every effect comes from the individual players on the play (no averages, big AND symmetric elite-vs-poor spread), a realistic 2.5D broadcast, the FUTURES list in order, and the user's playtest fixes.

## Current state
- **Live = 2d4d039** (pushed this chat, row 450). **Local main ec47f7d is 14 commits ahead** (not pushed): FG "NO GOOD" fix 452, box-score tag width 453, futp2 P2 store 455, Trades view + pick clock in header 459, Now/Ceiling sortable 460, livetele merged 461, plus backlog rows. User plays on live (screenshots match live code).
- **check-broadcast on main** stops at `animflow 7a` (yac weave 88%) until animresid lands; with `CB_ONLY='^(?!animflow 7a)'` everything else passes (83).
- **Running DeepSeek** (6 — one over the 5 cap, load low; don't kill). Watch last `[push]` line in `~/gridiron-work/logs/<name>.log` and `<name>-verify.out` head:
  - **animresid** — check-broadcast fix + AMENDMENT (prompts/animresid.txt bottom): no post-catch stalls (stall probe `logs/animresid-stall-probe.mjs`; main 34.8% catches stall ≥0.4 s; its first FINAL made it worse 40.8% → NOT merged). Accept only if stall≥0.4s ≤5%, ≥1.0s = 0, start-to-3yd/s p90 ≤0.6 s AND check-broadcast 80/80+. wt-animresid already has a merge of main committed.
  - **speedgap** (prompts/realism-speedgap.txt): accept only if carrier AND defender speed targets pass (Hill ≥14.5 y/c, ≥20% 20+; 3×3 grid). Then tell the user the Hill numbers.
  - **qbrun** (row 446): QB carries only on sneak/QB draw/option keeps. ON bands slightly worse than main on ypc/missed-tackles (main already misses ypc on 2 seeds) — require pooled drift ≤0.1.
  - **targets** (row 451): target shares by position/role, concentration, RB checkdown catch%.
  - **gmpersona** (row 457): named GM per club, Staff Front Office "your boss".
  - **offseason90** (row 458): user roster up to 90 in offseason, cutdown day to 53 before week 1.
- **Queued**: draftreal (row 462, `logs/draftreal-queue.out` waiter → launch-when-slot).

## Decisions and why
- Merge one job at a time: commit in worktree, `git merge --no-edit main` there, resolve as UNION, build, lint 4, gate (`zsh ~/gridiron-work/gate20.sh <wt> <label>` for store/engine jobs; UI jobs: check-broadcast with CB_ONLY), then `git merge --no-edit wt-<name>` on main.
- **aircoh** follow-up (not yet written): completions where sim yards < air yards (57% of completions; NFL ~1%) and WR/TE depth swapped (WR aDOT 6.4 vs 10.7, TE 10.5 vs 6.4). Write + launch AFTER speedgap merges (same YAC code).
- Emergent plays P0 (`~/gridiron-work/prompts/emerp0.txt`) waits for animresid (same files).
- Review probe SIGNS and side effects, not just the gate (animresid's "hold" passed every gate but caused the stalls the user saw).

## Next steps
1. Handle job completions as the monitor reports them (re-arm a Monitor over the 7 names; `cont.sh <name> <ABS prompt>` when one ends DRAFT).
2. When animresid lands → confirm full check-broadcast PASS on main, then launch `~/gridiron-work/ds-wt emerp0 /Users/aaron/gridiron-work/prompts/emerp0.txt`.
3. When speedgap lands → write prompts/aircoh.txt (yards ≥ air on catches, air by the target's own route, YAC ≥0 except ~1%) and launch.
4. Then queue P3a/P3b playcalling UI (NEXT_PHASE_FUT_PLAYCALLING.md), H3 UI, T2 UI.
5. Backlog after that: T3/T4, #39–51, J10b throwaway 2.8% vs 9.1%, run ≤0 14.7% vs 17.8%.

## Gotchas
- DeepSeek ends early often (DRAFT/"IN PROGRESS" verify) → `~/gridiron-work/cont.sh <name> <ABS prompt>`. It writes "FINAL" atop DRAFT files — read first ~40 lines.
- Lint count: `npm run lint 2>&1 | grep -cE ': (warning|error) '` (= 4). Exporting a hook from a component file adds a warning → put hooks in a .ts file.
- Browser pane hidden ⇒ broadcast canvas renders black; use JS measurements, not screenshots.
- Don't chain `sleep` in Bash (blocked) — use run_in_background until-loops or Monitor.
- Keep this chat lean: grep verify files, don't cat logs.

## Key files
PLAYTEST_BACKLOG.md 446–462 · ~/gridiron-work/prompts/{animresid,realism-qbrun,realism-targets,livetele,gmpersona,offseason90,draftreal}.txt · ~/gridiron-work/scratch/{qbrun-probe,targets-probe,stall-probe}.mjs · ~/gridiron-work/analysis/{qbrun_nfl,targets_nfl,yac_neg_nfl}.py (+targets_nfl.json)
