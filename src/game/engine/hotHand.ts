// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #42 — in-game confidence / hot hand (INDIVIDUAL, per player).
//
// WHAT ALREADY EXISTS (audited before writing a line — nothing is forked):
//   · `clutch.ts`  — a stable 1–99 clutch read per player (`clutchOf`, hash +
//     `Clutch` trait + AWR-vs-position-mean), used only in late-and-close snaps.
//     It is the one existing "composure" read; this job REUSES it.
//   · `character.ts` — hidden workEthic / coachability / maturity (0–100), used
//     for development and bust risk. The maturity/coachability block is the
//     "keeps his head" signal; this job READS it (never rewrites it).
//   · `personality.ts` — contract priorities only (money/winning/loyalty/…).
//     Audited: nothing in it is about in-game behaviour, so it is NOT used.
//   · `playsim.ts` — one game loop (`step` → `applyScrimmageOutcome` /
//     `resolvePass` / `resolveRun` / `resolveSpecial`), one `GameState` per game
//     (in memory only, never serialized), per-player in-game `fat` / `snaps`
//     maps, `SimEnv` carrying live per-player state into the resolvers, and the
//     `setStamina`/`CLUTCH`/`R2PERSONALITY` toggle pattern. This job extends
//     exactly that machinery: one `HOT` const object, one toggle, one map on
//     `GameState`, one hook per play, one small execution term per resolver.
//
// DESIGN
//   A player carries an in-game confidence `c ∈ [−1, +1]` (0 = neutral, absent
//   from the map). Nothing is ever stored outside the game: the map is created
//   in `createGame`, decays on every possession change, and dies with the game.
//   Therefore no save field changes and an old save loads unchanged.
//
//   `c` moves with HIS OWN plays only — never a team or unit average:
//     WR/TE/RB catch +, contested catch more, TD more, drop −, targeted miss −;
//     CB beaten for a completion − (much more on a deep ball), break-up +
//     interception +; QB completion +, TD +, sack −, interception −−;
//     RB big run +, carry for a loss −, fumble −−, TD +;
//     K made field goal +, miss −.
//   Every trigger is read off the play record the resolver already produced, so
//   the update draws NO rng: the whole feature is deterministic from the play
//   key and the pre-play confidence. The OFF path is byte-identical.
//
//   SIZE and RECOVERY come from the man's OWN composure:
//     `composureOf(p)` = 0.40·clutch (reused) + 0.25·AWR-vs-its-own-position-mean
//                       + 0.20·character maturity/coachability/workEthic
//                       + 0.15·experience (age proxy)
//     amplitude  = 1.55 (no composure) … 0.45 (elite)  → his swings, both ways
//     per-drive decay = 0.82 (no composure) … 0.50 (elite) → how fast he settles
//   A poor-composure man therefore rides a ~3× bigger wave and cools slower; an
//   elite one is damped and recovers inside a drive. That is the elite-vs-poor
//   spread this job is asked for, and it is symmetric (amplitude scales hot and
//   cold alike).
//
//   A man the game has NOT moved today is exactly NEUTRAL: `hotShiftOf` returns 0
//   for an absent id, so the layer only perturbs a play for a man who has
//   actually done something, and a present man is read only above/below what his
//   role normally carries (the measured present-man mean, see HOT.center*).
//
//   EXECUTION (probability points at a FULL deviation from his role's level —
//   deliberately small; the measured numbers are in the probe):
//     his own catch prob ±0.021, the QB's completion ±0.013 and interception
//     rate ∓30% relative, the cover man's coverage ∓0.014, the kicker's make
//     chance ±0.032, a cold back's ball security ∓28% relative. The QB and the
//     coordinator also lean on the hot receiver: +5 score units of target share
//     at a full deviation (softmax τ = 54, i.e. ≈ +10% weight on the hot man).
//
// NFL TRUTH (measured, cited — the effect must be SMALL, the spread must not be)
//   · Gilovich, Vallone & Tversky (1985) found no hot hand in shooting; Miller &
//     Sanjurjo (2018, Econometrica 86(6)) proved that test was biased and, after
//     correction, the same data show a real effect: +5.4 pp after two hits and
//     +10 pp after four, +8 pp across 28 years of NBA shooting.
//   · NBA free throws (Arkes 2010): +3 pp after a make; four in a row +4.5 pp
//     ("Hot Shots", NBER WP 26510, 2020). Field goals: no measurable effect —
//     defences adjust, which is exactly why football should sit at the LOW end.
//   · Green & Zwiebel (2018, Management Science 64(11)) measure the hot hand in
//     MLB, where defences cannot load up on a man: hot−cold ≈ +1.6 pp of batting
//     average and +2.8 pp of on-base (≈ +19% relative, a real but small edge).
//   · Football is between the two (a defence CAN double the hot receiver), so
//     this job targets a LEAGUE-WIDE streakiness of ~1–3 pp (catch/completion
//     rate after a hot streak minus after a cold one), with individual hot/cold
//     men swinging up to ~4 pp — see the probe (`logs/fut42-probe.mjs`).
//
// Every export below is pure except `applyPlayConfidence` / `applyKickConfidence`
// / `decayHot`, which only ever touch the game's own `hot` map and the play
// record's `hot` delta field (used by the UI and the probe to fold the state).
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import type { World } from './generate'
import { clamp } from './rng'
import { clutchOf } from './clutch'
import { depthGroup } from './depth'
import { POS_MEAN } from './ratingMeans'

