import { useState } from 'react'
import { Briefcase, Star, UserPlus } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import type { StaffMember, StaffRole } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, PageHeader, RatingBar, Stat } from '../ui/kit'
import { coachEffect, staffGrade } from '../game/engine/coaching'
import { openCandidates, schemesForRole, type HireCandidate } from '../game/engine/hiring'
import { learnedBias } from '../game/engine/scoutBias'

type RoleGroup = 'all' | 'hc' | 'coord' | 'pos' | 'front'

const ROLE_GROUPS: { id: RoleGroup; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hc', label: 'Head Coach' },
  { id: 'coord', label: 'Coordinators' },
  { id: 'pos', label: 'Position Coaches' },
  { id: 'front', label: 'Front Office & Scouting' },
]

const ROLE_GROUP_KEY = 'gd.staff.roleGroup'

function groupOf(role: StaffRole): Exclude<RoleGroup, 'all'> {
  if (role === 'Head Coach') return 'hc'
  if (
    role === 'Offensive Coordinator' ||
    role === 'Defensive Coordinator' ||
    role === 'Special Teams Coordinator'
  ) {
    return 'coord'
  }
  if (role === 'QB Coach' || role === 'OL Coach' || role === 'DL Coach' || role === 'Secondary Coach') {
    return 'pos'
  }
  return 'front' // Scout, Director of Player Personnel, General Manager
}

function inGroup(role: StaffRole, group: RoleGroup): boolean {
  return group === 'all' || groupOf(role) === group
}

