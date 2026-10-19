// ─────────────────────────────────────────────────────────────────────────────
// Trick-play animation (FUTURES #24 T3).
//
// T1 records the trick on the Play (`play.trick`, `trickSurprise`, `trickReadIds`)
// and T2 installs the calls. T3 makes the broadcast DRAW each one as it happened:
//
//   flea flicker  handoff to the back → pitch back to the QB → deep shot
//   reverse       handoff to the back → exchange to the receiver going the other
//                 way → he carries to the recorded spot
//   HB pass       the QB tosses to the back → the back rolls out and throws
//   fake spike    the QB fakes the spike at the line → pulls it back → quick throw
//
// The engine outcome is untouched: this module only rewrites the DRAWING of a
// Play the sim already resolved. buildTrickAnim() builds the ordinary animation
// (playAnim.buildPlayAnim → every existing system: routes, protection, coverage,
// E1c's recorded field where the play carries one) and then layers the trick's
// backfield exchanges over it. The receiver routes, the catch, the recorded end
// spot and the post-release flight are exactly the base drawing's; only the men
// in the exchange and the ball before the release are re-choreographed. Every
// leg is timed by the specific man's own pace (`paceFor`, the sim's speed
// function), never a unit average, and the defence's reaction is drawn on the
// specific defenders nearest the fake — they bite, then recover to their own
// coverage path.
//
// No teleports: every path is continuous, the ball travels between hands over a
// real relay (never jumps), and the exchange points are the same spot for both
// men (within a hand's reach).
//
// playAnim.ts / broadcast/** are owned by a parallel job: this file imports
// them, it never edits them.
// ─────────────────────────────────────────────────────────────────────────────

import type { Play } from '../game/engine/playsim'
import { isTrickKind, type TrickKind } from '../game/engine/trickPlays'
import { paceFor } from '../game/engine/pace'
import { buildPlayAnim, type AnimContext, type PlayAnim } from './playAnim'
import { presentAnim, type BroadcastAnim } from './broadcast/animData'
import { TRICK_MOTION, type TrickBeatRole } from '../lib/trickUi'

/** The play clock's fixed pre-snap beat (matches `playAnim.SNAP`). */
const SNAP = 0.14
const MID_Y = 26.65

interface Pt { x: number; y: number }
interface Sec { t: number; x: number; y: number }

/** One drawn exchange / beat, in animation time (0..1) and field yards. */
export interface TrickBeat {
  role: TrickBeatRole
  /** The dot the ball leaves (or, on a fake / carry, the man it stays with). */
  from: string
  /** The dot the ball reaches. */
  to: string
  /** Normalised animation time (0..1). */
  t: number
  x: number
  y: number
}

/** The defence's drawn reaction: these specific men bite toward `toward`. */
export interface TrickReact {
  keys: string[]
  toward: Pt
  /** Normalised window the bite happens in. */
  t0: number
  t1: number
}

/** Everything the check and the probe read back from one trick drawing. */
export interface TrickDraw {
  kind: TrickKind
  /** The dot carrying the ball at the end (the recorded carrier). */
  carrier: string
  /** The dot who throws on a pass trick. */
  thrower?: string
  /** In order. */
  beats: TrickBeat[]
  react: TrickReact[]
  /** Normalised release time on a pass trick. */
  releaseT?: number
  /** Extra ball-height keys the trick needs (the fake spike's dip, a pitch). */
  ballZ?: { t: number; z: number }[]
}

export type TrickAnim = BroadcastAnim & { trickDraw?: TrickDraw }

// ── small maths / path helpers ───────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
const Dof = (anim: PlayAnim) => Math.max(0.5, (anim.duration || 0) / 1000)

function secPos(path: Sec[], t: number): Pt {
  if (!path.length) return { x: 0, y: 0 }
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]
    if (t <= b.t) {
      const a = path[i - 1]
      const span = b.t - a.t
      const u = span <= 0 ? 1 : (t - a.t) / span
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
  }
  const l = path[path.length - 1]
  return { x: l.x, y: l.y }
}

function actorSec(anim: PlayAnim, key: string, D: number): Sec[] {
  const a = anim.actors.find((x) => x.key === key)
  return a ? a.path.map((w) => ({ t: w.t * D, x: w.x, y: w.y })) : []
}

