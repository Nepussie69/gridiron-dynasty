// Broadcast 2.5D (B2) checks: camera projection, near-plane clipping, the
// affine helpers, offense→world mapping, and end-zone wordmark contrast for
// all 32 clubs. B3: pose-library coverage of animData's pose states, figure
// scale vs depth, kit number contrast + outline edges (32 clubs home/away),
// depth-sort stability, and the actor layer (run-cycle phase by distance,
// stride vs speed, dir −1 mirroring, continuous pose blends, head point on a
// lying body, painter's order with the ball just in front of its carrier).
// B6a: graphics — every B1 event / engagement kind mapped (callout or an
// intentional ignore), the timeline deterministic, callouts only inside their
// windows and at most 2 at once (one per anchor), callout boxes never covering
// the carrier's head, text >= 12 CSS px at DPR 1 and 2, slab / HUD contrast,
// reduced motion (no wipes) and the sim-to-end mode (chip only).
// B6b: telestrator replay — replayPlan deterministic, the big-play rule table,
// telestrations only reference actors that exist, the freeze inside the play,
// skip ends the replay at once, nothing draws in 'fast' (sim to end), reduced
// motion cuts (no wipe, no draw-on) and every label >= 12 CSS px.
// animflow: the live field — engaged pairs are drawn touching and keep moving,
// a double team is shoulder to shoulder and one blocker climbs, pursuers never
// get inside the keep-out ring before the tackle phase, and a blocked defender
// takes the block pose facing his blocker; the carrier stumbles at first contact
// and the tackler is in the tackle pose facing him before going down.
// Run: node --experimental-strip-types scripts/check-broadcast.ts
import assert from 'node:assert/strict'
import { NFL_TEAMS } from '../src/game/data/nflTeams.ts'
import { bestInk, contrast, INK_DARK } from '../src/lib/teamColor.ts'
import {
  applyAffine,
  clipPolygon,
  FIELD_LENGTH,
  FIELD_WIDTH,
  fitAffine,
  invertAffine,
  makeCamera,
  offenseToWorld,
  offenseXToWorld,
  orbitPose,
  project,
  quad,
} from '../src/components/broadcast/camera.ts'
import { clubArt, WORDMARK_MIN } from '../src/components/broadcast/palette.ts'
import {
  clubKit,
  cycleLength,
  depthSort,
  figureScreen,
  HOME_AWAY_MIN,
  newPose,
  NUMBER_MIN,
  POSE_LIBRARY,
  poseParams,
  STROKE_SHOW_MIN,
  strokeReads,
  strideAmp,
  type Figure,
  type PoseParams,
} from '../src/components/broadcast/figures.ts'
import { ActorLayer } from '../src/components/broadcast/actors.ts'
import { ballZAt, kickFlight, presentAnim, THROW_STATE, THROW_TIMING, throwHand, type BroadcastAnim, type ThrowStyle } from '../src/components/broadcast/animData.ts'
import { LiveField, livePos, pursue, PAIR_GAP, type LiveMover } from '../src/components/playLive.ts'
import { runReturnField } from '../src/components/playReturn.ts'
import type { BroadcastFrame } from '../src/components/broadcast/renderer.ts'
import { readFileSync } from 'node:fs'
import type { ActorScreen } from '../src/components/broadcast/actors.ts'
import {
  buildGraphicsTimeline,
  CALLOUT_PRIORITY,
  ENGAGEMENT_GRAPHICS,
  EVENT_GRAPHICS,
  graphicsAt,
  layoutCallouts,
  MAX_CALLOUTS,
  MIN_CALLOUT,
  rectHitsCircle,
  rectsOverlap,
  resolveCallouts,
  type CalloutKind,
  type GraphicRole,
  type GraphicsTimeline,
} from '../src/components/broadcast/graphics.ts'
import { BROADCAST_TOKENS, clubSlab, GraphicsLayer, MIN_TEXT_PX, SLAB_INK_MIN, SLAB_LIFT_BELOW } from '../src/components/broadcast/graphicsDraw.ts'
import { ART } from '../src/components/broadcast/palette.ts'
import { ballState } from '../src/components/broadcast/ball.ts'
import { createBallFx, withBallFx } from '../src/components/broadcast/ballFx.ts'
import { buildFxSchedule, EVENT_FX, SHAKE_YARDS, shakeAt } from '../src/components/broadcast/fxSchedule.ts'
import type { AnimEventKind } from '../src/components/playAnim.ts'
import { holderAt as r6HolderAt, posAt as r6PosAt } from '../src/components/broadcast/interp.ts'
import { BIG_GAIN_YDS, customReplayReasons, DEFAULT_REPLAY_TYPES, GAME_DAY_LEAD_SEC, gameDayReplay, LONG_FG_YDS, MAX_SPAN_SEC, REPLAY_REASON_IDS, ReplayPlayer, replayAt, replayPlan, replayReasons, teleState, type ReplayPlan, type ReplayReasonId } from '../src/components/broadcast/replay.ts'
import { TelestratorLayer, composeHooks, partial } from '../src/components/broadcast/telestrator.ts'
import type { Play } from '../src/game/engine/playsim.ts'
import { carrierMove, effAttrs, effRating, fatigueMap, tackleStyle, tiredness } from '../src/components/animRatings.ts'
import { attrOf, CRISP_RR, paceFor } from '../src/components/playAnim.ts'
import { creditedIds, offenseKeys, recordedEleven } from '../src/components/jersey.ts'
import { playerAttrs } from '../src/game/data/ratings.ts'
import type { Player } from '../src/game/types.ts'
import type { World } from '../src/game/engine/generate.ts'
import { BENCHES, buildTeamArea, officialsAt, OFFICIAL_ROLES, readPlay, sideY } from '../src/components/broadcast/sideline.ts'
import { TEAM_BOX } from '../src/components/broadcast/field.ts'

let n = 0
const ok = (name: string, fn: () => void) => {
  fn()
  n++
  console.log(`  ok  ${name}`)
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps

const VP = { width: 1600, height: 900 }

ok('target projects to the viewport centre', () => {
  const c = makeCamera(orbitPose({ focusX: 72, focusY: 26.65, back: 28.5, height: 20, yaw: 0, fovDeg: 43 }), VP)
  const p = project(c, 72, 26.65, 0)!
  assert.ok(near(p.x, 800, 1e-6) && near(p.y, 450, 1e-6), `got ${p.x},${p.y}`)
})

ok('skycam (yaw 0, looking +x): −y is screen right, farther downfield is higher', () => {
  const c = makeCamera(orbitPose({ focusX: 60, focusY: 26.65, back: 30, height: 20, yaw: 0, fovDeg: 43 }), VP)
  const a = project(c, 60, 20, 0)!
  const b = project(c, 60, 33, 0)!
  assert.ok(a.x > b.x, 'lower y should be to the right')
  const f = project(c, 70, 26.65, 0)!
  const k = project(c, 50, 26.65, 0)!
  assert.ok(f.y < k.y, 'downfield should be higher on screen')
  assert.ok(f.depth > k.depth)
})

ok('near-sideline camera (yaw π/2): +x is screen right, so near-side numbers read left→right', () => {
  const c = makeCamera(orbitPose({ focusX: 60, focusY: 26.65, back: 50, height: 24, yaw: Math.PI / 2, fovDeg: 32 }), VP)
  assert.ok(c.py < 0, 'camera sits off the near sideline')
  const a = project(c, 50, 8, 0)!
  const b = project(c, 70, 8, 0)!
  assert.ok(b.x > a.x)
  // Number bottoms (y = 7) are nearer the camera than their tops (y = 9): lower on screen → upright.
  assert.ok(project(c, 60, 7, 0)!.y > project(c, 60, 9, 0)!.y)
})

ok('far-sideline camera (yaw −π/2): −x is screen right, far numbers upright', () => {
  const c = makeCamera(orbitPose({ focusX: 60, focusY: 26.65, back: 50, height: 24, yaw: -Math.PI / 2, fovDeg: 32 }), VP)
  assert.ok(c.py > FIELD_WIDTH)
  assert.ok(project(c, 50, 45, 0)!.x > project(c, 70, 45, 0)!.x)
  assert.ok(project(c, 60, FIELD_WIDTH - 7, 0)!.y > project(c, 60, FIELD_WIDTH - 9, 0)!.y)
})

ok('points behind the near plane are null', () => {
  const c = makeCamera({ pos: [0, 0, 10], target: [10, 0, 10], fovDeg: 40 }, VP)
  assert.equal(project(c, -5, 0, 10), null)
  assert.equal(project(c, 0.3, 0, 10), null)
  assert.ok(project(c, 1, 0, 10))
})

ok('straight-down camera does not produce NaN', () => {
  const c = makeCamera({ pos: [60, 26.65, 80], target: [60, 26.65, 0], fovDeg: 40 }, VP)
  const p = project(c, 70, 26.65, 0)!
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
  assert.ok(p.x > 800, '+x is right when looking straight down')
})

ok('clipPolygon: fully visible quad keeps 4 points matching project()', () => {
  const c = makeCamera(orbitPose({ focusX: 60, focusY: 26.65, back: 30, height: 20, yaw: 0, fovDeg: 43 }), VP)
  const pts = quad(55, 20, 65, 30)
  const s = clipPolygon(c, pts)
  assert.equal(s.length, 4)
  for (let i = 0; i < 4; i++) {
    const p = project(c, pts[i][0], pts[i][1], pts[i][2])!
    assert.ok(near(s[i][0], p.x, 1e-9) && near(s[i][1], p.y, 1e-9))
  }
})

ok('clipPolygon: quad straddling the camera is clipped at the near plane', () => {
  const c = makeCamera({ pos: [30, 26.65, 2], target: [60, 26.65, 0], fovDeg: 50 }, VP)
  const s = clipPolygon(c, quad(0, 0, 120, 53.3))
  assert.ok(s.length >= 3)
  for (const [x, y] of s) assert.ok(Number.isFinite(x) && Number.isFinite(y))
  // A quad entirely behind the camera disappears.
  assert.equal(clipPolygon(c, quad(0, 0, 20, 53.3)).length, 0)
})

ok('principal-point offset shifts the projection by exactly the margin', () => {
  const pose = orbitPose({ focusX: 60, focusY: 26.65, back: 30, height: 20, yaw: 0.3, fovDeg: 43 })
  const a = makeCamera(pose, VP)
  const b = makeCamera(pose, { ...VP, offsetX: 40, offsetY: 40 })
  const p = project(a, 75, 10, 0)!
  const q = project(b, 75, 10, 0)!
  assert.ok(near(q.x - p.x, 40) && near(q.y - p.y, 40))
})

ok('fitAffine / applyAffine / invertAffine round trip', () => {
  const src: [number, number][] = [
    [10, 20],
    [300, 40],
    [50, 400],
  ]
  const M = [1.02, 0.03, -0.05, 0.98, 12.5, -7] as const
  const dst = src.map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]] as [number, number])
  const A = fitAffine(src, dst)!
  for (let i = 0; i < 6; i++) assert.ok(near(A[i], M[i], 1e-9), `coef ${i}: ${A[i]} vs ${M[i]}`)
  const inv = invertAffine(A)!
  const [x, y] = applyAffine(inv, ...applyAffine(A, 123, 456))
  assert.ok(near(x, 123, 1e-9) && near(y, 456, 1e-9))
  assert.equal(fitAffine([[0, 0], [1, 1], [2, 2]], dst), null)
})

ok('offense frame → world', () => {
  assert.equal(offenseXToWorld(72, 1), 72)
  assert.equal(offenseXToWorld(72, -1), 48)
  const w = offenseToWorld(30, 10, -1)
  assert.ok(near(w.x, FIELD_LENGTH - 30) && near(w.y, FIELD_WIDTH - 10))
  assert.deepEqual(offenseToWorld(30, 10, 1), { x: 30, y: 10 })
})

ok(`all ${NFL_TEAMS.length} end-zone wordmarks reach ${WORDMARK_MIN}:1 on their end zone`, () => {
  assert.equal(NFL_TEAMS.length, 32)
  const rows: string[] = []
  for (const t of NFL_TEAMS) {
    const a = clubArt(t)
    const r = contrast(a.wordFill, a.endZone)
    rows.push(`${t.abbr} ${r.toFixed(2)}`)
    assert.ok(r >= WORDMARK_MIN, `${t.abbr}: wordmark ${a.wordFill} on ${a.endZone} is ${r.toFixed(2)}:1`)
    assert.ok(contrast(a.logoText, a.logoFill) >= 3, `${t.abbr}: midfield logo text`)
    assert.ok(contrast(a.ledText, a.ledMid) >= 3, `${t.abbr}: LED text ${a.ledText} on ${a.ledMid}`)
  }
  console.log(`      ${rows.join(' · ')}`)
})


// ── B3: figures ──────────────────────────────────────────────────────────────

ok('every pose state animData can emit has a pose-library entry (and nothing extra)', () => {
  const src = readFileSync(new URL('../src/components/broadcast/animData.ts', import.meta.url), 'utf8')
  const m = /export type PoseState =([\s\S]*?)\n\n/.exec(src)
  assert.ok(m, 'PoseState union not found in animData.ts')
  const union = [...m[1].matchAll(/'([a-z0-9]+)'/gi)].map((x) => x[1])
  assert.ok(union.length >= 16, `only ${union.length} pose states parsed`)
  // States the derivation returns as literals (stateFor / preSnap).
  const returned = [...src.matchAll(/return '([a-z0-9]+)'/gi)].map((x) => x[1]).filter((x) => union.includes(x) || /^[a-z]+[0-9]?$/.test(x))
  const lib = Object.keys(POSE_LIBRARY)
  for (const st of new Set([...union, ...returned.filter((x) => union.includes(x))])) assert.ok(lib.includes(st), `no pose-library entry for '${st}'`)
  for (const st of returned) assert.ok(union.includes(st), `animData returns '${st}', which is not in PoseState`)
  for (const st of lib) assert.ok(union.includes(st), `pose library has '${st}', not a PoseState`)
  // Every entry yields finite joints over its lifetime.
  const p: PoseParams = newPose()
  for (const st of union) {
    for (const age of [0, 0.05, 0.2, 0.5, 2]) {
      poseParams(st as keyof typeof POSE_LIBRARY, age, 0.25, p)
      for (const [k, v] of Object.entries(p)) assert.ok(Number.isFinite(v), `${st} ${k} at ${age}s`)
    }
  }
  console.log(`      ${union.length} states: ${union.join(' ')}`)
})

ok('figure scale shrinks monotonically with depth on screen (skycam, sideline, reverse, angled)', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -0.4]) {
    const c = makeCamera(orbitPose({ focusX: 60, focusY: 26.65, back: 32, height: 21.5, yaw, fovDeg: 43 }), VP)
    let prevDepth = -Infinity
    let prevH = Infinity
    for (let d = 8; d <= 90; d += 2) {
      // Points straight ahead along the ground heading of the camera.
      const x = c.px + c.fhx * d
      const y = c.py + c.fhy * d
      const s = figureScreen(c, x, y)
      // Only where a figure is on screen (feet inside the frame).
      if (!s || s.y < 0 || s.y > VP.height) continue
      assert.ok(s.depth > prevDepth, 'depth increases along the view')
      assert.ok(s.h < prevH, `yaw ${yaw.toFixed(2)}: unit ${s.h.toFixed(2)} px at depth ${s.depth.toFixed(1)} not < ${prevH.toFixed(2)}`)
      prevDepth = s.depth
      prevH = s.h
    }
  }
})

ok(`all 32 kits: jersey numbers >= ${NUMBER_MIN}:1 home and away; home colour vs road white >= ${HOME_AWAY_MIN}:1`, () => {
  const rows: string[] = []
  for (const t of NFL_TEAMS) {
    const h = clubKit(t, true)
    const a = clubKit(t, false)
    const nh = contrast(h.num, h.jersey)
    const na = contrast(a.num, a.jersey)
    const sep = contrast(h.jersey, a.jersey)
    assert.ok(nh >= NUMBER_MIN, `${t.abbr} home: number ${h.num} on ${h.jersey} is ${nh.toFixed(2)}:1`)
    assert.ok(na >= NUMBER_MIN, `${t.abbr} away: number ${a.num} on ${a.jersey} is ${na.toFixed(2)}:1`)
    assert.ok(sep >= HOME_AWAY_MIN, `${t.abbr}: home ${h.jersey} vs road ${a.jersey} only ${sep.toFixed(2)}:1`)
    for (const k of [h, a]) {
      for (const v of [k.jersey, k.num, k.pants, k.sock, k.helm, k.mask, k.glove, k.trim]) assert.match(v, /^#[0-9A-F]{6}$/i)
      if (k.numStroke != null) assert.match(k.numStroke, /^#[0-9A-F]{6}$/i)
    }
    rows.push(`${t.abbr} ${nh.toFixed(1)}/${na.toFixed(1)}`)
  }
  // Every pairing: the home colour separates from the visitors' white.
  for (const home of NFL_TEAMS) for (const away of NFL_TEAMS) {
    if (home.id === away.id) continue
    assert.ok(contrast(clubKit(home, true).jersey, clubKit(away, false).jersey) >= HOME_AWAY_MIN)
  }
  console.log(`      number contrast home/away: ${rows.join(' · ')}`)
})

ok(`all 32 kits: number outlines show on the jersey (>= ${STROKE_SHOW_MIN}:1) and keep a drawn edge >= ${NUMBER_MIN}:1, or are omitted`, () => {
  let stroked = 0
  let total = 0
  const omitted: string[] = []
  for (const t of NFL_TEAMS) {
    for (const home of [true, false]) {
      const k = clubKit(t, home)
      total++
      const tag = `${t.abbr} ${home ? 'home' : 'away'}`
      if (k.numStroke == null) {
        // No outline: the fill alone carries the glyph (asserted >= NUMBER_MIN above).
        assert.ok(contrast(k.num, k.jersey) >= NUMBER_MIN, `${tag}: no outline and the fill does not read`)
        omitted.push(tag)
        continue
      }
      stroked++
      const sn = contrast(k.numStroke, k.num)
      const sj = contrast(k.numStroke, k.jersey)
      assert.ok(sj >= STROKE_SHOW_MIN, `${tag}: outline ${k.numStroke} vanishes into jersey ${k.jersey} (${sj.toFixed(2)}:1)`)
      // The edges actually drawn: fill|outline (inner) and outline|jersey (outer).
      assert.ok(Math.max(sn, sj) >= NUMBER_MIN, `${tag}: fill ${k.num} | outline ${k.numStroke} ${sn.toFixed(2)}:1, outline | jersey ${sj.toFixed(2)}:1`)
      assert.ok(strokeReads(k.numStroke, k.num, k.jersey), tag)
    }
  }
  console.log(`      ${stroked}/${total} kits outlined; no outline: ${omitted.join(', ') || 'none'}`)
})

ok('run cycle: stride grows with speed and the swing matches it (planted feet do not skate)', () => {
  let prev = 0
  for (let v = 0; v <= 12; v += 0.5) {
    const c = cycleLength(v)
    assert.ok(c >= prev, `cycleLength not monotonic at ${v}`)
    prev = c
    // Foot reach either side = 0.4·amp yd; for no slip 0.4·amp·2π / cycle ≈ 1 (capped at amp 1, faded in below 0.8 yd/s).
    const slip = (0.4 * strideAmp(v) * Math.PI * 2) / c
    if (v >= 0.8 && cycleLength(v) <= Math.PI * 2 * 0.4) assert.ok(near(slip, 1, 1e-9), `slip ratio ${slip.toFixed(3)} at ${v} yd/s`)
    assert.ok(slip <= 1 + 1e-9)
  }
  assert.ok(cycleLength(9) > cycleLength(3))
})

ok('kick pose: the leg comes back down and the run cycle returns after the follow-through', () => {
  const p = newPose()
  poseParams('kick', 0.3, 2, p)
  assert.ok(p.kk > 0.95, `follow-through kk ${p.kk}`)
  poseParams('kick', 1.0, 2, p)
  assert.ok(p.kk < 1e-9 && near(p.run, 1), `after: kk ${p.kk} run ${p.run}`)
})

// ── B3: actor layer (node, stub canvas) ─────────────────────────────────────

/** A canvas context that accepts every call (gradients etc. return itself). */
function stubCtx(): CanvasRenderingContext2D {
  const fn = (): unknown => proxy
  const proxy: unknown = new Proxy(fn, {
    get: (_t, k) => (k === 'canvas' ? { width: VP.width, height: VP.height } : fn),
    set: () => true,
    apply: () => proxy,
  })
  return proxy as CanvasRenderingContext2D
}

const SYN: BroadcastAnim = {
  duration: 4000,
  actors: [
    // 40 yd in 4 s = 10 yd/s, carrying.
    { key: 'rb', side: 'off', role: 'RB', path: [{ t: 0, x: 30, y: 20 }, { t: 1, x: 70, y: 20 }] },
    // 8 yd in 4 s = 2 yd/s.
    { key: 'lb', side: 'def', role: 'LB', path: [{ t: 0, x: 45, y: 32 }, { t: 1, x: 53, y: 32 }] },
    // Down from the start, having moved along +y (screen-lateral for a yaw-0 camera): lies sideways.
    { key: 'dl', side: 'def', role: 'DL', path: [{ t: 0, x: 40, y: 12 }, { t: 0.05, x: 40, y: 13 }, { t: 1, x: 40, y: 13 }] },
  ],
  ball: [{ t: 0, x: 30, y: 20 }, { t: 1, x: 70, y: 20 }],
  holders: [{ t: 0, key: 'rb' }],
  flights: [],
  poses: {
    // A stumble shorter than the 0.16 s blend (0.08 s), between two carries.
    rb: [
      { t0: 0, t1: 0.5, state: 'carry' },
      { t0: 0.5, t1: 0.52, state: 'stumble' },
      { t0: 0.52, t1: 1, state: 'carry' },
    ],
    lb: [
      { t0: 0, t1: 0.1, state: 'stance2' },
      { t0: 0.1, t1: 1, state: 'run' },
    ],
    dl: [{ t0: 0, t1: 1, state: 'down' }],
  },
  facing: {
    rb: [{ t0: 0, t1: 1, mode: 'move' }],
    lb: [{ t0: 0, t1: 1, mode: 'move' }],
    dl: [{ t0: 0, t1: 1, mode: 'angle', angle: Math.PI / 2 }],
  },
  ballZ: [{ t: 0, z: 1 }],
  camera: { strongSide: 'low', deep: false, focusKey: null, kind: 'scrimmage' },
}

const NFL0 = NFL_TEAMS[0]
const NFL1 = NFL_TEAMS[1]
const newLayer = () => {
  const l = new ActorLayer()
  l.setPlay({ anim: SYN, offClub: NFL0, defClub: NFL1, offHome: true })
  return l
}
const frameFor = (direction: 1 | -1, focusX: number): BroadcastFrame => ({
  camera: orbitPose({ focusX, focusY: 24, back: 30, height: 20, yaw: direction === 1 ? 0 : Math.PI, fovDeg: 43 }),
  losYard: null,
  firstDownYard: null,
  direction,
  homeTeamId: NFL0.id,
  awayTeamId: NFL1.id,
  possession: 'home',
  turfText: null,
  turfTextAlpha: 0,
  time: 0,
})

ok('actor layer: run-cycle phase advances by distance / cycleLength(speed)', () => {
  const l = newLayer()
  for (const [key, dist, v] of [
    ['rb', 4, 10],
    ['lb', 0.8, 2],
  ] as const) {
    const a = l.sampleOf(key, 0.2)!
    const b = l.sampleOf(key, 0.3)!
    assert.ok(near(a.v, v, 1e-3) && near(b.v, v, 1e-3), `${key} speed ${a.v} / ${b.v}`)
    const want = (dist / cycleLength(v)) * Math.PI * 2
    assert.ok(near(b.ph - a.ph, want, 2e-3), `${key}: phase +${(b.ph - a.ph).toFixed(4)} vs ${want.toFixed(4)}`)
  }
})

ok('actor layer: worldOf with direction −1 mirrors direction 1 (offenseToWorld)', () => {
  const l = newLayer()
  for (const key of ['rb', 'lb', 'dl']) {
    for (const t of [0, 0.37, 1]) {
      const a = l.worldOf(key, t, 1)!
      const b = l.worldOf(key, t, -1)!
      const s = l.sampleOf(key, t)!
      assert.deepEqual(a, offenseToWorld(s.x, s.y, 1))
      assert.ok(near(b.x, FIELD_LENGTH - a.x, 1e-9) && near(b.y, FIELD_WIDTH - a.y, 1e-9), `${key} @${t}`)
    }
  }
  assert.equal(l.holderAt(0.5), 'rb')
  const b1 = l.ballAt(0.5, 1)
  const b2 = l.ballAt(0.5, -1)
  assert.ok(near(b2.x, FIELD_LENGTH - b1.x, 1e-9) && near(b1.z, b2.z, 1e-9))
})

ok('actor layer: pose blends are continuous across a window shorter than the blend', () => {
  const l = newLayer()
  type Priv = { byKey: Map<string, { fig: Figure }>; poseFor(tr: unknown, t: number, f: Figure): string }
  const P = l as unknown as Priv
  const tr = P.byKey.get('rb')!
  const at = (t: number) => {
    P.poseFor(tr, t, tr.fig)
    return { ...tr.fig.pose }
  }
  for (const edge of [0.5, 0.52]) {
    const a = at(edge - 1e-5)
    const b = at(edge + 1e-5)
    for (const k of Object.keys(a) as (keyof PoseParams)[]) assert.ok(Math.abs(a[k] - b[k]) < 0.02, `jump in ${k} at t=${edge}: ${a[k].toFixed(3)} → ${b[k].toFixed(3)}`)
  }
})

ok("actor layer: hook fills every ActorScreen, paints far → near, ball just in front of its carrier", () => {
  for (const dir of [1, -1] as const) {
    const l = newLayer()
    l.trace = true
    l.t = 0.3
    const frame = frameFor(dir, dir === 1 ? 38 : FIELD_LENGTH - 38)
    const cam = makeCamera(frame.camera, VP)
    l.hook(stubCtx(), cam, frame, { dpr: 1, ...VP })
    for (const key of ['rb', 'lb', 'dl']) {
      const s = l.screenOf(key)
      assert.ok(s, `dir ${dir}: ${key} not on screen`)
      for (const v of [s.x, s.y, s.headX, s.headY, s.top, s.depth, s.scale]) assert.ok(Number.isFinite(v), `${key} ${JSON.stringify(s)}`)
      assert.ok(s.top < s.headY, `${key}: top below the head centre`)
    }
    // Upright: the head is above the feet; lying sideways: the head is off to the side.
    const rb = l.screenOf('rb')!
    assert.ok(rb.headY < rb.y - 0.6 * rb.scale && Math.abs(rb.headX - rb.x) < 0.2 * rb.scale, `dir ${dir}: upright head ${JSON.stringify(rb)}`)
    const dl = l.screenOf('dl')!
    assert.ok(Math.abs(dl.headX - dl.x) > 0.3 * dl.scale, `dir ${dir}: lying head not beside the body ${JSON.stringify(dl)}`)
    const order = l.lastOrder
    assert.ok(order.length >= 4)
    for (let i = 1; i < order.length; i++) assert.ok(order[i].depth <= order[i - 1].depth, `dir ${dir}: not far → near at ${i}`)
    const bi = order.findIndex((o) => o.kind === 'ball')
    const ci = order.findIndex((o) => o.kind === 'fig' && o.key === 'rb')
    assert.ok(bi === ci + 1, `dir ${dir}: ball at ${bi}, carrier at ${ci}`)
    assert.ok(near(order[bi].depth, order[ci].depth - 0.05, 1e-9))
    assert.equal(l.stats.drawn, 3)
  }
})

ok('depth sort: far → near, stable regardless of input order', () => {
  const base = [
    { depth: 30, order: 3 },
    { depth: 12.5, order: 1 },
    { depth: 30, order: 0 },
    { depth: 50, order: 7 },
    { depth: 12.5, order: 4 },
    { depth: 12.5, order: 2 },
    { depth: 8, order: 1000 },
  ]
  const ref = depthSort(base.map((x) => ({ ...x }))).map((x) => `${x.depth}:${x.order}`)
  assert.deepEqual(ref, ['50:7', '30:0', '30:3', '12.5:1', '12.5:2', '12.5:4', '8:1000'])
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let k = 0; k < 200; k++) {
    const sh = base.map((x) => ({ ...x }))
    for (let i = sh.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[sh[i], sh[j]] = [sh[j], sh[i]]
    }
    assert.deepEqual(depthSort(sh).map((x) => `${x.depth}:${x.order}`), ref)
  }
})

// ── B6a: graphics ────────────────────────────────────────────────────────────

const playAnimSrc = readFileSync(new URL('../src/components/playAnim.ts', import.meta.url), 'utf8')
function unionOf(name: string): string[] {
  const m = new RegExp(`export type ${name} =([^;]*?)(?:\\n\\n|\\nexport|\\ninterface)`).exec(playAnimSrc)
  assert.ok(m, `${name} union not found in playAnim.ts`)
  return [...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1])
}

