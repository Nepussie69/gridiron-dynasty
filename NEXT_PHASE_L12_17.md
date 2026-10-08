# NEXT PHASE — L12.17 "Press conferences" (FUTURES row 20)

_Spec by Claude Opus 5.5, 2026-10-08. Runs in parallel (new engine module + one card + store action; no sim). Lint baseline 4._
Answers at the podium move owner trust (job security), player morale and your profile. Modelled on the weekly dilemma (`src/game/engine/dilemma.ts`, `WeeklyDecision.tsx`, `resolveDilemma` in the store): deterministic from (seed, season, week), re-loads the same card, choice stored on the career.

## Tasks
| Task | What | Status |
|---|---|---|
| PC1 | `src/game/engine/press.ts`: `currentPresser(world, career)` → after each game played (regular season + playoffs) a presser with 2–3 questions drawn from live state: the result and margin, a star's big/poor game (from that game's box score), an injury, the hot seat (`jobSecurity < 45`), a rival next week (`rivalry.ts`), a trade rumour / contract year player, a losing streak, a playoff race. Reporters from `dilemma.ts`'s `REPORTERS`. Each question has 3 answers with a tone (Confident / Deflect / Honest / Fiery / Protect the player) and visible effects: `security` −4..+4, `morale` for the named player or the whole roster −5..+5, `repDelta.profile` −2..+3, sometimes `leadership` ±1. Deterministic (hash of seed/season/week/question), no world rng. | not started |
| PC2 | Consequences that remember: a guarantee ("we'll win next week") stored on the career; if the next game is lost → security −5 and a headline, if won → profile +2. Calling out a player → his morale −6, the rest +1 (accountability), and he remembers it for the season (worse morale recovery). Protecting a struggling player → his morale +5, owner −1 if the club keeps losing. Totals capped per season: profile ≤ +6, security within ±10 from pressers. | not started |
| PC3 | UI: a "Press conference" card after a game (Dashboard, and on the post-game screen of MatchView if it has one), question by question with the answer buttons showing their effects chips; skip = "No comment" (neutral, small profile −1). Result lines go to the Inbox/news ("{coach}: 'We'll be back.'"). Optional new save field `career.press?: { season, week, answers: string[], guarantee? }`. Works for every role that faces the media (head coach, GM; coordinators get a shorter 1-question presser; scouts none). | not started |
| PC4 | Probe `__pressProbe(seasons=3, seed)` (register in `main.tsx`): auto-answers with each tone policy over full seasons via the existing season-advance helpers and prints totals of security/morale/profile per policy, to show no policy is a free win (each total within the caps; at least one cost per policy). | not started |

## Acceptance
build + lint 4; `__gameDayEquivalence(20)` 20/20; smokes 0/0; `__pressProbe` shows caps hold; browser: play a week, answer a presser, reload — same card resolved, effects applied once.

## DO NOT
No sim/playsim/balance constants; no changes to gates/objectives/capabilities; no rng draws from the world rng; new save fields optional only. Do not touch `playAnim.ts`, `MatchView.tsx` beyond adding the card mount, `playsim.ts`, `playbook.ts`, `cap.ts`, `negotiation.ts`, `Awards.tsx`, `persistence.ts` (other pushes own them). No new dependencies. Do not edit any `*.md` file. No git commands.
