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
import { BIG_GAIN_YDS, GAME_DAY_LEAD_SEC, gameDayReplay, LONG_FG_YDS, MAX_SPAN_SEC, ReplayPlayer, replayAt, replayPlan, replayReasons, teleState, type ReplayPlan } from '../src/components/broadcast/replay.ts'
import { TelestratorLayer, composeHooks, partial } from '../src/components/broadcast/telestrator.ts'
import type { Play } from '../src/game/engine/playsim.ts'

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

console.log(`check-broadcast: PASS (${n} checks)`)