ok('graphics: every B1 event kind and engagement kind maps to a graphic or an intentional ignore', () => {
  for (const [name, table] of [
    ['AnimEventKind', EVENT_GRAPHICS],
    ['EngageKind', ENGAGEMENT_GRAPHICS],
  ] as const) {
    const kinds = unionOf(name)
    assert.ok(kinds.length >= 5, `${name}: parsed only ${kinds.length}`)
    const keys = Object.keys(table)
    for (const k of kinds) assert.ok(keys.includes(k), `${name} '${k}' has no graphics mapping`)
    for (const k of keys) assert.ok(kinds.includes(k), `mapping for '${k}', which is not a ${name}`)
    for (const [k, role] of Object.entries(table) as [string, GraphicRole][]) {
      if (role.use === 'callout') assert.ok(role.callout in CALLOUT_PRIORITY, `${k}: unknown callout ${role.callout}`)
      else assert.ok(role.why.length > 8, `${k}: '${role.use}' needs a reason`)
    }
  }
  // Each callout kind is driven by something.
  const used = new Set([...Object.values(EVENT_GRAPHICS), ...Object.values(ENGAGEMENT_GRAPHICS)].flatMap((r) => (r.use === 'callout' ? [r.callout] : [])))
  for (const k of Object.keys(CALLOUT_PRIORITY)) assert.ok(used.has(k as CalloutKind), `callout ${k} is mapped from no event / engagement`)
})

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
ok('graphics: BROADCAST_TOKENS mirror the dark .broadcast tokens in index.css', () => {
  const at = css.indexOf('@variant theme-dark {')
  assert.ok(at > 0)
  const block = css.slice(at, css.indexOf('}', at))
  const v = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block)?.[1]?.toUpperCase()
  const map: [keyof typeof BROADCAST_TOKENS, string][] = [
    ['canvas', 'canvas'],
    ['surface', 'surface'],
    ['lineStrong', 'line-strong'],
    ['ink', 'ink'],
    ['ink2', 'ink-2'],
    ['muted', 'muted'],
    ['gold', 'gold'],
    ['win', 'win'],
    ['loss', 'loss'],
  ]
  for (const [k, name] of map) assert.equal(BROADCAST_TOKENS[k].toUpperCase(), v(name), `${k} vs --color-${name}`)
})

ok(`graphics: all ${NFL_TEAMS.length} club slabs carry ink >= ${SLAB_INK_MIN}:1; HUD text pairs >= 4.5:1 on the dark plate`, () => {
  const T = BROADCAST_TOKENS
  for (const t of NFL_TEAMS) {
    const sl = clubSlab(t)
    assert.ok(contrast(sl.ink, sl.fill) >= SLAB_INK_MIN, `${t.abbr}: ink ${sl.ink} on ${sl.fill} ${contrast(sl.ink, sl.fill).toFixed(2)}:1`)
    assert.ok(contrast(sl.accent, T.surface) >= 3, `${t.abbr}: accent ${sl.accent} on surface`)
    assert.ok(sl.lift === contrast(sl.fill, T.canvas) < SLAB_LIFT_BELOW)
  }
  for (const k of ['ink', 'ink2', 'muted', 'gold', 'loss'] as const) assert.ok(contrast(T[k], T.canvas) >= 4.5, `${k} on canvas`)
  assert.ok(contrast(INK_DARK, ART.turfGraphicBar) >= 4.5, 'down & distance ink on first-down yellow')
  for (const f of [T.win, T.loss, ART.turfGraphicBar]) assert.ok(contrast(bestInk(f), f) >= 4.5, `badge ink on ${f}`)
})

/** Synthetic pass: double team, throw, catch, two broken tackles, tackle (6 s). */
const GA: BroadcastAnim = {
  duration: 6000,
  actors: [
    { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 30, y: 26 }, { t: 0.2, x: 25, y: 26 }, { t: 1, x: 25, y: 26 }] },
    { key: 'ol0', side: 'off', role: 'OL', path: [{ t: 0, x: 34, y: 23 }, { t: 1, x: 33, y: 23 }] },
    { key: 'ol1', side: 'off', role: 'OL', path: [{ t: 0, x: 34, y: 25 }, { t: 1, x: 33, y: 24 }] },
    { key: 'dl0', side: 'def', role: 'DL', path: [{ t: 0, x: 36, y: 24 }, { t: 1, x: 34, y: 24 }] },
    { key: 'wr0', side: 'off', role: 'WR', path: [{ t: 0, x: 35, y: 10 }, { t: 0.45, x: 50, y: 18 }, { t: 1, x: 62, y: 24 }] },
    { key: 'cb0', side: 'def', role: 'CB', path: [{ t: 0, x: 42, y: 10 }, { t: 0.45, x: 48, y: 16 }, { t: 1, x: 61, y: 24 }] },
    { key: 's0', side: 'def', role: 'S', path: [{ t: 0, x: 55, y: 30 }, { t: 1, x: 62, y: 25 }] },
  ],
  ball: [{ t: 0, x: 35, y: 26 }, { t: 1, x: 62, y: 24 }],
  holders: [{ t: 0, key: null }, { t: 0.03, key: 'qb' }, { t: 0.3, key: null }, { t: 0.45, key: 'wr0' }],
  flights: [{ t0: 0.3, t1: 0.45, height: 3 }],
  engagements: [
    { a: 'ol0', b: 'dl0', t0: 0.05, t1: 0.5, kind: 'double' },
    { a: 'ol1', b: 'dl0', t0: 0.08, t1: 0.5, kind: 'double' },
    { a: 'cb0', b: 'wr0', t0: 0.55, t1: 0.57, kind: 'missedTackle' },
  ],
  events: [
    { t: 0.03, kind: 'snap', keys: ['ol2', 'qb'], spot: { x: 35, y: 26 } },
    { t: 0.3, kind: 'throw', keys: ['qb', 'wr0'], spot: { x: 25, y: 26 } },
    { t: 0.45, kind: 'catch', keys: ['wr0', 'cb0'], spot: { x: 50, y: 18 } },
    { t: 0.5, kind: 'firstDown', keys: ['wr0'], spot: { x: 52, y: 19 } },
    { t: 0.55, kind: 'brokenTackle', keys: ['wr0', 'cb0'], spot: { x: 54, y: 20 } },
    { t: 0.62, kind: 'brokenTackle', keys: ['wr0', 's0'], spot: { x: 56, y: 21 } },
    { t: 1, kind: 'tackle', keys: ['s0', 'wr0'], spot: { x: 62, y: 24 } },
  ],
  poses: {},
  facing: {},
  ballZ: [{ t: 0, z: 1 }],
  camera: { strongSide: 'low', deep: false, focusKey: null, kind: 'scrimmage' },
}
const GPLAY = {
  n: 41, qtr: 2, clock: '7:42', down: 3, distance: 6, startYard: 25, endYard: 52, offId: NFL0.id, defId: NFL1.id, type: 'pass',
  concept: 'PA Deep Cross', yards: 27, result: 'Complete', homeScore: 7, awayScore: 10, passDepth: 15, pressure: false,
} as unknown as Play
const GIN = () => ({
  anim: GA,
  play: GPLAY,
  offense: NFL0,
  defense: NFL1,
  people: { wr0: { name: 'Darius Holloway', number: 1, pos: 'WR' }, cb0: { name: 'Cam Reed', number: 24, pos: 'CB' }, ol0: { name: 'A B', number: 77, pos: 'LT' }, ol1: { name: 'C D', number: 64, pos: 'LG' }, dl0: { name: 'E F', number: 97, pos: 'DE' } },
})
const secsOf = (tl: GraphicsTimeline) => {
  const out: number[] = []
  for (let s = tl.start - 0.2; s <= tl.end + 0.2; s += 1 / 30) out.push(s)
  return out
}

ok('graphics: the timeline and every frame of it are deterministic', () => {
  const a = buildGraphicsTimeline(GIN())
  const b = buildGraphicsTimeline(GIN())
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
  for (const s of secsOf(a)) assert.deepEqual(graphicsAt(a, s), graphicsAt(b, s))
  // The expected beats are there.
  const kinds = a.callouts.map((c) => c.kind)
  for (const k of ['doubleTeam', 'timeToThrow', 'separation', 'brokenTackle']) assert.ok(kinds.includes(k as CalloutKind), `missing ${k}: ${kinds}`)
  const tt = a.callouts.find((c) => c.kind === 'timeToThrow')!
  assert.ok(near(tt.value!, 1.6, 1e-9), `time to throw ${tt.value}`)
  const sep = a.callouts.find((c) => c.kind === 'separation')!
  assert.ok(near(sep.value!, Math.round(Math.hypot(2, 2) * 10) / 10, 1e-9) && sep.anchor === 'wr0', `separation ${sep.value}`)
  assert.equal(a.toast.badge?.kind, 'firstDown')
  assert.equal(a.toast.big, '+27')
  assert.equal(a.lower?.key, 'wr0')
  assert.ok(a.clock && a.clock.t1 === a.snapSec)
})

ok('graphics: callouts only inside their windows, at most 2 at once, one per anchor', () => {
  const tl = buildGraphicsTimeline(GIN())
  let peak = 0
  for (const s of secsOf(tl)) {
    const g = graphicsAt(tl, s)
    peak = Math.max(peak, g.callouts.length)
    assert.ok(g.callouts.length <= MAX_CALLOUTS, `${g.callouts.length} callouts at ${s.toFixed(2)}`)
    const anchors = g.callouts.map((c) => c.item.anchor)
    assert.equal(new Set(anchors).size, anchors.length, `two callouts on one anchor at ${s.toFixed(2)}`)
    for (const c of g.callouts) assert.ok(s >= c.item.t0 && s <= c.item.t1, `${c.item.id} outside its window at ${s}`)
    assert.ok(!(g.lower && g.toast), 'lower third and toast together')
  }
  assert.equal(peak, MAX_CALLOUTS)
  // The second broken tackle cuts the first; both are on wr0 so they never overlap.
  const bts = tl.callouts.filter((c) => c.kind === 'brokenTackle')
  for (let i = 1; i < bts.length; i++) assert.ok(bts[i].t0 >= bts[i - 1].t1 - 1e-9)
  // Fuzz the resolver: random overlapping candidates.
  let seed = 11
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const kinds: CalloutKind[] = ['brokenTackle', 'separation', 'timeToThrow', 'doubleTeam']
  for (let k = 0; k < 300; k++) {
    const cands = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, i) => {
      const kind = kinds[Math.floor(rnd() * 4)]
      const t0 = rnd() * 4
      return { id: `${kind}:${i}`, kind, anchor: ['a', 'b', 'c'][Math.floor(rnd() * 3)], t0, t1: t0 + 0.4 + rnd() * 2, priority: CALLOUT_PRIORITY[kind], title: '', sub: '', accent: 'off' as const, others: [] }
    })
    const r1 = resolveCallouts(cands)
    assert.deepEqual(resolveCallouts(cands.slice().reverse()), r1, 'order-independent')
    for (const c of r1.kept) {
      assert.ok(c.t1 - c.t0 >= MIN_CALLOUT - 1e-9)
      const src = cands.find((x) => x.id === c.id)!
      assert.ok(c.t0 >= src.t0 && c.t1 <= src.t1, 'kept window inside the requested one')
    }
    assert.equal(r1.kept.length + r1.dropped.length, cands.length)
    for (let s = 0; s < 7; s += 0.05) {
      const live = r1.kept.filter((c) => c.t0 <= s && s < c.t1)
      assert.ok(live.length <= MAX_CALLOUTS)
      assert.equal(new Set(live.map((c) => c.anchor)).size, live.length)
    }
  }
})

ok('graphics: reduced motion has no wipes; sim-to-end shows the chip only; off shows nothing', () => {
  const tl = buildGraphicsTimeline(GIN())
  for (const s of secsOf(tl)) {
    const g = graphicsAt(tl, s, { reducedMotion: true })
    for (const x of [g.chip, g.lower, g.toast, ...g.callouts]) if (x) assert.equal(x.enter, 1)
    assert.ok(!g.chip || g.chip.flash === 0)
    const f = graphicsAt(tl, s, { mode: 'fast' })
    assert.ok(!f.clock && !f.lower && !f.toast && f.callouts.length === 0)
    const o = graphicsAt(tl, s, { mode: 'off' })
    assert.ok(!o.chip && !o.clock && !o.lower && !o.toast && o.callouts.length === 0)
  }
})

ok('graphics: callout boxes never cover the carrier head (or each other); fuzzed layouts', () => {
  let seed = 5
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  let placedN = 0
  for (let k = 0; k < 2000; k++) {
    const W = rnd() < 0.3 ? 750 : 2560
    const H = W === 750 ? 820 : 1440
    const carrier = { x: rnd() * W, y: rnd() * H, r: 20 + rnd() * 30 }
    const reqs = [0, 1].map((i) => ({
      id: `c${i}`,
      ax: i === 0 && rnd() < 0.5 ? carrier.x : rnd() * W,
      ay: i === 0 && rnd() < 0.5 ? carrier.y - carrier.r : rnd() * H,
      w: 180 + rnd() * 200,
      h: 60 + rnd() * 30,
    }))
    const placed = layoutCallouts(reqs, { width: W, height: H, margin: 8, lead: 30 + rnd() * 20, avoid: [carrier], reserved: [{ x: 20, y: 20, w: 400, h: 50 }] })
    placedN += placed.length
    for (const p of placed) assert.ok(!rectHitsCircle(p.box, carrier), `box ${JSON.stringify(p.box)} covers the carrier head ${JSON.stringify(carrier)}`)
    if (placed.length === 2) assert.ok(!rectsOverlap(placed[0].box, placed[1].box), 'callout boxes overlap')
  }
  assert.ok(placedN > 3000, `only ${placedN} of 4000 callouts placed`)
})

/** A canvas context that records every font it is given (and measures text by its size). */
function fontRecorder(width: number, height: number): { ctx: CanvasRenderingContext2D; sizes: number[] } {
  const sizes: number[] = []
  let font = '10px sans-serif'
  const noop = () => {}
  const target: Record<string | symbol, unknown> = {
    canvas: { width, height },
    measureText: (s: string) => ({ width: s.length * (Number(/([\d.]+)px/.exec(font)?.[1]) || 10) * 0.5 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  }
  const ctx = new Proxy(target, {
    get: (t, k) => (k === 'font' ? font : k in t ? t[k] : noop),
    set: (t, k, v) => {
      if (k === 'font') {
        font = String(v)
        const px = Number(/([\d.]+)px/.exec(font)?.[1])
        assert.ok(Number.isFinite(px), `unparsed font ${font}`)
        sizes.push(px)
      } else t[k] = v
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, sizes }
}

ok(`graphics: every drawn text is >= ${MIN_TEXT_PX} CSS px at DPR 1 and 2 (phone, 16:9, full window)`, () => {
  const tl = buildGraphicsTimeline(GIN())
  // Actors spread over the screen; the carrier is wr0 from the catch on.
  const source = (W: number, H: number) => ({
    screenOf: (key: string): ActorScreen | undefined => {
      const i = GA.actors.findIndex((a) => a.key === key)
      if (i < 0) return undefined
      const x = W * (0.25 + 0.08 * i)
      const y = H * (0.45 + 0.04 * (i % 3))
      return { key, side: 'off', role: 'X', x, y, headX: x, headY: y - 30, top: y - 36, depth: 30, scale: 60, pose: 'run', holder: key === 'wr0' }
    },
    holderAt: (t: number) => (t >= 0.45 ? 'wr0' : t >= 0.03 && t < 0.3 ? 'qb' : null),
  })
  let drawn = 0
  for (const dpr of [1, 2]) {
    for (const [cw, ch] of [
      [375, 410],
      [1280, 720],
      [1920, 1080],
    ]) {
      const W = cw * dpr
      const H = ch * dpr
      const { ctx, sizes } = fontRecorder(W, H)
      const gfx = new GraphicsLayer(source(W, H))
      gfx.setTimeline(tl)
      for (const s of secsOf(tl)) {
        gfx.sec = s
        gfx.draw(ctx, { dpr, width: W, height: H })
        drawn += gfx.lastPlaced.length
      }
      assert.ok(sizes.length > 100, `${cw}x${ch}@${dpr}: only ${sizes.length} fonts set`)
      const min = Math.min(...sizes) / dpr
      assert.ok(min >= MIN_TEXT_PX - 1e-9, `${cw}x${ch}@${dpr}: smallest text ${min.toFixed(2)} CSS px`)
    }
  }
  assert.ok(drawn > 0, 'no callout was ever placed')
})

// ── B4: ball + effects ───────────────────────────────────────────────────────

/** A minimal anim carrying one B1 event of `kind`, for the mapping checks. */
function fxAnim(kind: AnimEventKind): BroadcastAnim {
  const spot = kind === 'score' ? { x: 110, y: 0.5 } : { x: 50, y: 26 }
  return {
    duration: 3000,
    actors: [
      { key: 'rb', side: 'off', role: 'RB', path: [{ t: 0, x: 40, y: 26 }, { t: 1, x: 60, y: 26 }] },
      { key: 'lb', side: 'def', role: 'LB', path: [{ t: 0, x: 45, y: 28 }, { t: 1, x: 55, y: 27 }] },
    ],
    ball: [{ t: 0, x: 40, y: 26 }, { t: 1, x: 60, y: 26 }],
    holders: [{ t: 0, key: 'rb' }],
    flights: [],
    events: [{ t: 0.5, kind, keys: ['rb', 'lb'], spot }],
    poses: {},
    facing: {},
    ballZ: [{ t: 0, z: 1 }],
    camera: { strongSide: 'low', deep: false, focusKey: null, kind: 'scrimmage' },
  }
}

ok('B4: every B1 event kind maps to an effect or an explicit ignore (and the map emits exactly that)', () => {
  const kinds = unionOf('AnimEventKind')
  assert.ok(kinds.length >= 20, `parsed only ${kinds.length} event kinds`)
  const keys = Object.keys(EVENT_FX)
  for (const k of kinds) assert.ok(keys.includes(k), `AnimEventKind '${k}' has no B4 mapping`)
  for (const k of keys) assert.ok(kinds.includes(k), `B4 maps '${k}', which is not an AnimEventKind`)
  let fxKinds = 0
  let ignores = 0
  for (const k of kinds) {
    const rule = EVENT_FX[k as AnimEventKind]
    const anim = fxAnim(k as AnimEventKind)
    const sch = buildFxSchedule(anim, { reducedMotion: false, quality: 'full' })
    const fromEv = sch.filter((it) => it.sourceEvent === 0)
    if (rule.use === 'fx') {
      fxKinds++
      assert.ok(rule.kinds.length > 0 && rule.note.length > 8, `${k}: an fx rule needs kinds and a note`)
      for (const want of rule.kinds) assert.ok(fromEv.some((it) => it.kind === want), `${k}: no '${want}' emitted (got ${fromEv.map((i) => i.kind).join(',') || 'none'})`)
    } else {
      ignores++
      assert.ok(rule.why.length > 8, `${k}: an ignore needs a reason`)
      assert.equal(fromEv.length, 0, `${k}: ignored but emitted ${fromEv.map((i) => i.kind).join(',')}`)
    }
    // No orphan effects: every item's t0 is exactly its source event's time.
    for (const it of sch) {
      const src = anim.events![it.sourceEvent]
      assert.ok(src, `${k}: item sourceEvent ${it.sourceEvent} out of range`)
      assert.ok(Math.abs(it.t0 - src.t) < 1e-9, `${k}: ${it.kind} t0 ${it.t0} vs event ${src.t} (orphan)`)
    }
  }
  console.log(`      ${fxKinds} event kinds drive effects, ${ignores} are explicit ignores`)
})

ok('B4: the effect schedule is deterministic per play', () => {
  for (const k of unionOf('AnimEventKind') as AnimEventKind[]) {
    const anim = fxAnim(k)
    const a = JSON.stringify(buildFxSchedule(anim, { reducedMotion: false, quality: 'full' }))
    const b = JSON.stringify(buildFxSchedule(anim, { reducedMotion: false, quality: 'full' }))
    assert.equal(a, b, `${k}: schedule differs between builds`)
  }
})

ok('B4: the ball stays on or above the turf and is continuous through a flight', () => {
  // A pass: snap lob, throw, a single-peaked flight, a catch.
  const anim: BroadcastAnim = {
    duration: 4000,
    actors: [
      { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 30, y: 26 }, { t: 0.4, x: 25, y: 26 }, { t: 1, x: 25, y: 26 }] },
      { key: 'wr', side: 'off', role: 'WR', path: [{ t: 0, x: 35, y: 24 }, { t: 0.75, x: 60, y: 20 }, { t: 1, x: 62, y: 20 }] },
    ],
    ball: [{ t: 0, x: 30, y: 26 }, { t: 0.15, x: 25, y: 26 }, { t: 0.4, x: 25, y: 26 }, { t: 0.75, x: 60, y: 20 }, { t: 1, x: 62, y: 20 }],
    holders: [{ t: 0, key: null }, { t: 0.15, key: 'qb' }, { t: 0.4, key: null }, { t: 0.75, key: 'wr' }],
    flights: [{ t0: 0.4, t1: 0.75, height: 3 }],
    events: [
      { t: 0.4, kind: 'throw', keys: ['qb', 'wr'], spot: { x: 25, y: 26 } },
      { t: 0.75, kind: 'catch', keys: ['wr'], spot: { x: 60, y: 20 } },
    ],
    poses: {},
    facing: {},
    ballZ: [{ t: 0, z: 0.15 }, { t: 0.15, z: 1.1 }, { t: 0.4, z: 2 }, { t: 0.58, z: 5 }, { t: 0.75, z: 1.4 }, { t: 1, z: 1.1 }],
    camera: { strongSide: 'low', deep: true, focusKey: 'wr', kind: 'scrimmage' },
  }
  const N = 240
  let minZ = Infinity
  const inFlight: number[] = []
  for (let k = 0; k <= N; k++) {
    const t = k / N
    const s = ballState(anim, t, {})
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z), `t ${t}: NaN`)
    minZ = Math.min(minZ, s.z)
    if (t >= 0.4 && t <= 0.75) inFlight.push(s.z)
  }
  assert.ok(minZ >= 0, `ball went below the turf: ${minZ}`)
  // Continuous: no jump between consecutive 1/120 s samples inside the flight.
  let worst = 0
  for (let i = 1; i < inFlight.length; i++) worst = Math.max(worst, Math.abs(inFlight[i] - inFlight[i - 1]))
  assert.ok(worst <= 0.2, `flight z jumps by ${worst.toFixed(3)} yd in one step`)
  // Single-peaked.
  let peaks = 0
  for (let i = 1; i < inFlight.length - 1; i++) if (inFlight[i] >= inFlight[i - 1] && inFlight[i] > inFlight[i + 1]) peaks++
  assert.equal(peaks, 1, `flight has ${peaks} peaks`)
})

