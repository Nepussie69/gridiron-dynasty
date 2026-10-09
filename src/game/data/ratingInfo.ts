// ─────────────────────────────────────────────────────────────────────────────
// Rating glossary (L12 R2).
//
// Human-readable names for every rating the game carries, plus a plain-English
// note on what the rating does. `sim` is present ONLY for ratings the play
// engine (`playsim.ts`) or the stat allocator (`statAlloc.ts`) actually reads;
// the UI shows "Not used by the game sim yet" for the rest.
//
// Covers every key in `ATTRIBUTE_SCHEMA` and every key the real Madden 26 data
// carries (48 unique keys).
// ─────────────────────────────────────────────────────────────────────────────

import type { Position } from '../types'
import { ATTRIBUTE_SCHEMA } from './ratings'

export interface RatingInfo {
  name: string
  what: string
  sim?: string
}

export const RATING_INFO: Record<string, RatingInfo> = {
  ACC: { name: 'Acceleration', what: 'How quickly a player reaches top speed.', sim: 'QB sack escape; joins WR/TE separation, RB elusiveness, DL rush and secondary coverage.' },
  AGI: { name: 'Agility', what: 'Change-of-direction quickness in tight spaces.', sim: '20% of a receiver\'s separation; QB runs, DL rush quickness, LB/DB athleticism, and part of a defender\'s tackling.' },
  AWR: { name: 'Awareness', what: 'Football IQ — reading plays and making the right decision.', sim: '15% of QB accuracy and fewer interceptions; OL blitz pickups; S coverage; late-game kicks and punts.' },
  BCV: { name: 'Ball Carrier Vision', what: 'Vision to find and hit the right running lane.', sim: '35% of RB elusiveness (run yards); weights the rushing stat share and QB scramble yards.' },
  BSH: { name: 'Block Shedding', what: 'Getting off blocks to make the tackle.', sim: '50% of a defensive lineman\'s run defense (with TAK); part of the LB second-level run fit.' },
  BTK: { name: 'Break Tackle', what: 'Breaking tackles to extend the play.', sim: 'The biggest term in a carrier\'s chance to make a defender miss; 30% of yards after the catch; RB yards after contact; QB sack escape.' },
  CAR: { name: 'Carrying', what: 'Ball security — resistance to fumbling.', sim: 'RB ball security — moves the fumble chance with the back\'s style.' },
  CIT: { name: 'Catch in Traffic', what: 'Catching the ball with defenders closing in.', sim: 'Adds to the catch on tight coverage (WR/TE).' },
  COD: { name: 'Change of Direction', what: 'Open-field cutting and redirection.', sim: 'Joins WR/TE separation and RB elusiveness.' },
  CTH: { name: 'Catching', what: 'Hands — securing catchable passes.', sim: 'Catch chance on catchable balls; 50% of yards after the catch and the receiving stat share.' },
  DAC: { name: 'Deep Accuracy', what: 'Accuracy on throws 15+ yards downfield.', sim: '25% of QB accuracy, which drives completion %, interception risk and yards.' },
  DRR: { name: 'Deep Route Running', what: 'Creating separation on deep routes (15+ yards).', sim: '50% of separation on deep throws; route + SPD decide who gets targeted.' },
  FMV: { name: 'Finesse Moves', what: 'Speed-rush moves to beat the blocker.', sim: 'The better of PMV/FMV per DL sets the pass rush; LB finesse rushes join a blitz.' },
  HPW: { name: 'Hit Power', what: 'Force of the tackle — jarring the ball loose.', sim: 'Part of a defender\'s tackling blend (a missed tackle is less likely); a big-hitting DB adds a small forced-fumble chance on catches.' },
  IBL: { name: 'Inline Blocking', what: 'Blocking in-line at the point of attack.', sim: 'Joins TE run blocking (30%, with RBK).' },
  IMP: { name: 'Impact Blocking', what: 'Finishing blocks on the move.', sim: '30% of OL run blocking (with RBK).' },
  JKM: { name: 'Juke Move', what: 'Open-field elusiveness to make defenders miss.', sim: '20% of RB elusiveness (run yards); a top term in forcing a missed tackle.' },
  JMP: { name: 'Jumping', what: 'High-pointing the ball and leaping ability.', sim: 'High-points deep throws (WR/TE); with PRC lifts DB interception chance.' },
  KAC: { name: 'Kick Accuracy', what: 'Accuracy on field goals and extra points.', sim: '50% of kick power and the extra-point roll.' },
  KPW: { name: 'Kick Power', what: 'Leg strength for distance on kicks and punts.', sim: '50% of kick power; sets punt distance.' },
  MAC: { name: 'Medium Accuracy', what: 'Accuracy on throws 8–14 yards.', sim: '30% of QB accuracy, which drives completion %, interception risk and yards.' },
  MCV: { name: 'Man Coverage', what: 'Sticking with receivers in man coverage.', sim: "CB man coverage (weighted by how much man the DC plays); LBs cover RB/TE in man." },
  MRR: { name: 'Medium Route Running', what: 'Separation on intermediate routes (8–14 yards).', sim: '50% of separation on intermediate throws; route + SPD decide who gets targeted.' },
  PAC: { name: 'Play Action', what: 'Selling the run on play-action passes.', sim: 'Scales the play-action bonus ×0.7–1.3.' },
  PBK: { name: 'Pass Block', what: 'Protecting the quarterback in the pocket.', sim: 'Average of the starting OL = pass protection vs the pass rush (sacks, pressure).' },
  PMV: { name: 'Power Moves', what: 'Bull-rush moves to beat the blocker.', sim: 'The better of PMV/FMV per DL sets the pass rush; LB power rushes join a blitz.' },
  PRC: { name: 'Play Recognition', what: 'Diagnosing plays quickly.', sim: 'DB interception chance, LB run fit, and cutting play-action/screen bonuses.' },
  PRS: { name: 'Press', what: 'Jamming receivers at the line in press coverage.', sim: "Press vs the receiver's release on short man throws; extra deep risk when he wins." },
  PUR: { name: 'Pursuit', what: 'Chasing down the ball carrier.', sim: "40% of a linebacker's run defense and 30% of the tackle share; part of a defender's tackling (fewer missed tackles); DL/LB pursuit caps long runs." },
  RBK: { name: 'Run Block', what: 'Moving defenders in the run game.', sim: '70% of OL run blocking (with IMP); a tight end adds 15%.' },
  RLS: { name: 'Release', what: 'Getting off the line against press coverage.', sim: "Release vs the corner's press on short man throws." },
  RTE: { name: 'Route Running', what: 'Overall route-running polish.' },
  RUN: { name: 'Rushing', what: 'Running ability on scrambles and designed runs.', sim: 'QB scrambling and designed runs use RUN in the run\'s elusiveness.' },
  SAC: { name: 'Short Accuracy', what: 'Accuracy on throws under 10 yards.', sim: '30% of QB accuracy, which drives completion %, interception risk and yards.' },
  SFA: { name: 'Stiff Arm', what: 'Fending off tacklers with a strong arm.', sim: 'Joins RB elusiveness and the chance to force a missed tackle.' },
  SPC: { name: 'Spectacular Catch', what: 'Contested, acrobatic catches.', sim: "20% of yards after the catch; high-points deep throws with JMP." },
  SPD: { name: 'Speed', what: 'Top-end straight-line speed.', sim: '30% of separation and 20% of RB elusiveness; QB sack escape; DL rush, LB pursuit, S deep help.' },
  SPM: { name: 'Spin Move', what: 'Spinning off tacklers in the open field.', sim: 'Joins RB elusiveness and the chance to force a missed tackle.' },
  SRR: { name: 'Short Route Running', what: 'Creating separation on short routes (under 8 yards).', sim: '50% of separation on short throws; route + SPD decide who gets targeted.' },
  STA: { name: 'Stamina', what: 'Conditioning — how much energy is left late in games.', sim: 'In Q4 a tired unit loses part of its edge (works with the DL rotation).' },
  STR: { name: 'Strength', what: 'Physical strength at the point of attack.', sim: 'OL short-yardage push; DL power vs the OL; QB sack escape and LB/DB physicality.' },
  TAK: { name: 'Tackle', what: 'Bringing down the ball carrier.', sim: '50% of DL and 60% of LB run defense; 50% of the tackle share; the biggest term in avoiding a missed tackle; shrinks yards after the catch.' },
  TGH: { name: 'Toughness', what: 'Playing through injury and pain.', sim: 'Weekly injury roll — a tougher player is hurt less often.' },
  THP: { name: 'Throw Power', what: 'Arm strength on throws.', sim: 'Weights the passing stat share; sharpens deep separation and trims deep interceptions.' },
  TOR: { name: 'Throw on the Run', what: 'Accuracy when throwing outside the pocket.', sim: 'Trims the pressure penalty on throws made under pressure (with TUP).' },
  TRK: { name: 'Trucking', what: 'Running through contact for extra yards.', sim: '25% of RB elusiveness (run yards) and part of the chance to force a missed tackle.' },
  TUP: { name: 'Throw Under Pressure', what: 'Accuracy as the pocket collapses.', sim: 'Trims the pressure penalty on throws made under pressure (with TOR).' },
  ZCV: { name: 'Zone Coverage', what: 'Coverage awareness and range in zone.', sim: 'LB/CB/S zone coverage; weighted by how much zone the DC plays.' },
}

