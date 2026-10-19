# Claude handover — Gridiron Dynasty (2026-10-19 ~19:30 AEDT, end of chat 14)

Read AGENTS.md first. One orchestrator chat at a time. Status = ranked table (✅ 🔄 ⏳ ⏸️); "table green tick" = that table; "cores" = CPU/load/sims. Log every user request/landing in PLAYTEST_BACKLOG.md (last row **534**). "push" = ok for that one push.

## Goal
NFL-realistic play decided by the individual players on the field + work down FUTURES.md + playtest fixes. User said (10-18): keep ~5 jobs running down the list, merge as they pass, push only when they say. User plays the live site.

## State
- **Live = main 7f075b6** (root AND /beta/ both built from it; every emergent layer ON). Main now **8f70d47** = live + fut39 (not pushed).
- Landed this chat: emerjoint (joint emergent ON + E1c + RZ compression), e1goal, statcredit+rushvar, seamfix, fut44 (#44+#51), fut45, fut2, fut27, fut48, futt3+futt4 (#24 done), fut42, fut39, r2fumbles (ON), r2aicalls (ON), r2penalties (OFF), r2returns (OFF). FUTURES: 50 rows ✅; left #33 audibles (after r2presnap), #30/#31 (big specs).
- **DeepSeek: OUT OF FUNDS since 10-19 16:47.** Queues are STOPPED (I killed queue-r2.sh / queue-fut.sh / relaunch-wait.sh). Resume list: ~/gridiron-work/logs/RESUME-QUEUES.txt (r2presnap, r2placement, r2kickers, r2rotation, r2injury relaunch via `cont.sh <name> prompts/<name>.txt` + autocont; never-launched r2clock; fut33 after r2presnap merges).
- **Sonnet agents in flight (die on clear — relaunch from these briefs if no result):** rbgoal = user report "the rb didnt running into the endzone" (prompts/relaunch-rbgoal-claude.txt, worktree wt/rbgoal); e1lane = RB alignment (prompts/relaunch-e1lane-claude.txt). Both are told: commit/verify in their worktree, no merge.
- **User decisions pending:** turn ON r2penalties (EMERGENT_PEN.on; pooled penalty-yd drift −0.18 vs cap 0.1, se 0.23) and r2returns (R2RET.on; ON trips 2 camera checks, its ON 3x500 was running: logs/r2returns-calib*/r2ret-on500.out); road/home false-start gap only 1.06x (fut39).
- **Follow-ups queued (not launched):** joint recalibration (ypc 3.95–4.10 vs floor 4.15, missed tackle % 13.3 vs 13 — league-wide, pre-existing); LB tackles p99 20 (field pursuit); QB share of fumbles 31% vs NFL 46%; RZ YAC 1.65 vs 3.18; anim probe 853/854 one play.

## Merge rule
`set -o pipefail`; commit in wt (message starts `<job>:`); `git merge main` in wt; stop on conflicts (resolve UNION, keep the stricter check); build; lint 4; `zsh ~/gridiron-work/mergegate.sh <job>` (check-broadcast + calib 33333 20 --eq vs logs/main-sim20.out); for sim jobs also scripts/e1-check-broadcast-on.ts; merge into main; refresh logs/main-sim20.out when main's sim changes; backlog row + FUTURES tick. Combination failures after merging main are common (stream shifts expose drawing edge cases) — fix the drawing, never loosen.
Push: `git push origin main`, then build main twice into one gh-pages tree (root `--base=/gridiron-dynasty/`, `beta/` `--base=/gridiron-dynasty/beta/`), force-push gh-pages, verify both index bundles served.

## Gotchas
- Reject: score/box caps, hash relabeling of credit, loosened checks, out-of-scope hacks (all happened this chat).
- `~/gridiron-work/sim-governor.sh` SIGSTOPs sims beyond MAXRUN and forever for worktree names in `.governor-dead` — check before naming a job.
- Waiter loops: `pgrep -f '<pattern>'` matches its own command line — use a `[m]ergegate` bracket trick.
- Never AskUserQuestion while the user is away: it blocks the session cron (lost 23:55–16:00 on 10-18/19).
- Session cron (:04/:19/:34/:49 check) and Monitors die with the chat — re-create both in the new chat.
- Prompts from ~/gridiron-work/mkfut.zsh; Sonnet fallback template prompts/fallback-template.txt.

## Next
1. Wait for / relaunch rbgoal (user's live bug) → merge → offer a push.
2. e1lane result → merge (expect conflicts with main's emergent changes).
3. When the user tops up DeepSeek: restart from RESUME-QUEUES.txt, restart queues, then fut33, r2clock, joint recalibration.