function setActorSec(anim: PlayAnim, key: string, pts: Sec[], D: number): void {
  const a = anim.actors.find((x) => x.key === key)
  if (!a) return
  const out: Sec[] = []
  for (const p of pts) {
    const t = clamp(p.t, 0, D)
    if (out.length && t <= out[out.length - 1].t + 1e-6) continue
    // No field clamp: the base drawing's own geometry (a man off the sideline, a
    // safety deep behind the goal line) is preserved exactly, so re-setting a path
    // never quietly moves a man who was not part of the exchange.
    out.push({ t, x: p.x, y: p.y })
  }
  // A man must be somewhere for the whole play: hold his last spot to the whistle.
  if (out.length && out[out.length - 1].t < D - 1e-3) out.push({ t: D, x: out[out.length - 1].x, y: out[out.length - 1].y })
  a.path = out.map((p) => ({ t: p.t / D, x: p.x, y: p.y }))
}

/** Sample a path between two seconds so the ball shadows it every 0.05 s. */
function shadowSec(pts: Sec[], t0: number, t1: number): Sec[] {
  const out: Sec[] = []
  for (let t = t0 + 0.05; t < t1 - 1e-6; t += 0.05) out.push({ t, ...secPos(pts, t) })
  if (!out.length || out[out.length - 1].t < t1 - 1e-6) out.push({ t: t1, ...secPos(pts, t1) })
  return out
}

/** A real leg: the man's own top speed plus a step of acceleration. */
function arrival(t: number, a: Pt, b: Pt, top: number): number {
  return t + Math.max(0.09, dist(a, b) / Math.max(1.6, top) + 0.05)
}

/** The app's own top speed for a dot (never a fallback league average). */
function topOf(ctx: AnimContext, key: string): number {
  const p = ctx.actors?.get(key)
  return paceFor(p, p?.pos).top
}

function keyById(ctx: AnimContext, id: string | undefined): string | undefined {
  if (!id) return undefined
  for (const [k, p] of ctx.actors ?? []) if (p.id === id) return k
  return undefined
}

function keyOfPos(ctx: AnimContext, pos: string, not?: string): string | undefined {
  for (const [k, p] of ctx.actors ?? []) if (p.pos === pos && k !== not && !/^(ol|dl)/.test(k)) return k
  return undefined
}

function losOf(play: Play): number {
  return 10 + play.startYard
}

function cloneAnim(a: BroadcastAnim): PlayAnim {
  return {
    duration: a.duration,
    actors: a.actors.map((x) => ({ key: x.key, side: x.side, role: x.role, path: x.path.map((w) => ({ ...w })) })),
    ball: a.ball.map((w) => ({ ...w })),
    holders: a.holders.map((h) => ({ ...h })),
    flights: a.flights.map((f) => ({ ...f })),
    engagements: a.engagements?.map((e) => ({ ...e })),
    events: a.events?.map((e) => ({ ...e, keys: [...e.keys], spot: { ...e.spot } })),
    flag: a.flag ? { ...a.flag } : undefined,
    posts: a.posts,
    throwStyle: a.throwStyle,
    kickZ: a.kickZ?.map((k) => ({ ...k })),
    sheds: a.sheds?.map((s) => ({ ...s, blk: [...s.blk] })),
    catchRoute: a.catchRoute,
  }
}

/**
 * Rebuild the ball: the trick's own pre-release path, then whatever the base
 * drawing had after `keepFrom` (the flight, the catch and the run after it).
 */
function rebuildBall(anim: PlayAnim, D: number, pre: Sec[], keepFrom?: number): void {
  const base = anim.ball.map((w) => ({ t: w.t * D, x: w.x, y: w.y }))
  const tail = keepFrom == null ? [] : base.filter((w) => w.t > keepFrom + 1e-6)
  const all: Sec[] = []
  for (const p of [...pre, ...tail]) {
    const t = clamp(p.t, 0, D)
    if (all.length && t <= all[all.length - 1].t + 1e-6) continue
    all.push({ t, x: p.x, y: p.y })
  }
  if (all.length && all[all.length - 1].t < D - 1e-3) all.push({ t: D, x: all[all.length - 1].x, y: all[all.length - 1].y })
  anim.ball = all.map((p) => ({ t: p.t / D, x: p.x, y: p.y }))
}

/** Holders from the snap through the trick, then the base's own post-release beats. */
function rebuildHolders(anim: PlayAnim, D: number, pre: { t: number; key: string | null }[], keepFrom?: number): void {
  const base = anim.holders.map((h) => ({ t: h.t * D, key: h.key }))
  const tail = keepFrom == null ? [] : base.filter((h) => h.t > keepFrom + 1e-6)
  anim.holders = [...pre, ...tail].map((h) => ({ t: clamp(h.t / D, 0, 1), key: h.key }))
}

