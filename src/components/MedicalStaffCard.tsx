// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #48 — the training room, on the Staff screen.
//
// Three seats, three duties, each owned by ONE named man whose own sub-rating
// does the work — against ONE player's own body (his TGH, his age, his note).
// Nothing here is a league or unit average: every number is either a seat
// holder's own rating, or a per-man range across THIS club's own roster.
//
//   Head Athletic Trainer   rehab       how fast a man is brought back to play
//   Team Physician          diagnosis   how reliably he is cleared (a poor
//                                       doctor clears him a week early)
//   Sports Science Director prevention  load management / soft-tissue risk
//
// Below the seats: the weekly injury timeline (the expected-return band the
// physician's own read decides) and the load-management toggles (rest a man's
// practice reps, or hold him out of this week's game). Everything reads the
// engine helpers in `game/engine/medicalStaff.ts` — this file duplicates no rule.
// ─────────────────────────────────────────────────────────────────────────────
import { Activity, CalendarClock, HeartPulse, Stethoscope, UserPlus } from 'lucide-react'
import { cn } from '../lib/cn'
import type { CareerState, Player } from '../game/types'
import type { World } from '../game/engine/generate'
import { useGame } from '../store/gameStore'
import { Badge, Button, Card, Chip, RatingTile, SectionTitle, VerdictChip } from '../ui/kit'
import {
  MED,
  MEDICAL_CHANNELS_META,
  MEDICAL_CHANNEL,
  MEDICAL_ROLES,
  diagnosisRisk,
  expectedReturn,
  loadRestIds,
  loadWatch,
  medicalTeam,
  preventionFactor,
  rehabFactor,
  restGameIds,
  type MedicalRole,
} from '../game/engine/medicalStaff'

const ROLE_ICON: Record<MedicalRole, typeof HeartPulse> = {
  'Head Athletic Trainer': HeartPulse,
  'Team Physician': Stethoscope,
  'Sports Science Director': Activity,
}

/** The channel wording lives in the engine (`MEDICAL_CHANNELS_META`) — one
 *  place owns it; this file only adds the per-chair "what it buys you" line. */
const CHAIR_LINE: Record<MedicalRole, string> = {
  'Head Athletic Trainer': 'longer on his own fragile tissue, shorter on a durable body',
  'Team Physician': 'a poor read clears a man a week early and the tissue goes again',
  'Sports Science Director': 'each man’s own week of work, carried into the game',
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const oneDp = (v: number) => v.toFixed(2)

/** The per-man range of one channel across this club's OWN roster (never a mean). */
function rangeOf(values: number[]): { lo: number; hi: number } {
  if (!values.length) return { lo: 1, hi: 1 }
  return { lo: Math.min(...values), hi: Math.max(...values) }
}

/** Small dot strip: how many games the club expects to be without him. */
function InjuryDots({ games, tone = 'loss' }: { games: number; tone?: 'loss' | 'warn' }) {
  const n = Math.min(8, Math.max(1, games))
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={cn('h-1.5 w-1.5 rounded-full', tone === 'loss' ? 'bg-loss' : 'bg-warn')}
        />
      ))}
      {games > 8 && <span className="font-cond text-micro font-700 text-muted">+{games - 8}</span>}
    </span>
  )
}

/** One load-management toggle: a ≥44 px hit box on touch, compact on desktop. */
function RestToggle({
  on,
  onClick,
  label,
  title,
}: {
  on: boolean
  onClick: () => void
  label: string
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={cn(
        'motion inline-flex min-h-8 items-center gap-1.5 rounded-[var(--r-xs)] border px-2 py-1 font-cond text-label font-700 uppercase tracking-[0.05em]',
        'max-sm:min-h-11 pointer-coarse:min-h-11',
        on
          ? 'border-brand/40 bg-brand-soft text-brand'
          : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:text-ink-2',
      )}
    >
      <span
        aria-hidden
        className={cn('h-2 w-2 rounded-full', on ? 'bg-brand' : 'border border-line-strong')}
      />
      {label}
    </button>
  )
}

// ── The seats ────────────────────────────────────────────────────────────────

