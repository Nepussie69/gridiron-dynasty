// ─────────────────────────────────────────────────────────────────────────────
// Live field (thin re-export).
//
// FUTURES #54 P0: the continuous motion engine now lives in
// `src/game/engine/liveField.ts` (DOM-free, deterministic) so the headless
// emergent field can share it. This file stays as the component-side entry point
// so every existing import (playAnim.ts, playReturn.ts, scripts/check-broadcast.ts)
// keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export * from '../game/engine/liveField'
