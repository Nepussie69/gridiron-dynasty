// ─────────────────────────────────────────────────────────────────────────────
// FUTURES 21 — the coaching tree.
//
// Your coordinators get hired away as head coaches around the league; their
// record as a head coach is credited to your coaching tree and your legacy; and
// once a club moves on from one of them you can poach him back into your
// building.
//
// Determinism: this runs at season end, never inside the play sim. It uses no
// rng() draws at all — every decision is a stable hash of the world seed, the
// season and the people involved — so the calibrated play sim is untouched.
// The passive path is intentionally result-neutral: when a coordinator leaves,
// your club promotes a same-scheme coach with the identical rating, so your
// on-field edge is exactly what it was (only the name changes). Poaching a coach
// back is a user action, on the Staff screen.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, StaffMember, StaffRole } from '../types'
import type { World } from './generate'
import { NFL_TEAMS } from '../data/nflTeams'
import { FIRST, LAST } from './names'
import { OFF_SCHEMES, DEF_SCHEMES } from './hiring'
import { noteCoordinatorChange, noteCoordinatorRef } from './playbook'
import { clamp, hash32 } from './rng'

/** One line of coaching-tree news for the inbox. */
export interface TreeNews {
  headline: string
  body: string
}

export interface TreeAdvance {
  career: CareerState
  news: TreeNews[]
}

const COORD_ROLES: StaffRole[] = ['Offensive Coordinator', 'Defensive Coordinator', 'Special Teams Coordinator']

const SPECIALTIES = [
  'Offense architect',
  'Defense architect',
  'Developer',
  'Recruiter',
  'Analyst',
  'Players’ coach',
  'Disciplinarian',
  'Game manager',
]

/** A stable 32-bit draw in [0,1) from a label. */
function draw(label: string, salt: number): number {
  return hash32(label, salt) / 4294967296
}

/** A stable, unique staff id for a coach who changes clubs. */
function coachId(teamId: string, role: string, label: string): string {
  return `s_${teamId}_${role.replace(/\s/g, '')}_${hash32(`${teamId}|${role}|${label}`, 7) % 100000}`
}

function isDefensive(role: string): boolean {
  return role.includes('Defensive') || role === 'DL Coach' || role === 'Secondary Coach'
}

function schemeFor(role: string, label: string): string {
  const pool = isDefensive(role) ? DEF_SCHEMES : OFF_SCHEMES
  return pool[hash32(`${role}|${label}`, 19) % pool.length]
}

function annualFor(role: string, rating: number): number {
  const base = role === 'Head Coach' ? 14 : role.includes('Coordinator') ? 4.5 : 2
  return Math.round((rating / 100) * base * 1_000_000)
}

/** A replacement coach generated without any rng draws (rating is fixed). */
function makeCoach(
  role: StaffRole,
  teamId: string,
  rating: number,
  scheme: string,
  label: string,
  name?: string,
): StaffMember {
  const h = hash32(`${teamId}|${role}|${label}`, 41)
  const id = coachId(teamId, role, label)
  return {
    id,
    name: name ?? `${FIRST[(h >>> 3) % FIRST.length]} ${LAST[(h >>> 11) % LAST.length]}`,
    role,
    age: 34 + (h % 26),
    rating: clamp(Math.round(rating), 30, 99),
    specialty: SPECIALTIES[(h >>> 5) % SPECIALTIES.length],
    scheme,
    annual: annualFor(role, rating),
    contractYears: 3,
    teamId,
    status: 'Hired',
    notes: 'Promoted from within',
  }
}

/** The two coordinator chairs that carry a continuity edge, and their side. */
const COORD_SIDES: { role: StaffRole; side: 'off' | 'def' }[] = [
  { role: 'Offensive Coordinator', side: 'off' },
  { role: 'Defensive Coordinator', side: 'def' },
]

/**
 * Backlog 193/185: never leave a NON-user club with a vacant OC/DC chair.
 *
 * Backlog 193 made an empty coordinator seat cost the −4.5 floor. The AI only
 * seeds staffs once (generate.ts), and every other AI path fills head-coach jobs,
 * so if the user fires a coordinator and then leaves the club (promote, demote,
 * the Wilderness), that club would play every future season at a permanent −4.5.
 * When the user's club changes and at each season rollover, fill any empty seat on
 * a club the user does not own with a deterministic makeCoach hire — the same
 * stable-hash coach generator the rest of the tree uses, so NO rng() draw happens
 * and the calibrated sim is untouched. The new coach's ref is recorded (tenure
 * starts at year 1) so the season tick simply increments next year. The user's own
 * club is skipped so they remain free to hire. Returns the clubs that were filled.
 */
