# Claude handover — Gridiron Dynasty (2026-10-11 ~19:00 AEDT)

Read AGENTS.md first. Backlog rows 261–267 in `PLAYTEST_BACKLOG.md` are this chat's requests. Only ONE orchestrator chat at a time. Give the user status as a table with ✅ done · 🔄 running · ⏳ queued · ⏸️ on hold.

## Goal
Orchestrate the FUTURES queue and playtest fixes; main thrust is NFL-realistic play animation (tracking data) and realistic play calling. DeepSeek implements engine/UI jobs; Claude sub-agents do animation (Opus) and analysis/checks (Sonnet, `model: "sonnet"`).

## Current state (main 5e27073)
- Pushed with the user's ok: origin/main + Pages at 0acd31c (index-BzwGXlhm.js live). Since then 4 local commits (backlog + PRS column a511a69) NOT pushed. 4173 still HELD at 0f898f0.
- Merged this chat: C3 challenge UI, animflow round 4, Custom replays, PRS column in the box-score Defense table.
- **Claude sub-agents DIE when this chat clears — check and relaunch from the brief:**
  1. Animflow round 5 in `~/gridiron-work/wt/animflow` (uncommitted edits). Done when "Round 5" is in `logs/animflow-report.out`. Brief: `prompts/animflow-round5.txt` (items 1–6; returns first; item 6 = YAC/downfield fix).
  2. NFL motion v2 → `logs/nfl-motion-reference-v2.{out,json}`. Brief: `prompts/nfl-motion-v2.txt`.
  3. C3 blank-field check in `wt/c3fix` → `logs/c3-blankfield.out`. Brief: `prompts/c3-blankfield.txt`. (Demo showed the 2.5D field is blank ~3 s after any `__gdJump`; likely the cause.)
- DeepSeek running: **W2** weather (`wt/weatherw2`, weather-on calibration; OFF already identical 20/20 + all bands) → `logs/weather-w2-verify.out`; **FP3** Future classes UI (`wt/futureprospects3`) → `logs/fp3-verify.out`.
- A background quick calib (post-push check, 33333×200 --eq) may still be waiting behind W2; if it never reported, rerun: `nice -n 15 env REPO="$PWD" ~/.local/node/bin/node --import ~/gridiron-work/loader.mjs ~/gridiron-work/calib.mjs 33333 200 --eq`.
- Done data: CMU mocap 227 BVH in `~/gridiron-work/nfl-tracking/cmu_mocap/` (INDEX.csv); play-realism analysis `logs/play-realism.{out,json}`.

## Decisions and why
- Model split (memory `subagent-model-split`): Opus orchestrator + animation rounds; Sonnet for analysis/downloads/browser checks.
- Clutch P2 waits for W2 to merge (both edit playsim.ts; calibration baselines).
- Sim realism jobs J1–J6 (backlog 266) are calibrated sim jobs, one at a time after Clutch P2. J4 (YAC animation) folded into round 5.
- Round-4 global accel caps were reverted (TTT 2.53→4.13 s); round 5 item 5 retimes first.
- Kickoffs stay classic; presentation never changes recorded results.

## Next steps
1. Check/relaunch the 3 sub-agents above (Agent tool + brief file; round 5 on Opus, the others `model: "sonnet"`).
2. When W2 verify lands: review, merge (gates: build, lint exactly 4, check-hex, check-contrast, check-broadcast), update `NEXT_PHASE_FUT_WEATHER.md`; then launch Clutch P2: `~/gridiron-work/ds-wt clutchp2 ~/gridiron-work/prompts/clutch-p2.txt`.
3. FP3: review `logs/fp3-verify.out` + `logs/fp3-shots/`, merge, update `NEXT_PHASE_FUT_FUTUREPROSPECTS.md` FP3 row.
4. Round 5 lands: gates + strips, merge, then send round 6 = `prompts/animflow-round6.txt` (6a/6b/6c, all ten realism items, every tracking source).
5. Write DeepSeek briefs for J1 (down×distance×score×clock pass rate) … J6 from `logs/play-realism.out`; run after Clutch P2, one at a time.
6. Queue after: Clutch P3/P5, C4, Halftime H1, Weather W3 UI.

## Gotchas
- `window.__game` / `__gdJump` hooks are dev-only (use `main-check` vite 4436, not preview). Set `localStorage['gd.view.game']='broadcast'` for 2.5D; the pane resets to phone width at turn end — resize to 1280 first.
- Box score only counts plays up to the one on screen (`__gdJump(last)` first).
- Push procedure: build, lint 4, secret scan, `git push origin main`, `scripts/publish-pages.sh main`, confirm live `index-*.js`. Only with the user's ok, one ok per push.
- Keep the chat lean: sub-agents for big reads; only read verify files and strips.
