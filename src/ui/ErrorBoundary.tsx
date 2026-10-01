import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="panel"><h1>Let’s get you back on track.</h1><p role="alert">Campus Loops ran into a problem. Reload to try again; your saved walks stay on this device.</p><div><button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload Campus Loops</button></div><a href="https://github.com/Deftsalt-debug/campus-loops/issues" target="_blank" rel="noopener noreferrer">Report the problem</a></main>
    return this.props.children
  }
}
