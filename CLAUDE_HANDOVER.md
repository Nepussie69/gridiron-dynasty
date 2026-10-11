# Claude handover — Gridiron Dynasty (2026-10-11 ~20:15 AEDT, chat 3)

Read AGENTS.md first. Only ONE orchestrator chat at a time. Status to the user as a table: ✅ done · 🔄 running · ⏳ queued · ⏸️ on hold. Log every user request in PLAYTEST_BACKLOG.md.

## Goal
Orchestrate FUTURES + playtest fixes. Main thrusts: NFL-realistic 2.5D broadcast animation (BDB tracking data) and realistic play calling/matchups. DeepSeek implements engine/UI jobs (`~/gridiron-work/ds-wt <name> <abs prompt>`); Claude sub-agents do animation (Opus) and analysis/checks (Sonnet).

## Current state (main d7c4500; GitHub + Pages = 4929193, live index-BesHBYVF.js)
- Live this chat: SL1 sideline people/officials/chains, C3 blank-field fix, W2 weather engine (ON by default), save slots (5 slots, Load N on start screen), Clutch P2, round 6a (BDB motion, real accel caps, wide snap camera, ball-holder ring). Ratings audit PDF delivered: `RATINGS_BROADCAST_AUDIT.pdf` (untracked).
- **Claude sub-agents DIE on clear — check output, relaunch from brief if no result:**
  1. **Round 6b** (Opus) in `~/gridiron-work/wt/animflow` (synced to main cc0916a): 5 ratings-audit gaps + 6a leftovers + user addendum "2.5D speed/accel should feel like top view" (camera follow lag/dead-zone; both views share paths/clock, so it's presentation). Done when 'Round 6b' appears in `logs/animflow-report.out`. Brief: `prompts/animflow-round6b-audit.txt` (addenda at bottom). Tell relaunch to continue from uncommitted edits.
  2. **Separation targets** (Sonnet) → `logs/separation-targets.{json,out}`. Brief `prompts/separation-targets.txt`. J7 blocks on this file.
- **DeepSeek running** (survive the clear): **J7 matchups & busts** (USER PRIORITY) wt/realismj7, log `logs/realismj7.log`, verify `logs/j7-verify.out`, prompt `prompts/realism-j7.txt`. **J1** play calling wt/realismj1, log `logs/realismj1.log`.
- **W3a weather screens FINISHED, unreviewed:** wt/weatherw3a, `logs/weather-w3a-verify.out`. Review, commit in wt, merge, update `NEXT_PHASE_FUT_WEATHER.md` W3a row.

## Decisions and why
- J7 merges BEFORE J1 (user priority; both edit playsim.ts) — merge J7, then merge main into J1 / re-verify J1.
- W2 accepted with 3 single-band grazes ≤0.3 (pooled 6-seed drift −0.017). Clutch P2 accepted (pooled 0.000).
- Round 6 split: 6a done; 6b = audit gaps; 6c = original items 4–6 + J7's separation drawing/play-log in 2.5D; 6d = items 7–10.
- Push procedure only with the user's ok, one ok per push (user has said "push X" each time): build, lint 4, hex, contrast, check-broadcast, calib eq, secret scan, `git push origin main`, `zsh scripts/publish-pages.sh main`, confirm live index-*.js vs gh-pages index.html.

## Next steps
1. Check sub-agents (6b, separation targets); relaunch dead ones from briefs.
2. Review/merge W3a.
3. J7 lands: review j7-verify.out (OFF byte-identical, ON bands, targets table), merge, then sync J1.
4. 6b lands: review shots/metrics, merge (capture main calib before; cmp after), mark backlog rows.
5. Queue after: J2, J3, J5, J6 (prompts/realism-j*.txt), round 6c (+J7 visuals), 6d, Clutch P3/P5, C4, Halftime H1, W3b (MatchView weather chip).

## Gotchas
- check-broadcast needs `node --import ~/gridiron-work/loader.mjs --experimental-strip-types scripts/check-broadcast.ts` (56 checks). calib: `REPO=<tree> nice -n 15 node --import ~/gridiron-work/loader.mjs ~/gridiron-work/calib.mjs 33333 200 --eq`.
- Byte-identical check for animation merges: capture calib on main BEFORE merging, cmp after.
- Max 2 DeepSeek jobs, one calibration at a time (`while pgrep -f '/Users/aaron/.local/node/bin/nod[e] --import'`), one headless Chrome. Mac has 10 cores (4P+6E).
- Keep the chat lean: sub-agents for big reads; read only verify files and a couple of shots.
