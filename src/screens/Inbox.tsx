import { useState } from 'react'
import { cn } from '../lib/cn'
import { useGame, useWorld } from '../store/gameStore'
import { usePhone } from '../ui/hooks'
import { Badge, Button, Card, PageHeader, SegmentedControl, Sheet } from '../ui/kit'

type CatTone = 'neutral' | 'loss'

/** Category chips are neutral by design; only an injury is a real problem (red). */
const CAT_TONE: Record<string, CatTone> = {
  Injury: 'loss',
}

type InboxItem = ReturnType<typeof useWorld>['news'][number]

function MessageDetail({ item, season }: { item: InboxItem; season: number }) {
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
            <MessageDetail item={open} season={career.season} />
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
          {open && <MessageDetail item={open} season={career.season} />}
        </Sheet>
      )}
    </div>
  )
}
