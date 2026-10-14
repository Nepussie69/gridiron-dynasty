import { useState } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { useGame, useWorld } from '../store/gameStore'
import { useAccessLevel, usePhone } from '../ui/hooks'
import { Badge, Button, Card, PageHeader, SegmentedControl, Sheet } from '../ui/kit'
import type { StaffOffer } from '../game/engine/staffMarket'

type CatTone = 'neutral' | 'loss'

/** Category chips are neutral by design; only an injury is a real problem (red). */
const CAT_TONE: Record<string, CatTone> = {
  Injury: 'loss',
}

type InboxItem = ReturnType<typeof useWorld>['news'][number]

/**
 * FUTURES #28 §7/§9: match a news item to an open staff offer. Re-sign items are
 * filed under Career, poach offers under League; both name the coach in the headline.
 */
function offerFor(item: InboxItem, offers: StaffOffer[]): StaffOffer | undefined {
  return offers.find(
    (o) =>
      (o.kind === 'resign' ? item.category === 'Career' : item.category === 'League') &&
      item.headline.includes(o.name),
  )
}

/** The re-sign / let-walk (or match / let-go) actions for an open staff offer. */
function StaffOfferActions({ offer }: { offer: StaffOffer }) {
  const resignStaff = useGame((s) => s.resignStaff)
  const matchStaffOffer = useGame((s) => s.matchStaffOffer)
  const level = useAccessLevel('staff')
  const canAct = level === 'decide'
  const money1 = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`

  if (!canAct) {
    return (
      <div className="mt-5 rounded-[var(--r-md)] border border-line bg-surface-2 p-3 text-small text-muted">
        {offer.kind === 'resign' ? 'Contract expiring' : 'Rival offer'} · {offer.message}
        <br />
        The GM handles staff moves at your rung.
      </div>
    )
  }

  return (
    <div className="mt-5 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
      <div className="label mb-1.5">{offer.kind === 'resign' ? 'Contract expiring' : 'Rival offer'}</div>
      <p className="text-small text-ink-2">{offer.message}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {offer.kind === 'resign' ? (
          <>
            <Button size="sm" onClick={() => resignStaff(offer.id, true)}>
              Re-sign · {money1(offer.annual)}/yr
            </Button>
            <Button size="sm" variant="secondary" onClick={() => resignStaff(offer.id, false)}>
              Let {offer.name.split(' ').slice(-1)[0]} walk
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => matchStaffOffer(offer.id, true)}>
              Match · {money1(offer.annual)}/yr
            </Button>
            <Button size="sm" variant="secondary" onClick={() => matchStaffOffer(offer.id, false)}>
              Let him go
            </Button>
          </>
        )}
      </div>
      {offer.kind === 'poach' && (
        <p className="mt-2 text-small text-muted">
          {offer.lateral
            ? 'A lateral move: matching with a raise of 15% or more blocks it.'
            : 'A promotion — you cannot block it. Matching only softens the exit.'}
        </p>
      )}
      {offer.kind === 'resign' && offer.annual > 0 && (
        <p className="mt-2 text-small text-muted tnum">
          His deal is up. Re-sign at {money(offer.annual)}/yr, or let him walk into the market.
        </p>
      )}
    </div>
  )
}

function MessageDetail({ item, season, offers }: { item: InboxItem; season: number; offers: StaffOffer[] }) {
  const offer = offerFor(item, offers)
  return (
    <>
      <div className="mb-4 flex items-center gap-3 border-b border-line pb-4">
        <Badge tone={CAT_TONE[item.category] ?? 'neutral'}>{item.category}</Badge>
        <span className="text-label text-muted">
          Week {item.week} · {season} Season
        </span>
      </div>
      <h2 className="font-display text-[26px] font-800 italic uppercase leading-tight tracking-[0.005em] text-ink sm:text-[32px]">
        {item.headline}
      </h2>
      <p className="mt-4 max-w-2xl text-body leading-relaxed text-ink-2">{item.body}</p>
      {offer && <StaffOfferActions offer={offer} />}
    </>
  )
}

export function Inbox() {
  const league = useWorld()
  const readNews = useGame((s) => s.readNews)
  const markRead = useGame((s) => s.markRead)
  const markAllNewsRead = useGame((s) => s.markAllNewsRead)
  const career = useGame((s) => s.career)!
  const phone = usePhone()
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const items = league.news
  const shown = filter === 'unread' ? items.filter((i) => !readNews[i.id]) : items
  // Phone is a master list; the detail opens in a sheet. Desktop keeps a detail pane.
  const open = items.find((i) => i.id === openId) ?? (phone ? null : items[0])
  const isRead = (id: string) => readNews[id]
  const unread = items.filter((i) => !isRead(i.id)).length

  // Reading a message marks it read (never on mount).
  const openMessage = (id: string) => {
    setOpenId(id)
    markRead(id)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Career"
        title="Inbox"
        subtitle={`${unread} unread. Offers, press, transactions, and notes from ownership.`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="Message filter"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'All' },
                { id: 'unread', label: 'Unread' },
              ]}
            />
            <Button size="sm" variant="secondary" disabled={!unread} onClick={markAllNewsRead}>
              Mark all read
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card pad={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="label">All Messages</span>
            <span className="font-cond text-label font-700 uppercase tracking-[0.07em] text-muted tnum">{shown.length}</span>
          </div>
          <div className="max-h-[560px] divide-y divide-line/60 overflow-y-auto max-lg:max-h-none">
            {shown.length === 0 && <div className="px-4 py-10 text-center text-body text-muted">Nothing unread.</div>}
            {shown.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openMessage(n.id)}
                className={cn(
                  'motion flex w-full items-start gap-3 px-4 py-3 text-left',
                  openId === n.id ? 'bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]' : 'hover:bg-surface-2',
                )}
              >
                <span
                  aria-hidden
                  className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', isRead(n.id) ? 'bg-transparent' : 'bg-brand')}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={CAT_TONE[n.category] ?? 'neutral'}>{n.category}</Badge>
                    <span className="text-label text-faint">Week {n.week}</span>
                  </div>
                  <div className={cn('mt-1 text-body leading-snug', isRead(n.id) ? 'font-500 text-ink-2' : 'font-700 text-ink')}>
                    {n.headline}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-small text-muted">{n.body}</div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {!phone && open && (
          <Card>
            <MessageDetail item={open} season={career.season} offers={career.staffOffers ?? []} />
          </Card>
        )}
      </div>

      {phone && (
        <Sheet
          open={!!open}
          onClose={() => setOpenId(null)}
          eyebrow={open ? `${open.category} · Week ${open.week}` : undefined}
          title={open?.headline ?? ''}
        >
          {open && <MessageDetail item={open} season={career.season} offers={career.staffOffers ?? []} />}
        </Sheet>
      )}
    </div>
  )
}
