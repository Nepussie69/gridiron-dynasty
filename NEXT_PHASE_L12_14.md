# NEXT PHASE — L12.14 "Contracts: fixed 2025 cap, head coach asks the GM, sane dead money" (user requests, 2026-10-08)

_Planned by Claude Opus 5.5. Implement with DeepSeek Flash. Lint baseline 4. Contract-pricing changes here are user-approved (2026-10-08)._
User: "with extensions or updates to players' contracts, how does it work? Can the head coach ask the GM to push for it? … never increase cap space per year, just keep it all at once" → then "keep it at 2025".

## Found in code
- `cap.ts`: `CAP_2026 = 279_200_000` (that is the real **2025** NFL cap) and `capForSeason(season) = CAP_2026 × 1.07^(season − 2026)`; `capScale` inflates market values with it (used in negotiation.ts, progress.ts, waivers.ts, generate.ts, scenarios.ts, gameStore.ts).
- Extensions: `offerExtension` / `extendPlayer` need the `negotiate` capability (personnel rungs 6–8: Director of Player Personnel, Assistant GM, GM). Coaches can't touch contracts.
- Dead money looks far too big (user screenshot: $115.5M dead on a $45.6M cap hit). Known drift: dead ≈ the whole remaining contract for fully-guaranteed star deals.

## Tasks
| Task | What | Status |
|---|---|---|
| C1 | **Fixed cap**: rename `CAP_2026` → `SALARY_CAP` = 279,200,000 (the 2025 NFL cap); `capForSeason` returns it for every season; `capScale` ≡ 1. Sweep every caller; contracts, minimums, rookie scale and FA asks stop inflating. Saves: nothing to migrate (values are derived). UI labels "2025 cap · fixed". | not started |
| C2 | **Market sanity at 2025 levels**: compare generated/real contract AAVs to 2025 top-of-market by position (approx. public figures: QB ~$55–60M, EDGE ~$40–46M, WR ~$35–40M, DT ~$30–34M, OT ~$28–30M, CB ~$25–30M, OG ~$20–23M, S ~$20M, LB ~$20M, RB ~$19M, TE ~$17–19M, C ~$18M, K ~$6M, P ~$4M) and league cap use 0.76–0.90 (`__balanceProbe`). Only adjust if a position's top-5 AAV is >15% outside its band; report the table. | not started |
| C3 | **Dead money**: audit `deadMoney()` and the release/trade paths. Real NFL rule: dead money = remaining **prorated signing bonus** (all remaining years, or this year + June-1 split) + **guaranteed salary still owed**; never more than the remaining total contract value. Fix the formula/drift; add `__deadMoneyProbe()` listing the 20 biggest dead-money values vs remaining contract value; no case may exceed remaining value. | not started |
| C4 | **Head coach asks the GM**: for coaching rungs with `callPlays` or HC (no `negotiate`), a player profile / roster action **"Ask the GM to extend"** (once per player per season). The AI GM decides deterministically from: player OVR/age/position value, remaining years (≤ 2), team cap space after the deal, the HC's standing (leadership reputation + job security) and the owner's mandate. Outcomes: **Extends** (AI negotiates at market via the existing extension pricing; inbox: "GM extended X: 4 yrs / $72M") · **Not now** (reason: cap, age, or "we'll revisit after the season") · **Declined** (reason). Coordinators can only ask for their side of the ball. Shows the GM's reply in the inbox and a small leadership +1 if the extended player later starts and performs (cap ±3/season like other features). | not started |
| C6 | **GM requests desk** (P2, user request): the head coach and GM work together — see below | not started |
| C5 | **How it works panel**: on the extension card and the Cap screen, a short explainer: who can negotiate at your rung, what the GM weighs, the fixed cap, dead money rules — with live numbers for the player shown. | not started |

## C6 — GM requests desk (P2; user: "ask the GM to extend or restructure to make a push in trade or free agency, or ask for a release, so the head coach and GM can work together")
For coaching rungs without the `negotiate` / `signFreeAgents` capabilities (HC; coordinators for their side only). A **GM requests** card on My Career + context buttons on player rows/profiles, Trade Center and Free Agency. Each request goes to the AI GM, answers in the inbox (deterministic, no rng), with a reason and live numbers:
- **Extend player** (C4).
- **Restructure to clear cap** for a push: GM converts base salary to bonus on 1–3 big contracts (existing restructure logic) if the club is contending (playoff spot / top-12 strength) and the cap gain is needed for a named target; reply shows cap freed this year and the dead-money risk added later.
- **Go get this player** (trade target from Trade Center / team pages / trade block): GM attempts a deal with `findPackagesFor`, protecting players the HC marks "untouchable" (max 3) and the starters at the HC's side; executes the best acceptable package if within the owner's mandate and cap, else replies why (price, cap, mandate).
- **Sign this free agent** (FA screen): GM bids at market if cap space after the bid ≥ a reserve; restructures first if the HC also approved restructures this season.
- **Release / cut this player**: GM agrees if dead money ≤ cap saved and he isn't a top-3 starter at his position (or the HC's request is backed by poor production); shows cap saved vs dead money.
- Limits: 3 open requests at a time, 1 per player per month; GM trust: answers lean "yes" more when the HC's leadership rep and the team's record are high, "no" when job security is low or the owner mandate is rebuild (or win-now for cuts of veterans). Every outcome is logged in the Ledger (coaching kind `gmRequest`) and graded later (did the move help?).
- AI-vs-AI unchanged; the GM uses only existing trade/FA/contract functions; no pricing changes beyond C1–C3.

## Acceptance
build + lint 4; `__balanceProbe` cap use 0.76–0.90 over 6 seasons on 3 seeds with a flat cap; `__deadMoneyProbe` no case > remaining value; `careerSmoke(6, both)` 0/0; equivalence 20/20; `simTest` unchanged (no sim change); C4 works for a HC career (probe: ask for 3 players, report outcomes).

## DO NOT
No rng draws; no changes to gates, objectives, capabilities lists (C4 is a new action for coaching rungs, not a new capability for personnel), `evaluateTrade`. Optional save fields only. Canonical player objects. No new dependencies. No temp files in the repo. Do not edit `*.md`. No git commands.