// ── Tunables: the whole feature, one object ──────────────────────────────────
export const HOT = {
  /** How far one man's confidence can travel, either way. */
  bound: 1,
  // ── the man's own composure decides size and recovery ──────────────────────
  /** Event amplitude for a man with no composure at all … an elite one. */
  ampPoor: 1.55,
  ampElite: 0.45,
  /** Per-drive decay toward neutral: poor … elite (smaller = faster recovery). */
  decPoor: 0.82,
  decElite: 0.5,
  /**
   * How far a man's composure is stretched away from the league's centre before
   * it sets his amplitude. The four inputs are each noisy, so their weighted
   * mean collapses toward 0.5; the stretch restores the individual spread the
   * user asked for (a poor-composure man and an elite one are 3x apart) while
   * leaving the league mean — and therefore the league's own numbers — alone.
   */
  compStretch: 1.7,
  /** Composure weights (they sum to 1; see `composureOf`). */
  wClutch: 0.4,
  wAwr: 0.25,
  wCharacter: 0.2,
  wExp: 0.15,
  // ── event sizes, in confidence points before the man's own amplitude ───────
  /** A catch. */
  catch: 0.34,
  /** …worth this much more when the catch was contested (tight window). */
  catchContested: 0.3,
  /** A catch that finishes in the end zone. */
  catchTd: 0.2,
  /** A dropped catchable ball — the classic "he's in his own head" event. */
  drop: 0.55,
  /** A targeted incompletion that was not his fault. */
  miss: 0.1,
  /** The QB completing a ball. */
  qbComp: 0.16,
  /** …a passing touchdown. */
  qbTd: 0.24,
  /** The QB throwing an interception. */
  int: 0.85,
  /** …and being sacked. */
  sack: 0.18,
  /** The defender who picked the ball off. */
  pickGain: 0.55,
  /** A pass break-up by the cover man. */
  pbu: 0.25,
  /** A cover man beaten for a completion. */
  covAllow: 0.14,
  /** …beaten DEEP (the CB's classic confidence hit). */
  covDeep: 0.4,
  /** Deep-ball depth that counts as "beaten deep" (yards). */
  deepYd: 15,
  /** A carry of 10+ / 5–9 yards, a carry for a loss. */
  runBig: 0.22,
  runMid: 0.1,
  runLoss: 0.06,
  /** A lost/the offence's own fumble by the carrier — the biggest cold event. */
  runFumble: 0.9,
  /** A rushing touchdown. */
  runTd: 0.25,
  /** A made field goal / a missed one (a blocked one lands in between). */
  kickGood: 0.45,
  kickMiss: 0.75,
  kickBlocked: 0.6,
  // ── execution edges (probability points at full confidence) ────────────────
  /**
   * THE LEVEL EACH ROLE NORMALLY CARRIES — measured, not assumed (probe section
   * [0], ~450 games): a man who has MOVED today reads QB +0.50, receiver +0.32,
   * cover man −0.21, kicker +0.17. A man with no movement at all today reads
   * exactly 0 and contributes exactly 0 (`hotShiftOf`), so the layer never
   * perturbs a play for a man the game has not moved — a fresh man is NEUTRAL,
   * not "below his role". Only a present man's deviation from his role's level
   * moves a probability — the same centring device `MU_CENTER.comp` and
   * `skillCentre` use. Without it the league itself moves (measured: completion
   * +1.1 pt, interceptions −15%, points +1.0 a game). With it the league's rates
   * hold and only the spread of individual form moves.
   */
  centerQb: 0.5,
  centerRec: 0.32,
  centerCov: -0.21,
  centerK: 0.17,
  /** The receiver's OWN catch probability. */
  catchW: 0.018,
  /** The QB's OWN completion probability. */
  qbW: 0.011,
  /** …and his interception rate (relative, at −1 deviation). */
  qbInt: 0.26,
  /** The cover man's own coverage (subtracted from the completion). */
  cbW: 0.012,
  /** The kicker's OWN make probability. */
  kickW: 0.03,
  /** Target-share lean toward the hot receiver (score units, softmax τ = 54). */
  tgtScore: 5,
  /** A cold back protects the ball less (relative, at −1 deviation). */
  rbFumble: 0.26,
  // ── housekeeping / UI ─────────────────────────────────────────────────────
  /** Below this the map drops the man (and the fold records the removal). */
  prune: 0.02,
  /** A player shows the flame/ice chip from this |confidence| up. */
  chipMin: 0.25,
  /** "Hot" / "cold" wording starts here. */
  chipHot: 0.6,
} as const