/**
 * The defence bites on the fake: the specific defenders nearest the fake spot
 * lean `amount` yards toward it for a beat, then the base coverage path resumes
 * (their next recorded waypoint — no jump, and they recover by themselves).
 */
function bite(anim: PlayAnim, keys: string[], toward: Pt, t0: number, t1: number, amount: number, D: number): string[] {
  const bit: string[] = []
  const w = t1 - t0
  if (!(w > 0.2)) return bit
  const tA = t0 + w * 0.28
  const tB = t0 + w * 0.72
  for (const k of keys) {
    const secs = actorSec(anim, k, D)
    if (secs.length < 2) continue
    const p = secPos(secs, (tA + tB) / 2)
    const d = dist(p, toward)
    if (d < 0.25) continue
    const u = Math.min(1, 3.5 / d) * amount
    if (u < 0.3) continue
    // One consistent lean for the whole window: EVERY waypoint the man is on inside
    // [tA, tB] is displaced by the same vector, so he holds the bite for the whole
    // beat. He steps onto it from his own previous waypoint and his own next one
    // brings him straight back to his own coverage path — which is never touched, so
    // he recovers by himself and still ends where the base drawing ended him.
    const gx = (toward.x - p.x) / d
    const gy = (toward.y - p.y) / d
    const moved: Sec[] = []
    for (const wp of secs) {
      if (wp.t > tA + 1e-9 && wp.t < tB - 1e-9) moved.push({ t: wp.t, x: wp.x + gx * u, y: wp.y + gy * u })
      else moved.push(wp)
    }
    const a0 = secPos(secs, tA)
    const b0 = secPos(secs, tB)
    moved.push({ t: tA, x: a0.x + gx * u, y: a0.y + gy * u })
    moved.push({ t: tB, x: b0.x + gx * u, y: b0.y + gy * u })
    moved.sort((x, y) => x.t - y.t)
    setActorSec(anim, k, moved, D)
    bit.push(k)
  }
  return bit
}

