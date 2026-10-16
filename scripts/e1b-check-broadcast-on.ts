// E1b (emere1b): run the repo's check-broadcast suite with the E1b after-the-catch
// pursuit field turned ON, so the phase gate "check-broadcast PASS with the phase
// OFF and ON" is covered. The suite itself is imported unchanged (never loosened):
// flipping the toggle first makes every broadcast/anim check exercise the ON path,
// and the imported script's own assertions and exit code decide PASS.
// `E1B_<KEY>` env overrides (same convention as the calibration copy) let a sweep
// check a candidate knob without editing the module.
// Run: nice -n 15 node --experimental-strip-types scripts/e1b-check-broadcast-on.ts
const yac = await import('../src/game/engine/emergentYac.ts')
for (const k of Object.keys(yac.EMERGENT_YAC)) {
  const v = process.env['E1B_' + k.toUpperCase()]
  if (v === undefined || k === 'on') continue
  const cur = yac.EMERGENT_YAC[k]
  yac.EMERGENT_YAC[k] = cur && typeof cur === 'object' ? JSON.parse(v) : Number(v)
}
yac.setEmergentE1b(true)
if (process.env.E1B_STAT === '1') yac.YAC_STAT.on = true
await import('./check-broadcast.ts')