// ── Toggle (the `setStamina` pattern) ────────────────────────────────────────
let HOT_ON = true

/** OFF makes every confidence effect exactly 0 and records no `hot` field, so
 *  the play-by-play (and the calibration) is byte-identical to the pre-feature
 *  build. A probe restores it with `getHotHand()`. */
export function setHotHand(on: boolean): void {
  HOT_ON = on
}

export function getHotHand(): boolean {
  return HOT_ON
}

/** Confidence per player id; an absent id is exactly neutral (0). */
export type HotMap = Record<string, number>

/** Positions whose in-game confidence is a pass-catcher's (the receiving role). */
const SKILL_POS = new Set(['WR', 'TE', 'RB', 'FB'])

/** The shape `applyPlayConfidence` needs from the game (a `GameState` fits). */
export interface HotGameState {
  hot: HotMap
  plays: { offId: string; hot?: HotMap }[]
  /** The game's own O(1) player index (`GameState.pIndex`). */
  pIndex: Map<string, Player>
}

/** The fields of a resolved play this feature reads. A `PlayOutcome` fits. */
export interface HotPlay {
  type: string
  result?: string
  yards?: number
  turnover?: boolean
  targetId?: string
  carrierId?: string
  qbId?: string
  sackId?: string
  intId?: string
  dropId?: string
  pbuId?: string
  coverId?: string
  coverDefenderId?: string
  reception?: boolean
  fumbleId?: string
  muffedCatch?: boolean
  scorerId?: string
  passDepth?: number
  defTD?: boolean
  spike?: boolean
  throwAway?: boolean
  blockedKick?: boolean
  separationYd?: number
  coverTag?: string
  hot?: HotMap
}

// ── The man's own composure ──────────────────────────────────────────────────
/**
 * How much composure this specific man has (0 = none, 1 = elite), from HIS OWN
 * clutch read (reused), HIS OWN awareness against his own position's mean, his
 * own character facets and his own experience. No league or unit average is
 * involved: every input is the individual's.
 */
