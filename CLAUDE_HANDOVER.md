# Claude handover — Gridiron Dynasty (2026-10-11 ~23:30 AEDT, chat 5)

Read AGENTS.md first. One orchestrator chat at a time. Status to the user as a ranked table (✅ done · 🔄 running · ⏳ queued · ⏸️ on hold); the user asks "table green tick" = full update-list table, "check deepseek" = per-job status. Log every user request in PLAYTEST_BACKLOG.md (last row 322).

## Goal
FUTURES + playtest fixes: NFL-realistic play where every effect comes from the individual players on the play (user rule: no team/unit averages; team results EMERGE from individual reps) and a realistic 2.5D broadcast animation. DeepSeek implements engine jobs (`~/gridiron-work/ds-wt <name> <abs prompt>`); Claude sub-agents do animation (Opus) and analysis (Sonnet).

## Current state (main 37a26c9 + backlog commits; GitHub/Pages still f250fe3 — nothing pushed this chat)
- Merged this chat: 6b-wx calib check (identical), fix296 punt-return TD direction, J1 + J1-fix situational pass rate, J7 matchups & busts, J5 formations/personnel/motion (shotgun 64%), Round 6c-shed (sheds + camera goal-line bug). Main gates: build, lint 4, hex, broadcast 64/64.
- **DeepSeek running (survive the clear):** J3 (cont4 retune: first downs/3rd%/RZ TD%/rush TD over bands), J6 (try 2), J8a (try 3), J8b, J8c, J8d — worktrees wt/realismj{3,6,8a,8b,8c,8d}, logs logs/realismj*.log, verify files logs/realism-j3/j6-verify.out, logs/j8{a,b,c,d}-verify.out (or realism-j8*-verify.out). A verify with "IN PROGRESS" or "WORKTREE COLLISION" is not final.
- **Claude sub-agent running (DIES on clear — relaunch):** Round 6c (Opus) in wt/animflow — brief `~/gridiron-work/prompts/anim6c.txt`; done when a "Round 6c" section (not 6c-shed) is in logs/animflow-report.out.
- Parked: J2 4th-down (wt-realismj2 commit 6dcb33f): go-rate targets met but FG att/punts over band tops; re-verify after J3 merges (J3 adds conversions, J2 adds kicks — may cancel).
- Post-merge calib of main (J7+J5) never got a slot: run `REPO=<main> calib.mjs 33333,2222,5150 500 --eq` → logs/main-calib-37a.out.
- Analysis done: logs/read-order-targets.{out,json} (QB reads, pressure, throw speed), logs/position-targets.{out,json} (all positions; pressure = union of individual reps; real-starter spreads narrow but user's big-spread rule wins).

## Decisions and why
- Merge one job at a time onto main, re-run gates + calib; keep both sides of conflicts (toggle blocks at playsim.ts top). Accept a job if bands hold pooled over 3 seeds and none worse than baseline by >0.2.
- Queue after J8a–d: J8a-2 (stub prompts/realism-j8a2-stub.txt), J10 QB vision cone/progressions/checkdowns/placement circle/throw power/rainbow-bullet/pocket presence (stub prompts/realism-j10-stub.txt; after J3 + J8b), J11 RB/WR/TE vision + catch radius (stub prompts/realism-j11-stub.txt; after J10), J9 coach sub-ratings. Cone = BIGGER for accurate/aware QBs; inaccuracy shown by a separate placement circle.
- Limits (user-set): up to 7 DeepSeek jobs, `~/gridiron-work/calib-slot.sh` = 5 sims, load < 10, mkdir lock.
- Push only with the user's explicit ok (procedure in ORCHESTRATION_HANDOVER.md / previous handover: build, lint 4, hex, contrast, broadcast, calib --eq, secret scan, git push origin main, publish-pages.sh, confirm live index-*.js).

## Next steps
1. Relaunch Round 6c Opus agent from `prompts/anim6c.txt` (check wt/animflow `git log`/status first).
2. Re-arm a background waiter for the six verify files / wrapper exits (`pgrep -f 'ds-push-realismj(3|6|8a|8b|8c|8d) '`).
3. As each lands: read verify (gates, OFF byte-identical, bands, individual spread), `git diff --stat` for foreign edits (J3 and J8a had orphan co-editors), commit in its worktree, merge, gates, calib on main.
4. After J3 merges: re-verify J2 on main. Then launch J8a-2 / J10 (write full briefs from stubs + j8-common.txt).

## Gotchas
- DeepSeek ends its turn "waiting / I'll be notified" → client exits; foreground waits >600 s trip the idle watchdog. Every brief needs WAITING RULES (prompts/j8-common.txt). Relaunch with a CONTINUATION prompt (prompts/cont*-realism-*.txt pattern).
- Orphan OpenCode sessions keep editing worktrees after a client dies. Interrupting them (`opencode-cli api POST /api/session/<id>/interrupt`) seemed to kill ALL live clients at 22:24 — only do it when nothing else runs, then relaunch everyone.
- `git stash` is shared across worktrees; tell jobs never to stash/checkout/reset. `pgrep -fl` on broad patterns dumps whole prompts — use `pgrep -f … | wc -l` or `lsof -a -p PID -d cwd`.
- check-broadcast: `node --import ~/gridiron-work/loader.mjs --experimental-strip-types scripts/check-broadcast.ts`.
- Keep the chat lean: sub-agents for big reads; read only verify summaries (grep), never whole event logs.

## Key files
PLAYTEST_BACKLOG.md — every request (rows 296–322 this chat) · ~/gridiron-work/prompts/ — briefs, stubs, anim6c-queue.txt · ~/gridiron-work/logs/ — verify files, calib outputs, targets · ~/gridiron-work/calib-slot.sh — shared sim slots