/** Tooltip text for a rating column: `Name — what (sim)` or the "not used" note. */
export function ratingTitle(key: string): string {
  const info = RATING_INFO[key]
  if (!info) return key
  return info.sim
    ? `${info.name} — ${info.what} (${info.sim})`
    : `${info.name} — ${info.what} (Not used by the game sim yet)`
}

// ─────────────────────────────────────────────────────────────────────────────
// R1 — ratings table columns
// ─────────────────────────────────────────────────────────────────────────────

/** Position groups shown as chips on the Ratings tab. `ALL` shows every position. */
export const RATING_GROUPS: { id: string; positions: Position[] }[] = [
  { id: 'QB', positions: ['QB'] },
  { id: 'RB', positions: ['RB'] },
  { id: 'FB', positions: ['FB'] },
  { id: 'WR', positions: ['WR'] },
  { id: 'TE', positions: ['TE'] },
  { id: 'OL', positions: ['OT', 'OG', 'C'] },
  { id: 'OT', positions: ['OT'] },
  { id: 'OG', positions: ['OG'] },
  { id: 'C', positions: ['C'] },
  { id: 'DL', positions: ['DE', 'DT'] },
  { id: 'DE', positions: ['DE'] },
  { id: 'DT', positions: ['DT'] },
  { id: 'LB', positions: ['LB'] },
  { id: 'CB', positions: ['CB'] },
  { id: 'S', positions: ['S'] },
  { id: 'K/P', positions: ['K', 'P'] },
]

