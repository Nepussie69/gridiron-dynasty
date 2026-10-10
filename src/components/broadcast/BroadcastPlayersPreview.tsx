// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B3) preview: real plays with code-drawn players. Simulates
// one game between the kit picker's club (home) and a visitor on a COPY of the
// loaded world (never the live one; nothing is saved), lets you pick sample
// plays by kind (pass, run, sack, punt, kickoff, FG …) and play / scrub them
// through buildPlayAnim → ActorLayer → BroadcastRenderer. A simple follow
// camera stands in for B5's director. B6a: a Graphics toggle layers the
// broadcast graphics (chip, play clock, lower third, result toast, callouts)
// on the overlay hook; with graphics on the clock also runs the pre-snap lead
// and holds for the toast. B4: an Effects toggle swaps B3's placeholder ball for
// the real ball (arc, spiral wobble, trail, shrinking shadow, landing marker) and
// draws the event-driven effects (sparkle, burst, impact ring, turf bits, TD
// celebration, crossbar glints) through the actor hook's ball / ground / items
// insertion point. B6b: a Replays setting (Big plays / All / Off) replays the
// play after the live run when replay.ts's rules say so, and a Replay button
// plays the live play then forces its replay: team-colour wipe, the replay
// director's higher camera, slower playback, a freeze at the key moment and
// the telestrations; Skip ends it at once. Mounted only in the hidden #/kit page.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { NFL_TEAMS } from '../../game/data/nflTeams'
import type { Play } from '../../game/engine/playsim'
import type { World } from '../../game/engine/generate'
import { cn } from '../../lib/cn'
import { Button, SegmentedControl } from '../../ui/Controls'
import { useMediaQuery, useResolvedTheme } from '../../ui/hooks'
import { ActorLayer, type ActorPlay } from './actors'
import type { BroadcastAnim } from './animData'
import { createBallFx, withBallFx, type BallFx } from './ballFx'
import { MID_WIDTH, offenseToWorld, orbitPose, type CameraPose, type Direction } from './camera'
import type { Director } from './director'
import { buildGraphicsTimeline, type GraphicsMode, type GraphicsTimeline, type PersonInfo } from './graphics'
import { GraphicsLayer, readGfxTokens } from './graphicsDraw'
import { posAt } from './interp'
import { BroadcastRenderer, FrameWindow } from './renderer'
import { ReplayPlayer, replayPlan, type ReplayPhase, type ReplaySetting } from './replay'
import { attachTelestrator, TelestratorLayer } from './telestrator'

type Shot = 'skycam' | 'sideline' | 'reverse' | 'tight'
type Size = 'wide' | 'phone' | 'full'
type Kind = 'pass' | 'incomplete' | 'run' | 'sack' | 'int' | 'td' | 'punt' | 'kickoff' | 'fg' | 'pat' | 'all'
/** B4 ball + effects: full quality, lite (fewer particles, dpr-friendly), or off (B3's placeholder). */
type EffectsMode = 'full' | 'lite' | 'off'

const KINDS: { id: Kind; label: string; test: (p: Play) => boolean }[] = [
  { id: 'pass', label: 'Pass', test: (p) => p.type === 'pass' && !p.result.startsWith('Sack') && p.result !== 'Incomplete' && !p.result.startsWith('Interception') },
  { id: 'run', label: 'Run', test: (p) => p.type === 'run' },
  { id: 'sack', label: 'Sack', test: (p) => p.type === 'pass' && p.result.startsWith('Sack') },
  { id: 'incomplete', label: 'Incomplete', test: (p) => p.type === 'pass' && p.result === 'Incomplete' },
  { id: 'int', label: 'Interception', test: (p) => p.type === 'pass' && p.result.startsWith('Interception') },
  { id: 'td', label: 'Touchdown', test: (p) => (p.type === 'run' || p.type === 'pass') && p.endYard >= 100 },
  { id: 'punt', label: 'Punt', test: (p) => p.type === 'punt' },
  { id: 'kickoff', label: 'Kickoff', test: (p) => p.type === 'kickoff' },
  { id: 'fg', label: 'Field goal', test: (p) => p.type === 'fg' },
  { id: 'pat', label: 'PAT', test: (p) => p.type === 'pat' },
  { id: 'all', label: 'All', test: (p) => p.type !== 'end' },
]

interface Sample {
  world: World
  homeId: string
  awayId: string
  plays: Play[]
}