function SeatRow({
  world,
  teamId,
  role,
  onOpenMarket,
}: {
  world: World
  teamId: string
  role: MedicalRole
  onOpenMarket: (role: string) => void
}) {
  const seat = medicalTeam(world, teamId).find((s) => s.role === role)!
  const Icon = ROLE_ICON[role]
  const channel = MEDICAL_CHANNEL[role]
  const copy = MEDICAL_CHANNELS_META[channel]
  const roster = world.roster[teamId] ?? []
  // A per-man read of this chair across the club's own bodies.
  const values = roster.map((p) =>
    role === 'Head Athletic Trainer'
      ? rehabFactor(world, teamId, p)
      : role === 'Team Physician'
        ? diagnosisRisk(world, teamId, p)
        : preventionFactor(world, teamId, p),
  )
  const r = rangeOf(values)

  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--r-sm)] bg-surface-3 text-ink-2">
          <Icon size={17} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-[var(--team-accent-text)]">
              {role}
            </span>
            {seat.filled ? (
              <Badge tone="win">Hired</Badge>
            ) : (
              <Badge tone="neutral">Incumbent room</Badge>
            )}
          </div>
          <div className="mt-0.5 truncate text-small text-ink">
            {seat.filled ? seat.name : 'No dedicated hire — the club’s own room'}
          </div>
          <div className="mt-0.5 text-small text-muted">
            <b className="font-600 text-ink-2">{copy.label}</b> · {copy.blurb}{' '}
            <span className="text-faint">({CHAIR_LINE[role]})</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RatingTile value={seat.rating} size="sm" label={`${copy.label} rating`} />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-small">
        {role === 'Head Athletic Trainer' && (
          <span className="text-muted">
            per man <b className="font-600 text-ink tnum">×{oneDp(r.lo)}–×{oneDp(r.hi)}</b> recovery time
          </span>
        )}
        {role === 'Team Physician' && (
          <span className="text-muted">
            per man <b className="font-600 text-ink tnum">{pct(r.lo)}–{pct(r.hi)}</b> chance of an early
            clearance
          </span>
        )}
        {role === 'Sports Science Director' && (
          <span className="text-muted">
            per man <b className="font-600 text-ink tnum">×{oneDp(r.lo)}–×{oneDp(r.hi)}</b> soft-tissue risk
          </span>
        )}
        <span className="text-muted">
          {seat.filled ? (
            <>
              {seat.member?.specialty ?? 'Medical'} · <b className="font-600 text-ink tnum">${seat.annual / 1_000_000}M</b>/yr ·{' '}
              {seat.contractYears} yr
            </>
          ) : (
            <>At the neutral read (rating {seat.rating}) — hire a chair to move any of it</>
          )}
        </span>
        <span className="ml-auto">
          <Button
            size="sm"
            variant={seat.filled ? 'quiet' : 'secondary'}
            icon={<UserPlus size={14} aria-hidden />}
            onClick={() => onOpenMarket(role)}
          >
            {seat.filled ? 'Compare' : 'Find a hire'}
          </Button>
        </span>
      </div>
      <span className="sr-only">{`Channel ${channel}`}</span>
    </div>
  )
}

// ── The card ─────────────────────────────────────────────────────────────────

