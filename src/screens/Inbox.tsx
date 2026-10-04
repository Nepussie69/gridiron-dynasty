import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader } from '../ui/kit'

const CAT_TONE: Record<string, 'gold' | 'loss' | 'info' | 'win' | 'neutral' | 'warn'> = {
  Owner: 'gold',
  Injury: 'loss',
  Roster: 'info',
  Draft: 'info',
  Recruiting: 'info',
  Trade: 'warn',
  League: 'neutral',
  Staff: 'neutral',
}

export function Inbox() {
  const league = useWorld()
  const readNews = useGame((s) => s.readNews)
  const markRead = useGame((s) => s.markRead)
  const career = useGame((s) => s.career)!
  const [openId, setOpenId] = useState<string | null>(league.news[0]?.id ?? null)

  const items = league.news
  const open = items.find((i) => i.id === openId) ?? items[0]
  const isRead = (id: string) => readNews[id]

  useEffect(() => {
    if (open) markRead(open.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id])

  const unread = items.filter((i) => !isRead(i.id)).length

  return (
    <div>
      <PageHeader
        eyebrow="Club"
        title="Inbox"
        subtitle={`${unread} unread. Offers, press, transactions, and notes from ownership.`}
      />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card pad={false} className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5">
            <span className="label">All Messages</span>
          </div>
          <div className="max-h-[560px] divide-y divide-line/60 overflow-y-auto">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => setOpenId(n.id)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition',
                  openId === n.id ? 'bg-[var(--team-soft)]' : 'hover:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    isRead(n.id) ? 'bg-transparent' : 'bg-[var(--team)]',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={CAT_TONE[n.category] ?? 'neutral'}>{n.category}</Badge>
                    <span className="text-[11px] text-faint">Week {n.week}</span>
                  </div>
                  <div className={cn('mt-1 text-sm leading-snug', isRead(n.id) ? 'font-500 text-ink-2' : 'font-700 text-ink')}>
                    {n.headline}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-xs text-muted">{n.body}</div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {open && (
          <Card>
            <div className="mb-4 flex items-center gap-3 border-b border-line pb-4">
              <Badge tone={CAT_TONE[open.category] ?? 'neutral'}>{open.category}</Badge>
              <span className="text-xs text-muted">
                Week {open.week} · {career.season} Season
              </span>
            </div>
            <h2 className="font-display text-3xl font-700 uppercase leading-tight tracking-tight text-ink">
              {open.headline}
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-2">{open.body}</p>

            <div className="mt-6 rounded-xl bg-surface-2 p-4">
              <div className="label mb-2">Suggested Actions</div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="team">Review roster impact</Badge>
                <Badge tone="info">Consult staff</Badge>
                <Badge tone="neutral">Update depth chart</Badge>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
