# Claude handover — Gridiron Dynasty (2026-10-12 ~21:05 AEDT, chat 8)

Read AGENTS.md first. One orchestrator chat at a time. Status as a ranked table with **expected times** (✅ done · 🔄 running · ⏳ queued · ⏸️ on hold); "table green tick" = full table incl. ETAs, "check deepseek" = per-job status, "cores" = load + sims. Log every user request/landing in PLAYTEST_BACKLOG.md (last row 368). User: "keep going down the list".

## Goal
FUTURES + playtest fixes: NFL-realistic play where every effect comes from the individual players on the play (no team/unit averages; big elite-vs-poor spread) and a realistic 2.5D broadcast animation. DeepSeek implements engine/feature jobs (`~/gridiron-work/ds-wt <name> <abs prompt>`); Claude sub-agents: Opus for animation, Sonnet for reviews and (user-approved) J10a + QB cone.

## Current state (main local ahead of GitHub 345c798 — backlog/J3c/DF1/camlock commits; Pages = 345c798; 4173 held)
- Merged this chat: J2 4th-down, #29 fog polish, Round 8 part 1 (04f34fc: in-stride, J38 featured drawn, qbFooled, J36 steer, J3b catch point, forced OOB 59/68), J3c recentre (punts 4.42–4.57 still > 4.4 band — residual), #27 DF1 draft philosophy engine, camera lock 91c1b6f (fixed angle; setting gd.view.cameraAngle).
- **Claude agents running (die on clear → relaunch from briefs if no result):**
  - J10a on Sonnet, wt/j10s (c7ad535; final 3×500 done) → brief prompts/j10s-relaunch.txt. FINAL goes to logs/j10s-verify.out. Ignore logs/j10a-* (orphan DeepSeek session in wt/realismj10a still writes them).
  - Camera follow-up on Opus, wt/camlock: one sideline all game + tilt for kicks → prompts/camlock2-relaunch.txt.
  - Round 8 on Opus, wt/animflow: route speed + sprint gait + launch accel, then tackling + rest of OOB → prompts/anim8-relaunch.txt.
- **QB cone drawing built** (Sonnet, wt/qbcone f983cc4, off wt-j10s): merge right AFTER J10a merges.
- **DeepSeek running (relaunched ~20:22 with prompts/cont6-<name>.txt):** realismj13 (audibles re-verify on merged tree), realismj37 (QB–WR chemistry), fut15 (#15 injury decisions phase A), fut28 (#28 coordinators C1; engine probe 34/34). Waiter: `~/gridiron-work/wait-any.sh realismj13 realismj37 fut15 fut28` (background).

## Decisions and why
- Merge one at a time; keep both sides of conflicts (playsim.ts toggle blocks; outcome spreads `...j12Fields, ...scoutFields, ...j13Fields/visionFields`; `passDepth: passAir, passConceptDepth`). Stale-base job: commit WIP in worktree, `git merge main`, resolve, then relaunch a continuation.
- Accept: OFF byte-identical, eq 20/20, no band worse than main >0.2; a drift that IS the intended effect is OK. Never accept shrinking an individual effect to hit bands (J3c tried steerRate 0.03 → restored 0.14).
- check-broadcast failures after engine merges = presentation → animation round. Full check-broadcast currently aborts early at "DOUBLE shown 19/23" (animflow 6d) on main — pre-existing; new blocks are verified standalone.
- Push/Pages only on the user's explicit ok for that push (`git push origin main`; `zsh scripts/publish-pages.sh main`). Before push: build, lint 4, `calib.mjs 33333 20 --eq` = 20/20, secret scan.

## Next steps
1. Re-arm the DeepSeek waiter (above). Check the 3 Claude agents' results/commits; relaunch any that died from its brief.
2. J10a lands → review logs/j10s-verify.out → merge wt-j10s → gates → merge wt-qbcone → backlog row → `rm ~/gridiron-work/.j10s-live` if still there. Then launch J10b (prompts/realism-j10-stub.txt) and the anim round for audible/read visuals.
3. As DeepSeek jobs land: verify, commit in worktree, merge, gates, backlog. Then queued: realism-jind (prompts/realism-jind.txt — replace 13 relAvg unit averages; also fold in the punts residual), #52 WR reads (prompts/realism-j52.txt, after J10a + J37), phase 2 of #15/#27/#28 (specs NEXT_PHASE_FUT_*.md: B/C, DF2/DF3, C2/C3), J11, #7/#24/#26 (have specs), #39–51.
4. Keep ≤5 DeepSeek jobs; launch only when load < 8.

## Gotchas
- **Mass exits (exit 130 on all jobs at once)** happened 3× today. One cause was ds-push `stop_session` (interrupting one OpenCode session kills all) — now commented out in ~/.claude/bin/ds-push. 20:20 happened anyway (unknown cause). Relaunch with prompts/cont6-*.txt (generic continuation header + original brief).
- ds-push watchdog now IDLE 1800 s / HARD 5400 s (for new launches).
- Load control: calib-slot.sh = 3 slots at load < 8 (J10a priority via ~/gridiron-work/.j10s-live). **sim-governor.sh** (nohup, MAXRUN=5) SIGSTOPs node sims beyond 5, resumes oldest-first, j10s first (≤4), and keeps sims of dead jobs listed in ~/gridiron-work/.governor-dead paused. Stop it: `touch ~/gridiron-work/.governor-stop`. Restart after reboot if load is high. Claude may NOT kill DeepSeek's leftover node sims (classifier) — add their worktree to .governor-dead or give the user a pkill line.
- calib.mjs runs sometimes end without the EQUIVALENCE line (killed/paused) — re-run `calib.mjs 33333 20 --eq` alone.
- Relative paths in `git worktree add` resolve from the repo — always use absolute ~/gridiron-work/wt/<name>.
- Keep this chat lean: grep verify summaries, delegate reviews; chat 8 hit 280k.

## Key files
PLAYTEST_BACKLOG.md rows 348–368 · FUTURES.md (#52 WR reads, #53 = J10a) · ~/gridiron-work/prompts/ (relaunch briefs above, cont6-*, realism-jind, realism-j52, j10/j11 stubs) · ~/gridiron-work/logs/ (j10s-*, *-verify.out, animflow-report.out, sim-governor.log) · ~/gridiron-work/{calib-slot.sh, sim-governor.sh, wait-any.sh, ds-wt}
