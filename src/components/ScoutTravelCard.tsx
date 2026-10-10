import { useMemo, useState } from 'react'
import { Eye, Plane, Search, Sparkles, Users } from 'lucide-react'
import { cn } from '../lib/cn'
import {
  MAX_TRAVEL_COVERAGE,
  TRAVEL_BLURB,
  TRAVEL_BUDGET,
  TRAVEL_COST,
  TRAVEL_LABEL,
  coverageOf,
  travelOpen,
  travelState,
  type TravelKind,
} from '../game/engine/scoutTravel'
import { readRookieRanges } from '../game/engine/evaluation'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, RookieRangeBadges, SectionTitle } from '../ui/kit'

const KINDS: TravelKind[] = ['allStar', 'proDay', 'campus']
const KIND_ICON: Record<TravelKind, typeof Plane> = { allStar: Sparkles, proDay: Users, campus: Eye }

/** A 3-segment coverage meter: how many looks a prospect has had. */
function CoverageMeter({ depth, className }: { depth: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} title={`Coverage ${depth}/${MAX_TRAVEL_COVERAGE}`}>
      {Array.from({ length: MAX_TRAVEL_COVERAGE }, (_, i) => (
        <span
          key={i}
          className={cn('h-1.5 w-2 rounded-[2px]', i < depth ? 'bg-[var(--team-accent)]' : 'bg-surface-3')}
        />
      ))}
    </span>
  )
}

/**
 * L15 (FUTURES 14): Scouting Travel.
 *
 * The college-scouting rungs get a season travel budget to spend on the road.
 * All-star games, pro days and campus visits each file looks on a prospect; the
 * looser the coverage, the tighter your read. "Auto" spends it by board need.
 * Nothing is spent until you (or Auto) act, and it never changes game results.
 */
export function ScoutTravelCard({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const autoScoutTravel = useGame((s) => s.autoScoutTravel)
  const scoutTravelAction = useGame((s) => s.scoutTravel)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const open = travelOpen(league, career)

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const base = needle
      ? league.draft.filter(
          (p) =>
            !p.draftedBy &&
            (p.name.toLowerCase().includes(needle) ||
              p.pos.toLowerCase() === needle ||
              p.college.toLowerCase().includes(needle)),
        )
      : league.draft.filter((p) => !p.draftedBy)
    return [...base].sort((a, b) => (b.myGrade ?? b.grade) - (a.myGrade ?? a.grade)).slice(0, 24)
  }, [league.draft, q])

  if (!open) return null

  const state = travelState(career, league.season)
  const left = state.tripsLeft
  const covered = Object.keys(state.visits).length
  const prospect = selected ? league.draft.find((p) => p.id === selected) : undefined
  const depth = prospect ? coverageOf(career, prospect.id) : 0
  const rr = prospect ? readRookieRanges(career, prospect, league.draft) : null

  return (
    <Card className={className}>
      <SectionTitle
        right={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Badge tone={left > 0 ? 'neutral' : 'warn'}>
              {left} / {TRAVEL_BUDGET} trips
            </Badge>
            <Badge tone="neutral">{covered} covered</Badge>
            <Button
              size="sm"
              variant="primary"
              disabled={left <= 0}
              onClick={autoScoutTravel}
              title="Spend the budget by your board's top needs"
            >
              <Sparkles size={13} aria-hidden /> Auto
            </Button>
          </div>
        }
      >
        <span className="flex items-center gap-1.5">
          <Plane size={16} className="shrink-0 text-[var(--team-accent-text)]" aria-hidden /> Scouting Travel
        </span>
      </SectionTitle>

      <p className="mb-3 text-small leading-snug text-muted">
        Send your scouts on the road before the draft. Coverage tightens every read — the more looks a prospect gets, the
        sharper his Now / Ceiling range.
      </p>

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
                const d = coverageOf(career, p.id)
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
                        <span className="min-w-0 truncate">
                          {p.pos} · {p.college}
                        </span>
                        <CoverageMeter depth={d} />
                      </span>
                    </span>
                    <RookieRangeBadges now={prr.now} ceiling={prr.ceiling} compact />
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
              <div className="mb-2 flex items-center justify-between">
                <span className="font-cond text-small font-700 uppercase tracking-wide text-muted">Coverage</span>
                <CoverageMeter depth={depth} />
              </div>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {KINDS.map((kind) => {
                  const cost = TRAVEL_COST[kind]
                  const Icon = KIND_ICON[kind]
                  const noTrips = left < cost
                  const maxed = depth >= MAX_TRAVEL_COVERAGE
                  const disabled = noTrips || maxed
                  const why = maxed ? 'Fully covered already' : noTrips ? `Needs ${cost} trips` : TRAVEL_BLURB[kind]
                  return (
                    <Button
                      key={kind}
                      variant="secondary"
                      size="sm"
                      disabled={disabled}
                      title={why}
                      onClick={() => scoutTravelAction(prospect.id, kind)}
                    >
                      <Icon size={13} aria-hidden /> {TRAVEL_LABEL[kind].split(' ')[0]}
                      <span className="ml-0.5 text-micro opacity-80">{cost}</span>
                    </Button>
                  )
                })}
              </div>
              <p className="mt-2 text-micro leading-snug text-muted">
                {depth >= MAX_TRAVEL_COVERAGE
                  ? `You have all ${MAX_TRAVEL_COVERAGE} looks on ${prospect.name} — his range will not tighten further this season.`
                  : TRAVEL_BLURB[KINDS[0]]}
              </p>
            </div>
          ) : (
            <div className="grid h-full place-items-center rounded-[var(--r-md)] border border-dashed border-line-strong p-4 text-center">
              <p className="text-small text-muted">Pick a prospect to send a scout.</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
