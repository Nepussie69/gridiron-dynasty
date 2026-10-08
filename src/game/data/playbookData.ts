// ─────────────────────────────────────────────────────────────────────────────
// Playbook data (L12.10 B2).
//
// Formations × concepts, each play a personnel grouping plus an assignment for
// every position (a route, a blocking job, or a run path). Names are ordinary
// football terminology — Mesh, Smash, Flood, Levels, Dagger, Mills, Drive,
// Stick, Snag, Curl-Flat, Shallow Cross, Four Verts, Sail, Spacing, Bench,
// Y-Cross, Scissors, Hank, Texas, Inside/Outside Zone, Power, Counter, Trap,
// Duo, Iso, Toss, Pin-Pull, Draw, Sneak, Read Option, Jet Sweep — organised by
// formation like a real playbook. No proprietary play names or data.
//
// The sim draws each scheme's menu from this list (L12.10 B3); the animation
// reads the same assignments to draw any play (L12.10 B4).
// ─────────────────────────────────────────────────────────────────────────────

export type Personnel = '00' | '10' | '11' | '12' | '13' | '21' | '22' | 'GL'
export type OffPos = 'QB' | 'RB' | 'FB' | 'TE' | 'WR1' | 'WR2' | 'WR3' | 'OL'
export type Job = 'route' | 'run' | 'run-block' | 'pass-block' | 'play-action' | 'punt'

export interface Assignment {
  pos: OffPos
  job: Job
  /** Route key from `routes.ts` when job === 'route'. */
  route?: string
  /** Run lane when job === 'run'. */
  gap?: 'left' | 'right' | 'middle' | 'outside'
}

export interface PlaybookPlay {
  /** Generic concept name — also the sim's concept name. */
  name: string
  formation: string
  personnel: Personnel
  type: 'run' | 'pass'
  depth: number
  yac: number
  description: string
  assignments: Assignment[]
}

export interface Formation {
  name: string
  personnel: Personnel
  /** True when a fullback lines up (21/22/Goal-line). */
  fullback: boolean
  /** Roughly how many receivers are split wide. */
  wide: 0 | 1 | 2 | 3 | 4
}

export const FORMATIONS: Formation[] = [
  { name: 'Gun Trips', personnel: '11', fullback: false, wide: 3 },
  { name: 'Gun Doubles', personnel: '11', fullback: false, wide: 2 },
  { name: 'Gun Bunch', personnel: '11', fullback: false, wide: 3 },
  { name: 'Gun Empty', personnel: '10', fullback: false, wide: 4 },
  { name: 'Singleback Ace', personnel: '12', fullback: false, wide: 2 },
  { name: 'Singleback Doubles', personnel: '11', fullback: false, wide: 2 },
  { name: 'I-Form Pro', personnel: '21', fullback: true, wide: 2 },
  { name: 'I-Form Twins', personnel: '21', fullback: true, wide: 3 },
  { name: 'Pistol', personnel: '11', fullback: false, wide: 2 },
  { name: 'Strong I', personnel: '22', fullback: true, wide: 1 },
  { name: 'Weak I', personnel: '21', fullback: true, wide: 2 },
  { name: 'Goal Line', personnel: 'GL', fullback: true, wide: 0 },
]

const FB_FORMATIONS = new Set(FORMATIONS.filter((f) => f.fullback).map((f) => f.name))
export function formationHasFullback(formation: string): boolean {
  return FB_FORMATIONS.has(formation)
}

// ── Assignment helpers ───────────────────────────────────────────────────────
const R = (pos: OffPos, route: string): Assignment => ({ pos, job: 'route', route })
const RB_ = (pos: OffPos, gap: Assignment['gap']): Assignment => ({ pos, job: 'run', gap })
const BLK = (pos: OffPos, job: Job = 'pass-block'): Assignment => ({ pos, job })

/**
 * The animation's actor tree for a play: receiver key → route key. Only the
 * five skill keys the viewer draws (wr0/wr1/wr2/te/rb) matter here.
 */
