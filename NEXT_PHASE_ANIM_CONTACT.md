# Visible catches and tackles — backlog 128–129

User requests completed kick returns and pass catches with actual tackling contact, especially on returns; players must not simply stop with nobody tackling them.

## Ownership and boundaries

DeepSeek owns ONLY pure presentation changes in `src/components/playAnim.ts`, `src/components/jersey.ts`, and an optional dedicated animation probe in `src/components/`. Other workers own realism/simulation; you are not alone, never revert their work. Do NOT edit engine/store/types, sim results, yardage, RNG, persisted fields, other UI, markdown, deps, git, servers, stable4173, or publishing. This can run alongside realism because it must leave every simulated outcome unchanged. If missing sim tackle IDs prevent exact attribution, use the existing eligible coverage actor as visual fallback and report it; do not invent defensive stats.

## Requirements

1. Kick/punt returns: ball reaches the actual returner's actor at the catch; holder changes at exactly that time; carrier moves sideways/upfield in correct direction to the recorded end spot. Coverage pursues the moving carrier, gets past blockers where appropriate, and at least one eligible opposing actor makes visible contact at the final stop before both settle. Current buildKickoff stops coverage ≥3 yards beyond the x spot but unrelated y, buildPunt moves blockers/coverage to static points. Replace those stops with proper coverage pursuit/contact.
2. Completed passes: ball and receiver coincide at catch, receiver retains it through YAC, and a credited tackler when available reaches the receiver at the final recorded tackle spot/time. Map actual tackleIds via actorPlayers/context; do not show an unrelated player or non-credited missed tackler making the finish when metadata exists. No play ending on a motionless receiver with all defenders distant.
3. Treat TDs, OOB, fair catches, downed punts, touchbacks, incompletions/drops/interceptions distinctly: no invented tackle on a TD, OOB, fair catch or touchback; no completed catch on an incomplete. Fumbles/defensive returns remain coherent, correct possession and direction. Do not end every return by force if sim says TD/OOB.
4. Preserve rating-based movement, smooth acceleration and correct animation end spots. No teleports, post-stop defender pileup, wrong-way carrier run, jumping ball or freeze. If timing must extend so a defender can physically reach the recorded stop, coordinate catch/return/flight duration and explain, keep yardage fixed. Use existing movers and pursuit helpers.

## Verification

Build pass; lint exactly4; real-data three seeds33333/2222/5150 ×500 --eq --smoke=coach:4,personnel:4; outputs must exactly match unchanged base sim (do not tune pre-existing calibration misses); eq20/20 and smokes0/0; animation end spots100%.

Add/run a meaningful independent focused contact audit over ≥60 games, all three seeds: each actual return catch and completed-pass catch has ball/holder distance ≤0.25yd at catch; each inbounds non-TD tackle finish has an eligible opposing tackler within ≤1yd at terminal contact with overlapping arrival timing; 100% correct end spots. Report denominators/misses for kick returns, punt returns and passes separately. Audit TD/OOB/fair-catch/touchback/incomplete exclusions and maximum movement-frame delta, compare baseline. No tests merely restating implementation. Browser inspect at least one kick return, punt return and catch/YAC tackle if available; report honestly if only offline visualization possible. Store logs /private/tmp/animcontact-verify.out and focused probe path.

## Progress

| Item | Status |
|---|---|
| Return/pass catch and tackle animation contact | DeepSeek isolated presentation work; acceptance pending |