ok(`B4: shake is bounded (<= ${(SHAKE_YARDS * 1.2).toFixed(3)} yd) and exactly zero under reduced motion`, () => {
  const anim = fxAnim('fumble') // a strip: the largest shake amplitude
  const sch = buildFxSchedule(anim, { reducedMotion: false, quality: 'full' })
  const shakes = sch.filter((it) => it.kind === 'shake')
  assert.equal(shakes.length, 1, 'expected exactly one shake on a strip')
  const it = shakes[0]
  let peak = 0
  for (let i = 0; i <= 400; i++) {
    const t = it.t0 + ((it.t1 - it.t0) * i) / 400
    const o = shakeAt(sch, t)
    peak = Math.max(peak, Math.hypot(o.x, o.y, o.z))
  }
  assert.ok(peak <= SHAKE_YARDS * 1.2 + 1e-9, `peak shake ${peak.toFixed(4)} yd exceeds the bound`)
  assert.ok(peak > 0, 'shake never moved')
  // Exactly 0 after the window (and before it).
  assert.deepEqual(shakeAt(sch, it.t1 + 1e-6), { x: 0, y: 0, z: 0 })
  assert.deepEqual(shakeAt(sch, it.t0 - 1e-6), { x: 0, y: 0, z: 0 })
  // Reduced motion: no shake at all, and the offset is 0 at every sample.
  const rm = buildFxSchedule(anim, { reducedMotion: true, quality: 'full' })
  assert.equal(rm.filter((x) => x.kind === 'shake').length, 0, 'reduced motion still scheduled a shake')
  for (let i = 0; i <= 20; i++) assert.deepEqual(shakeAt(rm, i / 20), { x: 0, y: 0, z: 0 })
})

ok("B4: the composer drives B3's layer (placeholder off, ball + effects in the depth sort) and never shakes under reduced motion", () => {
  const anim = fxAnim('catch')
  const l = new ActorLayer()
  l.setPlay({ anim, offClub: NFL0, defClub: NFL1, offHome: true })
  const fx = createBallFx({ anim, offenseClub: NFL0, defenseClub: NFL1, reducedMotion: false, quality: 'full' })
  const hook = withBallFx(l, fx, () => l.t)
  assert.equal(l.drawBall, false, "B3's placeholder ball was not turned off")
  assert.equal(typeof l.ground, 'function', 'the turf-level ground hook was not attached')
  assert.equal(typeof l.addItems, 'function', 'the depth-sorted items hook was not attached')
  const frame = frameFor(1, 45)
  l.t = 0.5
  l.trace = true
  hook(stubCtx(), makeCamera(frame.camera, VP), frame, { dpr: 1, ...VP })
  const kinds = l.lastOrder.map((o) => o.kind)
  assert.ok(kinds.includes('extra'), 'the B4 ball was not inserted into the depth sort')
  assert.ok(!kinds.includes('ball'), "B3's placeholder ball is still drawn")
  // No shake scheduled: the pose is returned unchanged (identity).
  assert.deepEqual(fx.shakePose(frame.camera, 0.5), frame.camera)
  // Reduced motion never shakes.
  const rm = createBallFx({ anim, offenseClub: NFL0, defenseClub: NFL1, reducedMotion: true, quality: 'full' })
  assert.deepEqual(rm.shakePose(frame.camera, 0.5), frame.camera)
})

ok('animflow r6a: a ring is drawn round the ball holder, never while the ball is in the air', () => {
  const anim: BroadcastAnim = {
    ...fxAnim('catch'),
    actors: [
      { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 40, y: 26 }, { t: 1, x: 39, y: 26 }] },
      { key: 'wr0', side: 'off', role: 'WR', path: [{ t: 0, x: 42, y: 20 }, { t: 0.5, x: 52, y: 22 }, { t: 1, x: 58, y: 22 }] },
      { key: 'lb', side: 'def', role: 'LB', path: [{ t: 0, x: 46, y: 27 }, { t: 1, x: 55, y: 24 }] },
    ],
    ball: [{ t: 0, x: 40, y: 26 }, { t: 0.3, x: 40, y: 26 }, { t: 0.5, x: 52, y: 22 }, { t: 1, x: 58, y: 22 }],
    holders: [{ t: 0, key: 'qb' }, { t: 0.3, key: null }, { t: 0.5, key: 'wr0' }],
    flights: [{ t0: 0.3, t1: 0.5, height: 3 }],
  }
  const l = new ActorLayer()
  l.setPlay({ anim, offClub: NFL0, defClub: NFL1, offHome: true })
  const fl = anim.flights[0]
  assert.ok(fl, 'synthetic catch has a flight')
  const at = (t: number, x: number) => {
    const frame = frameFor(1, x)
    l.t = t
    l.hook(stubCtx(), makeCamera(frame.camera, VP), frame, { dpr: 1, ...VP })
    return l.lastRing
  }
  const ballX = (t: number) => r6PosAt(anim.ball, t).x
  const pre = Math.max(0.01, fl.t0 - 0.05)
  const holdPre = r6HolderAt(anim.holders, pre)
  assert.ok(holdPre, 'someone holds the ball before the throw')
  assert.equal(at(pre, ballX(pre)), holdPre, 'the ring is on the passer before the throw')
  const mid = (fl.t0 + fl.t1) / 2
  assert.equal(at(mid, ballX(mid)), null, 'no ring while the ball is in the air')
  const post = Math.min(0.99, fl.t1 + 0.05)
  const holdPost = r6HolderAt(anim.holders, post)
  if (holdPost) assert.equal(at(post, ballX(post)), holdPost, 'the ring follows the catch')
  l.holderRing = false
  assert.equal(at(pre, ballX(pre)), null, 'ring can be switched off')
})

// ── B6b: telestrator replay ──────────────────────────────────────────────────

/** Synthetic 3rd-down sack: double team on dl0, OL ring, dl1 gets home (5 s). */
const SA: BroadcastAnim = {
  duration: 5000,
  actors: [
    { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 34, y: 26.6 }, { t: 0.3, x: 28, y: 26.6 }, { t: 1, x: 27, y: 27 }] },
    ...[-2.6, -1.3, 0, 1.3, 2.6].map((d, i) => ({ key: `ol${i}`, side: 'off' as const, role: 'OL', path: [{ t: 0, x: 34.4, y: 26.65 + d }, { t: 1, x: 32, y: 26.65 + d * 1.2 }] })),
    { key: 'dl0', side: 'def', role: 'DL', path: [{ t: 0, x: 36, y: 26 }, { t: 1, x: 33, y: 26 }] },
    { key: 'dl1', side: 'def', role: 'DL', path: [{ t: 0, x: 36, y: 31 }, { t: 0.6, x: 30, y: 30 }, { t: 0.75, x: 27.6, y: 27.4 }, { t: 1, x: 27.2, y: 27.2 }] },
    { key: 'wr0', side: 'off', role: 'WR', path: [{ t: 0, x: 35, y: 8 }, { t: 1, x: 50, y: 10 }] },
  ],
  ball: [{ t: 0, x: 35, y: 26.6 }, { t: 0.3, x: 28, y: 26.6 }, { t: 1, x: 27, y: 27 }],
  holders: [{ t: 0, key: null }, { t: 0.04, key: 'qb' }],
  flights: [],
  engagements: [
    { a: 'ol1', b: 'dl0', t0: 0.06, t1: 0.6, kind: 'double' },
    { a: 'ol2', b: 'dl0', t0: 0.08, t1: 0.55, kind: 'double' },
  ],
  events: [
    { t: 0.04, kind: 'snap', keys: ['ol2', 'qb'], spot: { x: 35, y: 26.6 } },
    { t: 0.75, kind: 'sack', keys: ['dl1', 'qb'], spot: { x: 27.6, y: 27.4 } },
  ],
  poses: {},
  facing: {},
  ballZ: [{ t: 0, z: 1 }],
  camera: { strongSide: 'low', deep: false, focusKey: null, kind: 'scrimmage' },
}
const SPLAY = { ...GPLAY, type: 'pass', down: 3, distance: 6, yards: -7, result: 'Sack', concept: 'Dropback', endYard: 18 } as unknown as Play

/** Synthetic 45-yd run: handoff, a broken tackle, three pursuers into the tackle (7 s). */
const RA: BroadcastAnim = {
  duration: 7000,
  actors: [
    { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 30, y: 26 }, { t: 0.1, x: 28, y: 26 }, { t: 1, x: 28, y: 26 }] },
    { key: 'rb', side: 'off', role: 'RB', path: [{ t: 0, x: 25, y: 26 }, { t: 0.1, x: 28, y: 25 }, { t: 0.3, x: 36, y: 20 }, { t: 1, x: 75, y: 14 }] },
    { key: 'lb0', side: 'def', role: 'LB', path: [{ t: 0, x: 36, y: 26 }, { t: 0.5, x: 50, y: 20 }, { t: 1, x: 73, y: 15 }] },
    { key: 's0', side: 'def', role: 'S', path: [{ t: 0, x: 50, y: 30 }, { t: 1, x: 75.6, y: 15 }] },
    { key: 'cb0', side: 'def', role: 'CB', path: [{ t: 0, x: 45, y: 8 }, { t: 1, x: 74, y: 12 }] },
    { key: 'dl0', side: 'def', role: 'DL', path: [{ t: 0, x: 31, y: 26 }, { t: 1, x: 31, y: 26 }] },
  ],
  ball: [{ t: 0, x: 30, y: 26 }, { t: 0.1, x: 28, y: 25 }, { t: 0.3, x: 36, y: 20 }, { t: 1, x: 75, y: 14 }],
  holders: [{ t: 0, key: null }, { t: 0.03, key: 'qb' }, { t: 0.1, key: 'rb' }],
  flights: [],
  engagements: [{ a: 'lb0', b: 'rb', t0: 0.4, t1: 0.42, kind: 'missedTackle' }],
  events: [
    { t: 0.03, kind: 'snap', keys: ['qb'], spot: { x: 30, y: 26 } },
    { t: 0.4, kind: 'brokenTackle', keys: ['rb', 'lb0'], spot: { x: 45, y: 19 } },
    { t: 0.98, kind: 'tackle', keys: ['s0', 'rb'], spot: { x: 75, y: 14 } },
  ],
  poses: {},
  facing: {},
  ballZ: [{ t: 0, z: 1 }],
  camera: { strongSide: 'low', deep: false, focusKey: null, kind: 'scrimmage' },
}
const RPLAY = { ...GPLAY, type: 'run', down: 1, distance: 10, yards: 45, result: 'Run', concept: 'Inside Zone', endYard: 70 } as unknown as Play

const REPLAY_FIXTURES: [string, BroadcastAnim, Play][] = [
  ['pass', GA, GPLAY],
  ['sack', SA, SPLAY],
  ['run', RA, RPLAY],
]
const replaySecs = (p: ReplayPlan) => {
  const out: number[] = []
  for (let s = 0; s <= p.times.end + 0.2; s += 1 / 30) out.push(s)
  return out
}

ok('B6b: replayPlan is deterministic (plan, every frame, every telestration state)', () => {
  for (const [name, anim, play] of REPLAY_FIXTURES) {
    const a = replayPlan(play, anim, { setting: 'all' })
    const b = replayPlan(play, anim, { setting: 'all' })
    assert.ok(a.replay, `${name}: not replayed under 'all'`)
    assert.deepEqual(a, b, `${name}: plan differs`)
    for (const s of replaySecs(a)) {
      assert.deepEqual(replayAt(a, s), replayAt(b, s))
      for (let i = 0; i < a.tele.length; i++) assert.deepEqual(teleState(a.tele[i], s), teleState(b.tele[i], s))
    }
    const rm = replayPlan(play, anim, { setting: 'all', reducedMotion: true })
    assert.equal(rm.wipeSec, 0, `${name}: reduced motion still wipes`)
    assert.equal(rm.times.cut, 0)
    for (const it of rm.tele) assert.equal(it.drawOn, 0, `${name}: reduced motion draw-on on ${it.id}`)
  }
  // The expected elements per play.
  const kinds = (p: ReplayPlan) => p.tele.map((x) => x.kind).sort().join(',')
  const pass = replayPlan(GPLAY, GA, { setting: 'all' })
  for (const k of ['route', 'airYards', 'separation', 'doubleTeam', 'pocket', 'yac']) assert.ok(kinds(pass).includes(k), `pass lacks ${k}: ${kinds(pass)}`)
  assert.equal(pass.key?.kind, 'catch')
  assert.equal(pass.tele.find((x) => x.kind === 'airYards')?.label, '15 AIR YDS')
  const sep = pass.tele.find((x) => x.kind === 'separation')!
  assert.deepEqual(sep.keys, ['wr0', 'cb0'])
  const sack = replayPlan(SPLAY, SA, { setting: 'big' })
  assert.ok(sack.replay && sack.reasons.includes('lateDownSack'), `sack reasons ${sack.reasons}`)
  assert.equal(sack.key?.kind, 'sack')
  for (const k of ['pocket', 'doubleTeam', 'pursuit']) assert.ok(kinds(sack).includes(k), `sack lacks ${k}: ${kinds(sack)}`)
  const run = replayPlan(RPLAY, RA, { setting: 'big' })
  assert.ok(run.replay && run.reasons.includes('bigGain'))
  assert.equal(run.key?.kind, 'brokenTackle')
  assert.ok(run.tele.filter((x) => x.kind === 'pursuit').length >= 2, `run pursuit: ${kinds(run)}`)
  assert.ok(!run.tele.some((x) => x.keys.includes('dl0')), 'a defender who never chased got a pursuit arrow')
})

ok('B6b: the big-play rule table (big / all / off / force / fast)', () => {
  const base = GPLAY as unknown as Record<string, unknown>
  const P = (o: Record<string, unknown>) => ({ ...base, ...o }) as unknown as Play
  const ev = (kinds: AnimEventKind[]) => kinds.map((kind, i) => ({ t: 0.1 + i * 0.1, kind, keys: ['wr0'], spot: { x: 50, y: 20 } }))
  const A = (kinds: AnimEventKind[]): BroadcastAnim => ({ ...GA, events: [{ t: 0.03, kind: 'snap', keys: ['qb'], spot: { x: 35, y: 26 } }, ...ev(kinds)] })
  const table: [string, Play, BroadcastAnim, string[]][] = [
    ['short completion', P({ yards: 8, endYard: 33 }), A(['throw', 'catch', 'tackle']), []],
    [`${BIG_GAIN_YDS}-yd completion`, P({ yards: BIG_GAIN_YDS, endYard: 45 }), A(['throw', 'catch', 'tackle']), ['bigGain']],
    ['19-yd run', P({ type: 'run', yards: 19, endYard: 44, result: 'Run' }), A(['tackle']), []],
    ['passing TD', P({ yards: 75, endYard: 100 }), A(['throw', 'catch', 'score']), ['touchdown', 'bigGain']],
    ['1-yd TD run', P({ type: 'run', yards: 1, startYard: 99, endYard: 100, result: 'Run' }), A(['score']), ['touchdown']],
    ['interception', P({ yards: 0, result: 'Interception', turnover: true }), A(['throw', 'interception', 'tackle']), ['turnover']],
    ['lost fumble', P({ type: 'run', yards: 3, result: 'Fumble', turnover: true }), A(['fumble', 'turnover']), ['turnover']],
    ['sack on 3rd', P({ result: 'Sack', yards: -6, down: 3 }), A(['sack']), ['lateDownSack']],
    ['sack on 4th', P({ result: 'Sack', yards: -6, down: 4 }), A(['sack']), ['lateDownSack']],
    ['sack on 2nd', P({ result: 'Sack', yards: -6, down: 2 }), A(['sack']), []],
    ['safety', P({ result: 'Sack', yards: -6, down: 2, safety: true }), A(['sack', 'safety']), ['safety']],
    [`${LONG_FG_YDS}-yd FG good`, P({ type: 'fg', result: `${LONG_FG_YDS}-yd FG is good`, yards: 0 }), A(['kick', 'kickGood']), ['longFieldGoal']],
    ['49-yd FG good', P({ type: 'fg', result: '49-yd FG is good', yards: 0 }), A(['kick', 'kickGood']), []],
    ['55-yd FG no good', P({ type: 'fg', result: '55-yd FG is no good', yards: 0, turnover: true }), A(['kick', 'kickMiss']), []],
    ['punt (possession change is not a turnover)', P({ type: 'punt', result: 'Punt', yards: 44, turnover: true }), A(['kick', 'tackle']), []],
    ['punt return TD', P({ type: 'punt', result: 'Punt', yards: 44, returnTD: true, turnover: true }), A(['kick', 'score']), ['touchdown']],
    ['muffed punt', P({ type: 'punt', result: 'Punt', returnKind: 'muff', turnover: true }), A(['kick', 'fumble', 'turnover']), ['turnover']],
    ['PAT', P({ type: 'pat', result: 'PAT good' }), A(['kick', 'kickGood']), []],
  ]
  for (const [name, play, anim, want] of table) {
    const got = replayReasons(play, anim)
    assert.deepEqual([...got].sort(), [...want].sort(), `${name}: reasons ${got}`)
    const big = replayPlan(play, anim, { setting: 'big' })
    assert.equal(big.replay, want.length > 0, `${name}: big replay ${big.replay}`)
    assert.equal(replayPlan(play, anim, { setting: 'off' }).replay, false, `${name}: replayed with replays off`)
    assert.equal(replayPlan(play, anim, { setting: 'all', playback: 'fast' }).replay, false, `${name}: replayed in sim-to-end`)
    assert.equal(replayPlan(play, anim, { force: true, playback: 'fast' }).replay, false, `${name}: forced replay in sim-to-end`)
    const all = replayPlan(play, anim, { setting: 'all' })
    assert.equal(all.replay, play.type !== 'pat', `${name}: 'all' replay ${all.replay}`)
    assert.equal(replayPlan(play, anim, { setting: 'off', force: true }).replay, play.type !== 'pat', `${name}: forced replay`)
  }
  // Kneels, spikes, pre-snap fouls, the end-of-quarter marker are never replayed.
  assert.equal(replayPlan(P({ type: 'run', concept: 'Kneel', yards: -1 }), A(['down']), { force: true }).replay, false)
  assert.equal(replayPlan(P({ type: 'penalty' }), A([]), { setting: 'all' }).replay, false)
  assert.equal(replayPlan(P({ yards: 30 }), { ...GA, events: [{ t: 0.1, kind: 'flag', keys: [], spot: { x: 1, y: 1 } }] }, { setting: 'all' }).replay, false)
})

ok("B6b: custom replay filtering per reason; the default set == 'big'; big/all/off unchanged", () => {
  const base = GPLAY as unknown as Record<string, unknown>
  const P = (o: Record<string, unknown>) => ({ ...base, ...o }) as unknown as Play
  const ev = (kinds: AnimEventKind[]) => kinds.map((kind, i) => ({ t: 0.1 + i * 0.1, kind, keys: ['wr0'], spot: { x: 50, y: 20 } }))
  const A = (kinds: AnimEventKind[]): BroadcastAnim => ({ ...GA, events: [{ t: 0.03, kind: 'snap', keys: ['qb'], spot: { x: 35, y: 26 } }, ...ev(kinds)] })
  // The default custom set is exactly the six reasons, i.e. the same as 'big'.
  assert.equal(REPLAY_REASON_IDS.length, 6)
  assert.equal(new Set(REPLAY_REASON_IDS).size, 6)
  assert.deepEqual([...DEFAULT_REPLAY_TYPES], [...REPLAY_REASON_IDS])
  // The pure filter keeps the chosen ids (order-preserving); unknown ids and an
  // empty set keep none. 'all' / 'forced' are not choosable reasons.
  assert.deepEqual(customReplayReasons(['touchdown', 'bigGain', 'safety'], []), [])
  assert.deepEqual(customReplayReasons(['touchdown', 'bigGain', 'safety'], ['bigGain']), ['bigGain'])
  assert.deepEqual(customReplayReasons(['touchdown', 'all', 'forced'], ['touchdown']), ['touchdown'])
  assert.deepEqual(customReplayReasons(['touchdown'], ['bogus' as ReplayReasonId]), [])
  assert.deepEqual(customReplayReasons(['touchdown']), ['touchdown'])
  const table: [string, Play, BroadcastAnim, ReplayReasonId[]][] = [
    ['short completion', P({ yards: 8, endYard: 33 }), A(['throw', 'catch', 'tackle']), []],
    [`${BIG_GAIN_YDS}-yd completion`, P({ yards: BIG_GAIN_YDS, endYard: 45 }), A(['throw', 'catch', 'tackle']), ['bigGain']],
    ['19-yd run', P({ type: 'run', yards: 19, endYard: 44, result: 'Run' }), A(['tackle']), []],
    ['passing TD', P({ yards: 75, endYard: 100 }), A(['throw', 'catch', 'score']), ['touchdown', 'bigGain']],
    ['1-yd TD run', P({ type: 'run', yards: 1, startYard: 99, endYard: 100, result: 'Run' }), A(['score']), ['touchdown']],
    ['interception', P({ yards: 0, result: 'Interception', turnover: true }), A(['throw', 'interception', 'tackle']), ['turnover']],
    ['lost fumble', P({ type: 'run', yards: 3, result: 'Fumble', turnover: true }), A(['fumble', 'turnover']), ['turnover']],
    ['sack on 3rd', P({ result: 'Sack', yards: -6, down: 3 }), A(['sack']), ['lateDownSack']],
    ['sack on 4th', P({ result: 'Sack', yards: -6, down: 4 }), A(['sack']), ['lateDownSack']],
    ['sack on 2nd', P({ result: 'Sack', yards: -6, down: 2 }), A(['sack']), []],
    ['safety', P({ result: 'Sack', yards: -6, down: 2, safety: true }), A(['sack', 'safety']), ['safety']],
    [`${LONG_FG_YDS}-yd FG good`, P({ type: 'fg', result: `${LONG_FG_YDS}-yd FG is good`, yards: 0 }), A(['kick', 'kickGood']), ['longFieldGoal']],
    ['49-yd FG good', P({ type: 'fg', result: '49-yd FG is good', yards: 0 }), A(['kick', 'kickGood']), []],
    ['muffed punt', P({ type: 'punt', result: 'Punt', returnKind: 'muff', turnover: true }), A(['kick', 'fumble', 'turnover']), ['turnover']],
    ['PAT', P({ type: 'pat', result: 'PAT good' }), A(['kick', 'kickGood']), []],
  ]
  for (const [name, play, anim, want] of table) {
    const big = replayPlan(play, anim, { setting: 'big' })
    // big / all / off are unchanged by the new mode.
    assert.equal(big.replay, want.length > 0, `${name}: big replay`)
    assert.deepEqual([...big.reasons].sort(), [...want].sort(), `${name}: big reasons`)
    assert.equal(replayPlan(play, anim, { setting: 'off' }).replay, false, `${name}: replayed with replays off`)
    assert.equal(replayPlan(play, anim, { setting: 'all' }).replay, play.type !== 'pat', `${name}: 'all' replay`)
    // Custom with no types (the default), or all six, is byte-identical to big.
    assert.deepEqual(replayPlan(play, anim, { setting: 'custom' }), big, `${name}: custom default != big`)
    assert.deepEqual(replayPlan(play, anim, { setting: 'custom', types: DEFAULT_REPLAY_TYPES }), big, `${name}: custom all-types != big`)
    // Per reason: custom replays iff that reason is one of the play's reasons.
    for (const r of REPLAY_REASON_IDS) {
      const p = replayPlan(play, anim, { setting: 'custom', types: [r] })
      assert.equal(p.replay, want.includes(r), `${name}: custom[${r}] replay ${p.replay}`)
      if (p.replay) assert.deepEqual(p.reasons, [r], `${name}: custom[${r}] reasons ${p.reasons}`)
    }
    // A subset keeps only the intersection (the passing TD: touchdown + bigGain).
    const inter = want.filter((r) => r === 'touchdown' || r === 'safety').sort()
    const sub = replayPlan(play, anim, { setting: 'custom', types: ['touchdown', 'safety'] })
    assert.equal(sub.replay, inter.length > 0, `${name}: custom subset replay`)
    if (sub.replay) assert.deepEqual([...sub.reasons].sort(), inter, `${name}: custom subset reasons`)
    // An empty set replays nothing at all.
    assert.equal(replayPlan(play, anim, { setting: 'custom', types: [] }).replay, false, `${name}: empty custom set replayed`)
  }
  // gameDayReplay passes the chosen types through (falsy types = the default set).
  const td = P({ yards: 75, endYard: 100 })
  const tdA = A(['throw', 'catch', 'score'])
  const live = { setting: 'custom' as const, playing: true }
  assert.deepEqual(gameDayReplay(td, tdA, live).plan, replayPlan(td, tdA, { setting: 'custom' }))
  assert.equal(gameDayReplay(td, tdA, live).plan.replay, true)
  assert.deepEqual(gameDayReplay(td, tdA, { ...live, types: ['touchdown'] }).plan, replayPlan(td, tdA, { setting: 'custom', types: ['touchdown'] }))
  assert.equal(gameDayReplay(td, tdA, { ...live, types: ['safety'] }).plan.replay, false)
})

