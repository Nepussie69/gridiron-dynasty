import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronsRight, Clock, Eye, Goal, Pause, Play, Shield, SkipForward, Target, Timer, Wind, X, Zap } from 'lucide-react'
import { cn } from '../lib/cn'
import { coachLabels, penaltyTotals, PENALTY_INFO, type GameState, type Play as PlayEvent, type Moment, type MomentKind, type PenaltyKind, type PenaltyTally } from '../game/engine/playsim'
import type { World } from '../game/engine/generate'
import type { GameStatLine } from '../game/types'
import { capabilities } from '../game/engine/capabilities'
import { originTag } from '../game/selectors'
import { boxScore, coverageGrade, passerRating } from '../game/engine/stats'
import { useGame, useWorld, type GameDay } from '../store/gameStore'
import { PLAN_PRESETS } from '../game/engine/gameplan'
import { coordinatorAdvice } from '../game/engine/advice'
import { fourthAdvice } from '../game/engine/analytics'
import { PlanEditor } from './PlanEditor'
import { PersonnelCard } from './PersonnelCard'
import { KeysCard } from './KeysCard'
import { canPractice, practicePlan } from '../game/engine/practice'
import { canPickKeys } from '../game/engine/keys'
import { buildPlayAnim, holderAt, liftAt, posAt, snapYard, targetKey, actorWhy } from './playAnim'
import { RouteDiagram } from './RouteDiagram'
import { quickOffCall } from '../game/engine/quickCall'
import { FORMATIONS, playbookPlay } from '../game/data/playbookData'
import { actorPlayers, teamJerseys } from './jersey'
import { TeamHoverCard } from './TeamHoverCard'
import { Badge, Button, TeamCrest } from '../ui/kit'

const CENTER_Y = 26.65
const W = 120
const H = 53.3
const FORMATION_ORDER = FORMATIONS.map((f) => f.name)

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function colorGap(a: string, b: string): number {
  const [r1, g1, b1] = hexRgb(a)
  const [r2, g2, b2] = hexRgb(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}
function luminance(hex: string): number {
  const [r, g, b] = hexRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.04) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const FIELD_GREEN = '#1f7a3f'
/** A club color that reads on the green field: primary unless it's too dark or too close to the grass. */
function fieldColor(team: import('../game/types').Team): string {
  const ok = (c: string) => luminance(c) > 0.045 && colorGap(c, FIELD_GREEN) > 90
  if (ok(team.primary)) return team.primary
  if (ok(team.secondary)) return team.secondary
  return luminance(team.primary) > luminance(team.secondary) ? team.primary : team.secondary
}
/** Jersey colors for both clubs; the away club switches color when the two clash. */
function jerseyColors(home: import('../game/types').Team, away: import('../game/types').Team): { home: string; away: string } {
  const homeC = fieldColor(home)
  let awayC = fieldColor(away)
  if (colorGap(homeC, awayC) < 90) {
    const alt = awayC === away.primary ? away.secondary : away.primary
    awayC = colorGap(homeC, alt) > colorGap(homeC, awayC) ? alt : '#ffffff'
  }
  return { home: homeC, away: awayC }
}

// ── U1: TV broadcast field helpers (visual only; never touch the sim) ─────────
const MOW_A = '#1d7a3d'
const MOW_B = '#238a48'
/** NFL hash marks sit 70'9" in from each sideline. */
const HASH_A = 23.58
const HASH_B = H - HASH_A
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Static field geometry, built once as path data so the whole field renders as
// a handful of nodes instead of hundreds on every animation frame.
const YARD_LINE_10 = Array.from({ length: 11 }, (_, i) => 10 + i * 10).map((x) => `M${x} 0V${H}`).join(' ')
const YARD_LINE_5 = Array.from({ length: 10 }, (_, i) => 15 + i * 10).map((x) => `M${x} 0V${H}`).join(' ')
function hashPath(long: boolean): string {
  const out: string[] = []
  for (let x = long ? 15 : 11; x <= (long ? 105 : 109); x += long ? 5 : 1) {
    if (!long && x % 5 === 0) continue
    const inLen = long ? 1.5 : 0.8
    const sideLen = long ? 1.2 : 0.7
    out.push(
      `M${x} ${HASH_A}V${HASH_A + inLen}`,
      `M${x} ${HASH_B}V${HASH_B - inLen}`,
      `M${x} 0.6V${0.6 + sideLen}`,
      `M${x} ${H - 0.6}V${H - 0.6 - sideLen}`,
    )
  }
  return out.join(' ')
}
const HASH_LONG = hashPath(true)
const HASH_SHORT = hashPath(false)

// 10, 20 … 50 … 20, 10 measured from the nearer goal line.
const YARD_NUMBERS = Array.from({ length: 9 }, (_, i) => 20 + i * 10)

/** Deterministic confetti pieces (no rng): layout, timing and club-colour index. */
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  x: ((i * 37) % 21) - 10,
  y: ((i * 53) % 11) - 5,
  delay: (i % 8) * 0.07,
  dur: 1.05 + (i % 5) * 0.12,
  c: i % 2,
  w: 0.5 + (i % 3) * 0.14,
  h: 0.3 + (i % 2) * 0.14,
}))

type ToastTone = 'gold' | 'good' | 'bad' | 'plain'
const TOAST_TONE: Record<ToastTone, string> = {
  gold: 'border-[#ffd34d]/70 bg-[#ffd34d]/20 text-[#ffe9a3]',
  good: 'border-[#8ef0b5]/50 bg-[#0d3b26]/70 text-[#8ef0b5]',
  bad: 'border-[#ffb3ba]/50 bg-[#3b0d13]/70 text-[#ffb3ba]',
  plain: 'border-white/20 bg-black/55 text-white/85',
}

/** The TV play-result toast, built only from the recorded PlayEvent fields. */
function playToast(play: PlayEvent, next?: PlayEvent): { text: string; tone: ToastTone } | null {
  if (play.type === 'run' || play.type === 'pass') {
    if (play.result === 'TOUCHDOWN!') return { text: 'TOUCHDOWN', tone: 'gold' }
    if (play.type === 'pass' && play.result.startsWith('Sack')) return { text: `SACK −${Math.abs(play.yards)}`, tone: 'bad' }
    if (play.type === 'pass' && play.result.startsWith('Interception')) return { text: 'INTERCEPTED', tone: 'bad' }
    if (play.result.includes('Fumble')) return { text: 'FUMBLE', tone: 'bad' }
    if (play.result === 'Incomplete') return { text: 'INCOMPLETE', tone: 'plain' }
    const firstDown = play.result.includes('first down')
      || (!!next && next.offId === play.offId && next.down === 1 && (next.type === 'run' || next.type === 'pass'))
    const sign = play.yards >= 0 ? '+' : '−'
    return { text: `${sign}${Math.abs(play.yards)}${firstDown ? ' · First down' : ''}`, tone: firstDown ? 'good' : play.yards < 0 ? 'bad' : 'plain' }
  }
  if (play.type === 'pat') return play.result.includes('good')
    ? { text: play.result.includes('Two-point') ? '2-PT GOOD' : 'EXTRA POINT', tone: 'good' }
    : { text: 'XP MISSED', tone: 'bad' }
  if (play.type === 'fg') return /no good|MISSED/i.test(play.result) ? { text: 'FG MISSED', tone: 'bad' } : { text: 'FIELD GOAL', tone: 'good' }
  if (play.type === 'punt') return { text: 'PUNT', tone: 'plain' }
  if (play.type === 'penalty') return { text: 'PENALTY', tone: 'bad' }
  if (play.type === 'kickoff') return { text: play.result === 'Touchback' ? 'TOUCHBACK' : 'KICKOFF', tone: 'plain' }
  if (play.type === 'end') return { text: play.result.toUpperCase(), tone: 'plain' }
  return null
}


