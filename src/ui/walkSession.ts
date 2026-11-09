import { useCallback, useState } from 'react'
import type { Plan } from '../core/types'

/**
 * A walk in progress. It carries its own copy of the plan: the planner re-runs
 * as the clock moves, and a plan that fitted at departure can drop out of the
 * results mid-walk (a back-by time, sunset). The walker still needs it.
 */
export interface WalkSession {
  plan: Plan
  startName: string
  startedAtMs: number
  /** Seconds the walker has moved the plan's clock: positive is ahead of plan. */
  adjustSec: number
  /** Index of the leg the walker has confirmed reaching; see companionStatus. */
  legFloor?: number
  /** Set when the walker finishes; freezes the summary. */
  finishedAtMs?: number
}

const STORAGE_KEY = 'campus-loops:walk-session'
/** A session left running this long after its planned end is stale, not a walk. */
const STALE_AFTER_SEC = 3 * 3600

function readSession(): WalkSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<WalkSession>
    const plan = value.plan
    if (!plan || typeof plan.id !== 'string' || typeof plan.totalSec !== 'number' || !Array.isArray(plan.visits)) return null
    if (typeof value.startName !== 'string' || typeof value.startedAtMs !== 'number' || typeof value.adjustSec !== 'number') return null
    if ((Date.now() - value.startedAtMs) / 1000 > plan.totalSec + STALE_AFTER_SEC) return null
    return value as WalkSession
  } catch {
    return null
  }
}

function writeSession(session: WalkSession | null) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Without storage the walk still runs; it just does not survive a reload.
  }
}

/** The walk in progress, kept for this tab so a reload mid-walk does not lose it. */
export function useWalkSession() {
  const [session, setSession] = useState<WalkSession | null>(readSession)
  const update = useCallback((next: WalkSession | null) => {
    writeSession(next)
    setSession(next)
  }, [])
  const start = useCallback((plan: Plan, startName: string) => {
    update({ plan, startName, startedAtMs: Date.now(), adjustSec: 0 })
  }, [update])
  return { session, start, update }
}
