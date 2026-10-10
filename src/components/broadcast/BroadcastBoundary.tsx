// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B7): a small error boundary around the 2.5D view. If the
// canvas view throws during render, game day switches to the top-down view —
// never a blank screen, never a stopped game. The report is session-only.
// ─────────────────────────────────────────────────────────────────────────────
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportFallback } from './liveView'

interface Props {
  children: ReactNode
  /** Extra callback (e.g. to force the top-down view immediately). */
  onError?: () => void
  /** What to render after a failure (default: nothing — the caller swaps views). */
  fallback?: ReactNode
}

interface State {
  failed: boolean
}

export class BroadcastBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (typeof console !== 'undefined') console.warn('Broadcast 2.5D view error; switching to top-down.', error, info)
    reportFallback('render-error')
    this.props.onError?.()
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}

export default BroadcastBoundary
