// ─────────────────────────────────────────────────────────────────────────────
// Reputation is people, not bars (#4) — presentation layer.
//
// The five reputation bars stay the engine: they gate promotions and drive the
// balance model. This module adds the human layer on top — six voices (the
// owner, two players, an agent, a beat writer, a rival GM) each with a one-line
// quote derived from your actual state: job security, results, leadership, the
// Ledger, cap work, your profile. Quotes move as the career moves.
//
// Deterministic per (seed, team, season) so a save reloads the same voices.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import { NFL_TEAMS } from '../data/nflTeams'
import type { World } from './generate'
import { FIRST, LAST } from './names'
import { ownerPersonality } from './people'
import { hash32, makeRng, rpick, type Rng } from './rng'

export interface Voice {
  id: string
  /** The seat this person speaks from. */
  role: string
  name: string
  quote: string
  tone: 'win' | 'loss' | 'warn' | 'info' | 'gold'
}

const RIVAL_FIRST = ['Marcus', 'Dwayne', 'Elliot', 'Rashad', 'Kirk', 'Byron', 'Nate', 'Terrance', 'Wes', 'Hank']
const RIVAL_LAST = ['Calloway', 'Bishop', 'Vance', 'Hollis', 'Rucker', 'Marsh', 'Fontaine', 'Devers', 'Whitlock', 'Stroud']

const name = (rng: Rng) => `${rpick(rng, FIRST)} ${rpick(rng, LAST)}`

/** The six voices talking about you right now. */
export function careerVoices(world: World, career: CareerState): Voice[] {
  // Stable per career — the owner and rival GM are the same people all along.
  const rng = makeRng(world.seed + hash32(career.teamId, 71))
  const rep = career.reputation
  const rec = world.standings[career.teamId]
  const wins = rec?.wins ?? 0
  const losses = rec?.losses ?? 0
  const winPct = wins / Math.max(1, wins + losses)
  const roster = world.roster[career.teamId] ?? []
  const security = career.jobSecurity
  const owner = ownerPersonality(career.teamId)
  const ghost = career.ghostHistory?.[career.ghostHistory.length - 1]

  // ── Owner ─────────────────────────────────────────────────────────────────
  const ownerQuote =
    security >= 70
      ? owner === 'win-now'
        ? "You have my backing. But I don't hand out trophies for participation."
        : owner === 'patient'
          ? 'I believe in what you are building. The wins will come.'
          : owner === 'cheap'
            ? 'Good work keeping the books healthy. Keep it that way.'
            : "I like it. But let's talk about that depth chart — over lunch."
      : security >= 45
        ? 'I see progress. Now I need to see it in January.'
        : "This isn't what I paid for. Turn it around."
  const ownerTone: Voice['tone'] = security >= 70 ? 'win' : security >= 45 ? 'info' : 'loss'

  // ── Veteran player ────────────────────────────────────────────────────────
  const vets = [...roster].filter((p) => p.age >= 27).sort((a, b) => b.ovr - a.ovr)
  const vet = vets[0] ?? [...roster].sort((a, b) => b.ovr - a.ovr)[0]
  const vetQuote = !vet
    ? 'Ask me again when there is a roster to speak of.'
    : rep.leadership >= 65 && winPct >= 0.5
      ? 'He tells you the truth, even when it hurts. That is why we follow him.'
      : rep.leadership >= 65
        ? 'He tells you the truth, even when it hurts.'
        : winPct >= 0.6
          ? 'He has got us believing. Nobody wants to play us right now.'
          : winPct <= 0.35
            ? "We are not executing. That's on all of us — starting with him."
            : 'He is straight with us. That is all you can ask for.'
  const vetTone: Voice['tone'] = winPct >= 0.6 || rep.leadership >= 65 ? 'win' : winPct <= 0.35 ? 'warn' : 'info'

  // ── Young player (prefers one of YOUR guys, #5) ───────────────────────────
  const young = [...roster]
    .filter((p) => p.age <= 24)
    .sort((a, b) => {
      const mineA = a.origin?.by === career.gmName ? 1 : 0
      const mineB = b.origin?.by === career.gmName ? 1 : 0
      return mineB - mineA || b.pot - a.pot
    })[0]
  const youngQuote = !young
    ? 'The young room is still being built.'
    : young.origin?.by === career.gmName
      ? 'He drafted me and told me exactly what I had to become. I am not letting him down.'
      : 'He gives the young guys a real shot. You remember that.'
  const youngTone: Voice['tone'] = young?.origin?.by === career.gmName ? 'gold' : 'info'

  // ── Agent (prefers a real contact) ────────────────────────────────────────
  const agentContact = [...(career.contacts ?? [])]
    .filter((c) => c.kind === 'Agent')
    .sort((a, b) => b.relationship - a.relationship)[0]
  const agentQuote =
    rep.roster >= 60
      ? 'His guys get paid, and they get paid on time. Players notice.'
      : rep.roster >= 35
        ? 'A fair negotiator. Does not waste my time.'
        : 'Tough to close with. Everything is a fight.'
  const agentTone: Voice['tone'] = rep.roster >= 60 ? 'win' : rep.roster >= 35 ? 'info' : 'warn'

  // ── Beat writer (prefers a real contact) ──────────────────────────────────
  const writerContact = [...(career.contacts ?? [])]
    .filter((c) => c.kind === 'Beat Writer')
    .sort((a, b) => b.relationship - a.relationship)[0]
  const writerQuote =
    rep.profile >= 65
      ? 'He gives real answers. In this league, that is rare.'
      : rep.profile >= 40
        ? 'Reads the room well. Some weeks the story writes itself.'
        : 'I have covered this team for years and I still do not know what he stands for.'
  const writerTone: Voice['tone'] = rep.profile >= 65 ? 'win' : rep.profile >= 40 ? 'info' : 'warn'

  // ── Rival GM (division rival) ─────────────────────────────────────────────
  const me = world.byId[career.teamId]
  const rivalPool = NFL_TEAMS.filter(
    (t) => t.id !== career.teamId && t.conference === me.conference && t.division === me.division,
  )
  const rivalTeam = rpick(rng, rivalPool)
  const rivalQuote =
    rep.results >= 60 || (ghost && ghost.delta >= 2)
      ? 'I have watched the tape. They are better than the record says — and I hate it.'
      : rep.results >= 35
        ? 'They are a problem on Sundays. Annoyingly.'
        : 'They will be fine. Eventually.'
  const rivalTone: Voice['tone'] = rep.results >= 60 ? 'gold' : rep.results >= 35 ? 'info' : 'warn'

  return [
    { id: 'owner', role: 'Owner', name: name(rng), quote: ownerQuote, tone: ownerTone },
    {
      id: 'veteran',
      role: 'Veteran leader',
      name: vet?.name ?? 'The locker room',
      quote: vetQuote,
      tone: vetTone,
    },
    {
      id: 'young',
      role: 'Rising player',
      name: young?.name ?? 'A rookie',
      quote: youngQuote,
      tone: youngTone,
    },
    {
      id: 'agent',
      role: 'Player agent',
      name: agentContact?.name ?? name(rng),
      quote: agentQuote,
      tone: agentTone,
    },
    {
      id: 'writer',
      role: 'Beat writer',
      name: writerContact?.name ?? name(rng),
      quote: writerQuote,
      tone: writerTone,
    },
    {
      id: 'rival',
      role: `GM, ${rivalTeam.name}`,
      name: `${rpick(rng, RIVAL_FIRST)} ${rpick(rng, RIVAL_LAST)}`,
      quote: rivalQuote,
      tone: rivalTone,
    },
  ]
}