export function MatchView() {
  const world = useWorld()
  const match = useGame((s) => s.match)
  const matchSeq = useGame((s) => s.matchSeq)
  const closeMatch = useGame((s) => s.closeMatch)
  const gameDay = useGame((s) => s.gameDay)
  const gameDayAdvance = useGame((s) => s.gameDayAdvance)
  const answerGameMoment = useGame((s) => s.answerGameMoment)
  const callTimeout = useGame((s) => s.callTimeout)
  const simGameDayToEnd = useGame((s) => s.simGameDayToEnd)
  const abandonGameDay = useGame((s) => s.abandonGameDay)
  const viewTeam = useGame((s) => s.viewTeam)
  const career = useGame((s) => s.career)

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  // Space / Pause freezes the animation exactly where it is; Play resumes from there.
  const [frozen, setFrozen] = useState(false)
  const tRef = useRef<{ i: number; t: number }>({ i: -1, t: 0 })
  const [speed, setSpeed] = useState(1)
  // Animation clock for the play on screen: t runs 0..1 after a short pre-snap beat.
  const [clock, setClock] = useState<{ i: number; t: number }>({ i: -1, t: 0 })
  // Bumped to replay the play on screen (Play pressed on the last play).
  const [replay, setReplay] = useState(0)
  const timer = useRef<number | null>(null)
  const [tab, setTab] = useState<'plays' | 'box' | 'plan' | 'keys' | 'film'>('plays')
  const [boxTeam, setBoxTeam] = useState<string | null>(null)

  // U1: follow camera + full-field toggle + reduced-motion pref.
  const [fullField, setFullField] = useState(() => {
    try {
      return localStorage.getItem('gd.fullField') === '1'
    } catch {
      return false
    }
  })
  const [fieldAspect, setFieldAspect] = useState(0.55)
  const [cam, setCam] = useState({ x: W / 2, y: CENTER_Y })
  const [reduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const ballRef = useRef({ x: W / 2, y: CENTER_Y })
  const frozenRef = useRef(false)
  const hasMatch = !!match

  // A ~45-yard window shaped like the field box, but never cropping the field
  // to less than ~47 yards sideline to sideline (yard numbers stay visible): on wide, short boxes
  // the window widens instead, so players and dots keep a sensible scale.
  const followW = 45
  const minViewH = 47
  const aspect = fieldAspect > 0.05 ? fieldAspect : 0.55
  let viewH = Math.min(H, Math.max(minViewH, followW / aspect))
  let viewW = viewH * aspect
  if (viewW > W) {
    viewW = W
    viewH = Math.min(H, W / aspect)
  }
  const halfW = viewW / 2
  const halfH = viewH / 2

  // Measure the field box so the follow camera keeps the picture square to it.
  useEffect(() => {
    const el = fieldRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0 && r.height > 0) setFieldAspect(r.width / r.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasMatch])

  // Ease the camera toward the ball (instant under reduced motion); it holds
  // still while the animation is frozen, so a pause never jitters.
  useEffect(() => {
    if (fullField) return
    let raf = 0
    const loop = () => {
      if (!frozenRef.current) {
        setCam((c) => {
          const tx = clampN(ballRef.current.x, halfW, W - halfW)
          const ty = clampN(ballRef.current.y, halfH, H - halfH)
          if (Math.abs(tx - c.x) < 0.02 && Math.abs(ty - c.y) < 0.02) return c
          const k = reduced ? 1 : 0.15
          return { x: c.x + (tx - c.x) * k, y: c.y + (ty - c.y) * k }
        })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [fullField, halfW, halfH, reduced])

  const play = match?.plays[idx]

  // reset to first play whenever a fresh game opens (not when a coached game
  // appends the next chunk of plays)
  useEffect(() => {
    setIdx(0)
    setPlaying(true)
    setSpeed(1)
  }, [matchSeq])

  const byId = useMemo(() => new Map(world.players.map((p) => [p.id, p])), [world.players])
  const nextForAnim = match?.plays[idx + 1]
  // Which real player each dot stands for this play, so the motion can follow
  // his ratings (L12.10 B5) and the hover card can name him.
  const actorMap = useMemo(() => {
    if (!match || !play) return null
    const defId = play.offId === match.homeId ? match.awayId : match.homeId
    const tKey = play.type === 'pass' && play.targetId
      ? targetKey(play, { targetPos: byId.get(play.targetId)?.pos })
      : null
    return actorPlayers(world, play, defId, tKey)
  }, [world, match, play, byId])
  const anim = useMemo(() => {
    if (!play) return null
    return buildPlayAnim(play, {
      next: nextForAnim,
      targetPos: play.targetId ? byId.get(play.targetId)?.pos : undefined,
      carrierIsQB: play.type === 'run' && !!play.carrierId && byId.get(play.carrierId)?.pos === 'QB',
      actors: actorMap ?? undefined,
    })
  }, [play, nextForAnim, byId, actorMap])

  // Feed the follow camera (the ball's mirrored spot and the freeze state) via
  // refs, so the render loop can read them without writing refs during render.
  useEffect(() => {
    frozenRef.current = frozen
    if (match && play && anim) {
      const tt = clock.i === idx ? clock.t : 0
      const bp = posAt(anim.ball, tt)
      ballRef.current = { x: play.offId === match.homeId ? bp.x : W - bp.x, y: bp.y }
    }
  })

  const PRE_SNAP = 250

  // Run the play's animation: a pre-snap beat, then t from 0 to 1.
  useEffect(() => {
    if (!anim || frozen) return
    // A play that already finished stays finished: when a coached game appends
    // the next plays, this play's animation is rebuilt (its "next" changed) —
    // don't replay it from the snap. Replay/jump reset tRef, so they still run.
    if (tRef.current.i === idx && tRef.current.t >= 1) {
      setClock({ i: idx, t: 1 })
      return
    }
    let raf = 0
    const span = anim.duration / speed
    // Resume from a frozen frame of this play; otherwise start after the pre-snap beat.
    const from = tRef.current.i === idx && tRef.current.t < 1 ? tRef.current.t : 0
    const start = from > 0 ? performance.now() - from * span : performance.now() + PRE_SNAP / speed
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / span))
      tRef.current = { i: idx, t }
      setClock({ i: idx, t })
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [anim, idx, speed, replay, frozen])

  // The box score follows the replay: every play up to and including the one on
  // screen, so it never shows stats from further ahead than you've watched.
  // The play log, too: the play on screen and everything before it — never a
  // play that hasn't been shown yet.
  const shownPlays = useMemo(() => match?.plays.slice(0, idx + 1) ?? [], [match, idx])
  const liveBox = useMemo(() => (match ? boxScore(world, { ...match, plays: match.plays.slice(0, idx + 1) }) : undefined), [world, match, idx])

  // Space plays / pauses (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      e.preventDefault()
      document.querySelector<HTMLButtonElement>('[data-play-toggle]')?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Jersey numbers on the dots: the real player each dot stands for this play.
  const numbers = useMemo(() => {
    if (!match) return null
    return new Map([...teamJerseys(world, match.homeId), ...teamJerseys(world, match.awayId)])
  }, [world, match])

  // auto-advance
  useEffect(() => {
    if (!match || !playing || frozen || !play) return
    // Only the part of this play still to animate (it may resume mid-play).
    const done = tRef.current.i === idx ? tRef.current.t : 0
    // Already finished (e.g. the next plays were just appended): move on at once.
    const dur = done >= 1 ? 0 : ((anim?.duration ?? 1600) * (1 - done) + (done > 0 ? 0 : PRE_SNAP)) / speed + (play.type === 'end' ? 200 : 550)
    timer.current = window.setTimeout(() => {
      setIdx((i) => {
        if (i >= match.plays.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, dur)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [idx, playing, frozen, speed, match, play, anim])

  if (!match || !play) return null

  const home = world.byId[match.homeId]
  const away = world.byId[match.awayId]
  // Each club keeps its own end: home defends the left end zone, away the right.
  // When the away club has the ball the play is drawn mirrored, right to left.
  const flip = play.offId !== match.homeId
  const mx = (x: number) => (flip ? W - x : x)
  const jerseys = jerseyColors(home, away)
  const offColor = play.offId === match.homeId ? jerseys.home : jerseys.away
  const defColor = play.offId === match.homeId ? jerseys.away : jerseys.home
  const los = mx(10 + snapYard(play))
  const t = clock.i === idx ? clock.t : 0
  const holder = anim ? holderAt(anim, t) : null
  // G3: pause the replay at the end of what has been simulated so the moment
  // can be called. Nothing shows until the animation catches up.
  const atEnd = idx >= match.plays.length - 1
  // The scoreboard follows the replay (the score after the play on screen), so a
  // coached game never shows a score from further ahead than you've watched.
  const nextPlay = match.plays[idx + 1]
  const shownScore = nextPlay
    ? { home: nextPlay.homeScore, away: nextPlay.awayScore }
    : { home: match.homeScore, away: match.awayScore }
  const moment = gameDay?.moment ?? null
  const showMoment = !!gameDay && !!moment && atEnd
  // T2M: the dock's manual timeout, armed for the next dead ball.
  const userTeamId = gameDay?.state.ctx?.userTeamId ?? career?.teamId
  const timeoutsLeft = userTeamId ? (gameDay?.state.timeouts[userTeamId] ?? 0) : 0
  const timeoutArmed = !!gameDay && !!userTeamId && gameDay.state.manualTimeout === userTeamId

  const vb = fullField
    ? `0 0 ${W} ${H}`
    : `${clampN(cam.x, halfW, W - halfW) - halfW} ${clampN(cam.y, halfH, H - halfH) - halfH} ${viewW} ${viewH}`
  const firstDown = play.down != null && play.distance != null && play.type !== 'kickoff' && play.type !== 'pat'
    ? play.startYard + play.distance
    : null
  const fdX = firstDown != null && firstDown < 100 ? mx(10 + firstDown) : null
  const inRedZone = (play.type === 'run' || play.type === 'pass' || play.type === 'fg') && play.down != null && play.startYard >= 80
  const rzX = Math.min(mx(90), mx(110))
  const rzW = Math.abs(mx(110) - mx(90))
  const isTD = (play.type === 'run' || play.type === 'pass') && play.result === 'TOUCHDOWN!'
  const offTeam = world.byId[play.offId] ?? home
  const ezX = flip ? 0 : 110
  const tgtKey = play.type === 'pass' && play.targetId ? targetKey(play, { targetPos: byId.get(play.targetId)?.pos }) : null
  const trailKeys = [...new Set([holder, tgtKey].filter((k): k is string => !!k))]
  const toast = playToast(play, nextPlay)

  const sideTabs: { id: 'plays' | 'box' | 'plan' | 'keys' | 'film'; label: string }[] = [
    { id: 'plays', label: 'Plays' },
    { id: 'box', label: 'Box score' },
    ...(gameDay ? [{ id: 'plan' as const, label: 'Game plan' }] : []),
    ...(gameDay && career && canPickKeys(career) ? [{ id: 'keys' as const, label: 'Keys' }] : []),
    ...(match.film || match.keys ? [{ id: 'film' as const, label: 'Film' }] : []),
  ]
  const activeTab = sideTabs.some((t) => t.id === tab) ? tab : 'plays'
  const boxTeamId = boxTeam === match.homeId || boxTeam === match.awayId ? boxTeam : (career?.teamId === match.homeId ? match.homeId : match.awayId)
  // R14: the club's penalties by type, for the box score (follows the replay).
  const pen = penaltyTotals(shownPlays, boxTeamId)

  const onClose = () => {
    if (gameDay) {
      if (window.confirm('Abandon this game? Nothing will be recorded and the week is unchanged.')) {
        abandonGameDay()
      }
      return
    }
    closeMatch()
  }

  const answer = (choiceId: string) => {
    setFrozen(false)
    setPlaying(true)
    void answerGameMoment(choiceId)
  }

  const advance = (stop: 'play' | 'drive' | 'moment') => {
    setFrozen(false)
    setPlaying(true)
    void gameDayAdvance(stop)
  }

  // Play / pause. On the last play of a live coached game, Play keeps the game
  // going to the next moment; with a moment waiting (or a finished game) it
  // replays the play on screen.
  const live = !!gameDay && !gameDay.state.done
  const showPause = !frozen && ((playing && !atEnd) || (clock.i === idx && clock.t > 0 && clock.t < 1))
  const togglePlay = () => {
    // Mid-animation: freeze / unfreeze exactly where it is.
    if (frozen) {
      setFrozen(false)
      setPlaying(!atEnd || playing)
      return
    }
    const animating = clock.i === idx && clock.t > 0 && clock.t < 1
    if (animating) {
      setFrozen(true)
      setPlaying(false)
      return
    }
    if (playing && !atEnd) {
      setPlaying(false)
      return
    }
    if (atEnd) {
      if (live && !showMoment) {
        advance('moment')
        return
      }
      tRef.current = { i: -1, t: 0 }
      setReplay((r) => r + 1)
      setPlaying(false)
      return
    }
    setPlaying(true)
  }

  const simToEnd = () => {
    setPlaying(false)
    void simGameDayToEnd()
  }

  const downText = (p: PlayEvent) => (p.down ? `${['1st', '2nd', '3rd', '4th'][p.down - 1]} & ${p.distance}` : '')
  const jump = (i: number) => {
    setFrozen(false)
    tRef.current = { i: -1, t: 0 }
    setIdx(i)
    setPlaying(false)
  }

  const toggleFullField = () => {
    const next = !fullField
    try {
      localStorage.setItem('gd.fullField', next ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
    setFullField(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-[#0a1626] text-white">
      {/* ── U2: broadcast scorebug (replaces the header row) ───────────────── */}
      <header className="flex shrink-0 items-center gap-1.5 border-b border-white/10 bg-black/45 px-2 py-1.5 sm:gap-2 sm:px-3">
        <ScoreBlock team={away} score={shownScore.away} hasBall={play.offId === away.id} timeouts={gameDay?.state.timeouts?.[away.id]} align="left" />
        <div className="mx-auto flex min-w-0 flex-col items-center justify-center leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="whitespace-nowrap rounded bg-white/10 px-2 py-0.5 font-cond text-xs font-700 tnum sm:text-sm">Q{play.qtr} · {play.clock}</span>
            {play.down ? (
              <span className="whitespace-nowrap font-cond text-xs font-700 uppercase sm:text-sm">
                {downText(play)} <span className="hidden text-white/60 sm:inline">at {gameDayFieldPosForPlay(world, play)}</span>
              </span>
            ) : (
              <span className="font-cond text-sm font-600 uppercase text-white/70">{play.concept}</span>
            )}
          </div>
          <span className="mt-0.5 hidden max-w-[42vw] truncate text-[10px] text-white/45 md:block">
            {[away, home].map((t) => {
              const c = coachLabels(world, t.id)
              return `${t.abbr}: ${c.ocScheme} / ${c.dcScheme}`
            }).join('   ·   ')}
          </span>
          {career && canPractice(career) && (
            <span className="mt-0.5 font-cond text-[10px] font-700 uppercase tracking-wide text-[#ffd34d]/85">
              Practice: {practicePlan(career, world)}
            </span>
          )}
        </div>
        <ScoreBlock team={home} score={shownScore.home} hasBall={play.offId === home.id} timeouts={gameDay?.state.timeouts?.[home.id]} align="right" />
        <button onClick={onClose} title={gameDay ? 'Abandon game' : 'Close'} className="ml-0.5 grid h-8 w-8 shrink-0 place-items-center self-center rounded-lg bg-white/10 hover:bg-white/20">
          <X size={16} />
        </button>
      </header>

      {/* ── Body: field + decisions (left), side panel (right) ─────────────── */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,42vh)] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1">
        <div className="flex min-h-0 flex-col overflow-y-auto lg:overflow-hidden">
          {/* Field */}
          <div ref={fieldRef} className="relative min-h-[140px] flex-1 p-3 pb-0">
            <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" className="h-full w-full">
              <defs>
                <filter id="gd-dot-shadow" x="-60%" y="-60%" width="220%" height="220%">
                  <feDropShadow dx="0" dy="0.26" stdDeviation="0.3" floodColor="#04140b" floodOpacity="0.55" />
                </filter>
                <linearGradient id="gd-ez-home" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={10} y2={H}>
                  <stop offset="0" stopColor={home.primary} />
                  <stop offset="1" stopColor={home.secondary} />
                </linearGradient>
                <linearGradient id="gd-ez-away" gradientUnits="userSpaceOnUse" x1={110} y1={0} x2={120} y2={H}>
                  <stop offset="0" stopColor={away.secondary} />
                  <stop offset="1" stopColor={away.primary} />
                </linearGradient>
                <linearGradient id="gd-wm" gradientUnits="userSpaceOnUse" x1={54} y1={CENTER_Y - 8} x2={66} y2={CENTER_Y + 9}>
                  <stop offset="0" stopColor={home.primary} />
                  <stop offset="1" stopColor={away.primary} />
                </linearGradient>
              </defs>

              {/* end zones: club-colour gradients + TV end-zone lettering */}
              <rect x={0} y={0} width={10} height={H} fill="url(#gd-ez-home)" />
              <rect x={110} y={0} width={10} height={H} fill="url(#gd-ez-away)" />
              <text transform={`translate(5 ${CENTER_Y}) rotate(-90)`} textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fillOpacity={0.92} fontSize={4.7} textLength={46} lengthAdjust="spacingAndGlyphs" className="font-display" style={{ fontStyle: 'italic', fontWeight: 800 }}>
                {home.name.toUpperCase()}
              </text>
              <text transform={`translate(115 ${CENTER_Y}) rotate(90)`} textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fillOpacity={0.92} fontSize={4.7} textLength={46} lengthAdjust="spacingAndGlyphs" className="font-display" style={{ fontStyle: 'italic', fontWeight: 800 }}>
                {away.name.toUpperCase()}
              </text>

              {/* two-tone 5-yard mowing stripes */}
              <rect x={10} y={0} width={100} height={H} fill={MOW_A} />
              {Array.from({ length: 20 }, (_, i) => 10 + i * 5).map((x, i) => (
                <rect key={`m${x}`} x={x} y={0} width={5} height={H} fill={i % 2 ? MOW_A : MOW_B} />
              ))}

              {/* red-zone tint inside the 20 the offence is attacking */}
              {inRedZone && <rect x={rzX} y={0} width={rzW} height={H} fill="#e0344a" opacity={0.1} />}

              {/* midfield club-crest watermark */}
              <g opacity={0.09} pointerEvents="none">
                <path d={`M54 ${CENTER_Y - 8} L66 ${CENTER_Y - 8} L66 ${CENTER_Y + 1} Q66 ${CENTER_Y + 8} 60 ${CENTER_Y + 9} Q54 ${CENTER_Y + 8} 54 ${CENTER_Y + 1} Z`} fill="url(#gd-wm)" />
                <ellipse cx={60} cy={CENTER_Y} rx={3.4} ry={2.1} fill="#ffffff" opacity={0.55} />
                <line x1={60} y1={CENTER_Y - 1} x2={60} y2={CENTER_Y + 1} stroke="#0a1626" strokeWidth={0.22} />
                <line x1={59.3} y1={CENTER_Y - 0.6} x2={60.7} y2={CENTER_Y - 0.6} stroke="#0a1626" strokeWidth={0.16} />
                <line x1={59.3} y1={CENTER_Y} x2={60.7} y2={CENTER_Y} stroke="#0a1626" strokeWidth={0.16} />
                <line x1={59.3} y1={CENTER_Y + 0.6} x2={60.7} y2={CENTER_Y + 0.6} stroke="#0a1626" strokeWidth={0.16} />
              </g>

              {/* yard lines, hashes every yard, and the white border */}
              <path d={YARD_LINE_5} stroke="#ffffff" strokeOpacity={0.16} strokeWidth={0.1} />
              <path d={YARD_LINE_10} stroke="#ffffff" strokeOpacity={0.34} strokeWidth={0.16} />
              <path d={HASH_SHORT} stroke="#ffffff" strokeOpacity={0.34} strokeWidth={0.1} />
              <path d={HASH_LONG} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={0.14} />
              <rect x={0.15} y={0.15} width={W - 0.3} height={H - 0.3} fill="none" stroke="#ffffff" strokeOpacity={0.75} strokeWidth={0.34} />
              <line x1={10} y1={0} x2={10} y2={H} stroke="#ffffff" strokeOpacity={0.85} strokeWidth={0.38} />
              <line x1={110} y1={0} x2={110} y2={H} stroke="#ffffff" strokeOpacity={0.85} strokeWidth={0.38} />

              {/* yard numbers every 10 near both sidelines, arrows to the nearer goal */}
              {YARD_NUMBERS.map((x) => {
                const n = Math.min(x - 10, 110 - x)
                const left = x < 60
                return (
                  <g key={`yn${x}`} className="font-display" fill="#ffffff" fillOpacity={0.6} style={{ fontWeight: 800, fontStyle: 'italic' }}>
                    <text x={x} y={7.4} fontSize={5} textAnchor="middle">{n}</text>
                    <text x={x} y={48.6} fontSize={5} textAnchor="middle">{n}</text>
                    {x !== 60 && (
                      <>
                        <path d={left ? `M${x - 2.6} 5.4 l1.6 -0.85 v1.7 z` : `M${x + 2.6} 5.4 l-1.6 -0.85 v1.7 z`} />
                        <path d={left ? `M${x - 2.6} 47.4 l1.6 -0.85 v1.7 z` : `M${x + 2.6} 47.4 l-1.6 -0.85 v1.7 z`} />
                      </>
                    )}
                  </g>
                )
              })}

              {/* line of scrimmage (blue) + first-down line (yellow, if any) */}
              <line x1={los} y1={0} x2={los} y2={H} stroke="#2f7dff" strokeWidth={0.34} opacity={0.95} />
              {fdX != null && <line x1={fdX} y1={0} x2={fdX} y2={H} stroke="#ffd400" strokeWidth={0.3} opacity={0.95} />}

              {/* goal posts at both end lines (bolder on a kick) */}
              {[{ back: 0.8, x: 2.1, dir: 1 }, { back: 119.2, x: 117.9, dir: -1 }].map((gp) => (
                <g key={`gp${gp.x}`} stroke="#ffd34d" strokeOpacity={0.92} strokeWidth={anim?.posts ? 0.42 : 0.32}>
                  <line x1={gp.back} y1={CENTER_Y} x2={gp.x} y2={CENTER_Y} />
                  <line x1={gp.x} y1={CENTER_Y - 3.1} x2={gp.x} y2={CENTER_Y + 3.1} />
                  <line x1={gp.x} y1={CENTER_Y - 3.1} x2={gp.x + gp.dir * 0.9} y2={CENTER_Y - 3.1} />
                  <line x1={gp.x} y1={CENTER_Y + 3.1} x2={gp.x + gp.dir * 0.9} y2={CENTER_Y + 3.1} />
                </g>
              ))}

              {/* motion trails: ball carrier + targeted receiver (render only) */}
              {anim && trailKeys.map((k) => {
                const act = anim.actors.find((a) => a.key === k)
                if (!act) return null
                return (
                  <g key={`trail-${k}`}>
                    {[6, 5, 4, 3, 2, 1].map((s) => {
                      const tt = t - s * 0.035
                      if (tt <= 0) return null
                      const p = posAt(act.path, tt)
                      return <circle key={s} cx={mx(p.x)} cy={p.y} r={1.4 - s * 0.12} fill={k === holder ? '#ffd34d' : offColor} opacity={0.28 - s * 0.04} />
                    })}
                  </g>
                )
              })}

              {/* players: larger pucks, side ring colours, soft shadow, carrier pulse */}
              {anim?.actors.map((a) => {
                const pt = posAt(a.path, t)
                const carrying = holder === a.key
                const who = actorMap?.get(a.key)
                const num = who ? numbers?.get(who.id) : undefined
                return (
                  <g key={a.key} transform={`translate(${mx(pt.x)} ${pt.y})`}>
                    {who && (
                      <title>
                        {`#${num ?? ''} ${who.name} (${who.pos})`}
                        {frozen ? ` · SPD ${Math.round(who.attrs?.SPD ?? who.ovr)} · ${actorWhy(play, a.key, who)}` : ''}
                      </title>
                    )}
                    {carrying && !frozen && !reduced && (
                      <circle r={2} fill="none" stroke="#ffd34d" strokeWidth={0.26} opacity={0.7}>
                        <animate attributeName="r" values="2;3.6" dur="0.9s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.7;0" dur="0.9s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle r={1.75} fill={a.side === 'off' ? offColor : defColor} stroke={carrying ? '#ffd34d' : a.side === 'off' ? '#ffffff' : '#0a1626'} strokeWidth={carrying ? 0.42 : 0.3} filter="url(#gd-dot-shadow)" />
                    {num !== undefined && (
                      <text y={0.62} fontSize={1.9} textAnchor="middle" fill="#fff" stroke="#000" strokeOpacity={0.6} strokeWidth={0.16} paintOrder="stroke" className="font-cond" style={{ fontWeight: 700, pointerEvents: 'none' }}>
                        {num}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* ball: dashed arc while airborne, lace, and a burst at the end spot */}
              {anim && (() => {
                const b = posAt(anim.ball, t)
                const lift = liftAt(anim, t)
                const bx = mx(b.x)
                const flight = anim.flights.find((f) => t > f.t0 && t < f.t1)
                return (
                  <g>
                    {flight && (() => {
                      const pts: string[] = []
                      for (let s = 0; s <= 14; s++) {
                        const tt = flight.t0 + (flight.t1 - flight.t0) * (s / 14)
                        const p = posAt(anim.ball, tt)
                        pts.push(`${mx(p.x)} ${p.y - liftAt(anim, tt) * 3.2}`)
                      }
                      return <polyline points={pts.join(' ')} fill="none" stroke="#ffd34d" strokeWidth={0.16} strokeDasharray="0.8 0.7" opacity={0.85} />
                    })()}
                    {lift > 0.02 && <ellipse cx={bx} cy={b.y} rx={0.6} ry={0.3} fill="#000" opacity={0.3} />}
                    <ellipse cx={bx} cy={b.y - lift * 3.2} rx={0.82 * (1 + lift * 0.45)} ry={0.53 * (1 + lift * 0.45)} fill="#8a4b1f" stroke="#fff" strokeWidth={0.14} />
                    <line x1={bx - 0.26} y1={b.y - lift * 3.2} x2={bx + 0.26} y2={b.y - lift * 3.2} stroke="#fff" strokeWidth={0.08} />
                    {!frozen && !reduced && t > 0.9 && (() => {
                      const e = posAt(anim.ball, 1)
                      const ex = mx(e.x)
                      return (
                        <g transform={`translate(${ex} ${e.y})`}>
                          <g className="gd-burst">
                            {[0, 60, 120, 180, 240, 300].map((deg) => (
                              <line key={deg} x1={0} y1={0} x2={Math.cos((deg * Math.PI) / 180) * 2.2} y2={Math.sin((deg * Math.PI) / 180) * 2.2} stroke={offColor} strokeWidth={0.24} strokeLinecap="round" />
                            ))}
                            <circle r={0.9} fill="none" stroke={offColor} strokeWidth={0.2} />
                          </g>
                        </g>
                      )
                    })()}
                  </g>
                )
              })()}

              {/* touchdown: end-zone flash + club-colour confetti */}
              {isTD && !frozen && !reduced && t > 0.4 && (
                <rect x={ezX} y={0} width={10} height={H} fill={offTeam.primary} className="gd-flash" opacity={0} pointerEvents="none" />
              )}
              {isTD && !frozen && !reduced && t > 0.5 && (
                <g className="gd-confetti" pointerEvents="none">
                  {CONFETTI.map((cft, i) => (
                    <g key={i} transform={`translate(${ezX + 5 + cft.x * 0.42} ${6 + cft.y})`}>
                      <rect x={-cft.w / 2} y={-cft.h / 2} width={cft.w} height={cft.h} rx={0.06} fill={cft.c ? offTeam.secondary : offTeam.primary} className="gd-confetti-piece" style={{ animationDelay: `${cft.delay}s`, animationDuration: `${cft.dur}s` }} />
                    </g>
                  ))}
                </g>
              )}

              {/* penalty flag */}
              {anim?.flag && t >= anim.flag.t && (
                <rect x={mx(anim.flag.x) - 0.5} y={anim.flag.y - 0.5} width={1} height={1} fill="#ffd400" stroke="#000" strokeWidth={0.08} />
              )}
            </svg>

            {/* glass down & distance chip (top-left) */}
            <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/15 bg-black/45 px-2.5 py-1 font-cond text-xs font-700 uppercase tracking-wide text-white/90 shadow-lg backdrop-blur-sm">
                {play.down ? (
                  <>
                    <span className="text-[#ffd34d]">{downText(play)}</span>
                    <span className="mx-1 text-white/40">·</span>
                    {gameDayFieldPosForPlay(world, play)}
                  </>
                ) : (
                  play.concept
                )}
              </span>
            </div>

            {/* full-field / follow-camera toggle (top-right) */}
            <button
              type="button"
              onClick={toggleFullField}
              className="absolute right-4 top-3 z-10 rounded-md border border-white/15 bg-black/45 px-2.5 py-1 font-cond text-[11px] font-700 uppercase tracking-wide text-white/80 shadow-lg backdrop-blur-sm hover:bg-black/65 hover:text-white"
            >
              {fullField ? 'Follow' : 'Full field'}
            </button>

            {/* play-result toast */}
            {toast && (
              <div key={idx} className="gd-toast pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center">
                <span className={cn('rounded-md border px-3 py-1 font-cond text-sm font-700 uppercase tracking-wide shadow-lg backdrop-blur-sm', TOAST_TONE[toast.tone])}>
                  {toast.text}
                </span>
              </div>
            )}

            {/* U2: floating replay pill (glass, bottom-centre over the field) */}
            <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
              <div className="flex items-center gap-0.5 rounded-full border border-white/15 bg-black/45 px-1 py-0.5 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.8)] backdrop-blur-md sm:gap-1 sm:px-1.5 sm:py-1">
                <IconBtn title="Previous play" onClick={() => jump(Math.max(0, idx - 1))}><ChevronLeft size={15} /></IconBtn>
                <IconBtn playToggle title={showPause ? 'Pause (Space)' : 'Play (Space)'} onClick={togglePlay}>{showPause ? <Pause size={15} /> : <Play size={15} />}</IconBtn>
                <IconBtn title="Next play" onClick={() => jump(Math.min(match.plays.length - 1, idx + 1))}><ChevronRight size={15} /></IconBtn>
                <IconBtn title="Jump to the latest play" onClick={() => jump(match.plays.length - 1)}><SkipForward size={15} /></IconBtn>
                <span className="mx-0.5 h-4 w-px bg-white/15 sm:mx-1" />
                {[0.5, 1, 2, 4].map((sp) => (
                  <button
                    key={sp}
                    onClick={() => setSpeed(sp)}
                    className={cn('rounded-full px-1.5 py-0.5 font-cond text-[11px] font-700', speed === sp ? 'bg-white text-ink' : 'text-white/60 hover:bg-white/10')}
                  >
                    {sp}×
                  </button>
                ))}
                <span className="ml-1 font-cond text-[11px] tnum text-white/50">{idx + 1}/{match.plays.length}</span>
                <span className="ml-1 hidden items-center gap-1 font-cond text-[10px] uppercase text-white/35 md:flex">
                  <kbd className="rounded border border-white/20 px-1 py-px leading-none">Space</kbd>
                </span>
              </div>
            </div>
          </div>

          {/* What just happened */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="font-display text-lg font-700 uppercase" style={{ color: play.bigPlay ? '#ffd34d' : '#fff' }}>{play.concept}</span>
              <span className="truncate font-cond text-base font-600 text-white/85">{play.result}</span>
              {play.yards !== 0 && (
                <span className={cn('font-cond text-base font-700 tnum', play.yards > 0 ? 'text-[#8ef0b5]' : 'text-[#ffb3ba]')}>
                  {play.yards > 0 ? '+' : ''}{play.yards} yd
                </span>
              )}
            </div>
          </div>

          {/* U2: game-day dock — sticky to the bottom of the game column */}
          {gameDay && (
            <div className="sticky bottom-0 z-30 shrink-0 border-t border-white/10 bg-[#0d1a2b]/95 px-3 py-2 backdrop-blur-md">
              {showMoment && moment ? (
                <div className="gd-slide-up">
                  <MomentCard
                    moment={moment}
                    fieldPos={gameDayFieldPos(world, gameDay.state, moment.yard)}
                    onAnswer={answer}
                    quick={(lean) => quickOffCall(world, moment.teamId === match.homeId ? match.awayId : match.homeId, moment, lean)}
                    fourthNote={analyticsFourthNote(world, moment)}
                  />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="hidden font-display text-sm font-700 uppercase tracking-wide sm:inline">Game day</span>
                  {career && <CallModePicker scope={gameDay.state.ctx?.scope} mode={career.callMode} keepPlays={idx + 1} onFallback={() => jump(match.plays.length - 1)} />}
                  <span className="hidden text-[11px] text-white/55 md:inline">
                    {moment ? 'Your call is coming up — the replay is catching up.' : 'Paused. Change the plan in the side panel, or move the game on.'}
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {timeoutsLeft > 0 && (
                      <DockButton
                        icon={<Timer size={14} />}
                        label={timeoutArmed ? 'Timeout armed' : `Timeout (${timeoutsLeft})`}
                        disabled={timeoutArmed || !!moment}
                        onClick={callTimeout}
                        title="Stop the clock on the next dead ball"
                      />
                    )}
                    <DockButton icon={<Play size={14} />} label="Next play" disabled={!!moment} onClick={() => advance('play')} />
                    <DockButton icon={<ChevronsRight size={14} />} label="Next drive" disabled={!!moment} onClick={() => advance('drive')} />
                    <DockButton icon={<Target size={14} />} label="Next moment" disabled={!!moment} onClick={() => advance('moment')} />
                    <DockButton icon={<SkipForward size={14} />} label="Sim to end" onClick={simToEnd} />
                  </div>
                </div>
              )}
              {showMoment && (
                <div className="mt-2 flex items-center justify-end">
                  <Button size="sm" variant="ghost" className="!text-white/60 hover:!bg-white/10" onClick={simToEnd}>
                    <SkipForward size={14} /> Sim to end (standing orders)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Side panel ───────────────────────────────────────────────────── */}
        <aside className="flex min-h-0 flex-col border-t border-white/10 bg-[#0c1828] lg:border-l lg:border-t-0">
          <div className="flex shrink-0 gap-1 border-b border-white/10 p-1.5">
            {sideTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                  activeTab === t.id ? 'bg-white text-ink' : 'text-white/65 hover:bg-white/10 hover:text-white',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'plays' && (
              <PlayLog plays={shownPlays} idx={idx} world={world} onJump={jump} downText={downText} />
            )}
            {activeTab === 'box' && (
              <div className="p-2">
                <div className="mb-2 inline-flex w-full rounded-lg bg-white/10 p-0.5">
                  {[away, home].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setBoxTeam(t.id)}
                      className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-cond text-xs font-700 uppercase', boxTeamId === t.id ? 'bg-white text-ink' : 'text-white/70')}
                    >
                      <TeamCrest team={t} size={16} /> {t.name}
                    </button>
                  ))}
                </div>
                <BoxScore
                  world={world}
                  teamId={boxTeamId}
                  box={liveBox}
                  pen={pen}
                  gmName={career?.gmName}
                  myTeamId={career?.teamId}
                  onTeamClick={
                    gameDay
                      ? undefined
                      : (id) => {
                          closeMatch()
                          viewTeam(id)
                        }
                  }
                />
              </div>
            )}
            {activeTab === 'plan' && gameDay && <GameDayPlanPanel gameDay={gameDay} />}
            {activeTab === 'keys' && gameDay && career && (
              <div className="p-3">
                <KeysCard
                  dark
                  oppId={gameDay.state.homeId === career.teamId ? gameDay.state.awayId : gameDay.state.homeId}
                  locked={
                    gameDay.state.done ||
                    (gameDay.state.decisions ?? []).some((d) => d.source === 'user')
                  }
                />
              </div>
            )}
            {activeTab === 'film' && (match.film || match.keys) && (
              <div className="p-3">
                {match.film && (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-3xl font-700">{match.film.letter}</span>
                      <span className="font-cond text-xs text-white/50">{match.film.grade}/100 film grade</span>
                    </div>
                    {match.film.lines.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {match.film.lines.map((l, i) => <li key={i} className="text-xs leading-snug text-white/70">• {l}</li>)}
                      </ul>
                    )}
                  </>
                )}
                {/* L12 W2: the keys you promised, graded against the box score. */}
                {match.keys && match.keys.length > 0 && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="label mb-1.5 !text-white/45">Keys to the game</div>
                    <ul className="space-y-1">
                      {match.keys.map((k) => (
                        <li key={k.id} className="flex items-start gap-2 text-xs leading-snug">
                          <span className={cn('font-700', k.hit ? 'text-[#8ef0b5]' : 'text-[#ffb3ba]')}>
                            {k.hit ? '✅' : '❌'}
                          </span>
                          <span className="text-white/80">
                            <strong className="text-white">{k.label}</strong> — {k.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {match.planChanges && match.planChanges.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {match.planChanges.map((c, i) => <li key={i} className="text-xs text-white/60">• Switched to {c.preset} at Q{c.qtr} {c.clock}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** U2: a club-colour scorebug block — abbr, big score, possession ball, timeout pips. */
function ScoreBlock({ team, score, hasBall, timeouts, align }: {
  team: import('../game/types').Team; score: number; hasBall: boolean; timeouts?: number; align: 'left' | 'right'
}) {
  const ink = luminance(team.primary) > 0.5 ? '#0a1626' : '#ffffff'
  return (
    <TeamHoverCard team={team} className="min-w-0">
      <div
        className="flex min-w-0 items-center rounded-lg px-2 py-1 sm:px-2.5"
        style={{ background: team.primary, color: ink, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)' }}
      >
        <div className={cn('flex flex-col leading-none', align === 'right' && 'items-end')}>
          <span className="flex items-center gap-1 font-cond text-[11px] font-700 uppercase tracking-wide">
            {align === 'left' && <PossessionBall on={hasBall} ink={ink} bg={team.primary} />}
            {team.abbr}
            {align === 'right' && <PossessionBall on={hasBall} ink={ink} bg={team.primary} />}
          </span>
          <span className="font-display text-2xl font-700 tnum leading-none sm:text-3xl">{score}</span>
          {timeouts != null && <TimeoutPips n={timeouts} ink={ink} />}
        </div>
      </div>
    </TeamHoverCard>
  )
}

/** A small football marking the club with the ball (hidden, not removed, when it isn't theirs). */
function PossessionBall({ on, ink, bg }: { on: boolean; ink: string; bg: string }) {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" aria-hidden className={cn('shrink-0', on ? 'opacity-100' : 'opacity-0')}>
      <ellipse cx="12" cy="12" rx="9.5" ry="6.2" fill={ink} />
      <path d="M7 12h10" stroke={bg} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 10.6v2.8M12 10.4v3.2M14 10.6v2.8" stroke={bg} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

/** U2: three timeout pips per side, filled in club-block ink. */
function TimeoutPips({ n, ink }: { n: number; ink: string }) {
  return (
    <span className="mt-1 flex gap-0.5" title={`${n} timeout${n === 1 ? '' : 's'} left`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-2.5 rounded-full"
          style={{ background: i < n ? ink : 'transparent', border: `1px solid ${ink}`, opacity: i < n ? 0.9 : 0.4 }}
        />
      ))}
    </span>
  )
}

/** U2: a dock button — icon always, label from 400px up. */
function DockButton({ icon, label, onClick, disabled, title }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 font-cond text-xs font-700 uppercase tracking-wide text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      <span className="hidden min-[400px]:inline">{label}</span>
    </button>
  )
}

function IconBtn({ title, onClick, children, playToggle }: { title: string; onClick: () => void; children: React.ReactNode; playToggle?: boolean }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} data-play-toggle={playToggle || undefined} className="grid h-7 w-7 place-items-center rounded text-white/80 hover:bg-white/15 hover:text-white">
      {children}
    </button>
  )
}

interface Drive { offId: string; start: number; end: number }

/** Plays grouped into drives (a drive = consecutive plays by one offense). */
function drivesOf(plays: PlayEvent[]): Drive[] {
  const out: Drive[] = []
  plays.forEach((p, i) => {
    const last = out[out.length - 1]
    if (last && last.offId === p.offId) last.end = i
    else out.push({ offId: p.offId, start: i, end: i })
  })
  return out
}

function PlayLog({ plays, idx, world, onJump, downText }: {
  plays: PlayEvent[]; idx: number; world: World; onJump: (i: number) => void; downText: (p: PlayEvent) => string
}) {
  const drives = useMemo(() => drivesOf(plays), [plays])
  // R5: jersey numbers for the "broke a tackle by #54" note, one map per club.
  const jerseys = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const p of plays) if (!m.has(p.defId)) m.set(p.defId, teamJerseys(world, p.defId))
    return m
  }, [plays, world])
  const jersey = (teamId: string, id: string) => jerseys.get(teamId)?.get(id)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [idx])
  return (
    <div className="pb-2">
      {drives.map((d) => {
        const team = world.byId[d.offId]
        const snaps = plays.slice(d.start, d.end + 1)
        const scrimmage = snaps.filter((p) => p.type === 'run' || p.type === 'pass')
        const yards = scrimmage.reduce((s, p) => s + p.yards, 0)
        const last = snaps[snaps.length - 1]
        const first = snaps[0]
        const ptsBefore = d.start > 0 ? plays[d.start - 1] : null
        const scored = ptsBefore ? (last.homeScore + last.awayScore) - (ptsBefore.homeScore + ptsBefore.awayScore) : last.homeScore + last.awayScore
        return (
          <div key={`${d.start}`}>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-white/10 bg-[#13233a] px-3 py-1.5">
              {team && <TeamCrest team={team} size={16} />}
              <span className="font-cond text-[11px] font-700 uppercase tracking-wide">{team?.abbr} ball</span>
              <span className="font-cond text-[11px] text-white/50">
                Q{first.qtr} {first.clock}
                {scrimmage.length > 0 && ` · ${scrimmage.length} plays, ${yards} yds`}
              </span>
              {scored > 0 && <span className="ml-auto rounded bg-[#ffd34d] px-1.5 py-px font-cond text-[10px] font-700 uppercase text-ink">+{scored}</span>}
              {scored <= 0 && last.type === 'punt' && <span className="ml-auto rounded bg-white/15 px-1.5 py-px font-cond text-[10px] font-700 uppercase text-white/80">Punt</span>}
              {scored <= 0 && last.turnover && (last.type === 'run' || last.type === 'pass') && <span className="ml-auto rounded bg-[#dc2937] px-1.5 py-px font-cond text-[10px] font-700 uppercase">Turnover</span>}
              {scored <= 0 && last.type === 'fg' && <span className="ml-auto rounded bg-white/15 px-1.5 py-px font-cond text-[10px] font-700 uppercase text-white/80">Missed FG</span>}
            </div>
            {snaps.map((p, k) => {
              const i = d.start + k
              const isActive = i === idx
              return (
                <button
                  key={p.n}
                  ref={isActive ? activeRef : undefined}
                  onClick={() => onJump(i)}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs',
                    isActive ? 'bg-white/15' : 'hover:bg-white/5',
                  )}
                >
                  <span className="w-14 shrink-0 pt-px font-cond text-[11px] tnum text-white/45">{downText(p) || p.type.toUpperCase()}</span>
                  <span className="min-w-0 flex-1 leading-snug text-white/85">
                    <span className="font-600 text-white">{p.concept}</span> — {p.result}
                    {p.missedTackleIds?.length ? (
                      <span className="text-white/55"> — broke a tackle by {p.missedTackleIds.map((id) => `#${jersey(p.defId, id) ?? '?'}`).join(', ')}</span>
                    ) : null}
                    {p.dropId ? (
                      <span className="text-white/55"> — dropped by #{jersey(p.offId, p.dropId) ?? '?'}</span>
                    ) : null}
                  </span>
                  {(p.type === 'run' || p.type === 'pass') && (
                    <span className={cn('w-10 shrink-0 text-right font-cond tnum', p.yards > 0 ? 'text-[#8ef0b5]' : p.yards < 0 ? 'text-[#ffb3ba]' : 'text-white/45')}>
                      {p.yards > 0 ? '+' : ''}{p.yards}
                    </span>
                  )}
                  <span className="w-11 shrink-0 text-right font-cond tnum text-white/45">
                    {p.awayScore}-{p.homeScore}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** Field position for a replayed play, tagged with the club whose side it's on. */
function gameDayFieldPosForPlay(world: World, p: PlayEvent): string {
  const offAbbr = world.byId[p.offId]?.abbr ?? ''
  const defAbbr = world.byId[p.defId]?.abbr ?? ''
  if (p.startYard === 50) return '50'
  return p.startYard < 50 ? `${offAbbr} ${p.startYard}` : `${defAbbr} ${100 - p.startYard}`
}

/** L11.5 Q3: a collapsible in-game plan editor, limited to the side(s) you coach. */
/** L12.6: how often a coached game stops for your call. */
function CallModePicker({ scope, mode, keepPlays, onFallback }: { scope?: 'off' | 'def' | 'both' | 'hc'; mode?: 'off' | 'def' | 'both'; keepPlays?: number; onFallback?: () => void }) {
  const setCallMode = useGame((s) => s.setCallMode)
  const showToast = useGame((s) => s.showToast)
  const gameDayAdvance = useGame((s) => s.gameDayAdvance)
  if (!scope) return null
  const all: { id: 'key' | 'off' | 'def' | 'both'; label: string }[] = [
    { id: 'key', label: 'Key moments' },
    ...(scope !== 'def' ? [{ id: 'off' as const, label: 'Every O snap' }] : []),
    ...(scope !== 'off' ? [{ id: 'def' as const, label: 'Every D snap' }] : []),
    ...(scope === 'hc' || scope === 'both' ? [{ id: 'both' as const, label: 'Every snap' }] : []),
  ]
  const active = mode ?? 'key'
  const activeIdx = Math.max(0, all.findIndex((o) => o.id === active))
  return (
    <div
      className="relative grid w-full max-w-xs shrink-0 rounded-full bg-white/10 p-0.5"
      style={{ gridTemplateColumns: `repeat(${all.length}, minmax(0, 1fr))` }}
      title="How often the game stops for your call (from the next snap)"
    >
      <span
        aria-hidden
        className="gd-pill-slide pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 rounded-full bg-white shadow"
        style={{ width: `calc((100% - 0.25rem) / ${all.length})`, transform: `translateX(${activeIdx * 100}%)` }}
      />
      {all.map((o) => (
        <button
          key={o.id}
          onClick={() => {
            if (o.id === active) return
            // Re-simulates from the play on screen so the new mode applies to the very
            // next snap; if the rebuild can't match what you watched, jump to the latest play.
            if (!setCallMode(o.id, keepPlays)) onFallback?.()
            // Every-snap modes: bring up the next call right away.
            else if (o.id !== 'key') void gameDayAdvance('moment')
            showToast(o.id === 'key' ? 'Key moments only — from the next snap.' : `${o.label}: you call it from the next snap.`)
          }}
          className={cn('relative z-10 whitespace-nowrap rounded-full px-2 py-1 font-cond text-[10px] font-700 uppercase transition sm:px-2.5 sm:text-[11px]', active === o.id ? 'text-ink' : 'text-white/65 hover:text-white')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function GameDayPlanPanel({ gameDay }: { gameDay: GameDay }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const setGameDayPlan = useGame((s) => s.setGameDayPlan)
  const setGameDayPersonnel = useGame((s) => s.setGameDayPersonnel)
  const [side, setSide] = useState<'off' | 'def'>('off')
  if (!career) return null
  const caps = capabilities(career)
  const focus = career.unitFocus ?? 'both'
  const hasOff = caps.planScope === 'both' || focus !== 'def'
  const hasDef = caps.planScope === 'both' || focus !== 'off'
  if (!hasOff && !hasDef) return null
  const active: 'off' | 'def' = side === 'off' && hasOff ? 'off' : hasDef ? 'def' : 'off'
  const oppId = gameDay.state.homeId === career.teamId ? gameDay.state.awayId : gameDay.state.homeId
  const oppScheme = active === 'off' ? coachLabels(world, oppId).dcScheme : coachLabels(world, oppId).ocScheme
  const advice = coordinatorAdvice(world, career, oppId).filter((a) => a.side === active)
  return (
    <div className="p-3">
      <p className="mb-2 text-[11px] text-white/55">Change how you play — it applies from the next snap.</p>
      <div>
          {hasOff && hasDef && (
            <div className="mb-3 inline-flex rounded-lg bg-white/10 p-0.5">
              {(['off', 'def'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={cn(
                    'rounded-md px-3 py-1 font-cond text-xs font-700 uppercase tracking-wide transition',
                    active === s ? 'bg-white text-ink' : 'text-white/70 hover:text-white',
                  )}
                >
                  {s === 'off' ? 'Offense' : 'Defense'}
                </button>
              ))}
            </div>
          )}
          {advice.map((a) => {
            const preset = PLAN_PRESETS.find((p) => p.id === a.presetId && p.side === a.side)
            if (!preset) return null
            return (
              <div key={a.side} className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[11px] text-white/70">
                <span>
                  <strong className="font-700 text-white">{a.coach}</strong> recommends{' '}
                  <strong className="font-700 text-white">{preset.label}</strong> — {a.reason}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  className="ml-auto !bg-white !text-ink"
                  onClick={() => setGameDayPlan(active, { ...preset.plan })}
                >
                  Apply
                </Button>
              </div>
            )
          })}
          <div className="rounded-lg bg-white p-3">
            <PlanEditor plan={gameDay.plan[active]} onChange={(p) => setGameDayPlan(active, p)} side={active} />
            <div className="mt-3 border-t border-line pt-3">
              <PersonnelCard
                compact
                side={active}
                value={active === 'off' ? gameDay.personnel.off : gameDay.personnel.def}
                onChange={(v) => setGameDayPersonnel(active, v)}
                teamId={career.teamId}
                oppId={oppId}
                oppScheme={oppScheme}
              />
            </div>
          </div>
          {gameDay.changes.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {gameDay.changes.map((c, i) => (
                <li key={i} className="text-[11px] text-white/50">
                  Switched to {c.preset} at Q{c.qtr} {c.clock}
                </li>
              ))}
            </ul>
          )}
        </div>
    </div>
  )
}

/** FUTURES 19: the analytics 4th-down recommendation, when an analyst is hired. */
function analyticsFourthNote(world: World, moment: Moment): string | null {
  if (moment.kind !== 'fourth') return null
  const adv = fourthAdvice(world, moment.teamId, {
    yard: moment.yard,
    down: 4,
    distance: moment.distance ?? 0,
    qtr: moment.qtr,
    clockSec: clockSeconds(moment.clock),
    margin: moment.us - moment.them,
  })
  if (!adv) return null
  return `Analytics: ${adv.note} (${adv.confidence} confidence)`
}

function clockSeconds(clock: string): number {
  const [m, s] = clock.split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}

function MomentCard({ moment, fieldPos, onAnswer, quick, fourthNote }: { moment: Moment; fieldPos: string; onAnswer: (id: string) => void; quick?: (lean: 'run' | 'pass') => string | null; fourthNote?: string | null }) {
  return (
    <div className="rounded-2xl border border-[#c99a2e]/70 bg-black/40 p-3 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="gold">Your call</Badge>
        <span className="font-display text-base font-700 uppercase text-white">{moment.title}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-cond text-xs font-700 tnum text-white/80">
            Q{moment.qtr} {moment.clock}
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-cond text-xs font-700 tnum text-white/80">
            {moment.us}-{moment.them}
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-cond text-xs font-700 tnum text-white/80">
            {fieldPos}
          </span>
        </div>
      </div>
      {moment.staffRead && (
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-white/60">
          <Eye size={12} className="shrink-0" />
          <span>{moment.staffRead}</span>
        </div>
      )}
      {fourthNote && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-[#ffd34d]/10 px-2 py-1 text-[11px] text-[#ffe9a3]">
          <BarChart3 size={12} className="shrink-0" />
          <span>{fourthNote}</span>
        </div>
      )}
      {moment.kind === 'call' && quick && <QuickCallBar quick={quick} onAnswer={onAnswer} />}
      {moment.kind === 'call' ? (
        <CallPicker moment={moment} onAnswer={onAnswer} />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {moment.options.map((o) => {
            const Icon = optionIcon(moment.kind, o.id)
            const ev = optionEv(o)
            return (
              <button
                key={o.id}
                onClick={() => onAnswer(o.id)}
                className="flex items-start gap-2.5 rounded-xl border border-white/15 bg-white/[0.07] p-2.5 text-left transition hover:border-white/30 hover:bg-white/15"
              >
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-[#ffd34d]">
                  <Icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex w-full items-center gap-1.5">
                    <span className="font-cond text-sm font-700 uppercase text-white">{o.label}</span>
                    {ev != null && (
                      <span className="ml-auto rounded bg-[#ffd34d]/20 px-1.5 py-px font-cond text-[10px] font-700 tnum uppercase text-[#ffe9a3]">
                        EV {ev >= 0 ? '+' : ''}{ev.toFixed(1)}
                      </span>
                    )}
                    {o.id === moment.defaultId && (
                      <span className={cn('rounded bg-white/20 px-1.5 py-px font-cond text-[9px] font-700 uppercase text-white/80', ev == null && 'ml-auto')}>
                        Standing order
                      </span>
                    )}
                  </span>
                  {o.hint && <span className="mt-0.5 block text-[11px] leading-snug text-white/60">{o.hint}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** U2: a decorative icon per moment option (the sim only exposes id/label/hint). */
function optionIcon(kind: MomentKind, id: string) {
  if (id === 'go') return Target
  if (id === 'fg' || id === 'fgRange') return Goal
  if (id === 'punt') return Wind
  if (id === 'hurry') return Zap
  if (id === 'protect') return Shield
  if (id === 'useTimeouts') return Timer
  if (id === 'save' || id === 'normal') return Clock
  if (kind === 'defCall' || kind === 'halftime') return id === 'twoHigh' ? Eye : Shield
  return Target
}

/** The moment option's EV/edge, if the sim ever attaches one — it doesn't today. */
function optionEv(o: Moment['options'][number]): number | null {
  const v = (o as { ev?: number; edge?: number }).ev ?? (o as { edge?: number }).edge
  return typeof v === 'number' ? v : null
}

/**
 * L12.10 B6: pick a formation, then a play, each drawn with its route diagram.
 * The picked play is a playbook play; the sim runs its concept/class exactly as
 * the standing order would, so the result path and rng draws are unchanged.
 */
/**
 * "Just run" / "just pass": the staff picks the concept from this opponent's
 * tendencies and NFL situational norms (src/game/engine/quickCall.ts).
 */
function QuickCallBar({ quick, onAnswer }: { quick: (lean: 'run' | 'pass') => string | null; onAnswer: (id: string) => void }) {
  const picks = { run: quick('run'), pass: quick('pass') }
  return (
    <div className="mb-2 grid grid-cols-2 gap-2">
      {(['run', 'pass'] as const).map((lean) => {
        const id = picks[lean]
        return (
          <button
            key={lean}
            type="button"
            disabled={!id}
            onClick={() => id && onAnswer(id)}
            title={id ? `Staff call: ${id}` : 'No play of this type in the book'}
            className="flex items-center justify-between gap-2 rounded-xl border border-[#ffd34d]/50 bg-[#ffd34d]/10 px-3 py-2 text-left transition hover:bg-[#ffd34d]/20 disabled:opacity-40"
          >
            <span className="font-display text-lg font-700 uppercase text-white">{lean === 'run' ? 'Run' : 'Pass'}</span>
            <span className="truncate font-cond text-[11px] font-600 uppercase tracking-wide text-white/60">{id ?? '—'}</span>
          </button>
        )
      })}
    </div>
  )
}

function CallPicker({ moment, onAnswer }: { moment: Moment; onAnswer: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Moment['options']>()
    for (const o of moment.options) {
      const f = playbookPlay(o.id)?.formation ?? 'Other'
      const arr = m.get(f) ?? []
      arr.push(o)
      m.set(f, arr)
    }
    return [...m.entries()].sort((a, b) => FORMATION_ORDER.indexOf(a[0]) - FORMATION_ORDER.indexOf(b[0]))
  }, [moment.options])
  const defaultFormation = playbookPlay(moment.defaultId)?.formation ?? groups[0]?.[0] ?? ''
  const [formation, setFormation] = useState(defaultFormation)
  // The detailed book is a compact, collapsible tray so the field stays visible;
  // RUN / PASS above remain the always-visible quick calls.
  const [open, setOpen] = useState(true)
  const active = groups.some(([f]) => f === formation) ? formation : groups[0]?.[0] ?? ''
  const plays = groups.find(([f]) => f === active)?.[1] ?? []
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white/10 px-2 py-1 font-cond text-[11px] font-700 uppercase tracking-wide text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          <ChevronDown size={12} className={cn('transition-transform', !open && '-rotate-90')} />
          Playbook
          <span className="text-white/45">{plays.length}</span>
        </button>
        <span className="truncate text-[11px] text-white/45">
          {open ? 'Tap a play to call it — scroll for more' : `${active} · tap to browse the book`}
        </span>
      </div>
      {open && (
        <div className="space-y-1.5">
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {groups.map(([f]) => (
              <button
                key={f}
                onClick={() => setFormation(f)}
                className={cn(
                  'shrink-0 rounded-md px-2 py-1 font-cond text-[11px] font-700 uppercase tracking-wide',
                  active === f ? 'bg-white text-ink' : 'bg-white/10 text-white/70 hover:bg-white/20',
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {plays.map((o) => {
              const pb = playbookPlay(o.id)
              return (
                <button
                  key={o.id}
                  onClick={() => onAnswer(o.id)}
                  title={`${o.label} — ${o.hint}`}
                  className={cn(
                    'flex w-[78px] shrink-0 flex-col gap-0.5 rounded-lg border p-1 text-left transition',
                    o.id === moment.defaultId ? 'border-[#ffd34d]/70 bg-white/15' : 'border-white/20 bg-white/10 hover:bg-white/20',
                  )}
                >
                  <RouteDiagram name={o.id} className="h-8 w-full rounded" />
                  <span className="truncate font-cond text-[10px] font-700 uppercase leading-tight text-white">{o.label}</span>
                  <span className="truncate font-cond text-[8px] uppercase leading-none text-white/45">
                    {o.id === moment.defaultId ? 'Standing order' : pb?.type ?? ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function BoxScore({ world, teamId, box, pen, gmName, myTeamId, onTeamClick }: { world: World; teamId: string; box?: import('../game/engine/stats').PlayerBoxScore[]; pen?: PenaltyTally; gmName?: string; myTeamId?: string; onTeamClick?: (teamId: string) => void }) {
  const team = world.byId[teamId]
  const rows = (box ?? []).filter((b) => b.teamId === teamId)
  const passing = rows.filter((r) => (r.line.passAtt ?? 0) > 0)
  const rushing = rows.filter((r) => (r.line.rushAtt ?? 0) > 0)
  const receiving = rows.filter((r) => (r.line.rec ?? 0) > 0 || (r.line.targets ?? 0) > 0)
  const defense = rows.filter((r) => (r.line.tackles ?? 0) > 0 || (r.line.tfl ?? 0) > 0 || (r.line.defSacks ?? 0) > 0 || (r.line.prs ?? 0) > 0 || (r.line.qbHits ?? 0) > 0 || (r.line.hurries ?? 0) > 0 || (r.line.defInts ?? 0) > 0 || (r.line.defYdsAllowed ?? 0) > 0 || (r.line.defComp ?? 0) > 0 || (r.line.defTargets ?? 0) > 0 || (r.line.missedTackles ?? 0) > 0 || (r.line.defTD ?? 0) > 0)
  const returns = rows.filter((r) => (r.line.kickRet ?? 0) > 0 || (r.line.puntRet ?? 0) > 0 || (r.line.retTD ?? 0) > 0 || (r.line.defTD ?? 0) > 0)
  // Index once per render: the viewer re-renders every playback tick, so a
  // linear scan per box-score row would add up fast.
  const byId = useMemo(() => new Map(world.players.map((p) => [p.id, p])), [world.players])
  const jerseyNumbers = useMemo(() => teamJerseys(world, teamId), [world, teamId])
  const fp = { gmName, myTeamId, byId, jerseyNumbers }
  return (
    <div className="rounded-lg bg-black/30 p-2">
      <div className="mb-2">
        <TeamHoverCard team={team}>
          {onTeamClick ? (
            <button
              type="button"
              onClick={() => onTeamClick(team.id)}
              title={`View the ${team.name}`}
              className="flex items-center gap-2 transition hover:opacity-80"
            >
              <TeamCrest team={team} size={22} />
              <span className="font-display text-sm font-700 uppercase underline-offset-2 hover:underline">{team.name}</span>
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <TeamCrest team={team} size={22} />
              <span className="font-display text-sm font-700 uppercase">{team.name}</span>
            </span>
          )}
        </TeamHoverCard>
      </div>
      {passing.length > 0 && <BoxBlock title="Passing" rows={passing} fp={fp} cols={[
        { k: 'passComp', l: 'C/ATT', fmt: (r) => `${r.passComp ?? 0}/${r.passAtt ?? 0}` },
        { k: 'passYds', l: 'YDS' }, { k: 'passTD', l: 'TD' }, { k: 'ints', l: 'INT' },
        { k: 'sk', l: 'SK', title: 'Times sacked (sack yards lost in season stats)' },
        { k: 'passerRating', l: 'RTG', fmt: (r) => passerRating(r).toFixed(1) },
      ]} />}
      {rushing.length > 0 && <BoxBlock title="Rushing" rows={rushing} fp={fp} cols={[
        { k: 'rushAtt', l: 'CAR' }, { k: 'rushYds', l: 'YDS' }, { k: 'rushTD', l: 'TD' },
      ]} />}
      {receiving.length > 0 && <BoxBlock title="Receiving" rows={receiving} fp={fp} cols={[
        { k: 'rec', l: 'REC' }, { k: 'recYds', l: 'YDS' }, { k: 'recTD', l: 'TD' },
      ]} />}
      {defense.length > 0 && <BoxBlock title="Defense" rows={defense} fp={fp} cols={[
        { k: 'tackles', l: 'TCK' }, { k: 'missedTackles', l: 'MT', title: 'Missed tackles' }, { k: 'tfl', l: 'TFL' }, { k: 'defSacks', l: 'SCK' },
        { k: 'defInts', l: 'INT' }, { k: 'defTD', l: 'TD', title: 'Defensive touchdowns (pick-six, fumble return)' },
      ]} />}
      {defense.some((b) => (b.line.prs ?? 0) > 0) && <BoxBlock title="Pass rush" rows={defense.filter((b) => (b.line.prs ?? 0) > 0)} fp={fp} cols={[
        { k: 'prs', l: 'PRS', title: 'Pressures (SCK + QBH + HUR)' }, { k: 'defSacks', l: 'SCK' }, { k: 'qbHits', l: 'QBH', title: 'QB hits' }, { k: 'hurries', l: 'HUR', title: 'Hurries' },
      ]} />}
      {defense.some((b) => (b.line.defTargets ?? 0) > 0) && <BoxBlock title="Coverage" rows={defense.filter((b) => (b.line.defTargets ?? 0) > 0)} fp={fp} cols={[
        { k: 'defComp', l: 'REC', w: 'w-10', title: 'Receptions allowed / targets in coverage', fmt: (r) => `${r.defComp ?? 0}/${r.defTargets ?? 0}` },
        { k: 'defYdsAllowed', l: 'ALW', title: 'Yards allowed in coverage' },
        { k: 'coverageGrade', l: 'COV', title: 'Coverage grade', fmt: (r) => { const g = coverageGrade(r); return g == null ? '—' : String(g) } },
      ]} />}
      {returns.length > 0 && <BoxBlock title="Returns" rows={returns} fp={fp} cols={[
        { k: 'kickRet', l: 'KR', title: 'Kickoff returns' }, { k: 'kickRetYds', l: 'YDS', title: 'Kickoff return yards' },
        { k: 'puntRet', l: 'PR', title: 'Punt returns' }, { k: 'puntRetYds', l: 'YDS', title: 'Punt return yards' },
        { k: 'retTD', l: 'TD', title: 'Return touchdowns' }, { k: 'defTD', l: 'DTD', title: 'Defensive touchdowns (pick-six / fumble return)' },
      ]} />}
      {pen && pen.count > 0 && (
        <div className="mb-1">
          <div className="label mb-0.5 !text-white/50">Penalties</div>
          <div className="text-[11px] text-white/85 tnum">{pen.count} accepted for {pen.yards} yds</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/60">
            {Object.entries(pen.byType)
              .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
              .map(([k, n]) => (
                <span key={k}>{PENALTY_INFO[k as PenaltyKind]?.label ?? k} <span className="tnum text-white/80">{n}</span></span>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface FingerprintCtx { gmName?: string; myTeamId?: string; byId: Map<string, import('../game/types').Player>; jerseyNumbers: Map<string, number> }
interface BoxCol { k: string; l: string; fmt?: (r: GameStatLine) => string; w?: string; title?: string }
function BoxBlock({ title, rows, cols, fp }: { title: string; rows: import('../game/engine/stats').PlayerBoxScore[]; cols: BoxCol[]; fp: FingerprintCtx }) {
  // Lead with the volume stat: yards for offense, tackles for defense.
  // Lead with the block's volume stat: yards for offense, the first column otherwise.
  const sortKey = (['Defense', 'Pass rush', 'Coverage'].includes(title) ? cols[0]?.k : cols[1]?.k) as keyof GameStatLine
  const sorted = [...rows].sort((a, b) => ((b.line[sortKey] as number) ?? 0) - ((a.line[sortKey] as number) ?? 0))
  const wide = (k: string) => k === 'passComp' || k === 'passerRating' || k === 'pressurePct'
  return (
    <div className="mb-3">
      <div className="label mb-0.5 !text-white/50">{title}</div>
      <table className="w-full table-fixed text-[11px] tnum">
        <colgroup>
          <col />
          {cols.map((c) => <col key={c.k} className={c.w ?? (wide(c.k) ? 'w-11' : 'w-8')} />)}
        </colgroup>
        <thead>
          <tr className="text-white/40">
            <th className="text-left font-500">Player</th>
            {cols.map((c) => <th key={c.k} title={c.title} className="whitespace-nowrap text-right font-500">{c.l}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 8).map((b) => {
            const p = fp.byId.get(b.playerId)
            const jersey = fp.jerseyNumbers.get(b.playerId)
            const tag = fp.gmName ? originTag(p?.origin, fp.gmName, p?.teamId, fp.myTeamId) : null
            return (
              <tr key={b.playerId} className="text-white/85">
                <td className="truncate pr-1" title={jersey == null ? b.name : `#${jersey} ${b.name}`}>
                  {jersey != null && <span className="mr-1 inline-block min-w-6 text-white/50">#{jersey}</span>}
                  {b.name}
                  {tag && (
                    <span className="ml-1 rounded bg-[var(--team-soft)] px-1 py-px font-cond text-[9px] font-700 uppercase tracking-wide text-[var(--team)]">
                      {tag}
                    </span>
                  )}
                </td>
                {cols.map((c) => (
                  <td key={c.k} className="whitespace-nowrap text-right">
                    {c.fmt ? c.fmt(b.line) : (b.line[c.k as keyof typeof b.line] as number ?? 0)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** L11.5 Q1: where the ball is, tagged with the possessing club ("BUF 32", "NE 45"). */
function gameDayFieldPos(world: World, state: GameState, yard: number): string {
  const defId = state.offId === state.homeId ? state.awayId : state.homeId
  const offAbbr = world.byId[state.offId]?.abbr ?? ''
  const defAbbr = world.byId[defId]?.abbr ?? ''
  if (yard === 50) return '50'
  return yard < 50 ? `${offAbbr} ${yard}` : `${defAbbr} ${100 - yard}`
}