export function composureOf(p: Player): number {
  const clutchT = clamp(0.5 + ((clutchOf(p) - 50) / 30) * 0.5, 0, 1)
  const c = p.character
  const charT = c
    ? clamp(0.5 + ((c.maturity * 0.5 + c.coachability * 0.3 + c.workEthic * 0.2) - 55) / 45 * 0.5, 0, 1)
    : 0.5
  const awr = p.attrs?.AWR
  const mean = POS_MEAN[p.pos]?.AWR
  const awrT = awr !== undefined && mean !== undefined ? clamp(0.5 + ((awr - mean) / 24) * 0.5, 0, 1) : 0.5
  const expT = clamp((Math.max(0, p.age - 22) / 10), 0, 1)
  const raw = HOT.wClutch * clutchT + HOT.wAwr * awrT + HOT.wCharacter * charT + HOT.wExp * expT
  return clamp(0.5 + (raw - 0.5) * HOT.compStretch, 0, 1)
}

/** How far this man's confidence travels on one event (poor men swing wider). */
export function ampOf(p: Player): number {
  const t = composureOf(p)
  return HOT.ampPoor + (HOT.ampElite - HOT.ampPoor) * t
}

/** How much of his confidence this man keeps across a drive boundary. */
export function decayOf(p: Player): number {
  const t = composureOf(p)
  return HOT.decPoor + (HOT.decElite - HOT.decPoor) * t
}

/** The current confidence of a player on the field (0 when neutral/absent). */
export function hotOf(hot: HotMap | undefined, id: string | undefined): number {
  if (!hot || !id) return 0
  return hot[id] ?? 0
}

/** The role a man's confidence is centred on (his own side of the ball). */
export function centerFor(pos: string | undefined): number {
  if (pos === 'QB') return HOT.centerQb
  if (pos === 'K' || pos === 'P') return HOT.centerK
  return SKILL_POS.has(pos ?? '') ? HOT.centerRec : HOT.centerCov
}

/** A man's confidence relative to what his role normally carries (the UI chip:
 *  hot = above his own norm today). `undefined` = the game has not moved him, so
 *  he reads exactly neutral (0). */
export function hotShift(p: Player | undefined, c: number | undefined): number {
  return c === undefined ? 0 : c - centerFor(p?.pos)
}

/** The same, straight off a map. A man with NO entry today is NEUTRAL and
 *  contributes exactly 0 — the layer never perturbs a play for a man it has not
 *  moved, and only a present man's deviation from his role's level is used. */
export function hotShiftOf(hot: HotMap | undefined, p: Player | undefined): number {
  if (!hot || !p) return 0
  const c = hot[p.id]
  return c === undefined ? 0 : c - centerFor(p.pos)
}

// ── Execution edges read by the resolvers (pure; 0 when off) ─────────────────
/**
 * The pass-execution edge from the three men actually involved — the thrower,
 * the target and the cover man, each on his OWN confidence above what his role
 * normally carries. Never a unit mean. Returns extra completion probability
 * points and the QB's interception multiplier (1 when neutral).
 */
export function hotPassEdge(
  hot: HotMap | undefined,
  qb: Player | undefined,
  target: Player | undefined,
  cover: Player | undefined,
): { comp: number; intMult: number } {
  if (!HOT_ON || !hot) return { comp: 0, intMult: 1 }
  const q = hotShiftOf(hot, qb)
  const t = hotShiftOf(hot, target)
  const c = hotShiftOf(hot, cover)
  const comp = q * HOT.qbW + t * HOT.catchW - c * HOT.cbW
  return { comp: comp === 0 ? 0 : comp, intMult: q === 0 ? 1 : 1 - q * HOT.qbInt }
}

/** The kicker's own make-probability offset (probability points; 0 when off). */
export function hotKickEdge(hot: HotMap | undefined, kicker: Player | undefined): number {
  if (!HOT_ON) return 0
  const k = hotShiftOf(hot, kicker)
  return k === 0 ? 0 : k * HOT.kickW
}