export function MedicalStaffCard({
  world,
  teamId,
  career,
  onOpenMarket,
  className,
}: {
  world: World
  teamId: string
  career: CareerState
  /** Switch the Staff screen to the Hiring Market, filtered to this role. */
  onOpenMarket: (role: string) => void
  className?: string
}) {
  const toggleLoadRest = useGame((s) => s.toggleLoadRest)
  const seats = medicalTeam(world, teamId)
  const filled = seats.filter((s) => s.filled).length
  const roster = world.roster[teamId] ?? []
  const injured = roster
    .filter((p) => p.injured)
    .sort((a, b) => (b.injured?.games ?? 0) - (a.injured?.games ?? 0) || b.ovr - a.ovr)
  const lingering = roster.filter((p) => p.lingering && !p.injured)
  const restIds = loadRestIds(career, world.season)
  const gameIds = restGameIds(career, world.season, world.week)
  const watch = loadWatch(world, teamId, 6)
  const log = career.medical && career.medical.season === world.season ? career.medical.log : []
  // A chair with nobody in it is the club's own room: say what that costs.
  const vacant = seats.filter((s) => !s.filled)

  const band = (p: Player) => expectedReturn(world, teamId, p)

  return (
    <Card className={cn('mb-5', className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="label text-[var(--team-accent-text)]">Sports science</div>
          <h3 className="mt-1 font-display text-[22px] font-800 italic uppercase leading-none text-ink">
            Training room
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={filled === 3 ? 'win' : filled ? 'warn' : 'neutral'}>
            {filled} of 3 chairs filled
          </Badge>
          {vacant.length > 0 && <Chip>Vacant: {vacant.map((s) => s.role.split(' ').slice(-1)[0]).join(', ')}</Chip>}
        </div>
      </div>

      <p className="mb-3 text-small text-muted">
        Every number below belongs to one man's own ratings working on one player's own body — his durability,
        his age, his note. A vacant chair is the club's incumbent room: the neutral read, exactly today's results.
      </p>

      <div className="space-y-2.5">
        {MEDICAL_ROLES.map((role) => (
          <SeatRow key={role} world={world} teamId={teamId} role={role} onOpenMarket={onOpenMarket} />
        ))}
      </div>

      {/* ── The week's injury timeline ─────────────────────────────────────── */}
      <SectionTitle spacing="tight" className="mt-5">
        Injury timeline
      </SectionTitle>
      {injured.length === 0 ? (
        <p className="text-small text-muted">
          Nobody on the report. The expected-return band for each man narrows with a better physician — a
          grade-D room is wrong by two games either way, an elite one calls it exactly.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--r-md)] border border-line">
          {injured.map((p) => {
            const b = band(p)
            const season = (p.injured?.games ?? 0) >= 99
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-cond text-label font-700 uppercase tracking-[0.05em] text-ink-2">
                      {p.pos}
                    </span>
                    <span className="truncate text-small font-600 text-ink">{p.name}</span>
                    <span className="truncate text-small text-muted">{p.injured?.note}</span>
                    {p.lingering && <VerdictChip tone="warn">Live tissue</VerdictChip>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-small text-muted">
                      Expected <b className="font-600 text-ink tnum">{season ? 'out for the season' : b.label}</b>
                    </span>
                    {!season && <InjuryDots games={p.injured?.games ?? 0} />}
                    <span className="text-small text-muted">
                      <CalendarClock size={12} className="mr-1 inline align-[-2px]" aria-hidden />
                      {season ? 'IR' : `${b.confidence >= 0.99 ? 'exact' : b.confidence >= 0.7 ? 'high confidence' : 'wide range'}`}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <RestToggle
                    on={restIds.includes(p.id)}
                    onClick={() => toggleLoadRest(p.id, 'practice')}
                    label="Rest reps"
                    title="Pull his practice reps this week — his own soft-tissue load drops"
                  />
                  <RestToggle
                    on={gameIds.includes(p.id)}
                    onClick={() => toggleLoadRest(p.id, 'game')}
                    label="Out Sunday"
                    title="Hold him out of THIS week's game"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {lingering.length > 0 && (
        <p className="mt-2 text-small text-muted">
          <b className="font-600 text-ink-2">{lingering.length}</b> man
          {lingering.length === 1 ? '' : 'men'} cleared early still carrying live tissue —{' '}
          {lingering.map((p) => p.name).join(', ')}. Re-injury chance is his own read, not the room's.
        </p>
      )}

      {/* ── Load management ────────────────────────────────────────────────── */}
      <SectionTitle spacing="tight" className="mt-5">
        Load management
      </SectionTitle>
      <p className="mb-2 text-small text-muted">
        The men carrying the most soft-tissue load on your club — his own durability, age and week of work. Resting
        his reps cuts this week's load; holding him out of the game removes it entirely. A better sports-science
        director buys more from the same week.
      </p>
      <ul className="divide-y divide-line rounded-[var(--r-md)] border border-line">
        {watch.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-cond text-label font-700 uppercase tracking-[0.05em] text-ink-2">{p.pos}</span>
                <span className="truncate text-small font-600 text-ink">{p.name}</span>
                {p.lingering && <VerdictChip tone="warn">Live tissue</VerdictChip>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-small text-muted">
                <span>
                  Age <b className="font-600 text-ink tnum">{p.age}</b>
                </span>
                <span>
                  Load <b className="font-600 text-ink tnum">×{oneDp(p.repRisk ?? 1)}</b>
                </span>
                <span>
                  Soft-tissue risk{' '}
                  <b className="font-600 text-ink tnum">×{oneDp(preventionFactor(world, teamId, p))}</b>
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <RestToggle
                on={restIds.includes(p.id)}
                onClick={() => toggleLoadRest(p.id, 'practice')}
                label="Rest reps"
                title="Pull his practice reps this week — his own soft-tissue load drops"
              />
              <RestToggle
                on={gameIds.includes(p.id)}
                onClick={() => toggleLoadRest(p.id, 'game')}
                label="Out Sunday"
                title="Hold him out of THIS week's game"
              />
            </div>
          </li>
        ))}
        {!watch.length && <li className="px-3 py-2.5 text-small text-muted">No roster to manage.</li>}
      </ul>
      <p className="mt-2 text-small text-muted">
        A rested week multiplies that man's own soft-tissue risk by{' '}
        <b className="font-600 text-ink tnum">×{oneDp(MED.restCut)}</b> at best (a poorer room buys less); a
        rested game removes his week of work entirely. It is free to change and never blocks him from playing hurt.
      </p>

      {/* ── This season's training-room log ────────────────────────────────── */}
      {log.length > 0 && (
        <>
          <SectionTitle spacing="tight" className="mt-5">
            This season in the training room
          </SectionTitle>
          <ul className="space-y-1">
            {log.slice(0, 6).map((ev, i) => (
              <li key={`${ev.playerId}-${ev.week}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-small">
                <span className="font-cond text-label font-700 uppercase tracking-[0.05em] text-muted">
                  Wk {ev.week}
                </span>
                <span className="text-ink-2">{ev.name}</span>
                <span
                  className={cn(
                    'text-muted',
                    ev.kind === 're-injury' && 'text-loss',
                    ev.kind === 'early-clear' && 'text-warn',
                    ev.kind === 'rehab-shortened' && 'text-win',
                  )}
                >
                  {ev.kind === 'early-clear'
                    ? `cleared early from his ${ev.note.toLowerCase()}`
                    : ev.kind === 're-injury'
                      ? `${ev.note.toLowerCase()} re-injured — out ${ev.games}`
                      : ev.kind === 'rehab-shortened'
                        ? `ahead of schedule — back in ${ev.games}`
                        : `slower than hoped — out ${ev.games}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
