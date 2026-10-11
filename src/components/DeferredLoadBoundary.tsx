import { Component, type ReactNode } from 'react'

/** Shared class boundary for lazy views with an owner-specific failure surface. */
export class DeferredLoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
