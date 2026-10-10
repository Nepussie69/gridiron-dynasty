// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B7): the settings rows for the shell's Settings sheet.
// Built only from kit parts (SegmentedControl sm + the sheet's row class, which
// is passed in) and the design tokens — no hard-coded colours.
// ─────────────────────────────────────────────────────────────────────────────
import { SegmentedControl } from '../../ui/Controls'
import { autoQualityHint, useLiveView, type Fallback } from './liveView'
import { deviceKey, setGameView, setQualitySetting, setReplayMode, useViewSettings } from './viewSettings'

const FALLBACK_NOTE: Record<Exclude<Fallback, null>, string> = {
  'no-canvas': 'This device has no 2D canvas — using the top-down view.',
  'render-error': 'The 2.5D view hit a problem — using the top-down view for now.',
  'too-slow': 'This device could not keep up — using the top-down view.',
}

export function BroadcastSettings({ row }: { row: string }) {
  const s = useViewSettings()
  const live = useLiveView()
  const autoHint = autoQualityHint(s.autoQ, deviceKey())

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
