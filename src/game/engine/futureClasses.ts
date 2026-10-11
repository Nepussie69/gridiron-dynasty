// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #29 — future draft classes (FP1, engine only).
//
// The next class is a pure function of (world.seed, world.season, count): the very
// same call `progress.ts:refreshProspectClass` makes at every rollover. So the
// preview is DERIVED from the identical seed instead of being stored as a second
// roster — and it is therefore byte-identical to the class that will be promoted.
// Only two small overlays are persisted (both optional):
//
//   world.futureClasses.scout     — the grades/confidence you scouted early, by id
//   world.futureClasses.returners — underclassmen who returned, carried forward
//
// With both empty, `refreshProspectClass` produces exactly what it always did.
// Determinism: no rng draw is added to or removed from any world stream; every
// roll here is a `hash32` of (id, season), exactly like `scoutProspect`'s jitter.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, DraftProspect, FutureScoutRead } from '../types'
import type { World } from './generate'
import { generateProspectClass } from './generate'
import { readProspect, type ProspectRead } from './evaluation'
import { clamp, hash32, makeRng } from './rng'

/** How much wider a future read is than the current-class read (spec: ×1.8 / ×2.6). */
const READ_WIDTH: Record<number, number> = { 1: 1.8, 2: 2.6 }
/** The early confidence ceiling until a class turns current (spec: 60 / 35). */
const CONF_CAP: Record<number, number> = { 1: 60, 2: 35 }
/** How much of the gap to the hidden true grade one future scout closes (0.2 / 0.1). */
const SCOUT_GAP: Record<number, number> = { 1: 0.2, 2: 0.1 }
/** Confidence one future scout adds (12 / 6). */
const SCOUT_CONF: Record<number, number> = { 1: 12, 2: 6 }
/** The thin two-years-out class keeps only this many, by public consensus. */
export const THIN_CLASS_SIZE = 60
/** Most ids the watch list keeps (step 3 of the spec). */
export const MAX_PROSPECT_WATCH = 30

/** Normalize a horizon to the two supported years (1 = next, 2 = two out). */
function horizon(yearsOut: number): 1 | 2 {
  return yearsOut <= 1 ? 1 : 2
}

/** The early confidence ceiling for a horizon: 60 (next year) or 35 (two out). */
export function futureConfidenceCap(yearsOut: number): number {
  return CONF_CAP[horizon(yearsOut)]
}

// ── Deriving the class (shared seed arithmetic with refresh) ─────────────────

/** The seed the NEXT class is generated from — mirrors refreshProspectClass exactly. */
export function nextClassSeed(world: World): number {
  return world.seed + (world.season + 1) * 65537
}

/** The size of the NEXT class — mirrors refreshProspectClass exactly. */
export function nextClassCount(world: World): number {
  return Math.max(400, world.draft?.length ?? 0)
}

/**
 * The seed of the class the rollover `n` seasons ahead promotes. At season S the
 * next rollover first bumps to S+1 and then calls `nextClassSeed` there, i.e.
 * seed + (S+n+1)*65537 — the same arithmetic as `nextClassSeed`, one season ahead
 * per hop. `nextClassSeed` itself is left untouched: calibration and `balance.ts`
 * depend on its exact value at the season the refresh actually runs.
 */
function classSeed(world: World, n: 1 | 2): number {
  return world.seed + (world.season + n + 1) * 65537
}

/**
 * The class the next rollover promotes is sized from the CURRENT class
 * (`nextClassCount`); the class after that is sized from the class the next
 * rollover promotes, whose length is exactly `nextClassCount` too (the generated
 * class always has exactly `count`, and the 400 floor is stable). So both
 * horizons share the count and the preview can never drift from refresh.
 */
function classCount(world: World): number {
  return nextClassCount(world)
}

/** The top `THIN_CLASS_SIZE` of a class by consensus grade (id breaks ties). */
function thinClass(full: DraftProspect[]): DraftProspect[] {
  return [...full]
    .sort((a, b) => b.grade - a.grade || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, THIN_CLASS_SIZE)
}