ok('B6b: telestrations only reference actors that exist (fixtures + 400 fuzzed plays)', () => {
  const checkPlan = (name: string, anim: BroadcastAnim, p: ReplayPlan) => {
    const keys = new Set(anim.actors.map((a) => a.key))
    const ids = new Set<string>()
    for (const it of p.tele) {
      assert.ok(!ids.has(it.id), `${name}: duplicate element ${it.id}`)
      ids.add(it.id)
      for (const k of it.keys) assert.ok(keys.has(k), `${name}: ${it.id} references missing actor ${k}`)
      if (!it.ball) assert.ok(it.keys.length > 0, `${name}: ${it.id} references no actor`)
      assert.ok(it.t0 <= it.t1 && it.t0 >= 0 && it.t1 <= 1, `${name}: ${it.id} window ${it.t0}..${it.t1}`)
      assert.ok(it.showSec >= 0 && it.showSec < it.hideSec && it.hideSec <= p.times.end, `${name}: ${it.id} shows ${it.showSec}..${it.hideSec}`)
    }
  }
  for (const [name, anim, play] of REPLAY_FIXTURES) checkPlan(name, anim, replayPlan(play, anim, { setting: 'all' }))
  // Fuzz: events naming keys that are not on the field must never leak into a telestration.
  let seed = 23
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pool = ['qb', 'wr0', 'cb0', 's0', 'dl0', 'ol0', 'ol1', 'ghost', 'rb', 'lb9']
  const kinds: AnimEventKind[] = ['throw', 'catch', 'brokenTackle', 'tackle', 'sack', 'interception', 'score', 'kick']
  let drawn = 0
  for (let k = 0; k < 400; k++) {
    const base = [GA, SA, RA][k % 3]
    const play = [GPLAY, SPLAY, RPLAY][k % 3]
    const events = [{ t: 0.03, kind: 'snap' as AnimEventKind, keys: ['qb'], spot: { x: 30, y: 26 } }]
    for (let i = 0; i < 2 + Math.floor(rnd() * 4); i++) events.push({ t: 0.05 + rnd() * 0.9, kind: kinds[Math.floor(rnd() * kinds.length)], keys: [pool[Math.floor(rnd() * pool.length)], pool[Math.floor(rnd() * pool.length)]], spot: { x: 40, y: 20 } })
    events.sort((a, b) => a.t - b.t)
    const engagements = [...(base.engagements ?? [])]
    if (rnd() < 0.5) engagements.push({ a: pool[Math.floor(rnd() * pool.length)], b: pool[Math.floor(rnd() * pool.length)], t0: 0.1, t1: 0.6, kind: 'double' }, { a: pool[Math.floor(rnd() * pool.length)], b: 'dl0', t0: 0.1, t1: 0.6, kind: 'double' })
    const anim = { ...base, events, engagements }
    const p = replayPlan(play, anim, { setting: 'all' })
    drawn += p.tele.length
    checkPlan(`fuzz ${k}`, anim, p)
  }
  assert.ok(drawn > 400, `only ${drawn} fuzzed telestrations`)
})

ok('B6b: the freeze sits inside the play; frames stay in the replay window; skip ends it at once', () => {
  for (const [name, anim, play] of REPLAY_FIXTURES) {
    const p = replayPlan(play, anim, { setting: 'all' })
    const T = p.times
    assert.ok(p.key, `${name}: no key moment`)
    assert.ok(p.key!.t > p.t0 && p.key!.t <= p.t1, `${name}: key ${p.key!.t} outside ${p.t0}..${p.t1}`)
    assert.ok(T.cut <= T.freezeStart && T.freezeStart < T.freezeEnd && T.freezeEnd <= T.playEnd && T.playEnd < T.wipeOutStart && T.wipeOutStart < T.end, `${name}: times ${JSON.stringify(T)}`)
    assert.ok(p.rate > 0 && p.rate <= 1, `${name}: rate ${p.rate}`)
    assert.ok((p.t1 - p.t0) * p.duration <= MAX_SPAN_SEC + 1e-9, `${name}: replays ${(p.t1 - p.t0) * p.duration} s of play`)
    let lastT = -1
    let froze = 0
    for (const s of replaySecs(p)) {
      const f = replayAt(p, s)
      if (f.frozen) {
        froze++
        assert.equal(f.t, p.key!.t)
      }
      if (f.showReplay) {
        assert.ok(f.t >= p.t0 - 1e-9 && f.t <= p.t1 + 1e-9, `${name}: t ${f.t} outside the window at ${s}`)
        assert.ok(f.t >= lastT - 1e-9, `${name}: replay ran backwards at ${s}`)
        lastT = f.t
      }
      if (s < T.cut) assert.ok(!f.showReplay)
      if (s >= T.end) assert.equal(f.phase, 'done')
    }
    assert.ok(froze > 30, `${name}: froze for ${froze} frames`)
    // Skip: done immediately, a 'done' frame, nothing shows.
    const rp = new ReplayPlayer(p)
    rp.advance(T.freezeStart + 0.2)
    assert.ok(!rp.done && rp.frame().frozen)
    rp.skip()
    assert.ok(rp.done)
    const f = rp.frame()
    assert.equal(f.phase, 'done')
    assert.ok(!f.showReplay && f.wipe == null)
    assert.equal(rp.advance(1).phase, 'done')
    // A no-replay plan is done from the start.
    assert.ok(new ReplayPlayer(replayPlan(play, anim, { setting: 'off' })).done)
  }
})

/** Records strokes / text (and the fonts) a telestrator paints. */
function teleRecorder(width: number, height: number) {
  const r = fontRecorder(width, height)
  let calls = 0
  const ctx = new Proxy(r.ctx as unknown as Record<string | symbol, unknown>, {
    get: (t, k) => {
      const v = t[k]
      if (k === 'stroke' || k === 'fill' || k === 'fillText' || k === 'strokeText' || k === 'fillRect') return () => calls++
      return v
    },
    set: (t, k, v) => {
      t[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, sizes: r.sizes, calls: () => calls }
}

ok("B6b: nothing draws in 'fast' (sim to end) or 'off'; reduced motion has no wipe; labels >= 12 CSS px", () => {
  let labels = 0
  for (const [name, anim, play] of REPLAY_FIXTURES) {
    const p = replayPlan(play, anim, { setting: 'all' })
    for (const dpr of [1, 2]) {
      for (const [cw, ch] of [
        [375, 410],
        [1280, 720],
        [1920, 1080],
      ]) {
        const W = cw * dpr
        const H = ch * dpr
        const cx = (anim.ball[0].x + anim.ball[anim.ball.length - 1].x) / 2
        const pose = orbitPose({ focusX: cx, focusY: 24, back: 34, height: 22, yaw: 0, fovDeg: cw < 600 ? 55 : 43 })
        const cam = makeCamera(pose, { width: W, height: H })
        const info = { dpr, width: W, height: H }
        const tele = new TelestratorLayer()
        tele.setReplay(p, anim, NFL0, NFL1, { ol1: 77, ol2: 64, dl0: 97 })
        tele.avoid = { lastHud: [{ x: 16 * dpr, y: 16 * dpr, w: 300 * dpr, h: 32 * dpr }], lastPlaced: [] }
        const rec = teleRecorder(W, H)
        const hook = composeHooks(tele.hook, null, tele.topHook)
        const frame = { ...frameFor(1, cx), camera: pose }
        for (const s of replaySecs(p)) {
          tele.frame = replayAt(p, s)
          tele.mode = 'full'
          hook(rec.ctx, cam, frame, info)
          labels += tele.stats.labels
          for (const a of tele.lastLabels) for (const b of tele.lastLabels) if (a !== b) assert.ok(!rectsOverlap(a, b), `${name}: labels overlap`)
          for (const a of tele.lastLabels) assert.ok(!rectsOverlap(a, tele.avoid.lastHud[0]), `${name}: a label covers the HUD`)
        }
        const min = Math.min(...rec.sizes) / dpr
        assert.ok(min >= 12 - 1e-9, `${name} ${cw}x${ch}@${dpr}: smallest text ${min.toFixed(2)} CSS px`)
        // Sim to end / off: no telestration, bug or wipe at any second.
        for (const mode of ['fast', 'off'] as const) {
          const quiet = teleRecorder(W, H)
          for (const s of replaySecs(p)) {
            tele.frame = replayAt(p, s)
            tele.mode = mode
            hook(quiet.ctx, cam, frame, info)
            assert.equal(tele.lastDrawn.length, 0)
          }
          assert.equal(quiet.calls(), 0, `${name}: ${mode} drew ${quiet.calls()} calls`)
        }
        // The plan itself is empty in sim-to-end.
        assert.equal(replayPlan(play, anim, { setting: 'all', playback: 'fast' }).tele.length, 0)
      }
    }
    // Reduced motion: frames never carry a wipe; strokes are whole on the first frame they show.
    const rm = replayPlan(play, anim, { setting: 'all', reducedMotion: true })
    for (const s of replaySecs(rm)) {
      assert.equal(replayAt(rm, s).wipe, null)
      for (const it of rm.tele) {
        const st = teleState(it, s)
        if (st.alpha > 0) assert.equal(st.draw, 1)
      }
    }
  }
  assert.ok(labels > 50, `only ${labels} labels placed`)
  // partial() keeps the start and stops at the fraction of the length.
  const pl = partial([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0.75)
  assert.deepEqual(pl[pl.length - 1], { x: 10, y: 5 })
})

// ── B8: Game Day's replay rules (gameDayReplay) ─────────────────────────────
ok('B8: Game Day replays never block (paused / decision waiting / sim to end), Replay forces one', () => {
  const base = GPLAY as unknown as Record<string, unknown>
  const P = (o: Record<string, unknown>) => ({ ...base, ...o }) as unknown as Play
  const A = (kinds: AnimEventKind[]): BroadcastAnim => ({
    ...GA,
    events: [{ t: 0.03, kind: 'snap', keys: ['qb'], spot: { x: 35, y: 26 } }, ...kinds.map((kind, i) => ({ t: 0.1 + i * 0.1, kind, keys: ['wr0'], spot: { x: 50, y: 20 } }))],
  })
  const td = P({ yards: 75, endYard: 100 })
  const tdA = A(['throw', 'catch', 'score'])
  const short = P({ yards: 8, endYard: 33 })
  const shortA = A(['throw', 'catch', 'tackle'])
  const live = { setting: 'big' as const, playing: true }
  // Automatic: a big play while the game plays on → replay after the lead beat.
  const auto = gameDayReplay(td, tdA, live)
  assert.equal(auto.plan.replay, true)
  assert.equal(auto.lead, GAME_DAY_LEAD_SEC)
  assert.ok(GAME_DAY_LEAD_SEC > 0 && GAME_DAY_LEAD_SEC <= 1.5)
  // Never while paused, frozen, a decision is waiting, after Sim to end, or with replays off.
  for (const [name, ctx] of [
    ['paused', { ...live, playing: false }],
    ['frozen', { ...live, frozen: true }],
    ['decision waiting', { ...live, decisionPending: true }],
    ['sim to end', { ...live, simming: true }],
    ['replays off', { ...live, setting: 'off' as const }],
  ] as const) {
    const r = gameDayReplay(td, tdA, ctx)
    assert.equal(r.plan.replay, false, `auto replay while ${name}`)
    assert.equal(r.plan.tele.length, 0)
    assert.equal(r.lead, 0)
    // The Replay button replays it anyway, at once (no lead).
    const f = gameDayReplay(td, tdA, { ...ctx, force: true })
    assert.equal(f.plan.replay, true, `forced replay while ${name}`)
    assert.equal(f.lead, 0)
  }
  // 'big' skips a short completion, 'all' replays it; Replay forces it.
  assert.equal(gameDayReplay(short, shortA, live).plan.replay, false)
  assert.equal(gameDayReplay(short, shortA, { ...live, setting: 'all' }).plan.replay, true)
  assert.equal(gameDayReplay(short, shortA, { ...live, force: true }).plan.replay, true)
  // Never replayable, even forced: PAT, kneel, pre-snap penalty.
  assert.equal(gameDayReplay(P({ type: 'pat', result: 'PAT good' }), A(['kick', 'kickGood']), { ...live, force: true }).plan.replay, false)
  assert.equal(gameDayReplay(P({ type: 'run', concept: 'Kneel', yards: -1 }), A(['down']), { ...live, force: true }).plan.replay, false)
  assert.equal(gameDayReplay(P({ type: 'penalty' }), A([]), { ...live, setting: 'all', force: true }).plan.replay, false)
  // Deterministic, and the plan equals B6b's replayPlan for the same inputs.
  assert.deepEqual(gameDayReplay(td, tdA, live).plan, replayPlan(td, tdA, { setting: 'big' }))
  // Skip ends a replay at once (the Skip control / Space / Escape).
  const rp = new ReplayPlayer(auto.plan)
  rp.advance(1.0)
  rp.skip()
  assert.equal(rp.done, true)
  assert.equal(rp.frame().phase, 'done')
})

ok('B8: goalposts right by the lens are not drawn (a camera behind its own end line)', () => {
  const posts = (focusX: number) => {
    const layer = new ActorLayer()
    const W = 1280
    const H = 720
    const rec = teleRecorder(W, H)
    const frame = frameFor(1, focusX)
    const cam = makeCamera(frame.camera, { width: W, height: H })
    layer.hook(rec.ctx as unknown as CanvasRenderingContext2D, cam, frame, { dpr: 1, width: W, height: H })
    const items = (layer as unknown as { items: { kind: string; key: string }[] }).items
    return { cam, keys: items.filter((it) => it.kind === 'post').map((it) => it.key) }
  }
  // Backed up at the own 2: the camera sits behind the left end line → no left posts.
  const near = posts(12)
  assert.ok(near.cam.px < 10, `camera x ${near.cam.px}`)
  assert.ok(!near.keys.includes('left'), `left posts drawn at ${near.cam.px.toFixed(1)}`)
  // Midfield: the far posts still join the depth sort.
  assert.ok(posts(60).keys.includes('right'))
})

// ── animflow: the live field (playLive.ts) ──────────────────────────────────
const liveMover = (key: string, x: number, y: number, top = 6.5): LiveMover => ({ key, t: 0, x, y, path: [{ t: 0, x, y }], pace: { top, acc: top / 0.6 }, lastStop: true })
const pathSpeed = (mv: LiveMover, t: number) => {
  const a = livePos(mv.path, t - 0.05)
  const b = livePos(mv.path, t)
  return Math.hypot(b.x - a.x, b.y - a.y) / 0.05
}

ok('animflow: an engaged pair is drawn touching (~0.9 yd) and keeps moving until the shed', () => {
  const recs: { a: string; b: string; t0: number; t1: number }[] = []
  const f = new LiveField(0, {
    rec: (a, b, t0, t1) => recs.push({ a, b, t0, t1 }),
    plan: (_b, _d, t) => ({ shedAt: t + 1.8, drive: () => ({ x: 0.6, y: 0.4 }) }),
  }, 7)
  const ol = liveMover('ol0', 50, 26)
  const dl = liveMover('dl0', 52.2, 26.3, 7)
  f.add(ol, 'off', () => null, 'dl0')
  f.add(dl, 'def', () => ({ x: 48, y: 26, speed: 5 }))
  f.run(3)
  assert.equal(recs.length, 1, 'one block recorded')
  const e = recs[0]
  assert.ok(e.t0 < 0.6, `contact at ${e.t0.toFixed(2)} s`)
  let moving = 0
  let total = 0
  for (let t = e.t0 + 0.25; t <= e.t1 - 0.05; t += 0.05) {
    const a = livePos(ol.path, t)
    const b = livePos(dl.path, t)
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    assert.ok(d >= PAIR_GAP - 0.12 && d <= 1.0, `pair ${d.toFixed(2)} yd apart at ${t.toFixed(2)}`)
    total++
    if (pathSpeed(ol, t) > 0.3 && pathSpeed(dl, t) > 0.3) moving++
  }
  assert.ok(moving / total >= 0.9, `engaged pair moving ${moving}/${total}`)
  // The block drives: the pair ends up downfield of the contact point.
  assert.ok(livePos(dl.path, e.t1).x > livePos(dl.path, e.t0).x + 0.5, 'the drive block moved the man')
})

ok('animflow: a double team is two blockers shoulder to shoulder on one man, then one climbs', () => {
  const recs: { a: string; b: string; t0: number; t1: number }[] = []
  const f = new LiveField(0, {
    rec: (a, b, t0, t1) => recs.push({ a, b, t0, t1 }),
    plan: (blk, _d, t) => (blk === 'lb' ? { shedAt: t + 5, drive: () => ({ x: 0, y: 0 }) } : { shedAt: t + 3, climbAt: t + 0.8, drive: () => ({ x: 0.3, y: 0 }) }),
  }, 3)
  const a = liveMover('ol1', 50, 25)
  const b = liveMover('ol2', 50, 26.4)
  const d = liveMover('dl1', 51.6, 25.7)
  const lb = liveMover('lb1', 56, 25.8)
  f.add(a, 'off', () => null, 'dl1')
  f.add(b, 'off', () => null, 'dl1').climb = 'lb1'
  f.add(d, 'def', () => ({ x: 49, y: 25.7, speed: 3 }))
  f.add(lb, 'def', () => ({ x: 54, y: 25.8, speed: 2 }))
  f.run(2.5)
  f.closeAll(2.5)
  const dbl = recs.filter((r) => r.b === 'dl1')
  assert.equal(dbl.length, 2, `both blockers on dl1: ${JSON.stringify(recs)}`)
  const both0 = Math.max(...dbl.map((r) => r.t0)) + 0.25
  const both1 = Math.min(...dbl.map((r) => r.t1))
  assert.ok(both1 > both0, `a real double-team window: ${JSON.stringify(recs)}`)
  for (let t = both0; t <= both1; t += 0.05) {
    for (const mv of [a, b]) {
      const p = livePos(mv.path, t)
      const q = livePos(d.path, t)
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= 1.0, `${mv.key} off the double at ${t.toFixed(2)}`)
    }
    const pa = livePos(a.path, t)
    const pb = livePos(b.path, t)
    assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y) >= 0.8, 'the two blockers do not overlap')
  }
  assert.ok(recs.some((r) => r.a === 'ol2' && r.b === 'lb1'), `the climber reached the backer: ${JSON.stringify(recs)}`)
})

ok('animflow: pursuers close on the carrier but stay outside the keep-out ring until the tackle phase', () => {
  const carrier = liveMover('rb', 40, 26, 8)
  carrier.path = []
  for (let t = 0; t <= 4.001; t += 0.05) carrier.path.push({ t, x: 40 + t * 6, y: 26 + Math.sin(t) * 2 })
  const f = new LiveField(0, { plan: (_b, _d, t) => ({ shedAt: t + 1, drive: () => ({ x: 0, y: 0 }) }) }, 1)
  f.script(carrier)
  const keep = (t: number) => 1.3 + 2.4 * Math.max(0, Math.min(1, (3.5 - t) / 1.8))
  const men = [liveMover('lb0', 50, 20, 7.5), liveMover('s0', 60, 33, 8.5), liveMover('cb1', 45, 40, 9)]
  for (const mv of men) f.add(mv, 'def', pursue('rb', { keep }))
  f.run(3.5)
  for (const mv of men) {
    let closest = Infinity
    for (let t = 0.2; t <= 3.5; t += 0.05) {
      const p = livePos(mv.path, t)
      const c = livePos(carrier.path, t)
      const d = Math.hypot(p.x - c.x, p.y - c.y)
      // Never in contact (the recorded contact is <= 1 yd) and at most a step inside the ring.
      assert.ok(d >= 1.1 && d >= keep(t) - 0.45, `${mv.key} inside the ring (${d.toFixed(2)} < ${keep(t).toFixed(2)}) at ${t.toFixed(2)}`)
      closest = Math.min(closest, d)
    }
    assert.ok(closest < 3.0, `${mv.key} never closed on the carrier (closest ${closest.toFixed(2)})`)
  }
})

ok('animflow: a blocked defender takes the block pose and faces his blocker (both views read the same pair)', () => {
  const anim = {
    duration: 4000,
    actors: [
      { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 30, y: 26.65 }, { t: 1, x: 27, y: 26.65 }] },
      { key: 'ol0', side: 'off', role: 'OL', path: [{ t: 0, x: 34.4, y: 24 }, { t: 0.2, x: 34.6, y: 24 }, { t: 1, x: 35.6, y: 24.5 }] },
      { key: 'dl0', side: 'def', role: 'DL', path: [{ t: 0, x: 36.2, y: 24 }, { t: 0.2, x: 35.5, y: 24 }, { t: 1, x: 36.5, y: 24.5 }] },
    ],
    ball: [{ t: 0, x: 35, y: 26.65 }, { t: 0.05, x: 30, y: 26.65 }, { t: 1, x: 27, y: 26.65 }],
    holders: [{ t: 0, key: null }, { t: 0.04, key: 'qb' }],
    flights: [],
    engagements: [{ a: 'ol0', b: 'dl0', t0: 0.2, t1: 0.9, kind: 'block' }],
    events: [{ t: 0.04, kind: 'snap', keys: ['ol2', 'qb'], spot: { x: 35, y: 26.65 } }],
  } as unknown as BroadcastAnim
  const play = { type: 'run', concept: 'Inside Zone', result: 'Rush', startYard: 25, endYard: 25, yards: 0 } as unknown as Play
  const pa = presentAnim(anim, play)
  for (const k of ['ol0', 'dl0']) {
    const w = pa.poses[k].find((x) => x.state === 'block')
    assert.ok(w && w.t0 <= 0.25 && w.t1 >= 0.85, `${k} block pose ${JSON.stringify(pa.poses[k])}`)
  }
  const fw = pa.facing.dl0.find((x) => x.t0 <= 0.5 && x.t1 >= 0.5)
  assert.ok(fw && fw.mode === 'actor' && fw.key === 'ol0', `dl0 faces his blocker: ${JSON.stringify(fw)}`)
})

ok('animflow: the carrier stumbles at first contact and the tackler wraps him up (tackle pose, facing him) before going down', () => {
  const anim = {
    duration: 5000,
    actors: [
      { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 30, y: 26.65 }, { t: 1, x: 29, y: 26.65 }] },
      { key: 'rb', side: 'off', role: 'RB', path: [{ t: 0, x: 28, y: 28 }, { t: 0.7, x: 40, y: 27 }, { t: 1, x: 42, y: 27 }] },
      { key: 'lb1', side: 'def', role: 'LB', path: [{ t: 0, x: 40, y: 22 }, { t: 0.7, x: 40.5, y: 26.5 }, { t: 1, x: 42.5, y: 26.6 }] },
    ],
    ball: [{ t: 0, x: 35, y: 26.65 }, { t: 0.05, x: 30, y: 26.65 }, { t: 0.2, x: 30, y: 27 }, { t: 1, x: 42, y: 27 }],
    holders: [{ t: 0, key: null }, { t: 0.03, key: 'qb' }, { t: 0.2, key: 'rb' }],
    flights: [],
    engagements: [{ a: 'lb1', b: 'rb', t0: 0.7, t1: 1, kind: 'tackle' }],
    events: [
      { t: 0.03, kind: 'snap', keys: ['ol2', 'qb'], spot: { x: 35, y: 26.65 } },
      { t: 0.7, kind: 'contact', keys: ['rb', 'lb1'], spot: { x: 40, y: 27 } },
      { t: 1, kind: 'tackle', keys: ['lb1', 'rb'], spot: { x: 42, y: 27 } },
    ],
  } as unknown as BroadcastAnim
  const play = { type: 'run', concept: 'Inside Zone', result: 'Rush', startYard: 25, endYard: 32, yards: 7 } as unknown as Play
  const pa = presentAnim(anim, play)
  assert.ok(pa.poses.rb.some((w) => w.state === 'stumble' && w.t0 <= 0.7 && w.t1 >= 0.7), `rb ${JSON.stringify(pa.poses.rb)}`)
  assert.ok(pa.poses.rb.some((w) => w.state === 'down'), 'carrier goes down')
  const tw = pa.poses.lb1.find((w) => w.state === 'tackle')
  assert.ok(tw && tw.t0 <= 0.72, `lb1 ${JSON.stringify(pa.poses.lb1)}`)
  const fw = pa.facing.lb1.find((x) => x.t0 <= 0.8 && x.t1 >= 0.8)
  assert.ok(fw && fw.mode === 'actor' && fw.key === 'rb', `lb1 faces the carrier: ${JSON.stringify(fw)}`)
  assert.ok(pa.poses.lb1.some((w) => w.state === 'dive' || w.state === 'down'), 'tackler goes down')
})

