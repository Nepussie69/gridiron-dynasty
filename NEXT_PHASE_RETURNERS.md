# Returners on the depth chart — backlog 124

User request (2026-10-09): choose kick and punt returners on the depth chart and show ratings or skills for the role.

## Implementation

1. Add separate Kick Returner (KR) and Punt Returner (PR) cards in Depth Chart → Special Teams. Show the effective current returner, whether Auto or manually selected, and candidates on the current roster. Allow selection independently and the same player in both slots. Follow the existing depth-chart career/team capability gate; other teams read-only.
2. Reuse `world.returners[teamId].kr/pr` and `clubReturners` in `src/game/engine/returns.ts`: the PBP and fast-sim engines already honor these optional saved overrides. Add a store action to validate eligible, healthy roster players, update only that role, bump and save. Add Auto per role; reset-to-ratings should clear both overrides and restore automatic selection. Changing return roles must not alter offensive/defensive depth order. Fallback automatically for injured, traded or released players; display the actual replacement, never a stale selected name. Old saves remain valid.
3. Show a Return rating (RET, rounded 0–100) computed from the existing `returnScore`, which already drives the sim: SPD32%, ACC24%, AGI20%, BCV14%, CAR10%. Tooltip plainly explains that rating and its components. Show speed, acceleration, agility, vision and ball security for candidates, using canonical `playerAttrs`. Add the same Return ability display in player profiles for eligible returners; reuse normal rating badges and glossary conventions. This is an exposed simulation rating, not an invented independent saved stat. Keep existing default sim outcomes unchanged.
4. Candidate list should include eligible WR/RB/CB players, show injury/unavailability, allow choosing a starter if healthy, show current KR/PR badges, and sort by return ability. No hidden arbitrary top-3 restriction. Match automatic eligibility and enforce it in store action (not just UI). Make UI concise, usable at desktop and 375px, both light/dark themes. Reuse PlayerName/hover cards/profile links.

## Files / ownership

DeepSeek owns this feature in its isolated worktree: `src/screens/DepthChart.tsx`, `src/components/PlayerProfile.tsx`, `src/game/engine/returns.ts`, relevant store action in `src/store/gameStore.ts`, and minimal needed supporting types. Other workers own the realism chain; preserve all edits from others, never reset/revert their changes. No new sim tuning, independent attributes, deps, markdown edits, git commands, servers, RNG draws, push/publish, or stable4173 rebuilds.

## Acceptance

- Build passes, lint exactly 4 warnings.
- Real-data calibration seeds 33333/2222/5150 ×500 with --eq --smoke=coach:4,personnel:4; eq20/20, smokes0/0; default outcomes match prefeature baseline and applicable bands pass. Animation end spots100%.
- Focused probes: KR-only/PR-only selection reaches actual PBP returner and fast-sim credits, same player both roles works, Auto restores baseline, invalid/other-team/injured ids rejected, injuries/transfers/releases trigger correct fallback, reset clears overrides, persistence/reload retains valid choices, old save with no fields works; rating displayed equals sim returnScore from canonical attrs.
- Browser check selectors and profile rating, real player data, light/dark, desktop/375px with no page overflow.

## Progress

| Item | Status |
|---|---|
| KR / PR choices and ability ratings | Spec ready; priority after realism chain repair, before FUTURES |
