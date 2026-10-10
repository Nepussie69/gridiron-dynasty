import { useMemo, useState } from 'react'
import { Eye, Phone, Search, Target } from 'lucide-react'
import { cn } from '../lib/cn'
import {
  COMBINE_COST,
  COMBINE_HOURS,
  MAX_COMBINE_PROSPECTS,
  combineOpen,
  type CombineKind,
} from '../game/engine/combine'
import { CHARACTER_FACETS } from '../game/engine/character'
import { readRookieRanges } from '../game/engine/evaluation'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, RookieRangeBadges, SectionTitle } from '../ui/kit'

const ACTIONS: { kind: CombineKind; label: string; Icon: typeof Phone }[] = [
  { kind: 'interview', label: 'Interview', Icon: Phone },
  { kind: 'workout', label: 'Workout', Icon: Target },
  { kind: 'film', label: 'Film', Icon: Eye },
]

/**
 * G4: Combine Week.
 *
 * College-scouting rungs (4–5) get one offseason week and a 20-hour budget
 * before the draft. Interview, workout or film up to twelve prospects — the
 * combine replaces scouting points that week, so nothing else is spent.
 */
export function CombineCard({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const combineAction = useGame((s) => s.combineAction)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const open = combineOpen(league, career)

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const base = needle
      ? league.draft.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            p.pos.toLowerCase() === needle ||
            p.college.toLowerCase().includes(needle),
        )
      : league.draft
    return [...base].sort((a, b) => (b.myGrade ?? b.grade) - (a.myGrade ?? a.grade)).slice(0, 24)
  }, [league.draft, q])

  if (!open) return null

  const combine = career.combine?.season === league.season ? career.combine : null
  const hoursLeft = combine?.hoursLeft ?? COMBINE_HOURS
  const hoursUsed = COMBINE_HOURS - hoursLeft
  const seen = combine?.seen ?? []
  const prospect = selected ? league.draft.find((p) => p.id === selected) : undefined
  const rr = prospect ? readRookieRanges(career, prospect, league.draft) : null
  const charDone = !!prospect?.character && (prospect.characterReads ?? []).length >= CHARACTER_FACETS.length
  const atLimit = !!prospect && !seen.includes(prospect.id) && seen.length >= MAX_COMBINE_PROSPECTS

  return (
    <Card className={className}>
      <SectionTitle
        right={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Badge tone={hoursLeft > 0 ? 'neutral' : 'warn'}>{hoursLeft}h left</Badge>
            <Badge tone="neutral">{seen.length}/{MAX_COMBINE_PROSPECTS} seen</Badge>
          </div>
        }
      >
        <span className="flex items-center gap-1.5">
          <Target size={16} className="text-[var(--team-accent-text)]" aria-hidden /> Combine Week
        </span>
      </SectionTitle>

      <p className="mb-3 text-small leading-snug text-muted">
        One week, {COMBINE_HOURS} hours, no scouting points spent. Interview, workout or film up to{' '}
        {MAX_COMBINE_PROSPECTS} prospects before the draft.
      </p>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-micro text-muted">
          <span className="label">Hours used</span>
          <span className="tnum">{hoursUsed} of {COMBINE_HOURS}h</span>
        </div>
        <div
          role="meter"
          aria-valuenow={hoursUsed}
          aria-valuemin={0}
          aria-valuemax={COMBINE_HOURS}
          aria-label={`${hoursUsed} of ${COMBINE_HOURS} combine hours used`}
          className="h-1.5 w-full overflow-hidden rounded-[3px] bg-surface-3"
        >
          <div className="h-full rounded-[3px] bg-[var(--team-accent)]" style={{ width: `${(hoursUsed / COMBINE_HOURS) * 100}%` }} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 rounded-[var(--r-md)] border border-line px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-faint" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the class board…"
              className="w-full bg-transparent text-small text-ink outline-none placeholder:text-faint max-sm:text-[16px]"
            />
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto pr-0.5 max-sm:max-h-none max-sm:overflow-visible">
            {matches.length ? (
              matches.map((p) => {
                const on = selected === p.id
                const s = seen.includes(p.id)
                const prr = readRookieRanges(career, p, league.draft)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-[var(--r-md)] border px-2 py-1.5 text-left transition',
                      on ? 'border-line-strong bg-surface-3' : 'border-transparent hover:bg-surface-2',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-small font-600 text-ink">{p.name}</span>
                      <span className="flex items-center gap-1.5 font-cond text-micro font-700 uppercase text-muted">
                        <span className="min-w-0 truncate">{p.pos} · {p.college}</span>
                        <RookieRangeBadges now={prr.now} ceiling={prr.ceiling} compact />
                      </span>
                    </span>
                    {s && <span className="shrink-0 font-cond text-micro font-700 uppercase text-muted">Seen</span>}
                  </button>
                )
              })
            ) : (
              <p className="px-1 py-3 text-small text-muted">No prospects match that search.</p>
            )}
          </div>
        </div>

        <div>
          {prospect ? (
            <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-small font-600 text-ink">
                  {prospect.name}{' '}
                  <span className="font-cond text-micro font-700 uppercase text-muted">{prospect.pos}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-cond text-micro text-muted">
                  {rr && <RookieRangeBadges now={rr.now} ceiling={rr.ceiling} compact />}
                  <span className="tnum">{prospect.confidence}% known</span>
                </span>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {ACTIONS.map(({ kind, label, Icon }) => {
                  const cost = COMBINE_COST[kind]
                  const noHours = hoursLeft < cost
                  const noChar = kind === 'interview' && (!prospect.character || charDone)
                  const disabled = noHours || atLimit || noChar
                  const why = noHours
                    ? `Needs ${cost} hours`
                    : atLimit
                      ? `Already seen ${MAX_COMBINE_PROSPECTS} prospects`
                      : noChar
                        ? 'Nothing left to learn off the field'
                        : `${label} — ${cost} hours`
                  return (
                    <Button
                      key={kind}
                      variant="secondary"
                      size="sm"
                      disabled={disabled}
                      title={why}
                      onClick={() => combineAction(prospect.id, kind)}
                    >
                      <Icon size={13} aria-hidden /> {label}
                      <span className="ml-0.5 text-micro opacity-80">{cost}h</span>
                    </Button>
                  )
                })}
              </div>
              <p className="mt-2 text-micro leading-snug text-muted">
                {atLimit
                  ? "This week's board is full — finish with the twelve you've seen."
                  : 'Interview reveals character; workout closes your grade; film gets you close to the truth.'}
              </p>
            </div>
          ) : (
            <div className="grid h-full place-items-center rounded-[var(--r-md)] border border-dashed border-line-strong p-4 text-center">
              <p className="text-small text-muted">Pick a prospect to work with.</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