/** The carrier's ball-security multiplier (a cold back protects it less). */
export function hotCarrySecurity(hot: HotMap | undefined, carrier: Player | undefined): number {
  if (!HOT_ON || !carrier) return 1
  const c = hotShiftOf(hot, carrier)
  return c === 0 ? 1 : 1 - c * HOT.rbFumble
}

/** The target-share score a hot receiver earns (score units; softmax τ = 54). */
export function hotTargetScore(hot: HotMap | undefined, p: Player | undefined): number {
  if (!HOT_ON) return 0
  const c = hotShiftOf(hot, p)
  return c === 0 ? 0 : c * HOT.tgtScore
}

// ── The per-play update (deterministic; no rng draw of any kind) ─────────────
function bump(s: HotGameState, out: HotPlay, p: Player | undefined, delta: number): void {
  if (!p || delta === 0) return
  const before = s.hot[p.id] ?? 0
  const moved = clamp(before + delta * ampOf(p), -HOT.bound, HOT.bound) - before
  if (moved === 0) return
  const after = before + moved
  // The same prune rule the fold uses, so the play log reproduces the map exactly.
  if (Math.abs(after) < HOT.prune) delete s.hot[p.id]
  else s.hot[p.id] = after
  ;(out.hot ??= {})[p.id] = (out.hot[p.id] ?? 0) + moved
}

/** A new possession: everyone on both clubs cools toward neutral by his own rate. */
function decayAll(s: HotGameState, out: HotPlay): void {
  for (const [id, v] of Object.entries(s.hot)) {
    const p = s.pIndex.get(id)
    if (!p) continue
    const after = v * decayOf(p)
    const moved = (Math.abs(after) < HOT.prune ? 0 : after) - v
    if (Math.abs(after) < HOT.prune) delete s.hot[id]
    else s.hot[id] = after
    ;(out.hot ??= {})[id] = (out.hot[id] ?? 0) + moved
  }
}

/** The drive test: the first play of a possession follows a play by the other club. */
function beginPlay(s: HotGameState, out: HotPlay, offId: string): void {
  const prev = s.plays[s.plays.length - 1]
  if (!prev || prev.offId !== offId) decayAll(s, out)
}

/** A pass: the target, the thrower and the cover man move on their own plays. */
function passEvents(s: HotGameState, out: HotPlay): void {
  const tgt = s.pIndex.get(out.targetId ?? '')
  const qb = s.pIndex.get(out.qbId ?? '')
  const cov = s.pIndex.get(out.coverDefenderId ?? out.coverId ?? '')
  // The interceptor is the defence's man; he is on the other club of this play.
  const pick = s.pIndex.get(out.intId ?? '')
  const deep = (out.passDepth ?? 0) >= HOT.deepYd
  const contested = out.coverTag === 'tight' || out.coverTag === 'bust' || (out.separationYd ?? 9) <= 1.2
  if (out.intId) {
    bump(s, out, qb, -HOT.int)
    bump(s, out, pick, HOT.pickGain)
    return
  }
  if (out.sackId) {
    bump(s, out, qb, -HOT.sack)
    return
  }
  const complete = out.result !== 'Incomplete' && !!out.targetId
  if (complete) {
    const td = !out.defTD && !!out.scorerId && out.scorerId === out.targetId
    bump(s, out, tgt, HOT.catch * (contested ? 1 + HOT.catchContested : 1) + (td ? HOT.catchTd : 0))
    bump(s, out, qb, HOT.qbComp + (td ? HOT.qbTd : 0))
    bump(s, out, cov, -(deep ? HOT.covDeep : HOT.covAllow))
    return
  }
  // An incompletion: a genuine drop chills the receiver, an uncatchable ball barely.
  if (out.dropId) bump(s, out, s.pIndex.get(out.dropId), -HOT.drop)
  else if (out.targetId) bump(s, out, tgt, -HOT.miss)
  if (out.pbuId) bump(s, out, s.pIndex.get(out.pbuId), HOT.pbu)
}

