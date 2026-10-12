# Claude handover — Gridiron Dynasty (2026-10-12 ~17:55 AEDT, chat 7)

Read AGENTS.md first. One orchestrator chat at a time. Status as a ranked table (✅ done · 🔄 running · ⏳ queued · ⏸️ on hold); "table green tick" = full table, "check deepseek"/"how is deepseek" = per-job status, "cores" = load + sims. Log every user request / landing in PLAYTEST_BACKLOG.md (last row 347). User: "time to finish everything on table" + "keep going down the list".

## Goal
FUTURES + playtest fixes: NFL-realistic play where every effect comes from the individual players on the play (no team/unit averages; big elite-vs-poor spread) and a realistic 2.5D broadcast animation. DeepSeek implements engine jobs (`~/gridiron-work/ds-wt <name> <abs prompt>`); Claude sub-agents do animation (Opus) and verify reviews (Sonnet).

## Current state (main 18b0cbe local; GitHub main 010c52e — pushed twice this chat with the user's ok; Pages still OLD f250fe3 — auto-mode blocked publish-pages.sh, needs the user's explicit ok; 4173 held)
- Merged this chat: J36 scouting reports (#36 ✅), Round 7a RB weave fix, J3b air yards + individual goal-line/missed-tackle (accepted points drift −0.27 = intended rush-TD drop), fix 625e9f1 (INT outcome kept J36 scoutFields), J38 featured plays (#38 ✅).
- Main gates after J38: build ✅, lint 4 ✅, hex ✅, contrast ✅, **check-broadcast ❌ "only 52/83 crossing / vertical catches made in stride"** (presentation; Round 8 item 0). Main calib post-J38 running → logs/main-calib-j38.out. Post-J3b calib (main-calib-j3b.out): eq 20/20; misses rush TD 0.95/0.93, punts 3.49, MT% 13.3, plays 65.3, YPC 4.07–4.14 → J3c.
- **DeepSeek running (survive the clear):** J3c recentre main after J3b+J36 (prompts/realism-j3c.txt) · J13 audibles cont4 pass-yards drift (+4.4) (cont4-realism-j13.txt) · J37 QB–WR chemistry / OL continuity mature-league check (cont-realism-j37.txt) · J2 4th-down re-verify on merged tree (cont4-realism-j2.txt) · J10a QB vision part 1 continuation (cont-realism-j10a.txt: broadcast ON fail, 1st-read 43.5%→52–60, checkdown air via passAir + QB spread, MT/YPA drift). Latest resume prompts: prompts/cont-funds-realism-j*.txt. Verify files logs/j<job>-verify.out (j3b = realism-j3b-verify.out).
- **Claude sub-agent running:** Opus Round 8 (prompts/anim8.txt, wt-animflow) — relaunch with that brief if "Round 8" missing from logs/animflow-report.out (it continues from wt-animflow commits).

## Decisions and why
- Merge one at a time; keep both sides of conflicts (toggle blocks at playsim.ts top; Play outcome lines keep `passDepth: passAir, passConceptDepth` + `...j12Fields, ...scoutFields, ...visionFields`). Check multi-line spreads by hand — a regex resolve missed the INT line once.
- Accept: OFF byte-identical, eq 20/20, no band worse than baseline by >0.2, pooled 6-seed drift ~±0.1 (points ±0.25; a drift that IS the intended fix is fine). Sonnet sub-agent reads each verify and returns MERGE/CONTINUE.
- Stale-base job: commit WIP in its worktree, `git merge main` there (resolve), THEN relaunch a continuation (never launch on a conflicted tree).
- check-broadcast failures after engine merges = presentation → animation round, don't block engine merges.

## Next steps
1. Re-arm waiter: `~/gridiron-work/wait-ds6.sh 3c 13 37 2 10a` (background; exits on the first to finish — re-arm for the rest).
2. As each lands: Sonnet review → commit in worktree → merge → gates → main calib (`zsh calib-slot.sh && REPO=<main> node --import ~/gridiron-work/loader.mjs ~/gridiron-work/calib.mjs 33333,2222,5150 500 --eq > logs/main-calib-<job>.out`) → backlog row → status table.
3. When J10a merges: write J10b (throw power/types bullet-normal-rainbow, pocket presence, pass styles — prompts/realism-j10-stub.txt) and J11 (realism-j11-stub.txt), launch both.
4. When J13 merges: animation round for audible/hot-route/slide visuals (anim8 pattern).
5. Pages publish only on the user's explicit ok: `zsh scripts/publish-pages.sh main`; git push only on ok (build, lint 4, eq, secret scan first).

## Gotchas
- opencode.ai outages and "Insufficient account funds" kill all jobs at once (log `errors:` line). Check `curl opencode.ai`; relaunch with a resume prompt naming the verify + briefs. Funds = user tops up (never you).
- DeepSeek often stops early while its calibs still run ("I'll be notified" is false) → continuation telling it to wait in the foreground.
- `pgrep -fl` on broad patterns dumps huge prompts — use `| wc -l`. No foreground `sleep` > short; use background waiters.
- Keep this chat lean: grep verify summaries, delegate reviews; chat 7 hit 200k.

## Key files
PLAYTEST_BACKLOG.md rows 339–347 · FUTURES.md (#36/#38 ✅; #37 in J37; next #39 hard counts…) · ~/gridiron-work/prompts/ (briefs above, anim8.txt, j10/j11 stubs) · ~/gridiron-work/logs/ (verify, main-calib-*, animflow-report.out) · ~/gridiron-work/wait-ds6.sh · ~/gridiron-work/calib-slot.sh