/** The men nearest the ball at `t` on defence (the ones a fake actually moves). */
function nearestDef(anim: PlayAnim, D: number, at: Pt, t: number, n: number): string[] {
  return anim.actors
    .filter((a) => a.side === 'def' && !/^dl/.test(a.key))
    .map((a) => ({ k: a.key, d: dist(secPos(actorSec(anim, a.key, D), t), at) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.k)
}

function beat(role: TrickBeatRole, from: string, to: string, t: number, p: Pt, D: number): TrickBeat {
  return { role, from, to, t: clamp(t / D, 0, 1), x: p.x, y: p.y }
}

// ── flea flicker: handoff → pitch back → deep shot ──────────────────────────

function drawFlea(anim: PlayAnim, play: Play, ctx: AnimContext): TrickDraw | null {
  const D = Dof(anim)
  const los = losOf(play)
  const rel = anim.flights.length ? anim.flights[0].t0 * D : 0
  if (!(rel > SNAP + 0.12)) return null
  const qbSec = actorSec(anim, 'qb', D)
  const rb = keyOfPos(ctx, 'RB') ?? 'rb'
  const rbSec = actorSec(anim, rb, D)
  if (!qbSec.length || !rbSec.length) return null
  const qbSnap = secPos(qbSec, SNAP)
  const rbSnap = secPos(rbSec, SNAP)
  const qTop = topOf(ctx, 'qb')
  const rTop = topOf(ctx, rb)
  const releasePos = secPos(qbSec, rel)

  // The handoff: the back attacks the QB's open step (the ball is met, not carried).
  const H = { x: los - 2.6, y: MID_Y + (rbSnap.y >= MID_Y ? 1.7 : -1.7) }
  const tHq = arrival(SNAP, qbSnap, H, qTop)
  const tHr = arrival(SNAP, rbSnap, H, rTop)
  // The pitch back: the QB trails two steps, the back turns and flips it back.
  const P = { x: H.x - 1.4, y: H.y + (H.y >= MID_Y ? 0.9 : -0.9) }
  let tH = Math.max(tHq, tHr) + 0.06
  let tP = arrival(tH + 0.18, H, P, rTop) + 0.08
  // A trick that throws on a quick release has no room for two full-speed legs:
  // the exchanges are COMPRESSED into the play's own window (still real moves on
  // the men's own paths, only the timing scales), never dropped — and the passer
  // still holds the ball for a beat after the pitch, so the relay reads as one.
  if (tP > rel - 0.42) {
    const span = Math.max(0.14, rel - SNAP)
    tH = SNAP + span * 0.38
    tP = SNAP + span * 0.58
  }
  tP = Math.min(tP, Math.max(SNAP + 0.16, rel - 0.26))
  tH = Math.max(SNAP + 0.08, Math.min(tH, tP - 0.08))
  const block = { x: los - 1.2, y: clamp(H.y + (H.y >= MID_Y ? 3 : -3), 3, 50) }
  const tBlock = arrival(tP, P, block, rTop)

  const qbOut: Sec[] = qbSec.filter((w) => w.t <= SNAP + 1e-6)
  qbOut.push({ t: tH, x: H.x + 0.8, y: H.y + 0.5 })
  qbOut.push({ t: tH + 0.1, x: H.x + 0.8, y: H.y + 0.5 })
  qbOut.push({ t: tP, x: P.x + 0.65, y: P.y + 0.45 })
  // Back to his own drop spot for the deep shot (the base release position).
  qbOut.push({ t: Math.max(tP + 0.2, rel - 0.02), x: releasePos.x, y: releasePos.y })
  setActorSec(anim, 'qb', qbOut, D)

  const rbOut: Sec[] = rbSec.filter((w) => w.t <= SNAP + 1e-6)
  rbOut.push({ t: tH, x: H.x - 0.25, y: H.y - 0.25 })
  rbOut.push({ t: tP, x: P.x - 0.3, y: P.y - 0.3 })
  rbOut.push({ t: Math.min(D - 0.4, Math.max(tBlock, tP + 0.5)), x: block.x, y: block.y })
  setActorSec(anim, rb, rbOut, D)

  // The ball: snap → QB → back → back to the QB → the base flight.
  const qbAt = (t: number) => secPos(qbOut, t)
  const rbAt = (t: number) => secPos(rbOut, t)
  const pre: Sec[] = [{ t: 0, x: los, y: MID_Y }, { t: SNAP, ...qbSnap }]
  pre.push(...shadowSec(qbOut, SNAP, tH).map((p) => ({ ...p, x: p.x, y: p.y })))
  pre.push({ t: tH, x: H.x, y: H.y })
  pre.push({ t: tH + 0.08, ...rbAt(tH + 0.08) })
  pre.push(...shadowSec(rbOut, tH + 0.08, tP))
  // A lateral is in the air for a beat: the ball leaves the back's hands and the
  // QB takes it (a real relay, never a jump).
  pre.push({ t: tP, x: P.x, y: P.y })
  pre.push({ t: tP + 0.08, x: P.x, y: P.y })
  pre.push({ t: tP + 0.16, ...qbAt(tP + 0.16) })
  pre.push(...shadowSec(qbOut, tP + 0.16, rel))
  rebuildBall(anim, D, pre, rel)
  rebuildHolders(anim, D, [
    { t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: tH, key: rb }, { t: tP + 0.16, key: 'qb' }, { t: rel, key: null },
  ], rel)

  const reactKeys = bite(anim, nearestDef(anim, D, H, tH, 6), H, tH, tP + 0.35, 1.5, D)
  return {
    kind: 'flea',
    carrier: 'qb',
    thrower: 'qb',
    releaseT: clamp(rel / D, 0, 1),
    beats: [
      beat('handoff', 'qb', rb, tH, H, D),
      beat('pitch', rb, 'qb', tP + 0.08, P, D),
      beat('throw', 'qb', 'qb', rel, releasePos, D),
    ],
    react: [{ keys: reactKeys, toward: H, t0: tH / D, t1: Math.min(0.98, (tP + 0.35) / D) }],
    ballZ: [{ t: tP / D, z: 1.15 }, { t: (tP + 0.08) / D, z: 1.35 }, { t: (tP + 0.16) / D, z: 0.85 }],
  }
}

// ── HB pass: the QB tosses to the back, the back rolls out and throws ────────

function drawHbPass(anim: PlayAnim, play: Play, ctx: AnimContext): TrickDraw | null {
  const D = Dof(anim)
  const los = losOf(play)
  const rel = anim.flights.length ? anim.flights[0].t0 * D : 0
  if (!(rel > SNAP + 0.1)) return null
  const thrower = keyById(ctx, play.qbId) ?? 'qb'
  const handler = keyOfPos(ctx, 'QB', thrower) ?? (thrower === 'qb' ? 'rb' : 'qb')
  const thSec = actorSec(anim, thrower, D)
  const hSec = actorSec(anim, handler, D)
  if (!thSec.length || !hSec.length) return null
  const thSnap = secPos(thSec, SNAP)
  const hSnap = secPos(hSec, SNAP)
  const thTop = topOf(ctx, thrower)
  const hTop = topOf(ctx, handler)
  const side = thSnap.y >= MID_Y ? 1 : -1
  // The back is the thrower: he lines up off the QB, takes the toss, rolls out.
  const T = { x: hSnap.x - 0.5, y: MID_Y + side * 1.1 }
  const tHh = arrival(SNAP, hSnap, T, hTop)
  const tTh = arrival(SNAP, thSnap, T, thTop)
  let tT = Math.max(tHh, tTh) + 0.05
  // A trick that throws on a quick release is compressed into its own window (the
  // toss and the boot stay real moves, only when scales), never dropped — and the
  // back still holds the ball for a beat before he throws it.
  if (rel - tT < 0.32) tT = SNAP + Math.max(0.12, rel - SNAP) * 0.4
  tT = Math.min(tT, Math.max(SNAP + 0.14, rel - 0.24))
  // How far he can roll out before the recorded release: a quick throw is a
  // short boot, a deep concept a full sprint-out. The distance is his own.
  const reach = Math.max(0, (rel - tT - 0.15) * thTop * 0.85)
  const launch = { x: los - 2.8, y: clamp(MID_Y + side * clamp(reach, 2.4, 10.5), 4, 49) }
  const tL = Math.min(arrival(tT + 0.1, T, launch, thTop), rel - 0.12)
  const after = { x: launch.x + 0.8, y: clamp(launch.y + side * 1.4, 4, 49) }

  // Alignments: the real QB under centre, the back behind him (his own set spots).
  const hOut: Sec[] = hSec.filter((w) => w.t <= SNAP + 1e-6).map((w) => ({ ...w }))
  const thOut: Sec[] = thSec.filter((w) => w.t <= SNAP + 1e-6).map((w) => ({ ...w }))
  for (const w of hOut) { w.x = thSnap.x; w.y = thSnap.y }
  for (const w of thOut) { w.x = hSnap.x; w.y = hSnap.y }

  // The QB takes the snap, opens and tosses, then protects his side.
  hOut.push({ t: tT, x: T.x, y: T.y })
  hOut.push({ t: Math.min(D - 0.4, tT + 0.8), x: Math.max(los - 4.5, T.x - 1.4), y: clamp(MID_Y + side * 3.2, 4, 49) })
  setActorSec(anim, handler, hOut, D)

  // The back takes it and rolls out to his launch point, then throws.
  thOut.push({ t: tT, x: T.x + 0.35, y: T.y + 0.3 })
  thOut.push({ t: tL, x: launch.x, y: launch.y })
  thOut.push({ t: Math.min(D - 0.2, rel + 0.35), x: after.x, y: after.y })
  setActorSec(anim, thrower, thOut, D)

  // Ball: snap → the QB → the toss → the back carries it out → the flight.
  const hAt = (t: number) => secPos(hOut, t)
  const thAt = (t: number) => secPos(thOut, t)
  const pre: Sec[] = [{ t: 0, x: los, y: MID_Y }, { t: SNAP, ...hAt(SNAP) }]
  pre.push(...shadowSec(hOut, SNAP, tT))
  pre.push({ t: tT, x: T.x, y: T.y })
  pre.push({ t: tT + 0.12, ...thAt(tT + 0.12) })
  pre.push(...shadowSec(thOut, tT + 0.12, rel))
  pre.push({ t: rel, ...thAt(rel) })
  rebuildBall(anim, D, pre, rel)
  rebuildHolders(anim, D, [
    { t: 0, key: null }, { t: SNAP, key: handler }, { t: tT + 0.12, key: thrower }, { t: rel, key: null },
  ], rel)

  const reactKeys = bite(anim, nearestDef(anim, D, T, tT, 6), launch, tT, Math.min(rel - 0.2, tL + 0.2), 1.2, D)
  const relSpot = secPos(thOut, rel)
  return {
    kind: 'hbpass',
    carrier: thrower,
    thrower,
    releaseT: clamp(rel / D, 0, 1),
    beats: [
      beat('toss', handler, thrower, tT, T, D),
      beat('throw', thrower, thrower, rel, relSpot, D),
    ],
    react: [{ keys: reactKeys, toward: launch, t0: tT / D, t1: Math.min(0.98, Math.min(rel - 0.2, tL + 0.2) / D) }],
  }
}

// ── reverse: handoff → exchange to the receiver going the other way ─────────

function drawReverse(anim: PlayAnim, play: Play, ctx: AnimContext): TrickDraw | null {
  const D = Dof(anim)
  // The carrier is the dot the BASE drawing gives the ball (the last keyed holder):
  // placeCredited moves the credited man onto it, and it is that dot whose own path
  // ends on the recorded spot. T3 never rewrites it — the handoff only tells the
  // story up to the moment the ball reaches him.
  const carrier = [...anim.holders].reverse().find((h) => h.key)?.key
  if (!carrier) return null
  // The man who takes the handoff is whoever the FORMATION has next to the QB — the
  // specific man whose own snap spot is nearest the passer's, never a slot label.
  const qbSnap = secPos(actorSec(anim, 'qb', D), SNAP)
  const back = anim.actors
    .filter((a) => a.side === 'off' && a.key !== carrier && a.key !== 'qb' && !/^(ol|dl)/.test(a.key))
    .map((a) => ({ k: a.key, d: dist(secPos(actorSec(anim, a.key, D), SNAP), qbSnap) }))
    .sort((a, b) => a.d - b.d)[0]
  if (!back || back.d > 9) return null
  const bk = back.k
  const qbSec = actorSec(anim, 'qb', D)
  const cSec = actorSec(anim, carrier, D)
  const bSec = actorSec(anim, bk, D)
  if (!qbSec.length || !cSec.length || !bSec.length) return null
  const bSnap = secPos(bSec, SNAP)
  const bTop = Math.max(1.6, topOf(ctx, bk))
  const cEnd = cSec[cSec.length - 1]?.t ?? D
  if (!(cEnd > SNAP + 0.5)) return null

  // 1. The mesh: the point where the passer and the back MEET. The QB's own drawn
  //    path is the anchor (he reaches a step toward the back, never off his path by
  //    more than an arm) and both men run their own leg at their own pace — a
  //    two-step fixpoint, never a stale spot.
  const qbSnapP = secPos(qbSec, SNAP)
  const ux = (bSnap.x - qbSnapP.x) / Math.max(0.3, dist(qbSnapP, bSnap))
  const uy = (bSnap.y - qbSnapP.y) / Math.max(0.3, dist(qbSnapP, bSnap))
  let mesh = secPos(qbSec, SNAP + 0.2)
  let tH = Math.max(SNAP + 0.18, arrival(SNAP, bSnap, mesh, bTop))
  for (let i = 0; i < 3; i++) {
    const q = secPos(qbSec, tH)
    mesh = { x: q.x + ux * 1.2, y: q.y + uy * 1.2 }
    tH = Math.max(SNAP + 0.18, arrival(SNAP, bSnap, mesh, bTop))
  }
  const qAtH = secPos(qbSec, tH)
  mesh = { x: qAtH.x + ux * 1.2, y: qAtH.y + uy * 1.2 }

  // 2. The exchange: the FIRST point on the CARRIER'S OWN path the back can reach at
  //    his own top speed (a hand's reach counts). The carrier is never moved and
  //    never slowed — the ball reaches him exactly where the base drawing already
  //    has him, at the time it already has him there.
  let tX = -1
  let X = mesh
  for (let t = tH + 0.16; t <= cEnd - 0.06; t += 0.03) {
    const p = secPos(cSec, t)
    if (dist(mesh, p) - 1.2 <= (t - tH) * bTop) { tX = t; X = p; break }
  }
  if (tX < 0) return null

  // The back: his own snap spot → the mesh → the exchange → he peels off to block.
  const bOut: Sec[] = bSec.filter((w) => w.t <= SNAP + 1e-6).map((w) => ({ ...w }))
  bOut.push({ t: tH, x: mesh.x, y: mesh.y })
  bOut.push({ t: tX, x: X.x, y: X.y })
  bOut.push({ t: Math.min(D - 0.1, tX + 0.8), x: X.x + 1.2, y: clamp(X.y + (X.y >= MID_Y ? 2.6 : -2.6), 4, 49) })
  setActorSec(anim, bk, bOut, D)

  // Ball: snap → the QB (his own path) → the handoff → the back carries it to the
  // exchange → the carrier's own path (untouched) to the recorded end spot.
  const pre: Sec[] = [{ t: 0, x: losOf(play), y: MID_Y }, { t: SNAP, ...secPos(qbSec, SNAP) }]
  pre.push(...shadowSec(qbSec, SNAP, Math.max(SNAP + 0.02, tH - 0.06)))
  pre.push({ t: tH, x: mesh.x, y: mesh.y })
  pre.push(...shadowSec(bOut, tH + 0.06, tX))
  pre.push({ t: tX, x: X.x, y: X.y })
  pre.push(...shadowSec(cSec, tX + 0.06, cEnd))
  rebuildBall(anim, D, pre)
  rebuildHolders(anim, D, [
    { t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: tH, key: bk }, { t: tX + 0.04, key: carrier },
  ])

  const reactEnd = Math.min(0.985, (Math.max(tX, tH + 0.5) + 0.3) / D)
  const reactKeys = bite(anim, nearestDef(anim, D, mesh, tH, 6), mesh, tH + 0.05, reactEnd * D, 1.6, D)
  return {
    kind: 'reverse',
    carrier,
    beats: [
      beat('handoff', 'qb', bk, tH, mesh, D),
      beat('exchange', bk, carrier, tX, X, D),
      beat('carry', carrier, carrier, cEnd, secPos(cSec, cEnd), D),
    ],
    react: [{ keys: reactKeys, toward: mesh, t0: (tH + 0.05) / D, t1: reactEnd }],
    ballZ: [{ t: (tX + 0.03) / D, z: 1.0 }],
  }
}

// ── fake spike: the QB sells the spike, pulls it back, quick throw ──────────

function drawFakeSpike(anim: PlayAnim, play: Play): TrickDraw | null {
  const D = Dof(anim)
  const los = losOf(play)
  const rel = anim.flights.length ? anim.flights[0].t0 * D : 0
  if (!(rel > SNAP + 0.12)) return null
  const qbSec = actorSec(anim, 'qb', D)
  if (qbSec.length < 2) return null
  const qbSnap = secPos(qbSec, SNAP)
  const releasePos = secPos(qbSec, rel)
  // The lunge to the line and the pull-back are compressed into the window a quick
  // throw leaves (still on the QB's own path), never dropped.
  const tFake = Math.max(SNAP + 0.08, Math.min(rel - 0.22, SNAP + 0.32))
  const spike = { x: los - 0.55, y: MID_Y }
  const drop = { x: releasePos.x, y: releasePos.y }
  const tBack = Math.max(tFake + 0.08, Math.min(rel - 0.05, tFake + 0.3))

  const out: Sec[] = qbSec.filter((w) => w.t <= SNAP + 1e-6)
  out.push({ t: tFake, x: spike.x, y: spike.y })
  out.push({ t: tFake + 0.08, x: spike.x, y: spike.y })
  out.push({ t: tBack, x: drop.x, y: drop.y })
  out.push({ t: Math.max(tBack + 0.12, rel - 0.02), x: releasePos.x, y: releasePos.y })
  setActorSec(anim, 'qb', out, D)

  const qAt = (t: number) => secPos(out, t)
  const pre: Sec[] = [{ t: 0, x: los, y: MID_Y }, { t: SNAP, ...qbSnap }]
  pre.push(...shadowSec(out, SNAP, tFake))
  // The ball is thrust at the line as if to spike it, then pulled back.
  pre.push({ t: tFake + 0.06, x: spike.x + 0.55, y: spike.y })
  pre.push({ t: tFake + 0.14, x: spike.x + 0.35, y: spike.y })
  pre.push(...shadowSec(out, tFake + 0.2, rel))
  pre.push({ t: rel, ...qAt(rel) })
  rebuildBall(anim, D, pre, rel)
  rebuildHolders(anim, D, [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: rel, key: null }], rel)

  // They relax a step: the safeties drift back off the fake, then break on the throw.
  const reactKeys = bite(anim, nearestDef(anim, D, spike, tFake, 6), { x: spike.x - 2.2, y: MID_Y }, tFake, Math.min(rel - 0.15, tFake + 0.6), 0.9, D)
  return {
    kind: 'fakespike',
    carrier: 'qb',
    thrower: 'qb',
    releaseT: clamp(rel / D, 0, 1),
    beats: [
      beat('fake', 'qb', 'qb', tFake + 0.06, spike, D),
      beat('throw', 'qb', 'qb', rel, releasePos, D),
    ],
    react: [{ keys: reactKeys, toward: { x: spike.x - 2.2, y: MID_Y }, t0: tFake / D, t1: Math.min(0.98, Math.min(rel - 0.15, tFake + 0.6) / D) }],
    // The spike fake dips the ball to the turf and snaps it back up: the one
    // thing a 2-D path cannot say, so it rides the ball-height keys.
    ballZ: [
      { t: (tFake + 0.02) / D, z: 0.18 },
      { t: (tFake + 0.1) / D, z: 0.18 },
      { t: (tFake + 0.22) / D, z: 1.15 },
    ],
  }
}

// ── the public entry ─────────────────────────────────────────────────────────

/**
 * The broadcast animation for one play. A non-trick play is exactly
 * `buildPlayAnim` (the call is a pass-through). A trick play is the same drawing
 * with its exchanges layered on and the presentation recomputed from the new
 * paths, so every pose / facing / camera hint is consistent with what is drawn.
 */
export function buildTrickAnim(play: Play, ctx: AnimContext = {}): TrickAnim {
  const base = buildPlayAnim(play, ctx)
  const kind = play.trick
  if (!kind || !isTrickKind(kind) || !ctx.actors) return base
  if (play.result.startsWith('Sack') || play.spike || fumbled(play)) return base
  if (kind === 'reverse' ? play.type !== 'run' || qbRunDraw(play) : play.type !== 'pass') return base
  const raw = cloneAnim(base)
  const draw = kind === 'flea' ? drawFlea(raw, play, ctx)
    : kind === 'reverse' ? drawReverse(raw, play, ctx)
      : kind === 'hbpass' ? drawHbPass(raw, play, ctx)
        : drawFakeSpike(raw, play)
  if (!draw) return base
  // The throw's style is the trick's: a rollout pass is on the run, a fake spike
  // is a quick flick, a flea flicker is a deep wind-up.
  if (kind === 'hbpass') raw.throwStyle = 'run'
  else if (kind === 'fakespike') raw.throwStyle = 'quick'
  else if (kind === 'flea') raw.throwStyle = 'deep'
  const pres = presentAnim(raw, play, ctx) as TrickAnim
  pres.trickDraw = draw
  if (draw.ballZ?.length) {
    const z = [...pres.ballZ, ...draw.ballZ].sort((a, b) => a.t - b.t)
    const merged: { t: number; z: number }[] = []
    for (const k of z) {
      if (merged.length && Math.abs(k.t - merged[merged.length - 1].t) < 1e-6) merged[merged.length - 1] = k
      else merged.push(k)
    }
    pres.ballZ = merged
  }
  return pres
}

/** The role order a kind must draw (the UI legend and the check share it). */
export function trickBeatRoles(kind: TrickKind): TrickBeatRole[] {
  return TRICK_MOTION[kind].map((m) => m.role)
}

/**
 * A trick that put the ball on the ground (`Fumble!`, a muffed catch, a strip) is
 * NOT layered: the base drawing already owns the loose ball and the recovery, and
 * an exchange rewrites the carrier's path under it (the ball must not end on the
 * carrier when the sim ended it on the recovery). The base's own fumble
 * choreography stands.
 */
function fumbled(play: Play): boolean {
  return !!play.fumbleId || /Fumble/.test(play.result)
}

/**
 * The base draws this play as a QB run (`playAnim`'s own `qbRun`: the QB is the
 * carrier, the ball is his from the snap). A reverse whose concept fell back to a
 * QB-run call (no Reverse entry in that formation's playbook) is drawn as a QB
 * draw by the base drawing, so T3 must not layer the exchanges over the QB's own
 * run — the ball would end on the QB instead of the recorded spot. Pass through.
 */
function qbRunDraw(play: Play): boolean {
  return !!play.optionKeep || /QB Draw|Scramble|Sneak/.test(play.concept)
}

/** Is this a real trick snap the overlay draws (not a sack / a fumble / the real spike / a QB-run draw)? */
export function trickDrawable(play: Play): boolean {
  if (!play.trick || !isTrickKind(play.trick)) return false
  if (play.result.startsWith('Sack') || play.spike || fumbled(play)) return false
  if (play.trick === 'reverse') return play.type === 'run' && !qbRunDraw(play)
  return play.type === 'pass'
}