/** Base ratings come from the position schema (in schema order). */
const GROUP_SCHEMA: Record<string, string[]> = {
  QB: ATTRIBUTE_SCHEMA.QB,
  RB: ATTRIBUTE_SCHEMA.RB,
  FB: ATTRIBUTE_SCHEMA.FB,
  WR: ATTRIBUTE_SCHEMA.WR,
  TE: ATTRIBUTE_SCHEMA.TE,
  OL: ATTRIBUTE_SCHEMA.OT,
  DL: ATTRIBUTE_SCHEMA.DE,
  LB: ATTRIBUTE_SCHEMA.LB,
  CB: ATTRIBUTE_SCHEMA.CB,
  S: ATTRIBUTE_SCHEMA.S,
  'K/P': ATTRIBUTE_SCHEMA.K,
}

/** Real-data keys that matter for a group but aren't in its position schema. */
const GROUP_EXTRAS: Record<string, string[]> = {
  QB: ['ACC', 'TOR', 'TUP', 'SFA'],
  RB: ['CTH', 'BTK', 'CAR', 'ACC', 'COD'],
  FB: ['ACC', 'COD', 'BCV', 'JKM'],
  WR: ['CTH', 'SPC', 'BTK', 'RLS', 'ACC', 'COD'],
  TE: ['CTH', 'SPC', 'BTK', 'RLS', 'ACC', 'COD'],
  OL: [],
  DL: ['ACC', 'PRC'],
  LB: ['ACC', 'HPW'],
  CB: ['ACC', 'COD'],
  S: ['ACC', 'HPW'],
  'K/P': [],
}

function columnsFor(base: string[], extras: string[]): string[] {
  const out = [...base]
  for (const k of extras) if (!out.includes(k)) out.push(k)
  return out
}

/** Rating columns per group: schema keys first, then the group's extra keys. */
export const RATING_COLUMNS: Record<string, string[]> = {
  ALL: ['SPD', 'STR', 'AGI', 'AWR', 'ACC'],
  ...Object.fromEntries(
    Object.entries(GROUP_SCHEMA).map(([g, base]) => [g, columnsFor(base, GROUP_EXTRAS[g] ?? [])]),
  ),
}

/** Single-position chips (OT, OG, C, DE, DT) share their line group's columns and composites. */
export function baseGroup(groupId: string): string {
  if (groupId === 'OT' || groupId === 'OG' || groupId === 'C') return 'OL'
  if (groupId === 'DE' || groupId === 'DT') return 'DL'
  return groupId
}

export function groupPositions(groupId: string): Position[] | null {
  return RATING_GROUPS.find((g) => g.id === groupId)?.positions ?? null
}