export function backfillAICoordinators(world: World, userTeamId: string | null | undefined): string[] {
  const filled: string[] = []
  for (const teamId of Object.keys(world.staff)) {
    if (teamId === userTeamId) continue
    const staff = world.staff[teamId]
    for (const { role, side } of COORD_SIDES) {
      if (staff.some((m) => m.role === role)) continue
      const land = world.byId[teamId]
      const rating = Math.round((land?.prestige ?? 80) * 0.9)
      staff.push(makeCoach(role, teamId, rating, schemeFor(role, `${teamId}|vacfill|${world.season}`), `${teamId}|vacfill|${world.season}`))
      noteCoordinatorChange(world, teamId, side)
      filled.push(teamId)
    }
  }
  return filled
}

/** The first club that needs a head coach, deterministically. */
function destinationTeam(seedLabel: string, avoidTeamId: string): string {
  const pool = NFL_TEAMS.map((t) => t.id).filter((id) => id !== avoidTeamId)
  return pool[hash32(`dest|${seedLabel}`, 61) % pool.length]
}

function displaceHeadCoach(world: World, teamId: string, keep: StaffMember): void {
  const staff = world.staff[teamId] ?? (world.staff[teamId] = [])
  const idx = staff.findIndex((m) => m.role === 'Head Coach')
  if (idx >= 0) {
    const old = staff[idx]
    world.staffPool.push({ ...old, teamId: null, status: 'Available' })
    staff[idx] = keep
  } else {
    staff.push(keep)
  }
}

/**
 * Season-end step: advance every existing tree member's record, let a struggling
 * head coach go, then give one of your coordinators a head job if the league
 * comes calling.
 */
export function advanceCoachingTree(world: World, career: CareerState, champion: string | null): TreeAdvance {
  const news: TreeNews[] = []
  const tree = (career.tree ?? []).map((e) => ({ ...e }))

  // 1. Credit the season just played to every sitting head coach in the tree.
  for (const e of tree) {
    if (e.status === 'available') continue
    const rec = world.standings[e.teamId]
    if (rec) {
      e.wins = (e.wins ?? 0) + rec.wins
      e.losses = (e.losses ?? 0) + rec.losses
      if (champion && champion === e.teamId) e.rings = (e.rings ?? 0) + 1
    }
    e.seasons = (e.seasons ?? 0) + 1
  }

  // 2. A club that keeps losing moves on from your protégé — judged on the club's
  // most recent (just-finished) season, not his whole résumé.
  for (const e of tree) {
    if (e.status === 'available' || !e.id) continue
    const rec = world.standings[e.teamId]
    if (!rec) continue
    const games = rec.wins + rec.losses
    const winPct = games > 0 ? rec.wins / games : 0
    if ((e.seasons ?? 0) >= 2 && winPct < 0.35 && draw(`${e.id}|${world.season}|fired`, 97) < 0.5) {
      const staff = world.staff[e.teamId] ?? []
      const idx = staff.findIndex((m) => m.id === e.id)
      if (idx >= 0) {
        const gone = staff.splice(idx, 1)[0]
        world.staffPool.push({ ...gone, teamId: null, status: 'Available' })
        const land = world.byId[e.teamId]
        staff.push(makeCoach('Head Coach', e.teamId, land ? land.prestige * 0.85 + 6 : 74, schemeFor('Head Coach', e.id), `${e.id}|fill`))
        e.status = 'available'
        news.push({
          headline: `${e.name} out as ${land?.name ?? e.teamId} head coach`,
          body: `${e.name} is ${rec.wins}-${rec.losses} this season (${e.wins ?? 0}-${e.losses ?? 0} as a head coach). He is on the open market — you can bring him back from your coaching tree (Career → People).`,
        })
      }
    }
  }

  // 3. One of your coordinators may earn a head job elsewhere this offseason.
  if (career.path === 'coach' || career.level >= 3) {
    const staff = world.staff[career.teamId] ?? []
    const coords = staff.filter((m) => COORD_ROLES.includes(m.role)).sort((a, b) => b.rating - a.rating)
    if (coords.length) {
      const p = clamp(
        0.16 + career.reputation.leadership / 550 + (career.reputation.results - 50) / 500,
        0.08,
        0.5,
      )
      if (draw(`hire|${world.seed}|${world.season}|${career.teamId}`, 53) < p) {
        const who = coords[hash32(`who|${world.seed}|${world.season}|${career.teamId}`, 47) % coords.length]
        const dest = destinationTeam(`${world.seed}|${world.season}|${career.teamId}`, career.teamId)
        const fromRole = who.role
        const moved = makeCoach(
          'Head Coach',
          dest,
          who.rating,
          schemeFor(who.role, who.id),
          `${who.id}|${world.season}`,
          who.name,
        )
        // He leaves your staff; displace the club's head coach to make room.
        const i = staff.findIndex((m) => m.id === who.id)
        if (i >= 0) staff.splice(i, 1)
        displaceHeadCoach(world, dest, moved)
        // Result-neutral backfill: identical rating and scheme, new name. Backlog
        // 185: also record the promoted man's id as the seat's ref (without
        // resetting tenure), so his continuity carries over and the season tick
        // sees no change — the staff stays whole on and off the field.
        staff.push(makeCoach(fromRole, career.teamId, who.rating, who.scheme, `${who.id}|backfill|${world.season}`))
        const backfillSide = fromRole === 'Offensive Coordinator' ? 'off' : fromRole === 'Defensive Coordinator' ? 'def' : null
        if (backfillSide) noteCoordinatorRef(world, career.teamId, backfillSide)
        tree.push({
          name: who.name,
          role: 'Head Coach',
          teamId: dest,
          season: world.season,
          id: moved.id,
          fromRole,
          rating: who.rating,
          scheme: who.scheme,
          wins: 0,
          losses: 0,
          rings: 0,
          seasons: 0,
          status: 'hc',
        })
        news.push({
          headline: `${who.name} hired as ${world.byId[dest]?.name ?? dest} head coach`,
          body: `Your ${fromRole.toLowerCase()} (${who.rating} OVR) leaves for a head job. You promoted within to keep the staff whole — his success now counts toward your coaching tree.`,
        })
      }
    }
  }

  return { career: { ...career, tree }, news }
}