const classCache = new Map<string, DraftProspect[]>()

/**
 * The class `yearsOut` seasons ahead, derived from the refresh seed. `yearsOut`
 * 1 is the full next class (identical to what the NEXT rollover will promote:
 * the class whose label is `world.season + 2`); `yearsOut` 2 is the thin early
 * look (the top 60 by consensus of the `world.season + 3` class). Memoized per
 * (seed, label, count, yearsOut): the class is a pure function of those, and the
 * cache is only ever handed out read-only.
 */
export function futureClass(world: World, yearsOut = 1): DraftProspect[] {
  const n = horizon(yearsOut)
  const seed = classSeed(world, n)
  const count = classCount(world)
  const label = world.season + n + 1
  const key = `${seed}:${label}:${count}:${n}`
  const hit = classCache.get(key)
  if (hit) return hit
  const full = generateProspectClass(makeRng(seed), label, count)
  const out = n === 2 ? thinClass(full) : full
  classCache.set(key, out)
  return out
}

// ── Fog of war ───────────────────────────────────────────────────────────────

export type FutureLook = 'Day 1' | 'Day 2' | 'Day 3'

export interface FutureRead extends ProspectRead {
  yearsOut: number
  /** The fogged consensus band — the only thing shown in place of the number. */
  look: FutureLook
  /** A fogged declare leaning for an underclassman, else null. */
  leaning: 'declare' | 'return' | null
}

function dayLook(grade: number): FutureLook {
  if (grade >= 80) return 'Day 1'
  if (grade >= 72) return 'Day 2'
  return 'Day 3'
}

/** Merge a stored scouting overlay onto a derived prospect (no-op if none). */
export function applyFutureOverlay(world: World, p: DraftProspect): DraftProspect {
  const ov = world.futureClasses?.scout?.[p.id]
  if (!ov) return p
  return { ...p, myGrade: ov.myGrade, confidence: ov.confidence, scoutConfidence: ov.scoutConfidence }
}

/**
 * Read a future-class prospect through a wider fog than the current class. Wraps
 * `readProspect`, widens the range ×1.8 (next year) or ×2.6 (two years out), caps
 * the confidence at 60 / 35, never reveals the truth, and replaces the raw
 * consensus number with a round band look ("Day 1 / Day 2 / Day 3").
 */
export function readFuture(career: CareerState, p: DraftProspect, yearsOut = 1): FutureRead {
  const n = horizon(yearsOut)
  const base = readProspect(career, p)
  const width = Math.max(1, base.width * READ_WIDTH[n])
  const center = base.center
  const lo = clamp(Math.round(center - width), 40, 99)
  const hi = clamp(Math.round(center + width), 40, 99)
  const look = dayLook(center)
  const underclass = p.classYear === 'JR' || p.classYear === 'SO'
  // A forecast, not the hidden roll: below 50 confidence it stays a soft
  // "leaning declare"; at ≥50 the deterministic hash gives the real lean.
  const leaning: 'declare' | 'return' | null = !underclass
    ? null
    : p.confidence >= 50
      ? h01(p.id, 0) < declareChance(p.trueGrade)
        ? 'declare'
        : 'return'
      : 'declare'
  return {
    ...base,
    yearsOut: n,
    range: [lo, hi],
    width,
    confidence: Math.min(base.confidence, futureConfidenceCap(n)),
    consensus: null,
    truth: null,
    bandLabel: look,
    look,
    leaning,
  }
}

/** Convenience: overlay a scouted read first, then wrap it in the future fog. */
export function futureReadFor(world: World, career: CareerState, p: DraftProspect, yearsOut = 1): FutureRead {
  return readFuture(career, applyFutureOverlay(world, p), yearsOut)
}

// ── Scouting a future prospect ───────────────────────────────────────────────

/**
 * Scout a future prospect: close 20% (next year) or 10% (two years out) of the
 * gap to his hidden grade, add +12 / +6 confidence, and cap confidence at 60 / 35
 * until the class turns current. Uses the same deterministic hash-jitter pattern
 * as `scoutProspect`, and makes NO rng draw from any world stream. Returns the new
 * overlay entry, or null when the id is not in that future class.
 */
