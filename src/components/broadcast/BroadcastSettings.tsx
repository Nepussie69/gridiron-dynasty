// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B7): the settings rows for the shell's Settings sheet.
// Built only from kit parts (SegmentedControl sm + the sheet's row class, which
// is passed in) and the design tokens — no hard-coded colours.
// ─────────────────────────────────────────────────────────────────────────────
import { SegmentedControl } from '../../ui/Controls'
import { cn } from '../../lib/cn'
import { autoQualityHint, useLiveView, type Fallback } from './liveView'
import { REPLAY_REASON_IDS, type ReplayReasonId } from './replay'
import { deviceKey, setCameraAngle, setDrawings, setGameView, setQbCone, setQualitySetting, setReplayMode, setReplayTypes, useViewSettings } from './viewSettings'

const FALLBACK_NOTE: Record<Exclude<Fallback, null>, string> = {
  'no-canvas': 'This device has no 2D canvas — using the top-down view.',
  'render-error': 'The 2.5D view hit a problem — using the top-down view for now.',
  'too-slow': 'This device could not keep up — using the top-down view.',
}

/**
 * The 'custom' replay reasons, in the fixed REPLAY_REASON_IDS order, each with a
 * one-line hint. The kit has no Checkbox / Switch primitive, so these are the
 * repo's checkbox rows (the pattern already used by the deadline panel): a
 * native input styled with the design tokens (accent = team colour), the label
 * as the accessible name and the hint as the description.
 */
const CUSTOM_TYPES: { id: ReplayReasonId; label: string; hint: string }[] = [
  { id: 'touchdown', label: 'Touchdowns', hint: 'Runs, passes, returns and defensive scores' },
  { id: 'turnover', label: 'Turnovers', hint: 'Interceptions, lost fumbles and muffed kicks' },
  { id: 'safety', label: 'Safeties', hint: 'The defence pins the offence in its own end zone' },
  { id: 'bigGain', label: 'Big gains (20+ yd)', hint: 'A run or completion of 20 yards or more' },
  { id: 'lateDownSack', label: '3rd/4th-down sacks', hint: 'The quarterback goes down on third or fourth down' },
  { id: 'longFieldGoal', label: 'Long field goals (50+ yd)', hint: 'A made kick from 50 yards or more' },
]

export function BroadcastSettings({ row }: { row: string }) {
  const s = useViewSettings()
  const live = useLiveView()
  const autoHint = autoQualityHint(s.autoQ, deviceKey())

  const toggleType = (id: ReplayReasonId, on: boolean) => {
    const chosen = new Set(s.replayTypes)
    if (on) chosen.add(id)
    else chosen.delete(id)
    setReplayTypes(REPLAY_REASON_IDS.filter((r) => chosen.has(r)))
  }

  return (
    <>
      <div className={row}>
        <div className="min-w-0">
          <span className="label block">Game view</span>
          <span className="text-small text-muted">Auto: 2.5D on wide screens, top-down on phones with 2.5D replays</span>
        </div>
        <SegmentedControl
          label="Game view"
          size="sm"
          value={s.game}
          onChange={setGameView}
          options={[
            { id: 'auto', label: 'Auto' },
            { id: 'broadcast', label: '2.5D' },
            { id: 'topdown', label: 'Top-down' },
          ]}
        />
      </div>

      <div className={row}>
        <div className="min-w-0">
          <span className="label block">Camera angle</span>
          <span className="text-small text-muted">
            {s.cameraAngle === 'fixed' ? 'One steady angle — the camera only pans and zooms' : 'The director raises, tilts and re-angles the camera'}
          </span>
        </div>
        <SegmentedControl
          label="Camera angle"
          size="sm"
          value={s.cameraAngle}
          onChange={setCameraAngle}
          options={[
            { id: 'fixed', label: 'Fixed' },
            { id: 'dynamic', label: 'Dynamic' },
          ]}
        />
      </div>

      <div className={row}>
        <div className="min-w-0">
          <span className="label block">Replays</span>
          <span className="text-small text-muted">Which plays replay in 2.5D — big plays and scores by default</span>
        </div>
        <SegmentedControl
          label="Replays"
          size="sm"
          value={s.replays}
          onChange={setReplayMode}
          options={[
            { id: 'big', label: 'Big plays' },
            { id: 'all', label: 'All' },
            { id: 'custom', label: 'Custom' },
            { id: 'off', label: 'Off' },
          ]}
        />
      </div>

      {s.replays === 'custom' && (
        <div className={cn(row, 'items-start')}>
          <div className="w-full">
            <span className="label block">Custom replays</span>
            <span className="text-small text-muted">Choose which plays replay in 2.5D</span>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {CUSTOM_TYPES.map((t) => (
                <label
                  key={t.id}
                  className="motion flex cursor-pointer items-start gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-2.5 py-2 hover:border-line-strong"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--team-accent)]"
                    checked={s.replayTypes.includes(t.id)}
                    onChange={(e) => toggleType(t.id, e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block font-cond text-small font-700 uppercase tracking-wide text-ink">{t.label}</span>
                    <span className="mt-0.5 block text-label leading-snug text-muted">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {s.replayTypes.length === 0 && <div className="mt-2 text-small text-muted">No plays will replay</div>}
          </div>
        </div>
      )}

      <div className={row}>
        <div className="min-w-0">
          <span className="label block">Drawings</span>
          <span className="text-small text-muted">
            {s.drawings === 'every'
              ? 'Routes, the ball arc and the tackle marks on every play'
              : s.drawings === 'replays'
                ? 'Drawings only while a play replays in 2.5D'
                : 'No drawings on the field'}
          </span>
        </div>
        <SegmentedControl
          label="Drawings"
          size="sm"
          value={s.drawings}
          onChange={setDrawings}
          options={[
            { id: 'every', label: 'Every play' },
            { id: 'replays', label: 'Replays only' },
            { id: 'off', label: 'Off' },
          ]}
        />
      </div>

      <div className={row}>
        <div className="min-w-0">
          <span className="label block">QB vision cone</span>
          <span className="text-small text-muted">Where the quarterback looks, and the throw's landing circle. Default: on</span>
        </div>
        <SegmentedControl
          label="QB vision cone"
          size="sm"
          value={s.qbCone ?? 'default'}
          onChange={(v) => setQbCone(v === 'default' ? null : v)}
          options={[
            { id: 'default', label: 'Default' },
            { id: 'on', label: 'On' },
            { id: 'off', label: 'Off' },
          ]}
        />
      </div>

      <div className={row}>
        <div className="min-w-0">
          <span className="label block">Quality</span>
          <span className="text-small text-muted">
            {s.quality === 'auto' ? autoHint ?? 'Auto measures this device on the first play' : 'Set manually — Auto is off'}
          </span>
          {live.fallback && <span className="mt-0.5 block text-small text-muted">{FALLBACK_NOTE[live.fallback]}</span>}
        </div>
        <SegmentedControl
          label="Quality"
          size="sm"
          value={s.quality}
          onChange={setQualitySetting}
          options={[
            { id: 'auto', label: 'Auto' },
            { id: 'full', label: 'Full' },
            { id: 'lite', label: 'Lite' },
          ]}
        />
      </div>
    </>
  )
}
