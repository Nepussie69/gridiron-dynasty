# NEXT PHASE — L12.16 "Hall of Fame & legacy" (FUTURES row 23)

_Spec by Claude Opus 5.5, 2026-10-08. Runs in parallel with playbook / mastery / contracts (touches the store's save/load and season-end, Awards screen, legacy panel; no sim). Lint baseline 4._

## Bugs found while specing (fix first)
1. **League history and the Hall of Fame are never saved.** `statDb` (team seasons, retired players) and `awards` (season honors, HOF) are module variables in `src/store/gameStore.ts` and are absent from `saveGame({ world, career, activeTeamId, screen, readNews })`; they are not reset on a new career and not restored on load. After a reload, History / Stats Hub / Awards lose every past season.
2. **The Hall of Fame inducts active players.** `computeHallOfFame` in `src/game/engine/awards.ts` scans `world.players` (active only) and inducts anyone with 5+ seasons over 120 — it never waits for retirement, and it never passes titles or awards to `hofScore`.
3. **A retiree's final season is lost.** `developPlayers` removes retirees before `recordPlayerSeasons(statDb, world.players)` runs at season end.

## Tasks
| Task | What | Status |
|---|---|---|
| H0 | Persist `statDb` and `awards`: add optional `statDb?` / `awards?` to `SaveData`, write them in every `saveGame` call, restore them on load (primary and backup), reset both to `newDatabase()` / `newAwardHistory()` in `startCareer` (and any other new-world path). Old saves without them: rebuild `statDb.players` from `world.players[*].stats` via `recordPlayerSeasons` (team seasons can't be recovered — fine) and start awards empty. Export/import save carries them too. | not started |
| H1 | Retirement record: in `runEndOfRegularSeason` call `recordPlayerSeasons(statDb, world.players)` **before** `developPlayers`; diff player ids before/after `developPlayers` to get the retirees and set `statDb.players[id].retiredSeason = world.season`, `peakOvr` (max of the player's `ovr` seen; also track `peakOvr` for active players each season end), `lastTeam`. New optional fields on the db player entry only. Do not edit `progress.ts`. | not started |
| H2 | Real HOF vote (`awards.ts`): eligibility = retired players whose `retiredSeason <= season - 3` (3-season wait), not yet inducted, at least 5 NFL seasons. Score = existing `hofScore` volume terms **plus** honours counted from `awards.seasons` (MVP 20, OPOY/DPOY 12, ROY 4, First-Team All-Pro 8, Second-Team 4) and titles (team-seasons with `champion` in `statDb.teams` for the player's `teamId` that season, 10 each), plus a position-fair term so OL/K/P/LS/FB can get in: `max(0, peakOvr - 85) * 6` for every position. Ballot: top 15 eligible by score = finalists; class = finalists with score ≥ threshold, capped at 5, minimum 0. Store `awards.classes: { season, inducted: HofInductee[], finalists: { playerId, name, pos, score }[] }[]` (optional field), keep `awards.hof` / `awards.inducted`. Tune the threshold with the H5 probe so classes average **2–4 per year** after the wait. | not started |
| H3 | Awards screen → Hall of Fame tab: classes newest first (year, inductees with position, years, best line, honours chips: MVP×n, All-Pro×n, rings), a "Ballot" sub-view with that year's finalists and who missed, a "Your guys" badge when the inductee is in the user's Ledger (`career.ledger[].playerId`). Inbox/news item at season end: "Class of {season}: …" naming the user's former players first. | not started |
| H4 | Legacy panel (`CareerPeople.tsx`, `legacy.ts`): `legacyCase` gains `honoursForYourPlayers` (awards won by players on your club in your seasons) and `finalistsYouFound` (ballot finalists from your Ledger); show a progress bar to the threshold and a one-line "What gets you in" list. Keep the existing score formula; add the two new terms at most +10 total. | not started |
| H5 | Probe `__hofProbe(seasons=12, seed)` (register in `main.tsx` like the others): runs fast seasons with `careerSmoke`-style advancement and prints per season: retirees, eligible, finalists, inducted (name/pos/score), and a save→load round-trip check that `statDb.teams.length` and `awards.hof.length` survive. | not started |

## Acceptance
- build + lint exactly 4 warnings; `__gameDayEquivalence(20)` 20/20; smokes 0/0 (`--smoke=coach:4,personnel:4`); simTest unchanged (no sim edits).
- `__hofProbe(12)` on seeds 33333/2222: nobody inducted before they retire + 3 seasons; average class 2–4; at least one non-QB/RB/WR inductee over 12 seasons; round trip OK.
- Browser: play to season 2 in the pane, reload, History still shows season 1 and Awards still shows its honours.

## DO NOT
No sim/engine-balance changes, no rng draws in the sim, no changes to `progress.ts`, `playsim.ts`, `playbook.ts`, `cap.ts`, `negotiation.ts` (other pushes own them). New save fields optional only. No new dependencies. Do not edit any `*.md` file. No git commands.
