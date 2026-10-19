// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #15 / L15 — job C (UI): the weekly injury report and the call.
//
// One row per injured player on the user's club, in the order the engine's
// `injuryReport` returns (most serious first, then the best player). Each row
// shows the injury, how long he is out, the club's medical read (grade + advice
// line), and the two numbers the engine actually uses for THAT player: his own
// re-injury risk (`aggravationRisk`) and the slice of his physical ratings he
// loses if he plays (`hurtPenalty`). The control is Sit (the default, today's
// behaviour) or Play hurt; a Doubtful player's Play is confirmed on a sheet
// because the risk is real. An Out (or IR) player is shown but is never a
// choice — the store's `setInjuryCall` refuses it too.
//
// Everything reads the engine helpers in `injuryCalls.ts` and the store fields
// `career.injuryCalls` / `setInjuryCall`; nothing here duplicates a rule.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { cn } from '../lib/cn'
import { signed } from '../lib/format'
import type { CareerState, Player } from '../game/types'
import type { World } from '../game/engine/generate'
import {
  gameStatus,
  injuryReport,
  medicalGrade,
  medicalGradeLabel,
  ownerPressure,
  type InjuryCall,
  type InjuryReportRow,
  type InjuryStatus,
  type MedicalGrade,
} from '../game/engine/injuryCalls'
import { expectedReturn, loadRestIds, restGameIds } from '../game/engine/medicalStaff'
import { useGame, useWorld } from '../store/gameStore'
import {
  Avatar,
  Badge,
  Card,
  Chip,
  ConfirmSheet,
  SectionTitle,
  SegmentedControl,
  type Consequence,
} from '../ui/kit'
import { usePhone } from '../ui/hooks'

const STATUS_LABEL: Record<InjuryStatus, string> = { Q: 'Questionable', D: 'Doubtful', OUT: 'Out' }
/** Badge tone by status: a Questionable is a warning, a Doubtful is a real loss. */
const STATUS_TONE: Record<InjuryStatus, 'warn' | 'loss'> = { Q: 'warn', D: 'loss', OUT: 'loss' }
const ORDER: Record<InjuryStatus, number> = { OUT: 0, D: 1, Q: 2 }
/** The report's order: most serious first, then the best player. */
const bySeverity = (a: InjuryReportRow, b: InjuryReportRow) =>
  ORDER[a.status] - ORDER[b.status] || b.player.ovr - a.player.ovr

const pct = (v: number) => `${Math.round(v * 100)}%`
const oneIn = (risk: number) => `1 in ${Math.max(2, Math.round(1 / risk))}`
/** "1 game" / "2 games" / "the season" (an aggravated Doubtful uses games = 99). */
function weeksText(games?: number): string {
  if (!games) return ''
  if (games >= 99) return 'the season'
  return `${games} ${games === 1 ? 'game' : 'games'}`
}
/** The position's key rating that loses an extra slice when he plays (QB/RB only). */
const keyLabel = (p: Player, keyExtra: number) => (keyExtra > 0 ? (p.pos === 'QB' ? 'THP' : 'CAR') : '')

/**
 * The club's injured players this week: the engine report, plus anyone on
 * injured reserve (IR never appears in the roster, so `injuryReport` misses him).
 */
function injuryRows(world: World, career: CareerState, grade: MedicalGrade): InjuryReportRow[] {
  const rows = injuryReport(world, career)
  const known = new Set(rows.map((r) => r.player.id))
  const ir = world.ir?.[career.teamId] ?? []
  for (const p of ir) {
    if (known.has(p.id)) continue
    rows.push({
      player: p,
      status: 'OUT',
      call: 'sit',
      risk: 0,
      penalty: 0,
      keyExtra: 0,
      advice: '',
      grade,
      security: 0,
    })
  }
  return rows.sort(bySeverity)
}

/**
 * The Game Plan injury report. Renders nothing until someone is hurt, and
 * nothing at all when the club has no injuries to report.
 */
