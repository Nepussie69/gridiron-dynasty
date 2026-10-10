# Choose your coordinators and position coaches (FUTURES #28)

User (FUTURES list, 2026-10-10; backlog 142): when you're head coach or GM with authority, hire OC, DC and ST coordinators and position coaches from a candidate market, judging each one on scheme, teaching, ratings boost and salary. They drive player development, scheme install and game-day calls. Firing and poaching tie into the coaching tree (#21) and the owner budget (#25). Extend the redesigned Staff & Hiring screen. Do not fork it.

## Already built (do not re-implement; extend)

- **Seats.** `types.ts:StaffRole` has HC, OC, DC, STC, QB, OL, DL and Secondary coaches, plus front office and Analytics. There is no WR, RB, TE or LB coach. `generate.ts:makeStaff` and `generateStaffPool(rng, 44)` draw these from rng. The pool holds about 4 candidates per role.
- **Market.** `hiring.ts:openCandidates` filters by role and takes the first 24, with asking salary set by destination appeal. `computeInterest` weighs rep, prestige, money and elitism. `attemptHire` takes an `interestBonus` (the owner fund, #25). `applyHire` replaces the seat, gives a fixed 3-year contract and an optional scheme override. `schemesForRole` covers OFF_SCHEMES and DEF_SCHEMES.
- **Store.** `gameStore.ts:hireStaff`, `fireStaff` and `poachAssistant` are all gated by `accessFor(career,'staff') === 'decide'`. A fired coach goes back to `staffPool`. A hire removes that person from `career.tree`.
- **Effects.** `coaching.ts:coachEffect` turns OC and DC into `coordinatorEdge(rating, heldByUser)`, clamped ±4.5. **A vacant OC or DC costs the floor (−4.5).** The only exception is a seat the user personally holds at the coordinator rungs (backlog 193, 4123d3a). The mean of the 4 position coaches sets team-wide `development` (0.8–1.35) and part of `discipline`. STC adds ×0.04 to `situational`. `progress.ts:97` applies `development` to every player alike.
- **Game-day.** `decisions.ts:coachTendency` sets pass-rate and tempo from OC scheme and rating, and aggression and timeouts from HC rating and specialty. `playsim.ts` (~1323): a higher-rated DC exploits the user's tendency book. `quickCall.ts` makes staff-picked calls. #26 (coach playcalling) is not built yet.
- **Install and cohesion.** `install.ts:installBonus` applies to the user's own role only. `playbook.ts` plus `staffTenureRef` (4123d3a): a new coordinator or a scheme change resets tenure, which lowers cohesion and mastery.
- **Tree (#21).** `coachingTree.ts:advanceCoachingTree` sends your coordinators to HC jobs, and `coachingTree.ts` backfills them at equal rating with a hash-built "Promoted from within" coach, so the user's results stay neutral. `poachAssistant` brings protégés back.
- **Owner (#25).** `ownerMeeting.ts:ownerStaffBudgetBonus` and `ownerStaffFundOpen` exist, along with `owner.ts:ownerPersonality`. The staff budget, `(18 + prestige×0.3)M + owner bonus`, is **display-only** and lives in `Staff.tsx`.
- **UI (`ui-redesign`, F4 plus D steps).** `Staff.tsx` has an OrgChart with VacantSeats, a grouped StaffTable, the Inspector, and Market with MarketFilters and MarketCard (scheme-fit sort, projected edge, budget fit, compare against the current holder). Let-go uses a ConfirmSheet that lists consequences. `staffEffects.ts` holds the readout helpers. V1 (wt/v1, in progress) switches the hiring preview to `coordinatorEdge()`.
- **Missing.** Each item here is in scope:
  - no teaching attribute, and no per-position-group development or boost;
  - no WR or LB coaches;
  - staff `contractYears` never ticks down, so there is no expiry and no buyout;
  - the budget is not enforced;
  - the market never refreshes;
  - rivals can't poach assistants below HC level;
  - no preview of how a candidate will call games.

## Design

1. **Coach profile, derived and with no save churn.** New `src/game/engine/staffMarket.ts:coachProfile(m)` returns the profile below. Everything is `hash32(id)` plus rating plus specialty, with no rng and the same result for old saves.
   - `teaching` (35–95);
   - `boost: { group, points }`, where the group comes from the role (QB→QB, OL→OL, DL→DL, Secondary→CB/S, WR→WR, LB→LB) and points run 0–2;
   - `install` (weeks to full mastery, 2–6).
2. **Position-group development.** `groupDevMultiplier(world, teamId, devGroup)` returns g in [0.95, 1.05]. It is computed as `(groupCoach − meanOfTeamCoaches)/100 × 0.3 × teachFactor(0.6–1.4)`. A group with no dedicated coach gets g = 1. The 4 existing coaches deviate around their own mean, so the club's total development is roughly unchanged; this redistributes, it doesn't inflate. Hook: `progress.ts:97` multiplies by g. **Boost:** +`points` focus points for that group's players aged ≤ `MAX_DEV_AGE`, through the existing `devPlan.ts:focusPointsFor` path, still capped by `MAX_FOCUS_BONUS`. It covers whichever clubs devPlan already covers and adds no new coverage.
3. **New user-only seats, WR Coach and LB Coach.** Add both to the `StaffRole` union. **Do not** add them to `NFL_STAFF_ROLES` or `generateStaffPool`, because that changes the rng draw order of every world. Candidates come only from the market refresh (item 6). AI clubs never get these seats, so their g stays 1. A seat helps only when the coach is better than your staff mean, and it costs salary.
4. **Scheme and install.** A hired OC or DC still sets `coachTendency` (no formula change). The MarketCard previews the install cost, which is the projected mastery drop from the existing tenure reset plus `install` weeks. When the user has authority and an install plan for that side, `installEdge` is scaled by the coordinator's teaching (×0.8–1.2). This applies only to the user's club and only when a plan exists.
5. **Game-day calls, preview only.** `callPreview(world, teamId, candidate)` returns `coachTendency` with the candidate swapped into the seat: pass-rate, tempo, 4th-down aggression, and the DC's tendency-exploit tier. This adds no new sim effect. When #26 lands, the hired coordinator is who calls through `coachTendency`.
6. **Market refresh.** `refreshStaffMarket(world, season)` runs at season rollover. It tops each coach role up to 5 Available candidates with hash-built coaches, reusing the deterministic builder in `coachingTree.ts` that backfills departures. It adds WR and LB candidates for the user market only. It caps `staffPool` at 90 by dropping the oldest unsigned entries, chosen by hash.
7. **Contracts, buyouts and vacancies (user club only).** `contractYears` ticks down at rollover. When it reaches 0, an Inbox item offers re-sign at an asking raise, or let walk. Firing mid-contract costs a buyout of 50% of the remaining years × annual, which counts as dead staff money against the budget for those seasons. A vacant OC or DC shows **−4.5 until filled**. "Promote interim" lets a position coach fill the seat at rating −4 and vacates his own seat; tenure resets. AI staff churn stays as it is (tree only).
8. **Budget (#25).** Move the budget formula into `staffMarket.ts:staffBudget(world, career)`, including dead money, so the store and the UI share it. Personality adjusts it: cheap ×0.9, win-now ×1.1. `hireStaff` blocks an offer above headroom unless `ownerStaffFundOpen`. Otherwise the UI points to the Owner Meeting card.
9. **Poaching (#21).** At rollover, an AI club with a coordinator opening can offer a promotion to one of your position coaches. Eligibility: rating ≥ 78, contract ≤ 1 year left, at most 1 offer per season, chosen by hash.
   - The offer arrives as an Inbox item: **Match** (raise ≥ 15%, and he stays if his interest clears) or **Let him go**.
   - NFL rule: you can block a lateral move but not a promotion.
   - A coach who leaves joins `career.tree` as a protégé with his role, so his success counts toward legacy and `poachAssistant` can bring him back.
   - If `TreeEntry` can't hold a non-HC role, add an optional field.
10. **Authority.** Every action is gated at `decide`. At `advise` and `view`, cards show actions disabled with the reason, as the F4 gating already does.

## Engine hooks (keep small)

- `progress.ts`: one multiply by `groupDevMultiplier`.
- `devPlan.ts:focusPointsFor` call site: add the boost points.
- `install.ts:installBonus`: the teaching scale.
- `hiring.ts:applyHire`: contract length from salary tier (2–4 years), plus a dead-money record on replace.
- Rollover in `gameStore.ts`: `refreshStaffMarket`, then `tickStaffContracts`, then `rollPoachOffers`.
- `coaching.ts` stays **unchanged**: `coordinatorEdge` is the single edge definition.
- Optional save fields only: `career.staffDeadMoney?`, `career.staffOffers?`, `TreeEntry.role?`. Old saves load without migration.

## UI touchpoints (redesigned Staff & Hiring, kit `src/ui/`, after V1 merges)

- **MarketCard.** Add:
  - a Teaching pip row;
  - a Boost chip ("QB dev +2/yr");
  - a Calls readout from `callPreview` ("Pass 61% · up-tempo · aggressive on 4th");
  - Install cost;
  - salary vs headroom, with the owner-fund state.

  The compare-vs-holder view gains teaching, boost and edge deltas, using `coordinatorEdge`.
- **MarketFilters.** Add a role chip for WR and LB, "Teaching ≥", and "Fits budget". New sort: Best teacher.
- **VacantSeats.** OC and DC show "−4.5 edge until filled", plus a "Promote interim" action that opens a ConfirmSheet with before → after values.
- **Inspector.** Add contract years left, buyout, a poach-risk badge ("Hot name — 2 clubs asking"), and the boost group.
- **Let-go ConfirmSheet.** Show the edge before → after (−4.5), the buyout, dead money by season, and the tenure-reset note.
- **Inbox.** Re-sign and poach-offer items use the existing Inbox cards.
- **Layout.** Desktop and 375px, light and dark, 44px phone controls, no horizontal scroll, with kit primitives only. Nothing in this feature touches the Analytics lane (#19).

## Calibration impact

The in-game sim is untouched: offEdge, defEdge, situational, discipline and `coachTendency` keep their formulas. AI clubs get no new seats, no contract churn and no install scaling. Both `refreshStaffMarket` and the coach profile are hash-built, so neither adds rng draws.

The real-data ×500 runs are single-season, so they must be **byte-identical to the main baseline**. The one AI-visible change is the offseason development redistribution (g around the club's own coach mean). To check it, compare a 4-season smoke against baseline: the league mean OVR change per season must stay within ±0.3, and the position-group mean OVR within ±0.5. If it misses, set the g band to ±0.03.

## Phases (DeepSeek jobs, non-overlapping files)

| Job | Files | Content | Depends |
|---|---|---|---|
| C1 engine | `staffMarket.ts` (new), `types.ts`, `progress.ts`, `devPlan.ts`, `install.ts`, `hiring.ts`, `staffProbe.ts` (new) | profile, groupDev, boost, install scale, budget, refresh/contracts/poach pure fns, probe | main |
| C2 store | `gameStore.ts`, `coachingTree.ts` | rollover hooks, hire budget gate, fire buyout, promoteInterim, resign/matchOffer actions, tree role | C1 |
| C3 UI | `src/screens/Staff.tsx`, `src/components/staffEffects.ts`, Inbox item renderer | touchpoints above, coded against C1's exported signatures | V1 merged, C1 |

C1 and C3 can run in parallel worktrees if C1's signatures are frozen in the C3 prompt. C2 merges last.

## Acceptance

- `npm run build` passes. `npm run lint` reports **exactly 4** warnings.
- Calibration: `calib.mjs` with seeds 33333, 2222 and 5150, ×500, `--eq --smoke=coach:4,personnel:4`. The 3×500 numbers must be identical to the main baseline, eq 20/20, smokes 0/0, and the anim end spots 100%. The 4-season development drift must stay within the bounds above.
- Probe `staffProbe.ts` checks the following:
  - every role and old-save coach gets a stable profile;
  - g sits in [0.95, 1.05] with mean ≈ 1 across the 4 base coaches;
  - boost points respect `MAX_FOCUS_BONUS`;
  - the market tops up to 5 per role and the pool stays ≤ 90;
  - contract tick, expiry, buyout and dead money add up correctly;
  - firing an OC gives −4.5, and an interim gives `coordinatorEdge(r−4)`;
  - a hire above headroom is refused unless funded;
  - a poach offer is deterministic, a lateral move is blockable and a promotion is not, and the departed coach appears in `career.tree`;
  - an old save without the new fields loads.
- Orchestrator browser check on an isolated port: hire a WR coach, fire an OC (vacancy −4.5 shown), promote an interim, check the budget block, check the MarketCard calls readout, at desktop and 375px in light and dark.

## Risks

- Adding roles to `NFL_STAFF_ROLES` or `generateStaffPool` would reshuffle every world's rng and break calibration. New seats must stay market-only.
- The development redistribution touches AI player trajectories. If drift fails, narrow the band; don't retune.
- `Staff.tsx` is 1850 lines and V1 is editing it right now. C3 must start from the V1 merge.
- Budget enforcement could lock a user out of filling a vacant OC or DC (−4.5). Always allow at least one hire at or below the cheapest candidate's ask, shown as "over budget — owner notified".
- #26 will add coordinator play-calling. Keep `callPreview` a thin wrapper over `coachTendency` so there is one source.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| C1 engine | ⏳ |
| C2 store | ⏳ |
| C3 UI | ⏳ (after V1) |
