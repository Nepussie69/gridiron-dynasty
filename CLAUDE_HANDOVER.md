# Claude handover — Gridiron Dynasty (2026-10-11 18:00 AEDT)

Read AGENTS.md first. Backlog rows 244–260 in `PLAYTEST_BACKLOG.md` are this chat's requests. Only ONE orchestrator chat at a time.

## Goal
Orchestrate the FUTURES queue and the user's playtest fixes, mainly making play animation look like real NFL football (mockup `~/gridiron-work/logs/anim-b-broadcast25d-mockup.html` + real NFL tracking data). DeepSeek implements engine/UI jobs; Claude sub-agents do animation; Claude verifies and merges.

## Current state (main 607652a, 92 commits ahead of origin, NOT pushed)
- Merged this chat: animflow r2 (pass timing, TTT 1.04→2.42 s), FP2 (store + FP1 horizon fix), animflow r3 (QB throwing motion, 5 styles).
- Stable 4173 rebuilt at 0f898f0 (index-DctD545z.js) from `~/gridiron-work/rv-stable` (detached checkout → `npm run build` → restart `vite preview --port 4173 --strictPort --outDir dist`).
- **Claude sub-agents DIE when this chat clears.** Check each, relaunch from its brief:
  1. animflow round 4 in `wt/animflow` (FG flight past posts, pressure→hurry style, RB downhill to NFL targets, real accel caps, ball on turf at tackle, ball size). Done when "Round 4" is in `logs/animflow-report.out`. Brief: `prompts/animflow-round4.txt`.
  2. NFL motion v2 analysis → `logs/nfl-motion-reference-v2.{out,json}`. Brief: `prompts/nfl-motion-v2.txt`.
  3. CMU mocap subset → `nfl-tracking/cmu_mocap/INDEX.csv`. Brief: `prompts/cmu-mocap.txt`.
- DeepSeek jobs: **W2** (`wt/weatherw2`, still running, writes `logs/weather-w2-verify.out`); **C3 UI** (`wt/challengesc3`, FINISHED, `logs/c3-verify.out` + `logs/c3-shots/`, needs review/merge; it edits MatchView, as do the animflow rounds, so expect conflicts and keep both sides); **replaycustom** (`wt/replaycustom`, running, Settings→Replays "Custom" with per-type toggles, writes `logs/replay-custom-verify.out`).
- Data (outside the repo, never commit) in `~/gridiron-work/nfl-tracking/`: BDB 1 game (v1 analysis done), `statsbomb_tb12/` 127 games, `ngs_highlights/` 562 plays, `nflverse/` pbp + participation 2021–25 + FTN 2022–25, `cfb/` cfbfastR pbp 2021–25 (562 MB).

## Decisions and why
- Kickoffs stay classic (pre-2024). Use 2021–23 kick data only (memory `classic-kickoff-rules`).
- Animation is presentation only. Recorded results/end spots are untouchable; sim changes from data are separate calibrated jobs.
- No Madden data extraction (EA proprietary). No college tracking exists for free. The CFBD API needs the user's own key.
- The user allowed a 3rd DeepSeek job ("use more cores"). Still keep load near 4.

## Next steps
1. Check the 3 sub-agents (above) and relaunch any that died with `Agent` + the brief file.
2. Review + merge C3 (gates: build, lint exactly 4, check-hex, check-contrast, check-broadcast; read diff; look at c3-shots). Update `NEXT_PHASE_FUT_CHALLENGES.md` C3 row.
3. When round 4 lands: verify gates + strips, merge, then send round 5 = `prompts/animflow-round5.txt` (FIRST: punt/kick returns, user: "everyone standing still but returner"; QB mobility from ratings; YAC realism), then offer a 4173 rebuild.
4. When load < 4: launch the play-realism analysis (`prompts/play-realism-analysis.txt`, nflverse vs the sim's play calling + YAC by air-depth); later add a CFB section from `nfl-tracking/cfb/`.
5. W2 and replaycustom: review/merge as they land. Then the queue from the old handover: Clutch P2 → Primetime P5 → C4 → Halftime H1 → FP3 UI → Weather W3 UI …

## Gotchas
- A sub-agent reply via SendMessage resumes it. A new chat cannot message old agents; relaunch instead.
- `python3 -I` hides pyarrow (user site-packages). Data scripts live in `~/gridiron-work/nfl-analysis/`.
- `git commit -am` is fine (untracked NEXT_PHASE.md/CLAUDE_RESUME.md/.claude stay out).
- Calibration wait loop: `while pgrep -f '/Users/aaron/.local/node/bin/nod[e] --import' >/dev/null; do sleep 60; done`.
- Keep this chat lean: send big reads/searches to sub-agents and only read the verify files and strips.
