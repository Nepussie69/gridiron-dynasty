// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (SL1): the sideline system — both team areas, the officials
// and the chain crew — as one depth-sorted set of whole-figure sprites
// (sidelinePaint.ts) handed to the actor layer (`ActorLayer.people`).
//
//   • Team areas between the 32-yard lines (field.ts TEAM_BOX). The HOME club
//     is on the near (press-box, world y < 0) sideline, the visitors opposite,
//     for the whole game. Per side: head coach at the front of the coaching
//     box (headset + play sheet), coordinators and position coaches in it
//     (team polos + caps, no pads), the inactive-on-this-snap players behind
//     the restraining line (kit; some helmets off / in hand), a few on the
//     benches set back by the wall, and staff (jackets + caps) around them.
//     Idle sway; the scoring (or big-play) club's sideline jumps / raises its
//     arms for ~2 s from the score.
//   • Officials: the seven-man crew placed from the play's LOS by NFL
//     mechanics, following the ball loosely, converging on the end spot and
//     signalling a touchdown / first down when the play data says so.
//   • Chain crew on the visitors' sideline: rods at the series' start and
//     line to gain (none goal-to-go), the down box at the LOS; a matching
//     orange down marker on the home sideline.
//
// Presentation only: everything is derived from the recorded Play / anim and a
// fixed local PRNG (paint.ts rng), never the sim's rng or saved state.
// Lite: 12 people per side, no sway or reactions; officials in simple poses;
// the chain crew is static in every tier.
// ─────────────────────────────────────────────────────────────────────────────
import type { Play } from '../../game/engine/playsim'
import { mixHex } from '../../lib/teamColor.ts'
import type { Scene, SceneItem } from './actors.ts'
import type { BroadcastAnim } from './animData.ts'
import { FIELD_LENGTH, FIELD_WIDTH as FW, MID_WIDTH as MY, offenseXToWorld, project, type Camera, type Direction } from './camera.ts'
import { TEAM_BOX } from './field.ts'
import { clubKit, facingVsCamera, figureScreen } from './figures.ts'
import { displayFont, fillPoly, rng, strokeWorld } from './paint.ts'
import { ART, type ClubLike } from './palette.ts'
import {
  clothOutfit,
  crewOutfit,
  officialOutfit,
  PeopleSprites,
  playerOutfit,
  SIDE_ART,
  specKey,
  type Face,
  type Hat,
  type Outfit,
  type PersonSpec,
  type PPose,
} from './sidelinePaint.ts'

type Side = 'home' | 'away'
type Role = 'hc' | 'coach' | 'staff' | 'player' | 'bench'

interface Person {
  side: Side
  role: Role
  x: number
  /** Yards beyond the sideline. */
  off: number
  outfit: Outfit
  pose: PPose
  hat: Hat
  skin: number
  /** World heading jitter around "facing the field" (radians). */
  jitter: number
  /** Follows the ball with his eyes (else faces the field). */
  watch: boolean
  /** In the Lite subset. */
  lite: boolean
  /** Reacts to a score / big play: arms up; `jump` also hops. */
  react: boolean
  jump: boolean
  phase: number
  order: number
}

/** World y of a point `off` yards beyond a club's sideline (home = near, y < 0). */
export function sideY(side: Side, off: number): number {
  return side === 'home' ? -off : FW + off
}

const TAU = Math.PI * 2
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const smooth = (u: number) => {
  const v = clamp(u, 0, 1)
  return v * v * (3 - 2 * v)
}