export function scoutFutureProspect(world: World, id: string, yearsOut = 1): FutureScoutRead | null {
  const n = horizon(yearsOut)
  const p = futureClass(world, n).find((d) => d.id === id)
  if (!p) return null
  const store = ((world.futureClasses ??= {}).scout ??= {})
  const cur = store[id]
  const base = cur?.myGrade ?? p.grade
  const confidence0 = cur?.confidence ?? p.confidence
  const scoutConfidence0 = cur?.scoutConfidence ?? p.scoutConfidence
  const jitter = (makeRng(hash32(p.id, world.season * 31 + (confidence0 | 0)))() - 0.5) * 6
  const next: FutureScoutRead = {
    myGrade: Math.round(base + (p.trueGrade - base) * SCOUT_GAP[n] + jitter),
    confidence: Math.min(CONF_CAP[n], confidence0 + SCOUT_CONF[n]),
    scoutConfidence: Math.min(CONF_CAP[n], scoutConfidence0 + SCOUT_CONF[n]),
  }
  store[id] = next
  return next
}

// ── Promoting into the current class (called by refresh) ─────────────────────

/**
 * Apply the persisted overlays to a freshly generated NEXT class, then consume
 * them. With NO overlays this returns `generated` untouched (same reference), so
 * `refreshProspectClass` — and therefore every existing save and `balance.ts` —
 * stays byte-identical. Returners replace a generated prospect of the same
 * trueGrade (nearest if none), preserving the class size and trueGrade multiset.
 */
export function promoteNextClass(world: World, generated: DraftProspect[]): DraftProspect[] {
  const scout = world.futureClasses?.scout
  const returners = world.futureClasses?.returners
  const hasScout = !!scout && Object.keys(scout).length > 0
  const hasReturners = !!returners && returners.length > 0
  if (!hasScout && !hasReturners) {
    world.futureClasses = undefined
    return generated
  }
  const out = generated.slice()
  if (hasReturners) {
    const used = new Set<number>()
    for (const r of returners!) {
      let idx = -1
      for (let i = 0; i < out.length; i++) {
        if (!used.has(i) && out[i].trueGrade === r.trueGrade) {
          idx = i
          break
        }
      }
      if (idx < 0) {
        let best = Infinity
        for (let i = 0; i < out.length; i++) {
          if (used.has(i)) continue
          const d = Math.abs(out[i].trueGrade - r.trueGrade)
          if (d < best) {
            best = d
            idx = i
          }
        }
      }
      if (idx < 0) continue
      used.add(idx)
      out[idx] = { ...r }
    }
  }
  if (hasScout) {
    for (let i = 0; i < out.length; i++) {
      const ov = scout![out[i].id]
      if (ov) {
        out[i] = { ...out[i], myGrade: ov.myGrade, confidence: ov.confidence, scoutConfidence: ov.scoutConfidence }
      }
    }
  }
  world.futureClasses = undefined
  return out
}

// ── The declare deadline ─────────────────────────────────────────────────────

/** The mid-January declare probability for a true grade (monotone in grade). */
export function declareChance(trueGrade: number): number {
  return clamp(0.35 + (trueGrade - 60) * 0.03, 0.15, 0.95)
}

/** Deterministic uniform in [0,1) from a prospect id and a season — no rng draws. */
function h01(id: string, season: number): number {
  return (hash32(`${id}:${season}`) >>> 0) / 4294967296
}

const NEXT_YEAR: Record<DraftProspect['classYear'], DraftProspect['classYear']> = {
  FR: 'SO',
  SO: 'JR',
  JR: 'SR',
  SR: 'SR',
}

/**
 * The mid-January declare deadline. Every undecided JR/SO in the current class
 * flips to 'declared' or 'returning'. Returners are swapped out of the class in
 * place by a generated senior that copies their grades (so class size and the
 * trueGrade multiset — and therefore `rookieRatings` — are unchanged), and move
 * to `world.futureClasses.returners` with classYear+1 and `returnedFrom`. It draws NO
 * rng, so replays and calibration are untouched. Returns both decision lists.
 */
