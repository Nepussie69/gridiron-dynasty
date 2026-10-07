import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, Pause, Play, SkipForward, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { coachLabels, type GameState, type Play as PlayEvent, type Moment } from '../game/engine/playsim'
import type { World } from '../game/engine/generate'
import type { GameStatLine } from '../game/types'
import { capabilities } from '../game/engine/capabilities'
import { originTag } from '../game/selectors'
import { coverageGrade, passerRating } from '../game/engine/stats'
import { useGame, useWorld, type GameDay } from '../store/gameStore'
import { PLAN_PRESETS } from '../game/engine/gameplan'
import { coordinatorAdvice } from '../game/engine/advice'
import { PlanEditor } from './PlanEditor'
import { buildPlayAnim, holderAt, liftAt, posAt } from './playAnim'
import { Badge, Button, TeamCrest } from '../ui/kit'

const CENTER_Y = 26.65
const W = 120
const H = 53.3

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
  // Animation clock for the play on screen: t runs 0..1 after a short pre-snap beat.
  const [clock, setClock] = useState<{ i: number; t: number }>({ i: -1, t: 0 })
  const timer = useRef<number | null>(null)
  const [tab, setTab] = useState<'plays' | 'box' | 'plan' | 'film'>('plays')
  const [boxTeam, setBoxTeam] = useState<string | null>(null)

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
  const anim = useMemo(() => {
    if (!play) return null
    return buildPlayAnim(play, {
      next: nextForAnim,
      targetPos: play.targetId ? byId.get(play.targetId)?.pos : undefined,
      carrierIsQB: play.type === 'run' && !!play.carrierId && byId.get(play.carrierId)?.pos === 'QB',
    })
  }, [play, nextForAnim, byId])
  const PRE_SNAP = 250

  // Run the play's animation: a pre-snap beat, then t from 0 to 1.
  useEffect(() => {
    if (!anim) return
    let raf = 0
    const start = performance.now() + PRE_SNAP / speed
    const span = anim.duration / speed
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / span))
      setClock({ i: idx, t })
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [anim, idx, speed])

  // auto-advance
  useEffect(() => {
    if (!match || !playing || !play) return
    const dur = ((anim?.duration ?? 1600) + PRE_SNAP) / speed + (play.type === 'end' ? 200 : 550)
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
  }, [idx, playing, speed, match, play, anim])

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
  const los = mx(10 + play.startYard)
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

  const sideTabs: { id: 'plays' | 'box' | 'plan' | 'film'; label: string }[] = [
    { id: 'plays', label: 'Plays' },
    { id: 'box', label: 'Box score' },
    ...(gameDay ? [{ id: 'plan' as const, label: 'Game plan' }] : []),
    ...(match.film && !gameDay ? [{ id: 'film' as const, label: 'Film' }] : []),
  ]
  const activeTab = sideTabs.some((t) => t.id === tab) ? tab : 'plays'
  const boxTeamId = boxTeam === match.homeId || boxTeam === match.awayId ? boxTeam : (career?.teamId === match.homeId ? match.homeId : match.awayId)

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

  const downText = (p: PlayEvent) => (p.down ? `${['1st', '2nd', '3rd', '4th'][p.down - 1]} & ${p.distance}` : '')
  const jump = (i: number) => {
    setIdx(i)
    setPlaying(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-[#0a1626] text-white">
      {/* ── Scoreboard ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 py-2">
        <ScoreSide team={away} score={shownScore.away} hasBall={play.offId === away.id} align="left" />
        <div className="mx-auto flex min-w-0 flex-col items-center leading-tight">
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap rounded bg-white/10 px-2 py-0.5 font-cond text-xs font-700 tnum sm:text-sm">Q{play.qtr} · {play.clock}</span>
            {play.down ? (
              <span className="whitespace-nowrap font-cond text-xs font-700 uppercase sm:text-sm">
                {downText(play)} <span className="hidden text-white/60 sm:inline">at {gameDayFieldPosForPlay(world, play)}</span>
              </span>
            ) : (
              <span className="font-cond text-sm font-600 uppercase text-white/70">{play.concept}</span>
            )}
          </div>
          <span className="mt-0.5 hidden truncate text-[10px] text-white/45 md:block">
            {[away, home].map((t) => {
              const c = coachLabels(world, t.id)
              return `${t.abbr}: ${c.ocScheme} / ${c.dcScheme}`
            }).join('   ·   ')}
          </span>
        </div>
        <ScoreSide team={home} score={shownScore.home} hasBall={play.offId === home.id} align="right" />
        <button onClick={onClose} title={gameDay ? 'Abandon game' : 'Close'} className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
          <X size={16} />
        </button>
      </header>

      {/* ── Body: field + decisions (left), side panel (right) ─────────────── */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,42vh)] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1">
        <div className="flex min-h-0 flex-col overflow-y-auto lg:overflow-hidden">
          {/* Field */}
          <div className="relative min-h-[140px] flex-1 p-3 pb-0">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full">
              <rect x={10} y={0} width={100} height={H} fill="#1f7a3f" />
              <rect x={0} y={0} width={10} height={H} fill={home.primary} opacity={0.9} />
              <rect x={110} y={0} width={10} height={H} fill={away.primary} opacity={0.9} />
              {Array.from({ length: 21 }, (_, i) => 10 + i * 5).map((x, i) => (
                <line key={x} x1={x} y1={0} x2={x} y2={H} stroke="#ffffff" strokeOpacity={i % 2 === 0 ? 0.5 : 0.25} strokeWidth={0.12} />
              ))}
              {Array.from({ length: 9 }, (_, i) => 20 + i * 10).map((x) => (
                <line key={`n${x}`} x1={x} y1={0} x2={x} y2={H} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.2} />
              ))}
              <line x1={los} y1={0} x2={los} y2={H} stroke="#ffd34d" strokeWidth={0.35} />
              <text x={4.5} y={CENTER_Y + 1.5} fill="#fff" fontSize={3.4} textAnchor="middle" opacity={0.85} className="font-display">
                {home.abbr}
              </text>
              <text x={115.5} y={CENTER_Y + 1.5} fill="#fff" fontSize={3.4} textAnchor="middle" opacity={0.85} className="font-display">
                {away.abbr}
              </text>
              {anim?.posts && (
                <g>
                  <line x1={mx(119)} y1={CENTER_Y - 3.1} x2={mx(119)} y2={CENTER_Y + 3.1} stroke="#ffd34d" strokeWidth={0.45} />
                  <line x1={mx(118)} y1={CENTER_Y} x2={mx(119)} y2={CENTER_Y} stroke="#ffd34d" strokeWidth={0.35} />
                </g>
              )}
              {anim?.actors.map((a) => {
                const pt = posAt(a.path, t)
                const carrying = holder === a.key
                return (
                  <g key={a.key} transform={`translate(${mx(pt.x)} ${pt.y})`}>
                    {carrying && <circle r={2} fill="#ffd34d" opacity={0.35} />}
                    <circle r={1.15} fill={a.side === 'off' ? offColor : defColor} stroke={carrying ? '#ffd34d' : '#fff'} strokeWidth={carrying ? 0.35 : 0.2} />
                  </g>
                )
              })}
              {anim && (() => {
                const b = posAt(anim.ball, t)
                const lift = liftAt(anim, t)
                const bx = mx(b.x)
                return (
                  <g>
                    {lift > 0.02 && <ellipse cx={bx} cy={b.y} rx={0.6} ry={0.3} fill="#000" opacity={0.3} />}
                    <ellipse cx={bx} cy={b.y - lift * 3.2} rx={0.78 * (1 + lift * 0.45)} ry={0.5 * (1 + lift * 0.45)} fill="#8a4b1f" stroke="#fff" strokeWidth={0.14} />
                  </g>
                )
              })()}
              {anim?.flag && t >= anim.flag.t && (
                <rect x={mx(anim.flag.x) - 0.5} y={anim.flag.y - 0.5} width={1} height={1} fill="#ffd400" stroke="#000" strokeWidth={0.08} />
              )}
            </svg>
          </div>

          {/* What just happened + replay controls */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="font-display text-lg font-700 uppercase" style={{ color: play.bigPlay ? '#ffd34d' : '#fff' }}>{play.concept}</span>
              <span className="truncate font-cond text-base font-600 text-white/85">{play.result}</span>
              {play.yards !== 0 && (
                <span className={cn('font-cond text-base font-700 tnum', play.yards > 0 ? 'text-[#8ef0b5]' : 'text-[#ffb3ba]')}>
                  {play.yards > 0 ? '+' : ''}{play.yards} yd
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1 rounded-lg bg-white/5 p-1">
              <IconBtn title="Previous play" onClick={() => jump(Math.max(0, idx - 1))}><ChevronLeft size={15} /></IconBtn>
              <IconBtn title={playing ? 'Pause replay' : 'Play replay'} onClick={() => setPlaying((p) => !p)}>{playing ? <Pause size={15} /> : <Play size={15} />}</IconBtn>
              <IconBtn title="Next play" onClick={() => jump(Math.min(match.plays.length - 1, idx + 1))}><ChevronRight size={15} /></IconBtn>
              <IconBtn title="Jump to the latest play" onClick={() => jump(match.plays.length - 1)}><SkipForward size={15} /></IconBtn>
              <span className="mx-1 h-4 w-px bg-white/15" />
              {[0.5, 1, 2, 4].map((sp) => (
                <button
                  key={sp}
                  onClick={() => setSpeed(sp)}
                  className={cn('rounded px-1.5 py-0.5 font-cond text-[11px] font-700', speed === sp ? 'bg-white text-ink' : 'text-white/60 hover:bg-white/10')}
                >
                  {sp}×
                </button>
              ))}
              <span className="ml-1 font-cond text-[11px] tnum text-white/40">{idx + 1}/{match.plays.length}</span>
            </div>
          </div>

          {/* Game day: your call, or how to move the game on */}
          {gameDay && (
            <div className="shrink-0 border-t border-white/10 bg-[#0d1a2b] px-4 py-3">
              {showMoment && moment ? (
                <MomentCard moment={moment} fieldPos={gameDayFieldPos(world, gameDay.state, moment.yard)} onAnswer={answer} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-700 uppercase tracking-wide">Game day</span>
                  <span className="text-[11px] text-white/55">
                    {moment ? 'Your call is coming up — the replay is catching up.' : 'Paused. Change the plan in the side panel, or move the game on.'}
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="primary" className="!bg-white !text-ink" disabled={!!moment} onClick={() => advance('play')}>Next play</Button>
                    <Button size="sm" variant="primary" className="!bg-white !text-ink" disabled={!!moment} onClick={() => advance('drive')}>Next drive</Button>
                    <Button size="sm" variant="primary" className="!bg-white !text-ink" disabled={!!moment} onClick={() => advance('moment')}>Next moment</Button>
                    <Button size="sm" variant="ghost" className="!text-white/80 hover:!bg-white/10" onClick={simToEnd}>
                      <SkipForward size={14} /> Sim to end
                    </Button>
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
              <PlayLog plays={match.plays} idx={idx} world={world} onJump={jump} downText={downText} />
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
                <BoxScore world={world} teamId={boxTeamId} box={match.box} gmName={career?.gmName} myTeamId={career?.teamId} />
              </div>
            )}
            {activeTab === 'plan' && gameDay && <GameDayPlanPanel gameDay={gameDay} />}
            {activeTab === 'film' && match.film && (
              <div className="p-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl font-700">{match.film.letter}</span>
                  <span className="font-cond text-xs text-white/50">{match.film.grade}/100 film grade</span>
                </div>
                {match.film.lines.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {match.film.lines.map((l, i) => <li key={i} className="text-xs leading-snug text-white/70">• {l}</li>)}
                  </ul>
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

function ScoreSide({ team, score, hasBall, align }: { team: import('../game/types').Team; score: number; hasBall: boolean; align: 'left' | 'right' }) {
  return (
    <div className={cn('flex items-center gap-2.5', align === 'right' && 'flex-row-reverse')}>
      <TeamCrest team={team} size={30} />
      <div className={cn('flex flex-col leading-none', align === 'right' && 'items-end')}>
        <span className="font-cond text-[11px] font-700 uppercase tracking-wide text-white/60">
          {team.abbr}
          {hasBall && <span className="ml-1 text-[#ffd34d]">●</span>}
        </span>
        <span className="hidden font-display text-sm font-700 uppercase sm:block">{team.name}</span>
      </div>
      <span className="font-display text-3xl font-700 tnum">{score}</span>
    </div>
  )
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="grid h-7 w-7 place-items-center rounded text-white/80 hover:bg-white/15 hover:text-white">
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
                    i > idx && 'opacity-45',
                  )}
                >
                  <span className="w-14 shrink-0 pt-px font-cond text-[11px] tnum text-white/45">{downText(p) || p.type.toUpperCase()}</span>
                  <span className="min-w-0 flex-1 leading-snug text-white/85">
                    <span className="font-600 text-white">{p.concept}</span> — {p.result}
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
function GameDayPlanPanel({ gameDay }: { gameDay: GameDay }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const setGameDayPlan = useGame((s) => s.setGameDayPlan)
  const [side, setSide] = useState<'off' | 'def'>('off')
  if (!career) return null
  const caps = capabilities(career)
  const focus = career.unitFocus ?? 'both'
  const hasOff = caps.planScope === 'both' || focus !== 'def'
  const hasDef = caps.planScope === 'both' || focus !== 'off'
  if (!hasOff && !hasDef) return null
  const active: 'off' | 'def' = side === 'off' && hasOff ? 'off' : hasDef ? 'def' : 'off'
  const oppId = gameDay.state.homeId === career.teamId ? gameDay.state.awayId : gameDay.state.homeId
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
  const defense = rows.filter((r) => (r.line.tackles ?? 0) > 0 || (r.line.tfl ?? 0) > 0 || (r.line.defSacks ?? 0) > 0 || (r.line.defInts ?? 0) > 0 || (r.line.defYdsAllowed ?? 0) > 0 || (r.line.defComp ?? 0) > 0 || (r.line.defTargets ?? 0) > 0)
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
        { k: 'defYdsAllowed', l: 'ALW' },
        { k: 'coverageGrade', l: 'COV', fmt: (r) => { const g = coverageGrade(r); return g == null ? '—' : String(g) } },
      ]} />}
    </div>
  )
}

interface FingerprintCtx { gmName?: string; myTeamId?: string; byId: Map<string, import('../game/types').Player> }
interface BoxCol { k: string; l: string; fmt?: (r: GameStatLine) => string }
function BoxBlock({ title, rows, cols, fp }: { title: string; rows: import('../game/engine/stats').PlayerBoxScore[]; cols: BoxCol[]; fp: FingerprintCtx }) {
  // Lead with the volume stat: yards for offense, tackles for defense.
  const sortKey = (title === 'Defense' ? cols[0]?.k : cols[1]?.k) as keyof GameStatLine
  const sorted = [...rows].sort((a, b) => ((b.line[sortKey] as number) ?? 0) - ((a.line[sortKey] as number) ?? 0))
  const wide = (k: string) => k === 'passComp' || k === 'passerRating'
  return (
    <div className="mb-3">
      <div className="label mb-0.5 !text-white/50">{title}</div>
      <table className="w-full table-fixed text-[11px] tnum">
        <colgroup>
          <col />
          {cols.map((c) => <col key={c.k} className={wide(c.k) ? 'w-11' : 'w-8'} />)}
        </colgroup>
        <thead>
          <tr className="text-white/40">
            <th className="text-left font-500">Player</th>
            {cols.map((c) => <th key={c.k} className="whitespace-nowrap text-right font-500">{c.l}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 8).map((b) => {
            const p = fp.byId.get(b.playerId)
            const tag = fp.gmName ? originTag(p?.origin, fp.gmName, p?.teamId, fp.myTeamId) : null
            return (
              <tr key={b.playerId} className="text-white/85">
                <td className="truncate pr-1" title={b.name}>
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
