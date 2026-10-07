import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, Eye, Pause, Play, SkipForward, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { coachLabels, type GameState, type Play as PlayEvent, type Moment } from '../game/engine/playsim'
import type { World } from '../game/engine/generate'
import type { GameStatLine } from '../game/types'
import { capabilities } from '../game/engine/capabilities'
import { originTag } from '../game/selectors'
import { passerRating } from '../game/engine/stats'
import { useGame, useWorld, type GameDay } from '../store/gameStore'
import { PLAN_PRESETS } from '../game/engine/gameplan'
import { coordinatorAdvice } from '../game/engine/advice'
import { PlanEditor } from './PlanEditor'
import { Badge, Button, TeamCrest } from '../ui/kit'

const OFF_COLOR = '#0b62ff'
const DEF_COLOR = '#dc2937'
const CENTER_Y = 26.65
const W = 120
const H = 53.3

interface Dot {
  key: string
  side: 'off' | 'def'
  fx: number
  fy: number
  ex: number
  ey: number
  role: string
  hasBall?: boolean
}

function rnd(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** Compute formation (f) and end-of-play (e) positions for all 22 players. */
function buildDots(play: PlayEvent): Dot[] {
  const losX = 10 + play.startYard
  const gain = play.endYard - play.startYard
  const ballX = 10 + play.endYard
  const s = play.n * 7 + play.startYard
  const ballY = CENTER_Y + (rnd(s) - 0.5) * 30
  const isPass = play.type === 'pass'
  const sack = play.pressure && gain < 0
  const dots: Dot[] = []

  // ── Offense (5 OL, QB, RB, 4 receivers) ──
  const olY = [-2.6, -1.3, 0, 1.3, 2.6].map((d) => CENTER_Y + d)
  olY.forEach((y, i) => {
    dots.push({
      key: `ol${i}`, side: 'off', role: 'OL',
      fx: losX, fy: y,
      ex: losX + Math.max(-1, Math.min(4, gain * 0.3)),
      ey: y,
    })
  })
  const qbX = losX - 6
  dots.push({
    key: 'qb', side: 'off', role: 'QB',
    fx: qbX, fy: CENTER_Y,
    ex: sack ? losX - 7 : isPass ? qbX + 1 : qbX,
    ey: sack ? CENTER_Y + 2 : CENTER_Y,
  })
  dots.push({
    key: 'rb', side: 'off', role: 'RB',
    fx: losX - 9, fy: CENTER_Y + 3.5,
    ex: isPass || sack ? losX - 6 : ballX,
    ey: isPass || sack ? CENTER_Y + 4.5 : ballY,
    hasBall: !isPass && !sack,
  })

  const recvY = [5, 48, 14, 39]
  const recvRoles = ['WR', 'WR', 'SLOT', 'TE']
  recvY.forEach((y, i) => {
    const isTarget = play.targetId !== undefined && i === (play.n % 4)
    const routeX = isPass ? losX + Math.min(play.passDepth ?? 8, 22) : losX + 2
    dots.push({
      key: `wr${i}`, side: 'off', role: recvRoles[i],
      fx: losX, fy: y,
      ex: isTarget ? ballX : routeX,
      ey: isTarget ? ballY : y + (rnd(s + i) - 0.5) * 6,
      hasBall: isPass && isTarget && play.result !== 'Incomplete' && !play.turnover && gain > 0,
    })
  })

  // ── Defense (4 DL, 3 LB, 2 CB, 2 S) ──
  const dlY = [21, 24.3, 28.8, 32].map((y) => y)
  dlY.forEach((y, i) => {
    dots.push({
      key: `dl${i}`, side: 'def', role: 'DL',
      fx: losX + 1.6, fy: y,
      ex: losX + 2 + Math.max(0, gain * 0.3),
      ey: y,
    })
  })
  ;[16, CENTER_Y, 37].forEach((y, i) => {
    dots.push({
      key: `lb${i}`, side: 'def', role: 'LB',
      fx: losX + 6, fy: y,
      ex: ballX + 1.5,
      ey: ballY + (i - 1) * 4,
    })
  })
  ;[6, 47].forEach((y, i) => {
    dots.push({
      key: `cb${i}`, side: 'def', role: 'CB',
      fx: losX + 4, fy: y,
      ex: isPass ? losX + Math.min(play.passDepth ?? 10, 20) : ballX,
      ey: isPass ? y : ballY + (i === 0 ? -3 : 3),
    })
  })
  ;[15, 38].forEach((y, i) => {
    dots.push({
      key: `s${i}`, side: 'def', role: 'S',
      fx: losX + 15, fy: y,
      ex: ballX + 2,
      ey: ballY + (i - 1) * 6,
    })
  })

  return dots
}

function playDuration(play: PlayEvent) {
  if (play.type === 'kickoff' || play.type === 'punt' || play.type === 'pat' || play.type === 'fg') return 900
  if (play.type === 'end') return 200
  return 1600
}

export function MatchView() {
  const world = useWorld()
  const match = useGame((s) => s.match)
  const matchSeq = useGame((s) => s.matchSeq)
  const closeMatch = useGame((s) => s.closeMatch)
  const gameDay = useGame((s) => s.gameDay)
  const gameDayAdvance = useGame((s) => s.gameDayAdvance)
  const answerGameMoment = useGame((s) => s.answerGameMoment)
  const simGameDayToEnd = useGame((s) => s.simGameDayToEnd)
  const abandonGameDay = useGame((s) => s.abandonGameDay)
  const career = useGame((s) => s.career)

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [phase, setPhase] = useState<'set' | 'move'>('set')
  const timer = useRef<number | null>(null)

  const play = match?.plays[idx]

  // reset to first play whenever a fresh game opens (not when a coached game
  // appends the next chunk of plays)
  useEffect(() => {
    setIdx(0)
    setPlaying(true)
    setSpeed(1)
  }, [matchSeq])

  // formation → movement per play
  useEffect(() => {
    if (!play) return
    setPhase('set')
    const t = window.setTimeout(() => setPhase('move'), 70)
    return () => window.clearTimeout(t)
  }, [idx, play])

  // auto-advance
  useEffect(() => {
    if (!match || !playing || !play) return
    const dur = playDuration(play) / speed + (play.type === 'end' ? 200 : 550)
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
  }, [idx, playing, speed, match, play])

  const dots = useMemo(() => (play ? buildDots(play) : []), [play])

  if (!match || !play) return null

  const home = world.byId[match.homeId]
  const away = world.byId[match.awayId]
  const offTeam = world.byId[play.offId]
  const defTeam = world.byId[play.defId]
  const coaches = coachLabels(world, play.offId)
  const los = 10 + play.startYard
  const dur = phase === 'set' ? 0 : playDuration(play) / speed
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
    setPlaying(true)
    void answerGameMoment(choiceId)
  }

  const advance = (stop: 'play' | 'drive' | 'moment') => {
    setPlaying(true)
    void gameDayAdvance(stop)
  }

  const simToEnd = () => {
    setPlaying(false)
    void simGameDayToEnd()
  }

  return (
    <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-[#0a1626] text-white">
      {/* Scoreboard */}
      <div className="flex items-center gap-3 border-b border-white/10 bg-black/30 px-4 py-2.5">
        <TeamCrest team={away} size={30} />
        <span className="font-display text-lg font-700 uppercase">{away.name}</span>
        <span className="font-display text-3xl font-700 tnum">{shownScore.away}</span>
        <span className="text-white/40">–</span>
        <span className="font-display text-3xl font-700 tnum">{shownScore.home}</span>
        <span className="font-display text-lg font-700 uppercase">{home.name}</span>
        <TeamCrest team={home} size={30} />

        <div className="mx-auto flex items-center gap-3">
          <Badge tone="team" className="!text-white" >
            {offTeam.abbr} ball
          </Badge>
          <span className="font-cond text-sm font-600 uppercase text-white/80">
            {play.down ? `${['1st', '2nd', '3rd', '4th'][play.down - 1]} & ${play.distance} at ${yardName(play.startYard)}` : play.concept}
          </span>
          <span className="rounded bg-white/10 px-2 py-0.5 font-cond text-sm font-700 tnum">
            Q{play.qtr} · {play.clock}
          </span>
        </div>

        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
          <X size={16} />
        </button>
      </div>

      {/* Coordinator schemes */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-white/10 bg-black/20 px-4 py-1">
        {[away, home].map((t) => {
          const c = coachLabels(world, t.id)
          return (
            <span key={t.id} className="flex items-center gap-2 text-[11px]">
              <TeamCrest team={t} size={18} />
              <span className="font-cond font-700 uppercase text-white/85">{t.abbr}</span>
              <span className="text-white/55">OC {c.oc} · <span className="text-white/80">{c.ocScheme}</span></span>
              <span className="text-white/55">DC {c.dc} · <span className="text-white/80">{c.dcScheme}</span></span>
            </span>
          )
        })}
      </div>

      {/* Field */}
      <div className="relative flex min-h-[45vh] flex-1 items-center justify-center overflow-hidden bg-[#0a1626] p-3">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full">
          {/* field */}
          <rect x={10} y={0} width={100} height={H} fill="#1f7a3f" />
          <rect x={0} y={0} width={10} height={H} fill={offTeam.primary} opacity={0.9} />
          <rect x={110} y={0} width={10} height={H} fill={defTeam.primary} opacity={0.9} />
          {Array.from({ length: 21 }, (_, i) => 10 + i * 5).map((x, i) => (
            <line key={x} x1={x} y1={0} x2={x} y2={H} stroke="#ffffff" strokeOpacity={i % 2 === 0 ? 0.5 : 0.25} strokeWidth={0.12} />
          ))}
          {Array.from({ length: 9 }, (_, i) => 20 + i * 10).map((x) => (
            <line key={`n${x}`} x1={x} y1={0} x2={x} y2={H} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.2} />
          ))}
          {/* line of scrimmage + first down */}
          <line x1={los} y1={0} x2={los} y2={H} stroke="#ffd34d" strokeWidth={0.35} />
          <text x={4.5} y={CENTER_Y + 1.5} fill="#fff" fontSize={3.4} textAnchor="middle" opacity={0.85} className="font-display">
            {offTeam.abbr}
          </text>
          <text x={115.5} y={CENTER_Y + 1.5} fill="#fff" fontSize={3.4} textAnchor="middle" opacity={0.85} className="font-display">
            {defTeam.abbr}
          </text>

          {/* ball */}
          {(() => {
            const sack = play.pressure && play.endYard < play.startYard
            const bx = phase === 'set' ? los - 6 : sack ? los - 7 : 10 + play.endYard
            const by = phase === 'set' ? CENTER_Y : play.type === 'pass' || play.type === 'run' ? CENTER_Y + (rnd(play.n * 7 + play.startYard) - 0.5) * 30 : CENTER_Y
            return (
              <g style={{ transform: `translate(${bx}px, ${by}px)`, transition: `transform ${dur}ms cubic-bezier(.4,0,.5,1)` }}>
                <circle r={0.72} fill="#8a4b1f" stroke="#fff" strokeWidth={0.16} />
              </g>
            )
          })()}

          {/* players */}
          {dots.map((d) => {
            const x = phase === 'set' ? d.fx : d.ex
            const y = phase === 'set' ? d.fy : d.ey
            return (
              <g
                key={d.key}
                style={{ transform: `translate(${x}px, ${y}px)`, transition: `transform ${dur}ms cubic-bezier(.4,0,.5,1)` }}
              >
                {d.hasBall && <circle r={1.7} fill="#ffffff" opacity={0.25} />}
                <circle r={1.15} fill={d.side === 'off' ? OFF_COLOR : DEF_COLOR} stroke="#fff" strokeWidth={0.16} />
              </g>
            )
          })}
        </svg>
      </div>

      {/* Result banner */}
      <div className="flex items-center gap-4 border-t border-white/10 bg-black/30 px-4 py-2">
        <span className="font-display text-xl font-700 uppercase" style={{ color: play.bigPlay ? '#ffd34d' : '#fff' }}>
          {play.concept}
        </span>
        <span className="font-cond text-lg font-600 text-white/90">{play.result}</span>
        {play.yards !== 0 && (
          <span className={cn('font-cond text-lg font-700 tnum', play.yards > 0 ? 'text-[#8ef0b5]' : 'text-[#ffb3ba]')}>
            {play.yards > 0 ? '+' : ''}{play.yards} yd
          </span>
        )}
        <span className="ml-auto hidden text-xs text-white/50 md:block">
          {offTeam.abbr} OC {coaches.oc} · {coaches.ocScheme} &nbsp;|&nbsp; {defTeam.abbr} DC {coaches.dc} · {coaches.dcScheme}
        </span>
      </div>

      {/* Controls + log */}
      <div className="grid gap-3 border-t border-white/10 bg-[#0a1626] p-3 md:grid-cols-[1fr_340px]">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" className="!bg-white !text-ink" onClick={() => { setIdx((i) => Math.max(0, i - 1)); setPlaying(false) }}>
            <ChevronLeft size={14} /> Prev
          </Button>
          <Button size="sm" variant="primary" className="!bg-white !text-ink" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Play'}
          </Button>
          <Button size="sm" variant="primary" className="!bg-white !text-ink" onClick={() => { setIdx((i) => Math.min(match.plays.length - 1, i + 1)); setPlaying(false) }}>
            Next <ChevronRight size={14} />
          </Button>
          <Button size="sm" variant="ghost" className="!text-white hover:!bg-white/10" onClick={() => { setIdx(match.plays.length - 1); setPlaying(false) }}>
            <SkipForward size={14} /> Skip to end
          </Button>
          <div className="flex gap-1">
            {[0.5, 1, 2, 4].map((sp) => (
              <button
                key={sp}
                onClick={() => setSpeed(sp)}
                className={cn('rounded-md px-2 py-1 font-cond text-xs font-700', speed === sp ? 'bg-white text-ink' : 'bg-white/10 text-white/70 hover:bg-white/20')}
              >
                {sp}×
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <BoxScore world={world} teamId={match.awayId} box={match.box} gmName={career?.gmName} myTeamId={career?.teamId} />
          <BoxScore world={world} teamId={match.homeId} box={match.box} gmName={career?.gmName} myTeamId={career?.teamId} />
        </div>
      </div>

      {gameDay && (
        <div className="border-t border-white/10 bg-[#0d1a2b] p-3">
          {showMoment && moment && (
            <div className="mb-2">
              <MomentCard moment={moment} fieldPos={gameDayFieldPos(world, gameDay.state, moment.yard)} onAnswer={answer} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-700 uppercase tracking-wide text-white">Game day</span>
            <span className="text-[11px] text-white/60">
              {moment ? 'Make your call to continue.' : 'Advance the game.'}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" className="!bg-white !text-ink" disabled={!!moment} onClick={() => advance('play')}>
                Next play
              </Button>
              <Button size="sm" variant="primary" className="!bg-white !text-ink" disabled={!!moment} onClick={() => advance('drive')}>
                Next drive
              </Button>
              <Button size="sm" variant="primary" className="!bg-white !text-ink" disabled={!!moment} onClick={() => advance('moment')}>
                Next moment
              </Button>
              <Button size="sm" variant="ghost" className="!text-white hover:!bg-white/10" onClick={simToEnd}>
                <SkipForward size={14} /> Sim to end (standing orders)
              </Button>
            </div>
          </div>
          <GameDayPlanPanel gameDay={gameDay} />
        </div>
      )}

      {match.film && !gameDay && (
        <div className="border-t border-white/10 bg-[#0d1a2b] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-700 uppercase tracking-wide text-white">
              Film grade: {match.film.letter}
            </span>
            <span className="font-cond text-[11px] text-white/50">{match.film.grade}/100</span>
          </div>
          {match.film.lines.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {match.film.lines.map((l, i) => (
                <li key={i} className="text-[11px] text-white/60">• {l}</li>
              ))}
            </ul>
          )}
          {match.planChanges && match.planChanges.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {match.planChanges.map((c, i) => (
                <li key={i} className="text-[11px] text-white/60">• Switched to {c.preset} at Q{c.qtr} {c.clock}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Play log */}
      <div className="max-h-[180px] overflow-y-auto border-t border-white/10 bg-[#0a1626] px-3 pb-3">
        {match.plays.map((p, i) => (
          <button
            key={p.n}
            onClick={() => { setIdx(i); setPlaying(false) }}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs',
              i === idx ? 'bg-white/15' : 'hover:bg-white/5',
            )}
          >
            <span className="w-8 shrink-0 font-cond text-white/50">Q{p.qtr}</span>
            <span className="w-10 shrink-0 font-cond tnum text-white/50">{p.clock}</span>
            <span className="min-w-0 flex-1 truncate text-white/85">
              {p.down ? `${['1st', '2nd', '3rd', '4th'][p.down - 1]}&${p.distance} ` : ''}
              {p.concept} — {p.result}
            </span>
            <span className="shrink-0 font-cond tnum text-white/60">{p.homeScore}-{p.awayScore}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** L11.5 Q3: a collapsible in-game plan editor, limited to the side(s) you coach. */
function GameDayPlanPanel({ gameDay }: { gameDay: GameDay }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const setGameDayPlan = useGame((s) => s.setGameDayPlan)
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'off' | 'def'>('off')
  if (!career) return null
  const caps = capabilities(career)
  const focus = career.unitFocus ?? 'both'
  const hasOff = caps.planScope === 'both' || focus !== 'def'
  const hasDef = caps.planScope === 'both' || focus !== 'off'
  if (!hasOff && !hasDef) return null
  const active: 'off' | 'def' = side === 'off' && hasOff ? 'off' : hasDef ? 'def' : 'off'
  const oppId = gameDay.state.homeId === career.teamId ? gameDay.state.awayId : gameDay.state.homeId
  const advice = open ? coordinatorAdvice(world, career, oppId).filter((a) => a.side === active) : []
  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-black/20">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <ClipboardList size={14} className="text-white/70" />
        <span className="font-display text-xs font-700 uppercase tracking-wide text-white">Game plan</span>
        <span className="hidden text-[11px] text-white/50 sm:inline">
          Change how you play — it applies from the next snap.
        </span>
        <span className="ml-auto text-white/60">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </button>
      {open && (
        <div className="border-t border-white/10 p-3">
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
          <div className="rounded-lg bg-white p-3">
            <PlanEditor plan={gameDay.plan[active]} onChange={(p) => setGameDayPlan(active, p)} side={active} />
          </div>
          {advice.map((a) => {
            const preset = PLAN_PRESETS.find((p) => p.id === a.presetId && p.side === a.side)
            if (!preset) return null
            return (
              <div key={a.side} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[11px] text-white/70">
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
      )}
    </div>
  )
}

function MomentCard({ moment, fieldPos, onAnswer }: { moment: Moment; fieldPos: string; onAnswer: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-[#c99a2e]/70 bg-black/30 p-3">
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {moment.options.map((o) => (
          <button
            key={o.id}
            onClick={() => onAnswer(o.id)}
            className="flex flex-col items-start gap-0.5 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-left transition hover:bg-white/20"
          >
            <span className="flex w-full items-center gap-1.5">
              <span className="font-cond text-sm font-700 uppercase text-white">{o.label}</span>
              {o.id === moment.defaultId && (
                <span className="ml-auto rounded bg-white/20 px-1 py-px font-cond text-[9px] font-700 uppercase text-white/80">
                  Standing order
                </span>
              )}
            </span>
            {o.hint && <span className="text-[11px] leading-snug text-white/60">{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export function BoxScore({ world, teamId, box, gmName, myTeamId }: { world: World; teamId: string; box?: import('../game/engine/stats').PlayerBoxScore[]; gmName?: string; myTeamId?: string }) {
  const team = world.byId[teamId]
  const rows = (box ?? []).filter((b) => b.teamId === teamId)
  const passing = rows.filter((r) => (r.line.passAtt ?? 0) > 0)
  const rushing = rows.filter((r) => (r.line.rushAtt ?? 0) > 0)
  const receiving = rows.filter((r) => (r.line.rec ?? 0) > 0 || (r.line.targets ?? 0) > 0)
  const defense = rows.filter((r) => (r.line.tackles ?? 0) > 0 || (r.line.tfl ?? 0) > 0 || (r.line.defSacks ?? 0) > 0 || (r.line.defInts ?? 0) > 0 || (r.line.defYdsAllowed ?? 0) > 0 || (r.line.defComp ?? 0) > 0)
  // Index once per render: the viewer re-renders every playback tick, so a
  // linear scan per box-score row would add up fast.
  const byId = useMemo(() => new Map(world.players.map((p) => [p.id, p])), [world.players])
  const fp = { gmName, myTeamId, byId }
  return (
    <div className="rounded-lg bg-black/30 p-2">
      <div className="mb-2 flex items-center gap-2">
        <TeamCrest team={team} size={22} />
        <span className="font-display text-sm font-700 uppercase">{team.name}</span>
      </div>
      {passing.length > 0 && <BoxBlock title="Passing" rows={passing} fp={fp} cols={[
        { k: 'passComp', l: 'C/ATT', fmt: (r) => `${r.passComp ?? 0}/${r.passAtt ?? 0}` },
        { k: 'passYds', l: 'YDS' }, { k: 'passTD', l: 'TD' }, { k: 'ints', l: 'INT' },
        { k: 'passerRating', l: 'RTG', fmt: (r) => passerRating(r).toFixed(1) },
      ]} />}
      {rushing.length > 0 && <BoxBlock title="Rushing" rows={rushing} fp={fp} cols={[
        { k: 'rushAtt', l: 'CAR' }, { k: 'rushYds', l: 'YDS' }, { k: 'rushTD', l: 'TD' },
      ]} />}
      {receiving.length > 0 && <BoxBlock title="Receiving" rows={receiving} fp={fp} cols={[
        { k: 'rec', l: 'REC' }, { k: 'recYds', l: 'YDS' }, { k: 'recTD', l: 'TD' },
      ]} />}
      {defense.length > 0 && <BoxBlock title="Defense" rows={defense} fp={fp} cols={[
        { k: 'tackles', l: 'TCK' }, { k: 'tfl', l: 'TFL' }, { k: 'defSacks', l: 'SCK' }, { k: 'defInts', l: 'INT' },
        { k: 'defYdsAllowed', l: 'YDS ALW' },
      ]} />}
    </div>
  )
}

interface FingerprintCtx { gmName?: string; myTeamId?: string; byId: Map<string, import('../game/types').Player> }
interface BoxCol { k: string; l: string; fmt?: (r: GameStatLine) => string }
function BoxBlock({ title, rows, cols, fp }: { title: string; rows: import('../game/engine/stats').PlayerBoxScore[]; cols: BoxCol[]; fp: FingerprintCtx }) {
  const sorted = [...rows].sort((a, b) => (b.line[cols[1]?.k as keyof typeof b.line] as number ?? 0) - (a.line[cols[1]?.k as keyof typeof a.line] as number ?? 0))
  return (
    <div className="mb-2">
      <div className="label mb-0.5 !text-white/50">{title}</div>
      <table className="w-full text-[11px] tnum">
        <thead>
          <tr className="text-white/40">
            <th className="text-left font-500">{title === 'Defense' ? 'Player' : 'Player'}</th>
            {cols.map((c) => <th key={c.k} className="w-10 text-right font-500">{c.l}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 6).map((b) => {
            const p = fp.byId.get(b.playerId)
            const tag = fp.gmName ? originTag(p?.origin, fp.gmName, p?.teamId, fp.myTeamId) : null
            return (
              <tr key={b.playerId} className="text-white/85">
                <td className="truncate">
                  {b.name}
                  {tag && (
                    <span className="ml-1 rounded bg-[var(--team-soft)] px-1 py-px font-cond text-[9px] font-700 uppercase tracking-wide text-[var(--team)]">
                      {tag}
                    </span>
                  )}
                </td>
                {cols.map((c) => (
                  <td key={c.k} className="text-right">
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

function yardName(yard: number) {
  if (yard === 50) return '50'
  if (yard < 50) return `${yard}`
  return `${100 - yard}`
}

/** L11.5 Q1: where the ball is, tagged with the possessing club ("BUF 32", "NE 45"). */
function gameDayFieldPos(world: World, state: GameState, yard: number): string {
  const defId = state.offId === state.homeId ? state.awayId : state.homeId
  const offAbbr = world.byId[state.offId]?.abbr ?? ''
  const defAbbr = world.byId[defId]?.abbr ?? ''
  if (yard === 50) return '50'
  return yard < 50 ? `${offAbbr} ${yard}` : `${defAbbr} ${100 - yard}`
}
