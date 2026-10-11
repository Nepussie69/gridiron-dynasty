// ─────────────────────────────────────────────────────────────────────────────
// J36 (FUTURES #36): individual scouting reports.
//
// A club's staff watches the NEXT opponent's individual players and writes up
// their tendencies: "CB bites on double moves", "RB puts the ball on the
// ground", "LT struggles with speed rushers". Each candidate weakness is read
// from THAT player's own effective ratings (the same `playerAttrs` merge the
// sim uses, development gains included) — never a team/unit average or a roster
// mean. How many weaknesses the staff find, and how accurately they read them,
// is driven by the specific staff in the seat: the Analyst/Tendencies coach's
// `reads` sub (J9 `coachSubs`) plus the club's scouting staff rating. An elite
// staff finds most of the real weaknesses and few false ones; a poor staff finds
// fewer and invents reads on strong players.
//
// Everything here is PURE and deterministic: `hash32`/`h01` of the save seed,
// the week, the opponent club and the player id. No rng() draw exists in this
// module (so the OFF path's rng stream is untouched), and no store write — an
// old save derives the same report on read.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp, hash32 } from './rng'
import { playerAttrs } from '../data/ratings'
import { positionRating } from './individual'
import { coachSubs } from './coachSubs'
import { unscaleOvr } from './ovrScale'
import type { Player, StaffMember, Position } from '../types'
import type { World } from './generate'

/** J36: one line of a staff's scouting report on an opponent player. */
export interface ScoutFinding {
  playerId: string
  pos: string
  /** Stable tag id for the weakness ("cb-bite", "rb-fumble", …). */
  tag: string
  /** The plain-English report line ("CB Sauce Gardner bites on double moves"). */
  text: string
  /** True when the player really is weak on that trait; false = a mistaken read. */
  trueWeakness: boolean
  /** The staff's own certainty, 0..1 (read quality + how pronounced the weakness is). */
  confidence: number
}

/**
 * J36 tunables — the only new constants this job adds (the brief's "one exported
 * const object"). All are deterministic thresholds; none is an rng() draw.
 */
export const J36_SCOUT = {
  /** How far a candidate must sit below the tag's reference to count as a real weakness. */
  minWeak: 2,
  /** A weakness this far below the reference is read at full strength. */
  fullW: 12,
  /** Share of real weaknesses an average (quality 0.5) staff finds, before strength. */
  findBase: 0.08,
  /** Added to `findBase` across the staff-quality range 0..1. */
  findSpread: 0.92,
  /** Share of non-weak players a quality-0 staff wrongly flags. */
  falseBase: 0.5,
  /** How fast false reads fall away as staff quality rises. */
  falseExp: 1.6,
  /** Confidence floor/ceiling and quality weighting. */
  confBase: 0.42,
  confQ: 0.42,
  confW: 0.012,
  /** False reads are always given a low confidence. */
  confFalse: 0.16,
  /** Most lines a report can carry. */
  maxFindings: 10,
  /** Prospective starters per position considered (a report is about players who play). */
  depthPerPos: 4,
  /** Staff-quality reference band: a `reads`/scout pair at `lo` scores 0, at `hi` 1. */
  staffLo: 52,
  staffHi: 88,
  /** Weight of the Analyst/Tendencies `reads` sub vs. the scouting staff rating. */
  readsWeight: 0.65,
  /** A player at/above the tag reference counts as "not weak" and may be falsely read. */
  strongMargin: 0,
} as const

// ── tag table ────────────────────────────────────────────────────────────────
// Every metric reads the player's own effective ratings via `playerAttrs` (the
// sim's merge, incl. development gains) with the position-correct fallback. The
// `ref` is a fixed constant (not a roster mean): at/above it the player has no
// weakness for the trait, so an average or strong player contributes nothing.
interface TagDef {
  id: string
  positions: Position[]
  /** The trait metric, from the player's merged attribute sheet. */
  metric: (p: Player, a: Record<string, number>) => number
  ref: number
  /** Edge (probability units) per metric point below the reference. */
  perPt: number
  /** Cap on the true-weakness edge. */
  cap: number
  /** Report text, given the player's name. */
  text: (name: string) => string
}