/** The people in one club's team area (deterministic per side). */
export function buildTeamArea(side: Side, club: ClubLike, home: boolean): Person[] {
  const R = rng(side === 'home' ? 9101 : 9202)
  const kit = clubKit(club, home)
  const player = playerOutfit(kit)
  const coach = clothOutfit(`C|${club.id}|${club.primary}`, 'coach', club.primary, club.secondary, club.primary)
  const jacket = mixHex(club.primary, ART.black, 0.5)
  const staff = clothOutfit(`S|${club.id}|${club.primary}`, 'staff', jacket, club.secondary, club.primary)
  const { x0, x1, coach: cl } = TEAM_BOX
  const out: Person[] = []
  let order = 0
  const add = (p: Omit<Person, 'side' | 'skin' | 'jitter' | 'phase' | 'order'> & { jitter?: number }) =>
    out.push({ side, skin: Math.floor(R() * 8), jitter: p.jitter ?? (R() - 0.5) * 1.1, phase: R() * TAU, order: order++, ...p })
  // Coaching box (between the border and the restraining line).
  add({ role: 'hc', x: 60 + (R() - 0.5) * 3, off: 2.6, outfit: coach, pose: 'sheet', hat: 'headset', watch: true, lite: true, react: true, jump: false, jitter: 0 })
  add({ role: 'coach', x: 55 + R() * 1.5, off: 3.2, outfit: coach, pose: 'cross', hat: 'headset', watch: true, lite: true, react: false, jump: false })
  add({ role: 'coach', x: 64 + R() * 1.5, off: 3.25, outfit: coach, pose: 'hips', hat: 'headset', watch: true, lite: true, react: true, jump: false })
  for (const x of [47.5, 51.5, 68.5, 72.5, 58.2]) {
    const pose: PPose = (['cross', 'stand', 'hips'] as const)[Math.floor(R() * 3)]
    add({ role: 'coach', x: x + (R() - 0.5) * 2, off: 3.0 + R() * 0.7, outfit: coach, pose, hat: 'cap', watch: R() < 0.7, lite: false, react: R() < 0.5, jump: false })
  }
  // Players behind the restraining line, in loose clusters.
  const clusters = [45.5, 51, 57, 63, 69, 74.5]
  let liteLeft = 9
  for (let i = 0; i < 25; i++) {
    const cx = clusters[i % clusters.length]
    const x = clamp(cx + (R() - 0.5) * 5, x0 + 0.8, x1 - 0.8)
    const r = R()
    const pose: PPose = r < 0.42 ? 'stand' : r < 0.66 ? 'hips' : r < 0.84 ? 'helmet' : 'cross'
    const hat: Hat = pose === 'helmet' ? 'bare' : R() < 0.6 ? 'helmet' : 'bare'
    const lite = liteLeft > 0 && i % 2 === 0
    if (lite) liteLeft--
    add({ role: 'player', x, off: cl + 0.6 + R() * 2.8, outfit: player, pose, hat, watch: R() < 0.65, lite, react: R() < 0.85, jump: R() < 0.45 })
  }
  // Staff (trainers, equipment, team staff) toward the back.
  for (let i = 0; i < 8; i++) {
    const x = x0 + 1 + R() * (x1 - x0 - 2)
    add({ role: 'staff', x, off: 7.2 + R() * 0.5, outfit: staff, pose: R() < 0.5 ? 'stand' : 'cross', hat: 'cap', watch: R() < 0.5, lite: false, react: R() < 0.3, jump: false })
  }
  // Benches set back by the wall, with a few players sitting.
  for (const [b0, b1] of BENCHES) {
    for (let k = 0; k < 3; k++) {
      const x = b0 + 1 + ((k + R() * 0.4) / 3) * (b1 - b0 - 2)
      add({ role: 'bench', x, off: BENCH_OFF - 0.25, outfit: player, pose: 'sit', hat: R() < 0.5 ? 'bare' : 'helmet', watch: false, lite: false, react: R() < 0.6, jump: false, jitter: (R() - 0.5) * 0.4 })
    }
  }
  return out
}

/** Bench segments (world x) and their distance beyond the sideline. */
export const BENCHES: [number, number][] = [
  [45.5, 53.5],
  [56, 64],
  [66.5, 74.5],
]
const BENCH_OFF = 8.65
const BENCH_DEPTH = 0.5
const BENCH_H = 0.42

// ── plays: scoring, first downs, chains ──────────────────────────────────────

export interface SidelinePlay {
  play: Play
  anim: BroadcastAnim
  dir: Direction
  /** LOS / line to gain in the offense frame (null hides). */
  los: number | null
  firstDown: number | null
  homeClub: ClubLike
  awayClub: ClubLike
  homeId: string
}

export interface PlayRead {
  td: boolean
  firstDown: boolean
  /** Which club's sideline celebrates (null = none) and how hard. */
  cheer: Side | null
  big: boolean
  /** Play time (0..1) the play is dead / scored. */
  tEnd: number
  tScore: number
}