export function runDeclareDeadline(
  world: World,
  career?: CareerState,
): { declared: DraftProspect[]; returning: DraftProspect[] } {
  const declared: DraftProspect[] = []
  const returning: DraftProspect[] = []
  for (const p of world.draft) {
    if (p.classYear !== 'JR' && p.classYear !== 'SO') continue
    if ((p.declare ?? 'undecided') !== 'undecided') continue
    p.declare = h01(p.id, world.season) < declareChance(p.trueGrade) ? 'declared' : 'returning'
    ;(p.declare === 'declared' ? declared : returning).push(p)
  }
  if (returning.length) swapReturners(world, returning)
  filterReturnerIds(career, returning)
  announceDecisions(world, career, declared, returning)
  return { declared, returning }
}

/** Replace each returner in place with a grade-preserving generated senior. */
function swapReturners(world: World, returning: DraftProspect[]) {
  // A private deterministic stream: the seniors only donate identity, so no
  // world rng is touched and the class's trueGrade multiset is left intact.
  const repl = generateProspectClass(makeRng(world.seed + world.season * 65537 + 0x5f5f5f), world.season, returning.length)
  const carried: DraftProspect[] = []
  for (let i = 0; i < returning.length; i++) {
    const r = returning[i]
    const senior = repl[i]
    const idx = world.draft.indexOf(r)
    if (idx >= 0 && senior) {
      world.draft[idx] = {
        ...senior,
        id: `dr${world.season}_${i}`,
        classYear: 'SR',
        declare: 'declared',
        trueGrade: r.trueGrade,
        grade: r.grade,
        ovr: r.ovr,
        pot: r.pot,
        generated: r.generated ?? true,
      }
    }
    carried.push({ ...r, classYear: NEXT_YEAR[r.classYear] ?? 'SR', returnedFrom: world.season, declare: 'returning' })
  }
  const st = (world.futureClasses ??= {})
  st.returners = [...(st.returners ?? []), ...carried]
}

/** Quietly drop any board / conviction / red-flag id that now points at a returner. */
function filterReturnerIds(career: CareerState | undefined, returning: DraftProspect[]) {
  if (!career || !returning.length) return
  const ids = new Set(returning.map((r) => r.id))
  if (career.userBoard) career.userBoard = career.userBoard.filter((id) => !ids.has(id))
  if (career.conviction) career.conviction.ids = career.conviction.ids.filter((id) => !ids.has(id))
  if (career.redFlags) career.redFlags.ids = career.redFlags.ids.filter((id) => !ids.has(id))
}

/** News: an inbox line per watched decision, one league headline for the top 32. */
function announceDecisions(
  world: World,
  career: CareerState | undefined,
  declared: DraftProspect[],
  returning: DraftProspect[],
) {
  const watched = new Set(career?.prospectWatch ?? [])
  if (watched.size) {
    for (const p of [...declared, ...returning]) {
      if (!watched.has(p.id)) continue
      const declares = p.declare === 'declared'
      world.news.unshift({
        id: `declare_${world.season}_${p.id}`,
        week: world.week,
        season: world.season,
        category: 'Draft',
        headline: `${p.name} ${declares ? 'declares for the draft' : 'returns to school'}`,
        body: declares
          ? `${p.name} (${p.pos}, ${p.college}) is leaving school early for the draft.`
          : `${p.name} (${p.pos}, ${p.college}) will play another year and re-enter next year's class.`,
        read: false,
      })
    }
  }
  const notable = [...declared, ...returning].sort((a, b) => b.grade - a.grade).slice(0, 32)
  if (notable.length) {
    const decl = notable.filter((p) => p.declare === 'declared').length
    const ret = notable.length - decl
    world.news.unshift({
      id: `declare_top_${world.season}`,
      week: world.week,
      season: world.season,
      category: 'League',
      headline: 'Underclassmen make their calls',
      body: `Among the class's top underclassmen, ${decl} declared for the draft and ${ret} will return to school.`,
      read: false,
    })
  }
}
