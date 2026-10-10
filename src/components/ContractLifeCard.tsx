import { useState } from 'react'
import { AlertTriangle, Handshake, Tag, Ticket } from 'lucide-react'
import { money } from '../lib/format'
import { canSignFreeAgents } from '../game/engine/career'
import {
  fifthYearOptionValue,
  optionEligible,
  openHoldouts,
  tagEligible,
  tagSalary,
  tagUsed,
} from '../game/engine/contractLife'
import { marketAsk } from '../game/engine/negotiation'
import { cultureDiscountFor } from '../game/engine/culture'
import { getStatsDb, useGame, useWorld } from '../store/gameStore'
import type { Player } from '../game/types'
import { Badge, Card, ConfirmSheet, OverflowMenu, RatingTile, SectionTitle, type Consequence, type MenuItem } from '../ui/kit'

/**
 * FUTURES 12: the offseason contract-life card — holdouts, franchise/transition
 * tags and Round-1 fifth-year options for the user's own club.
 *
 * It is deliberately user-only: the AI never holds out, tags or exercises an
 * option, so nothing here changes an AI-vs-AI result. Every button is an explicit
 * opt-in decision, and simply ignoring the card changes nothing.
 *
 * D4: neutral option styling; Pay, Tag and Exercise route through a ConfirmSheet.
 */
type Pending =
  | { kind: 'pay'; player: Player; amount: number }
  | { kind: 'holdoutTag'; player: Player; amount: number }
  | { kind: 'tag'; player: Player; tag: 'franchise' | 'transition'; amount: number }
  | { kind: 'option'; player: Player; amount: number }