const END_KINDS = new Set(['tackle', 'down', 'outOfBounds', 'score', 'incomplete', 'safety', 'touchback', 'fairCatch', 'kickGood', 'kickMiss'])

/** What the play data says happened (pure). */
export function readPlay(play: Play, anim: BroadcastAnim, homeId: string): PlayRead {
  const ev = anim.events ?? []
  const has = (k: string) => ev.some((e) => e.kind === k)
  const scrimmage = play.type === 'run' || play.type === 'pass'
  const turnover = !!play.turnover || has('interception') || /^interception/i.test(play.result ?? '') || !!play.defTD
  const td = (scrimmage && !turnover && play.endYard >= 100) || !!play.returnTD || !!play.defTD || (play.type !== 'fg' && play.type !== 'pat' && has('score'))
  const fgGood = play.type === 'fg' && /\bis good\b/i.test(play.result ?? '') && !/no good|blocked/i.test(play.result ?? '')
  const firstDown = !td && scrimmage && !turnover && play.down != null && play.distance != null && ((play.yards ?? 0) >= play.distance || has('firstDown'))
  const ends = ev.filter((e) => END_KINDS.has(e.kind)).map((e) => e.t)
  const tEnd = ends.length ? Math.min(...ends) : 0.9
  const sc = ev.find((e) => e.kind === 'score' || e.kind === 'kickGood' || e.kind === 'safety')
  const tScore = sc ? sc.t : tEnd
  const off: Side = play.offId === homeId ? 'home' : 'away'
  const def: Side = off === 'home' ? 'away' : 'home'
  let cheer: Side | null = null
  let big = false
  if (td) cheer = play.defTD || (play.type === 'punt' && play.returnTD) ? def : off
  else if (play.safety || has('safety')) cheer = def
  else if (fgGood) cheer = off
  else if (turnover && scrimmage) {
    cheer = def
    big = true
  } else if (play.bigPlay || (scrimmage && (play.yards ?? 0) >= 20)) {
    cheer = off
    big = true
  }
  return { td, firstDown, cheer, big, tEnd, tScore }
}

interface ChainState {
  /** World x of the rear rod / forward rod (null: goal to go, rods off). */
  rear: number | null
  fwd: number | null
  /** World x of the down box and its number. */
  box: number
  down: number
}

// ── officials ────────────────────────────────────────────────────────────────

export type OfficialRole = 'R' | 'U' | 'DJ' | 'LJ' | 'SJ' | 'FJ' | 'BJ'
export const OFFICIAL_ROLES: OfficialRole[] = ['R', 'U', 'DJ', 'LJ', 'SJ', 'FJ', 'BJ']

export interface OfficialPos {
  role: OfficialRole
  x: number
  y: number
}

/** Ball in the offense frame at play time t. */
type BallFn = (t: number) => { x: number; y: number }

/**
 * Officials' positions in the OFFENSE frame (own goal line 10, attacking 110)
 * at play time t. Pure. `chainSideY` is the offense-frame y of the visitors'
 * (chain crew / down judge) sideline: −1-ish or FW+1-ish.
 */
