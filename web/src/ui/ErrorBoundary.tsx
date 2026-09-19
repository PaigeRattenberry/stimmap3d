/**
 * Minimal error boundary (Milestone 6 polish). Catches a render/load failure in a subtree
 * (e.g. the WebGL scene if `brain.glb` fails to decode, or the analytics panel) and shows a
 * calm fallback instead of blanking the whole app — the persistent disclaimer banner lives
 * ABOVE this in `App`, so honesty gate (a) is unaffected by anything that fails below.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  /** Short label for the console error (which subtree failed). */
  label?: string
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label ?? 'ErrorBoundary'}]`, error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
