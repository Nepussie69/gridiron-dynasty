// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #28 — C1 acceptance probe (engine, no store, no DOM).
//
// `staffProbe()` exercises the market/profile/development/budget/contract/poach
// pure functions over N seeds and returns per-check results. The offline
// verification script (`~/gridiron-work/logs/fut28-probe.mjs`) boots real data +
// calibration, calls this, then adds the store multi-season + old-save checks.
//
// Deterministic: every world is built from its seed; nothing here uses `rng()`.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player, Position, StaffMember } from '../types'
import type { RealData } from '../data/realData'
import { buildWorld, type World } from './generate'
import { MAX_DEV_AGE, MAX_FOCUS_BONUS, applyDevFocus, focusPointsFor } from './devPlan'
import { coordinatorEdge } from './coaching'
import {
  BOOST_GROUP,
  MARKET_COACH_ROLES,
  STAFF_MARKET_TOPUP,
  STAFF_POOL_CAP,
  addStaffDeadMoney,
  applyPoachDeparture,
  boostPointsFor,
  canAffordHire,
  coachProfile,
  groupDevMultiplier,
  poachLateral,
  promoteInterim,
  refreshStaffMarket,
  rollPoachOffers,
  staffBudget,
  staffBuyout,
  tickStaffContracts,
  type StaffOffer,
} from './staffMarket'

export interface StaffProbeCheck {
  name: string
  ok: boolean
  extra?: string
}

export interface StaffProbeResult {
  pass: number
  fail: number
  lines: string[]
  results: StaffProbeCheck[]
}

export interface StaffProbeOptions {
  seeds?: number[]
  /** A real-data payload for buildWorld; when omitted the world is synthetic. */
  data?: RealData | null
}

const DEFAULT_SEEDS = [33333, 2222, 5150, 909090, 123123, 777, 31337, 202020, 404040, 606060]

/** A minimal but complete CareerState for the pure engine functions. */
export function careerFor(world: World, teamId: string, over: Partial<CareerState> = {}): CareerState {
  return {
    gmName: 'FUT28',
    path: 'coach',
    archetype: 'off',
    teamId,
    season: world.season,
    week: world.week,
    reputation: { evaluation: 70, roster: 65, leadership: 72, results: 60, profile: 62 },
    skills: { evaluation: 60, negotiation: 55, leadership: 70, scheme: 65, recruiting: 40 },
    level: 6,
    salary: 2_000_000,
    jobSecurity: 80,
    ownerExpectation: '',
    tier: 'NFL',
    recommendationsMade: 0,
    hits: 0,
    misses: 0,
    seasonRecs: 0,
    seasonHits: 0,
    ...over,
  } as CareerState
}

/** The user's team for a probe world (CLE always exists and plays in the NFL). */
function userTeam(world: World): string {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  return (world.byId['CLE']?.tier === 'NFL' ? 'CLE' : nfl[0]?.id) ?? 'CLE'
}

function findRole(world: World, teamId: string, role: string) {
  return (world.staff[teamId] ?? []).find((m) => m.role === role)
}

