# Claude handover — Gridiron Dynasty (2026-10-11 ~21:00 AEDT, chat 4)

Read AGENTS.md first. One orchestrator chat at a time. Status to the user as a ranked table: ✅ done · 🔄 running · ⏳ queued · ⏸️ on hold. Log every user request in PLAYTEST_BACKLOG.md (last row 295).

## Goal
Orchestrate FUTURES + playtest fixes: NFL-realistic play (individual ratings decide everything — user rule, no team averages/medians) and a realistic 2.5D broadcast animation. DeepSeek implements engine/UI jobs (`~/gridiron-work/ds-wt <name> <abs prompt>`; reuses an existing worktree); Claude sub-agents do animation (Opus) and analysis (Sonnet).

## Current state (main 5ebfbc0+; GitHub + Pages = f250fe3, live index-CZn3xh5R.js)
- This chat merged: W3a weather screens, Round 6b (sim ratings in animation, real on-field 11, fatigue, moves/tackles), Round 6b-wx (weather on field, 2.5D speed feel, own-goal camera bug) — 6b-wx merged AFTER the push (not on GitHub yet). Post-merge calib check: `~/gridiron-work/logs/r6bwx-merge-cmp.out` must say CALIB-IDENTICAL (compares vs r6b-merge-calib-after.out).
- **DeepSeek running (survive the clear):** J7 matchups & busts (USER PRIORITY, relaunched with `prompts/realism-j7-cont.txt`, wt/realismj7, log logs/realismj7.log, verify logs/j7-verify.out). J1 situational pass rate (try 2 after watchdog, wt/realismj1, verify logs/realism-j1-verify.out). J1 so far: probe fails 28→8, OFF byte-identical, drift pooled points +0.45 (toward target 22.6) — main itself fails 4 bands on one seed; likely accept if bands pooled pass.
- **Claude sub-agent running (DIES on clear — relaunch from brief):** Round 6c-shed (Opus) in wt/animflow (ff'd to b242612) — brief `~/gridiron-work/prompts/anim6c-shed.txt`; done when "Round 6c-shed" appears in logs/animflow-report.out. Tell relaunch to continue from uncommitted edits. Chrome shared via `~/gridiron-work/chrome-lock.sh`.
- Analysis done: logs/separation-targets.{out,json} (+ key speed_accel), speed-separation-targets.*, chase-targets.*, individual-ratings-audit.out (~43 averaged sites).

## Decisions and why
- Merge order on playsim.ts (one at a time): J7 → sync+merge J1 → J8a (run D + chase-downs) → J8b (rush/protection) → J8c (coverage beyond J7; must REPLACE J7's leftover cbMcv averages) → J8d (ST/penalties/fast sim + punting, backlog 294) → J9 coach sub-ratings (FUTURES #32) → #33–#35. Prompts ready: `prompts/realism-j8{a,b,c,d}-full.txt` (j8-common.txt has the user's no-averages / big-spread rule).
- Non-sim FUTURES (#46, #49, #50) can use the free DeepSeek slot in parallel.
- J7 review: its MatchView coverNote sits between drivesOf's doc comment and drivesOf — move it at merge. statAlloc fast path not covered (J8d).
- Round 6c (queued after 6c-shed): original round-6 items 4–6 + J7 separation drawing in 2.5D + under-centre/shotgun/pistol snaps, drops, play-action, scrambles (backlog 295). 6d = items 7–10.
- Push procedure only with the user's ok per push: build, lint 4, hex, contrast, check-broadcast, calib 33333 200 --eq, secret scan, `git push origin main`, `zsh scripts/publish-pages.sh main`, confirm live index-*.js == `git show origin/gh-pages:index.html` (fetch first!).

## Next steps
1. Check `logs/r6bwx-merge-cmp.out` (CALIB-IDENTICAL). Check whether 6c-shed is alive (report section / worktree edits); relaunch from brief if dead.
2. Check J7/J1 (`tail logs/realismj7.log logs/realismj1.log`; event summaries via python over logs/events/<name>.try*.jsonl). If a DeepSeek client exits early without a verify file, relaunch with a CONTINUATION prompt via ds-wt (same name).
3. J7 lands: review j7-verify.out (OFF identical, bands, targets incl. elite-vs-poor comp% spread ≥ 62–86), merge, then merge main into wt-realismj1, re-verify, merge J1.
4. Launch J8a (`./ds-wt realismj8a ~/gridiron-work/prompts/realism-j8a-full.txt`), plus a non-sim FUTURES job in the second slot.
5. 6c-shed lands: review shots, merge (calib before/after cmp), then launch round 6c.

## Gotchas
- check-broadcast: `node --import ~/gridiron-work/loader.mjs --experimental-strip-types scripts/check-broadcast.ts` (63 checks). Calib: `REPO=<tree> nice -n 15 node --import ~/gridiron-work/loader.mjs ~/gridiron-work/calib.mjs 33333 200 --eq`.
- Max 2 DeepSeek jobs, one calibration at a time (`while pgrep -f '/Users/aaron/.local/node/bin/nod[e] --import'`), one headless Chrome (lock). ds-push watchdog kills at 2700 s and retries.
- Merging animation branches: expect conflicts in MatchView/liveView/check-broadcast — keep both sides.
- Keep the chat lean: sub-agents for big reads; read only verify files and a couple of shots.