ok('animflow r3: the QB throw is a set, wind-up, release at the flight start and a follow-through, per style (ball in the hand)', () => {
  const mk = (style: ThrowStyle) => {
    const D = 5
    const R = 2.6 / D
    const anim = {
      duration: D * 1000,
      actors: [
        { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 30, y: 26.65 }, { t: 0.04, x: 30, y: 26.65 }, { t: 0.3, x: 27.4, y: 26.65 }, { t: 0.6, x: 27.6, y: 26.65 }, { t: 1, x: 31, y: 26 }] },
        { key: 'wr0', side: 'off', role: 'WR', path: [{ t: 0, x: 35, y: 10 }, { t: 0.7, x: 47, y: 14 }, { t: 1, x: 52, y: 15 }] },
        { key: 'cb0', side: 'def', role: 'CB', path: [{ t: 0, x: 42, y: 10 }, { t: 0.7, x: 48, y: 13 }, { t: 1, x: 52, y: 14 }] },
      ],
      ball: [{ t: 0, x: 35, y: 26.65 }, { t: 0.03, x: 30, y: 26.65 }, { t: R, x: 27.6, y: 26.65 }, { t: 0.7, x: 47, y: 14 }, { t: 1, x: 52, y: 15 }],
      holders: [{ t: 0, key: null }, { t: 0.03, key: 'qb' }, { t: R, key: null }, { t: 0.7, key: 'wr0' }],
      flights: [{ t0: R, t1: 0.7, height: 0.6 }],
      engagements: [],
      events: [{ t: 0.03, kind: 'snap', keys: ['ol2', 'qb'], spot: { x: 35, y: 26.65 } }, { t: R, kind: 'throw', keys: ['qb', 'wr0'], spot: { x: 27.6, y: 26.65 } }, { t: 0.7, kind: 'catch', keys: ['wr0'], spot: { x: 47, y: 14 } }],
      throwStyle: style,
    } as unknown as BroadcastAnim
    const play = { type: 'pass', concept: 'Smash', result: 'Complete', startYard: 25, endYard: 42, yards: 17 } as unknown as Play
    return { pa: presentAnim(anim, play), D, R }
  }
  const p = {} as PoseParams
  for (const style of ['normal', 'quick', 'deep', 'run', 'hurry'] as ThrowStyle[]) {
    const { pa, D, R } = mk(style)
    const T = THROW_TIMING[style]
    const st = THROW_STATE[style]
    const w = pa.poses.qb.find((x) => x.state === st)
    assert.ok(w, `${style}: throw window ${JSON.stringify(pa.poses.qb)}`)
    assert.ok(Math.abs(w!.t0 - (R - T.wind / D)) < 1e-6, `${style}: wind-up starts ${T.wind} s before the release`)
    assert.ok(Math.abs(w!.t1 - (R + T.follow / D)) < 1e-6, `${style}: follow-through lasts ${T.follow} s`)
    // The drop is done and he is set before the wind-up.
    assert.ok(pa.poses.qb.some((x) => x.state === 'set' && x.t1 <= w!.t0 + 1e-9), `${style}: set before the throw ${JSON.stringify(pa.poses.qb)}`)
    // The pose library is in step with THROW_TIMING: ball at the ear before the
    // release, the arm coming through at the release frame, across after it.
    poseParams(st, T.wind - 0.07, T.wind + T.follow, p)
    assert.ok(p.thr > 0.7 && p.rel === 0 && p.oa > 0.9, `${style}: cocked, off arm out ${JSON.stringify(p)}`)
    poseParams(st, T.wind, T.wind + T.follow, p)
    assert.ok(p.rel > 0.3 && p.rel < 0.8 && p.thf === 0, `${style}: release frame mid-arm ${JSON.stringify(p)}`)
    poseParams(st, T.wind + T.follow - 0.01, T.wind + T.follow, p)
    assert.ok(p.thf > 0.85, `${style}: follow-through ${p.thf}`)
    // The ball is in the hand: at the ear late in the wind-up, at the release height at the flight start.
    assert.ok(Math.abs(ballZAt(pa, R) - throwHand(style, 0).z) < 1e-6, `${style}: flight leaves from the hand ${ballZAt(pa, R)}`)
    assert.ok(ballZAt(pa, R - 0.08 / D) > 1.6 && ballZAt(pa, R - T.wind / D) < 1.3, `${style}: ball to the ear in the wind-up`)
    assert.ok(throwHand(style, 0.08).off < 0 && throwHand(style, 0).off > 0, `${style}: back then out over the top`)
    // Shoulders to the target through the motion, and he watches the ball after.
    for (const tt of [R - T.wind / D, R, R + T.follow / D, 0.65]) {
      const fw = pa.facing.qb.find((x) => x.t0 <= tt + 1e-9 && x.t1 >= tt - 1e-9)
      assert.ok(fw && fw.mode === 'actor' && fw.key === 'wr0', `${style}: faces the target at ${tt}: ${JSON.stringify(fw)}`)
    }
    if (style === 'run' || style === 'hurry') { poseParams(st, T.wind, 1, p); assert.ok(p.stp === 0, `${style}: no plant`) }
    if (style === 'normal') { poseParams(st, T.wind + 0.05, 1, p); assert.ok(p.stp > 0.9, 'normal: stride planted at the release') }
  }
  assert.ok(THROW_TIMING.quick.wind < THROW_TIMING.normal.wind && THROW_TIMING.deep.wind > THROW_TIMING.normal.wind, 'quick shorter, deep longer')
  poseParams('throwQuick', 0.1, 0.4, p)
  assert.ok(p.qtr === 1, 'quick game is three-quarter')
})

ok('animflow r4: a field goal / PAT carries through the uprights and past the end line (miss: wide / short / off an upright / blocked); the clip runs on until it is down', () => {
  const posAtWp = (ps: { t: number; x: number; y: number }[], t: number) => {
    if (t <= ps[0].t) return ps[0]
    for (let i = 1; i < ps.length; i++) if (t <= ps[i].t) { const a = ps[i - 1], b = ps[i]; const u = (t - a.t) / Math.max(1e-9, b.t - a.t); return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u } }
    return ps[ps.length - 1]
  }
  const zAtK = (kz: { t: number; z: number }[], t: number) => {
    for (let i = 1; i < kz.length; i++) if (t <= kz[i].t) { const a = kz[i - 1], b = kz[i]; return a.z + (b.z - a.z) * ((t - a.t) / Math.max(1e-9, b.t - a.t)) }
    return kz[kz.length - 1].z
  }
  const seen = new Set<string>()
  for (const los of [25, 50, 66, 78, 95]) {
    for (let s = 0; s < 40; s++) {
      for (const good of [true, false]) {
        const rnd = (k: number) => ((Math.sin((s + 1) * 12.9898 + k * 78.233 + los) * 43758.5453) % 1 + 1) % 1
        const kf = kickFlight({ los, kickT: 0.3, good, blocked: false, kpw: 80, seed: rnd })
        seen.add(kf.miss)
        const p = posAtWp(kf.ball, kf.resT)
        const z = zAtK(kf.kz, kf.resT)
        assert.ok(kf.endT > kf.resT + 0.3, `clip runs past the posts (${kf.miss})`)
        assert.ok(Math.abs(kf.tc - (120 - (los - 7)) / (18.5 + 0.06 * (127 - los) + 0.8)) < 1e-6, 'time to the posts = distance / ball speed')
        if (kf.miss === 'none') {
          assert.ok(Math.abs(p.x - 120) < 1e-6 && Math.abs(p.y - 26.65) < 3.08 && z > 10 / 3, `make through the uprights: ${JSON.stringify(p)} z ${z}`)
          const last = kf.ball[kf.ball.length - 1]
          assert.ok(last.x > 120.5, `make carries past the end line: ${last.x}`)
          assert.ok(kf.ball.every((b) => b.t <= kf.resT + 1e-9 || b.x >= 120 - 1e-9), 'never comes back in front of the posts')
        } else if (kf.miss === 'wide') {
          assert.ok(Math.abs(p.x - 120) < 1e-6 && Math.abs(p.y - 26.65) > 3.08 + 0.5, `wide: ${JSON.stringify(p)}`)
        } else if (kf.miss === 'short') {
          assert.ok(Math.abs(p.x - 120) < 1e-6 && z < 10 / 3, `short: under the bar ${z}`)
        } else if (kf.miss === 'doink') {
          assert.ok(Math.abs(Math.abs(p.y - 26.65) - 3.08) < 1e-6 && z > 10 / 3 && z < 13.3, `doink at the upright ${JSON.stringify(p)} z ${z}`)
          assert.ok(kf.ball[kf.ball.length - 1].x < 120, 'kicks back out off the upright')
        }
      }
    }
  }
  for (const k of ['none', 'wide', 'short', 'doink']) assert.ok(seen.has(k), `covers ${k}`)
  const bl = kickFlight({ los: 60, kickT: 0.3, good: false, blocked: true, kpw: 80, seed: () => 0.3 })
  assert.ok(bl.miss === 'blocked' && Math.abs(bl.resPt.x - 60.3) < 1e-6, 'blocked at the line')
  // presentAnim draws the kick's real height (not a generic arc that ends at the posts' foot).
  const kf = kickFlight({ los: 78, kickT: 0.3, good: true, blocked: false, kpw: 75, seed: () => 0.4 })
  const T = kf.endT + 0.5
  const fr = (t: number) => t / T
  const anim = {
    duration: T * 1000,
    actors: [{ key: 'qb', side: 'off', role: 'H', path: [{ t: 0, x: 71, y: 26.65 }, { t: 1, x: 71, y: 26.65 }] }, { key: 'rb', side: 'off', role: 'K', path: [{ t: 0, x: 68.5, y: 24.65 }, { t: 1, x: 70.8, y: 26.15 }] }],
    ball: [{ t: 0, x: 78, y: 26.65 }, ...kf.ball.map((b) => ({ t: fr(b.t), x: b.x, y: b.y }))],
    holders: [{ t: 0, key: null }, { t: fr(0.14), key: 'qb' }, { t: fr(0.3), key: null }],
    flights: [{ t0: fr(0.3), t1: fr(kf.endT), height: 1 }],
    posts: true,
    kickZ: kf.kz.map((k) => ({ t: fr(k.t), z: k.z })),
    events: [{ t: fr(0.3), kind: 'kick', keys: ['rb'], spot: { x: 71, y: 26.65 } }, { t: fr(kf.resT), kind: 'kickGood', keys: ['rb'], spot: kf.resPt }],
    engagements: [],
  } as unknown as BroadcastAnim
  const pa = presentAnim(anim, { type: 'fg', concept: 'Field goal', result: '39-yd FG is good', startYard: 68, endYard: 68, yards: 0 } as unknown as Play)
  const zc = ballZAt(pa, fr(kf.resT))
  assert.ok(zc > 10 / 3 + 0.5 && Math.abs(zc - zAtK(kf.kz, kf.resT)) < 0.05, `drawn over the crossbar at the posts: ${zc}`)
})

ok('animflow r5: kick / punt returns move all 21 others (lanes, wall, gunners vs jammers, converge)', () => {
  const mk = (key: string, x: number, y: number, top = 7.5): LiveMover => ({ key, t: 0, x, y, path: [{ t: 0, x, y }], pace: { top, acc: 5 }, lastStop: true })
  // Scripted returner: settles under the ball, catches at catchT, runs to the spot by endT.
  const script = (key: string, from: { x: number; y: number }, catchPt: { x: number; y: number }, spot: { x: number; y: number }, catchT: number, endT: number) => {
    const r = mk(key, from.x, from.y, 8)
    r.path = []
    for (let t = 0; t <= endT + 0.6001; t += 0.05) {
      const u = t < catchT ? t / catchT : Math.min(1, (t - catchT) / (endT - catchT))
      const p = t < catchT ? { x: from.x + (catchPt.x - from.x) * u, y: from.y + (catchPt.y - from.y) * u } : { x: catchPt.x + (spot.x - catchPt.x) * u, y: catchPt.y + (spot.y - catchPt.y) * u }
      r.path.push({ t, ...p })
    }
    return r
  }
  const speedAt = (mv: LiveMover, t: number) => {
    const a = livePos(mv.path, t - 0.1)
    const b = livePos(mv.path, t)
    return Math.hypot(b.x - a.x, b.y - a.y) / 0.1
  }
  const longestStill = (mv: LiveMover, t0: number, t1: number) => {
    let run = 0
    let worst = 0
    for (let t = t0 + 0.1; t <= t1; t += 0.05) {
      run = speedAt(mv, t) < 0.5 ? run + 0.05 : 0
      worst = Math.max(worst, run)
    }
    return worst
  }
  const sd = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
  const blockOf = () => 70
  const shedOf = () => 70

  // Kickoff: return to +x from the 5; the coverage starts on the 35 (x = 75).
  {
    const cov: LiveMover[] = []
    for (let i = 0; i < 10; i++) cov.push(mk(`c${i}`, 76, 6.85 + i * 4.4, 8))
    cov.push(mk('k', 81, 26.65, 6.5))
    const blk: LiveMover[] = []
    const front = ['f0', 'f1', 'f2', 'f3', 'f4']
    front.forEach((k, i) => blk.push(mk(k, 64, 26.65 + (i - 2) * 9, 7)))
    const middle = ['m0', 'm1', 'm2']
    middle.forEach((k, i) => blk.push(mk(k, 40, 26.65 + (i - 1) * 9, 7)))
    const backs = ['b0', 'b1']
    backs.forEach((k, i) => blk.push(mk(k, 22, 26.65 + (i ? 5 : -5), 7.5)))
    const catchT = 3.9
    const endT = 7.4
    const catchPt = { x: 10, y: 24 }
    const spot = { x: 34, y: 36 }
    const ret = script('rb', { x: 6, y: 25 }, catchPt, spot, catchT, endT)
    const rr = runReturnField({
      kind: 'kickoff', outcome: 'return', cov, kicker: 'k', blk, returner: ret, dir: 1, kickT: 0, catchT, catchPt, spot,
      contactT: endT - 0.5, endT, tackleFrom: endT - 1.4, tackler: 'c7', front, middle, backs, seed: 11, blockOf, shedOf,
    })
    assert.equal(rr.scheme, 'wall')
    for (const mv of [...cov, ...blk]) {
      const st = longestStill(mv, 0.3, endT)
      assert.ok(st <= 0.6, `kickoff: ${mv.key} still for ${st.toFixed(2)} s`)
    }
    const lanes = cov.filter((m) => m.key !== 'k').map((m) => livePos(m.path, 2).y)
    assert.ok(sd(lanes) >= 28 && sd(lanes) <= 46, `kickoff lanes at +2 s spread ${sd(lanes).toFixed(1)} yd (NFL ~37)`)
    const atCatch = blk.map((m) => livePos(m.path, catchT))
    assert.ok(sd(atCatch.map((p) => p.x)) >= 5, `return blockers not a flat line at the catch (depth range ${sd(atCatch.map((p) => p.x)).toFixed(1)})`)
    const sideShare = atCatch.filter((p) => p.y >= catchPt.y).length / atCatch.length
    assert.ok(sideShare >= 0.6, `the wall sets up on the return side (${sideShare.toFixed(2)})`)
    const dEnd = cov.filter((m) => m.key !== 'k').map((m) => { const p = livePos(m.path, endT); return Math.hypot(p.x - spot.x, p.y - spot.y) }).sort((a, b) => a - b)
    const dCatch = cov.filter((m) => m.key !== 'k').map((m) => { const p = livePos(m.path, catchT); return Math.hypot(p.x - catchPt.x, p.y - catchPt.y) }).sort((a, b) => a - b)
    assert.ok(dEnd[5] < dCatch[5] && dEnd[5] < 12, `coverage converges on the returner (median ${dCatch[5].toFixed(1)} -> ${dEnd[5].toFixed(1)} yd)`)
  }

  // Punt (as the builder lays it out): the coverage runs toward +x, the return comes back to -x.
  for (const outcome of ['return', 'fairCatch'] as const) {
    const los = 40
    const cov: LiveMover[] = []
    const protectors = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
    protectors.forEach((k, i) => cov.push(mk(k, los - 0.6, 26.65 + (i - 3.5) * 2, 7)))
    const gunners = ['g0', 'g1']
    cov.push(mk('g0', los - 0.6, 6, 8.5), mk('g1', los - 0.6, 47.3, 8.5), mk('P', los - 14, 26.65, 6))
    const blk: LiveMover[] = []
    const rushers = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5']
    rushers.forEach((k, i) => blk.push(mk(k, los + 1.1, 26.65 + (i - 2.5) * 2.4, 7)))
    const jammers = ['j0', 'j1']
    blk.push(mk('j0', los + 1.4, 7.1, 8.5), mk('j1', los + 1.4, 46.2, 8.5), mk('h0', los + 9, 28, 7), mk('h1', los + 30, 20, 7.5))
    const kickT = 2.0
    const catchT = 6.4
    const endT = outcome === 'return' ? 9.2 : 7.2
    const catchPt = { x: 82, y: 26 }
    const spot = outcome === 'return' ? { x: 70, y: 33 } : catchPt
    const ret = script('s0', { x: 88, y: 30 }, catchPt, spot, catchT, outcome === 'return' ? endT : catchT + 0.01)
    runReturnField({
      kind: 'punt', outcome, cov, kicker: 'P', blk, returner: ret, dir: -1, kickT, catchT, catchPt, spot,
      contactT: outcome === 'return' ? endT - 0.5 : endT, endT, tackleFrom: outcome === 'return' ? endT - 1.4 : endT, tackler: outcome === 'return' ? 'p2' : undefined,
      gunners, jammers, rushers, protectors, seed: 5, blockOf, shedOf,
    })
    for (const mv of [...cov, ...blk]) {
      const st = longestStill(mv, kickT, endT)
      assert.ok(st <= 0.6, `punt ${outcome}: ${mv.key} still for ${st.toFixed(2)} s after the kick`)
    }
    // Gunners vs jammers: the jammer is with his gunner (within ~3 yd) a second after the snap.
    for (const [g, j] of [['g0', 'j0'], ['g1', 'j1']]) {
      const pg = livePos(cov.find((m) => m.key === g)!.path, 1.0)
      const pj = livePos(blk.find((m) => m.key === j)!.path, 1.0)
      assert.ok(Math.hypot(pg.x - pj.x, pg.y - pj.y) < 3, `${j} on ${g} at the line (${Math.hypot(pg.x - pj.x, pg.y - pj.y).toFixed(1)} yd)`)
      const pg2 = livePos(cov.find((m) => m.key === g)!.path, 2.0)
      assert.ok(pg2.x > los + 4, `${g} released downfield (x ${pg.x.toFixed(1)} @1s, ${pg2.x.toFixed(1)} @2s)`)
    }
    const dEnd = cov.filter((m) => m.key !== 'P').map((m) => { const p = livePos(m.path, endT); return Math.hypot(p.x - spot.x, p.y - spot.y) }).sort((a, b) => a - b)
    assert.ok(dEnd[4] < (outcome === 'return' ? 10 : 14), `punt ${outcome}: coverage closes (median ${dEnd[4].toFixed(1)} yd)`)
  }
})

// animflow r5 item 4: on real harness plays (seed 33333, one game) the LIVE camera keeps
// the carrier inside the safe frame above the playback controls on every frame,
// through the tackle and the post-play hold.
{
  const { fileURLToPath } = await import('node:url')
  const repo = fileURLToPath(new URL('..', import.meta.url))
  const rj = (n: string) => JSON.parse(readFileSync(`${repo}public/data/${n}.json`, 'utf8'))
  ;(await import('../src/game/data/realData.ts')).setRealData({ nfl: rj('madden26').players, cfb: rj('cfb26').teams, source: { madden: 'local', cfb: 'local' } })
  ;(await import('../src/game/data/calibration.ts')).setCalibration(rj('calibration'))
  const store = await import('../src/store/gameStore.ts')
  const { simulatePlayByPlay } = await import('../src/game/engine/playsim.ts')
  const { buildPlayAnim, holderAt, posAt } = await import('../src/components/playAnim.ts')
  const { actorPlayers } = await import('../src/components/jersey.ts')
  const cam = await import('../src/components/broadcast/camera.ts')
  const { createBroadcastDirector } = await import('../src/components/broadcast/directorRules.ts')
  const pc = await import('../src/components/broadcast/phoneCamera.ts')
  ok('animflow r5: the carrier stays inside the safe frame above the controls on every frame (harness plays)', () => {
    store.useGame.getState().startCareer({ name: 'C', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const sim = simulatePlayByPlay(world, nfl[0].id, nfl[1].id, world.seed + 13)
    const W = 1280
    const H = 720
    const bot = H - (48 + 14)
    let frames = 0
    let plays = 0
    for (let i = 0; i < sim.plays.length; i++) {
      const play = sim.plays[i]
      if (!['run', 'pass', 'kickoff', 'punt'].includes(play.type)) continue
      const other = play.offId === nfl[0].id ? nfl[1].id : nfl[0].id
      const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors: actorPlayers(world, play, other, null) })
      const d = createBroadcastDirector({ profile: 'live', viewport: { w: W, h: H }, bottomClearPx: 48 })
      d.reset(play, anim)
      const n = Math.ceil((anim.duration / 1000) * 60)
      let carried = false
      for (let j = 0; j <= n; j++) {
        const t = j / n
        const key = holderAt(anim, t)
        if (!key || (key === 'qb' && play.type === 'pass')) continue
        const a = anim.actors.find((x) => x.key === key)
        if (!a) continue
        carried = true
        const p = posAt(a.path, t)
        const s = cam.project(cam.makeCamera(d.toCamera(d.shotAt(t)), { width: W, height: H }), p.x, p.y, 0)
        if (!s) continue
        frames++
        assert.ok(s.y <= bot + 2 && s.x >= W * 0.06 - 2 && s.x <= W * 0.94 + 2, `play ${i} ${play.concept}: carrier ${key} at (${s.x.toFixed(0)}, ${s.y.toFixed(0)}) outside the safe frame at t ${t.toFixed(3)}`)
      }
      if (carried) plays++
    }
    assert.ok(plays > 80 && frames > 10000, `harness coverage ${plays} plays / ${frames} frames`)
  })
  // animflow r6a (user request): the play starts a little zoomed out — at frame 0 every
  // on-field player is inside the frame with a margin, desktop and 375 px phone.
  ok('animflow r6a: frame 0 is wide — every on-field player inside with a margin (desktop 1280), the formation core on a 375 px phone', () => {
    store.useGame.getState().startCareer({ name: 'C', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const sim = simulatePlayByPlay(world, nfl[0].id, nfl[1].id, world.seed + 13)
    const misses: string[] = []
    let checked = 0
    const CORE = /^(ol\d|qb|rb|fb|te|dl\d|lb\d)$/
    for (const [profile, W, H, clear] of [['live', 1280, 720, 48], ['phone', 351, 480, 0]] as const) {
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if (!['run', 'pass', 'kickoff', 'punt'].includes(play.type)) continue
        if (profile === 'phone' && play.type === 'kickoff') continue
        const other = play.offId === nfl[0].id ? nfl[1].id : nfl[0].id
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors: actorPlayers(world, play, other, null) })
        const d = createBroadcastDirector({ profile, viewport: { w: W, h: H }, bottomClearPx: clear })
        d.reset(play, anim)
        let pose = d.toCamera(d.shotAt(0))
        if (profile === 'phone') {
          const b = posAt(anim.ball, 0)
          pose = pc.applyCameraProfile(pose, pc.CAMERA_PROFILES.phone, { strongSideY: 32.5, carrier: null, ball: { x: b.x, y: b.y, z: 0 }, losX: b.x, direction: 1, phase: 'live', viewport: { w: W, h: H }, wide: 1 })
        }
        const c = cam.makeCamera(pose, { width: W, height: H })
        for (const a of anim.actors) {
          // Kickoffs: the receiving unit is 40-60 yd away, behind the kick-side camera rig;
          // the kicking unit at the ball is the pre-kick subject. Phone: the formation core.
          if (play.type === 'kickoff' && a.side === 'off') continue
          const p = posAt(a.path, 0)
          // Phone (portrait, ~20 yd wide): the box — linemen, backs, backers within 9 yd of the ball.
          if (profile === 'phone' && (!CORE.test(a.key) || Math.abs(p.y - posAt(anim.ball, 0).y) > 9)) continue
          const s = cam.project(c, p.x, p.y, 0)
          const m = 0.02
          const inside = !!s && s.x >= W * m && s.x <= W * (1 - m) && s.y >= H * m && s.y <= H - Math.max(clear, H * m)
          checked++
          if (!inside) misses.push(`${profile} play ${i} ${play.type} ${a.key} (${s ? s.x.toFixed(0) + ',' + s.y.toFixed(0) : 'behind'})`)
        }
      }
    }
    assert.ok(checked > 3000, `coverage ${checked}`)
    assert.ok(misses.length === 0, `${misses.length} players outside the frame at the start: ${misses.slice(0, 6).join('; ')}`)
  })
}

ok('SL1 sideline: team areas between the 32s, behind the border, home near / away far; officials placed by mechanics and deterministic', () => {
  const homeC = NFL_TEAMS[0]
  const awayC = NFL_TEAMS[1]
  for (const [side, club, home] of [['home', homeC, true], ['away', awayC, false]] as const) {
    const ps = buildTeamArea(side, club, home)
    assert.ok(ps.length >= 45, `~46-man sideline incl. staff: ${ps.length}`)
    assert.equal(ps.filter((p) => p.lite).length, 12, 'Lite draws 12 per side')
    assert.equal(ps.filter((p) => p.role === 'hc').length, 1, 'one head coach')
    for (const p of ps) {
      assert.ok(p.x >= TEAM_BOX.x0 && p.x <= TEAM_BOX.x1, `between the 32s: ${p.x}`)
      assert.ok(p.off >= TEAM_BOX.border + 0.4, `outside the field + border: ${p.role} ${p.off}`)
      if (p.role === 'player' || p.role === 'bench' || p.role === 'staff') assert.ok(p.off > TEAM_BOX.coach, `players / staff behind the restraining line: ${p.off}`)
      assert.ok(p.off < 10, 'inside the wall')
      const y = sideY(side, p.off)
      assert.ok(side === 'home' ? y < -2 : y > 53.3 + 2, `${side} sideline (${y})`)
    }
    assert.deepEqual(buildTeamArea(side, club, home), ps, 'deterministic layout')
  }
  assert.ok(BENCHES.every(([a, b]) => a >= TEAM_BOX.x0 && b <= TEAM_BOX.x1), 'benches inside the team box')
  // Officials: a 1st & 10 at the own 30 (LOS x = 40), ball still.
  const play = { type: 'pass', qtr: 1, clock: '10:00', down: 1, distance: 10, startYard: 30, endYard: 30, yards: 0, result: 'Incomplete', offId: 'A', defId: 'B' } as unknown as Play
  const anim = { duration: 4000, events: [{ t: 0.6, kind: 'incomplete', keys: [], spot: { x: 50, y: 26.65 } }] } as unknown as BroadcastAnim
  const rd = readPlay(play, anim, 'A')
  assert.ok(!rd.td && !rd.firstDown && rd.cheer == null, 'an incompletion: no signal, no cheer')
  const still = () => ({ x: 40, y: 26.65 })
  const at = (t: number, p = play) => Object.fromEntries(officialsAt(p, still, t, 4, 40, rd, true).map((o) => [o.role, o]))
  const o0 = at(0)
  assert.deepEqual(Object.keys(o0).sort(), [...OFFICIAL_ROLES].sort(), 'seven officials')
  assert.ok(near(o0.R.x, 29) && o0.R.y < 26.65, `referee 11 yd deep on the throwing side: ${JSON.stringify(o0.R)}`)
  assert.ok(o0.U.x < 40, 'umpire in the offensive backfield')
  assert.ok(near(o0.DJ.x, 40) && near(o0.LJ.x, 40) && o0.DJ.y > 53.3 && o0.LJ.y < 0, 'wing officials on the LOS, opposite sidelines (DJ on the chain side)')
  assert.ok(near(o0.SJ.x, 60) && near(o0.FJ.x, 60) && o0.SJ.y > 26.65 && o0.FJ.y < 26.65, 'side / field judges 20 deep, opposite sides')
  assert.ok(near(o0.BJ.x, 65) && near(o0.BJ.y, 26.65), 'back judge 25 deep in the middle')
  const late = at(0, { ...play, qtr: 4, clock: '1:30' } as Play)
  assert.ok(late.U.x > 40, 'final 2:00: umpire on the defensive side')
  assert.deepEqual(at(0.3), at(0.3), 'deterministic in t')
  const td = readPlay({ ...play, type: 'run', endYard: 100, yards: 70, result: 'Touchdown' } as Play, { duration: 4000, events: [{ t: 0.8, kind: 'score', keys: [], spot: { x: 110, y: 20 } }] } as unknown as BroadcastAnim, 'A')
  assert.ok(td.td && td.cheer === 'home' && near(td.tScore, 0.8), 'a home TD: signal + home sideline cheers')
  const fdR = readPlay({ ...play, type: 'run', down: 3, distance: 4, yards: 6, endYard: 36, result: '6-yd run' } as Play, { duration: 4000, events: [{ t: 0.7, kind: 'tackle', keys: [], spot: { x: 46, y: 20 } }] } as unknown as BroadcastAnim, 'B')
  assert.ok(fdR.firstDown && !fdR.td && near(fdR.tEnd, 0.7), 'a conversion signals a first down')
})

