# Claude handover — Gridiron Dynasty (2026-10-11 ~19:00 AEDT, chat 2)

Read AGENTS.md first. Backlog rows 268–270 are this chat's new requests. Only ONE orchestrator chat at a time. Status to the user as a table: ✅ done · 🔄 running · ⏳ queued · ⏸️ on hold.

## Goal
Orchestrate the FUTURES queue and playtest fixes; main thrust is NFL-realistic play animation (tracking data) and realistic play calling. DeepSeek implements engine/UI jobs; Claude sub-agents do animation (Opus) and analysis/checks (Sonnet, `model: "sonnet"`).

## Chat 3 (2026-10-11 19:00)
- BDB 2021 verified + unzipped to `~/gridiron-work/nfl-tracking/bdb/2021` (week1–17.csv). Round 6 prompt updated with BDB 2021/22/23 + real accel caps + round 5 side effects.
- SL1 MERGED dc59f2a (backlog 268/269 ✅; check-broadcast needs `--import ~/gridiron-work/loader.mjs`, 54 checks). C3 (Sonnet) relaunched → logs/c3-blankfield.out.
- **Round 6a** (Opus) running in wt/animflow (at e50ae0e) → appends 'Round 6a' to logs/animflow-report.out. Relaunch brief: prompts/animflow-round6a-launch.txt. W2 on try 2 (try 1 hit 5400 s watchdog).

## Current state (main a2aaab0, 15 commits NOT pushed; 4173 HELD at 0f898f0)
- Merged this chat: FP3 Future classes UI (I hid the header List/Cards on future tabs), animflow round 5 (returns, QB mobility, YAC, camera at tackle; accel caps 1.5× NFL by decision). Gates on main: build, lint 4, hex, contrast, broadcast 53 all pass.
- **Claude sub-agents DIE on clear — check output, relaunch from brief if no result:**
  1. **SL1 sideline personnel + officials + chain crew** (Opus) in `~/gridiron-work/wt/sideline` (branch wt-sideline, uncommitted: broadcast/sideline.ts, sidelinePaint.ts, actors/field/liveView, check-broadcast). Done when `logs/sideline-verify.out` exists. Brief (incl. ADDENDUM for officials/chain crew): `prompts/sideline-personnel.txt`. Tell the relaunch to continue from the uncommitted edits.
  2. **C3 blank-field check** (Sonnet) in `wt/c3fix` → `logs/c3-blankfield.out`. Brief `prompts/c3-blankfield.txt`. (Also seen this chat: 2.5D field blank on first open of a match until stepping a play.)
- DeepSeek running: **W2** weather (`wt/weatherw2`) → `logs/weather-w2-verify.out`. Check `tail logs/weatherw2.log` for RETRY after it finishes (memory opencode-orphan-sessions).
- Done this chat: NFL motion v2 (`logs/nfl-motion-reference-v2.{out,json}`), J-job briefs `prompts/realism-j{1,2,3,5,6}.txt` (J6 now includes 2-pt tries, backlog 270).
- **BDB data** (user accepted Kaggle rules for 2021/2022/2023/2025): `~/gridiron-work/nfl-tracking/bdb/2022` (special teams 2018–20, 4.7 GB) and `bdb/2023` (OL/DL pass plays 2021 wk1–8, 928 MB) unzipped. 2025 and 2024 data REMOVED from Kaggle. **2021** (all pass plays 2018, 2.33 GB) was downloading to `~/Downloads/nfl-big-data-bowl-2021.zip` (first try stalled at 18 MB). Verify with `unzip -tq`, move to `bdb/`, unzip to `bdb/2021` (nice). If it stalled again, ask the user to download it in their browser.
- Sideline preview server `sideline-ui` (vite 4478, .claude/launch.json) may still be running; stop when done.

## Decisions and why
- Round 5 accel caps shipped at 1.5× NFL (real caps gave TTT 3.65 s, run tackler 56/195); real caps + route retiming in round 6.
- J5 may add new plays to the user's play-call card list (accepted). 2-pt tries added to J6 (user ask).
- Use `logs/animflow-yac.mjs` for animation YAC, not play-realism's formula column.
- Clutch P2 waits for W2 merge (both edit playsim.ts). J-jobs one at a time after Clutch P2, order J1, J2, J3, J5, J6.

## Next steps
1. Check SL1 / C3 / W2 / BDB-2021 status; relaunch dead sub-agents from briefs.
2. W2 lands: review, merge (gates), update `NEXT_PHASE_FUT_WEATHER.md`, then `~/gridiron-work/ds-wt clutchp2 ~/gridiron-work/prompts/clutch-p2.txt`.
3. SL1 lands: review shots `logs/sideline-shots/`, gates, merge, mark backlog 268/269 ✅.
4. Update `prompts/animflow-round6.txt` to use BDB 2021/2022/2023 (+ v2 targets; real accel caps; playtest side effects from round 5: screen TTT 2.31 s, contact-to-whistle p90 3.28 s, slow KR players), then launch round 6 (Opus) in wt/animflow after SL1 merges (both touch broadcast/).
5. Then Clutch P2 → J1…J6; queue after: Clutch P3/P5, C4, Halftime H1, Weather W3 UI.

## Gotchas
- `__game` / `__gdJump` dev-only. Quick game: in the page, `import('/src/store/gameStore.ts')` → `startCareer({name:'AF',path:'coach',archetype:'off',teamId:'CLE',seed:33333,startLevel:7})`, `advanceWeek()`, `openMatch(id)`; `localStorage['gd.view.game']='broadcast'`; viewport 1280.
- `pkill -f <name>` also kills Monitors whose command contains that name.
- ds-wt prompt path must be absolute (relative path gave "You must provide a message").
- Keep the chat lean: sub-agents for big reads; read only verify files and strips.
- Push procedure only with the user's ok (one ok per push): build, lint 4, secret scan, `git push origin main`, `scripts/publish-pages.sh main`, confirm live index-*.js.
