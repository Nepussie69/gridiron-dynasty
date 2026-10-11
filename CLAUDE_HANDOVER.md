# Claude handover — Gridiron Dynasty (2026-10-12 ~04:10 AEDT, chat 6)

Read AGENTS.md first. One orchestrator chat at a time. Status to the user as a ranked table (✅ done · 🔄 running · ⏳ queued · ⏸️ on hold); "table green tick"/"table green" = full update table, "check deepseek" = per-job status. Log every user request / landing in PLAYTEST_BACKLOG.md (last row 338).

## Goal
FUTURES + playtest fixes: NFL-realistic play where every effect comes from the individual players on the play (user rule: no team/unit averages; big elite-vs-poor spread) and a realistic 2.5D broadcast animation. DeepSeek implements engine jobs (`~/gridiron-work/ds-wt <name> <abs prompt>`); Claude sub-agents do animation (Opus) and analysis/review (Sonnet).

## Current state (main 4e8de3a; GitHub/Pages still f250fe3 — nothing pushed; 4173 held)
- Merged this chat: J8a, J8a-2, J8b, J8c, J8d (all individual-ratings rounds), J9 coach sub-ratings engine + Staff UI (FUTURES #32 ✅), J12 coverage disguise + game plan vs individuals (#34/#35 ✅), J6 kneels/spikes/OOB 10.9%/man 36% (scrambles kept OFF), Round 6c + 6d animation. Main gates ALL ✅: build, lint 4, hex, contrast, check-broadcast 70/70.
- Main calib (logs/main-calib-j8a.out; post-J6 one queued → logs/main-calib-j6.out): eq 20/20; remaining misses Rushing TD 0.94–0.97 (≤0.92) and Missed tackles 6.85–6.88 (≥7) on 2 seeds.
- **DeepSeek running (survive the clear):**
  - J3b (wt/realismj3b, brief prompts/realism-j3b.txt, log logs/realismj3b.log, verify logs/realism-j3b-verify.out): J3 redone on current main — port air-yards model (old diff logs/j3-old.diff) + fix rush TD / missed tackles via individual goal-line and tackler reps. Old wt-realismj3 is abandoned.
  - J13 try 2 (wt/realismj13, FUTURES #33 pre-snap reads & audibles, prompts/realism-j13.txt + cont2-realism-j13.txt, verify logs/j13-verify.out — a "DRAFT" header = not final).
- No Claude sub-agents running.

## Decisions and why
- Merge one job at a time; keep both sides of conflicts (toggle blocks at playsim.ts top; when two jobs edit the same expression, take HEAD's line and add the new job's term — e.g. run `const edge` keeps J8a/J8a-2 terms + J12 `- spyQbRun`; finishTackler = J8c pick if on, else J8a, else uniform).
- Accept: OFF byte-identical, eq 20/20, no band worse than baseline by >0.2, single-seed misses with pooled 6-seed drift ~±0.1 (points ±0.25 with SE ≥0.2 tolerated as noise), LARGE individual spread. Use a Sonnet sub-agent to read verify files and return verdicts (keeps this chat lean).
- Stale-base job that gives up: either commit WIP + `git merge main` into its worktree and relaunch with a continuation, or (if conflicts are heavy) save its diff and relaunch fresh off main (J3 → J3b).
- check-broadcast failures after engine merges are presentation (camera/shed checks are stream-sensitive) → hand to an Opus animation round, don't block engine merges.

## Next steps
1. Re-arm waiters: `~/gridiron-work/wait-ds6.sh 3b` and `~/gridiron-work/wait-ds6.sh 13` (background).
2. As each lands: Sonnet review of verify → commit in worktree → merge → gates (build, lint 4, hex, contrast, broadcast) → queue main calib (`zsh calib-slot.sh && REPO=<main> node --import ~/gridiron-work/loader.mjs calib.mjs 33333,2222,5150 500 --eq > logs/main-calib-<job>.out`).
3. After J3b merges: re-verify parked J2 4th-down (wt-realismj2, 6dcb33f) on main; then write the full J10 brief from prompts/realism-j10-stub.txt + j8-common.txt (QB vision cone/progressions/checkdowns/placement circle/throw power/pocket presence), then J11 (stub) after J10.
4. Free DeepSeek slots (max 7): next FUTURES #36 scouting reports (needs J9+J12, both in), then #37+ in FUTURES order.
5. Next animation round (Opus, brief pattern prompts/anim6d.txt): J13 audible/hot-route/slide visuals, J12 "QB fooled" visual, return TDs crossing the goal line (needs an engine-side probe allowance), maxFrameDelta 8.6 on seed 44444 (late pursuit on long runs).

## Gotchas
- DeepSeek often ends its turn early or hits the 45-min hard timeout: every brief needs STEP 0 "write a DRAFT verify first" + WAITING RULES (≤8-min foreground chunks). Relaunch with a short CONTINUATION prompt naming exactly what is left.
- A job's verify written after its wrapper died = orphan OpenCode session still editing (J3 did this). Check `pgrep -f 'ds-push-<name> '` and the worktree mtimes before merging.
- `git stash` is shared across worktrees; jobs must never stash/checkout/reset. Use `pgrep -f … | wc -l`, never `pgrep -fl` on broad patterns.
- zsh: `grep --include=*.ts` fails (glob) — use plain `grep -rn … src`.
- Keep the chat lean: grep verify summaries, delegate reviews to Sonnet; this chat hit 235k tokens.

## Key files
PLAYTEST_BACKLOG.md rows 323–338 (this chat) · FUTURES.md (#32/#34/#35 ✅) · ~/gridiron-work/prompts/ (briefs: realism-j3b, realism-j13, anim6d, j8-common, realism-j10-stub, realism-j11-stub) · ~/gridiron-work/logs/ (verify, main-calib-*, animflow-report.out) · ~/gridiron-work/wait-ds6.sh (waiter: args = job suffixes) · ~/gridiron-work/calib-slot.sh
