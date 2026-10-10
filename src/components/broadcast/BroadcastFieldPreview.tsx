// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B2) preview: the renderer on its own over a sample down
// (3rd & 6 at the opponent 38) with a slowly drifting camera. Mounted only in
// the hidden kit showcase (#/kit). Camera drift stops under reduced motion.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { NFL_TEAMS } from '../../game/data/nflTeams'
import { cn } from '../../lib/cn'
import { SegmentedControl } from '../../ui/Controls'
import { useMediaQuery } from '../../ui/hooks'
import { MID_WIDTH, offenseXToWorld, orbitPose, type CameraPose, type Direction } from './camera'
import { BroadcastRenderer, FrameWindow, type FrameStats } from './renderer'

type Shot = 'skycam' | 'sideline' | 'far' | 'reverse'
type Size = 'wide' | 'phone' | 'full'

const LOS = 72 // offense frame: the opponent 38
const FD = 78

/** The preview's camera rig per shot; `t` drives the drift (seconds). */
function shotPose(shot: Shot, dir: Direction, t: number, phone: boolean): CameraPose {
  const los = offenseXToWorld(LOS, dir)
  // Look a few yards downfield of the LOS.
  const fx = los + dir * 5.5 + 2.5 * Math.sin(t * 0.21)
  const sway = Math.sin(t * 0.17)
  switch (shot) {
    case 'skycam':
      return orbitPose({
        focusX: fx,
        focusY: MID_WIDTH + 2.5 * Math.sin(t * 0.13),
        back: phone ? 28 : 32,
        height: phone ? 23 : 21.5,
        yaw: (dir === 1 ? 0 : Math.PI) + 0.22 * sway,
        fovDeg: phone ? 50 : 43,
      })
    case 'sideline':
      return orbitPose({ focusX: fx, focusY: MID_WIDTH, back: 52, height: 24, yaw: Math.PI / 2 + 0.16 * sway, fovDeg: phone ? 46 : 32 })
    case 'far':
      return orbitPose({ focusX: fx, focusY: MID_WIDTH, back: 52, height: 24, yaw: -Math.PI / 2 + 0.16 * sway, fovDeg: phone ? 46 : 32 })
    case 'reverse':
      return orbitPose({
        focusX: fx,
        focusY: MID_WIDTH,
        back: 30,
        height: 21,
        yaw: (dir === 1 ? Math.PI : 0) + 0.22 * sway,
        fovDeg: phone ? 50 : 43,
      })
  }
}

interface Readout {
  avg: number
  p95: number
  worst: number
  fps: number
  hit: number
  reproject: boolean
  w: number
  h: number
  dpr: number
}

