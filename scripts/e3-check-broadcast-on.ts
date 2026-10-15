// E3 (emere3): run the repo's check-broadcast suite with the E3 field pass set
// ON, so the phase gate "check-broadcast PASS with the phase OFF and ON" is
// covered. The check itself is unchanged (it is imported, never loosened): the
// toggle is flipped first (the broadcast/anim checks then exercise the ON path)
// and the imported script's own assertions and exit code decide PASS.
// Run: nice -n 15 node --experimental-strip-types scripts/e3-check-broadcast-on.ts
;(await import('../src/game/engine/emergentRush.ts')).setEmergentE3(true)
await import('./check-broadcast.ts')