/** J36: a player's effective rating — his own, else his position's (never a flat 70). */
function ev(p: Player, a: Record<string, number>, key: string): number {
  const v = a[key]
  return v !== undefined ? v : positionRating(p.pos, a, key)
}

export const J36_TAGS: Record<string, TagDef> = {
  'cb-bite': {
    id: 'cb-bite', positions: ['CB'],
    metric: (p, a) => (ev(p, a, 'PRC') + ev(p, a, 'AWR')) / 2, ref: 82, perPt: 0.0012, cap: 0.014,
    text: (n) => `${n} bites on double moves`,
  },
  's-angles': {
    id: 's-angles', positions: ['S'],
    metric: (p, a) => (ev(p, a, 'TAK') + ev(p, a, 'PUR')) / 2, ref: 80, perPt: 0.0012, cap: 0.014,
    text: (n) => `${n} takes bad angles and misses tackles`,
  },
  'lb-tackle': {
    id: 'lb-tackle', positions: ['LB'],
    metric: (p, a) => (ev(p, a, 'TAK') + ev(p, a, 'PUR')) / 2, ref: 86, perPt: 0.0012, cap: 0.014,
    text: (n) => `${n} misses tackles in the open field`,
  },
  'rb-fumble': {
    id: 'rb-fumble', positions: ['RB'],
    metric: (p, a) => ev(p, a, 'CAR'), ref: 90, perPt: 0.0014, cap: 0.016,
    text: (n) => `${n} puts the ball on the ground`,
  },
  'ot-speed': {
    id: 'ot-speed', positions: ['OT'],
    metric: (p, a) => ev(p, a, 'PBK') * 0.6 + ev(p, a, 'AGI') * 0.4, ref: 77, perPt: 0.0011, cap: 0.013,
    text: (n) => `${n} struggles with speed rushers`,
  },
  'qb-force': {
    id: 'qb-force', positions: ['QB'],
    metric: (p, a) => (ev(p, a, 'AWR') + ev(p, a, 'TUP')) / 2, ref: 84, perPt: 0.0014, cap: 0.0162,
    text: (n) => `${n} forces throws under pressure`,
  },
  'wr-drops': {
    id: 'wr-drops', positions: ['WR', 'TE'],
    metric: (p, a) => (ev(p, a, 'CTH') + ev(p, a, 'CIT')) / 2, ref: 89, perPt: 0.0011, cap: 0.013,
    text: (n) => `${n} drops passes in traffic`,
  },
}

/** J36: the tag a position's report keys on (the engine's steer/edge tag). */
export function primaryTag(pos: string): string | undefined {
  for (const t of Object.values(J36_TAGS)) if (t.positions.includes(pos as Position)) return t.id
  return undefined
}

/**
 * J36: the edge a genuinely weak player earns on a tag, in probability units
 * (0 when the player is average-or-better on the trait — exploiting a strong
 * player wrongly flagged gives nothing). PURE — reads only the player's ratings.
 */
export function weaknessEdge(p: Player, tag: string | undefined): number {
  const t = tag ? J36_TAGS[tag] : undefined
  if (!t) return 0
  const a = playerAttrs(p)
  const w = t.ref - t.metric(p, a)
  if (w < J36_SCOUT.minWeak) return 0
  return Math.min(t.cap, w * t.perPt)
}

// ── staff read quality ───────────────────────────────────────────────────────
function h01(key: string): number {
  return hash32(key, 36) / 4294967296
}

function roleMember(world: World, teamId: string, role: string): StaffMember | undefined {
  return (world.staff[teamId] ?? []).find((s) => s.role === role)
}

/** J36: the Analyst/Tendencies coach (the seat whose specialty sharpens `reads`). */
function readsCoach(world: World, teamId: string): StaffMember | undefined {
  const staff = world.staff[teamId] ?? []
  return staff.find((s) => s.specialty === 'Analyst' || s.specialty === 'Tendencies')
    ?? roleMember(world, teamId, 'Analytics')
    // AI clubs carry no analytics seat, so the scouting staff is the reads seat.
    ?? roleMember(world, teamId, 'Scout')
    ?? roleMember(world, teamId, 'Director of Player Personnel')
}

/** J36: the club `reads` sub the report is built on (the Analyst/Tendencies seat). */
export function scoutReads(world: World, teamId: string): number {
  const rc = readsCoach(world, teamId)
  return rc ? coachSubs(rc).reads : J36_SCOUT.staffLo
}