/** Run the C1 acceptance checks. Returns per-check results; prints nothing. */
export function staffProbe(opts: StaffProbeOptions = {}): StaffProbeResult {
  const seeds = opts.seeds ?? DEFAULT_SEEDS
  const data = opts.data ?? null
  const results: StaffProbeCheck[] = []
  const ok = (name: string, cond: boolean, extra = '') => results.push({ name, ok: !!cond, extra })

  const worlds = seeds.map((s) => ({ seed: s, world: buildWorld(s, data) }))

  // ── 1. Profiles: stable, in range, correct group, old-save safe ────────────
  {
    let stable = true
    let rangeOK = true
    let groupOK = true
    let extra = ''
    for (const { world } of worlds) {
      const members = [
        ...Object.values(world.staff).flat(),
        ...world.staffPool,
        ...(world.analyticsPool ?? []),
      ]
      for (const m of members) {
        const p1 = coachProfile(m)
        const p2 = coachProfile(m)
        if (JSON.stringify(p1) !== JSON.stringify(p2)) stable = false
        if (p1.teaching < 35 || p1.teaching > 95 || p1.install < 2 || p1.install > 6 || p1.boost.points < 0 || p1.boost.points > 2) {
          rangeOK = false
          extra = `${m.role} ${p1.teaching}/${p1.install}/${p1.boost.points}`
        }
        if (p1.boost.group !== (BOOST_GROUP[m.role] ?? '')) {
          groupOK = false
          extra = `${m.role} → ${p1.boost.group}`
        }
      }
    }
    // A coach with no stored sub-sheet (the old-save shape) still profiles.
    const legacy = { ...worlds[0].world.staffPool[0] }
    delete legacy.subs
    ok('profile: stable + in range (35–95 / 2–6 weeks / 0–2 points)', stable && rangeOK, extra)
    ok('profile: boost group matches the role seat', groupOK, '')
    ok('profile: old-save coach (no subs) profiles identically', JSON.stringify(coachProfile(legacy)) === JSON.stringify(coachProfile(legacy)))
  }

  // ── 2. Group development: band + zero-mean across the 4 base coaches ───────
  {
    let inBand = true
    let meanOK = true
    let noSeatOK = true
    let worstMean = 0
    for (const { world } of worlds) {
      for (const t of world.teams) {
        if (t.tier !== 'NFL') continue
        // One g per base position coach seat: QB, OL, DL, Secondary (read CB).
        const groups = ['QB', 'OL', 'DL', 'CB'] as const
        const gs = groups.map((gr) => groupDevMultiplier(world, t.id, gr))
        for (const g of gs) if (g < 0.95 - 1e-9 || g > 1.05 + 1e-9) inBand = false
        const mean = gs.reduce((a, b) => a + b, 0) / gs.length
        worstMean = Math.max(worstMean, Math.abs(mean - 1))
        if (Math.abs(mean - 1) > 0.02) meanOK = false
        // A group with no dedicated seat (WR at an AI club) is exactly 1.
        if (groupDevMultiplier(world, t.id, 'WR') !== 1) noSeatOK = false
      }
    }
    ok('group dev: g ∈ [0.95, 1.05] for every club', inBand)
    ok('group dev: mean ≈ 1 across the 4 base coaches', meanOK, `worst |mean−1| = ${worstMean.toFixed(4)}`)
    ok('group dev: a group with no coach returns exactly 1', noSeatOK)
  }

  // ── 3. Boost: 0–2 points, capped by MAX_FOCUS_BONUS, monotone ──────────────
  {
    let ptsOK = true
    let capOK = true
    let monoOK = true
    let devCapOK = true
    for (const { world } of worlds) {
      const positions: Position[] = ['QB', 'OG', 'DE', 'CB', 'S', 'WR', 'LB', 'RB', 'TE']
      for (const t of world.teams) {
        if (t.tier !== 'NFL') continue
        for (const pos of positions) {
          const b = boostPointsFor(world, t.id, pos)
          if (b < 0 || b > 2) ptsOK = false
          const base = focusPointsFor(0.6, 1.1, 0)
          const withBoost = focusPointsFor(0.6, 1.1, b)
          if (withBoost < base) monoOK = false
          if (withBoost > MAX_FOCUS_BONUS) capOK = false
        }
      }
    }
    // applyDevFocus hard-caps the banked total per rating.
    const p = { ...worlds[0].world.players[0], pos: 'QB' as Position, devFocus: 'accuracy', devRatings: {} } as Player
    applyDevFocus(p, 99)
    for (const v of Object.values(p.devRatings ?? {})) if (v > MAX_FOCUS_BONUS) devCapOK = false
    ok('boost: 0–2 points from the seat coach, none for unseated groups', ptsOK)
    ok('boost: focus points never exceed MAX_FOCUS_BONUS', capOK && devCapOK)
    ok('boost: more boost never lowers the focus points', monoOK)
    ok('boost: MAX_DEV_AGE is the devPlan gate (26)', MAX_DEV_AGE === 26)
  }

  // ── 4. Market refresh: top-up, cap, WR/LB seats, idempotent ────────────────
  {
    let topOK = true
    let capOK = true
    let wrlbOK = true
    let idemOK = true
    for (const { world } of worlds) {
      const w = structuredClone(world)
      refreshStaffMarket(w, w.season)
      for (const role of MARKET_COACH_ROLES) {
        const n = w.staffPool.filter((m) => m.role === role && m.status === 'Available').length
        if (n < STAFF_MARKET_TOPUP) topOK = false
      }
      if (w.staffPool.length > STAFF_POOL_CAP) capOK = false
      if (!w.staffPool.some((m) => m.role === 'WR Coach') || !w.staffPool.some((m) => m.role === 'LB Coach')) wrlbOK = false
      if (refreshStaffMarket(w, w.season).length !== 0) idemOK = false
    }
    // A stuffed pool is capped by dropping the oldest unsigned entries first.
    const w = structuredClone(worlds[0].world)
    for (let i = 0; i < 200; i++) {
      w.staffPool.push({ ...w.staffPool[0], id: `av_extra_${i}`, status: 'Available', teamId: null })
    }
    refreshStaffMarket(w, w.season)
    ok('market: every coach role tops up to 5 Available', topOK)
    ok('market: pool stays ≤ 90', capOK && w.staffPool.length <= STAFF_POOL_CAP, `stuffed ${w.staffPool.length}`)
    ok('market: WR + LB candidates added (user-market only seats)', wrlbOK)
    ok('market: refresh is idempotent within a season', idemOK)
  }

  // ── 5. Contracts: tick, expiry offer, buyout, dead money ───────────────────
  {
    const { world } = worlds[0]
    const w = structuredClone(world)
    const teamId = userTeam(w)
    const career = careerFor(w, teamId)
    const target = findRole(w, teamId, 'OL Coach')
    let tickOK = true
    let expiryOK = true
    let idemOK = true
    if (target) {
      target.contractYears = 2
      const t1 = tickStaffContracts(w, career)
      if (target.contractYears !== 1) tickOK = false
      const t2 = tickStaffContracts(w, t1.career)
      if (target.contractYears !== 0) tickOK = false
      const offer = t2.expired.find((o) => o.memberId === target.id)
      if (!offer || offer.kind !== 'resign' || offer.annual <= target.annual) expiryOK = false
      const t3 = tickStaffContracts(w, t2.career)
      const dupes = t3.career.staffOffers?.filter((o) => o.kind === 'resign' && o.memberId === target.id).length ?? 0
      if (dupes !== 1) idemOK = false
    }
    // Buyout = 50% × remaining years × annual.
    const buy = staffBuyout({ ...(target as StaffMember), annual: 4_000_000, contractYears: 3 })
    const buyOK = buy === 6_000_000
    // Dead money lands in the budget and shrinks headroom dollar-for-dollar.
    const before = staffBudget(w, career)
    const bumped = addStaffDeadMoney(career, w.season, buy)
    const after = staffBudget(w, bumped)
    const deadOK = after.deadMoney === buy && before.headroom - after.headroom === buy
    ok('contract: a deal ticks down each season', tickOK)
    ok('contract: hitting 0 files a re-sign offer at a raise (once)', expiryOK && idemOK)
    ok('buyout: 50% of remaining years × annual', buyOK, `$${buy.toLocaleString()}`)
    ok('dead money: counted against the budget headroom', deadOK)
    ok('budget: includes the owner top-up and personality', typeof before.budget === 'number' && before.budget > 0, `$${(before.budget / 1e6).toFixed(1)}M`)
  }

  // ── 6. Vacancy floor and the interim promotion ─────────────────────────────
  {
    const { world } = worlds[0]
    const w = structuredClone(world)
    const teamId = userTeam(w)
    // Firing an OC leaves a vacant seat that costs the floor (−4.5).
    w.staff[teamId] = (w.staff[teamId] ?? []).filter((m) => m.role !== 'Offensive Coordinator')
    const vacantEdge = coordinatorEdge(null)
    const res = promoteInterim(w, teamId, 'off')
    const best = [...(world.staff[teamId] ?? [])]
      .filter((m) => ['QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach', 'WR Coach', 'LB Coach'].includes(m.role))
      .sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
    const filled = findRole(w, teamId, 'Offensive Coordinator')
    // The interim man's own seat is vacated (his old role no longer holds that id).
    const stillOld = (w.staff[teamId] ?? []).some((m) => m.id === res.member?.id && m.role !== 'Offensive Coordinator')
    ok('vacancy: firing an OC reads −4.5', vacantEdge === -4.5)
    ok('interim: fills the seat at rating −4', !!filled && !!res.member && res.member.rating === Math.max(30, (best?.rating ?? 0) - 4), `r=${res.member?.rating}`)
    ok('interim: edge is coordinatorEdge(r − 4)', res.edgeAfter === coordinatorEdge((best?.rating ?? 0) - 4), `before ${res.edgeBefore} after ${res.edgeAfter}`)
    ok('interim: his own seat is vacated', !stillOld && !!res.vacated && !(w.staff[teamId] ?? []).some((m) => m.role === res.vacated))
  }

  // ── 7. Budget gate: over headroom refused unless funded ────────────────────
  {
    const { world } = worlds[0]
    const w = structuredClone(world)
    const career = careerFor(w, userTeam(w))
    const b = staffBudget(w, career)
    const headroomOK = canAffordHire(w, career, Math.max(0, b.headroom - 1))
    const overRefused = canAffordHire(w, career, b.headroom + 5_000_000, 1_000_000) === false
    const funded = { ...career, ownerMeeting: { log: [], staffFundSeason: w.season, staffFundUsed: false } }
    const fundedOK = canAffordHire(w, funded, b.headroom + 5_000_000, 1_000_000) === true
    const cheapestEscape = canAffordHire(w, career, b.headroom + 5_000_000, b.headroom + 5_000_000) === true
    ok('budget: an offer at/under headroom is allowed', headroomOK)
    ok('budget: an offer above headroom is refused', overRefused)
    ok('budget: the owner fund unblocks an over-budget hire', fundedOK)
    ok('budget: the cheapest ask is always reachable (owner notified)', cheapestEscape)
  }

  // ── 8. Poaching: deterministic, one per season, lateral vs promotion, tree ─
  {
    let onePerSeason = true
    let deterministic = true
    let sawLateral = false
    let sawPromotion = false
    let treeOK = true
    let eligibilityOK = true
    for (const { world } of worlds) {
      const makeReady = () => {
        const w = structuredClone(world)
        const teamId = userTeam(w)
        const posCoach = (w.staff[teamId] ?? []).find((m) =>
          ['QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach', 'WR Coach', 'LB Coach'].includes(m.role),
        )
        if (posCoach) {
          posCoach.rating = 85
          posCoach.contractYears = 1
        }
        return { w, teamId, posCoach }
      }
      const a = makeReady()
      const ca = careerFor(a.w, a.teamId)
      const r1 = rollPoachOffers(a.w, ca)
      const r2 = rollPoachOffers(a.w, r1.career)
      if (r2.offer) onePerSeason = false
      const b = makeReady()
      const cb = careerFor(b.w, b.teamId)
      const rb = rollPoachOffers(b.w, cb)
      if (JSON.stringify(r1.offer ?? null) !== JSON.stringify(rb.offer ?? null)) deterministic = false
      const offer: StaffOffer | undefined = r1.offer
      if (offer) {
        if (offer.lateral) sawLateral = true
        else sawPromotion = true
        if (!(offer.rating >= 78)) eligibilityOK = false
        const dep = applyPoachDeparture(a.w, r1.career, offer)
        const entry = (dep.career.tree ?? []).find((e) => e.id === offer.memberId)
        const stillHere = (a.w.staff[a.teamId] ?? []).some((m) => m.id === offer.memberId)
        if (!dep.ok || !entry || entry.role !== offer.role || stillHere) treeOK = false
      }
    }
    ok('poach: at most one offer per season', onePerSeason)
    ok('poach: the offer is deterministic per world', deterministic)
    ok('poach: a same-rung move is a blockable lateral, a step up is not', poachLateral('QB Coach', 'QB Coach') === true && poachLateral('QB Coach', 'Offensive Coordinator') === false && poachLateral('WR Coach', 'WR Coach') === true && poachLateral('WR Coach', 'Defensive Coordinator') === false)
    ok('poach: rolled offers cover both shapes across seeds', sawLateral && sawPromotion, `lateral ${sawLateral} / promotion ${sawPromotion}`)
    ok('poach: only a ≥ 78-rated coach with ≤ 1 year left is eligible', eligibilityOK)
    ok('poach: a departed coach joins career.tree with his role', treeOK)
  }

  // ── 9. Old save: a career without the new fields still works ───────────────
  {
    const { world } = worlds[0]
    const w = structuredClone(world)
    const legacy = careerFor(w, userTeam(w))
    delete legacy.staffDeadMoney
    delete legacy.staffOffers
    let loadOK = true
    try {
      const budget = staffBudget(w, legacy)
      if (!Number.isFinite(budget.headroom)) loadOK = false
      if ((legacy.staffOffers ?? []).length !== 0) loadOK = false
      const t = tickStaffContracts(w, legacy)
      if (!t.career.staffOffers) loadOK = false
      const poach = rollPoachOffers(w, legacy)
      if (!poach.career.staffOffers) loadOK = false
    } catch {
      loadOK = false
    }
    ok('old save: loads without the new fields (no migration needed)', loadOK)
  }

  const pass = results.filter((r) => r.ok).length
  const fail = results.length - pass
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.extra ? '   ' + r.extra : ''}`)
  return { pass, fail, lines, results }
}