interface Built {
  anim: BroadcastAnim
  actorPlay: ActorPlay
  dir: Direction
  los: number | null
  fd: number | null
  turfText: string | null
  possession: 'home' | 'away'
  /** B6a graphics timeline for this play. */
  tl: GraphicsTimeline
  /** B4 ball wobble inputs: the thrower's ratings (presentation only) and pressure. */
  fx: { thrower?: { thp?: number; tha?: number }; pressured?: boolean }
  /** B6b: the recorded play (replay rules) and the replay director factory (B5, profile 'replay'). */
  play: Play
  replayDirector: (vp: { w: number; h: number }) => Director
}

const ord = (n: number) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`)

/** Simulate one game on a copy of the loaded world. */
async function simulateSample(homeId: string, awayId: string, seed: number): Promise<Sample> {
  const [store, { simulatePlayByPlay }] = await Promise.all([import('../../store/gameStore'), import('../../game/engine/playsim')])
  // Wait (briefly) for the app's hydrate so real rosters / calibration are in.
  const st = store.useGame
  if (!st.getState().ready) {
    await new Promise<void>((resolve) => {
      const stop = st.subscribe((s) => {
        if (s.ready) {
          stop()
          resolve()
        }
      })
      setTimeout(() => {
        stop()
        resolve()
      }, 15000)
    })
  }
  let world = store.getWorld()
  try {
    world = structuredClone(world)
  } catch {
    // Not cloneable: simulate on the live world (the sim reads it only).
  }
  const sim = simulatePlayByPlay(world, homeId, awayId, seed)
  return { world, homeId, awayId, plays: sim.plays }
}

async function buildSample(s: Sample, idx: number): Promise<Built> {
  const [{ buildPlayAnim, targetKey, snapYard }, { actorPlayers, teamJerseys }, { createBroadcastDirector }] = await Promise.all([
    import('../playAnim'),
    import('../jersey'),
    import('./directorRules'),
  ])
  const play = s.plays[idx]
  const next = s.plays[idx + 1]
  const byId = new Map(s.world.players.map((p) => [p.id, p]))
  const defId = play.offId === s.homeId ? s.awayId : s.homeId
  const tKey = play.type === 'pass' && play.targetId ? targetKey(play, { targetPos: byId.get(play.targetId)?.pos }) : null
  const actors = actorPlayers(s.world, play, defId, tKey)
  const anim = buildPlayAnim(play, {
    next,
    targetPos: play.targetId ? byId.get(play.targetId)?.pos : undefined,
    carrierIsQB: play.type === 'run' && !!play.carrierId && byId.get(play.carrierId)?.pos === 'QB',
    actors,
  })
  const jOff = teamJerseys(s.world, play.offId)
  const jDef = teamJerseys(s.world, defId)
  const numbers: Record<string, number> = {}
  for (const a of anim.actors) {
    const p = actors.get(a.key)
    const n = p ? (a.side === 'off' ? jOff : jDef).get(p.id) ?? jOff.get(p.id) ?? jDef.get(p.id) : undefined
    if (n != null) numbers[a.key] = n
  }
  const club = (id: string) => NFL_TEAMS.find((t) => t.id === id) ?? NFL_TEAMS[0]
  const people: Record<string, PersonInfo> = {}
  for (const a of anim.actors) {
    const p = actors.get(a.key)
    if (p) people[a.key] = { name: p.name, pos: p.pos, number: numbers[a.key] }
  }
  const tl = buildGraphicsTimeline({ anim, play, offense: club(play.offId), defense: club(defId), people })
  const qb = actors.get('qb')
  const fx = {
    thrower: qb ? { thp: qb.attrs?.['THP'], tha: qb.attrs?.['THA'] } : undefined,
    pressured: !!play.pressure,
  }
  const offHome = play.offId === s.homeId
  const scrimmage = play.type === 'run' || play.type === 'pass'
  const los = play.type === 'kickoff' ? null : 10 + snapYard(play)
  const fd = scrimmage && play.down != null && play.distance != null ? Math.min(110, 10 + play.startYard + play.distance) : null
  return {
    anim,
    actorPlay: { anim, offClub: club(play.offId), defClub: club(defId), offHome, numbers },
    dir: offHome ? 1 : -1,
    los,
    fd: fd != null && fd >= 110 ? null : fd,
    turfText: scrimmage && play.down != null && play.distance != null ? `${ord(play.down)} & ${play.startYard + play.distance >= 100 ? 'GOAL' : play.distance}` : null,
    possession: offHome ? 'home' : 'away',
    tl,
    fx,
    play,
    replayDirector: (vp) => {
      const d = createBroadcastDirector({ profile: 'replay', viewport: vp })
      d.reset(play, anim)
      return d
    },
  }
}

/** A director pose (offence frame) in world coordinates (180° turn when the offence attacks −x). */
function poseToWorld(p: CameraPose, dir: Direction): CameraPose {
  if (dir === 1) return p
  const a = offenseToWorld(p.pos[0], p.pos[1], dir)
  const b = offenseToWorld(p.target[0], p.target[1], dir)
  return { pos: [a.x, a.y, p.pos[2]], target: [b.x, b.y, p.target[2]], fovDeg: p.fovDeg }
}

function shotPose(shot: Shot, dir: Direction, fx: number, fy: number, phone: boolean): CameraPose {
  const behind = dir === 1 ? 0 : Math.PI
  switch (shot) {
    case 'skycam':
      return orbitPose({ focusX: fx, focusY: fy, back: phone ? 28 : 32, height: phone ? 23 : 21.5, yaw: behind, fovDeg: phone ? 50 : 43 })
    case 'tight':
      return orbitPose({ focusX: fx, focusY: fy, back: 17, height: 11, yaw: behind + 0.25, fovDeg: phone ? 50 : 40 })
    case 'sideline':
      return orbitPose({ focusX: fx, focusY: MID_WIDTH + (fy - MID_WIDTH) * 0.5, back: 50, height: 22, yaw: Math.PI / 2, fovDeg: phone ? 46 : 30 })
    case 'reverse':
      return orbitPose({ focusX: fx, focusY: fy, back: 30, height: 21, yaw: behind + Math.PI, fovDeg: phone ? 50 : 43 })
  }
}

interface Readout {
  fps: number
  avg: number
  p95: number
  actAvg: number
  actP95: number
  actWorst: number
  drawn: number
  figures: number
  sprites: number
  hitRate: number
  w: number
  h: number
  dpr: number
  /** Graphics layer cost (ms). */
  gfxAvg: number
  gfxP95: number
  /** B4 ball + effects cost (ms). */
  fxAvg: number
  fxP95: number
  /** B6b telestrator cost (ms). */
  teleAvg: number
  teleP95: number
  /** Nothing changed since the last report (paused / settled): no frames drawn. */
  idle: boolean
}

export default function BroadcastPlayersPreview({ homeId = 'ATL' }: { homeId?: string }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const theme = useResolvedTheme()
  const [awayPick, setAwayPick] = useState('CLE')
  const awayId = awayPick === homeId ? (homeId === 'CLE' ? 'ATL' : 'CLE') : awayPick
  const [sampleState, setSampleState] = useState<{ key: string; s: Sample } | null>(null)
  const [errorState, setError] = useState<{ key: string; msg: string } | null>(null)
  const [kind, setKind] = useState<Kind>('pass')
  const [pick, setPick] = useState(0)
  const [builtState, setBuiltState] = useState<{ sample: Sample; idx: number; b: Built } | null>(null)
  const [shot, setShot] = useState<Shot>('skycam')
  const [size, setSize] = useState<Size>('wide')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [sprites, setSprites] = useState(true)
  const [graphics, setGraphics] = useState<GraphicsMode>('full')
  const [effects, setEffects] = useState<EffectsMode>('full')
  const [replays, setReplays] = useState<ReplaySetting>('big')
  const [replayPhase, setReplayPhase] = useState<ReplayPhase | null>(null)
  const [scrub, setScrub] = useState(0)
  const [readout, setReadout] = useState<Readout | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)
  const live = useRef({ built: null as Built | null, shot, playing: playing && !reduced, speed, sprites, phone: size === 'phone', homeId, awayId, theme, scrubbing: false, graphics, effects, reduced, replays, forceReplay: false })
  /** B6b replay controls the loop reads (start / skip). */
  const replayCtl = useRef({ start: (_force: boolean) => {}, skip: () => {} })

  // Simulate a game when the matchup changes (results are keyed by matchup, so
  // a stale one simply reads as "loading").
  const matchKey = `${homeId}|${awayId}`
  useEffect(() => {
    let cancelled = false
    simulateSample(homeId, awayId, 4242)
      .then((s) => !cancelled && setSampleState({ key: `${homeId}|${awayId}`, s }))
      .catch((e: unknown) => !cancelled && setError({ key: `${homeId}|${awayId}`, msg: String(e) }))
    return () => {
      cancelled = true
    }
  }, [homeId, awayId])
  const sample = sampleState && sampleState.key === matchKey ? sampleState.s : null

  const list = useMemo(() => {
    if (!sample) return []
    const test = KINDS.find((k) => k.id === kind)!.test
    return sample.plays.map((p, i) => ({ p, i })).filter(({ p }) => test(p))
  }, [sample, kind])
  const playIdx = list.length ? list[Math.min(pick, list.length - 1)].i : -1

  useEffect(() => {
    let cancelled = false
    if (!sample || playIdx < 0) return
    buildSample(sample, playIdx)
      .then((b) => {
        if (cancelled) return
        tRef.current = 0
        setBuiltState({ sample, idx: playIdx, b })
      })
      .catch((e: unknown) => !cancelled && setError({ key: matchKey, msg: String(e) }))
    return () => {
      cancelled = true
    }
  }, [sample, playIdx, matchKey])
  const built = builtState && builtState.sample === sample && builtState.idx === playIdx ? builtState.b : null
  const error = errorState && errorState.key === matchKey ? errorState.msg : null
  useEffect(() => {
    live.current = { ...live.current, built, shot, playing: playing && !reduced, speed, sprites, phone: size === 'phone', homeId, awayId, theme, graphics, effects, reduced, replays }
  }, [built, shot, playing, reduced, speed, sprites, size, homeId, awayId, theme, graphics, effects, replays])

  // Renderer + actor layer + loop.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    // The graphics layer paints the vignette under the HUD (renderer's off).
    const r = new BroadcastRenderer(cv, { goalposts: false, vignette: false })
    const layer = new ActorLayer()
    r.hooks.actors = layer.hook
    const gfx = new GraphicsLayer(layer, readGfxTokens(cv))
    gfx.vignette = true
    r.hooks.overlay = gfx.hook
    // B6b: the telestrator wraps the graphics (strokes under the HUD, the wipe
    // and REPLAY bug over it) and takes the vignette over from the graphics.
    const tele = new TelestratorLayer(readGfxTokens(cv), layer)
    attachTelestrator(r, tele, gfx)
    const twin = new FrameWindow(120)
    let rp: ReplayPlayer | null = null
    let rpDirector: Director | null = null
    let rpBuilt: Built | null = null
    let lastPhase: ReplayPhase | null = null
    const gwin = new FrameWindow(120)
    // B4: the ball + effects composer for the loaded play (rebuilt on play /
    // quality / reduced-motion change). `fxwin` times its draw work.
    const fxwin = new FrameWindow(120)
    let fx: BallFx | null = null
    let lastFxSig = ''
    const fxAcc = { v: 0 }
    const timedFx = (f: BallFx): BallFx => {
      const g = f.ground.bind(f)
      const air = f.air.bind(f)
      const items = f.items.bind(f)
      return {
        ...f,
        ground: (...args: Parameters<BallFx['ground']>) => {
          const s = performance.now()
          g(...args)
          fxAcc.v += performance.now() - s
        },
        air: (...args: Parameters<BallFx['air']>) => {
          const s = performance.now()
          air(...args)
          fxAcc.v += performance.now() - s
        },
        items: (...args: Parameters<BallFx['items']>) => {
          const s = performance.now()
          items(...args)
          fxAcc.v += performance.now() - s
        },
      }
    }
    // Graphics clock (seconds; negative = pre-snap) and the play time it last drove.
    let sec = 0
    let drivenT = 0
    let pendingSec: number | null = null
    const win = new FrameWindow(120)
    const act = new FrameWindow(120)
    const gaps = new FrameWindow(120)
    let raf = 0
    let last = performance.now()
    let lastReport = last
    let hold = 0
    let loaded: Built | null = null
    let focus = { x: 60, y: MID_WIDTH }
    let hits = 0
    let misses = 0
    // Idle skip: redraw only when something on screen can have changed.
    let lastSig = ''
    let prevDrew = false
    let drewSinceReport = false
    let reportedIdle = false
    let builtGen = 0
    let theme = live.current.theme
    r.onFrame = (s) => win.push(s.ms)
    // For automated frame-cost measurement from the console / CDP.
    ;(window as unknown as Record<string, unknown>).__broadcastB3 = {
      renderer: r,
      layer,
      gfx,
      win,
      act,
      gwin,
      /** Freeze at play time t (0..1); seek(null) resumes. */
      seek: (t: number | null) => {
        live.current.scrubbing = t != null
        if (t != null) tRef.current = t
      },
      /** Freeze at a graphics second (negative = pre-snap; past the play = toast hold). */
      seekSec: (s: number) => {
        live.current.scrubbing = true
        pendingSec = s
      },
    }
    let rpHold = false
    /** Start a replay of `b` when the rules (or a forced request) say so. */
    const startReplay = (b: Built, force: boolean): boolean => {
      const L = live.current
      const plan = replayPlan(b.play, b.anim, { setting: L.replays, force, reducedMotion: L.reduced, playback: L.graphics === 'fast' ? 'fast' : 'live' })
      if (!plan.replay) return false
      rp = new ReplayPlayer(plan)
      rpBuilt = b
      rpHold = false
      rpDirector = b.replayDirector({ w: Math.max(1, cv.clientWidth || 1280), h: Math.max(1, cv.clientHeight || 720) })
      tele.setReplay(plan, b.anim, b.actorPlay.offClub, b.actorPlay.defClub, b.actorPlay.numbers)
      tele.frame = rp.frame()
      return true
    }
    const maybeReplay = (b: Built): boolean => {
      const L = live.current
      const force = L.forceReplay
      if (!force && L.replays === 'off') return false
      return startReplay(b, force)
    }
    const endReplay = () => {
      rp = null
      rpBuilt = null
      rpDirector = null
      rpHold = false
      live.current.forceReplay = false
      tele.frame = null
      tele.setReplay(null, null)
      if (lastPhase !== null) {
        lastPhase = null
        setReplayPhase(null)
      }
    }
    replayCtl.current = {
      /** force: replay the play right after its live run (the Replay button). */
      start: (force: boolean) => {
        const b = loaded
        if (!b) return
        endReplay()
        live.current.forceReplay = force
        sec = live.current.graphics === 'full' && !live.current.reduced ? b.tl.start : 0
        tRef.current = 0
        drivenT = 0
        hold = 0
      },
      skip: () => rp?.skip(),
    }
    const dbg = (window as unknown as Record<string, Record<string, unknown>>).__broadcastB3
    dbg.tele = tele
    dbg.twin = twin
    dbg.replay = {
      /** Start the forced replay of the loaded play now (no live run first). */
      now: () => {
        if (!loaded || !startReplay(loaded, true)) return false
        sec = loaded.tl.end
        return true
      },
      skip: () => rp?.skip(),
      /** Hold the replay at replay second s (null resumes). */
      seek: (s: number | null) => {
        if (!rp) return null
        if (s == null) {
          rpHold = false
          return null
        }
        rpHold = true
        return rp.seek(s)
      },
      get plan() {
        return rp?.plan ?? null
      },
      get frame() {
        return rp?.frame() ?? null
      },
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const L = live.current
      const gap = now - last
      const dt = Math.min(0.1, gap / 1000)
      last = now
      if (document.hidden) {
        prevDrew = false
        return
      }
      const b = L.built
      if (b && b !== loaded) {
        loaded = b
        builtGen++
        layer.setPlay(b.actorPlay)
        gfx.setTimeline(b.tl)
        sec = L.graphics === 'full' && !L.reduced ? b.tl.start : 0
        drivenT = tRef.current
        const p0 = b.anim.ball[0] ?? { x: 60, y: MID_WIDTH }
        focus = offenseToWorld(p0.x, p0.y, b.dir)
        hold = 0
      }
      // B4: (re)build the ball + effects composer when the play, quality or
      // reduced-motion changes. With effects off, B3's placeholder ball stays.
      const fxSig = `${builtGen}|${L.effects}|${L.reduced}`
      if (b && L.effects !== 'off' && fxSig !== lastFxSig) {
        fx = timedFx(
          createBallFx({
            anim: b.anim,
            offenseClub: b.actorPlay.offClub,
            defenseClub: b.actorPlay.defClub,
            reducedMotion: L.reduced,
            quality: L.effects === 'lite' ? 'lite' : 'full',
            thrower: b.fx.thrower,
            pressured: b.fx.pressured,
          }),
        )
        // withBallFx turns B3's placeholder ball off and wires the ball + ground
        // effects into its depth sort; B6a's overlay hook is untouched.
        r.hooks.actors = withBallFx(layer, fx, () => layer.t)
        lastFxSig = fxSig
      } else if (L.effects === 'off' && lastFxSig !== 'off') {
        fx = null
        layer.drawBall = true
        layer.ground = undefined
        layer.addItems = undefined
        r.hooks.actors = layer.hook
        lastFxSig = 'off'
      }
      if (L.theme !== theme) {
        theme = L.theme
        layer.sprites.refreshFont()
      }
      layer.useSprites = L.sprites
      let settling = false
      // B6b: a replay in progress owns the clock (live end frame → wipe → replay → wipe → live).
      if (rp && rpBuilt !== b) endReplay()
      gfx.reducedMotion = L.reduced
      tele.reducedMotion = L.reduced
      if (rp && b) {
        const f = rpHold ? rp.frame() : rp.advance(L.playing && !L.scrubbing ? dt * L.speed : 0)
        if (f.phase === 'done') {
          endReplay()
          sec = L.graphics === 'full' && !L.reduced ? b.tl.start : 0
          tRef.current = 0
        } else {
          tele.frame = f
          if (f.showReplay) {
            // The replay: chip only (no live callouts / toast over the telestrations).
            tRef.current = f.t
            gfx.mode = L.graphics === 'off' ? 'off' : 'fast'
            gfx.sec = f.t * b.tl.duration
          } else if (f.phase === 'wipeOut') {
            tRef.current = 0
            gfx.mode = L.graphics
            gfx.sec = L.graphics === 'full' ? b.tl.start : 0
          } else {
            tRef.current = 1
            gfx.mode = L.graphics
            gfx.sec = sec
          }
          layer.t = tRef.current
          drivenT = tRef.current
        }
        if (f.phase !== lastPhase) {
          lastPhase = f.phase === 'done' ? null : f.phase
          setReplayPhase(lastPhase)
        }
      }
      if (!rp) {
        if (b && pendingSec != null) {
          sec = pendingSec
          pendingSec = null
          tRef.current = Math.max(0, Math.min(1, sec / b.tl.duration))
          drivenT = tRef.current
        } else if (b && L.graphics === 'full' && L.playing && !L.scrubbing) {
          // Graphics clock: pre-snap lead → play → toast hold, then (replay or) loop.
          if (tRef.current !== drivenT) sec = tRef.current * b.tl.duration
          sec += dt * L.speed
          if (sec > b.tl.end + 0.4) {
            // A replay keeps the toast on the live end frame under the wipe.
            if (!maybeReplay(b)) sec = b.tl.start
            else sec = b.tl.end
          }
          tRef.current = Math.max(0, Math.min(1, sec / b.tl.duration))
          drivenT = tRef.current
        } else if (b && tRef.current !== drivenT) {
          // Scrubbed / seeked: the graphics follow the play time.
          sec = tRef.current * b.tl.duration
          drivenT = tRef.current
        }
        gfx.mode = L.graphics
        gfx.sec = sec
      }
      if (b && !rp) {
        const D = layer.duration
        if (L.playing && !L.scrubbing && L.graphics !== 'full') {
          if (tRef.current >= 1) {
            hold += dt
            if (hold > 1.4) {
              hold = 0
              if (!maybeReplay(b)) tRef.current = 0
            }
          } else tRef.current = Math.min(1, tRef.current + (dt * L.speed) / D)
          if (!rp) {
            sec = tRef.current * b.tl.duration
            drivenT = tRef.current
            gfx.sec = sec
          }
        }
        layer.t = tRef.current
      }
      if (b && !(rp && tele.frame?.showReplay)) {
        // Follow the ball (B5 replaces this with the camera director).
        const bp = posAt(b.anim.ball, tRef.current)
        const bw = layer.anim ? offenseToWorld(bp.x, bp.y, b.dir) : focus
        settling = Math.abs(bw.x - focus.x) > 0.01 || Math.abs(bw.y - focus.y) > 0.01
        const k = 1 - Math.pow(0.02, dt)
        focus = { x: focus.x + (bw.x - focus.x) * k, y: focus.y + (bw.y - focus.y) * k }
      }
      const sig = `${builtGen}|${tRef.current}|${sec}|${rp ? rp.sec : -1}|${L.graphics}|${L.effects}|${L.shot}|${L.phone}|${L.sprites}|${L.homeId}|${L.awayId}|${L.theme}|${cv.clientWidth}x${cv.clientHeight}@${window.devicePixelRatio}|${layer.sprites.ready}`
      const dirty = settling || sig !== lastSig
      lastSig = sig
      if (dirty) {
        if (prevDrew) gaps.push(gap)
        prevDrew = true
        drewSinceReport = true
        draw(b)
      } else prevDrew = false
      if (now - lastReport > 500) {
        lastReport = now
        if (drewSinceReport) {
          reportedIdle = false
          setReadout({
            fps: gaps.avg > 0 ? 1000 / gaps.avg : 0,
            avg: win.avg,
            p95: win.p95,
            actAvg: act.avg,
            actP95: act.p95,
            actWorst: act.worst,
            drawn: layer.stats.drawn,
            figures: layer.stats.figures,
            sprites: layer.stats.spriteEntries,
            hitRate: hits + misses ? hits / (hits + misses) : 0,
            w: cv.width,
            h: cv.height,
            dpr: r.pixelRatio,
            gfxAvg: gwin.avg,
            gfxP95: gwin.p95,
            fxAvg: fxwin.avg,
            fxP95: fxwin.p95,
            teleAvg: twin.avg,
            teleP95: twin.p95,
            idle: false,
          })
        } else if (!reportedIdle) {
          reportedIdle = true
          setReadout((prev) => prev && { ...prev, idle: true })
        }
        drewSinceReport = false
        if (L.playing && !L.scrubbing) setScrub(tRef.current)
        hits = 0
        misses = 0
      }
    }
    const draw = (b: Built | null) => {
      const L = live.current
      const dir = b?.dir ?? 1
      fxAcc.v = 0
      // B6b: the replay director's higher camera while the replay shows.
      const pose0 =
        rp && rpDirector && tele.frame?.showReplay ? poseToWorld(rpDirector.toCamera(rpDirector.shotAt(layer.t)), dir) : shotPose(L.shot, dir, focus.x + dir * 4, focus.y, L.phone)
      // B4 camera shake moves the whole scene (pos and target together); it is
      // exactly 0 outside a big hit and 0 under reduced motion.
      const pose = fx ? fx.shakePose(pose0, layer.t) : pose0
      r.draw({
        camera: pose,
        losYard: b?.los ?? null,
        firstDownYard: b?.fd ?? null,
        direction: dir,
        homeTeamId: L.homeId,
        awayTeamId: L.awayId,
        possession: b?.possession ?? 'away',
        turfText: b?.turfText ?? null,
        turfTextAlpha: Math.max(0, 1 - tRef.current * 8),
        time: tRef.current,
      })
      gwin.push(gfx.stats.ms)
      if (rp) twin.push(tele.stats.ms)
      if (fx) fxwin.push(fxAcc.v)
      if (b) {
        act.push(layer.stats.ms)
        hits += layer.stats.spriteHits
        misses += layer.stats.spriteMisses
      }
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      r.destroy()
      layer.dispose()
      delete (window as unknown as Record<string, unknown>).__broadcastB3
    }
  }, [])

  useEffect(() => {
    if (size !== 'full') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSize('wide')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [size])

  const play = playIdx >= 0 && sample ? sample.plays[playIdx] : null
  const selectCls = 'h-9 max-w-full rounded-[var(--r-md)] border border-line-strong bg-surface px-2 text-[16px] text-ink sm:text-small'

  const stats = readout && (
    <div className="font-cond text-small tabular-nums text-muted" aria-live="off">
      {readout.idle ? 'idle (nothing changed; not redrawing)' : `${readout.fps.toFixed(0)} fps`} · frame {readout.avg.toFixed(2)} ms avg / {readout.p95.toFixed(2)} p95 · players {readout.actAvg.toFixed(2)} ms avg /{' '}
      {readout.actP95.toFixed(2)} p95 / {readout.actWorst.toFixed(1)} worst · {readout.drawn}/{readout.figures} figures drawn · sprites {readout.sprites} (
      {(readout.hitRate * 100).toFixed(0)}% hit) · graphics {readout.gfxAvg.toFixed(2)} ms avg / {readout.gfxP95.toFixed(2)} p95 · effects {readout.fxAvg.toFixed(2)} ms avg /{' '}
      {readout.fxP95.toFixed(2)} p95 · telestrator {readout.teleAvg.toFixed(2)} ms avg / {readout.teleP95.toFixed(2)} p95 · {readout.w}×{readout.h} @{readout.dpr}x
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Play kind"
          size="sm"
          value={kind}
          onChange={(k) => {
            setKind(k)
            setPick(0)
          }}
          options={KINDS.map((k) => ({ id: k.id, label: k.label }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 items-center gap-2">
          <span className="label">Play</span>
          <select value={Math.min(pick, Math.max(0, list.length - 1))} onChange={(e) => setPick(Number(e.target.value))} className={cn(selectCls, 'w-[min(560px,80vw)]')}>
            {list.map(({ p, i }, j) => (
              <option key={i} value={j}>
                Q{p.qtr} {p.clock} · {p.down != null ? `${ord(p.down)} & ${p.distance} · ` : ''}
                {p.type} · {p.concept ? `${p.concept} · ` : ''}
                {p.result}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="label">Visitors</span>
          <select value={awayId} onChange={(e) => setAwayPick(e.target.value)} className={selectCls}>
            {NFL_TEAMS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.abbr} · {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => setPlaying((p) => !p)} disabled={reduced}>
          {playing && !reduced ? 'Pause' : reduced ? 'Paused (reduced motion)' : 'Play'}
        </Button>
        <label className="flex items-center gap-2">
          <span className="label">Time</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(scrub * 1000)}
            aria-label="Play time"
            onPointerDown={() => (live.current.scrubbing = true)}
            onPointerUp={() => (live.current.scrubbing = false)}
            onChange={(e) => {
              const v = Number(e.target.value) / 1000
              tRef.current = v
              setScrub(v)
            }}
            className="w-48"
          />
        </label>
        <SegmentedControl
          label="Speed"
          size="sm"
          value={String(speed) as '0.25' | '0.5' | '1'}
          onChange={(v) => setSpeed(Number(v))}
          options={[
            { id: '0.25', label: '¼×' },
            { id: '0.5', label: '½×' },
            { id: '1', label: '1×' },
          ]}
        />
        <SegmentedControl
          label="Camera"
          size="sm"
          value={shot}
          onChange={setShot}
          options={[
            { id: 'skycam', label: 'Skycam' },
            { id: 'tight', label: 'Tight' },
            { id: 'sideline', label: 'Near side' },
            { id: 'reverse', label: 'Reverse' },
          ]}
        />
        <SegmentedControl
          label="Size"
          size="sm"
          value={size}
          onChange={setSize}
          options={[
            { id: 'wide', label: '16:9' },
            { id: 'phone', label: '375 px' },
            { id: 'full', label: 'Full window' },
          ]}
        />
        <SegmentedControl
          label="Sprite parts"
          size="sm"
          value={sprites ? 'on' : 'off'}
          onChange={(v) => setSprites(v === 'on')}
          options={[
            { id: 'on', label: 'Sprites' },
            { id: 'off', label: 'Direct paint' },
          ]}
        />
        <SegmentedControl
          label="Graphics"
          size="sm"
          value={graphics}
          onChange={setGraphics}
          options={[
            { id: 'full', label: 'Graphics' },
            { id: 'fast', label: 'Sim-to-end' },
            { id: 'off', label: 'Off' },
          ]}
        />
        <SegmentedControl
          label="Effects"
          size="sm"
          value={effects}
          onChange={setEffects}
          options={[
            { id: 'full', label: 'Ball + FX' },
            { id: 'lite', label: 'Lite' },
            { id: 'off', label: 'Off' },
          ]}
        />
        <SegmentedControl
          label="Replays"
          size="sm"
          value={replays}
          onChange={setReplays}
          options={[
            { id: 'big', label: 'Big plays' },
            { id: 'all', label: 'All' },
            { id: 'off', label: 'Off' },
          ]}
        />
        <Button
          size="sm"
          onClick={() => {
            replayCtl.current.start(true)
            setPlaying(true)
          }}
          disabled={!built || graphics === 'fast'}
        >
          Replay
        </Button>
        {replayPhase && (
          <Button size="sm" onClick={() => replayCtl.current.skip()}>
            Skip replay
          </Button>
        )}
      </div>
      {error && <div className="text-small text-loss">Could not build the sample: {error}</div>}
      {!sample && !error && <div className="label">Simulating a sample game…</div>}
      {play && (
        <div className="text-small text-muted">
          {play.offId} ball · {play.type} · {play.concept} · {play.result} ({play.yards} yd)
        </div>
      )}
      {stats}
      <div
        className={cn(
          'broadcast overflow-hidden bg-canvas',
          size === 'full' ? 'fixed inset-0 z-50' : 'relative rounded-[var(--r-lg)] border border-line',
          size === 'wide' && 'aspect-video w-full max-w-[1280px]',
          size === 'phone' && 'h-[410px] w-[375px] max-w-full',
        )}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" role="img" aria-label="Broadcast players preview: a sample play with code-drawn players" />
        {size === 'full' && (
          <div className="absolute left-4 right-4 top-4 flex flex-wrap items-start justify-between gap-3">
            <div className="broadcast rounded-[var(--r-md)] bg-surface/80 p-2">{stats}</div>
            <button
              type="button"
              onClick={() => setSize('wide')}
              className="broadcast rounded-[var(--r-md)] border border-line-strong bg-surface px-3 py-2 font-cond text-small font-700 uppercase tracking-[0.06em] text-ink"
            >
              Close (Esc)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
