// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #26 P3a — Coach playcalling, the Game Plan card.
//
// "Who calls it" per situation, the per-bucket call sheet (offense plays and
// defensive calls, order-weighted by the coordinator), and the audibles rule.
// Every edit is a pure function in ./playCallingUi, normalised and handed to
// `gameStore.setPlayCalling` — an all-default plan clears the stored plan.
//
// Scope follows the other Game Plan cards: an HC edits both sides, a
// coordinator only his own, and a career with no call authority sees nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { ArrowUp, ClipboardList, Plus, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { capabilities } from '../game/engine/capabilities'
import { BUCKET_LABEL, BUCKETS, DEF_CALL_LABEL, type Bucket } from '../game/engine/decisions'
import { CALL_SITUATIONS, formationOf, needsFullback, type Caller, type PlayCallingPlan } from '../game/engine/playcalling'
import { RouteDiagram } from './RouteDiagram'
import { useGame, useWorld } from '../store/gameStore'
import {
  Badge,
  Button,
  Card,
  Chip,
  IconButton,
  OptionCard,
  OptionGroup,
  SegmentedControl,
  Tabs,
  type SegmentOption,
} from '../ui/kit'
import { Sheet } from '../ui/Overlay'
import {
  AUDIBLE_HINT,
  AUDIBLE_LABEL,
  AUDIBLE_MODES,
  DEF_CALLS,
  DEF_SHORT,
  FORMATION_GROUPS,
  SHEET_MAX_DEF,
  SHEET_MAX_OFF,
  SITUATION_LABEL,
  addOffPlay,
  checkCandidates,
  checkForPlay,
  checkOverride,
  clubHasFullback,
  editableSides,
  moveOffPlay,
  playsOfFormation,
  removeOffPlay,
  setAudibles,
  setCaller,
  setCheck,
  sheetDef,
  sheetOff,
  summaryOf,
  toCommit,
  toggleDefCall,
  whoCalls,
} from './playCallingUi'

const CALLER_OPTIONS: SegmentOption<Caller>[] = [
  { id: 'me', label: 'Me', title: 'You make the call in this situation' },
  { id: 'staff', label: 'Staff', title: 'Your coordinator makes the call' },
]

/** The tiny in-chip affordances (move up / remove). */
const CHIP_ACTION =
  'motion rounded-full p-0.5 text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 pointer-coarse:min-h-11 pointer-coarse:min-w-11'

