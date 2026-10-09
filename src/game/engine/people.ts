// ─────────────────────────────────────────────────────────────────────────────
// People & the living world.
//
// #9  contacts who travel with you
// #11 mentors with philosophies + your coaching tree
// #12 a rival class climbing alongside you
// #13 a media layer that notices you
// #14 bosses with agendas
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Contact, LeagueTier, NewsItem, Rival } from '../types'
import type { World } from './generate'
import { NFL_TEAMS } from '../data/nflTeams'
import { FIRST, LAST } from './names'
import { ladderFor, overallRep } from './career'
import { clamp, hash32, rint, rpick, type Rng } from './rng'
import { REGIONS } from './evaluation'

// ── Contacts (#9) ────────────────────────────────────────────────────────────
const CONTACT_KINDS: Contact['kind'][] = ['High School Coach', 'Trainer', 'NFL Scout', 'Agent']

export function makeContacts(rng: Rng, region: string, count = 4): Contact[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c_${region}_${i}_${rint(rng, 1000, 9999)}`,
    name: `${rpick(rng, FIRST)} ${rpick(rng, LAST)}`,
    kind: rpick(rng, CONTACT_KINDS),
    region,
    relationship: rint(rng, 30, 55),
  }))
}

/** At season end, relationships drift and the good ones climb the ladder. */
export function advanceContacts(contacts: Contact[], rng: Rng): Contact[] {
  return contacts.map((c) => {
    const relationship = clamp(c.relationship + (rng() < 0.65 ? rint(rng, 2, 8) : -rint(rng, 1, 5)), 0, 100)
    let role = c.role
    let teamId = c.teamId
    if (relationship >= 70 && rng() < 0.4) {
      // The relationships that matter climb the pro ladder with you.
      role = c.kind === 'High School Coach' ? 'NFL Area Scout' : c.kind === 'NFL Scout' ? 'NFL Pro Scout' : c.kind === 'Trainer' ? 'Strength Coach' : 'Certified Agent'
      teamId = rpick(rng, NFL_TEAMS).id
    }
    return { ...c, relationship, role, teamId }
  })
}

/** What a contact is worth to you right now. */
export function contactIntel(c: Contact): string {
  if (c.relationship >= 75) return 'Feeds you tips and honest character intel.'
  if (c.relationship >= 50) return 'Will talk when it matters.'
  return 'Distant — invest time here.'
}

// ── Owner personality & mandate (#14) ────────────────────────────────────────
export type OwnerPersonality = 'meddling' | 'patient' | 'cheap' | 'win-now'
const PERSONALITIES: OwnerPersonality[] = ['meddling', 'patient', 'cheap', 'win-now']

export function ownerPersonality(teamId: string): OwnerPersonality {
  return PERSONALITIES[hash32(teamId, 61) % PERSONALITIES.length]
}

export function ownerPersonalityLabel(p: OwnerPersonality): string {
  return p === 'meddling' ? 'Meddling' : p === 'patient' ? 'Patient' : p === 'cheap' ? 'Cost-conscious' : 'Win-now'
}

export function ownerMandate(teamId: string, _tier: LeagueTier): string {
  const p = ownerPersonality(teamId)
  return p === 'win-now'
    ? 'The owner expects a playoff push now — no rebuilding.'
    : p === 'cheap'
      ? 'The owner wants value: build through the draft, stay flexible.'
      : p === 'meddling'
        ? 'The owner has opinions on your lineup. Manage up.'
        : 'The owner will give you time — but wants visible progress.'
}

// ── Rivals (#12) ─────────────────────────────────────────────────────────────
/** Each rival climbs on their own track a bit each season. */
export function advanceRivals(world: World, rng: Rng): Rival[] {
  return world.rivals.map((r) => {
    const ladder = ladderFor(r.path)
    const next = ladder[r.level + 1]
    let reputation = clamp(r.reputation + rint(rng, 2, 6), 0, 100)
    let level = r.level
    let teamId = r.teamId
    let tier = r.tier
    if (next) {
      const gateOk = Object.entries(next.gate).every(([, v]) => reputation >= (v as number) * 0.7)
      if (gateOk && rng() < 0.45) {
        level = r.level + 1
        tier = 'NFL'
        teamId = rpick(rng, NFL_TEAMS).id
      }
    }
    return { ...r, reputation: Math.round(reputation), level, tier, teamId }
  })
}

export function rivalTitle(r: Rival): string {
  const ladder = ladderFor(r.path)
  return ladder[clamp(r.level, 0, ladder.length - 1)].title
}

// ── Media (#13) ──────────────────────────────────────────────────────────────
const BEAT = [
  'questions the roster’s depth',
  'praises the culture inside the building',
  'wonders if the coordinator is on the hot seat',
  'notes the club’s cap flexibility',
]
const INSIDER = [
  'lists your program among the league’s smartest front offices',
  'hears your name in connection with an opening',
  'is watching how your young core develops',
]

/** A couple of media items each week — and the lists your profile earns. */
export function mediaItems(world: World, career: CareerState, rng: Rng): { category: NewsItem['category']; headline: string; body: string }[] {
  const out: { category: NewsItem['category']; headline: string; body: string }[] = []
  const profile = career.reputation.profile
  const rep = overallRep(career.reputation)
  if (rng() < 0.5) {
    out.push({
      category: 'League',
      headline: `Beat writer ${rpick(rng, BEAT)}`,
      body: `Around ${world.byId[career.teamId]?.name ?? 'the club'}, the local beat keeps asking the same question.`,
    })
  }
  if (profile >= 55 && rng() < 0.5) {
    out.push({ category: 'League', headline: `Insider: “Rising execs to watch”`, body: `A national insider ${rpick(rng, INSIDER)}. Your profile is doing the talking.` })
  }
  if (profile >= 72 && rng() < 0.5) {
    out.push({ category: 'League', headline: `Your name surfaces in GM rumors`, body: `Industry chatter links you to openings. Some links are real; some are pure noise.` })
  }
  if (rep >= 65 && rng() < 0.4) {
    out.push({ category: 'League', headline: `Around the league: ${career.gmName} on the shortlist`, body: `Decision-makers around the sport have you on their radar.` })
  }
  return out
}

// ── Mentor & coaching tree (#11) ─────────────────────────────────────────────
const PHILOSOPHIES = ['tape', 'measurables', 'character', 'analytics'] as const
export type Philosophy = (typeof PHILOSOPHIES)[number]

export function philosophyLabel(p: string): string {
  return p === 'tape' ? 'Tape-first' : p === 'measurables' ? 'Measurables' : p === 'character' ? 'Character-first' : 'Analytics'
}

/** The boss who will shape you at this club. */
export function mentorFor(world: World, teamId: string): { name: string; philosophy: string; teamId: string } {
  const staff = world.staff[teamId] ?? []
  const hc = staff.find((s) => s.role === 'Head Coach')
  const name = hc?.name ?? `${FIRST[hash32(teamId, 31) % FIRST.length]} ${LAST[hash32(teamId, 37) % LAST.length]}`
  const philosophy = PHILOSOPHIES[hash32(teamId + name, 5) % PHILOSOPHIES.length]
  return { name, philosophy, teamId }
}

// FUTURES 21: the coaching tree moved to engine/coachingTree.ts (it now runs the
// full hire-away / record / poach-back loop with a stable hash, not rng draws).

export { REGIONS }