/** J36: the club's scouting staff rating (Scout, else the personnel chief). */
function scoutRating(world: World, teamId: string): number | undefined {
  return (roleMember(world, teamId, 'Scout') ?? roleMember(world, teamId, 'Director of Player Personnel'))?.rating
}

/**
 * J36: how well a club's staff reads an opponent, 0..1. The Analyst/Tendencies
 * coach's `reads` sub (J9 `coachSubs`, so a derived sheet on an old save) is
 * weighted against the scouting staff rating; a vacant pair sits near the floor.
 */
export function scoutReadQuality(world: World, teamId: string): number {
  const reads = scoutReads(world, teamId)
  const scout = scoutRating(world, teamId) ?? J36_SCOUT.staffLo
  const blend = J36_SCOUT.readsWeight * reads + (1 - J36_SCOUT.readsWeight) * scout
  return clamp((blend - J36_SCOUT.staffLo) / (J36_SCOUT.staffHi - J36_SCOUT.staffLo), 0, 1)
}

// ── the report ───────────────────────────────────────────────────────────────
interface Candidate { p: Player; tag: string; w: number }

/** J36: the opponent's players who could carry each tag, most prominent first. */
function candidates(world: World, oppId: string): Candidate[] {
  const roster = world.roster[oppId] ?? []
  const out: Candidate[] = []
  for (const t of Object.values(J36_TAGS)) {
    const atPos = roster
      .filter((p) => t.positions.includes(p.pos))
      .sort((a, b) => unscaleOvr(b.ovr) - unscaleOvr(a.ovr))
      .slice(0, J36_SCOUT.depthPerPos)
    for (const p of atPos) {
      const a = playerAttrs(p)
      out.push({ p, tag: t.id, w: t.ref - t.metric(p, a) })
    }
  }
  return out
}

/**
 * J36: `buildScoutReport` — the club's staff report on the next opponent.
 * Deterministic in (world.seed, week, myTeamId, oppId, playerId). The staff's
 * read quality sets how many of the real weaknesses are found and how often a
 * strong player is wrongly flagged; every true finding's `confidence` rides the
 * staff quality and how pronounced the weakness is.
 */
export function buildScoutReport(world: World, myTeamId: string, oppId: string): ScoutFinding[] {
  const q = scoutReadQuality(world, myTeamId)
  const seedKey = `${world.seed}:${world.week}:${myTeamId}:${oppId}`
  const trueFindings: ScoutFinding[] = []
  const falseFindings: ScoutFinding[] = []

  for (const c of candidates(world, oppId)) {
    const key = `${seedKey}:${c.p.id}:${c.tag}`
    if (c.w >= J36_SCOUT.minWeak) {
      // A real weakness: the staff's chance to spot it rises with quality and
      // with how pronounced it is.
      const strength = clamp(c.w / J36_SCOUT.fullW, 0.2, 1)
      const findP = clamp(J36_SCOUT.findBase + q * J36_SCOUT.findSpread, 0, 1) * strength
      if (h01(`${key}:find`) < findP) {
        trueFindings.push({
          playerId: c.p.id, pos: c.p.pos, tag: c.tag,
          text: J36_TAGS[c.tag].text(`${c.p.pos} ${c.p.name}`),
          trueWeakness: true,
          confidence: clamp(J36_SCOUT.confBase + q * J36_SCOUT.confQ + c.w * J36_SCOUT.confW, 0, 0.99),
        })
      }
    } else if (c.w <= -J36_SCOUT.strongMargin) {
      // A solid player: a poor staff may still "see" a weakness that is not there.
      const falseP = J36_SCOUT.falseBase * Math.pow(1 - q, J36_SCOUT.falseExp)
      if (h01(`${key}:false`) < falseP) {
        falseFindings.push({
          playerId: c.p.id, pos: c.p.pos, tag: c.tag,
          text: J36_TAGS[c.tag].text(`${c.p.pos} ${c.p.name}`),
          trueWeakness: false,
          confidence: clamp(J36_SCOUT.confFalse + (1 - q) * 0.2, 0, 0.5),
        })
      }
    }
  }

  return [...trueFindings, ...falseFindings]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, J36_SCOUT.maxFindings)
}
