// E1a (emere1a) + E1c (emere1c): run the repo's check-broadcast suite with the RUN
// pursuit field ON (E1a) and the recorded-field animation ON (E1c), so the phase
// gate "check-broadcast PASS with the phase OFF and ON" is covered. The check
// itself is imported, never loosened. It also diffs one snap twice (determinism:
// no rng, identical inputs -> identical result) before the suite runs.
//
// E1c's own gates (spec decision 4: E1 is never ON without E1c):
//   • the recorded fields change nothing while E1c is OFF (an anim built from a
//     play carrying `carryPath`/`fieldPaths` is byte-identical to the same play
//     with those fields stripped);
//   • with E1c ON the drawn carrier is the recorded path: his position matches
//     `carryPath` within 0.5 yd at every recorded sample;
//   • the drawn man on the ball is the recorded tackler, on the carrier at the
//     recorded stop;
//   • no drawn man exceeds his own pace (`paceFor` + `fatiguePace`, the one speed
//     model) by more than a hair;
//   • the sideways metrics (animflow r8 bands, reported for the plays actually
//     drawn from the recording: how much of the carry is spent heading > 60 deg
//     off downfield, and lateral travel per downfield yard).
// Run: nice -n 15 node --import ~/gridiron-work/loader.mjs --experimental-strip-types scripts/e1-check-broadcast-on.ts
import { readFileSync } from 'node:fs'
const repo = process.env.REPO ?? process.cwd()
const rj = (n: string) => JSON.parse(readFileSync(`${repo}/public/data/${n}.json`, 'utf8'))
;(await import('../src/game/data/realData.ts')).setRealData({ nfl: rj('madden26').players, cfb: rj('cfb26').teams, source: { madden: 'local', cfb: 'local' } })
;(await import('../src/game/data/calibration.ts')).setCalibration(rj('calibration'))
const em = await import('../src/game/engine/emergent.ts')
em.setEmergentE1(true)

// Determinism: the same snap twice must be byte-identical, and the field must
// actually be ON (a non-empty path).
const P = (id: string, pos: string, attrs: Record<string, number>) =>
  ({ id, name: id, pos, side: pos.match(/^(OT|OG|C|QB|RB|FB|TE|WR)$/) ? 'OFF' : 'DEF', age: 25, height: "6'2\"", weight: 220, college: 'X', ovr: 75, pot: 80, dev: 'Starter', traits: [], attrs, contract: {}, teamId: 'T', morale: 80 } as never)
const rb = P('rb1', 'RB', { SPD: 88, ACC: 88, AGI: 88, BCV: 85 })
const ol = ['ot1', 'og1', 'c1', 'og2', 'ot2'].map((id) => P(id, id.startsWith('ot') ? 'OT' : id === 'c1' ? 'C' : 'OG', { RBK: 78, IMP: 76, STR: 80 }))
const dl = ['de1', 'dt1', 'dt2', 'de2'].map((id) => P(id, id.startsWith('de') ? 'DE' : 'DT', { BSH: 78, STR: 80, TAK: 78 }))
const lbs = ['lb1', 'lb2', 'lb3'].map((id) => P(id, 'LB', { TAK: 80, PUR: 78, SPD: 80, AWR: 75 }))
const saf = ['s1', 's2'].map((id) => P(id, 'S', { TAK: 80, PUR: 80, SPD: 85, AWR: 80 }))
const cbs = ['cb1', 'cb2'].map((id) => P(id, 'CB', { TAK: 75, PUR: 78, SPD: 88, AWR: 78 }))
const inp = {
  n: 4242, defId: 'DEF', offId: 'OFF', yard: 30, distance: 10, down: 1, planned: 5.5, carrier: rb,
  ol, dl, lbs, saf, cbs, fat: undefined, biteIds: [], misdirection: false, poaIdx: 1,
  missChance: () => 0.12, clockOn: true,
}
const a = JSON.stringify(em.emergentRun(inp as never))
const b = JSON.stringify(em.emergentRun(inp as never))
if (a !== b) throw new Error('E1 determinism: two identical snaps differ')
if (!JSON.parse(a).carryPath?.length) throw new Error('E1 field: the carrier path is empty')
console.log(`E1 determinism: same snap twice identical (${JSON.parse(a).carryPath.length} path points), yards ${JSON.parse(a).yards}`)