export interface PoachResult {
  career: CareerState
  ok: boolean
  message: string
}

/**
 * Bring a former assistant back into your building. He leaves whichever club he
 * is with (a head job is backfilled so the league stays legal) and takes the
 * role he held for you. A user action: if you are not allowed to make staff
 * decisions the store rejects it before calling this.
 */
export function poachAssistant(world: World, career: CareerState, name: string, season: number): PoachResult {
  const tree = career.tree ?? []
  const entry = tree.find((e) => e.name === name && e.season === season)
  if (!entry) return { career, ok: false, message: `${name} is no longer available.` }

  const role = (entry.fromRole ?? 'Offensive Coordinator') as StaffRole

  // He leaves his current club; if he was the head coach, that club promotes.
  if (entry.id) {
    // An 'available' protégé (a club already moved on) waits in the open market —
    // take him off that list so he isn't a duplicate candidate after he signs.
    const poolIdx = world.staffPool.findIndex((m) => m.id === entry.id)
    if (poolIdx >= 0) world.staffPool.splice(poolIdx, 1)
    for (const tid of Object.keys(world.staff)) {
      const arr = world.staff[tid]
      const i = arr.findIndex((m) => m.id === entry.id)
      if (i < 0) continue
      const [leaving] = arr.splice(i, 1)
      if (leaving.role === 'Head Coach') {
        const land = world.byId[tid]
        arr.push(makeCoach('Head Coach', tid, land ? land.prestige * 0.85 + 6 : 74, schemeFor('Head Coach', entry.id!), `${entry.id}|fill`))
      }
      break
    }
  }

  // Add him to your staff, replacing whoever holds the role.
  const staff = world.staff[career.teamId] ?? (world.staff[career.teamId] = [])
  const holdIdx = staff.findIndex((m) => m.role === role)
  if (holdIdx >= 0) {
    const out = staff[holdIdx]
    world.staffPool.push({ ...out, teamId: null, status: 'Available' })
    staff.splice(holdIdx, 1)
  }
  const scheme = entry.scheme ?? schemeFor(role, `${entry.name}|${entry.season}`)
  staff.push(makeCoach(role, career.teamId, entry.rating ?? 75, scheme, `${entry.id ?? entry.name}|poach|${career.season}`, entry.name))
  // Backlog 185 (fix): bringing a coordinator back in resets continuity at once.
  const poachSide = role === 'Offensive Coordinator' ? 'off' : role === 'Defensive Coordinator' ? 'def' : null
  if (poachSide) noteCoordinatorChange(world, career.teamId, poachSide)

  return {
    career: { ...career, tree: tree.filter((e) => e !== entry) },
    ok: true,
    message: `${name} is back in your building as ${role}.`,
  }
}