export function PlayCallingCard({ disabled = false }: { disabled?: boolean }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const setPlayCalling = useGame((s) => s.setPlayCalling)
  const [sheetTarget, setSheetTarget] = useState<{ side: 'off' | 'def'; bucket: Bucket } | null>(null)
  const [tab, setTab] = useState(FORMATION_GROUPS[0]?.formation ?? '')
  const [checkOpen, setCheckOpen] = useState<string | null>(null)

  const scope = capabilities(career).planScope
  const sides = editableSides(scope, career.unitFocus)
  const plan: PlayCallingPlan | undefined = career.playCalling
  const hasFb = clubHasFullback(league.roster[career.teamId])
  // A coordinator sees the other side, but cannot touch it.
  const locked = (side: 'off' | 'def') => disabled || !sides[side]
  const commit = (next: PlayCallingPlan) => {
    if (!disabled) setPlayCalling(toCommit(next))
  }

  if (scope === 'none') return null

  const activeTab = FORMATION_GROUPS.some((g) => g.formation === tab) ? tab : FORMATION_GROUPS[0]?.formation ?? ''
  const sheet = sheetTarget
  const offPlays = sheet ? sheetOff(plan, sheet.bucket) : []
  const defCalls = sheet ? sheetDef(plan, sheet.bucket) : []

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Play Calling</h3>
      </div>
      <p className="mb-3 text-small text-muted">{summaryOf(plan)}</p>

      {/* (1) Who calls it ─────────────────────────────────────────────────── */}
      <div className="label mb-1.5">Who calls it</div>
      <p className="mb-2 text-small leading-snug text-muted">
        In “My sheet” call mode the game stops for you only on Me rows (plus key moments); everything else your
        coordinators call.
      </p>
      <div className="hidden gap-3 pb-1 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <span className="label">Situation</span>
        <span className="label text-center">Offense</span>
        <span className="label text-center">Defense</span>
      </div>
      <div>
        {CALL_SITUATIONS.map((sit) => (
          <div
            key={sit}
            className="grid gap-1 border-t border-line/60 py-1.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3"
          >
            <span className="font-cond text-label font-700 uppercase tracking-wide text-ink-2">
              {SITUATION_LABEL[sit]}
            </span>
            <CallerCell
              label="Offense"
              value={whoCalls(plan, 'off', sit)}
              disabled={locked('off')}
              onChange={(who) => commit(setCaller(plan, sides, 'off', sit, who))}
            />
            <CallerCell
              label="Defense"
              value={whoCalls(plan, 'def', sit)}
              disabled={locked('def')}
              onChange={(who) => commit(setCaller(plan, sides, 'def', sit, who))}
            />
          </div>
        ))}
      </div>
      {scope === 'own-side' && (
        <p className="mt-2 text-small text-muted">
          You keep the {sides.off ? 'offensive' : 'defensive'} call sheet — the other side belongs to your counterpart.
        </p>
      )}

      {/* (2) My sheet ─────────────────────────────────────────────────────── */}
      <div className="mt-5 border-t border-line pt-3">
        <div className="label mb-1.5">My sheet</div>
        <p className="mb-2 text-small leading-snug text-muted">
          The coordinator calls from these when you hand a situation over. Order matters — the first play is weighted
          4:3:2:1 down the list.
        </p>
        <div>
          {BUCKETS.map((b) => {
            const plays = sheetOff(plan, b)
            const calls = sheetDef(plan, b)
            const offFull = plays.length >= SHEET_MAX_OFF
            const defFull = calls.length >= SHEET_MAX_DEF
            return (
              <div key={b} className="border-t border-line/60 py-2 first:border-t-0">
                <div className="mb-1 font-cond text-label font-700 uppercase tracking-wide text-ink-2">
                  {BUCKET_LABEL[b]}
                </div>

                {/* Offense row */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="label w-14 shrink-0">Offense</span>
                  {plays.map((name, i) => (
                    <Chip key={name} className="gap-0.5 pl-2 pr-0.5">
                      <span className="flex items-center gap-1">
                        {name}
                        {needsFullback(name) && !hasFb && (
                          <Badge tone="warn">No FB</Badge>
                        )}
                      </span>
                      <button
                        type="button"
                        aria-label={`Move ${name} up the sheet`}
                        title="Move up"
                        disabled={locked('off') || i === 0}
                        onClick={() => commit(moveOffPlay(plan, sides, b, name, -1))}
                        className={CHIP_ACTION}
                      >
                        <ArrowUp size={11} aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${name} from the sheet`}
                        title="Remove"
                        disabled={locked('off')}
                        onClick={() => commit(removeOffPlay(plan, sides, b, name))}
                        className={cn(CHIP_ACTION, 'hover:text-loss')}
                      >
                        <X size={11} aria-hidden />
                      </button>
                    </Chip>
                  ))}
                  {!plays.length && <span className="text-small text-muted">Staff call</span>}
                  <IconButton
                    label={`Add a play to the ${BUCKET_LABEL[b]} offense sheet`}
                    size="sm"
                    disabled={locked('off') || offFull}
                    onClick={() => {
                      setCheckOpen(null)
                      setTab(plays.length ? formationOf(plays[0]) : activeTab)
                      setSheetTarget({ side: 'off', bucket: b })
                    }}
                  >
                    <Plus size={14} />
                  </IconButton>
                </div>

                {/* Defense row */}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="label w-14 shrink-0">Defense</span>
                  {calls.map((c) => (
                    <Chip key={c} className="gap-0.5 pl-2 pr-0.5">
                      <span>{DEF_SHORT[c]}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${DEF_CALL_LABEL[c]} from the sheet`}
                        title="Remove"
                        disabled={locked('def')}
                        onClick={() => commit(toggleDefCall(plan, sides, b, c))}
                        className={cn(CHIP_ACTION, 'hover:text-loss')}
                      >
                        <X size={11} aria-hidden />
                      </button>
                    </Chip>
                  ))}
                  {!calls.length && <span className="text-small text-muted">Staff call</span>}
                  <IconButton
                    label={`Add a call to the ${BUCKET_LABEL[b]} defense sheet`}
                    size="sm"
                    disabled={locked('def') || defFull}
                    onClick={() => setSheetTarget({ side: 'def', bucket: b })}
                  >
                    <Plus size={14} />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* (3) Audibles ─────────────────────────────────────────────────────── */}
      <div className="mt-5 border-t border-line pt-3">
        <div className="label mb-1.5">Audibles</div>
        <SegmentedControl
          label="Audibles"
          disabled={disabled}
          value={plan?.audibles ?? 'off'}
          onChange={(mode) => commit(setAudibles(plan, sides, mode))}
          options={AUDIBLE_MODES.map((mode) => ({
            id: mode,
            label: AUDIBLE_LABEL[mode],
            title: AUDIBLE_HINT[mode],
          }))}
        />
        <ul className="mt-2 space-y-0.5">
          {AUDIBLE_MODES.map((mode) => (
            <li key={mode} className={cn('text-small', mode === (plan?.audibles ?? 'off') ? 'text-ink-2' : 'text-muted')}>
              <strong className="font-600">{AUDIBLE_LABEL[mode]}:</strong> {AUDIBLE_HINT[mode]}
            </li>
          ))}
        </ul>
      </div>

      {/* The sheet picker ─────────────────────────────────────────────────── */}
      <Sheet
        open={!!sheet}
        onClose={() => {
          setSheetTarget(null)
          setCheckOpen(null)
        }}
        eyebrow="My sheet"
        title={sheet ? `${BUCKET_LABEL[sheet.bucket]} · ${sheet.side === 'off' ? 'Offense' : 'Defense'}` : ''}
        subtitle={
          sheet?.side === 'off'
            ? 'Pick up to four plays for this situation — the top of the list is called most.'
            : 'Pick up to three calls for this situation.'
        }
      >
        {sheet?.side === 'off' && (
          <>
            <Tabs
              label="Formation"
              tabs={FORMATION_GROUPS.map((g) => ({ id: g.formation, label: g.formation }))}
              value={activeTab}
              onChange={setTab}
            />
            <div className="mt-3">
              <OptionGroup label={`${activeTab} plays`} className="sm:grid-cols-2">
                {playsOfFormation(activeTab).map((p) => {
                  const on = offPlays.includes(p.name)
                  const noFb = needsFullback(p.name) && !hasFb
                  return (
                    <OptionCard
                      key={p.name}
                      selected={on}
                      disabled={locked('off') || (!on && offPlays.length >= SHEET_MAX_OFF)}
                      onSelect={() =>
                        commit(
                          on
                            ? removeOffPlay(plan, sides, sheet.bucket, p.name)
                            : addOffPlay(plan, sides, sheet.bucket, p.name),
                        )
                      }
                      title={
                        <span className="flex flex-wrap items-center gap-1.5">
                          {p.name}
                          <span className="font-cond text-label uppercase tracking-wide text-muted">{p.type}</span>
                          {noFb && <Badge tone="warn">No FB</Badge>}
                        </span>
                      }
                      description={
                        <>
                          <RouteDiagram name={p.name} className="h-12 w-full rounded-[var(--r-sm)]" />
                          <span className="mt-1 block text-small text-muted">{p.description}</span>
                        </>
                      }
                      meta={on ? 'On sheet' : undefined}
                    />
                  )
                })}
              </OptionGroup>
            </div>
            {!hasFb && (
              <p className="mt-3 text-small leading-snug text-muted">
                No fullback on your depth chart: plays from an I-form, Strong/Weak I or the goal line fall back to the
                staff&rsquo;s call.
              </p>
            )}

            {offPlays.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <div className="label mb-1.5">Check-with-me</div>
                <div className="space-y-1.5">
                  {offPlays.map((name) => {
                    const over = checkOverride(plan, name)
                    const cur = checkForPlay(plan, name)
                    const cands = checkCandidates(name).length
                    return (
                      <div key={name} className="rounded-[var(--r-md)] bg-surface-2 px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-small font-600 text-ink-2">{name}</span>
                          <span className="text-small text-muted">
                            check → <strong className="text-ink-2">{cur ?? 'none'}</strong>
                          </span>
                          {!over && <Badge tone="neutral">Default</Badge>}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto"
                            disabled={locked('off') || cands === 0}
                            onClick={() => setCheckOpen((o) => (o === name ? null : name))}
                          >
                            {checkOpen === name ? 'Done' : 'Change'}
                          </Button>
                        </div>
                        {checkOpen === name && (
                          <OptionGroup label={`Check for ${name}`} className="mt-2 sm:grid-cols-2">
                            <OptionCard
                              selected={!over}
                              disabled={locked('off')}
                              onSelect={() => commit(setCheck(plan, sides, name, undefined))}
                              title="Default"
                              description={cur ? `Check to ${cur}` : 'No check available'}
                            />
                            {checkCandidates(name).map((q) => (
                              <OptionCard
                                key={q.name}
                                selected={over === q.name}
                                disabled={locked('off')}
                                onSelect={() => commit(setCheck(plan, sides, name, q.name))}
                                title={q.name}
                                description={q.description}
                                meta={q.type}
                              />
                            ))}
                          </OptionGroup>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {sheet?.side === 'def' && (
          <>
            <OptionGroup label="Defensive calls" className="sm:grid-cols-2">
              {DEF_CALLS.map((c) => {
                const on = defCalls.includes(c)
                return (
                  <OptionCard
                    key={c}
                    selected={on}
                    disabled={locked('def') || (!on && defCalls.length >= SHEET_MAX_DEF)}
                    onSelect={() => commit(toggleDefCall(plan, sides, sheet.bucket, c))}
                    title={DEF_CALL_LABEL[c]}
                  />
                )
              })}
            </OptionGroup>
            <p className="mt-3 text-small leading-snug text-muted">
              The coordinator calls these in order — the first is weighted heaviest (4:3:2).
            </p>
          </>
        )}
      </Sheet>
    </Card>
  )
}

/** One Me/Staff cell of the "Who calls it" grid. */
function CallerCell({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: Caller
  disabled: boolean
  onChange: (who: Caller) => void
}) {
  return (
    <div className="mt-1 flex items-center gap-2 sm:mt-0 sm:justify-end">
      <span className="label w-14 shrink-0 sm:hidden">{label}</span>
      <SegmentedControl
        label={`${label} caller`}
        size="sm"
        disabled={disabled}
        value={value}
        onChange={onChange}
        options={CALLER_OPTIONS}
      />
    </div>
  )
}