export function Staff() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)!

  const staff = league.staff[activeTeamId] ?? []
  const [tab, setTab] = useState<'staff' | 'market'>('staff')
  const [roleGroup, setRoleGroup] = useState<RoleGroup>(() => {
    try {
      const saved = localStorage.getItem(ROLE_GROUP_KEY) as RoleGroup | null
      if (saved && ROLE_GROUPS.some((g) => g.id === saved)) return saved
    } catch {
      /* localStorage unavailable */
    }
    return 'all'
  })
  const pickGroup = (g: RoleGroup) => {
    setRoleGroup(g)
    try {
      localStorage.setItem(ROLE_GROUP_KEY, g)
    } catch {
      /* localStorage unavailable */
    }
  }

  const payroll = staff.reduce((s, m) => s + m.annual, 0)
  const effect = coachEffect(league, activeTeamId)
  const grade = staffGrade(effect)
  const hireStaff = useGame((s) => s.hireStaff)
  const fireStaff = useGame((s) => s.fireStaff)
  const candidates = openCandidates(league, career.teamId, career.reputation)
  const visibleStaff = staff.filter((m) => inGroup(m.role, roleGroup))
  const visibleCandidates = candidates
    .filter((c) => inGroup(c.role, roleGroup))
    .sort((a, b) => b.rating - a.rating)
  // Display-only headroom: prestige-scaled staff budget minus current payroll.
  const localeBudget = Math.max(0, Math.round((18 + league.byId[career.teamId].prestige * 0.3) * 1_000_000) - payroll)

  return (
    <div>
      <PageHeader
        eyebrow="Club"
        title="Staff & Hiring"
        subtitle="Build your coaching tree and scouting department. The right staff multiplies player development."
        right={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {[
              { id: 'staff' as const, label: 'My Staff' },
              { id: 'market' as const, label: 'Hiring Market' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'rounded-md px-4 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                  tab === t.id ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <Stat label="Staff" value={staff.length} sub={`${staff.filter((s) => s.rating > 80).length} elite`} />
        </Card>
        <Card>
          <Stat label="Staff Rating" value={Math.round(staff.reduce((s, m) => s + m.rating, 0) / (staff.length || 1))} sub={grade + ' staff'} />
        </Card>
        <Card>
          <Stat label="On-Field Impact" value={`${effect.offEdge + effect.defEdge >= 0 ? '+' : ''}${(effect.offEdge + effect.defEdge).toFixed(1)}`} sub={`Dev ×${effect.development.toFixed(2)}`} tone={effect.offEdge + effect.defEdge >= 1 ? 'win' : effect.offEdge + effect.defEdge <= -1 ? 'loss' : undefined} />
        </Card>
        <Card>
          <Stat label="Payroll" value={money(payroll)} sub="per season" />
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="label mr-1">Role Group</span>
        {ROLE_GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => pickGroup(g.id)}
            className={cn(
              'rounded-md border px-3 py-1 font-cond text-[11px] font-700 uppercase tracking-wide transition',
              roleGroup === g.id ? 'border-transparent bg-ink text-white' : 'border-line text-muted hover:bg-surface-2',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      {tab === 'staff' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleStaff.map((m) => (
            <StaffCard key={m.id} member={m} onAction={() => fireStaff(m.id)} actionLabel="Let Go" />
          ))}
          {!visibleStaff.length && (
            <Card className="grid place-items-center border-dashed text-center text-sm text-muted">
              <div>
                <Briefcase size={22} className="mx-auto mb-2 text-faint" />
                {staff.length
                  ? 'No staff in this role group.'
                  : 'No staff yet. Hire coordinators and position coaches on the Hiring Market tab.'}
              </div>
            </Card>
          )}
        </div>
      ) : (
        <>
          <Card className="mb-3 bg-surface-2">
            <div className="text-xs leading-relaxed text-muted">
              Coaches weigh your <strong>destination</strong>, your <strong>reputation</strong>, and
              the <strong>money</strong>. Elite coaches will turn down a weak program — offer above
              their asking price to land them. Budget available:{' '}
              <strong className="text-ink">{money(localeBudget)}</strong> of headroom.
            </div>
          </Card>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleCandidates.map((c) => (
              <HireCard
                key={c.id}
                candidate={c}
                onHire={(salary, scheme) => hireStaff(c.id, salary, scheme)}
              />
            ))}
            {!visibleCandidates.length && (
              <Card className="grid place-items-center border-dashed text-center text-sm text-muted">
                No candidates in this role group.
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function HireCard({
  candidate,
  onHire,
}: {
  candidate: HireCandidate
  onHire: (salary: number, scheme?: string) => void
}) {
  const [offer, setOffer] = useState(candidate.askingSalary)
  const schemes = schemesForRole(candidate.role)
  const [scheme, setScheme] = useState(candidate.scheme)
  const interestTone = candidate.interest >= 65 ? 'win' : candidate.interest >= 40 ? 'warn' : 'loss'
  const interestLabel = candidate.interest >= 65 ? 'Keen' : candidate.interest >= 40 ? 'Warm' : 'Cold'
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ink text-white">
          <UserPlus size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-lg font-700 uppercase leading-none text-ink">{candidate.name}</span>
            {candidate.rating >= 88 && <Star size={14} className="shrink-0 text-gold" fill="#c99a2e" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="team">{candidate.role}</Badge>
            <Badge tone={candidate.rating >= 85 ? 'gold' : candidate.rating >= 75 ? 'info' : 'neutral'}>{candidate.rating} OVR</Badge>
            <Badge tone={interestTone as 'win' | 'warn' | 'loss'}>{interestLabel} {candidate.interest}%</Badge>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Age" value={candidate.age} />
        <MiniStat label="Scheme" value={candidate.scheme.split(' ')[0]} />
        <MiniStat label="Asking" value={money(candidate.askingSalary)} />
      </div>

      {schemes.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1">Install Scheme</div>
          <div className="flex flex-wrap gap-1">
            {schemes.map((s) => (
              <button
                key={s}
                onClick={() => setScheme(s)}
                className={cn(
                  'rounded-md border px-2 py-1 font-cond text-[11px] font-700 uppercase transition',
                  scheme === s ? 'border-transparent bg-ink text-white' : 'border-line text-muted hover:bg-surface-2',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-faint">
            Players who fit this system learn the playbook and produce more each year together.
          </p>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="label">Your Offer</span>
          <span className="font-cond text-xs font-700 tnum text-ink">{money(offer)}</span>
        </div>
        <input
          type="range"
          min={Math.round(candidate.askingSalary * 0.6)}
          max={Math.round(candidate.askingSalary * 1.5)}
          step={50000}
          value={offer}
          onChange={(e) => setOffer(Number(e.target.value))}
          className="w-full accent-[var(--team)]"
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-faint">
          <span>Lowball</span>
          <span>Above ask</span>
        </div>
      </div>

      <Button
        size="sm"
        variant="team"
        className="mt-3 w-full"
        disabled={candidate.interest < 15}
        onClick={() => onHire(offer, schemes.length ? scheme : undefined)}
      >
        {candidate.interest < 15 ? 'Not interested' : `Offer ${money(offer)}`}
      </Button>
    </Card>
  )
}

function StaffCard({
  member,
  actionLabel,
  onAction,
}: {
  member: StaffMember
  actionLabel: string
  onAction: () => void
}) {
  const tier = member.rating >= 85 ? 'gold' : member.rating >= 75 ? 'info' : 'neutral'
  const learned = learnedBias(member)
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ink text-white">
          <UserPlus size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-lg font-700 uppercase leading-none text-ink">
              {member.name}
            </span>
            {member.rating >= 88 && <Star size={14} className="shrink-0 text-gold" fill="#c99a2e" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="team">{member.role}</Badge>
            <Badge tone={tier as 'gold' | 'info' | 'neutral'}>{member.rating} OVR</Badge>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Age" value={member.age} />
        <MiniStat label="Scheme" value={member.scheme.split(' ')[0]} />
        <MiniStat label="Salary" value={money(member.annual)} />
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="label">Specialty</span>
          <span className="font-cond text-xs font-600 text-ink-2">{member.specialty}</span>
        </div>
        <RatingBar value={member.rating} color={member.rating >= 85 ? '#c99a2e' : 'var(--team)'} />
      </div>

      {learned.label && (
        <div className="mt-3 rounded-lg bg-surface-2 p-2.5 text-[11px] leading-snug text-ink-2">
          <span className="font-cond font-700 uppercase text-muted">Scouting read · </span>
          {learned.label} <span className="text-faint">({learned.samples} calls)</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="font-cond text-xs text-muted">{member.contractYears} yr contract</span>
        <Button size="sm" variant={actionLabel === 'Hire' ? 'team' : 'default'} onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-surface-2 py-1.5">
      <div className="label !text-[9px]">{label}</div>
      <div className="font-cond text-sm font-700 tnum text-ink">{value}</div>
    </div>
  )
}