export function InjuryReport({ className, disabled = false }: { className?: string; disabled?: boolean }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const setInjuryCall = useGame((s) => s.setInjuryCall)
  const phone = usePhone()
  const [pending, setPending] = useState<string | null>(null)
  if (!career) return null

  const grade = medicalGrade(world, career.teamId)
  const rows = injuryRows(world, career, grade)
  if (!rows.length) return null

  const choices = rows.filter((r) => r.status !== 'OUT')
  const row = pending ? rows.find((r) => r.player.id === pending) ?? null : null
  const pressure = row ? ownerPressure(world, career, row.player, 'sit') : null
  const consequences: Consequence[] = row
    ? [
        { label: 'Injury', value: `${row.player.injured?.note ?? 'Injury'} · out ${weeksText(row.player.injured?.games)}` },
        { label: 'Re-injury risk', value: `${pct(row.risk)} — about ${oneIn(row.risk)}`, tone: 'loss' },
        {
          label: 'Ratings if he plays',
          value: `−${pct(row.penalty)} physicals${row.keyExtra > 0 ? ` · −${pct(row.keyExtra)} ${keyLabel(row.player, row.keyExtra)}` : ''}`,
          tone: 'warn',
        },
        { label: 'If it goes', value: '2–6 more games; a Doubtful can end his season', tone: 'loss' },
        ...(pressure && (pressure.security || pressure.leadership)
          ? [
              {
                label: 'Owner if you sit him',
                value: `${signed(pressure.security)} security${pressure.leadership ? ` · ${signed(pressure.leadership)} leadership` : ''}`,
                tone: (pressure.security < 0 ? 'loss' : 'win') as 'loss' | 'win',
              },
            ]
          : []),
      ]
    : []

  return (
    <>
      <Card className={cn('min-w-0', className)}>
        <SectionTitle
          spacing="tight"
          right={choices.length > 0 ? <Badge tone="warn">{choices.length} to decide</Badge> : undefined}
        >
          Injury report
        </SectionTitle>
        <p className="mb-1 text-small leading-snug text-muted">
          Your medical staff's read on every injured player. Sitting him is the safe call — he heals on the
          normal clock. Playing him hurt costs part of his game and risks losing him for longer, so each row
          shows what the sim will actually take from <em>him</em>.
        </p>

        <div className="mt-3">
          {rows.map((r) => {
            const p = r.player
            const playing = r.status !== 'OUT' && r.call === 'play'
            const sit = ownerPressure(world, career, p, 'sit')
            return (
              <div
                key={p.id}
                className={cn(
                  'flex flex-col gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4',
                  r.status === 'OUT' && 'opacity-70',
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <Avatar name={p.name} size={phone ? 36 : 30} ring={playing ? 'accent' : 'line'} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-cond text-micro font-700 uppercase tracking-[0.06em] text-muted">{p.pos}</span>
                      <span className="truncate text-body font-600 text-ink">{p.name}</span>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      {p.injured?.games ? (
                        <span className="font-cond text-label font-600 uppercase tracking-[0.05em] text-muted">
                          out {weeksText(p.injured.games)}
                        </span>
                      ) : null}
                      {playing && <Badge tone="info">Playing hurt</Badge>}
                      {loadRestIds(career, world.season).includes(p.id) && <Chip>Practice rest</Chip>}
                      {restGameIds(career, world.season, world.week).includes(p.id) && <Chip>Rested this week</Chip>}
                    </div>

                    <div className="mt-1 text-small leading-snug text-ink-2">
                      {p.injured?.note ?? 'On injured reserve'}
                      {r.status === 'OUT' && <span className="text-muted"> — not a choice this week</span>}
                    </div>

                    {/* FUTURES #48: the club's own timeline. The centre is the
                        trainer's rehab read; the width is the physician's — a
                        better doctor narrows the band and calls it exactly. */}
                    {p.injured && p.injured.games < 99 && (
                      <InjuryTimeline
                        games={p.injured.games}
                        band={expectedReturn(world, career.teamId, p, p.injured.games)}
                      />
                    )}

                    {r.status !== 'OUT' && (
                      <>
                        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-small leading-snug text-ink-2">
                          <Chip>{medicalGradeLabel(r.grade)}</Chip>
                          <span className="min-w-0 text-muted">{r.advice}</span>
                        </div>

                        <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-cond text-label uppercase tracking-[0.05em]">
                          <div className="flex items-center gap-1.5">
                            <dt className="text-muted">Re-injury</dt>
                            <dd className={cn('font-700 tnum', r.status === 'D' ? 'text-loss' : 'text-warn')}>
                              {pct(r.risk)} <span className="font-500 normal-case text-muted">({oneIn(r.risk)})</span>
                            </dd>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <dt className="text-muted">Ratings</dt>
                            <dd className="font-700 tnum text-ink-2">
                              −{pct(r.penalty)} physicals
                              {r.keyExtra > 0 && <span className="text-muted"> · −{pct(r.keyExtra)} {keyLabel(p, r.keyExtra)}</span>}
                            </dd>
                          </div>
                          {sit.security !== 0 && (
                            <div className="flex items-center gap-1.5">
                              <dt className="text-muted">Owner</dt>
                              <dd className={cn('font-700 tnum', sit.security < 0 ? 'text-loss' : 'text-win')}>
                                {signed(sit.security)} security if he sits
                              </dd>
                            </div>
                          )}
                        </dl>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {r.status === 'OUT' ? (
                    <span className="text-small text-muted">No call — he cannot play</span>
                  ) : (
                    <SegmentedControl
                      label={`Injury call for ${p.name}`}
                      value={r.call === 'play' ? 'play' : 'sit'}
                      disabled={disabled}
                      onChange={(call: InjuryCall) => {
                        if (call === 'play' && r.status === 'D') {
                          setPending(p.id)
                          return
                        }
                        setInjuryCall(p.id, call)
                      }}
                      options={[
                        { id: 'sit', label: 'Sit', title: 'Sit him — he heals on the normal clock' },
                        { id: 'play', label: 'Play hurt', title: 'Send him out with reduced ratings and a re-injury risk' },
                      ]}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* A Doubtful player is a genuine gamble — review the numbers before it lands. */}
      <ConfirmSheet
        open={!!row}
        onClose={() => setPending(null)}
        eyebrow={`Week ${world.week}`}
        title={row ? `Play ${row.player.name} hurt?` : ''}
        subtitle={
          row
            ? `${row.player.injured?.note ?? 'Injury'} · out ${weeksText(row.player.injured?.games)}. He can still be pulled before kickoff.`
            : undefined
        }
        consequences={consequences}
        destructive={false}
        confirmLabel={row ? `Play ${row.player.name.split(' ').slice(-1)[0]} hurt` : 'Play hurt'}
        saferAlternative={{ label: 'Sit him instead', onClick: () => setPending(null) }}
        ledgerNote="You can change this until kickoff"
        onConfirm={() => {
          if (!row) return
          setInjuryCall(row.player.id, 'play')
          setPending(null)
        }}
      />
    </>
  )
}

/**
 * FUTURES #48: one player's injury timeline — the weeks he is out as a bar, the
 * expected-return band shaded, and the club's own read of it. The band comes
 * straight from `expectedReturn` (the trainer's read sets the centre, the
 * physician's sets the width).
 */
export function InjuryTimeline({ games, band }: { games: number; band: { lo: number; hi: number; label: string } }) {
  const span = Math.max(6, band.hi)
  const solid = Math.min(100, (band.lo / span) * 100)
  const open = Math.min(100, (band.hi / span) * 100)
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <div
          className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"
          role="img"
          aria-label={`Out ${games} ${games === 1 ? 'game' : 'games'} — expected back in ${band.label}`}
        >
          <div className="absolute inset-y-0 left-0 bg-warn-soft" style={{ width: `${open}%` }} />
          <div className="absolute inset-y-0 left-0 bg-warn" style={{ width: `${solid}%` }} />
        </div>
        <span className="shrink-0 font-cond text-label font-600 uppercase tracking-[0.05em] text-muted tnum">
          {games} out
        </span>
      </div>
      <div className="mt-0.5 text-small text-muted">
        Expected back in <strong className="font-600 text-ink-2">{band.label}</strong>
      </div>
    </div>
  )
}

/**
 * The compact injury status badge used on the depth chart and the player
 * profile: "Questionable · playing hurt" once the club has sent him out, else
 * his injury. Reads the store itself so a screen only passes the player.
 */export function InjuryStatusBadge({
  player,
  world,
  compact = false,
  className,
}: {
  player: Player
  world: World
  /** Keep the depth chart's tight "OUT 2W" wording. */
  compact?: boolean
  className?: string
}) {
  const career = useGame((s) => s.career)
  const status = gameStatus(player, world, career ?? undefined)
  if (!status) return null
  const mine = !!career && player.teamId === career.teamId
  const playing = mine && status !== 'OUT' && career.injuryCalls?.[player.id] === 'play'
  const games = player.injured?.games
  const title = playing
    ? `${player.name} is playing hurt — reduced ratings, re-injury risk`
    : [player.injured?.note, games ? `out ${weeksText(games)}` : null].filter(Boolean).join(' · ')

  if (playing) {
    return (
      <span title={title} className={cn('inline-flex shrink-0', className)}>
        <Badge tone={status === 'D' ? 'warn' : 'info'}>
          {compact ? `${status} · playing` : `${STATUS_LABEL[status]} · playing hurt`}
        </Badge>
      </span>
    )
  }
  if (compact) {
    const short = games ? (games >= 99 ? 'season' : `${games}W`) : ''
    return (
      <span title={title} className={cn('inline-flex shrink-0', className)}>
        <Badge tone={STATUS_TONE[status]}>{short ? `${status} · ${short}` : status}</Badge>
      </span>
    )
  }
  return (
    <span title={title} className={cn('inline-flex shrink-0', className)}>
      <Badge tone={STATUS_TONE[status]}>
        {STATUS_LABEL[status]}
        {games ? ` · ${weeksText(games)}` : ''}
      </Badge>
    </span>
  )}