// ── animflow r6b: ratings audit gaps ────────────────────────────────────────
const r6bPlayer = (id: string, pos: string, ovr: number, attrs?: Record<string, number>, devRatings?: Record<string, number>) =>
  ({ id, pos, ovr, attrs, devRatings, name: id, teamId: 'A', age: 25 }) as unknown as Player

ok('animflow r6b (item 1): the animation reads the sim\'s effective ratings (playerAttrs: generated + real + dev-plan gains), never raw attrs', () => {
  // A real WR carries SPD but no route ratings: the sim generates them; the
  // animation must read the same numbers (before: every real WR read SRR 70).
  const wr = r6bPlayer('wr-x', 'WR', 84, { SPD: 93 })
  const eff = playerAttrs(wr)
  assert.equal(effRating(wr, 'SRR'), eff.SRR)
  assert.equal(attrOf(wr, 'DRR'), eff.DRR)
  assert.equal(attrOf(wr, 'SPD'), 93, 'real rating wins')
  // A generated player (no attrs at all) is not 70 across the board.
  const gen = r6bPlayer('gen-x', 'CB', 77)
  assert.deepEqual(effAttrs(gen), playerAttrs(gen))
  assert.ok(Object.values(effAttrs(gen)).some((v) => v !== 70), 'generated ratings, not a flat 70')
  // L15 dev-plan gains count, and a new gains object is seen (cache keyed on it).
  const dev = r6bPlayer('wr-x', 'WR', 84, { SPD: 93, SRR: 70 }, { SRR: 6 })
  assert.equal(effRating(dev, 'SRR'), 76)
  const dev2 = { ...dev, devRatings: { SRR: 9 } } as Player
  assert.equal(effRating(dev2, 'SRR'), 79)
  // Missing player / key: the fallback.
  assert.equal(effRating(undefined, 'SRR', 70), 70)
  assert.equal(effRating(gen, 'NOPE', 61), 61)
  // The crisp-cut threshold sits at the effective-rating median (WR SRR p50 75).
  assert.equal(CRISP_RR, 75)
})

ok('animflow r6b (item 2): the recorded on-field eleven is drawn (12 personnel, nickel), every credited player among them', () => {
  const off = ['qb1', 'rb1', 'te1', 'te2', 'wr1', 'wr2', 'ot1', 'ot2', 'og1', 'og2', 'c1']
  const offPos = ['QB', 'RB', 'TE', 'TE', 'WR', 'WR', 'OT', 'OT', 'OG', 'OG', 'C']
  const def = ['de1', 'de2', 'dt1', 'dt2', 'lb1', 'lb2', 'cb1', 'cb2', 'cb3', 's1', 's2']
  const defPos = ['DE', 'DE', 'DT', 'DT', 'LB', 'LB', 'CB', 'CB', 'CB', 'S', 'S']
  const A = off.map((id, i) => r6bPlayer(id, offPos[i], 75))
  const B = def.map((id, i) => r6bPlayer(id, defPos[i], 75))
  const world = { roster: { A, B }, players: [...A, ...B] } as unknown as World
  const play = { n: 4, type: 'run', concept: 'Inside Zone', offId: 'A', defId: 'B', startYard: 30, carrierId: 'rb1', qbId: 'qb1', tackleIds: ['cb3'], missedTackleIds: ['lb2'], onFieldOff: off, onFieldDef: def } as unknown as Play
  const m = recordedEleven(world, play, 'B')
  assert.ok(m, 'recorded personnel used')
  const ids = [...m!.values()].map((p) => p.id)
  assert.equal(ids.length, 22, `22 drawn: ${ids.length}`)
  assert.deepEqual([...ids].sort(), [...off, ...def].sort(), 'exactly the recorded 22')
  for (const id of creditedIds(play)) assert.ok(ids.includes(id), `credited ${id} drawn`)
  const keys = [...m!.keys()]
  for (const k of offenseKeys(play)) assert.ok(keys.includes(k), `offence dot ${k} filled`)
  assert.equal(m!.get('ol2')?.pos, 'C')
  assert.equal(m!.get('rb')?.id, 'rb1')
  assert.ok(['te', 'wr2'].includes([...m!.entries()].find(([, p]) => p.id === 'te2')![0]), 'second TE in the slot')
  assert.equal(recordedEleven(world, { ...play, onFieldOff: undefined } as unknown as Play, 'B'), null, 'old saves: depth chart')
  // Fatigue at the snap rides along aligned to the eleven.
  const fm = fatigueMap({ onFieldOff: off, onFieldDef: def, fatOn: [...off, ...def].map((_, i) => i) })
  assert.equal(fm.get('c1'), 0.1)
  assert.equal(fatigueMap({ onFieldOff: off, onFieldDef: def, fatOn: [1, 2] }).size, 0, 'misaligned record ignored')
})

ok('animflow r6b (item 5): the broken-tackle move follows the carrier\'s best skill; the tackle follows TAK / HPW; both are drawn', () => {
  const back = (o: Record<string, number>) => r6bPlayer(`rb-${JSON.stringify(o)}`, 'RB', 85, { JKM: 80, SPM: 74, SFA: 74, TRK: 77, ...o })
  for (let s = 0; s < 20; s++) {
    assert.equal(carrierMove(back({ JKM: 96 }), s), 'juke')
    assert.equal(carrierMove(back({ SPM: 92 }), s), 'spin')
    assert.equal(carrierMove(back({ SFA: 92 }), s), 'stiffArm')
    assert.equal(carrierMove(back({ TRK: 95 }), s), 'truck')
  }
  const mixed = new Set(Array.from({ length: 40 }, (_, s) => carrierMove(back({}), s)))
  assert.ok(mixed.size >= 3, `a balanced back mixes his moves: ${[...mixed]}`)
  // Tackles.
  const cb = r6bPlayer('cb-weak', 'CB', 74, { TAK: 48, HPW: 50 })
  const lb = r6bPlayer('lb-hit', 'LB', 88, { TAK: 85, HPW: 96 })
  const n = 60
  const arm = Array.from({ length: n }, (_, s) => tackleStyle(cb, { fromBehind: false, carrierSpeed: 5, tacklerSpeed: 5, seed: s })).filter((x) => x === 'arm').length
  const hit = Array.from({ length: n }, (_, s) => tackleStyle(lb, { fromBehind: false, carrierSpeed: 5, tacklerSpeed: 5, seed: s })).filter((x) => x === 'hit').length
  assert.ok(arm > n * 0.6, `a poor tackler mostly gets an arm on him: ${arm}/${n}`)
  assert.ok(hit > n * 0.5 && Array.from({ length: n }, (_, s) => tackleStyle(lb, { fromBehind: false, carrierSpeed: 5, tacklerSpeed: 5, seed: s })).every((x) => x !== 'arm'), `a big hitter lays hits: ${hit}/${n}`)
  assert.equal(tackleStyle(lb, { fromBehind: true, carrierSpeed: 6, tacklerSpeed: 6, seed: 1 }), 'dive', 'chase from behind: a dive at the legs')
  assert.equal(tackleStyle(undefined, { fromBehind: false, carrierSpeed: 5, tacklerSpeed: 5, seed: 1 }), 'wrap')
  // Drawn: a run with a recorded missed tackle — the carrier's move pose, the beaten man's reaction, a spin turns him round.
  const mk = (rb: Player) => {
    const anim = {
      duration: 5000,
      actors: [
        { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 30, y: 26.65 }, { t: 1, x: 29, y: 26.65 }] },
        { key: 'rb', side: 'off', role: 'RB', path: [{ t: 0, x: 28, y: 28 }, { t: 0.5, x: 36, y: 27 }, { t: 0.8, x: 42, y: 27 }, { t: 1, x: 44, y: 27 }] },
        { key: 'lb0', side: 'def', role: 'LB', path: [{ t: 0, x: 38, y: 22 }, { t: 0.5, x: 36.5, y: 26 }, { t: 1, x: 40, y: 26 }] },
        { key: 'lb1', side: 'def', role: 'LB', path: [{ t: 0, x: 44, y: 22 }, { t: 0.8, x: 42.5, y: 26.6 }, { t: 1, x: 44.5, y: 26.6 }] },
      ],
      ball: [{ t: 0, x: 30, y: 26.65 }, { t: 0.2, x: 30, y: 27 }, { t: 1, x: 44, y: 27 }],
      holders: [{ t: 0, key: null }, { t: 0.03, key: 'qb' }, { t: 0.2, key: 'rb' }],
      flights: [],
      engagements: [{ a: 'lb0', b: 'rb', t0: 0.46, t1: 0.52, kind: 'missedTackle' }, { a: 'lb1', b: 'rb', t0: 0.8, t1: 1, kind: 'tackle' }],
      events: [
        { t: 0.03, kind: 'snap', keys: ['ol2', 'qb'], spot: { x: 30, y: 26.65 } },
        { t: 0.5, kind: 'brokenTackle', keys: ['rb', 'lb0'], spot: { x: 36, y: 27 } },
        { t: 0.8, kind: 'contact', keys: ['rb', 'lb1'], spot: { x: 42, y: 27 } },
        { t: 1, kind: 'tackle', keys: ['lb1', 'rb'], spot: { x: 44, y: 27 } },
      ],
    } as unknown as BroadcastAnim
    const play = { n: 9, type: 'run', concept: 'Inside Zone', result: 'Rush', startYard: 18, endYard: 34, yards: 16, missedTackleIds: ['L0'], tackleIds: ['L1'] } as unknown as Play
    const actors = new Map<string, Player>([['rb', rb], ['lb0', r6bPlayer('L0', 'LB', 80)], ['lb1', r6bPlayer('L1', 'LB', 80, { TAK: 85, HPW: 70 })]])
    return presentAnim(anim, play, { actors })
  }
  for (const [o, move, react] of [[{ JKM: 97 }, 'juke', 'lunge'], [{ SPM: 95 }, 'spin', 'lunge'], [{ SFA: 95 }, 'stiffArm', 'stumble'], [{ TRK: 97 }, 'truck', 'fall']] as const) {
    const pa = mk(back(o))
    assert.ok(pa.poses.rb.some((w) => w.state === move && w.t0 <= 0.5 && w.t1 >= 0.5), `${move}: ${JSON.stringify(pa.poses.rb)}`)
    assert.ok(pa.poses.lb0.some((w) => w.state === react && w.t0 <= 0.5 && w.t1 >= 0.5), `${move} → beaten man ${react}: ${JSON.stringify(pa.poses.lb0)}`)
    assert.equal(pa.skill?.moves[0]?.move, move)
    if (move === 'spin') {
      const fw = pa.facing.rb.find((w) => w.mode === 'spin')
      assert.ok(fw && fw.t0 < 0.5 && fw.t1 > 0.5, 'a spin turns him round (facing)')
    }
  }
  assert.ok(mk(back({})).poses.lb1.some((w) => w.state === 'tackle'), 'an ordinary tackler wraps up')
})

ok('animflow r6b (item 4): tired men (sim fatigue at the snap) stand hands-on-hips after the whistle; fresh men do not', () => {
  assert.equal(tiredness(0.05), 0)
  assert.ok(tiredness(0.15) > 0.25 && tiredness(0.3) === 1)
  const anim = {
    duration: 4000,
    actors: [
      { key: 'qb', side: 'off', role: 'QB', path: [{ t: 0, x: 30, y: 26.65 }, { t: 0.2, x: 27, y: 26.65 }, { t: 1, x: 27, y: 26.65 }] },
      { key: 'wr0', side: 'off', role: 'WR', path: [{ t: 0, x: 30, y: 5 }, { t: 0.6, x: 45, y: 8 }, { t: 1, x: 45, y: 8 }] },
      { key: 'cb0', side: 'def', role: 'CB', path: [{ t: 0, x: 37, y: 5 }, { t: 0.6, x: 46, y: 8 }, { t: 1, x: 46, y: 8 }] },
    ],
    ball: [{ t: 0, x: 30, y: 26.65 }, { t: 0.2, x: 27, y: 26.65 }, { t: 0.4, x: 27, y: 26.65 }, { t: 0.6, x: 44, y: 8 }, { t: 1, x: 44, y: 8 }],
    holders: [{ t: 0, key: null }, { t: 0.03, key: 'qb' }, { t: 0.4, key: null }],
    flights: [{ t0: 0.4, t1: 0.6, height: 1 }],
    engagements: [],
    events: [{ t: 0.6, kind: 'incomplete', keys: ['wr0'], spot: { x: 44, y: 8 } }],
  } as unknown as BroadcastAnim
  const play = { n: 3, type: 'pass', concept: 'Curl', result: 'Incomplete', startYard: 20, endYard: 20, yards: 0 } as unknown as Play
  const actors = new Map<string, Player>([['qb', r6bPlayer('Q', 'QB', 80)], ['wr0', r6bPlayer('W', 'WR', 80)], ['cb0', r6bPlayer('C', 'CB', 80)]])
  const pa = presentAnim(anim, play, { actors, fat: new Map([['W', 0.2], ['C', 0.02], ['Q', 0.2]]) })
  assert.ok(pa.poses.wr0.some((w) => w.state === 'hips' && w.t0 >= 0.6 - 1e-6), `tired receiver: ${JSON.stringify(pa.poses.wr0)}`)
  assert.ok(!pa.poses.cb0.some((w) => w.state === 'hips'), 'fresh corner never')
  assert.ok(!pa.poses.wr0.some((w) => w.state === 'hips' && w.t1 <= 0.6 && w.t0 > 0.05), 'not during the play')
})

