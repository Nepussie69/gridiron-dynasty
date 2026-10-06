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
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card } from '../ui/kit'

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
  const seen = combine?.seen ?? []
  const prospect = selected ? league.draft.find((p) => p.id === selected) : undefined
  const charDone = !!prospect?.character && (prospect.characterReads ?? []).length >= CHARACTER_FACETS.length
  const atLimit = !!prospect && !seen.includes(prospect.id) && seen.length >= MAX_COMBINE_PROSPECTS

  return (
    <Card className={className}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <Target size={15} className="text-[var(--team)]" /> Combine Week
        </h3>
        <div className="flex items-center gap-1.5">
          <Badge tone={hoursLeft > 0 ? 'team' : 'loss'}>{hoursLeft}h left</Badge>
          <Badge tone="neutral">
            {seen.length}/{MAX_COMBINE_PROSPECTS} seen
          </Badge>
        </div>
      </div>
      <p className="mb-3 text-sm leading-snug text-muted">
        One week, {COMBINE_HOURS} hours, no scouting points spent. Interview, workout or film up to{' '}
        {MAX_COMBINE_PROSPECTS} prospects before the draft.
      </p>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-line px-2 py-1">
            <Search size={13} className="shrink-0 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the class board…"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto pr-0.5">
            {matches.length ? (
              matches.map((p) => {
                const on = selected === p.id
                const s = seen.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1 text-left transition',
                      on ? 'border-[var(--team)] bg-[var(--team-soft)]' : 'border-transparent hover:bg-surface-2',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-600 text-ink">{p.name}</span>
                      <span className="block truncate font-cond text-[10px] font-700 uppercase text-muted">
                        {p.pos} · {p.college} · {p.myGrade ?? p.grade}
                      </span>
                    </span>
                    {s && <span className="shrink-0 font-cond text-[10px] font-700 uppercase text-[var(--team)]">Seen</span>}
                  </button>
                )
              })
            ) : (
              <p className="px-1 py-3 text-sm text-muted">No prospects match that search.</p>
            )}
          </div>
        </div>

        <div>
          {prospect ? (
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-600 text-ink">
                  {prospect.name}{' '}
                  <span className="font-cond text-[11px] font-700 uppercase text-muted">{prospect.pos}</span>
                </span>
                <span className="shrink-0 font-cond text-[11px] text-muted">
                  Grade {prospect.myGrade ?? prospect.grade} · {prospect.confidence}% known
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
                      variant="team"
                      size="sm"
                      disabled={disabled}
                      title={why}
                      onClick={() => combineAction(prospect.id, kind)}
                    >
                      <Icon size={13} /> {label}
                      <span className="ml-0.5 text-[10px] opacity-80">{cost}h</span>
                    </Button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted">
                {atLimit
                  ? "This week's board is full — finish with the twelve you've seen."
                  : 'Interview reveals character; workout closes your grade; film gets you close to the truth.'}
              </p>
            </div>
          ) : (
            <div className="grid h-full place-items-center rounded-lg border border-dashed border-line p-4 text-center">
              <p className="text-sm text-muted">Pick a prospect to work with.</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