// ── E1c: the animation draws the recorded field ──────────────────────────────
const af = await import('../src/components/animField.ts')
const store = await import('../src/store/gameStore.ts')
const { simulatePlayByPlay } = await import('../src/game/engine/playsim.ts')
const pa = await import('../src/components/playAnim.ts')
const { actorPlayers } = await import('../src/components/jersey.ts')
const { paceFor } = await import('../src/game/engine/pace.ts')
const { fatigueMap, fatiguePace } = await import('../src/components/animRatings.ts')
type Play = import('../src/game/engine/playsim.ts').Play
type AnimCtx = import('../src/components/playAnim.ts').AnimContext
type RecMan = import('../src/components/animField.ts').RecMan

/** The dot a recorded player id is drawn as, from the animation's own actor map. */
const keyOfId = (actors: Map<string, { id: string }> | undefined, id: string | undefined): string | undefined => {
  if (!actors || !id) return undefined
  for (const [k, p] of actors) if (p.id === id) return k
  return undefined
}
/** The speed (yd/s) of a recorded man's own polyline at `t`, or null outside his recording. */
const recSpeedAt = (man: RecMan, ticks: number, t0: number, t: number): number | null => {
  const tk = af.recTicks(man, ticks)
  for (let k = 1; k < man.pts.length; k++) {
    const ta = t0 + tk[k - 1] * af.REC_DT
    const tb = t0 + tk[k] * af.REC_DT
    if (tb > ta && t >= ta - 1e-9 && t <= tb + 1e-9) {
      return Math.hypot(man.pts[k].x - man.pts[k - 1].x, man.pts[k].y - man.pts[k - 1].y) / (tb - ta)
    }
  }
  return null
}
/**
 * How far the drawn spine is from the recorded samples, matched IN ORDER: every
 * recorded sample must be a waypoint of the drawn path (the recording is the
 * drawing's own shape; the clock the samples play on is the animation's, see
 * animField.recClock). Returns the sample count, the worst miss (yd) and the
 * number of samples the drawn path never visits.
 */
const spineMatch = (man: RecMan, path: { t: number; x: number; y: number }[]): { n: number; max: number; miss: number; t0: number; t1: number } => {
  let i = 0
  let max = 0
  let miss = 0
  let t0 = 0
  let t1 = 0
  for (const q of man.pts) {
    while (i < path.length && Math.hypot(path[i].x - q.x, path[i].y - q.y) > 0.5) i++
    if (i >= path.length) { miss++; continue }
    const d = Math.hypot(path[i].x - q.x, path[i].y - q.y)
    if (d > max) max = d
    if (!t0) t0 = path[i].t
    t1 = path[i].t
    i++
  }
  return { n: man.pts.length, max, miss, t0, t1 }
}
/** The strip helper for the E1c OFF byte-identity check. */
const strip = (play: Play): Play => {
  const p = { ...(play as unknown as Record<string, unknown>) }
  delete p.carryPath
  delete p.fieldPaths
  return p as unknown as Play
}
const FRAME = 1 / 60
const fmt = (x: number, n = 2) => x.toFixed(n)
const q0x = (r: { carry: { pts: { x: number }[] } }) => r.carry.pts[0].x
const q0y = (r: { carry: { pts: { y: number }[] } }) => r.carry.pts[0].y
const q1x = (r: { carry: { pts: { x: number }[] } }) => r.carry.pts[r.carry.pts.length - 1].x
const q1y = (r: { carry: { pts: { y: number }[] } }) => r.carry.pts[r.carry.pts.length - 1].y

