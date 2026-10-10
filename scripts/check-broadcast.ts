// Broadcast 2.5D (B2) checks: camera projection, near-plane clipping, the
// affine helpers, offense→world mapping, and end-zone wordmark contrast for
// all 32 clubs. B3: pose-library coverage of animData's pose states, figure
// scale vs depth, kit number contrast + outline edges (32 clubs home/away),
// depth-sort stability, and the actor layer (run-cycle phase by distance,
// stride vs speed, dir −1 mirroring, continuous pose blends, head point on a
// lying body, painter's order with the ball just in front of its carrier).
// Run: node --experimental-strip-types scripts/check-broadcast.ts
import assert from 'node:assert/strict'
import { NFL_TEAMS } from '../src/game/data/nflTeams.ts'
import { contrast } from '../src/lib/teamColor.ts'
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
import type { BroadcastAnim } from '../src/components/broadcast/animData.ts'
import type { BroadcastFrame } from '../src/components/broadcast/renderer.ts'
import { readFileSync } from 'node:fs'

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

console.log(`check-broadcast: PASS (${n} checks)`)
