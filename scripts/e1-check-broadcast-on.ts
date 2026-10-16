// E1a (emere1a): run the repo's check-broadcast suite with the RUN pursuit field
// ON, so the phase gate "check-broadcast PASS with the phase OFF and ON" is
// covered. The check itself is imported, never loosened. It also diffs one snap
// twice (determinism: no rng, identical inputs -> identical result) before the
// suite runs.
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

await import('./check-broadcast.ts')