export function treeFor(play: PlaybookPlay): Record<string, string> {
  const tree: Record<string, string> = {}
  const map: Record<string, string> = { WR1: 'wr0', WR2: 'wr1', WR3: 'wr2', TE: 'te', RB: 'rb', FB: 'fb' }
  for (const a of play.assignments) {
    const key = map[a.pos]
    if (key && a.job === 'route' && a.route) tree[key] = a.route
  }
  return tree
}

// ── The playbook ─────────────────────────────────────────────────────────────
// Every entry lists a personnel grouping and an assignment per position. The
// scheme menus below reproduce the sim's existing concepts exactly, so
// calibration is unchanged (L12.10 B3); the rest complete the playbook for the
// play-calling UI and the animation (L12.10 B4/B6).

export const PLAYBOOK: PlaybookPlay[] = [
  // ── Air Raid / vertical passing ────────────────────────────────────────────
  { name: 'Four Verticals', formation: 'Gun Empty', personnel: '10', type: 'pass', depth: 20, yac: 0.4, description: 'Four receivers go deep: a shot at a big play', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'go'), R('WR2', 'go'), R('WR3', 'seam'), R('TE', 'seam'), R('RB', 'check')] },
  { name: 'Y-Cross', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 12, yac: 0.6, description: 'A deep crossing route behind the linebackers', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'post'), R('WR2', 'go'), R('WR3', 'dig'), R('TE', 'cross'), R('RB', 'check')] },
  { name: 'Mesh', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 6, yac: 0.8, description: 'Two receivers cross underneath: quick, safe yards', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'curl'), R('WR2', 'curl'), R('WR3', 'meshIn'), R('TE', 'meshIn'), R('RB', 'flat')] },
  { name: 'Smash', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 11, yac: 0.5, description: 'Corner route over a short curl: beats cover 2', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'hitch'), R('WR2', 'hitch'), R('WR3', 'corner'), R('TE', 'dig'), R('RB', 'check')] },
  { name: 'RB Screen', formation: 'Singleback Ace', personnel: '12', type: 'pass', depth: 1, yac: 1.0, description: 'Dump to the back behind blockers: punishes the blitz', assignments: [R('OL', 'screen'), BLK('QB'), R('WR1', 'stalk'), R('WR2', 'stalk'), R('WR3', 'stalk'), R('TE', 'block'), R('RB', 'swing')] },
  { name: 'Inside Zone', formation: 'Singleback Ace', personnel: '12', type: 'run', depth: 4, yac: 0, description: 'Downhill run between the tackles', assignments: [BLK('QB', 'play-action'), RB_('RB', 'middle'), RB_('FB', 'middle'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Flood', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 12, yac: 0.6, description: 'Three routes at three levels to one side', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'go'), R('WR2', 'out'), R('WR3', 'flat'), R('TE', 'corner'), R('RB', 'check')] },
  { name: 'Levels', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 12, yac: 0.5, description: 'Two in-breaking routes at different depths', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'dig'), R('WR2', 'shallow'), R('WR3', 'curl'), R('TE', 'stick'), R('RB', 'check')] },
  { name: 'Dagger', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 14, yac: 0.5, description: 'A deep dig behind a clearing post', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'post'), R('WR2', 'dig'), R('WR3', 'drag'), R('TE', 'stick'), R('RB', 'check')] },
  { name: 'Mills', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 18, yac: 0.4, description: 'A deep over route behind a dig', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'dig'), R('WR2', 'over'), R('WR3', 'out'), R('TE', 'seam'), R('RB', 'check')] },
  { name: 'Drive', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 12, yac: 0.6, description: 'A deep cross with a shallow route underneath', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'cross'), R('WR2', 'shallow'), R('WR3', 'hitch'), R('TE', 'dig'), R('RB', 'check')] },
  { name: 'Stick', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 6, yac: 0.8, description: 'Stick route with a flat and a go to stress the flat defender', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'go'), R('WR2', 'out'), R('WR3', 'flat'), R('TE', 'stick'), R('RB', 'check')] },
  { name: 'Snag', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 6, yac: 0.8, description: 'A snag (slant-and-out) with a corner behind it', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'corner'), R('WR2', 'whip'), R('WR3', 'flat'), R('TE', 'hitch'), R('RB', 'check')] },
  { name: 'Curl-Flat', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 8, yac: 0.8, description: 'A curl over a flat: high-low the outside defender', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'curl'), R('WR2', 'flat'), R('WR3', 'hitch'), R('TE', 'curl'), R('RB', 'check')] },
  { name: 'Shallow Cross', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 6, yac: 0.9, description: 'A shallow crosser with a deep over route', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'over'), R('WR2', 'shallow'), R('WR3', 'flat'), R('TE', 'drag'), R('RB', 'check')] },
  { name: 'Sail', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 14, yac: 0.5, description: 'A deep corner over a short out and a flat', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'corner'), R('WR2', 'out'), R('WR3', 'flat'), R('TE', 'seam'), R('RB', 'check')] },
  { name: 'Spacing', formation: 'Gun Bunch', personnel: '11', type: 'pass', depth: 5, yac: 0.9, description: 'Three short routes spread the zone thin', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'hitch'), R('WR2', 'out'), R('WR3', 'sit'), R('TE', 'flat'), R('RB', 'check')] },
  { name: 'Bench', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 10, yac: 0.6, description: 'Out, corner and a deep route to the same side', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'out'), R('WR2', 'corner'), R('WR3', 'go'), R('TE', 'stick'), R('RB', 'check')] },
  { name: 'Scissors', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 18, yac: 0.5, description: 'A post and a corner crossing deep', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'post'), R('WR2', 'corner'), R('WR3', 'dig'), R('TE', 'seam'), R('RB', 'check')] },
  { name: 'Hank', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 8, yac: 0.8, description: 'Hitch, angle and a flat to one side', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'hitch'), R('WR2', 'angle'), R('WR3', 'flat'), R('TE', 'stick'), R('RB', 'swing')] },
  { name: 'Texas', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 7, yac: 0.8, description: 'A back on a Texas (shallow) route behind the line', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'dig'), R('WR2', 'out'), R('WR3', 'hitch'), R('TE', 'stick'), R('RB', 'shallow')] },
  { name: 'Post-Corner', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 22, yac: 0.4, description: 'A double move: post then corner', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'postCorner'), R('WR2', 'go'), R('WR3', 'out'), R('TE', 'stick'), R('RB', 'check')] },
  { name: 'Out and Up', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 20, yac: 0.4, description: 'A double move: out then up the sideline', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'outUp'), R('WR2', 'go'), R('WR3', 'hitch'), R('TE', 'stick'), R('RB', 'check')] },
  { name: 'Sluggo', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 28, yac: 0.3, description: 'Slant-and-go: sell the slant then take off', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'sluggo'), R('WR2', 'go'), R('WR3', 'dig'), R('TE', 'seam'), R('RB', 'check')] },
  // ── Pro style / play action ────────────────────────────────────────────────
  { name: 'Play Action Deep', formation: 'I-Form Pro', personnel: '21', type: 'pass', depth: 22, yac: 0.3, description: 'Fake the run, then throw deep', assignments: [BLK('OL'), BLK('QB', 'play-action'), R('WR1', 'post'), R('WR2', 'go'), R('WR3', 'seam'), R('TE', 'seam'), R('RB', 'runFake'), BLK('FB', 'run-block')] },
  { name: 'PA Cross', formation: 'I-Form Pro', personnel: '21', type: 'pass', depth: 14, yac: 0.5, description: 'Fake the run, hit a crosser over the middle', assignments: [BLK('OL'), BLK('QB', 'play-action'), R('WR1', 'post'), R('WR2', 'go'), R('WR3', 'dig'), R('TE', 'cross'), R('RB', 'runFake'), BLK('FB', 'run-block')] },
  { name: 'Bootleg', formation: 'Singleback Ace', personnel: '12', type: 'pass', depth: 8, yac: 0.7, description: 'QB rolls out away from the run fake', assignments: [BLK('OL'), BLK('QB', 'play-action'), R('WR1', 'comeback'), R('WR2', 'over'), R('WR3', 'stick'), R('TE', 'drag'), BLK('RB', 'run-block')] },
  { name: 'Power', formation: 'I-Form Pro', personnel: '21', type: 'run', depth: 3, yac: 0, description: 'Pulling guard leads a run off tackle', assignments: [BLK('QB', 'play-action'), RB_('RB', 'right'), RB_('FB', 'right'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Counter', formation: 'I-Form Pro', personnel: '21', type: 'run', depth: 3, yac: 0, description: 'A misdirection run behind a pulling guard', assignments: [BLK('QB', 'play-action'), RB_('RB', 'left'), RB_('FB', 'left'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Iso', formation: 'I-Form Twins', personnel: '21', type: 'run', depth: 3, yac: 0, description: 'The fullback leads the back into the hole', assignments: [BLK('QB', 'play-action'), RB_('RB', 'middle'), RB_('FB', 'middle'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Duo', formation: 'Strong I', personnel: '22', type: 'run', depth: 4, yac: 0, description: 'Two-back downhill run with a double-team', assignments: [BLK('QB', 'play-action'), RB_('RB', 'middle'), RB_('FB', 'middle'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Trap', formation: 'Weak I', personnel: '21', type: 'run', depth: 4, yac: 0, description: 'A pulling lineman traps the first defender', assignments: [BLK('QB', 'play-action'), RB_('RB', 'middle'), RB_('FB', 'left'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Toss', formation: 'I-Form Pro', personnel: '21', type: 'run', depth: 5, yac: 0, description: 'A quick toss to the back on the edge', assignments: [BLK('QB', 'play-action'), RB_('RB', 'outside'), RB_('FB', 'left'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Pin-Pull', formation: 'Strong I', personnel: '22', type: 'run', depth: 5, yac: 0, description: 'Linemen pin inside and pull to the edge', assignments: [BLK('QB', 'play-action'), RB_('RB', 'outside'), RB_('FB', 'right'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Draw', formation: 'Gun Doubles', personnel: '11', type: 'run', depth: 4, yac: 0, description: 'Show pass, then hand off on a delayed draw', assignments: [BLK('QB', 'play-action'), RB_('RB', 'middle'), BLK('OL', 'run-block')] },
  { name: 'Sneak', formation: 'Goal Line', personnel: 'GL', type: 'run', depth: 1, yac: 0, description: 'The quarterback sneaks behind the line', assignments: [R('QB', 'block'), RB_('RB', 'middle'), RB_('FB', 'middle'), BLK('OL', 'run-block')] },
  // ── Spread / RPO / zone ────────────────────────────────────────────────────
  { name: 'Four Verts', formation: 'Gun Empty', personnel: '10', type: 'pass', depth: 17, yac: 0.4, description: 'Four receivers go deep: a shot at a big play', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'go'), R('WR2', 'go'), R('WR3', 'seam'), R('TE', 'seam'), R('RB', 'check')] },
  { name: 'Quick Slant', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 5, yac: 0.9, description: 'One-step slant: ball out fast', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'slant'), R('WR2', 'slant'), R('WR3', 'quickOut'), R('TE', 'stick'), R('RB', 'flat')] },
  { name: 'Slant', formation: 'Gun Doubles', personnel: '11', type: 'pass', depth: 5, yac: 0.9, description: 'One-step slant: ball out fast', assignments: [BLK('OL'), BLK('QB'), R('WR1', 'slant'), R('WR2', 'slant'), R('WR3', 'quickOut'), R('TE', 'stick'), R('RB', 'flat')] },
  { name: 'RPO Bubble', formation: 'Gun Trips', personnel: '11', type: 'pass', depth: 2, yac: 1.0, description: 'QB reads the defense: hand off or flip a bubble screen', assignments: [BLK('OL'), BLK('QB', 'play-action'), R('WR1', 'stalk'), R('WR2', 'stalk'), R('WR3', 'bubble'), R('TE', 'block'), R('RB', 'runFake')] },
  { name: 'RPO Pass', formation: 'Singleback Doubles', personnel: '11', type: 'pass', depth: 8, yac: 0.8, description: 'QB reads a linebacker, then throws behind him', assignments: [BLK('OL'), BLK('QB', 'play-action'), R('WR1', 'go'), R('WR2', 'stalk'), R('WR3', 'glance'), R('TE', 'block'), R('RB', 'runFake')] },
  { name: 'RPO Run', formation: 'Pistol', personnel: '11', type: 'run', depth: 4, yac: 0, description: 'QB reads the edge, then hands off or keeps it', assignments: [BLK('QB', 'play-action'), RB_('RB', 'outside'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Outside Zone', formation: 'Pistol', personnel: '11', type: 'run', depth: 5, yac: 0, description: 'Stretch run to the edge', assignments: [BLK('QB', 'play-action'), RB_('RB', 'outside'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Inside Zone Split', formation: 'Gun Doubles', personnel: '11', type: 'run', depth: 4, yac: 0, description: 'Zone run with the back pressing one gap then cutting', assignments: [BLK('QB', 'play-action'), RB_('RB', 'middle'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'QB Draw', formation: 'Gun Empty', personnel: '10', type: 'run', depth: 4, yac: 0, description: 'Show pass, then the QB runs up the middle', assignments: [R('QB', 'screen'), RB_('RB', 'middle'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Read Option', formation: 'Pistol', personnel: '11', type: 'run', depth: 5, yac: 0, description: 'The QB reads the end: hand off or keep', assignments: [BLK('QB', 'play-action'), RB_('RB', 'outside'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
  { name: 'Jet Sweep', formation: 'Gun Trips', personnel: '11', type: 'run', depth: 6, yac: 0, description: 'A receiver in motion takes the handoff on the edge', assignments: [BLK('QB', 'play-action'), RB_('RB', 'outside'), R('WR3', 'bubble'), BLK('OL', 'run-block'), BLK('TE', 'run-block')] },
]

/** Concept shape used by the sim. */
export interface SimConcept {
  name: string
  type: 'run' | 'pass'
  depth: number
  yac: number
  description: string
}

const byName = new Map(PLAYBOOK.map((p) => [p.name, p]))
export function playbookPlay(name: string): PlaybookPlay | undefined {
  return byName.get(name)
}

/** Default formation for a concept (the first play in the book with that name). */
export function formationForConcept(name: string): string {
  return byName.get(name)?.formation ?? 'Gun Trips'
}

const sim = (name: string): SimConcept => {
  const p = byName.get(name)
  if (!p) throw new Error(`missing playbook play: ${name}`)
  return { name: p.name, type: p.type, depth: p.depth, yac: p.yac, description: p.description }
}

/**
 * Each scheme's menu. These reproduce the concepts the sim already used, in the
 * same order and with the same depth/yac/description, so the concept pick and
 * the resulting calibration are unchanged (L12.10 B3).
 */
export const SCHEME_MENUS: Record<string, SimConcept[]> = {
  'Air Raid': ['Four Verticals', 'Y-Cross', 'Mesh', 'Smash', 'RB Screen', 'Inside Zone'].map(sim),
  'Pro Style': ['Play Action Deep', 'PA Cross', 'Bootleg', 'Inside Zone', 'Power'].map(sim),
  Spread: ['Four Verts', 'Quick Slant', 'RPO Bubble', 'Outside Zone', 'QB Draw'].map(sim),
  'West Coast': ['Mesh', 'Slant', 'RB Screen', 'Bootleg', 'Inside Zone'].map(sim),
  'RPO Heavy': ['RPO Pass', 'Quick Slant', 'RPO Run', 'Inside Zone'].map(sim),
}

/** Playbook size, for the status report. */
export function playbookSize(): { formations: number; plays: number; perScheme: Record<string, number> } {
  const perScheme: Record<string, number> = {}
  for (const [k, v] of Object.entries(SCHEME_MENUS)) perScheme[k] = v.length
  return { formations: FORMATIONS.length, plays: PLAYBOOK.length, perScheme }
}