export function ContractLifeCard({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const tagPlayer = useGame((s) => s.tagPlayer)
  const decideFifthYearOption = useGame((s) => s.decideFifthYearOption)
  const resolveHoldout = useGame((s) => s.resolveHoldout)
  const [pending, setPending] = useState<Pending | null>(null)

  // Only the front office that holds the pen sees the decisions, in the offseason.
  if (league.phase !== 'offseason' || !canSignFreeAgents(career)) return null

  const roster = league.roster[career.teamId] ?? []
  const holdouts = openHoldouts(roster, league.season)
  const taggable = roster.filter(tagEligible).sort((a, b) => b.ovr - a.ovr)
  const optionable = roster.filter((p) => optionEligible(p, league.season)).sort((a, b) => b.ovr - a.ovr)
  const franchiseUsed = tagUsed(roster, 'franchise', league.season)
  const transitionUsed = tagUsed(roster, 'transition', league.season)
  // One tag per club per offseason, of either kind.
  const tagApplied = franchiseUsed || transitionUsed

  if (!holdouts.length && !taggable.length && !optionable.length) return null

  const pendingView = (pd: Pending): { title: string; subtitle: string; confirm: string; consequences: Consequence[]; onConfirm: () => void } => {
    switch (pd.kind) {
      case 'pay':
        return {
          title: `Pay ${pd.player.name}?`,
          subtitle: `${pd.player.pos} · age ${pd.player.age} · ends the holdout for good`,
          confirm: `Pay ${money(pd.amount)}`,
          consequences: [
            { label: 'This year’s pay', value: money(pd.amount), tone: 'warn' },
            { label: 'Holdout', value: 'Ends for good', tone: 'win' },
            { label: 'Cap hit now', value: money(pd.player.contract.capHit) },
          ],
          onConfirm: () => resolveHoldout(pd.player.id, 'pay'),
        }
      case 'holdoutTag':
        return {
          title: `Tag ${pd.player.name}?`,
          subtitle: `${pd.player.pos} · final year · uses your one tag this season`,
          confirm: `Tag · ${money(pd.amount)}`,
          consequences: [
            { label: 'Tag salary', value: money(pd.amount), tone: 'warn' },
            { label: 'Holdout', value: 'Keeps him one more year', tone: 'win' },
            { label: 'Tag budget', value: 'Your only tag this season' },
          ],
          onConfirm: () => resolveHoldout(pd.player.id, 'tag'),
        }
      case 'tag':
        return {
          title: `${pd.tag === 'franchise' ? 'Franchise' : 'Transition'} tag ${pd.player.name}?`,
          subtitle: `${pd.player.pos} · age ${pd.player.age} · adds one guaranteed year`,
          confirm: `Tag · ${money(pd.amount)}`,
          consequences: [
            { label: 'Tag salary', value: money(pd.amount), tone: 'warn' },
            { label: 'Guaranteed', value: 'One extra year', tone: 'win' },
            { label: 'Tag budget', value: 'Your only tag this season' },
          ],
          onConfirm: () => tagPlayer(pd.player.id, pd.tag),
        }
      case 'option':
        return {
          title: `Exercise ${pd.player.name}’s option?`,
          subtitle: 'Round-1 fifth-year option · adds a guaranteed year',
          confirm: `Exercise · ${money(pd.amount)}`,
          consequences: [
            { label: 'Option year', value: money(pd.amount), tone: 'warn' },
            { label: 'Guaranteed', value: 'One extra year', tone: 'win' },
            { label: 'Declining', value: 'He reaches free agency after this season' },
          ],
          onConfirm: () => decideFifthYearOption(pd.player.id, true),
        }
    }
  }

  return (
    <Card className={className}>
      <SectionTitle right={<Badge tone="neutral">Offseason</Badge>}>
        <span className="flex items-center gap-2">
          <Handshake size={17} className="text-[var(--team-accent-text)]" aria-hidden /> Contracts &amp; Holdouts
        </span>
      </SectionTitle>

      {holdouts.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-warn" aria-hidden />
            <span className="label">Holdouts</span>
          </div>
          <div className="space-y-2">
            {holdouts.map((p) => {
              const disc = cultureDiscountFor(league, getStatsDb(), career.teamId, p)
              const pay = marketAsk(p, league.season, career.skills.negotiation, disc.pct)
              const items: MenuItem[] = [
                {
                  id: 'pay',
                  label: `Pay ${money(pay)}…`,
                  description: 'Ends the holdout for good',
                  onSelect: () => setPending({ kind: 'pay', player: p, amount: pay }),
                },
                {
                  id: 'tag',
                  label: 'Tag him…',
                  description:
                    p.contract.years !== 1
                      ? 'Tags only apply in his final year'
                      : tagApplied
                        ? 'Your tag is already used this season'
                        : 'Keeps him one more year',
                  disabled: p.contract.years !== 1 || tagApplied,
                  onSelect: () =>
                    setPending({ kind: 'holdoutTag', player: p, amount: tagSalary(league.players, p, 'franchise') }),
                },
                { id: 'trade', label: 'Shop him', description: 'List him for trade', onSelect: () => resolveHoldout(p.id, 'trade') },
                {
                  id: 'report',
                  label: 'Let him report',
                  description: 'Costs morale; the AI never holds out',
                  onSelect: () => resolveHoldout(p.id, 'report'),
                },
              ]
              return (
                <div key={p.id} className="rounded-[var(--r-md)] border border-warn/30 bg-warn-soft p-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <RatingTile value={p.ovr} size="md" tierWord label="Overall" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-600 text-ink">
                        {p.name} · {p.pos} · age {p.age}
                      </div>
                      <div className="text-label text-muted">
                        {p.contract.years} yr{p.contract.years === 1 ? '' : 's'} left · underpaid:{' '}
                        {money(p.contract.annual)}/yr vs {money(pay)}/yr ask
                      </div>
                    </div>
                    <OverflowMenu items={items} label={`Holdout actions for ${p.name}`} size="sm" />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-label text-muted">
            Paying ends it for good. Tagging keeps him one more year. Trading shops him. Letting him report costs morale — the AI never holds out.
          </p>
        </div>
      )}

      {taggable.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Tag size={13} className="text-[var(--team-accent-text)]" aria-hidden />
            <span className="label">Franchise &amp; transition tags</span>
            {tagApplied && <Badge tone="neutral">{franchiseUsed ? 'Franchise tag used' : 'Transition tag used'}</Badge>}
          </div>
          <div className="space-y-2">
            {taggable.map((p) => {
              const fr = tagSalary(league.players, p, 'franchise')
              const tr = tagSalary(league.players, p, 'transition')
              const items: MenuItem[] = [
                {
                  id: 'franchise',
                  label: `Franchise … ${money(fr)}`,
                  description: 'Top-5 cap-hit rate at his position, or 120% of salary',
                  disabled: tagApplied,
                  onSelect: () => setPending({ kind: 'tag', player: p, tag: 'franchise', amount: fr }),
                },
                {
                  id: 'transition',
                  label: `Transition … ${money(tr)}`,
                  description: 'Slightly below the franchise rate',
                  disabled: tagApplied,
                  onSelect: () => setPending({ kind: 'tag', player: p, tag: 'transition', amount: tr }),
                },
              ]
              return (
                <div key={p.id} className="rounded-[var(--r-md)] border border-line bg-surface-2 p-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <RatingTile value={p.ovr} size="md" tierWord label="Overall" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-600 text-ink">
                        {p.name} · {p.pos} · age {p.age}
                      </div>
                      <div className="text-label text-muted">
                        Final year · {money(p.contract.annual)}/yr · adds one guaranteed year
                      </div>
                    </div>
                    <OverflowMenu items={items} label={`Tag options for ${p.name}`} size="sm" />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-label text-muted">
            One tag per season (franchise or transition). The tag guarantees one extra year at the position&apos;s top-5 cap-hit rate, or 120% of his prior salary.
          </p>
        </div>
      )}

      {optionable.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Ticket size={13} className="text-[var(--team-accent-text)]" aria-hidden />
            <span className="label">Fifth-year options · Round 1</span>
          </div>
          <div className="space-y-2">
            {optionable.map((p) => {
              const value = fifthYearOptionValue(league.players, p)
              const items: MenuItem[] = [
                {
                  id: 'exercise',
                  label: `Exercise … ${money(value)}`,
                  description: 'Adds a guaranteed option year',
                  onSelect: () => setPending({ kind: 'option', player: p, amount: value }),
                },
                {
                  id: 'decline',
                  label: 'Decline',
                  description: 'He reaches free agency after this season',
                  onSelect: () => decideFifthYearOption(p.id, false),
                },
              ]
              return (
                <div key={p.id} className="rounded-[var(--r-md)] border border-line bg-surface-2 p-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <RatingTile value={p.ovr} size="md" tierWord label="Overall" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-600 text-ink">
                        {p.name} · {p.pos} · age {p.age}
                      </div>
                      <div className="text-label text-muted">Rookie deal, final year · option {money(value)}</div>
                    </div>
                    <OverflowMenu items={items} label={`Option actions for ${p.name}`} size="sm" />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-label text-muted">
            Exercising adds a guaranteed option year; declining lets him reach free agency after this season.
          </p>
        </div>
      )}

      {pending && (
        <ConfirmSheet
          open
          onClose={() => setPending(null)}
          eyebrow="Contract move"
          title={pendingView(pending).title}
          subtitle={pendingView(pending).subtitle}
          consequences={pendingView(pending).consequences}
          confirmLabel={pendingView(pending).confirm}
          ledgerNote={null}
          onConfirm={() => {
            pendingView(pending).onConfirm()
            setPending(null)
          }}
        />
      )}
    </Card>
  )
}
