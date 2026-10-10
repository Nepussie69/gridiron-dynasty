# Free-agency frenzy — FUTURES #11

User (FUTURES list, 2026-10-08, L14): March bidding window: competing AI offers with deadlines, players choosing money vs fit/winning/culture/role, a live negotiation board. Builds on the existing free agency, culture K2 (backlog #43) and the 3-year cap planner (#18).

## Goal

March stops being one click. The top of the market goes to a short bidding window (7 "days"). Rival clubs make priced offers that expire, the best free agents weigh **money, role, scheme fit, winning and culture** by their own priorities, and the user works a live board: bid, raise, watch the leader change, lose a guy to a contender. Depth players still sign instantly, as they do now.

## Already built (extend these, do not fork them)

- **Calendar.** `src/game/engine/draft.ts:stageOf` / `OFFSEASON_STAGES` (`resign → freeAgency → draft → camp`); `gameStore.ts:advanceOffseason` (~l.1742) opens March with a news item and, when leaving March, runs `runAIFreeAgency` once (`world.offseasonDone.fa`). `completeOffseasonStages` (~l.4396) is the fast path.
- **User signing.** `gameStore.ts:signFreeAgent` (~l.2537): instant, **1-year** deal from `progress.ts:freeAgentContract` at market × Negotiation skill × (1 − K2 pct). Blocked in February. GM route: `requestGmSignFreeAgent` (~l.3029).
- **AI market.** `progress.ts:runAIFreeAgency`: need table per position, `marketPrice`, culture-qualified clubs go first, 2-year AI deals, cap-floor top-ups. Also called by `balance.ts` (l.325/587/770) and `marketProbe`/`balanceProbe` clones (~l.5489).
- **Agents.** `negotiation.ts:agentStyle` (hardball/market/loyal by player id), `marketAsk`, `judgeOffer` (pct of ask + guarantee boost − age/length penalty), `ExtensionOffer {years, aav, guarantee}`, `buildExtension` (bonus/proration/guarantee shape).
- **Culture K2.** `culture.ts:clubCulture`, `discountFromClub` (winning −4%, top unit on his side −3%, cap 6%), `cultureDiscountFor`, `cultureQualifiedClubs`.
- **Fit / role inputs.** `style.ts:schemeFit(p, scheme, side)`; `depth.ts:depthAt(world, teamId, pos)`; `generate.ts:teamStrength`; `lockerRoom.ts` morale; `cap.ts:summarizeCap`, `capForSeason`, `deadMoney`.
- **Cap planner.** `capPlan.ts:projectCap(roster, dead, season, horizon=3)`, `projectedCapHit`; shown on `screens/Cap.tsx`.
- **Pattern to copy.** `deadline.ts` (FUTURES #9: offers, deterministic `hash32`, news item, opt-in AI flurry) and `draftTrades.ts` (#10: offers on a clock, cached per world stamp).
- **Probe.** `gameStore.ts:faFlowProbe` (~l.5745) registered as `window.__faFlowProbe` in `src/main.tsx`.
- **Redesigned screen.** `ui-redesign:src/screens/FreeAgency.tsx` uses kit `AccessBanner, Badge, Button, Card, ConfirmSheet, FilterChip, KpiStrip, KpiTile, OvrBadge, PageHeader` + `ShadowBoardCard`, `GmAskButton`, `dealFor()`.

Gaps: no competing bids, no deadlines, no player preference beyond price, user FA deals are 1-year only, AI acts only after the user leaves March.

## Design

1. **The window.** On `resign → freeAgency`, `openFrenzy(world, userTeamId, db)` picks the **lots**: top ~40 unsigned free agents by OVR (min OVR 70 scaled, all K/P excluded), and gives each a **decision day** (1–7; stars decide later: 90+ day 5–7, 80s day 3–5, others day 1–3, jittered by `hash32(id+season)`). Everyone else in `freeAgents` stays instant-sign through `signFreeAgent`, unchanged.
2. **Player priorities.** Per lot, deterministic weights summing to 1 over **money, role, fit, winning, culture**, from `hash32` + age + agent style: hardball → money ≥ 0.5; loyal → culture/role up; age ≥ 30 → winning up; age ≤ 26 → role/money up. Shown to the user only as words ("Chasing a ring", "Wants to start", "Best offer wins") unless scouted (shadow board = exact bars).
3. **Offer score.** For each offer: `money` = `judgeOffer`-style effective pct of `marketAsk` (guarantee boost, length/age penalty) normalised; `role` = projected depth slot at that club (`depthAt`: starter / rotation / backup); `fit` = `schemeFit` vs the club's scheme on his side; `winning` = last-season win% + `teamStrength` rank; `culture` = K2 `discountFromClub` pct expressed as a money-equivalent. **No double counting:** in the frenzy the K2 pct is *not* taken off the ask; it enters only through the culture term, scaled so a player with average culture weight values it exactly like today's discount. A previous club (re-sign rejection in February) gets a small loyalty bump for `loyal` agents.
4. **AI bidders.** Each day, every NFL club with a need (same table as `runAIFreeAgency` — export it as `FA_NEEDS` rather than copying) and cap room this year **and** next (`projectCap`, horizon 2, ≤ 98% of cap) may bid on lots at its need positions: AAV 90–115% of `marketPrice`, years 1–4 by age, guarantee by club cap health; contenders (top-10 `teamStrength`) bid on stars, rebuilders on ≤ 28-year-olds. **Offers expire** after 2 days unless renewed; each day an AI club already beaten may raise once (+3–8%) or walk. Per club ≤ 3 open offers. All choices by `hash32(seed, season, day, club, lot)` — no rng stream draws.
5. **Decisions.** A lot signs on its decision day with the best-scoring live offer, or **early** when an offer beats his walk-away line by ≥ 10 points ("take it now"). Unsigned lots at day 7 fall back into `freeAgents` for `runAIFreeAgency`, which runs unchanged when leaving March.
6. **User bids.** `placeFrenzyOffer(lotId, {years 1–5, aav, guarantee})` checks access (`canSignFreeAgents` / `accessFor(...'freeagency')`), cap room this year and the 3-year projection, and records a binding offer (raise-only; withdrawing costs the club that player's trust: −5 on its score for him). Agent feedback each day: "Leading", "Within 5%", "Behind — a contender is at ~$X" (rounded, not exact). Without authority the user can push the GM via the existing `requestGmSignFreeAgent` path, which bids on the user's behalf.
7. **Contracts.** New `buildFreeAgentDeal(p, season, offer)` mirrors `buildExtension` (signing bonus, proration, escalating base, guarantees, `recomputeCapHit`) for a fresh contract; used by both user and AI frenzy signings so dead money and the cap planner see real multi-year deals. Origin/ledger as in `signFreeAgent` (`ledgerFreeAgent`, shadow-board note).
8. **News.** Daily digest item (`pushCareerNews`): biggest signings, "X spurns the money for a contender", user wins/losses.

## Engine hooks

- New `src/game/engine/faFrenzy.ts`: types `FrenzyState {day, lots, log}`, `FrenzyLot {playerId, decisionDay, priorities, offers, status, signedWith?}`, `FrenzyOffer {teamId, years, aav, guarantee, madeDay, expiresDay}`; `openFrenzy`, `frenzyPriorities`, `scoreOffer`, `aiBidDay`, `advanceFrenzyDay`, `resolveFrenzy`, `buildFreeAgentDeal`, `frenzyStanding(world, lotId, teamId)`, `frenzyNewsItem`.
- `generate.ts` World: optional `faFrenzy?: FrenzyState` (old saves valid; absent = old behaviour).
- `progress.ts`: export the need table as `FA_NEEDS` (no logic change in `runAIFreeAgency`).
- `gameStore.ts`: `openFrenzy` on `resign → freeAgency`; `advanceFrenzyDay` action; `resolveFrenzy` before `runAIFreeAgency` when leaving March and in `completeOffseasonStages`; `signFreeAgent` on a live lot toasts "He's taking bids — make an offer on the board"; `placeFrenzyOffer`, `withdrawFrenzyOffer`; `faFrenzyProbe` + `window.__faFrenzyProbe` in `main.tsx`.

## UI touchpoints (redesigned screens, kit only)

- **FreeAgency.tsx** (ui-redesign): `Tabs` "Frenzy board / All free agents / Waivers" during March. Board = `KpiStrip` (day x/7, cap space, 3-yr room from `projectCap`, open bids) + list of lots: `OvrBadge`, ask (`Money`), suitors count, `VerdictChip` standing, decision-day countdown, priority words as `Badge`s.
- **New `components/FrenzyLotInspector.tsx`**: `WithInspector`/`Inspector` (desktop), `Sheet` (375px). Priorities as `RatingBar`s; your offer vs leader per factor as `DivergingMeter`; offer builder: `SegmentedControl` years, `OptionGroup` guarantee, AAV stepper; `BudgetMeter` this year + next 2 seasons after the deal; `ConfirmSheet` to submit (binding).
- **Advance control**: "Next day" `Button` on the board; leaving March still uses the existing calendar control (resolves remaining days first, with a `ConfirmSheet` if bids are live).
- **CareerHub / news**: March card "Frenzy: day 3 — 2 bids live, 1 leading" linking to the board.
- Desktop + 375px, light/dark, 44px targets, no horizontal scroll (phone rules from D7).

## Calibration impact

Game-day sim untouched (no `playsim.ts`, `sim.ts`, gameplan, ratings). `balance.ts` and `marketProbe`/`balanceProbe` never open the frenzy, so the 31 NFL bands, eq and smokes are identical to the current main baseline by construction. Career-world economics change only in a user career: guarded by the probe bands below (payroll floor, cap compliance, AAV vs market) so contracts stay NFL-shaped.

## Phases (DeepSeek jobs, non-overlapping files)

| Job | Files | Depends |
|---|---|---|
| **FA1 engine** | new `src/game/engine/faFrenzy.ts`; `generate.ts` (one optional World field); `progress.ts` (export `FA_NEEDS` only) | main |
| **FA2 store + probe** | `src/store/gameStore.ts`, `src/main.tsx` | FA1 merged |
| **FA3 UI** (worktree off ui-redesign after main merge) | `src/screens/FreeAgency.tsx`, new `src/components/FrenzyLotInspector.tsx`, `src/screens/CareerHub.tsx` (March card only) | FA1+FA2 on main, main merged into ui-redesign |

FA1 can start now in parallel with any job that does not touch those three files. FA3 must not edit `src/ui/kit*` (kit is frozen; add nothing there).

## Acceptance

- Build passes; lint exactly 4 warnings.
- Calibration real-data 33333/2222/5150 ×500 `--eq --smoke=coach:4,personnel:4`: points identical to the current main baseline, all NFL bands green, eq 20/20, smokes 0/0. `__balanceProbe` / `__marketProbe` / `__faFlowProbe` outputs identical to baseline.
- `__faFrenzyProbe` (10 seeds × 3 offseasons, user passive and user bidding): deterministic (same seed → same signings); no player signed twice or left on two rosters; every NFL roster ≥ floor and payroll ≥ cap floor after March; 0 cap violations now and in `projectCap` +1; frenzy AAV / `marketPrice` mean 0.98–1.12, every deal 0.85–1.35; top-40 lots: highest-money offer wins 55–75% (choices matter, money still leads); contenders/K2 clubs win more stars than rebuilders; ≥ 1 offer expiry and ≥ 1 early "take it now" per run; K2 pct never applied twice; old save without `faFrenzy` loads and plays March as before; withdrawing applies the trust penalty.
- Orchestrator browser check (redesign): board, inspector, offer sheet, day advance, lost-bidding news, desktop + 375px, light/dark.

## Risks

- **Double counting culture** (K2 discount + culture term) — tested in probe.
- **`runAIFreeAgency` sees a thinner pool**: need-filling may fall to cheap bodies; the floor/payroll checks catch it. Its rng seed is untouched.
- **Multi-year user deals** change dead money and the cap planner — reuse `buildExtension` maths, probe `deadMoney` on a released frenzy signing.
- **Exploits**: bid-and-withdraw, max-years lowball, bidding with no access — raise-only binding offers, trust penalty, access gate.
- **Save size**: ~40 lots × few offers; trim `log` to 30 lines; clear `faFrenzy` when the draft opens.
- **Merge conflicts**: `gameStore.ts` is hot — keep FA2 edits to small hooks; FA3 waits for main → ui-redesign merge.

## Progress

| Item | Status |
|---|---|
| Spec | ✅ 2026-10-11 |
| FA1 engine | ⏳ |
| FA2 store + probe | ⏳ |
| FA3 UI (redesign) | ⏳ |