// animflow 6b-wx: weather on the field (indoors / off: nothing; rain / snow / cold / wind: drawn),
// the 2.5D camera keeps up with a fast carrier, and the stride rate follows ground speed.
{
  const wx = await import('../src/components/broadcast/weatherFx.ts')
  const base = { roof: 'open', closed: false, tempF: 45, windMph: 14, windAlong: 10, precip: 'rain', intensity: 0.8, loud: 0.5, altitude: 0 } as const
  ok('animflow 6b-wx: weather layer absent indoors / when off / with no weather, present in rain and snow (Lite fewer, reduced motion still)', () => {
    assert.equal(wx.fieldWeather(null, true), null)
    assert.equal(wx.fieldWeather(undefined, true), null)
    assert.equal(wx.fieldWeather({ ...base }, false), null, 'weather toggle off')
    assert.equal(wx.fieldWeather({ ...base, roof: 'dome', closed: true }, true), null, 'dome')
    assert.equal(wx.fieldWeather({ ...base, roof: 'retractable', closed: true }, true), null, 'roof closed')
    const cam = makeCamera(orbitPose({ focusX: 60, focusY: 26.65, back: 27, height: 14, yaw: 0, fovDeg: 34 }), VP)
    const info = { dpr: 1, width: VP.width, height: VP.height }
    const frame = {} as never
    const run = (w: ReturnType<typeof wx.fieldWeather>, o: { lite?: boolean; rm?: boolean; sec?: number } = {}) => {
      const L = new wx.WeatherLayer(null)
      L.weather = w
      L.quality = o.lite ? 'lite' : 'full'
      L.reducedMotion = !!o.rm
      L.sec = o.sec ?? 1.3
      const items: unknown[] = []
      L.ground(stubCtx(), cam, frame, info)
      L.items({ cam } as never, items as never)
      L.air(stubCtx(), cam, frame, info)
      return { ...L.stats, items: items.length }
    }
    const none = run(null)
    assert.ok(none.particles === 0 && !none.sheen && !none.veil && none.items === 0 && none.streamers === 0, `nothing indoors: ${JSON.stringify(none)}`)
    const dome = run(wx.fieldWeather({ ...base, roof: 'dome', closed: true }, true))
    assert.equal(dome.items + dome.particles, 0)
    const rain = run(wx.fieldWeather({ ...base }, true))
    assert.ok(rain.particles > 100 && rain.sheen, `rain: ${JSON.stringify(rain)}`)
    assert.ok(rain.streamers === 2, `streamers on the far posts' 2 uprights (the near posts are behind the lens): ${rain.streamers}`)
    const lite = run(wx.fieldWeather({ ...base }, true), { lite: true })
    assert.ok(lite.particles > 0 && lite.particles < rain.particles * 0.5, `Lite draws fewer: ${lite.particles} vs ${rain.particles}`)
    const rm = run(wx.fieldWeather({ ...base }, true), { rm: true })
    assert.ok(rm.particles === 0 && rm.veil && rm.sheen, 'reduced motion: a still veil, no moving particles')
    const snow = run(wx.fieldWeather({ ...base, precip: 'snow', tempF: 25 }, true))
    assert.ok(snow.particles > 40 && snow.sheen, `snow: ${JSON.stringify(snow)}`)
    const clear = run(wx.fieldWeather({ ...base, precip: 'none', intensity: 0 }, true))
    assert.ok(clear.particles === 0 && !clear.sheen && clear.streamers === 2, 'open air, dry: streamers only')
    // Wind: the home club attacks +x on screen; the sim's headwind for the home offence is
    // windAlong in odd quarters, -windAlong in even ones — so it blows toward -x in Q1.
    const fw = wx.fieldWeather({ ...base }, true)!
    assert.ok(wx.worldWind(fw, 1).x < 0 && wx.worldWind(fw, 2).x > 0 && near(Math.hypot(wx.worldWind(fw, 3).x, wx.worldWind(fw, 3).y), 14, 1e-9), 'wind flips with the quarter, total speed kept')
    // Breath: cold air, visible men.
    const al = new ActorLayer()
    for (let i = 0; i < 8; i++) al.screen.set(`p${i}`, { key: `p${i}`, side: 'off', role: 'WR', x: 100 + i * 60, y: 500, headX: 100 + i * 60, headY: 440, top: 430, depth: 30, scale: 40, pose: 'run', holder: false } as never)
    let breath = 0
    let warm = 0
    for (let sec = 0; sec < 2; sec += 0.25) {
      const L = new wx.WeatherLayer(al)
      L.weather = wx.fieldWeather({ ...base, precip: 'none', intensity: 0, tempF: 20 }, true)
      L.sec = sec
      L.air(stubCtx(), cam, frame, info)
      breath += L.stats.breath
      L.weather = wx.fieldWeather({ ...base, precip: 'none', intensity: 0, tempF: 65 }, true)
      L.air(stubCtx(), cam, frame, info)
      warm += L.stats.breath
    }
    assert.ok(breath > 8 && warm === 0, `breath in the cold only: ${breath} / warm ${warm}`)
  })

  ok('animflow 6b-wx: stride rate follows ground speed (~2 steps/s walking, ~3 jogging, ~4.3 sprinting)', () => {
    const cad = (v: number) => v / cycleLength(v) // cycles (two steps) per second
    let prev = 0
    for (let v = 1; v <= 10.5; v += 0.5) {
      assert.ok(cad(v) > prev, `cadence rises with speed at ${v}`)
      prev = cad(v)
    }
    assert.ok(cad(2) >= 0.8 && cad(2) <= 1.2, `walk 2 yd/s: ${cad(2).toFixed(2)}`)
    assert.ok(cad(4) >= 1.3 && cad(4) <= 1.8, `jog 4 yd/s: ${cad(4).toFixed(2)}`)
    for (const v of [8, 9, 10]) assert.ok(cad(v) >= 1.9 && cad(v) <= 2.5, `sprint ${v} yd/s: ${cad(v).toFixed(2)} cycles/s`)
    // The actor layer's run-cycle phase advances at that rate (SYN rb: 10 yd/s).
    const l = new ActorLayer()
    l.setPlay({ anim: SYN, offClub: NFL_TEAMS[0], defClub: NFL_TEAMS[1], offHome: true })
    const a = l.sampleOf('rb', 0.3)!
    const b = l.sampleOf('rb', 0.5)!
    const rate = (b.ph - a.ph) / (2 * Math.PI) / (0.2 * 4)
    assert.ok(near(rate, cad(10), 0.05 * cad(10)), `layer cadence ${rate.toFixed(2)} vs ${cad(10).toFixed(2)}`)
  })

  const { fileURLToPath } = await import('node:url')
  const repo = fileURLToPath(new URL('..', import.meta.url))
  const rj = (n: string) => JSON.parse(readFileSync(`${repo}public/data/${n}.json`, 'utf8'))
  ;(await import('../src/game/data/realData.ts')).setRealData({ nfl: rj('madden26').players, cfb: rj('cfb26').teams, source: { madden: 'local', cfb: 'local' } })
  ;(await import('../src/game/data/calibration.ts')).setCalibration(rj('calibration'))
  const store = await import('../src/store/gameStore.ts')
  const { simulatePlayByPlay } = await import('../src/game/engine/playsim.ts')
  const { buildPlayAnim, holderAt, posAt, snapKindFor, clockStepOut } = await import('../src/components/playAnim.ts')
  const { actorPlayers } = await import('../src/components/jersey.ts')
  const { createBroadcastDirector } = await import('../src/components/broadcast/directorRules.ts')
  const { FAST_SPAN_MAX } = await import('../src/components/broadcast/director.ts')
  ok('animflow 6b-wx: the live camera keeps up with a fast carrier (lag bound) and holds the follow scale (harness plays)', () => {
    store.useGame.getState().startCareer({ name: 'C', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const lags: number[] = []
    const spans: number[] = []
    let worst = ''
    let worstLag = -Infinity
    // animflow r6d: sample whole games until the coverage is reached (any sim stream: J12/J6 changed how
    // many fast-carrier frames two games hold), at most 6 games.
    for (let g = 0; g < 6 && lags.length < 2000; g++) {
      const home = nfl[2 * g].id
      const away = nfl[2 * g + 1].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 13 + g * 101)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if (!['run', 'pass', 'kickoff', 'punt'].includes(play.type)) continue
        const other = play.offId === home ? away : home
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors: actorPlayers(world, play, other, null) })
        const d = createBroadcastDirector({ profile: 'live', viewport: { w: 1280, h: 720 }, bottomClearPx: 48 })
        d.reset(play, anim)
        const D = anim.duration / 1000
        const n = Math.ceil(D * 60)
        for (let j = 0; j < n; j++) {
          const t = j / n
          const key = holderAt(anim, t)
          if (!key || (key === 'qb' && play.type === 'pass')) continue
          const fl = anim.flights?.[0]
          if ((play.type === 'kickoff' || play.type === 'punt') && fl && t < fl.t1) continue
          const a = anim.actors.find((x) => x.key === key)
          if (!a) continue
          const p0 = posAt(a.path, t)
          const p1 = posAt(a.path, (j + 1) / n)
          const v = Math.hypot(p1.x - p0.x, p1.y - p0.y) * 60
          if (v < 6) continue
          const shot = d.shotAt(t)
          // Before the contact, outside the goal-line / sideline framings (those park on a line by design).
          if (shot.kind !== 'follow' || shot.rule === 'goalLine' || shot.rule === 'sideline') continue
          // animflow r6c2: inside the goal-line framing zone (directorRules goalLine: carrier within 8 of a
          // goal) the frame holds the goal line by design even when keepCarrier is the last rule applied; a
          // score is now run through the line at speed instead of stopping on it.
          if (p0.x >= 102 || p0.x <= 18) continue
          const lag = ((p0.x - shot.cx) * (p1.x - p0.x) + (p0.y - shot.cy) * (p1.y - p0.y)) * 60 / v
          lags.push(lag)
          spans.push(shot.span)
          if (lag > worstLag) {
            worstLag = lag
            worst = `game ${g} play ${i} ${play.concept} t ${t.toFixed(3)} lag ${lag.toFixed(1)} yd (rule ${shot.rule})`
          }
        }
      }
    }
    lags.sort((x, y) => x - y)
    spans.sort((x, y) => x - y)
    const p95 = lags[Math.floor(lags.length * 0.95)]
    assert.ok(lags.length > 1500, `coverage ${lags.length} fast follow frames`)
    assert.ok(p95 <= 2.5, `camera trails a fast carrier by ${p95.toFixed(2)} yd p95 (bound 2.5)`)
    assert.ok(worstLag <= 4.5, `worst trail ${worst}`)
    const spanMed = spans[Math.floor(spans.length / 2)]
    assert.ok(spanMed <= FAST_SPAN_MAX + 4, `fast-carrier follow span median ${spanMed.toFixed(1)} yd`)
  })

  ok('animflow 6c: a credited sacker / pressure rusher / run tackler off a block visibly beats it (move recorded, clear of him before contact); other rushers stay engaged, no teleports', () => {
    store.useGame.getState().startCareer({ name: 'S', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const BLK = new Set(['block', 'double', 'chip'])
    let sacks = 0
    let runs = 0
    let rushers = 0
    const bad: string[] = []
    for (let g = 0; g < 6; g++) {
      const home = nfl[(g * 5) % nfl.length].id
      const away = nfl[(g * 5 + 2) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 29 + g * 131)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if (play.type !== 'pass' && play.type !== 'run') continue
        const other = play.offId === home ? away : home
        const actors = actorPlayers(world, play, other, null)
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors })
        const D = anim.duration / 1000
        const keyOf = (id?: string) => (id ? [...actors.entries()].find(([, p]) => p.id === id)?.[0] : undefined)
        const A = new Map(anim.actors.map((a) => [a.key, a]))
        const engs = (anim.engagements ?? []).filter((e) => BLK.has(e.kind))
        const ev = (k: string) => (anim.events ?? []).find((e) => e.kind === k)
        let key: string | undefined
        let tC: number | undefined
        let minFree = 0
        if (play.type === 'pass' && play.result.startsWith('Sack')) { key = keyOf(play.sackId); tC = ev('sack')?.t; minFree = 0.6 }
        else if (play.type === 'pass' && (play.pressureType === 'hit' || play.pressureType === 'hurry')) { key = keyOf(play.pressureId); tC = ev('throw')?.t; minFree = -0.15 } // a hurry on a quick throw: he wins as the ball leaves
        else if (play.type === 'run') {
          const te = ev('tackle')
          key = keyOf(play.tackleIds?.[0])
          if (!key || !/^dl/.test(key) || !te || Math.abs(te.spot.x - (10 + play.startYard)) > 3) key = undefined
          const c = (anim.events ?? []).find((e) => e.kind === 'contact' && e.keys[1] === key)
          tC = c?.t ?? te?.t
          minFree = 0.3
        }
        if (key && tC != null) {
          const mine = engs.filter((e) => (e.a === key || e.b === key) && e.t0 < tC!)
          if (mine.length) {
            const last = Math.max(...mine.map((e) => e.t1))
            const free = (tC - last) * D
            const sh = (anim.sheds ?? []).find((x) => x.def === key)
            if (play.type === 'pass' && play.result.startsWith('Sack')) sacks++
            if (play.type === 'run') runs++
            if (!sh) bad.push(`play ${i} ${play.type} ${key}: no shed move recorded`)
            else if (free < minFree - 1e-6) bad.push(`play ${i} ${play.type} ${key}: still on his block ${free.toFixed(2)} s before contact (min ${minFree})`)
            else if (sh.t0 > last + 0.05 / D) bad.push(`play ${i} ${play.type} ${key}: shed move after the block ended`)
          }
        }
        if (play.type === 'pass') {
          for (const r of ['dl0', 'dl1', 'dl2', 'dl3']) {
            const a = A.get(r)
            if (!a || r === key) continue
            rushers++
            let mx = 0
            for (let s = 0.2; s < D - 0.05; s += 0.05) {
              const p = posAt(a.path, s / D)
              const q = posAt(a.path, (s + 0.05) / D)
              mx = Math.max(mx, Math.hypot(q.x - p.x, q.y - p.y) / 0.05)
            }
            if (mx > 12) bad.push(`play ${i} ${r}: ${mx.toFixed(1)} yd/s jump (teleport)`)
          }
        }
      }
    }
    assert.ok(sacks >= 8 && runs >= 10 && rushers > 500, `coverage: ${sacks} engaged sacks, ${runs} DL run stops, ${rushers} rushers`)
    assert.ok(bad.length === 0, `${bad.length} bad sheds: ${bad.slice(0, 4).join('; ')}`)
  })

  ok('animflow 6c (297): a long run / catch-and-run ends with a defender on the carrier (credited tackler when he can get there), never the carrier stopping alone; a score is run through the goal line at speed', () => {
    store.useGame.getState().startCareer({ name: 'B', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    let tackles = 0
    let alone = 0
    let cred = 0
    let tds = 0
    let slowTd = 0
    const bad: string[] = []
    for (let g = 0; g < 8; g++) {
      const home = nfl[(g * 3) % nfl.length].id
      const away = nfl[(g * 3 + 1) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 71 + g * 977)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if ((play.type !== 'pass' && play.type !== 'run') || play.result.startsWith('Sack')) continue
        const other = play.offId === home ? away : home
        const actors = actorPlayers(world, play, other, null)
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors })
        const D = anim.duration / 1000
        const ev = anim.events ?? []
        const end = ev.find((e) => e.kind === 'tackle' || e.kind === 'score')
        if (!end) continue
        const carrier = end.kind === 'tackle' ? end.keys[1] : end.keys[0]
        const A = new Map(anim.actors.map((a) => [a.key, a]))
        const ca = A.get(carrier)
        if (!ca) continue
        const from = play.type === 'pass' ? ev.find((e) => e.kind === 'catch')?.t : anim.holders.find((h) => h.key === carrier)?.t
        if (from == null) continue
        if (posAt(ca.path, end.t).x - posAt(ca.path, from).x < 10) continue
        const cp = posAt(ca.path, end.t)
        if (end.kind === 'tackle') {
          tackles++
          const near = Math.min(...anim.actors.filter((a) => a.side === 'def').map((a) => { const q = posAt(a.path, end.t); return Math.hypot(q.x - cp.x, q.y - cp.y) }))
          if (near > 1.5) { alone++; bad.push(`play ${i} ${play.concept}: nearest defender ${near.toFixed(1)} yd at the tackle`) }
          const ck = play.tackleIds?.[0] ? [...actors.entries()].find(([, pl]) => pl.id === play.tackleIds![0])?.[0] : undefined
          if (!ck || end.keys[0] === ck) cred++
        } else {
          tds++
          const a = posAt(ca.path, Math.max(0, end.t - 0.1 / D))
          const v = Math.hypot(cp.x - a.x, cp.y - a.y) / 0.1
          if (v < 4) { slowTd++; bad.push(`play ${i} ${play.concept}: crosses the goal line at ${v.toFixed(1)} yd/s`) }
        }
      }
    }
    assert.ok(tackles >= 40 && tds >= 5, `coverage: ${tackles} long tackles, ${tds} long scores`)
    assert.ok(alone / tackles <= 0.01, `${alone}/${tackles} long plays end with nobody on the carrier: ${bad.slice(0, 3).join('; ')}`)
    assert.ok(cred / tackles >= 0.7, `drawn tackler is the credited man on ${cred}/${tackles}`)
    assert.ok(slowTd === 0, `${slowTd} scores stop on the line: ${bad.filter((b) => /goal/.test(b)).slice(0, 3).join('; ')}`)
  })

  ok('animflow 6c (302): crossers / slants / verticals are caught in stride (moving >= 3 yd/s at the catch); stop routes may be caught standing', () => {
    store.useGame.getState().startCareer({ name: 'R', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const CROSS = /^(slant|quickSlant|cross|drag|shallow|meshIn|dig|in|whip|glance|angle|go|post|seam|corner|over|wheel|sluggo|chair|postCorner|outUp)$/
    let n = 0
    let moving = 0
    for (let g = 0; g < 6; g++) {
      const home = nfl[(g * 7) % nfl.length].id
      const away = nfl[(g * 7 + 4) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 53 + g * 211)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if (play.type !== 'pass' || play.result.startsWith('Sack')) continue
        const other = play.offId === home ? away : home
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors: actorPlayers(world, play, other, null) })
        const c = (anim.events ?? []).find((e) => e.kind === 'catch')
        if (!c || !CROSS.test(anim.catchRoute ?? '')) continue
        const a = anim.actors.find((x) => x.key === c.keys[0])
        if (!a) continue
        const D = anim.duration / 1000
        const p0 = posAt(a.path, Math.max(0, c.t - 0.05 / D))
        const p1 = posAt(a.path, Math.min(1, c.t + 0.05 / D))
        n++
        if (Math.hypot(p1.x - p0.x, p1.y - p0.y) / 0.1 >= 3) moving++
      }
    }
    assert.ok(n >= 60, `coverage: ${n} crossing / vertical catches`)
    assert.ok(moving / n >= 0.7, `only ${moving}/${n} crossing / vertical catches made in stride`)
  })

  ok('animflow 6c (295): the snap follows the play\'s formation — shotgun 5 yd, pistol 4, under centre at the ball with a real 3/5/7-step drop and a reverse-pivot handoff', () => {
    store.useGame.getState().startCareer({ name: 'U', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const seen: Record<string, number> = {}
    const bad: string[] = []
    for (let g = 0; g < 4; g++) {
      const home = nfl[(g * 9) % nfl.length].id
      const away = nfl[(g * 9 + 5) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 17 + g * 389)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if ((play.type !== 'pass' && play.type !== 'run') || play.result.startsWith('Sack')) continue
        const other = play.offId === home ? away : home
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors: actorPlayers(world, play, other, null) })
        const q = anim.actors.find((a) => a.key === 'qb')
        if (!q) continue
        // animflow r8 (J38): a wildcat snaps to the back in the gun spot, the QB split out (r8 check).
        if (play.featured === 'wildcat' && play.type === 'run') continue
        const los = 10 + play.startYard
        const kind = snapKindFor(play.concept)
        const depth = los - q.path[0].x
        seen[`${play.type}:${kind}`] = (seen[`${play.type}:${kind}`] ?? 0) + 1
        const want = kind === 'under' ? 1.0 : kind === 'pistol' ? 4 : 5
        if (Math.abs(depth - want) > 0.05) bad.push(`play ${i} ${play.concept}: QB ${depth.toFixed(1)} yd deep (${kind})`)
        const th = (anim.events ?? []).find((e) => e.kind === 'throw')
        // animflow r6d: a spike is thrown into the turf off the snap (no drop).
        if (play.type === 'pass' && kind === 'under' && th && !play.spike) {
          let deep = 0
          for (let t = 0; t <= th.t; t += 0.01) deep = Math.max(deep, los - posAt(q.path, t).x)
          if (deep < 4.5) bad.push(`play ${i} ${play.concept}: under-centre drop only ${deep.toFixed(1)} yd`)
        }
      }
    }
    assert.ok((seen['pass:under'] ?? 0) >= 10 && (seen['run:under'] ?? 0) >= 20 && (seen['run:pistol'] ?? 0) >= 5 && (seen['pass:gun'] ?? 0) >= 50, `coverage ${JSON.stringify(seen)}`)
    assert.ok(bad.length === 0, `${bad.length} bad snaps: ${bad.slice(0, 4).join('; ')}`)
  })

  ok('animflow 6c (J7): the recorded cover defender stands the recorded separation (separationYd) off the target at the catch', () => {
    store.useGame.getState().startCareer({ name: 'J', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const errs: number[] = []
    for (let g = 0; g < 4; g++) {
      const home = nfl[(g * 11) % nfl.length].id
      const away = nfl[(g * 11 + 3) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 41 + g * 613)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if (play.type !== 'pass' || play.separationYd == null || !play.coverId || play.result.startsWith('Sack')) continue
        const other = play.offId === home ? away : home
        const actors = actorPlayers(world, play, other, null)
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors })
        const c = (anim.events ?? []).find((e) => e.kind === 'catch')
        const ck = [...actors.entries()].find(([, p]) => p.id === play.coverId)?.[0]
        const a = c && anim.actors.find((x) => x.key === c.keys[0])
        const d = ck && anim.actors.find((x) => x.key === ck)
        if (!c || !a || !d) continue
        const p = posAt(a.path, c.t)
        const q = posAt(d.path, c.t)
        errs.push(Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - Math.min(12, Math.max(0.6, play.separationYd))))
      }
    }
    errs.sort((x, y) => x - y)
    assert.ok(errs.length >= 80, `coverage: ${errs.length} catches with a separation`)
    const p75 = errs[Math.floor(errs.length * 0.75)]
    assert.ok(p75 <= 0.5, `drawn separation off the recorded one by ${p75.toFixed(2)} yd p75`)
  })

  // ── animflow r6d ────────────────────────────────────────────────────────────
  const { poseAt: poseAt6d } = await import('../src/components/broadcast/animData.ts')
  const { planOf } = await import('../src/components/jersey.ts')
  const games6d = (games: number, seedOff: number, fn: (play: Play, anim: BroadcastAnim, actors: Map<string, Player>) => void) => {
    store.useGame.getState().startCareer({ name: 'R', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    for (let g = 0; g < games; g++) {
      const home = nfl[(g * 7) % nfl.length].id
      const away = nfl[(g * 7 + 5) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + seedOff + g * 389)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if (play.type !== 'pass' && play.type !== 'run') continue
        const other = play.offId === home ? away : home
        const actors = actorPlayers(world, play, other, null)
        fn(play, buildPlayAnim(play, { next: sim.plays[i + 1], actors }), actors)
      }
    }
  }
  const atSec = (anim: BroadcastAnim, key: string, sec: number) => {
    const a = anim.actors.find((x) => x.key === key)
    return a ? posAt(a.path, Math.min(1, (sec * 1000) / anim.duration)) : null
  }

  ok('animflow 7a: no weaving — after the line (runs, QB keepers, catch-and-runs) or the catch (returns) the carrier\'s lateral velocity changes sign at most once on >= 90% of carries (median <= 1, never > 3)', () => {
    store.useGame.getState().startCareer({ name: 'W', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const rev: Record<string, number[]> = { run: [], yac: [], ret: [] }
    const bad: string[] = []
    const DT = 0.05
    for (let g = 0; g < 6; g++) {
      const home = nfl[(g * 5 + 1) % nfl.length].id
      const away = nfl[(g * 5 + 3) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 61 + g * 433)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        const ret = (play.type === 'kickoff' || play.type === 'punt') && play.returnKind === 'return' && !!play.returnerId
        if (!ret && play.type !== 'run' && (play.type !== 'pass' || play.result !== 'Complete' || play.turnover)) continue
        const other = play.offId === home ? away : home
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors: actorPlayers(world, play, other, null) })
        const D = anim.duration / 1000
        const ev = anim.events ?? []
        const holder = anim.holders.filter((h) => h.key).at(-1)
        if (!holder?.key) continue
        const a = anim.actors.find((x) => x.key === holder.key)
        if (!a) continue
        const endE = ev.find((e) => ['tackle', 'outOfBounds', 'score', 'safety', 'down', 'fumble'].includes(e.kind) && e.t > holder.t)
        let s0 = holder.t * D + (ret ? 0.3 : 0)
        if (!ret) {
          const los = 10 + play.startYard
          while (s0 < D && posAt(a.path, s0 / D).x <= los + 0.3) s0 += DT
        }
        const contact = ev.find((e) => e.kind === 'contact' && e.t * D > s0)
        const s1 = Math.min(endE ? endE.t * D : D, contact ? contact.t * D + 0.1 : D)
        if (s1 - s0 < 0.6) continue
        let n = 0
        let last = 0
        let prev = posAt(a.path, s0 / D)
        for (let s = s0 + DT; s <= s1 + 1e-9; s += DT) {
          const p = posAt(a.path, s / D)
          const vy = (p.y - prev.y) / DT
          prev = p
          if (Math.abs(vy) <= 0.5) continue
          const sg = Math.sign(vy)
          if (last && sg !== last) n++
          last = sg
        }
        const k = ret ? 'ret' : play.type === 'run' ? 'run' : 'yac'
        rev[k].push(n)
        if (n > 3) bad.push(`play ${i} ${play.concept} (${k}): ${n} lateral reversals`)
      }
    }
    for (const [k, v] of Object.entries(rev)) {
      const le1 = v.filter((x) => x <= 1).length / Math.max(1, v.length)
      const med = [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] ?? 0
      assert.ok(v.length >= (k === 'ret' ? 25 : 60), `coverage: ${v.length} ${k} carries`)
      assert.ok(le1 >= 0.9 && med <= 1, `${k}: only ${(le1 * 100).toFixed(0)}% of carries reverse laterally <= 1 time (median ${med})`)
    }
    assert.ok(bad.length === 0, `${bad.length} weaving carries: ${bad.slice(0, 4).join('; ')}`)
  })

  ok('animflow 6d (J6): a kneel is a victory formation and the QB ends on a knee at the spot; a spike goes into the turf off the snap; a carrier out of bounds crosses the sideline', () => {
    let kneels = 0
    let spikes = 0
    let oob = 0
    let crossed = 0
    const bad: string[] = []
    games6d(8, 59, (play, anim) => {
      if (play.kneel) {
        kneels++
        const q = atSec(anim, 'qb', anim.duration / 1000)!
        if (Math.abs(q.x - (10 + play.endYard)) > 1e-3) bad.push(`kneel ${play.n} ends at ${q.x.toFixed(1)}`)
        if (poseAt6d(anim, 'qb', 0.98) !== 'hold') bad.push(`kneel ${play.n} QB not on a knee`)
        const rb = atSec(anim, 'rb', 0)!
        if (10 + play.startYard - rb.x < 6) bad.push(`kneel ${play.n} no deep back`)
      }
      if (play.spike) {
        spikes++
        const kinds = (anim.events ?? []).map((e) => e.kind).join(',')
        if (kinds !== 'snap,throw,incomplete') bad.push(`spike ${play.n} events ${kinds}`)
        const th = (anim.events ?? []).find((e) => e.kind === 'throw')
        if (th && th.t * anim.duration / 1000 > 0.8) bad.push(`spike ${play.n} thrown late`)
      }
      if (play.outOfBounds && (play.type === 'run' || play.reception) && !play.turnover && play.endYard < 100) {
        const key = anim.holders[anim.holders.length - 1]?.key
        const e = key ? atSec(anim, key, anim.duration / 1000) : null
        if (!e) return
        oob++
        if (e.y < 0 || e.y > FIELD_WIDTH) crossed++
      }
    })
    assert.ok(kneels >= 3 && oob >= 30, `coverage: ${kneels} kneels, ${spikes} spikes, ${oob} out of bounds`)
    assert.ok(!bad.length, bad.slice(0, 4).join('; '))
    assert.ok(crossed / oob >= 0.95, `only ${crossed}/${oob} out-of-bounds carriers cross the sideline`)
  })

  ok('animflow 6d (J12 / J8a-2): a disguised shell changes at the snap (an honest one mostly does not), DOUBLE shows two blockers, the spy mirrors the QB; the alley filler comes downhill and the read key beats the biters to the ball', () => {
    const shell = { disg: 0, disgN: 0, hon: 0, honN: 0 }
    const dbl = { y: 0, n: 0 }
    const spyOff: number[] = []
    const fillDown: number[] = []
    const otherDown: number[] = []
    const keyD: number[] = []
    const biteD: number[] = []
    games6d(6, 77, (play, anim, actors) => {
      const los = 10 + play.startYard
      if (play.type === 'pass' && !play.result.startsWith('Sack') && !play.spike) {
        const deep = (sec: number) => ['s0', 's1'].filter((k) => (atSec(anim, k, sec)?.x ?? 0) - los >= 10).length
        const changed = deep(0) !== deep(1.75)
        if (play.disguised) { shell.disgN++; if (changed) shell.disg++ } else { shell.honN++; if (changed) shell.hon++ }
        const plan = planOf(actors)
        if (plan?.off === 'doubleRusher') { dbl.n++; if ((anim.engagements ?? []).some((e) => e.kind === 'double')) dbl.y++ }
        if (plan?.def === 'spyQB') {
          const q = atSec(anim, 'qb', 1.5)!
          spyOff.push(Math.min(...['lb0', 'lb1', 'lb2'].map((k) => { const p = atSec(anim, k, 1.5); return p && p.x - q.x > 3 ? Math.abs(p.y - q.y) : 99 })))
        }
      }
      if (play.type === 'run' && play.fillId && !play.kneel) {
        const fk = [...actors.entries()].find(([, p]) => p.id === play.fillId)?.[0]
        for (const k of ['s0', 's1']) {
          const a = atSec(anim, k, 0)!
          const b = atSec(anim, k, 1.2)!
          ;(k === fk ? fillDown : otherDown).push(a.x - b.x)
        }
        const keyOfId = (id?: string) => [...actors.entries()].find(([, p]) => p.id === id)?.[0]
        const car = anim.holders[anim.holders.length - 1]?.key
        const c = car ? atSec(anim, car, 1.0) : null
        const rk = keyOfId(play.readKeyId)
        const bites = new Set((play.biteIds ?? []).map(keyOfId))
        for (const k of ['lb0', 'lb1', 'lb2']) {
          const p = atSec(anim, k, 1.0)
          if (!c || !p) continue
          if (k === rk) keyD.push(Math.hypot(p.x - c.x, p.y - c.y))
          else if (bites.has(k)) biteD.push(Math.hypot(p.x - c.x, p.y - c.y))
        }
      }
    })
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
    assert.ok(shell.disgN >= 40 && shell.disg / shell.disgN >= 0.7, `disguised shells that change at the snap ${shell.disg}/${shell.disgN}`)
    assert.ok(shell.hon / shell.honN <= 0.3, `honest shells that change at the snap ${shell.hon}/${shell.honN}`)
    assert.ok(dbl.n >= 5 && dbl.y / dbl.n >= 0.85, `DOUBLE shown ${dbl.y}/${dbl.n}`)
    assert.ok(spyOff.length >= 5 && med(spyOff) <= 1.5, `spy lateral offset from the QB median ${med(spyOff)?.toFixed(2)} yd (n ${spyOff.length})`)
    assert.ok(keyD.length >= 20 && biteD.length >= 10 && med(keyD) < med(biteD) - 1, `read key ${med(keyD)?.toFixed(2)} vs biters ${med(biteD)?.toFixed(2)} yd from the carrier at 1.0 s`)
    assert.ok(fillDown.length >= 40 && med(fillDown) >= 1 && med(fillDown) > med(otherDown) + 1, `alley filler downhill ${med(fillDown)?.toFixed(2)} vs ${med(otherDown)?.toFixed(2)} yd at 1.2 s`)
  })

  ok('animflow r8 (a): routes at route speed and smooth - stems near top speed (cruise >= 0.85 x top, median incl. the launch >= 0.75; the stem runs to where he sinks into the break), >= 80% of stem frames in the sprint gait, a fast launch (>= 0.6 x top 1.0 s after the snap), WR play-max in the NFL band, no stop-and-go on routes; catch-and-runs turn downfield at once (>= 60% of the velocity downfield 0.5 s after the catch, YAC >= 3)', () => {
    const ratio: number[] = []
    const peak: number[] = []
    const mx: number[] = []
    const launch: number[] = []
    let spr = 0
    let all = 0
    let routes = 0
    let stopGo = 0
    const sgBad: string[] = []
    const ns = [0, 0]
    const nsBad: string[] = []
    games6d(4, 19, (play, anim, actors) => {
      if (play.type !== 'pass' || play.result.startsWith('Sack') || play.spike) return
      const D = anim.duration / 1000
      const ev = anim.events ?? []
      const th = ev.find((e) => e.kind === 'throw')
      if (!th) return
      const tc = ev.find((e) => e.kind === 'catch' || e.kind === 'incomplete' || e.kind === 'interception')
      const tgt = tc?.keys?.[0]
      for (const k of ['wr0', 'wr1', 'wr2', 'te', 'rb']) {
        const a = anim.actors.find((x) => x.key === k)
        if (!a) continue
        const top = paceFor(actors.get(k), a.role).top
        const sp = (s: number) => { const p0 = posAt(a.path, Math.max(0, s - 0.05) / D); const p1 = posAt(a.path, Math.min(D, s + 0.05) / D); return { v: Math.hypot(p1.x - p0.x, p1.y - p0.y) / 0.1, vx: (p1.x - p0.x) / 0.1 } }
        if (posAt(a.path, th.t).x - posAt(a.path, 0).x < 4) continue
        // smoothness: no stop-and-go between snap + 0.3 s and the throw (+0.4 s for a non-target)
        routes++
        const tEnd = Math.min(D - 0.1, th.t * D + (k === tgt ? 0 : 0.4))
        let low = false
        let sg = false
        for (let s = 0.44; s <= tEnd; s += 0.05) { const v = sp(s).v; if (v < 1.5) low = true; else if (low && v > 3) sg = true }
        if (sg) { stopGo++; if (sgBad.length < 4) sgBad.push(`${play.n} ${play.concept} ${k}`) }
        if (!k.startsWith('wr')) continue
        const vs: number[] = []
        let best = 0
        for (let s = 0.3; s <= th.t * D; s += 0.05) {
          const q = sp(s)
          best = Math.max(best, q.v)
          // the stem ends where he starts to sink into the break (speed 15% off his best)
          if (s > 0.9 && q.v < 0.85 * best) break
          if (s >= 0.9 && q.vx >= 2) vs.push(q.v)
        }
        let m2 = 0
        for (let s = 0.2; s < D - 0.05; s += 0.05) m2 = Math.max(m2, sp(s).v)
        mx.push(m2)
        launch.push(sp(1.14).v / top)
        if (vs.length < 4) continue
        vs.sort((x, y) => x - y)
        ratio.push(vs[Math.floor(vs.length / 2)] / top)
        // the stem's cruise: a stem >= 1.4 s long reaches its pace before the brake into the break
        if (vs.length >= 10) peak.push(vs[vs.length - 1] / top)
        for (const v of vs) { all++; if (v >= 6) spr++ }
      }
      // north-south after the catch (in-bounds catch-and-runs: an out-of-bounds one is driven to the
      // sideline by the push - its own check)
      if (tc?.kind === 'catch' && !play.turnover && !play.outOfBounds) {
        const ca = anim.actors.find((x) => x.key === tgt)
        const end = ca ? posAt(ca.path, 1) : null
        if (ca && end && end.x - tc.spot.x >= 3) {
          const s = tc.t * D + 0.5
          const p0 = posAt(ca.path, (s - 0.05) / D)
          const p1 = posAt(ca.path, Math.min(D, s + 0.05) / D)
          const vl = Math.hypot(p1.x - p0.x, p1.y - p0.y)
          ns[1]++
          if (vl > 1e-6 && (p1.x - p0.x) / vl >= 0.6) ns[0]++
          else if (nsBad.length < 4) nsBad.push(`${play.n} ${play.concept} ${anim.catchRoute}`)
        }
      }
    })
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
    console.log(`      stems n ${ratio.length}: median ${med(ratio).toFixed(2)} x top, cruise ${med(peak).toFixed(2)} (n ${peak.length}), sprint gait ${(100 * spr / all).toFixed(1)}%, launch ${med(launch).toFixed(2)}, WR max p50 ${med(mx).toFixed(2)} yd/s; stop-and-go ${stopGo}/${routes}; north-south ${ns[0]}/${ns[1]}`)
    assert.ok(ratio.length >= 150 && peak.length >= 60, `coverage ${ratio.length} / ${peak.length}`)
    assert.ok(med(peak) >= 0.85, `stem cruise ${med(peak).toFixed(2)} x top`)
    assert.ok(med(ratio) >= 0.75, `stem median ${med(ratio).toFixed(2)} x top`)
    assert.ok(spr / all >= 0.8, `sprint-gait share of stem frames ${(100 * spr / all).toFixed(1)}%`)
    assert.ok(med(mx) >= 7.8 && med(mx) <= 9.6, `WR play-max p50 ${med(mx).toFixed(2)} yd/s`)
    assert.ok(med(launch) >= 0.6, `WR speed at snap + 1.0 s ${med(launch).toFixed(2)} x top`)
    assert.ok(stopGo <= routes * 0.03, `stop-and-go on ${stopGo}/${routes} routes: ${sgBad.join('; ')}`)
    assert.ok(ns[1] >= 30 && ns[0] >= ns[1] * 0.95, `catch-and-runs turning downfield ${ns[0]}/${ns[1]}: ${nsBad.join('; ')}`)
  })

  ok('animflow r8 (b): a tackle is a motion, not a touch and a freeze - the tackler is on the carrier (<= 1.3 yd) >= 0.25 s before the whistle (or dives at his legs), both bodies are going down as it ends and down on the spot at the end, the tackler within 1.5 yd; tackle variants drawn (wrap / hit / arm / dive / gang)', () => {
    let n = 0
    let late = 0
    let upright = 0
    let far = 0
    const styles: Record<string, number> = {}
    let gang = 0
    const bad: string[] = []
    const FALLING = new Set(['tackleFall', 'dive', 'fall', 'down'])
    games6d(6, 47, (play, anim) => {
      const ev = anim.events ?? []
      const end = ev.find((e) => e.kind === 'tackle' || e.kind === 'sack')
      if (!end || ev.some((e) => e.kind === 'fumble' || e.kind === 'interception')) return
      const car = end.keys[1]
      const tk = Object.keys(anim.skill?.tackles ?? {})[0] ?? end.keys[0]
      if (!tk || !car || tk === car) return
      const D = anim.duration / 1000
      const tE = end.t
      const at = (k: string, t: number) => { const a = anim.actors.find((x) => x.key === k)!; return posAt(a.path, t) }
      const gap = (t: number) => { const a = at(tk, t); const b = at(car, t); return Math.hypot(a.x - b.x, a.y - b.y) }
      n++
      const style = anim.skill?.tackles?.[tk] ?? '?'
      styles[style] = (styles[style] ?? 0) + 1
      if (style !== 'dive' && gap(Math.max(0, tE - 0.25 / D)) > 1.3) { late++; if (bad.length < 4) bad.push(`${play.n} ${play.concept} ${tk} late (${gap(Math.max(0, tE - 0.25 / D)).toFixed(1)} yd 0.25 s out)`) }
      const tq = Math.max(0, tE - 0.03 / D)
      if (!FALLING.has(poseAt6d(anim, tk, tq)) || !FALLING.has(poseAt6d(anim, car, tq)) || poseAt6d(anim, car, 1) !== 'down') { upright++; if (bad.length < 4) bad.push(`${play.n} ${play.concept} ${tk} ${poseAt6d(anim, tk, tq)} / ${car} ${poseAt6d(anim, car, tq)} at the whistle`) }
      if (gap(tE) > 1.5) far++
      if (anim.actors.some((a) => a.side === 'def' && a.key !== tk && poseAt6d(anim, a.key, tq) === 'tackleFall')) gang++
    })
    console.log(`      tackles ${n}: late ${late}, not going down together ${upright}, tackler > 1.5 yd ${far}; styles ${JSON.stringify(styles)}, gang ${gang}`)
    assert.ok(n >= 150, `coverage ${n}`)
    assert.ok(upright === 0 && far === 0, `touch-and-freeze: ${upright} / ${far} of ${n}: ${bad.join('; ')}`)
    assert.ok(late <= n * 0.05, `tackler arrives at the whistle on ${late}/${n}: ${bad.join('; ')}`)
    assert.ok((styles.wrap ?? 0) > 0 && (styles.hit ?? 0) > 0 && (styles.arm ?? 0) > 0 && (styles.dive ?? 0) > 0 && gang > 0, `variants ${JSON.stringify(styles)} gang ${gang}`)
  })

  ok('animflow r8 (backlog 354 / 373): every out-of-bounds end that is not a clock step-out is forced - a defender within 2 yd, inside or ahead of the carrier, with his hands on him (push) as he goes over the line, runs and catch-and-runs; a clock step-out angles out on its own (no push)', () => {
    const R = { run: [0, 0], pass: [0, 0] }
    const C = [0, 0]
    const bad: string[] = []
    const badC: string[] = []
    games6d(10, 131, (play, anim) => {
      if (!play.outOfBounds || play.endYard >= 100 || play.turnover || play.result.startsWith('Sack') || play.result.startsWith('Incomplete') || play.result.startsWith('Interception')) return
      const car = anim.holders[anim.holders.length - 1]?.key
      const ca = car ? anim.actors.find((a) => a.key === car) : undefined
      if (!ca) return
      const D = anim.duration / 1000
      const tEnd = ca.path[ca.path.length - 1].t
      const t = Math.max(0, tEnd - 0.12 / D)
      const c = posAt(ca.path, t)
      const push = (anim.engagements ?? []).some((e) => e.kind === 'tackle' && e.b === car && e.t1 >= tEnd - 0.3 / D && e.t0 <= tEnd)
      if (clockStepOut(play)) {
        // a deliberate step-out: angled out (>= 25 deg toward the sideline as he crosses it), untouched
        const sgn = c.y < 26.65 ? -1 : 1
        const p0 = posAt(ca.path, Math.max(0, tEnd - 0.35 / D))
        const ang = Math.atan2(sgn * (c.y - p0.y), Math.max(1e-6, Math.abs(c.x - p0.x)))
        C[1]++
        if (ang >= (25 * Math.PI) / 180 && !push) C[0]++
        else if (badC.length < 4) badC.push(`${play.n} ${play.concept} ${((ang * 180) / Math.PI).toFixed(0)} deg push ${push}`)
        return
      }
      const ok2 = push && anim.actors.some((a) => {
        if (a.side !== 'def') return false
        const q = posAt(a.path, t)
        return Math.hypot(q.x - c.x, q.y - c.y) <= 2.0 && (q.x >= c.x - 0.5 || Math.abs(q.y - 26.65) < Math.abs(c.y - 26.65))
      })
      const r = R[play.type as 'run' | 'pass']
      r[1]++
      if (ok2) r[0]++
      else bad.push(`${play.type} ${play.n} ${play.concept}${push ? '' : ' (no push)'}`)
    })
    console.log(`      forced out of bounds: runs ${R.run[0]}/${R.run[1]}, catch-and-runs ${R.pass[0]}/${R.pass[1]}; clock step-outs angled out ${C[0]}/${C[1]}`)
    assert.ok(R.run[1] >= 15 && R.pass[1] >= 15, `coverage ${JSON.stringify(R)}`)
    assert.ok(R.run[0] === R.run[1] && R.pass[0] === R.pass[1], `unforced out-of-bounds ends ${JSON.stringify(R)}: ${bad.slice(0, 4).join('; ')}`)
    assert.ok(C[0] >= C[1] * 0.9, `clock step-outs ${C[0]}/${C[1]}: ${badC.join('; ')}`)
  })

  ok('animflow r8 (c): a return touchdown is run into the goal line at full speed (end spot exact) and carried on into the end zone after the whistle', () => {
    store.useGame.getState().startCareer({ name: 'R', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const got = { kickoff: 0, punt: 0 }
    const bad: string[] = []
    for (let g = 0; g < 3 && (got.kickoff < 3 || got.punt < 3); g++) {
      const home = nfl[(g * 7) % nfl.length].id
      const away = nfl[(g * 7 + 5) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 211 + g * 389)
      for (let i = 0; i < sim.plays.length; i++) {
        const p0 = sim.plays[i]
        if ((p0.type !== 'kickoff' && p0.type !== 'punt') || p0.returnKind !== 'return' || !p0.returnerId || p0.turnover && p0.type === 'kickoff') continue
        const kind = p0.type as 'kickoff' | 'punt'
        if (got[kind] >= 3) continue
        // the same return, taken all the way (the sim's own touchdown fields)
        const play = (kind === 'kickoff'
          ? { ...p0, returnTD: true, startYard: 100, endYard: 100, returnYards: (p0.returnYards ?? 0) + 100 - p0.endYard, result: `${p0.result} TOUCHDOWN!`, scorerId: p0.returnerId }
          : { ...p0, returnTD: true, result: `${p0.result} TOUCHDOWN!`, scorerId: p0.returnerId }) as Play
        const other = play.offId === home ? away : home
        const anim = buildPlayAnim(play, { next: undefined, actors: actorPlayers(world, play, other, null) })
        const key = kind === 'kickoff' ? 'rb' : 's0'
        const a = anim.actors.find((x) => x.key === key)
        if (!a) continue
        got[kind]++
        const D = anim.duration / 1000
        const want = kind === 'kickoff' ? 110 : 10
        const end = posAt(a.path, 1)
        const pre = posAt(a.path, 1 - 0.1 / D)
        const v = Math.hypot(end.x - pre.x, end.y - pre.y) / 0.1
        const l = new ActorLayer()
        l.setPlay({ anim, offClub: NFL_TEAMS[0], defClub: NFL_TEAMS[1], offHome: true })
        l.post = 1.0
        const sh = l.runOnShift()
        const into = sh ? (kind === 'kickoff' ? sh.dx : -sh.dx) : 0
        if (Math.abs(end.x - want) > 1e-3 || v < 5 || !(anim.events ?? []).some((e) => e.kind === 'score') || into < 2.5) bad.push(`${kind} ${i}: end ${end.x.toFixed(2)} (want ${want}) at ${v.toFixed(1)} yd/s, ${into.toFixed(1)} yd on after the whistle`)
      }
    }
    console.log(`      return TDs drawn: ${got.kickoff} kickoff, ${got.punt} punt`)
    assert.ok(got.kickoff >= 2 && got.punt >= 2, `coverage ${JSON.stringify(got)}`)
    assert.ok(!bad.length, bad.join('; '))
  })

  ok('animflow r8 (J38 / J12 / J36): featured plays are drawn as themselves (wildcat direct snap, jet motion, back-shoulder turn, TE seam, RB wheel); a fooled QB looks off first; a steered throw goes at the scouted corner', () => {
    const seen: Record<string, number> = {}
    const bad: string[] = []
    const fooled = { y: 0, n: 0, honest: 0, honestN: 0 }
    const steer = { y: 0, n: 0 }
    games6d(10, 101, (play, anim, actors) => {
      const los = 10 + play.startYard
      const ev = anim.events ?? []
      const feat = play.featured
      if (feat && !play.result.startsWith('Sack') && !play.kneel && !play.spike) {
        const qb0 = atSec(anim, 'qb', 0)!
        if (feat === 'wildcat' && play.type === 'run' && play.carrierId && actors.get('rb')?.id === play.carrierId) {
          seen.wildcat = (seen.wildcat ?? 0) + 1
          if (anim.holders.find((h) => h.key)?.key !== 'rb') bad.push(`wildcat ${play.n}: snap not to the back`)
          if (Math.abs(qb0.y - 26.65) < 8) bad.push(`wildcat ${play.n}: QB not split out (${(qb0.y - 26.65).toFixed(1)})`)
        }
        if (feat === 'jet' && play.type === 'run' && actors.get('rb')?.id === play.carrierId) {
          seen.jet = (seen.jet ?? 0) + 1
          const a = atSec(anim, 'rb', 0.08)!
          const b = atSec(anim, 'rb', 0.2)!
          const vy = Math.abs(b.y - a.y) / 0.12
          if (vy < 4.5) bad.push(`jet ${play.n}: motion man ${vy.toFixed(1)} yd/s across at the snap`)
        }
        const c = ev.find((e) => e.kind === 'catch')
        if (play.type === 'pass' && c && play.endYard - play.startYard >= 4) {
          const want = feat === 'fade' ? 'fade' : feat === 'seam' ? 'seam' : feat === 'wheel' ? 'wheel' : null
          if (want) {
            seen[feat] = (seen[feat] ?? 0) + 1
            if (anim.catchRoute !== want) bad.push(`${feat} ${play.n}: caught on ${anim.catchRoute}`)
            if (feat === 'fade') {
              const D = anim.duration / 1000
              const k = c.keys[0]
              const p0 = atSec(anim, k, c.t * D - 0.35)!
              const p1 = atSec(anim, k, c.t * D - 0.02)!
              if (p1.x - p0.x > -0.3) bad.push(`fade ${play.n}: no turn back to the ball (${(p1.x - p0.x).toFixed(2)} yd)`)
            }
          }
        }
        void los
      }
      if (play.type === 'pass' && !play.result.startsWith('Sack') && !play.spike) {
        const th = ev.find((e) => e.kind === 'throw')
        const D = anim.duration / 1000
        const fl = anim.flights[0]
        if (th && fl && th.t * D > 1.6) {
          const catchY = posAt(anim.ball, fl.t1).y
          const qbF = (anim.facing.qb ?? []).filter((w) => w.mode === 'angle' && w.t1 > 0.4 / D && w.t0 < th.t)
          if (play.qbFooled) {
            fooled.n++
            if (qbF.some((w) => w.mode === 'angle' && Math.sign(Math.sin(w.angle)) === -Math.sign(catchY - 26.65))) fooled.y++
          } else {
            fooled.honestN++
            if (qbF.length) fooled.honest++
          }
        }
        const cov = play.coverId ? [...actors.entries()].find(([, p]) => p.id === play.coverId)?.[0] : undefined
        const tk = th?.keys[1]
        if (play.scoutTarget && play.scoutTarget === play.coverId && cov && /^cb/.test(cov) && tk && /^wr/.test(tk)) {
          steer.n++
          const a = atSec(anim, cov, 0)!
          const b = atSec(anim, tk, 0)!
          if (Math.abs(a.y - b.y) <= 3) steer.y++
        }
      }
    })
    const nFeat = Object.values(seen).reduce((x, y) => x + y, 0)
    assert.ok(nFeat >= 8 && Object.keys(seen).length >= 3, `coverage: featured ${JSON.stringify(seen)}`)
    assert.ok(bad.length === 0, `${bad.length} featured plays drawn wrong: ${bad.slice(0, 4).join('; ')}`)
    assert.ok(fooled.n >= 10 && fooled.y / fooled.n >= 0.85, `fooled QB looks off first ${fooled.y}/${fooled.n}`)
    assert.ok(fooled.honest === 0, `${fooled.honest}/${fooled.honestN} unfooled QBs look off`)
    assert.ok(steer.n >= 3 && steer.y / steer.n >= 0.9, `steered throws at the scouted corner lined up over the target ${steer.y}/${steer.n}`)
  })
}

// ── Backlog 357 (camera lock): with cameraAngle 'fixed' the live / replay / phone
// camera holds ONE angle — yaw, height and pitch constant (< 1e-6) on every frame of
// every play — while pan + zoom keep the action (the holder, else the ball; a ball
// above the fixed rig's reach, FIXED_WATCH_Z, by its ground spot) in the safe frame.
{
  const { fileURLToPath } = await import('node:url')
  const repo = fileURLToPath(new URL('..', import.meta.url))
  const rj = (n: string) => JSON.parse(readFileSync(`${repo}public/data/${n}.json`, 'utf8'))
  ;(await import('../src/game/data/realData.ts')).setRealData({ nfl: rj('madden26').players, cfb: rj('cfb26').teams, source: { madden: 'local', cfb: 'local' } })
  ;(await import('../src/game/data/calibration.ts')).setCalibration(rj('calibration'))
  const store = await import('../src/store/gameStore.ts')
  const { simulatePlayByPlay } = await import('../src/game/engine/playsim.ts')
  const { buildPlayAnim, holderAt, posAt } = await import('../src/components/playAnim.ts')
  const { actorPlayers } = await import('../src/components/jersey.ts')
  const cam = await import('../src/components/broadcast/camera.ts')
  const { createBroadcastDirector } = await import('../src/components/broadcast/directorRules.ts')
  const { FIXED_WATCH_Z } = await import('../src/components/broadcast/director.ts')
  const pc = await import('../src/components/broadcast/phoneCamera.ts')
  ok('backlog 357 camera lock: fixed angle — yaw / height / pitch constant < 1e-6 (live, replay, phone), the action in the safe frame >= 99% of frames', () => {
    store.useGame.getState().startCareer({ name: 'C', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const sim = simulatePlayByPlay(world, nfl[0].id, nfl[1].id, world.seed + 13)
    const out: string[] = []
    let dynamicMoves = 0
    for (const [profile, W, H, clear] of [['live', 1280, 720, 48], ['phone', 351, 620, 68]] as const) {
      let ref: { yaw: number; pitch: number; z: number } | null = null
      let dAng = 0
      let frames = 0
      let inside = 0
      let passBall = 0
      let passBallIn = 0
      let plays = 0
      const applier = pc.createProfileApplier(pc.CAMERA_PROFILES.phone, { fixed: true })
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if (!['run', 'pass', 'kickoff', 'punt', 'fg', 'pat'].includes(play.type)) continue
        const other = play.offId === nfl[0].id ? nfl[1].id : nfl[0].id
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors: actorPlayers(world, play, other, null) })
        const d = createBroadcastDirector({ profile, viewport: { w: W, h: H }, bottomClearPx: clear, angle: 'fixed' })
        d.reset(play, anim)
        plays++
        const nf = Math.ceil((anim.duration / 1000) * 60)
        applier.reset()
        for (let j = 0; j <= nf; j++) {
          const t = j / nf
          let pose = d.toCamera(d.shotAt(t))
          const key = holderAt(anim, t)
          const a = key ? anim.actors.find((x) => x.key === key) : null
          const b = posAt(anim.ball, t)
          const bz = ballZAt(anim as BroadcastAnim, t)
          const car = a ? posAt(a.path, t) : null
          if (profile === 'phone') {
            pose = applier.apply(pose, { strongSideY: 32.5, carrier: car, ball: { x: b.x, y: b.y, z: Math.min(bz, FIXED_WATCH_Z) }, losX: 10 + play.startYard, direction: 1, phase: 'live', viewport: { w: W, h: H }, wide: Math.max(0, Math.min(1, 1 - (t * anim.duration / 1000 - 0.14))), bottomClear: clear }, `${i}`)
          }
          const c = cam.makeCamera(pose, { width: W, height: H })
          const ang = { yaw: Math.atan2(c.fy, c.fx), pitch: Math.asin(Math.max(-1, Math.min(1, c.fz))), z: c.pz }
          ref ??= ang
          dAng = Math.max(dAng, Math.abs(ang.yaw - ref.yaw), Math.abs(ang.pitch - ref.pitch), Math.abs(ang.z - ref.z))
          const safe = (p: { x: number; y: number } | null) => !!p && p.x >= W * 0.06 - 2 && p.x <= W * 0.94 + 2 && p.y >= H * 0.06 - 2 && p.y <= H - Math.max(clear + 14, H * 0.06) + 2
          const pt = car ? { x: car.x, y: car.y, z: 0 } : { x: b.x, y: b.y, z: bz > FIXED_WATCH_Z ? 0 : bz }
          frames++
          if (safe(cam.project(c, pt.x, pt.y, pt.z))) inside++
          if (profile === 'live' && play.type === 'pass' && !key) {
            passBall++
            if (safe(cam.project(c, b.x, b.y, bz))) passBallIn++
          }
        }
        if (profile === 'live' && dynamicMoves === 0) {
          const dd = createBroadcastDirector({ profile, viewport: { w: W, h: H }, bottomClearPx: clear, angle: 'dynamic' })
          dd.reset(play, anim)
          const z0 = dd.shotAt(0).z ?? 0
          for (let j = 0; j <= 60; j++) if (Math.abs((dd.shotAt(j / 60).z ?? 0) - z0) > 0.5) dynamicMoves++
        }
      }
      assert.ok(plays > 100 && frames > 20000, `${profile} coverage ${plays} plays / ${frames} frames`)
      assert.ok(dAng < 1e-6, `${profile}: the fixed camera angle moved by ${dAng}`)
      assert.ok(inside / frames >= 0.99, `${profile}: the action in the safe frame on only ${((inside / frames) * 100).toFixed(2)}% of ${frames} frames`)
      if (profile === 'live') assert.ok(passBall > 1000 && passBallIn / passBall >= 0.99, `passes in the air framed by pan / zoom ${passBallIn}/${passBall}`)
      out.push(`${profile} ${((inside / frames) * 100).toFixed(2)}% of ${frames}`)
    }
    // The replay director keeps the live rig under a fixed angle (no higher replay angle).
    const p0 = sim.plays.find((p) => p.type === 'pass')!
    const a0 = buildPlayAnim(p0, { actors: actorPlayers(world, p0, p0.offId === nfl[0].id ? nfl[1].id : nfl[0].id, null) })
    const live = createBroadcastDirector({ profile: 'live', angle: 'fixed' })
    live.reset(p0, a0)
    const pl = cam.makeCamera(live.toCamera(live.shotAt(0.5)), { width: 1280, height: 720 })
    assert.ok(Math.abs(pl.fz - Math.sin(-Math.atan2(14, 27))) < 1e-9, 'fixed angle = the live rig at the snap (height 14, back 27)')
    assert.ok(dynamicMoves > 0, "'dynamic' still re-angles (height eases on some play)")
    console.log(`      camera lock: ${out.join(', ')}`)
  })
}