export function officialsAt(play: Play, ball: BallFn, t: number, D: number, los0: number | null, rd: PlayRead, chainHigh: boolean): OfficialPos[] {
  const b0 = ball(0)
  const los = los0 ?? b0.x
  const lag = Math.max(0, t - 0.4 / D)
  const bt = ball(lag)
  const adv = bt.x - b0.x
  const kick = play.type === 'kickoff' || play.type === 'punt'
  const fg = play.type === 'fg' || play.type === 'pat'
  const deep = kick ? 38 : 20
  const qtr2or4 = play.qtr === 2 || play.qtr === 4
  const mins = Number((play.clock ?? '15:00').split(':')[0])
  const late = qtr2or4 && mins < 2
  const goal = los >= 105
  const hi = (o: number) => (chainHigh ? FW + o : -o)
  const lo = (o: number) => (chainHigh ? -o : FW + o)
  const P: Record<OfficialRole, { x: number; y: number }> = {
    R: { x: los - 11 + Math.max(0, adv) * 0.45, y: MY - 4.5 + (bt.y - MY) * 0.2 },
    U:
      late || goal
        ? { x: los + 5.5 + Math.max(0, adv - 5) * 0.6, y: MY + (bt.y - MY) * 0.3 }
        : { x: los - 12 + Math.max(0, adv) * 0.4, y: MY + 4.5 + (bt.y - MY) * 0.2 },
    DJ: { x: los + adv * 0.92, y: hi(1.0) },
    LJ: { x: los + adv * 0.92, y: lo(1.0) },
    SJ: { x: Math.max(los + deep, bt.x + 7), y: hi(-3.5) + (bt.y - hi(-3.5)) * 0.15 },
    FJ: { x: Math.max(los + deep, bt.x + 7), y: lo(-3.5) + (bt.y - lo(-3.5)) * 0.15 },
    BJ: { x: Math.max(los + deep + 5, bt.x + 9), y: MY + (bt.y - MY) * 0.35 },
  }
  if (fg) {
    // Field goal / try: two deep officials under the uprights, BJ beside them.
    P.SJ = { x: 111.5, y: MY - 3.6 }
    P.FJ = { x: 111.5, y: MY + 3.6 }
    P.BJ = { x: 108.5, y: MY - 7 }
  }
  // After the whistle: walk in toward the end spot.
  const c = smooth((t - rd.tEnd) / Math.max(0.05, 1 - rd.tEnd)) * 0.85
  if (c > 0) {
    const incomplete = !rd.td && play.type === 'pass' && /incomplete/i.test(play.result ?? '')
    const be = incomplete ? { x: los, y: MY } : ball(1)
    const ex = clamp(be.x, 1, 119)
    const ey = clamp(be.y, 1, FW - 1)
    const T: Record<OfficialRole, { x: number; y: number }> = {
      R: { x: ex - 6, y: ey - 2 },
      U: { x: ex - 2, y: ey + 3 },
      DJ: { x: ex, y: P.DJ.y + (ey - P.DJ.y) * 0.45 },
      LJ: { x: ex, y: P.LJ.y + (ey - P.LJ.y) * 0.45 },
      SJ: { x: ex + 4, y: ey + (hi(0) - ey) * 0.4 },
      FJ: { x: ex + 4, y: ey + (lo(0) - ey) * 0.4 },
      BJ: { x: ex + 7, y: ey },
    }
    for (const r of OFFICIAL_ROLES) {
      P[r].x += (T[r].x - P[r].x) * c
      P[r].y += (T[r].y - P[r].y) * c
    }
  }
  return OFFICIAL_ROLES.map((role) => ({ role, x: clamp(P[role].x, 0.5, FIELD_LENGTH - 0.5), y: clamp(P[role].y, -1.6, FW + 1.6) }))
}

// ── the layer ────────────────────────────────────────────────────────────────

export interface SidelineStats {
  ms: number
  people: number
  drawn: number
  builds: number
  fallbacks: number
  misses: number
  entries: number
}

interface Draw {
  spec: PersonSpec
  key: string
  x: number
  y: number
  h: number
  rot: number
  alpha: number
}

export class SidelineLayer {
  quality: 'full' | 'lite' = 'full'
  /** Graphics clock (play seconds + the result hold); null = play time × duration. */
  sec: number | null = null
  enabled = true
  readonly sprites = new PeopleSprites()
  stats: SidelineStats = { ms: 0, people: 0, drawn: 0, builds: 0, fallbacks: 0, misses: 0, entries: 0 }

  private people: Person[] = []
  private matchKey = ''
  private lp: SidelinePlay | null = null
  private rd: PlayRead | null = null
  private chain: ChainState = { rear: null, fwd: null, box: 60, down: 0 }
  private crew = crewOutfit()
  private refOutfit = officialOutfit(true)
  private offOutfit = officialOutfit(false)
  private drawn = 0

  /** Load a play: team areas on a new matchup, the chains on a new LOS. */
  setPlay(p: SidelinePlay): void {
    const mk = `${p.homeClub.id}|${p.homeClub.primary}|${p.awayClub.id}|${p.awayClub.primary}`
    if (mk !== this.matchKey) {
      this.matchKey = mk
      this.people = [...buildTeamArea('home', p.homeClub, true), ...buildTeamArea('away', p.awayClub, false)]
      this.sprites.clear()
      this.chain = { rear: null, fwd: null, box: 60, down: 0 }
    }
    this.sprites.font = displayFont()
    this.lp = p
    this.rd = readPlay(p.play, p.anim, p.homeId)
    const scrimmage = p.play.type === 'run' || p.play.type === 'pass'
    if (scrimmage && p.los != null && p.play.down != null) {
      const fd = p.firstDown
      this.chain = {
        box: offenseXToWorld(p.los, p.dir),
        down: p.play.down,
        fwd: fd != null ? offenseXToWorld(fd, p.dir) : null,
        rear: fd != null ? offenseXToWorld(fd - 10, p.dir) : null,
      }
    }
  }