export default function BroadcastFieldPreview({ homeId = 'ATL', initialAwayId }: { homeId?: string; initialAwayId?: string }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [awayPick, setAwayId] = useState(initialAwayId ?? 'CLE')
  // Never play yourself: fall back to another club when the kit picker matches.
  const awayId = awayPick === homeId ? (homeId === 'CLE' ? 'ATL' : 'CLE') : awayPick
  const [shot, setShot] = useState<Shot>('skycam')
  const [size, setSize] = useState<Size>('wide')
  const [dir, setDir] = useState<Direction>(1)
  const [split, setSplit] = useState(false)
  const [drift, setDrift] = useState(true)
  const [readout, setReadout] = useState<Readout | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ shot, dir, homeId, awayId, moving: drift && !reduced, phone: size === 'phone' })
  useEffect(() => {
    live.current = { shot, dir, homeId, awayId, moving: drift && !reduced, phone: size === 'phone' }
  }, [shot, dir, homeId, awayId, drift, reduced, size])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const r = new BroadcastRenderer(cv, { endZones: split ? 'split' : 'home' })
    const win = new FrameWindow(120)
    const gaps = new FrameWindow(120)
    let hits = 0
    let n = 0
    let raf = 0
    let last = performance.now()
    let lastReport = last
    let t = 0
    r.onFrame = (s: FrameStats) => {
      win.push(s.ms)
      n++
      if (s.cache === 'hit' || s.cache === 'reuse') hits++
    }
    const loop = (now: number) => {
      const L = live.current
      gaps.push(now - last)
      if (L.moving) t += Math.min(0.1, (now - last) / 1000)
      last = now
      const s = r.draw({
        camera: shotPose(L.shot, L.dir, t, L.phone),
        losYard: LOS,
        firstDownYard: FD,
        direction: L.dir,
        homeTeamId: L.homeId,
        awayTeamId: L.awayId,
        possession: 'away',
        turfText: '3RD & 6',
        time: t,
      })
      if (now - lastReport > 500) {
        lastReport = now
        setReadout({
          avg: win.avg,
          p95: win.p95,
          worst: win.worst,
          fps: gaps.avg > 0 ? 1000 / gaps.avg : 0,
          hit: n ? hits / n : 0,
          reproject: r.reprojecting,
          w: s.width,
          h: s.height,
          dpr: s.dpr,
        })
        hits = 0
        n = 0
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      r.destroy()
    }
  }, [split])

  // Escape leaves the full-window view.
  useEffect(() => {
    if (size !== 'full') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSize('wide')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [size])

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        label="Camera"
        size="sm"
        value={shot}
        onChange={setShot}
        options={[
          { id: 'skycam', label: 'Skycam' },
          { id: 'sideline', label: 'Near side' },
          { id: 'far', label: 'Far side' },
          { id: 'reverse', label: 'Reverse' },
        ]}
      />
      <SegmentedControl
        label="Size"
        size="sm"
        value={size}
        onChange={setSize}
        options={[
          { id: 'wide', label: '16:9' },
          { id: 'phone', label: '375 px' },
          { id: 'full', label: 'Full window' },
        ]}
      />
      <SegmentedControl
        label="Offense attacks"
        size="sm"
        value={dir === 1 ? 'r' : 'l'}
        onChange={(v) => setDir(v === 'r' ? 1 : -1)}
        options={[
          { id: 'l', label: '← Left' },
          { id: 'r', label: 'Right →' },
        ]}
      />
      <SegmentedControl
        label="End zones"
        size="sm"
        value={split ? 'split' : 'home'}
        onChange={(v) => setSplit(v === 'split')}
        options={[
          { id: 'home', label: 'Home both' },
          { id: 'split', label: 'Split' },
        ]}
      />
      <SegmentedControl
        label="Drift"
        size="sm"
        value={drift && !reduced ? 'on' : 'off'}
        onChange={(v) => setDrift(v === 'on')}
        options={[
          { id: 'on', label: reduced ? 'Drift (reduced motion)' : 'Drift' },
          { id: 'off', label: 'Still' },
        ]}
      />
      <label className="flex items-center gap-2">
        <span className="label">Visitors</span>
        <select
          value={awayId}
          onChange={(e) => setAwayId(e.target.value)}
          className="h-9 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 text-[16px] text-ink sm:text-small"
        >
          {NFL_TEAMS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.abbr} · {t.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )

  const stats = readout && (
    <div className="font-cond text-small tabular-nums text-muted" aria-live="off">
      {readout.fps.toFixed(0)} fps · draw {readout.avg.toFixed(2)} ms avg / {readout.p95.toFixed(2)} p95 / {readout.worst.toFixed(1)} worst · static cached{' '}
      {(readout.hit * 100).toFixed(0)}% ({readout.reproject ? 're-projecting' : 'repaint on move'}) · {readout.w}×{readout.h} @{readout.dpr}x
    </div>
  )

  return (
    <div className="space-y-3">
      {controls}
      {stats}
      <div
        className={cn(
          'overflow-hidden bg-canvas',
          size === 'full' ? 'fixed inset-0 z-50' : 'relative rounded-[var(--r-lg)] border border-line',
          size === 'wide' && 'aspect-video w-full max-w-[1280px]',
          size === 'phone' && 'h-[410px] w-[375px] max-w-full',
        )}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block h-full w-full"
          role="img"
          aria-label={`Broadcast field preview: 3rd and 6 at the opponent 38, ${shot} camera`}
        />
        {size === 'full' && (
          <div className="absolute left-4 right-4 top-4 flex flex-wrap items-start justify-between gap-3">
            <div className="broadcast rounded-[var(--r-md)] bg-surface/80 p-2">{stats}</div>
            <button
              type="button"
              onClick={() => setSize('wide')}
              className="broadcast rounded-[var(--r-md)] border border-line-strong bg-surface px-3 py-2 font-cond text-small font-700 uppercase tracking-[0.06em] text-ink"
            >
              Close (Esc)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
