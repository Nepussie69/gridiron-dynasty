# Weather & stadiums — FUTURES #6

User (FUTURES list, 2026-10-08): wind (deep balls, kicks), rain/snow (fumbles, footing), cold, domes; crowd noise → false starts on the road; forecast on the Game Plan screen. IDEAS_ROUND2 #6 adds "plan for them in the week; the coordinators flag it."

## Goal

Every game (user and AI, NFL and college) is played in a specific setting. That setting is the home stadium's roof, the climate for that week, and how loud the crowd is. Weather changes kicks, deep passes, ball security and pre-snap discipline in bounded ways that match the NFL. The user sees the forecast on Game Plan and the conditions on game day. League-wide numbers stay inside the 2015–2024 NFL bands, because those averages already include weather.

## What already exists (extend it; don't rebuild it)

- `playsim.ts` `R17.windPerMph = 0.006` is a neutral wind hook (default 0), wired in three places:
  - FG make chance in `resolveSpecial` (`fgProb(yard, power) + wind * R17.windPerMph`)
  - punt gross in `resolveSpecial` (`+ (env?.wind ?? 0) * 0.3`)
  - PAT make chance in `resolveStKick`

  `SimEnv.wind` and `GameState.wind` exist. `createGame` sets `wind: 0`, and `toEnv` (~line 3121) passes `s.wind`.
  - **Sign bug:** the doc comment says positive wind means into the kicker's face. Both formulas *add* positive wind, so a headwind currently helps the kick. W2 has to flip the sign. Today this has no effect because wind is always 0.
- **Crowd noise exists, but only as a penalty mix.** `pickPenaltyKind` multiplies the false-start weight by `(away ? 1.25 : 1)`. The weights are renormalised, so the road offense gets a larger *share* of false starts but the *same number* of flags. The two pre-snap `rng()` draws (~lines 3592/3629) decide whether a flag is thrown.
- **Fumble levers:**
  - the `fumbleMult` (cohesion) multiplier in `resolveRun`
  - `R2.runFumbleBase` and `R2.passFumbleBase` in `resolvePass`
  - the return fumble hashes in `resolveStKick` and `resolveKickoff` (`h01(...:fum)`)
  - `dropChance` / `muffChance`
- **Deep-ball lever:** `qbIntMult` / `targetCatchProb`, which branch on `depth >= 15`.
- **Stadium data:** `Team.stadium` is a name only (`nflTeams.ts`, `cfbTeams.ts`). There is no roof, climate or loudness data, and nothing weather-related in the store, Game Plan, Dashboard, Schedule or MatchView.
- **Seeds and callers:**
  - The user game is seeded `world.seed + week*7919 + 101`. It is called from `gameStore` `simulatePlayByPlay` (~1290) and `createGame` (~1522, ~1573).
  - AI games run in `src/workers/leagueSim.worker.ts` through `simLeagueGames`. That payload has **no `season`/`week`**, so weather must be computed by the caller and sent with each game.
  - `simTest` (~7328) and `gameDayEquivalence` (~5374) drive calibration.

## Design

1. **Stadium table.** New file `src/game/data/stadiums.ts`, keyed by abbr. Each entry has:
   - `roof`: `open` | `dome` | `retractable`
   - `climate`: `cold` | `temperate` | `warm` | `desert`, plus `altitude` (DEN)
   - `windy` (0–1): BUF, CHI, CLE, NE, NYJ/NYG and GB are windy
   - `loud` (0–1): SEA, KC, NO, MIN, BUF and PHI are the top

   Domes: DET, NO, MIN, LV, and LA/LAC at SoFi. Retractable: ATL, ARI, DAL, HOU, IND. College clubs get a default from their conference region (Big Ten/MAC cold, SEC/ACC South warm, Mountain West dry), always open-air, with `loud` taken from prestige.
