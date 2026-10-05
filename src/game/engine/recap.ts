// ─────────────────────────────────────────────────────────────────────────────
// The season in 90 seconds (#20) — and the season question it answers (#11).
//
// Each season opens with one question drawn from the world ("Can the rookie QB
// handle it?", "Is the coach on the hot seat?"). The review answers it. Along
// the way we log a handful of key moments so the season can be recapped like a
// broadcast: headlines, three moments, your fingerprints, the question answered,
// and the ghost-GM verdict.
//
// All of this is deterministic from world state + seed, so a save reloads the
// same season.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, SeasonMoment, SeasonQuestion } from '../types'
import type { World } from './generate'
import { hash32, makeRng, rpick } from './rng'
import { overallRep } from './career'

/** The question the season is built around, chosen from live state at kickoff. */
export function makeSeasonQuestion(world: World, career: CareerState): SeasonQuestion {
  const rng = makeRng(world.seed + hash32(career.teamId, 41) + world.season * 7_919)
  const rec = world.standings[career.teamId]
  const lastWins = rec?.wins ?? 0
  const roster = world.roster[career.teamId] ?? []
  const qb = [...roster].filter((p) => p.pos === 'QB').sort((a, b) => b.ovr - a.ovr)[0]
  const rookie = [...roster].filter((p) => p.age <= 22).sort((a, b) => b.pot - a.pot)[0]
  const rep = overallRep(career.reputation)
  const hotSeat = career.jobSecurity < 45

  const pool: { text: string; kind: string }[] = []
  if (qb && qb.age <= 24) pool.push({ text: `Can ${qb.name} handle a full season as the starter?`, kind: 'qb' })
  if (rookie) pool.push({ text: `Will the young core — led by ${rookie.name} — take the next step?`, kind: 'young' })
  if (hotSeat) pool.push({ text: 'Can you save your job, or is this the end of the line?', kind: 'seat' })
  if (lastWins >= 11) pool.push({ text: 'Can you get back to the playoffs and win it all?', kind: 'contend' })
  if (lastWins <= 5) pool.push({ text: 'Can this club climb out of the basement?', kind: 'rebuild' })
  if (rep >= 55) pool.push({ text: 'Is this the year the league notices you?', kind: 'profile' })
  pool.push({ text: 'Can the roster stay healthy and hold the line?', kind: 'health' })

  const pick = rpick(rng, pool)
  return { season: world.season, text: pick.text, answer: undefined, good: undefined }
}

/** Answer the season question with hindsight, from how the year actually went. */
export function answerSeasonQuestion(
  q: SeasonQuestion,
  ctx: { wins: number; losses: number; madePlayoffs: boolean; wonTitle: boolean; winsDelta: number; security: number },
): SeasonQuestion {
  const { wins, losses, madePlayoffs, wonTitle, winsDelta } = ctx
  const winPct = wins / Math.max(1, wins + losses)
  const good = wonTitle || madePlayoffs || winsDelta >= 2 || winPct >= 0.6
  let answer: string
  if (wonTitle) answer = 'Answered emphatically — a championship.'
  else if (madePlayoffs) answer = `Yes — you made the playoffs at ${wins}-${losses}.`
  else if (winsDelta >= 2) answer = `Yes — you improved by ${winsDelta} wins (${wins}-${losses}).`
  else if (winPct >= 0.5) answer = `Mostly — a .500-ish finish at ${wins}-${losses}.`
  else answer = `Not really — ${wins}-${losses} left the question hanging.`
  return { ...q, answer, good }
}

/** Log a key moment during the season (kept small; the recap shows the top 3). */
export function logMoment(career: CareerState, moment: SeasonMoment): CareerState {
  const moments = [...(career.seasonMoments ?? []), moment]
  // Keep the most recent handful so saves stay small.
  return { ...career, seasonMoments: moments.slice(-8) }
}

/** Pick the three moments that tell the season's story, best first. */
export function topMoments(career: CareerState, count = 3): SeasonMoment[] {
  const moments = career.seasonMoments ?? []
  const rank = { win: 0, info: 1, loss: 2 } as const
  return [...moments]
    .sort((a, b) => rank[a.tone] - rank[b.tone] || b.week - a.week)
    .slice(0, count)
}

/** A one-line broadcast headline for the season, from the record + arcs. */
export function seasonHeadline(ctx: { wins: number; losses: number; madePlayoffs: boolean; wonTitle: boolean; winsDelta: number }): string {
  const { wins, losses, madePlayoffs, wonTitle, winsDelta } = ctx
  if (wonTitle) return 'CHAMPIONS: the confetti is yours.'
  if (madePlayoffs) return `Playoff bound at ${wins}-${losses}.`
  if (winsDelta >= 3) return `Best turnaround in the building: +${winsDelta} wins.`
  if (wins - losses <= -4) return 'A long year: the losses piled up.'
  return `A ${wins}-${losses} season — steady, unspectacular.`
}

/** The fingerprints line: how many of your guys showed up this season. */
export function fingerprintSummary(world: World, career: CareerState): { drafted: number; signed: number; total: number } {
  const roster = world.roster[career.teamId] ?? []
  let drafted = 0
  let signed = 0
  for (const p of roster) {
    const o = p.origin
    if (!o || o.by !== career.gmName) continue
    if (o.kind === 'draft' || o.kind === 'udfa') drafted++
    else if (o.kind === 'freeAgent' || o.kind === 'trade') signed++
  }
  return { drafted, signed, total: drafted + signed }
}
