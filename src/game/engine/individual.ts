// ─────────────────────────────────────────────────────────────────────────────
// J8d: the individual-ratings toggle.
//
// Kept in its own dependency-free module so both `playsim.ts` (penalties, special
// teams) and `generate.ts` (fast-sim `teamStrength`) can read the same switch
// without a module cycle. `playsim.ts` re-exports the setter/getter so the probe
// and the calibration copy share one switch, exactly like the J1 situational
// toggle. Default ON; with it OFF every J8d site falls back to the pre-J8d
// unit-average / OVR-stand-in behaviour, byte-for-byte.
// ─────────────────────────────────────────────────────────────────────────────

let INDIVIDUAL_ON = true

/** J8d: enable/disable every individual-ratings change in this job. */
export function setIndividual(on: boolean) {
  INDIVIDUAL_ON = on
}

/** J8d: read the toggle so a probe can restore it exactly. */
export function getIndividual(): boolean {
  return INDIVIDUAL_ON
}

// ── J8d: fast-sim team strength config ────────────────────────────────────────
// `teamStrength` (generate.ts) is called with a bare roster and no league context,
// so the position weights and the normalisation that keeps the old league mean and
// spread live here as constants (measured on the real 32-club league).
export const FAST_ROLES: { pos: string[]; n: number; w: number }[] = [
  { pos: ['QB'], n: 1, w: 3.0 },
  { pos: ['RB'], n: 1, w: 1.0 },
  { pos: ['WR'], n: 3, w: 0.7 },
  { pos: ['TE'], n: 1, w: 0.7 },
  { pos: ['OT'], n: 2, w: 0.85 },
  { pos: ['OG'], n: 2, w: 0.85 },
  { pos: ['C'], n: 1, w: 0.85 },
  { pos: ['DE'], n: 2, w: 0.85 },
  { pos: ['DT'], n: 2, w: 0.85 },
  { pos: ['LB'], n: 3, w: 0.75 },
  { pos: ['CB'], n: 3, w: 0.8 },
  { pos: ['S'], n: 2, w: 0.75 },
  { pos: ['K'], n: 1, w: 0.1 },
  { pos: ['P'], n: 1, w: 0.1 },
]

/** J8d: the real ratings that matter for each position's value in the fast sim. */
export const FAST_BLEND: Record<string, [string, number][]> = {
  QB: [['SAC', 0.3], ['MAC', 0.25], ['DAC', 0.2], ['AWR', 0.15], ['THP', 0.1]],
  RB: [['SPD', 0.3], ['BCV', 0.3], ['CAR', 0.2], ['CTH', 0.2]],
  WR: [['SPD', 0.35], ['CTH', 0.3], ['SRR', 0.35]],
  TE: [['CTH', 0.4], ['SPD', 0.3], ['RBK', 0.3]],
  OT: [['PBK', 0.5], ['RBK', 0.3], ['STR', 0.2]],
  OG: [['PBK', 0.45], ['RBK', 0.35], ['STR', 0.2]],
  C: [['PBK', 0.45], ['RBK', 0.35], ['STR', 0.2]],
  DE: [['PMV', 0.35], ['FMV', 0.35], ['TAK', 0.15], ['BSH', 0.15]],
  DT: [['PMV', 0.3], ['FMV', 0.2], ['BSH', 0.3], ['TAK', 0.2]],
  LB: [['TAK', 0.4], ['PUR', 0.3], ['ZCV', 0.3]],
  CB: [['MCV', 0.4], ['ZCV', 0.4], ['SPD', 0.2]],
  S: [['ZCV', 0.4], ['TAK', 0.3], ['SPD', 0.3]],
  K: [['KPW', 0.5], ['KAC', 0.5]],
  P: [['KPW', 0.5], ['KAC', 0.5]],
}

/** J8d: the old-scale mean/SD the fast-sim strength is normalised onto. `rawMean`
 *  / `rawSd` are the raw individual formula's league mean/SD (measured). */
export const FAST_NORM = { mean: 81.4754, sd: 1.7146, rawMean: 1025.252, rawSd: 23.016 }