  get chainState(): Readonly<ChainState> {
    return this.chain
  }

  get playRead(): PlayRead | null {
    return this.rd
  }

  /** Officials' world positions at play time t (no drawing; probes). */
  officialsWorld(scene: Pick<Scene, 'ballWorld' | 'direction'>, t: number): OfficialPos[] {
    const lp = this.lp
    const rd = this.rd
    if (!lp || !rd) return []
    const dir = scene.direction
    const ball: BallFn = (u) => {
      const w = scene.ballWorld(u)
      return dir === 1 ? { x: w.x, y: w.y } : { x: FIELD_LENGTH - w.x, y: FW - w.y }
    }
    // The visitors' (chain) sideline is world y > FW: in the offense frame that is high when dir = 1.
    const D = Math.max(0.05, lp.anim.duration / 1000)
    return officialsAt(lp.play, ball, t, D, lp.los, rd, dir === 1).map((o) => ({
      role: o.role,
      x: dir === 1 ? o.x : FIELD_LENGTH - o.x,
      y: dir === 1 ? o.y : FW - o.y,
    }))
  }

  /** Push this frame's sideline items into the actor layer's depth sort. */
  items(scene: Scene, out: SceneItem[]): void {
    if (!this.enabled || !this.lp || !this.rd) return
    const t0 = performance.now()
    const cam = scene.cam
    const lite = this.quality === 'lite'
    const sp = this.sprites
    sp.beginFrame()
    const b0 = sp.stats.builds
    const f0 = sp.stats.fallbacks
    const m0 = sp.stats.misses
    const lastDrawn = this.drawn
    this.drawn = 0
    const W = scene.info.width
    const H = scene.info.height
    const D = Math.max(0.05, scene.anim.duration / 1000)
    const sec = this.sec ?? scene.t * D
    const rd = this.rd
    const t = scene.t
    // The ball (and its carrier) on screen: off-field people in front of it fade.
    const bw = scene.ball
    const bp = project(cam, bw.x, bw.y, bw.z)
    const ballDepth = bp ? bp.depth : -Infinity
    const hs = scene.holder ? scene.screenOf(scene.holder) : undefined
    const cheerT0 = rd.tScore * D - 0.2
    const cheering = !lite && rd.cheer != null && sec >= cheerT0 && sec <= cheerT0 + (rd.big ? 1.6 : 2.2)
    const cheerU = cheering ? sec - cheerT0 : 0
    const bx = bw.x
    let order = 0

    const place = (x: number, y: number, spec: PersonSpec, opts: { sway?: number; jump?: number; onField?: boolean }): void => {
      const s = figureScreen(cam, x, y)
      if (!s || s.h < 3) return
      let sx = s.x
      const sy = s.y
      const h = s.h
      if (sx + 0.6 * h < 0 || sx - 0.6 * h > W || sy - 1.4 * h > H || sy + 0.1 * h < 0) return
      let alpha = 1
      if (s.depth < ballDepth + 0.3) {
        // In front of the ball: never hide it or the carrier.
        const hit = (px: number, py: number, pad: number) => Math.abs(px - sx) < 0.3 * h + pad && py < sy + pad && py > sy - 1.1 * h - pad
        const covers = (bp && hit(bp.x, bp.y, 3)) || (hs && (hit(hs.x, hs.y - hs.scale * 0.2, 0.15 * hs.scale) || hit(hs.headX, hs.headY, 0.1 * hs.scale)))
        if (covers) {
          if (opts.onField && bp) {
            // Officials are cosmetic: step aside along the screen.
            const tx = hs ? hs.x : bp.x
            const half = 0.32 * h + (hs ? 0.3 * hs.scale : 4)
            const side = sx >= tx ? 1 : -1
            sx = tx + side * half
          } else alpha = 0.3
        }
      }
      const jump = opts.jump ? opts.jump * h : 0
      const d: Draw = { spec, key: specKey(spec), x: sx, y: sy - jump, h, rot: opts.sway ?? 0, alpha }
      out.push({ depth: s.depth, order: order++, draw: (g) => this.drawOne(g, d) })
    }

    const faceOf = (heading: number): Face => {
      const { sdx, tow } = facingVsCamera(cam, heading)
      if (tow > 0.4) return 'front'
      if (tow < -0.4) return 'back'
      return sdx >= 0 ? 'right' : 'left'
    }

    // ── team areas ──
    for (const p of this.people) {
      if (lite && !p.lite) continue
      const y = sideY(p.side, p.off)
      const toField = p.side === 'home' ? Math.PI / 2 : -Math.PI / 2
      let heading = toField + p.jitter
      if (p.watch) heading = Math.atan2(MY - y, bx - p.x) * 0.6 + toField * 0.4 + p.jitter * 0.3
      let pose = p.pose
      let jump = 0
      let sway = 0
      if (!lite) {
        if (cheering && p.react && rd.cheer === p.side) {
          pose = 'up'
          if (p.jump) jump = 0.09 * Math.abs(Math.sin(cheerU * 7 + p.phase))
          heading = toField
        } else if (p.role !== 'bench') sway = 0.022 * Math.sin(sec * 1.4 + p.phase)
      }
      place(p.x, y, { outfit: p.outfit, pose, face: faceOf(heading), skin: p.skin, hat: p.hat }, { sway, jump })
    }

    // ── benches ──
    if (this.people.length) {
      for (const side of ['home', 'away'] as const) {
        const club = side === 'home' ? this.lp.homeClub : this.lp.awayClub
        for (const [x0, x1] of BENCHES) this.pushBench(out, cam, side, x0, x1, club, order++)
      }
    }

    // ── chain crew (visitors' sideline) + the home down marker ──
    const ch = this.chain
    const cy = sideY('away', 2.7)
    const crewFace = faceOf(-Math.PI / 2)
    if (ch.rear != null && ch.fwd != null) {
      const ry = sideY('away', 2.5)
      const a = project(cam, ch.rear, ry, 0)
      const b = project(cam, ch.fwd, ry, 0)
      if (a && b) {
        const r = ch.rear
        const f = ch.fwd
        out.push({ depth: Math.max(a.depth, b.depth) + 0.5, order: order++, draw: (g) => drawChain(g, cam, r, f, ry) })
      }
      place(ch.rear, cy, { outfit: this.crew, pose: 'rod', face: crewFace, skin: 2, hat: 'cap' }, {})
      place(ch.fwd, cy, { outfit: this.crew, pose: 'rod', face: crewFace, skin: 5, hat: 'cap' }, {})
    } else {
      place(ch.box - 4, sideY('away', 3.4), { outfit: this.crew, pose: 'stand', face: crewFace, skin: 2, hat: 'cap' }, {})
      place(ch.box + 4, sideY('away', 3.4), { outfit: this.crew, pose: 'stand', face: crewFace, skin: 5, hat: 'cap' }, {})
    }
    if (ch.down > 0) {
      place(ch.box, cy, { outfit: this.crew, pose: 'rod', face: crewFace, skin: 0, hat: 'cap', card: ch.down }, {})
      const sgn = ch.rear != null && ch.fwd != null && ch.fwd < ch.rear ? 1 : -1
      place(ch.box + sgn * 1.4, sideY('away', 3.1), { outfit: this.crew, pose: 'stand', face: crewFace, skin: 7, hat: 'cap' }, {})
      const my = sideY('home', 2.3)
      const mp = project(cam, ch.box, my, 0)
      if (mp) {
        const x = ch.box
        out.push({ depth: mp.depth, order: order++, draw: (g) => drawMarker(g, cam, x, my) })
      }
    }

    // ── officials ──
    const offs = this.officialsWorld(scene, t)
    const prev = lite ? null : this.officialsWorld(scene, Math.max(0, t - 0.1 / D))
    const ballNow = scene.ballWorld(t)
    for (let i = 0; i < offs.length; i++) {
      const o = offs[i]
      let pose: PPose = 'stand'
      let heading = Math.atan2(ballNow.y - o.y, ballNow.x - o.x)
      let face: Face | null = null
      if (!lite) {
        const q = prev?.[i]
        const v = q ? Math.hypot(o.x - q.x, o.y - q.y) / 0.1 : 0
        if (v > 1.6) {
          pose = Math.floor(sec * 5 + i) % 2 ? 'runA' : 'runB'
          if (q) heading = Math.atan2(o.y - q.y, o.x - q.x)
        }
        const sig = t >= 0.999 || t >= rd.tEnd + 0.15 / D
        if (rd.td && t >= rd.tScore && (o.role === 'DJ' || o.role === 'LJ' || o.role === 'BJ' || o.role === 'R')) {
          pose = 'up'
          face = 'front'
        } else if (rd.firstDown && sig && (o.role === 'DJ' || o.role === 'LJ')) {
          pose = 'point'
          heading = scene.direction === 1 ? 0 : Math.PI
          const f = faceOf(heading)
          face = f === 'front' || f === 'back' ? (facingVsCamera(cam, heading).sdx >= 0 ? 'right' : 'left') : f
        }
      }
      place(o.x, o.y, { outfit: o.role === 'R' ? this.refOutfit : this.offOutfit, pose, face: face ?? faceOf(heading), skin: (i * 3) % 8, hat: 'cap' }, { onField: true })
    }

    this.stats = {
      ms: performance.now() - t0,
      people: order,
      /** Sprites blitted in the previous frame (drawing happens after this pass). */
      drawn: lastDrawn,
      builds: sp.stats.builds - b0,
      fallbacks: sp.stats.fallbacks - f0,
      misses: sp.stats.misses - m0,
      entries: sp.stats.entries,
    }
  }