// QB cone (backlog 303/306/307/309): at the release the cone points within ~10 deg of the target and
// the ring radius equals the recorded placeRadiusYd; the toggle defaults on in both views.
{
  const { qbConeAt } = await import('../src/components/broadcast/visionCone.ts')
  const vs = await import('../src/components/broadcast/viewSettings.ts')
  const store = await import('../src/store/gameStore.ts')
  const { simulatePlayByPlay } = await import('../src/game/engine/playsim.ts')
  const { buildPlayAnim, posAt } = await import('../src/components/playAnim.ts')
  const { actorPlayers } = await import('../src/components/jersey.ts')
  ok('QB cone: pass plays aim within 10 deg of the target at release; ring radius == placeRadiusYd; defaults off (2.5D) / on (top-down)', () => {
    assert.equal(vs.qbConeOn({ qbCone: null }, 'broadcast'), true)
    assert.equal(vs.qbConeOn({ qbCone: null }, 'topdown'), true)
    assert.equal(vs.qbConeOn({ qbCone: 'off' }, 'broadcast'), false)
    assert.equal(vs.qbConeOn({ qbCone: 'off' }, 'topdown'), false)
    store.useGame.getState().startCareer({ name: 'R', path: 'coach', archetype: 'off', teamId: 'CLE', seed: 33333, startLevel: 7 })
    const world = store.getWorld()
    const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    let n = 0
    let worst = 0
    let ringN = 0
    let widthN = 0
    for (let g = 0; g < 3; g++) {
      const home = nfl[(g * 5) % nfl.length].id
      const away = nfl[(g * 5 + 3) % nfl.length].id
      const sim = simulatePlayByPlay(world, home, away, world.seed + 91 + g * 17)
      for (let i = 0; i < sim.plays.length; i++) {
        const play = sim.plays[i]
        if (play.type !== 'pass' || play.result.startsWith('Sack') || play.spike || play.placeRadiusYd == null) continue
        const other = play.offId === home ? away : home
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors: actorPlayers(world, play, other, null) })
        const f = anim.flights[0]
        if (!f) continue
        const { cone } = qbConeAt(play, anim, f.t0)
        const { ring } = qbConeAt(play, anim, (f.t0 + f.t1) / 2)
        if (!cone || !ring) continue
        n++
        const c = posAt(anim.ball, f.t1)
        let d = Math.atan2(c.y - cone.oy, c.x - cone.ox) - cone.yaw
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        worst = Math.max(worst, Math.abs(d) * 180 / Math.PI)
        if (Math.abs(ring.r - play.placeRadiusYd) < 1e-9) ringN++
        if (play.coneDeg != null && Math.abs(cone.half * 360 / Math.PI - play.coneDeg) < 1e-6) widthN++
      }
    }
    assert.ok(n >= 40, `coverage: ${n} pass plays with a cone`)
    assert.ok(worst <= 10, `cone off the target at release by ${worst.toFixed(1)} deg`)
    assert.equal(ringN, n, `ring radius matches placeRadiusYd on ${ringN}/${n}`)
    assert.equal(widthN, n, `cone width matches coneDeg on ${widthN}/${n}`)
  })
}

console.log(`check-broadcast: PASS (${n} checks)`)
