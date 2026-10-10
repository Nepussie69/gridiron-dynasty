# NEXT PHASE — "Broadcast 2.5D" live game view (FUTURES #31, user 2026-10-10)

User chose direction **B** from three animated mockups (A All-22 Premium / B Broadcast 2.5D / C Hybrid), after asking whether it suits phones and an M5 Mac. Reference: `docs/anim-mockups/anim-b-broadcast25d.html` (same play in all three: CLE @ ATL 3rd & 6, PA deep cross, double-teamed DE, WR #1 beats CB #24 at the break, broken tackle, gang tackle, +17).

**Starts after:** the UI redesign's game-day step (D5, `NEXT_PHASE_UI_REDESIGN.md`) and animcontact4 (double teams + route running vs man coverage, `playAnim.ts`) are merged.

## Goal
The live game view becomes a tilted TV skycam: perspective field and stadium, 22 code-drawn players with poses and run cycles, a 3D ball arc, a camera director that frames every play type, broadcast graphics in the Sunday Broadcast style, and a telestrator replay. The existing top-down view stays as a setting.

## Measured performance (2026-10-10)
- Mockup draw cost ≈ 6–7 ms per frame for two views (budget 16.7 ms at 60 fps).
- Apple M5 at 375 px / DPR 2: steady 60 fps (worst frame 17.7 ms).
- Expected: recent iPhones / flagship Android 60 fps; mid-range Android 30–60; old/budget 20–30 → needs lite mode.

## Defaults by device
- **Desktop / tablet (≥ 768 px):** Broadcast 2.5D live view.
- **Phone (< 768 px):** top-down live view by default (players are only 15–25 px tall in 2.5D and pile-ups hide the carrier), with the 2.5D camera used for replays of big plays and scores. A setting lets the user pick 2.5D live on phone too.
- **Setting (localStorage only):** Game view = Broadcast 2.5D / Top-down; Replays = Big plays / All / Off; Quality = Auto / Full / Lite.
- **Auto quality:** measure frame cost for the first ~60 frames; drop to Lite (30 fps target, DPR cap 1.5, no grain/gradients, simpler crowd) when the p95 frame cost exceeds 12 ms.

## Phases (each verified before the next)

| # | Phase | Owner | Contents | Key checks |
|---|---|---|---|---|
| B1 | Animation data | DeepSeek (2–3 jobs) | `buildPlayAnim` also outputs, for every play type (pass, run, sack, scramble, kickoff, punt, FG/PAT, returns, penalties, kneel/spike): **engagements** `{a, b, t0, t1, kind: block/double/chip/missedTackle/tackle}`; per-actor **pose windows** `{t0, t1, state: stance3/stance2/run/pedal/block/fake/throw/catch/carry/stumble/dive/fall/down}`; **facing** overrides (fixed angle / face actor / backpedal); **ball height** in yards incl. release and catch heights; **events** `{t, kind: snap/playAction/break/throw/catch/brokenTackle/contact/tackle/firstDown/score/turnover, keys, spot}`; optional **camera hints** (strong side). Built from data the builder already computes (`planBlocks`/`applyBlockEngagements`, holders, flights, routes). | Calibration byte-identical (presentation only); anim end spots 100%; probe: every play type has poses for all 22, no actor without facing, engagements consistent with positions (contact distance ≤ 1.2 yd), events in time order |
| B2 | Projection + field + stadium | Claude | Canvas 2D renderer module (`src/components/broadcast/`): perspective camera, field (stripes, yard lines, hash marks, numbers reading correctly, end zones with club wordmarks, pylons, goalposts), stands + LED ribbons cached per camera move, LOS and yellow first-down line drawn on the turf (occluded by players) | 60 fps on M5 at full window; static layers cached; no layout shift in MatchView |
| B3 | Player figures + poses | Claude | Code-drawn figures from team tokens (helmet + stripe, facemask when facing camera, pads, jersey + number, arms, legs, shadow), run cycle by distance, all poses from B1, depth sorting, pre-rendered sprite parts per team/scale after `document.fonts.ready` | All 32 club kits readable (contrast via teamColor tokens); 22 figures + effects ≤ 8 ms/frame on M5 |
| B4 | Ball, effects | DeepSeek | 3D ball arc with spiral wobble, trail and shrinking shadow; catch sparkle, broken-tackle burst, impact ring + small camera shake, turf particles; TD celebration | Effects tied to B1 events; reduced-motion respected |
| B5 | Camera director | DeepSeek (2 jobs) | Automatic framing per play type: pre-snap formation shot, drift to strong side, follow ball with easing, tighten on contact; special rules for deep shots, sideline routes, punts/kicks/long returns, goal line; keep carrier visible (re-angle when pursuers occlude) | Probe over 3 seeds × 4 games: carrier in frame 100% of play time, ball in frame ≥ 99%, no camera jumps > threshold |
| B6 | Broadcast graphics + telestrator replay | Claude | Lower third, down & distance chip, play clock, result toast with stats, player callouts (double team, separation, time to throw, broken tackle); replay: team-colour wipe, higher camera, freeze at the key moment, telestrator drawings (route, double-team circle, pocket, separation bracket, air yards, pursuit), replay rules (big plays / scores by default, skip control) | Uses the redesign kit/tokens; skip works; sim-to-end never waits on replays |
| B7 | Phone, quality modes, setting | DeepSeek | Phone camera profile, defaults by device, Auto/Full/Lite quality, top-down fallback, settings in the shell's settings sheet | 375 px: no horizontal scroll, readable; Lite mode ≥ 30 fps under 4× CPU throttle |
| B8 | Integration + review | Claude | Browser checks across play types, seeds and both themes; polish pass with the user | build OK, lint exactly 4 warnings, calibration identical |

## Constraints
- Presentation only: no sim, rng, calibration or save-field changes (view settings in localStorage).
- No new dependencies (canvas 2D, no WebGL/three.js).
- Recorded play results are the truth: the animation must end on the recorded spot, with the recorded ball carrier, tackler(s) and outcome.
- Keep every existing game-day feature (moments, call modes, dock, replay controls, scorebug, box score).

## Estimate
About 12–16 jobs, ≈ 360–540 minutes of wall-clock at the 2026-10-10 pace, plus polish rounds with the user.

## Progress

| Phase | Status |
|---|---|
| Spec | ✅ 2026-10-10 |
| B2 | ✅ merged into ui-redesign (Claude) |
| B1 | 🔨 b1a + b1b building (DeepSeek, off main after animfix 1665b00) |
| B3–B8 | ⏳ prompts b4, b5a/b5b, b7 ready; B3, B6, B8 Claude |
