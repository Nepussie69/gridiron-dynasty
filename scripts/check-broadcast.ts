// Broadcast 2.5D (B2) checks: camera projection, near-plane clipping, the
// affine helpers, offense→world mapping, and end-zone wordmark contrast for
// all 32 clubs. Run: node --experimental-strip-types scripts/check-broadcast.ts
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

console.log(`check-broadcast: PASS (${n} checks)`)