/** The ratings group a single position belongs to (OT/OG/C → OL, DE/DT → DL…). */
export function groupForPosition(pos: Position): string | null {
  return RATING_GROUPS.find((g) => g.positions.includes(pos))?.id ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// R3 — engine composites
//
// Pure reproductions of the blends `playsim.ts` builds from ratings. The weights
// are copied here on purpose so the engine file stays untouched; missing inputs
// fall back to 70, exactly like the sim.
// ─────────────────────────────────────────────────────────────────────────────

export interface Composite {
  id: string
  label: string
  /** Tooltip: the formula, plus the "missing inputs use 70" note. */
  title: string
  compute: (a: Record<string, number>) => number
}

const val = (a: Record<string, number>, k: string) => a[k] ?? 70

function sep(route: 'SRR' | 'MRR' | 'DRR', depth: 'short' | 'mid' | 'deep'): Composite {
  return {
    id: `sep${depth}`,
    label: `Sep ${depth}`,
    title: `Separation (${depth}) = ${route}·0.5 + SPD·0.3 + AGI·0.2 (missing inputs use 70)`,
    compute: (a) => val(a, route) * 0.5 + val(a, 'SPD') * 0.3 + val(a, 'AGI') * 0.2,
  }
}

const HANDS: Composite = {
  id: 'hands',
  label: 'Hands',
  title: 'CTH·0.5 + SPC·0.2 + BTK·0.3 (missing inputs use 70)',
  compute: (a) => val(a, 'CTH') * 0.5 + val(a, 'SPC') * 0.2 + val(a, 'BTK') * 0.3,
}

const ELUSIVE: Composite = {
  id: 'elusive',
  label: 'Elusive',
  title: 'BCV·0.35 + JKM·0.20 + TRK·0.25 + SPD·0.20 (missing inputs use 70)',
  compute: (a) => val(a, 'BCV') * 0.35 + val(a, 'JKM') * 0.2 + val(a, 'TRK') * 0.25 + val(a, 'SPD') * 0.2,
}

const QB_ACCURACY: Composite = {
  id: 'qbAcc',
  label: 'Accuracy',
  title: 'SAC·0.30 + MAC·0.30 + DAC·0.25 + AWR·0.15 (missing inputs use 70)',
  compute: (a) => val(a, 'SAC') * 0.3 + val(a, 'MAC') * 0.3 + val(a, 'DAC') * 0.25 + val(a, 'AWR') * 0.15,
}

const PASS_PRO: Composite = {
  id: 'passPro',
  label: 'Pass pro',
  title: 'PBK (missing inputs use 70)',
  compute: (a) => val(a, 'PBK'),
}

const RUN_BLOCK: Composite = {
  id: 'runBlock',
  label: 'Run block',
  title: 'RBK·0.7 + IMP·0.3 (missing inputs use 70)',
  compute: (a) => val(a, 'RBK') * 0.7 + val(a, 'IMP') * 0.3,
}

const PASS_RUSH: Composite = {
  id: 'passRush',
  label: 'Pass rush',
  title: 'max(PMV, FMV) (missing inputs use 70)',
  compute: (a) => Math.max(val(a, 'PMV'), val(a, 'FMV')),
}

const RUN_STOP: Composite = {
  id: 'runStop',
  label: 'Run stop',
  title: 'BSH·0.5 + TAK·0.5 (missing inputs use 70)',
  compute: (a) => val(a, 'BSH') * 0.5 + val(a, 'TAK') * 0.5,
}

const RUN_FIT: Composite = {
  id: 'runFit',
  label: 'Run fit',
  title: 'TAK·0.6 + PUR·0.4 (missing inputs use 70)',
  compute: (a) => val(a, 'TAK') * 0.6 + val(a, 'PUR') * 0.4,
}

const MAN: Composite = {
  id: 'man',
  label: 'Man',
  title: 'MCV (missing inputs use 70)',
  compute: (a) => val(a, 'MCV'),
}

const ZONE: Composite = {
  id: 'zone',
  label: 'Zone',
  title: 'ZCV (missing inputs use 70)',
  compute: (a) => val(a, 'ZCV'),
}

const LEG: Composite = {
  id: 'leg',
  label: 'Leg',
  title: 'KPW·0.5 + KAC·0.5 (missing inputs use 78, as the sim does for kickers)',
  compute: (a) => (a.KPW ?? 78) * 0.5 + (a.KAC ?? 78) * 0.5,
}

/** Engine composites per group, shown as the first (bold) rating columns. */
export const COMPOSITES: Record<string, Composite[]> = {
  ALL: [],
  QB: [QB_ACCURACY],
  RB: [sep('SRR', 'short'), sep('MRR', 'mid'), sep('DRR', 'deep'), HANDS, ELUSIVE],
  FB: [RUN_BLOCK, HANDS],
  WR: [sep('SRR', 'short'), sep('MRR', 'mid'), sep('DRR', 'deep'), HANDS],
  TE: [sep('SRR', 'short'), sep('MRR', 'mid'), sep('DRR', 'deep'), HANDS],
  OL: [PASS_PRO, RUN_BLOCK],
  DL: [PASS_RUSH, RUN_STOP],
  LB: [RUN_FIT, MAN, ZONE],
  CB: [MAN, ZONE],
  S: [MAN, ZONE],
  'K/P': [LEG],
}
