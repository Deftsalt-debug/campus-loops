import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** True only after `active` has stayed true for `delayMs`, so fast work never flashes a busy state. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => setElapsed(true), delayMs)
    return () => { window.clearTimeout(t); setElapsed(false) }
  }, [active, delayMs])
  return active && elapsed
}