  private drawOne(g: CanvasRenderingContext2D, d: Draw): void {
    const e = this.sprites.get(d.spec, d.key, d.h)
    if (!e) return
    this.drawn++
    if (d.alpha < 1) g.globalAlpha = d.alpha
    const h = d.h
    if (d.rot !== 0) {
      g.translate(d.x, d.y)
      g.rotate(d.rot)
      g.drawImage(e.canvas, e.x * h, e.y * h, e.w * h, e.h * h)
    } else g.drawImage(e.canvas, d.x + e.x * h, d.y + e.y * h, e.w * h, e.h * h)
  }

  private pushBench(out: SceneItem[], cam: Camera, side: Side, x0: number, x1: number, club: ClubLike, order: number): void {
    const yf = sideY(side, BENCH_OFF)
    const yb = sideY(side, BENCH_OFF + BENCH_DEPTH)
    const c = project(cam, (x0 + x1) / 2, (yf + yb) / 2, 0)
    if (!c) return
    const seat = mixHex(club.primary, ART.black, 0.45)
    const face = mixHex(club.primary, ART.black, 0.68)
    // Which long face the camera sees (field side or wall side).
    const seeField = side === 'home' ? cam.py > yf : cam.py < yf
    out.push({
      depth: c.depth + 0.4,
      order,
      draw: (g) => {
        const yv = seeField ? yf : yb
        fillPoly(g, cam, [
          [x0, yv, 0],
          [x1, yv, 0],
          [x1, yv, BENCH_H],
          [x0, yv, BENCH_H],
        ], face)
        fillPoly(g, cam, [
          [x0, yf, BENCH_H],
          [x1, yf, BENCH_H],
          [x1, yb, BENCH_H],
          [x0, yb, BENCH_H],
        ], seat)
      },
    })
  }
}

function drawChain(g: CanvasRenderingContext2D, cam: Camera, x0: number, x1: number, y: number): void {
  g.strokeStyle = SIDE_ART.chain
  strokeWorld(g, cam, [x0, y, 0.03], [x1, y, 0.03], 0.035, 1)
}

/** The home sideline's orange down marker at the LOS. */
function drawMarker(g: CanvasRenderingContext2D, cam: Camera, x: number, y: number): void {
  g.strokeStyle = SIDE_ART.rod
  strokeWorld(g, cam, [x, y, 0], [x, y, 1.15], 0.05, 1)
  g.strokeStyle = ART.pylon
  strokeWorld(g, cam, [x, y, 0.95], [x, y, 1.3], 0.2, 2)
}