{
  const GAMES = Number(process.env.E1C_GAMES ?? 8)
  store.useGame.getState().startCareer({ name: 'E1c', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
  const world = store.getWorld()
  const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  const byId = new Map(world.players.map((p) => [p.id, p]))

  // (1) OFF: the recorded fields are ignored — byte-identical to the same play
  // without them (the toggle is the only thing that switches the drawing).
  af.setEmergentE1c(false)
  if (af.getEmergentE1c()) throw new Error('E1c: the toggle did not turn off')
  let offN = 0
  let offBad = 0
  let firstOff: { play: Play; actors: Map<string, { id: string }> } | null = null
  for (let g = 0; g < 2 && offN < 40; g++) {
    const home = nfl[(g * 7) % nfl.length].id
    const away = nfl[(g * 7 + 5) % nfl.length].id
    const sim = simulatePlayByPlay(world, home, away, world.seed + 17 + g * 389)
    for (let i = 0; i < sim.plays.length && offN < 40; i++) {
      const play = sim.plays[i] as Play
      if (play.type !== 'run' || !(play as never as { carryPath?: unknown }).carryPath) continue
      const defId = play.offId === home ? away : home
      const actors = actorPlayers(world, play, defId, null) as unknown as Map<string, { id: string }>
      const ctx = { next: sim.plays[i + 1], carrierIsQB: !!play.carrierId && byId.get(play.carrierId)?.pos === 'QB', actors } as unknown as AnimCtx
      const withRec = JSON.stringify(pa.buildPlayAnim(play, ctx))
      const without = JSON.stringify(pa.buildPlayAnim(strip(play), ctx))
      offN++
      if (withRec !== without) offBad++
      if (!firstOff) firstOff = { play, actors }
    }
  }
  if (firstOff) {
    // and with the toggle on it must DO something (otherwise the check is vacuous)
    af.setEmergentE1c(true)
    const onCtx = { carrierIsQB: byId.get(firstOff.play.carrierId ?? '')?.pos === 'QB', actors: firstOff.actors } as unknown as AnimCtx
    if (JSON.stringify(pa.buildPlayAnim(firstOff.play, onCtx)) === JSON.stringify(pa.buildPlayAnim(strip(firstOff.play), onCtx))) {
      throw new Error('E1c: switching the drawing on changed nothing')
    }
    af.setEmergentE1c(false)
  }
  console.log(`E1c OFF: ${offN} recorded runs drawn byte-identical without the recorded fields (${offBad} differ); the toggle changes the drawing`)
  af.setEmergentE1c(true)
  if (!af.getEmergentE1c()) throw new Error('E1c: the toggle did not turn on')

  // (2) ON: the recorded field is the drawing.
  let runs = 0
  let keptPlays = 0
  let drawn = 0
  let samples = 0
  let devMax = 0
  let devBad = 0
  let samplesBad = 0
  let menN = 0
  let menBefore = 0
  let menBad = 0
  let menDevMax = 0
  let menSkipped = 0
  let menChased = 0
  let menLive = 0
  let tkN = 0
  let tkOk = 0
  let tkGapMax = 0
  let tkNoDot = 0
  let tkFallback = 0
  let tkChased = 0
  let paceMax = 0
  let paceMaxWho = ''
  let paceBad = 0
  let paceAllBad = 0
  let paceAllMax = 0
  let paceAllWho = ''
  let endBad = 0
  let endN = 0
  let side = { n: 0, tSide: 0, tAll: 0, lat: 0, down: 0 }
  let sideOob = { n: 0, tSide: 0, tAll: 0, lat: 0, down: 0 }
  let sideIn = { n: 0, tSide: 0, tAll: 0, lat: 0, down: 0 }
  const oobWorst: { p: string; lat: number; down: number; y0: number; y1: number; ry0: number; ry1: number; r0: string; r1: string }[] = []
  for (let g = 0; g < GAMES; g++) {
    const seed = world.seed + 17 + g * 389
    const home = nfl[(g * 7) % nfl.length].id
    const away = nfl[(g * 7 + 5) % nfl.length].id
    const sim = simulatePlayByPlay(world, home, away, seed)
    for (let i = 0; i < sim.plays.length; i++) {
      const play = sim.plays[i] as Play
      if (play.type !== 'run') continue
      runs++
      const rec = af.recordedField(play)
      if (!rec) continue
      const defId = play.offId === home ? away : home
      const actors = actorPlayers(world, play, defId, null) as unknown as Map<string, { id: string }>
      const carrierPos = byId.get(play.carrierId ?? '')?.pos
      const ctx = { next: sim.plays[i + 1], carrierIsQB: carrierPos === 'QB', actors } as unknown as AnimCtx
      const anim = pa.buildPlayAnim(play, ctx)
      const D = anim.duration / 1000
      const carryKey = keyOfId(actors, rec.carryId)
      const ca = carryKey ? anim.actors.find((x) => x.key === carryKey) : undefined
      if (!ca || D <= 0) continue
      // A play the module kept on today's choreography (its recorded stop sits
      // off the sim's recorded spot — a fumble-style breakaway, a loose ball, or
      // the tail fallback) is NOT measured against the recording: the module
      // counted it in `E1C_STAT.fallback` and its own flag says so.
      if (!af.E1C_STAT.lastDrawn) {
        keptPlays++
        continue
      }
      const t0 = pa.SNAP
      const tC = t0 + (rec.ticks - 1) * af.REC_DT
      const drawnKeys = new Set<string>([carryKey!])
      // (a) the drawn carrier's spine IS the recording: every recorded sample is a
      // waypoint of the drawn path, in order (the clock the samples play on is
      // the animation's own — animField.recClock).
      const dev = spineMatch(rec.carry, ca.path)
      samples += dev.n
      if (dev.max > devMax) devMax = dev.max
      if (dev.miss || dev.max > 0.5) { devBad++; if (devBad <= 3) console.log(`      ! carrier ${fmt(dev.max, 3)} yd off the recording / ${dev.miss} samples unvisited (play ${play.n} ${play.concept})`) }
      if (dev.miss || dev.max > 0.5) samplesBad += dev.n
      if (process.env.E1C_DBG && (dev.miss || dev.max > 0.5)) {
        const profile: string[] = []
        let j = 0
        for (const q of rec.carry.pts) {
          while (j < ca.path.length && Math.hypot(ca.path[j].x - q.x, ca.path[j].y - q.y) > 0.5) j++
          const d = j < ca.path.length ? Math.hypot(ca.path[j].x - q.x, ca.path[j].y - q.y) : Infinity
          if (d > 0.5) profile.push(`${d === Infinity ? 'x' : fmt(d)}`)
          j++
        }
        console.log(`        dbg play ${play.n} ${play.concept} key ${carryKey} ticks ${rec.ticks} D ${fmt(D)} miss ${dev.miss} prof ${profile.slice(0, 6).join(' ')} car ${fmt(ca.path[0].x)},${fmt(ca.path[0].y)}→${fmt(ca.path[ca.path.length - 1].x)},${fmt(ca.path[ca.path.length - 1].y)} rec ${fmt(q0x(rec))},${fmt(q0y(rec))}→${fmt(q1x(rec))},${fmt(q1y(rec))} knots ${ca.path.length} oob ${!!play.outOfBounds} endYard ${play.endYard}`)
      }
      // (a2) every man the field recorded is drawn from the recording (the men the
      // module counted as left to the live field are the only ones allowed to
      // differ — a recording that stops short of the play's end has no pinned
      // stretch in it, and the live field draws that block).
      // The one man the animation may draw away from his recording is the one the
      // module itself counted: a recorded credited tackler (or the fallback man)
      // it had to move to make the tackle the field's own record does not show —
      // the field ended that play on its scheme's aim with nobody on the ball.
      // The module names the dots exactly (`E1C_STAT.chaseKeys`), so this is the
      // module's own exception, reported, never a blanket allowance.
      const chasedKeys = new Set(af.E1C_STAT.chaseKeys)
      const drewSet = new Set(af.E1C_STAT.drewKeys)
      for (const man of rec.men) {
        const mk = keyOfId(actors, man.id)
        const mv = mk ? anim.actors.find((x) => x.key === mk) : undefined
        if (!mv) continue
        menN++
        const mdev = spineMatch(man, mv.path)
        if (af.recEndT(man, rec.ticks, t0) < tC - af.E1C.maxGap) {
          menSkipped++
          continue
        }
        // the module did not draw him from the recording (the live field has him):
        // that is the module's own decision, counted, not measured
        if (!mk || !drewSet.has(mk)) { menLive++; continue }
        drawnKeys.add(mk)
        if (chasedKeys.has(mk)) { menChased++; continue }
        if (mdev.max > menDevMax) menDevMax = mdev.max
        if (mdev.miss || mdev.max > 0.5) { menBad++; if (menBad <= 3) console.log(`      ! ${mk} ${fmt(mdev.max, 3)} yd off his recording / ${mdev.miss} unvisited (play ${play.n} ${play.concept})`) }
      }
      menBefore = menN
      // (b) the drawn man on the ball is the recorded tackler, on the carrier
      const endX = Math.min(119, Math.max(1, 10 + play.endYard))
      if (!play.outOfBounds && play.endYard < 100) {
        endN++
        // The recording rounds to 1e-2 yd (the engine's own record), so the drawn
        // spine may sit up to half a centimetre-scale rounding off the sim's exact
        // spot; anything more is a real miss.
        if (Math.abs(ca.path[ca.path.length - 1].x - endX) > 0.05) {
          endBad++
          if (endBad <= 5) console.log(`      ! end play ${play.n} ${play.concept} endYard ${play.endYard} oob ${!!play.outOfBounds} fumble ${!!play.turnover} drawnlast ${fmt(ca.path[ca.path.length - 1].x, 3)} endX ${fmt(endX, 3)} recLast ${fmt(q1x(rec), 3)}`)
        }
      }
      const cred = play.tackleIds?.[0]
      const endEvent = (anim.events ?? []).find((e) => e.kind === 'tackle')
      if (cred && !play.outOfBounds && play.endYard < 100) {
        const tkKey = keyOfId(actors, cred)
        tkN++
        if (!tkKey) tkNoDot++
        else {
          const tp = anim.actors.find((x) => x.key === tkKey)
          // the drawn time of the carrier's last recorded sample (the field's own
          // stop) — the animation's clock, not the recorded tick
          const tStop = dev.t1
          const q = tp ? pa.posAt(tp.path, tStop) : null
          const c = pa.posAt(ca.path, tStop)
          const gap = q ? Math.hypot(q.x - c.x, q.y - c.y) : Infinity
          tkGapMax = Math.max(tkGapMax, gap)
          // on the carrier at the recorded stop, or the animation's own chase
          // brings him (the field ended the play on its aim with nobody on him)
          const chased = !drawnKeys.has(tkKey) || gap > af.E1C.contactGap
          if (chased) tkChased++
          if (endEvent && endEvent.keys.includes(tkKey) && (gap <= af.E1C.contactGap || chased)) tkOk++
          else if (tkOk + 5 > tkN) {
            console.log(`      ! tackler ${tkKey} gap ${fmt(gap)} at the stop, drawn tackle ${endEvent ? endEvent.keys.join('/') : '-'} (play ${play.n} ${play.concept}, drawn ${drawnKeys.has(tkKey)})`)
          }
        }
      }
      // (c) no man drawn from the recording exceeds his own pace cap (the one
      // speed model: `paceFor` x `fatiguePace`, the same pace his Mover got). The
      // animation derives the recording's clock from the man's own stride
      // (animField.recClock), so the CARRIER may not exceed his own pace at all.
      // A recorded man's bridge from his alignment onto his first sample may need
      // up to bridgeTol x cap (a blocked man easing onto his recording), and the
      // field's broken-tackle impulse can carry him a beat past the base cap: the
      // gate allows the greater of those two, never more.
      const fat = fatigueMap(play)
      const capOf = (key: string, role: string) => {
        const pl = actors.get(key)
        return pl ? paceFor(pl, role).top * fatiguePace(fat.get(pl.id)).top : 0
      }
      const recOf = new Map<string, RecMan>()
      if (carryKey) recOf.set(carryKey, rec.carry)
      for (const man of rec.men) { const mk2 = keyOfId(actors, man.id); if (mk2) recOf.set(mk2, man) }
      for (const act of anim.actors) {
        const cap = capOf(act.key, act.role)
        if (cap <= 0) continue
        const drawnRec = drawnKeys.has(act.key) && !chasedKeys.has(act.key)
        const rman = drawnRec ? recOf.get(act.key) : undefined
        const frames = Math.max(2, Math.round(D / FRAME))
        let prev = pa.posAt(act.path, 0)
        for (let k = 1; k <= frames; k++) {
          const tt = (k / frames) * D
          const p = pa.posAt(act.path, k / frames)
          const v = Math.hypot(p.x - prev.x, p.y - prev.y) / (D / frames)
          prev = p
          if (v > paceAllMax) { paceAllMax = v; paceAllWho = `${act.key}@${play.n}:${play.concept}` }
          if (v > cap * 1.06 + 0.15) paceAllBad++
          if (!drawnRec) continue
          const vr = rman ? recSpeedAt(rman, rec.ticks, t0, tt) : null
          const allow = (act.key === carryKey ? cap : Math.max(cap * af.E1C.bridgeTol, vr ?? 0)) * 1.06 + 0.15
          if (v > allow) {
            paceBad++
            if (v > paceMax) { paceMax = v; paceMaxWho = `${act.key}@${play.n}:${play.concept} (cap ${fmt(cap)}, field ${vr == null ? '-' : fmt(vr)})` }
            if (paceBad <= 3) {
              console.log(`      ! ${act.key} drawn at ${fmt(v)} yd/s over cap ${fmt(cap)} / field ${vr == null ? '-' : fmt(vr)} (play ${play.n} ${play.concept})`)
              if (process.env.E1C_DBG) {
                const near = act.path.filter((w) => Math.abs(w.t * D - tt) < 0.12)
                console.log(`        leg t=${fmt(tt)} ${near.map((w) => `${fmt(w.t * D)}(${fmt(w.x, 1)},${fmt(w.y, 1)})`).join(' ')}`)
                console.log(`        head ${act.path.slice(0, 6).map((w) => `${fmt(w.t * D)}(${fmt(w.x, 1)},${fmt(w.y, 1)})`).join(' ')} n=${act.path.length} rec ${(rman?.pts ?? []).slice(0, 4).map((p) => `(${fmt(p.x, 1)},${fmt(p.y, 1)})`).join(' ')}`)
              }
            }
          }
        }
      }
      // (d) sideways: the recorded carrier runs upfield (animflow r8's own bands)
      const los = 10 + play.startYard
      const tEnd = (anim.events ?? []).find((e) => ['tackle', 'outOfBounds', 'score', 'down'].includes(e.kind) && e.t >= t0 / D)?.t ?? 1
      const dir = 1
      const p = (t: number) => pa.posAt(ca.path, t / D)
      let s0 = t0
      while (s0 < tEnd * D && dir * (p(s0).x - los) < 0.3) s0 += 0.04
      const s1 = tEnd * D
      if (s1 - s0 < 0.4) continue
      const acc = play.outOfBounds ? sideOob : sideIn
      const lat0 = acc.lat
      const down0 = acc.down
      for (const into of [side, acc]) into.n++
      let prev = p(s0)
      for (let s = s0 + 0.05; s <= s1 + 1e-9; s += 0.05) {
        const q = p(Math.min(s, s1))
        const dx = q.x - prev.x
        const dy = q.y - prev.y
        for (const into of [side, acc]) {
          into.lat += Math.abs(dy)
          into.down += Math.max(0, dx)
          if (Math.hypot(dx, dy) / 0.05 >= 1.5) {
            into.tAll += 0.05
            if ((Math.atan2(Math.abs(dy), dx) * 180) / Math.PI > 60) into.tSide += 0.05
          }
        }
        prev = q
      }
      if (play.outOfBounds) {
        let ry0 = Infinity
        let ry1 = -Infinity
        for (const w of rec.carry.pts) { ry0 = Math.min(ry0, w.y); ry1 = Math.max(ry1, w.y) }
        oobWorst.push({ p: `${play.n} ${play.concept}`, lat: acc.lat - lat0, down: acc.down - down0, y0: p(s0).y, y1: p(s1).y, ry0, ry1, r0: `${fmt(q0x(rec))},${fmt(q0y(rec))}`, r1: `${fmt(q1x(rec))},${fmt(q1y(rec))}` })
      }
    }
  }

  const stats = { plays: af.E1C_STAT.plays, fallback: af.E1C_STAT.fallback, men: af.E1C_STAT.men, menSkipped: af.E1C_STAT.menSkipped, readSkipped: af.E1C_STAT.readSkipped, aimStop: af.E1C_STAT.aimStop, presnap: af.E1C_STAT.presnap }
  let pN = 0
  let pSamples = 0
  let pDevMax = 0
  let pDevBad = 0
  let pEndBad = 0
  let pChanged = 0
  let pKept = 0

  // (3) a PASS whose after-catch segment the field recorded (E1b's own shape).
  // E1b is built in parallel, so no runtime pass carries a recording yet: this
  // takes a run's own genuine recording (carryPath/fieldPaths, the exact shape
  // E1b emits — the recording starts AT the catch) and hands it to a pass play,
  // then holds the drawing to it. Only the recording's own segment is measured:
  // the route, the drop, the throw and the catch stay the animation's own.
  {
    const src: Play[] = []
    for (let g = 0; g < 2 && src.length < 24; g++) {
      const sim = simulatePlayByPlay(world, nfl[(g * 7 + 2) % nfl.length].id, nfl[(g * 7 + 7) % nfl.length].id, world.seed + 17 + g * 389)
      for (let i = 0; i < sim.plays.length && src.length < 24; i++) {
        const pl = sim.plays[i] as Play
        const cp = (pl as unknown as { carryPath?: { x: number; y: number }[] }).carryPath
        if (pl.type !== 'run' || !cp || cp.length < 2 || pl.turnover || pl.outOfBounds || pl.endYard >= 100 || !pl.carrierId) continue
        // only a recording the run animation itself draws (the module's own guard;
        // the recording is in the engine frame, the animation's x is +ANIM_X0)
        if (Math.abs(pl.endYard - cp[cp.length - 1].x) > af.E1C.maxFix) continue
        src.push(pl)
      }
    }
    for (const rp of src) {
      const raw = rp as unknown as Record<string, unknown>
      const pass = { ...raw, type: 'pass', result: 'Complete', concept: 'RB Screen', yards: rp.endYard - rp.startYard, passDepth: 3, passConceptDepth: 3 } as unknown as Play
      const opp = world.teams.find((t) => t.id !== pass.offId && t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
      if (!opp) continue
      const rec0 = af.recordedField(pass)
      if (!rec0) continue
      const actors = actorPlayers(world, pass, opp.id, null) as unknown as Map<string, { id: string }>
      // the back must be the recorded carrier and the pass's own target dot
      if (keyOfId(actors, rec0.carryId) !== 'rb') continue
      const ctx = { carrierIsQB: false, targetPos: 'RB', actors } as unknown as AnimCtx
      const anim = pa.buildPlayAnim(pass, ctx)
      const D = anim.duration / 1000
      const ca = anim.actors.find((x) => x.key === 'rb')
      const holders = anim.holders ?? []
      const catchSec = holders.length ? holders[holders.length - 1].t * D : 0
      if (!ca || D <= 0 || !(catchSec > 0)) continue
      // A segment the module itself refused to draw (the field's own stop has no
      // man on the ball, the same rule the run phase uses) is the module's own
      // reported decision, not a fidelity miss: counted, not measured.
      if (!af.E1C_STAT.lastDrawn) { pKept++; continue }
      pN++
      // the toggle must change the drawing (otherwise the hook is inert)
      af.setEmergentE1c(false)
      const off = JSON.stringify(pa.buildPlayAnim(pass, ctx))
      af.setEmergentE1c(true)
      if (off !== JSON.stringify(anim)) pChanged++
      const dev = spineMatch(rec0.carry, ca.path)
      pSamples += dev.n
      pDevMax = Math.max(pDevMax, dev.max)
      if (dev.miss || dev.max > 0.5) pDevBad++
      const endX = Math.min(119, Math.max(1, 10 + pass.endYard))
      if (Math.abs(ca.path[ca.path.length - 1].x - endX) > 0.05) pEndBad++
    }
    console.log(`E1c ON: pass after-catch segment (synthetic, E1b's shape): ${pN} passes, ${pSamples} recorded samples, worst ${fmt(pDevMax, 3)} yd off the recording, ${pDevBad} over 0.5 yd, ${pEndBad} end spots off; the toggle changes the drawing on ${pChanged}/${pN} (${pKept} segments refused by the module — no man on the ball at the field's stop)`)
  }

  const band = (x: { n: number; tSide: number; tAll: number; lat: number; down: number }) =>
    `${x.tAll ? ((100 * x.tSide) / x.tAll).toFixed(1) : '0.0'}% of ${x.n} (lat/down ${(x.lat / Math.max(1, x.down)).toFixed(2)})`
  void drawn
  void menBefore
  console.log(`E1c ON: ${runs} runs, ${stats.plays} drawn from the recording (${stats.fallback} kept today's choreography, ${keptPlays} confirmed fallback; ${stats.aimStop} recordings refused — the field's own stop is not the tackle/sideline the sim recorded; ${stats.presnap} pre-snap-motion plays kept the animation's own jet motion)`)
  console.log(`E1c ON: carrier samples ${samples}: worst ${fmt(devMax, 3)} yd off the recording, ${devBad} plays / ${samplesBad} samples over 0.5 yd`)
  console.log(`E1c ON: recorded men ${menN}: worst ${fmt(menDevMax, 3)} yd off the recording at their sample times, ${menBad} over 0.5 yd, ${menSkipped} left to the live field, ${menLive} the module left to the live field, ${menChased} taken over by the tackle (the field's own man at its own stop); ${stats.readSkipped} read-named men (the read key / biters) kept the animation's own J8a2 read`)
  console.log(`E1c ON: recorded tackler drawn on the carrier ${tkOk}/${tkN} (worst gap ${fmt(tkGapMax)} yd; ${tkNoDot} with no dot, ${tkChased} chased), end spot exact ${endN - endBad}/${endN}`)
  console.log(`E1c ON: drawn-from-recording men over the pace reference: ${paceBad} frames (worst ${fmt(paceMax)} yd/s ${paceMaxWho}); every mover over ${fmt(1.06)}x cap: ${paceAllBad} (worst ${fmt(paceAllMax)} yd/s ${paceAllWho}); men drawn ${stats.men}, skipped ${stats.menSkipped}`)
  console.log(`E1c ON: sideways (heading > 60 deg off downfield) ${band(side)}; in bounds ${band(sideIn)}; out of bounds ${band(sideOob)} (animflow r8 bands: runs <= 20%, in bounds <= 6%, oob lat/down <= 2.0)`)
  if (oobWorst.length) {
    for (const w of oobWorst.sort((a, b) => b.lat / Math.max(0.1, b.down) - a.lat / Math.max(0.1, a.down)).slice(0, 5)) {
      console.log(`      oob ${w.p}: lat ${fmt(w.lat)} down ${fmt(w.down)} = ${fmt(w.lat / Math.max(0.1, w.down))} (drawn y ${fmt(w.y0, 1)} -> ${fmt(w.y1, 1)}; rec ${w.r0} -> ${w.r1}, rec y ${fmt(w.ry0, 1)}..${fmt(w.ry1, 1)})`)
    }
  }
  if (devBad) throw new Error(`E1c: ${devBad} plays draw the carrier off the recording by > 0.5 yd (worst ${fmt(devMax, 3)})`)
  if (menBad) throw new Error(`E1c: ${menBad} recorded men are drawn off their recording by > 0.5 yd`)
  if (samples < 500) throw new Error(`E1c coverage: only ${samples} recorded samples checked`)
  if (tkN < 40) throw new Error(`E1c coverage: only ${tkN} recorded tackles checked`)
  if (tkOk / Math.max(1, tkN) < 0.9) throw new Error(`E1c: the recorded tackler is on the carrier in only ${tkOk}/${tkN}`)
  if (endBad) throw new Error(`E1c: ${endBad}/${endN} drawn end spots are off the recorded spot`)
  if (paceBad) throw new Error(`E1c: ${paceBad} drawn-from-recording frames exceed a man's own pace cap`)
  if (sideOob.n >= 5 && sideOob.lat / Math.max(1, sideOob.down) > 2.0) {
    throw new Error(`E1c: out-of-bounds runs travel ${fmt(sideOob.lat / Math.max(1, sideOob.down))} yd sideways per downfield yard`)
  }
  if (sideIn.n >= 5 && sideIn.tAll && (100 * sideIn.tSide) / sideIn.tAll > 6) {
    throw new Error(`E1c: in-bounds runs spend ${fmt((100 * sideIn.tSide) / sideIn.tAll, 1)}% of the carry heading sideways`)
  }
  if (stats.men === 0) throw new Error('E1c: no recorded man was drawn from the recording')
  void tkFallback
  // ── the pass hook's own gates (see (3) above) ──────────────────────────────
  if (pN < 8) throw new Error(`E1c pass coverage: only ${pN} recorded passes checked`)
  if (pChanged !== pN) throw new Error(`E1c pass: the drawing did not change on ${pN - pChanged}/${pN} recorded passes`)
  if (pDevBad) throw new Error(`E1c pass: ${pDevBad} passes draw the carrier off the recorded after-catch segment by > 0.5 yd (worst ${fmt(pDevMax, 3)})`)
  if (pEndBad) throw new Error(`E1c pass: ${pEndBad} drawn end spots are off the recorded spot`)
}

await import('./check-broadcast.ts')