/** A carry: the runner's own day (and his own fumble) moves him. */
function runEvents(s: HotGameState, out: HotPlay): void {
  const c = s.pIndex.get(out.carrierId ?? '')
  if (!c) return
  if (out.turnover || out.fumbleId) {
    bump(s, out, c, -HOT.runFumble)
    return
  }
  const td = !!out.scorerId && out.scorerId === out.carrierId
  const y = out.yards ?? 0
  const d = (y >= 10 ? HOT.runBig : y >= 5 ? HOT.runMid : y < 0 ? -HOT.runLoss : 0) + (td ? HOT.runTd : 0)
  if (d) bump(s, out, c, d)
}

/**
 * Move every player's in-game confidence for one scrimmage play, and record the
 * movement on the play (`out.hot`) so the UI and the probe can fold the state
 * from the play log alone. Called from `applyScrimmageOutcome` before the play
 * is pushed; draws no rng and reads only the resolved outcome.
 */
export function applyPlayConfidence(s: HotGameState, out: HotPlay, offId: string): void {
  if (!HOT_ON) return
  beginPlay(s, out, offId)
  if (out.type === 'pass') passEvents(s, out)
  else if (out.type === 'run') runEvents(s, out)
  if (out.hot && Object.keys(out.hot).length === 0) out.hot = undefined
}

/**
 * Move the kicker's own in-game confidence for one field-goal attempt (the
 * kicker is the club's own K; his confidence never touches anyone else's).
 */
export function applyKickConfidence(world: World, s: HotGameState, out: HotPlay, offId: string): void {
  if (!HOT_ON) return
  beginPlay(s, out, offId)
  const k = s.pIndex.get(kickIdOf(world, offId) ?? '')
  if (k) bump(s, out, k, out.turnover ? (out.blockedKick ? -HOT.kickBlocked : -HOT.kickMiss) : HOT.kickGood)
  if (out.hot && Object.keys(out.hot).length === 0) out.hot = undefined
}

/** The club's own kicker id (the same man `resolveSpecial` kicks with). */
let kickCache = new WeakMap<World, Map<string, string | undefined>>()
export function kickIdOf(world: World, teamId: string): string | undefined {
  let m = kickCache.get(world)
  if (!m) {
    m = new Map()
    kickCache.set(world, m)
  }
  if (!m.has(teamId)) m.set(teamId, depthGroup(world, teamId, ['K'], 1)[0]?.id)
  return m.get(teamId)
}

// ── The fold: rebuild the confidence map from the play log ───────────────────
/**
 * Fold the play log (optionally only the first `upto` plays) into the
 * confidence map the game held at that moment. Pure, and the only thing the UI
 * and the probe need: the map is exactly what the sim used.
 */
export function hotAt(plays: { hot?: HotMap }[], upto?: number): HotMap {
  const map: HotMap = {}
  const last = upto === undefined ? plays.length : Math.min(plays.length, upto + 1)
  for (let i = 0; i < last; i++) {
    const d = plays[i]?.hot
    if (!d) continue
    for (const [id, v] of Object.entries(d)) {
      const after = (map[id] ?? 0) + v
      if (Math.abs(after) < HOT.prune) delete map[id]
      else map[id] = after
    }
  }
  return map
}

/** How hot/cold a man reads, for the UI chip and the probes. Takes his
 *  confidence relative to his role's own level (see `hotShift`). */
export function hotRead(c: number | undefined): { hot: boolean; label: string; tone: 'hot' | 'cold' } | null {
  if (c === undefined || Math.abs(c) < HOT.chipMin) return null
  const hot = c > 0
  const strong = Math.abs(c) >= HOT.chipHot
  return {
    hot,
    tone: hot ? 'hot' : 'cold',
    label: hot ? (strong ? 'On fire' : 'Warming') : strong ? 'Frozen' : 'Cooling',
  }
}