2. **Weather is a pure function, not saved state.** New file `src/game/engine/weather.ts` exports `gameWeather(home: Team, season, week, gameId): GameWeather`. The result is `{ roof, closed, tempF, windMph, windAlong, precip: 'none'|'rain'|'snow', intensity, loud }`.
   - Inputs are all `h01` hashes of `${season}:${week}:${gameId}`. Week maps to month (wk1 = early Sep … wk18 = early Jan; postseason = Jan/Feb).
   - Domes are always closed. A retractable roof closes when it is cold or wet.
   - Snow needs `tempF ≤ 34`.
   - Nothing is saved, so old saves stay valid and coached and fast paths always see the same weather.
3. **Forecast.** `forecastFor(weather, gameId)` returns ranges built from hashed error: wind ±4 mph, temperature ±5°F, precip as a % chance. The actual value falls inside the range about 80% of the time, so forecasts can be wrong. A club that has an analytics department (FUTURES #19) gets the narrower range.
4. **Effects.** `wxEffects(w, offIsHome, qtr)` returns bounded multipliers. `windAlong` flips sign by end of the field (offense home/away × quarter parity). The list:
   - **Kicks:** FG/PAT `− headwind × windPerMph` (sign fixed), plus an accuracy term from total wind. Punt gross changes by ±0.3 yd per mph of along-wind. Cold (< 32°F) costs about −2 yd of effective kick range. Kickoffs are shorter into the wind, which means fewer touchbacks.
   - **Deep balls (`depth ≥ 15`):** above 10 mph, the catch chance drops by up to about −12% relative and the INT multiplier rises by up to about +10%. Short passes are untouched.
   - **Rain/snow:**
     - fumble multiplier ×1.15–1.35 on runs, receptions and returns
     - drop and muff chance up about 10–20%
     - footing: a small cut in run gain variance and pass-rush pressure (bounded ±4%)
   - **Cold:** a small rise in drop/fumble chance, up to +8%.
   - **Dome / closed roof:** no wind and no precipitation. The kick and pass effects come out slightly positive after centering (item 5).
   - **Crowd:** use `loud` on the existing pre-snap offensive flag draw as a threshold multiplier: the away offense gets `1 + WX.crowd × loud` and the home offense gets a centering offset. Keep the existing 1.25 road mix, scaled by `loud`. Closed roofs add +0.1 `loud`. OL/QB AWR still damp it through the existing weights.
5. **Centering keeps the bands.** All coefficients live in one `WX` constants object, the same pattern as R17. Each effect is centered so its expectation over a full NFL season's weather mix is about 1.0. `WX_CENTER` is precomputed by the probe and hard-coded. The result: domes run slightly above baseline, bad weather runs below, and the league mean doesn't move.
6. **No RNG change.** No `rng()` draw is added or removed. Effects only scale thresholds on existing draws or use `h01` hashes. `setWeather(on)` works like `setStamina`. With it off, every multiplier is exactly 1 and output is byte-identical to pre-feature main.
7. **AI awareness (small).** In bad weather (wind ≥ 15 mph or snow), AI play calls in `aiTendency` shift +4–6 pts toward the run, and AI clubs go for it on 4th down more instead of a long FG into the wind. The shift is bounded, hash-based and centered.

## UI touchpoints (redesigned screens, kit in `src/ui/kit.tsx`: `Card`, `SectionTitle`, `Badge`, `Chip`, `Stat`)

- **Game Plan** (`GamePlanScreen.tsx`): a `WeatherCard` beside the opponent card. It shows roof, temperature, wind (mph plus an arrow along the field), precip chance, and crowd loudness (on the road). Below that are 1–2 staff lines, e.g. "OC: 18 mph wind — shorten the passing tree; FG range ~45 yd into it". It follows the same pattern as `SpecialTeamsCard`.
- **Dashboard** next-game hero and **Schedule**: a weather `Chip` for the upcoming week. Past games show the conditions they were played in, computed with the same pure function.
- **MatchView:**
  - a scorebug weather chip (temp · wind arrow · precip icon)
  - a light CSS/canvas rain or snow overlay on the top-down field; Lite and `prefers-reduced-motion` turn it off
  - play-log suffixes such as "into an 18 mph wind" and "wet ball"

  Do **not** touch `src/components/broadcast/` (B2 in `~/gridiron-work/wt/b2`). The 2.5D view adds weather later from `GameWeather`.
- Desktop and 375px, light and dark, no horizontal overflow.

## Phases (DeepSeek jobs, non-overlapping files)

| Job | Files (only these) | Depends | Notes |
|---|---|---|---|
| W1 data + model | new `src/game/data/stadiums.ts`, new `src/game/engine/weather.ts` (types, `gameWeather`, `forecastFor`, `wxEffects`, `WX`, `weatherProbe`), probe export in `src/main.tsx` | — | Pure, no sim wiring. Calibration byte-identical. |
| W2 engine wiring | `playsim.ts` (small hooks: `createGame` optional `weather` param → `GameState.weather`; `toEnv`; kick/punt sign fix; deep-ball, fumble, drop and penalty-threshold hooks; `aiTendency` nudge), `leagueSim.ts` + `src/workers/leagueSim.worker.ts` (weather per game item), `gameStore.ts` call sites + `simTest`/`gameDayEquivalence` pass weather | W1 merged | The **only** sim-touching job. Runs alone (other sim jobs idle). Tunes `WX_CENTER`. |
| W3a screens | `GamePlanScreen.tsx` (`WeatherCard`), `Dashboard.tsx`, `Schedule.tsx` | W1 merged | Can run in parallel with W2 because it only reads `gameWeather`/`forecastFor`. |
| W3b game day | `MatchView.tsx` (chip, overlay, log text) | W2 merged, redesign V1/D5 MatchView edits merged | Presentation only. Anim end spots stay at 100%. |
| W4 | orchestrator | all | Merge, re-verify on main, browser check, update this table + FUTURES row 6 + backlog. |

## Acceptance

- `npm run build` passes and `npm run lint` shows exactly 4 warnings.
- **Weather off** (`setWeather(false)`): `REPO=<tree> node ~/gridiron-work/calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4 --anim` is byte-identical to the pre-feature main baseline.
- **Weather on** (default): the same command passes all 31 NFL bands × 3 seeds (points 22–23.2). Also required: eq 20/20, smokes 0 errors / 0 violations, anim end spots 100%.
- **`weatherProbe`** over 3 seasons × 32 clubs:
  - About 30% of NFL games are under a closed roof.
  - Snow appears in 2–4% of games, only in cold or windy cities, weeks 12+.
  - Wind ≥ 15 mph appears in 10–15% of open-air games.
  - Closed roofs never get wind or precipitation.
  - Results are identical across reload and between worker and main thread.
  - The forecast range contains the actual value 75–85% of the time.
- **Split stats** over 1500 games, each moving in the right direction and within bounds:
  - FG%: dome > open, and wind ≥ 15 mph about 6–10 pts lower.
  - Deep completion: wind ≥ 15 mph 3–6 pts lower.
  - Fumbles per game: rain/snow +15–35%.
  - Points: wind ≥ 15 mph or snow 1.5–3 pts lower.
  - False starts: the road offense has more, the loudest stadiums the most, and league totals stay inside the penalty band (false start ≈ 1.18, about 51 yds/team-game).
- **Browser (orchestrator):**
  - Game Plan `WeatherCard` (dome, windy and snow cases)
  - Dashboard and Schedule chips
  - MatchView chip, overlay and log text
  - desktop and 375px, light and dark, no console errors
  - an old save loads

## Risks

- **Calibration drift** if an effect isn't centered. Mitigation: centering and the probe split; W2 tunes `WX` only, never the core calibration constants.
- **Worker payload.** Weather must ride on each game item. If the stat-allocator fallback path is used, it ignores weather; that is acceptable, but document it.
- **Wind sign** is inverted in the existing hooks. Fix it in W2 and add a probe that a headwind lowers FG%.
- **Equivalence:** the coached and fast paths must get the same `GameWeather` object, so pass it in rather than recomputing it with different inputs.
- **MatchView merge conflicts** with the redesign V1 and Broadcast B-jobs. Keep W3b small and run it last.
- **Retractable-roof rules** and college regions are approximations. Keep them in data, not in code branches.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| W1 data + model | ⏳ |
| W2 engine wiring + calibration | ⏳ |
| W3a Game Plan / Dashboard / Schedule | ⏳ |
| W3b MatchView | ⏳ |
| W4 integration + browser check | ⏳ |
