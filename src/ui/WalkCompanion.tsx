import { useEffect, useMemo, useRef, useState } from 'react'
import { companionLegs, companionSpareSec, companionStatus, countdown, type CompanionLeg } from '../core/companion'
import { toIst } from '../core/time/clock'
import { ripple } from './effects'
import { clock, mins } from './format'
import { Icon } from './icons'
import type { StopFocus } from './RouteMap'
import type { WalkSession } from './walkSession'
import './WalkCompanion.css'

/** Read in event handlers only, never while rendering. */
const wallClock = () => Date.now()

/** Keep the phone awake while a walk is on screen, where the browser allows it. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock.request('screen').then((sentinel) => {
        if (cancelled) void sentinel.release()
        else lock = sentinel
      }).catch(() => { /* Low battery or policy: the timer works without it. */ })
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release()
    }
  }, [active])
}

function legHeading(leg: CompanionLeg): string {
  if (leg.kind === 'stop') return `At ${leg.place}`
  if (leg.kind === 'buffer') return `Back at ${leg.place}`
  return leg.stop === 'start' ? `Walk back to ${leg.place}` : `Walk to ${leg.place}`
}

/** The leg after this one, as the second half of "Then: …". */
function legPreview(leg: CompanionLeg): string {
  if (leg.kind === 'stop') return `${mins(leg.endSec - leg.startSec)} at ${leg.place}`
  if (leg.kind === 'buffer') return `${mins(leg.endSec - leg.startSec)} buffer`
  return leg.stop === 'start' ? `walk back to ${leg.place}` : `walk to ${leg.place}`
}

function legCountdownLabel(leg: CompanionLeg): string {
  if (leg.kind === 'stop') return 'Leave in'
  if (leg.kind === 'buffer') return 'Buffer left'
  return 'Arrive in'
}

interface Props {
  session: WalkSession
  onChange: (next: WalkSession | null) => void
  onFocusStop: (focus: StopFocus | null) => void
}

/** The live card: what to do now, how long for, and whether you still get back in time. */
export function WalkCompanion({ session, onChange, onFocusStop }: Props) {
  const { plan, startName, startedAtMs, adjustSec, legFloor, finishedAtMs } = session
  const [nowMs, setNowMs] = useState(() => Date.now())
  const card = useRef<HTMLElement>(null)
  const finished = finishedAtMs !== undefined

  useEffect(() => {
    if (finished) return
    const tick = () => setNowMs(Date.now())
    const id = setInterval(tick, 1000)
    // Timers are throttled in a background tab; catch up the moment it returns.
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [finished])

  useWakeLock(!finished)

  const legs = useMemo(() => companionLegs(plan, startName), [plan, startName])
  const elapsedSec = Math.max(0, ((finishedAtMs ?? nowMs) - startedAtMs) / 1000)
  const status = companionStatus(plan, legs, elapsedSec + adjustSec, legFloor)
  const { leg, legIndex } = status
  const done = finished || status.phase === 'done'
  const spareSec = companionSpareSec(plan, elapsedSec, status.planSec)

  // Bring the card into view when the walk starts, and point the map at each new destination.
  useEffect(() => {
    card.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [startedAtMs])
  useEffect(() => {
    if (done) return
    onFocusStop({ planId: plan.id, index: leg.stop, reveal: true })
  }, [done, legIndex, leg.stop, plan.id, onFocusStop])

  // Move the plan's clock: forward to reach the next leg now, back to take longer over this one.
  const shift = (sec: number, floor: number) => {
    setNowMs(wallClock())
    onChange({ ...session, adjustSec: adjustSec + sec, legFloor: floor })
  }
  const advance = () => {
    if (legIndex >= legs.length - 1 || leg.kind === 'buffer' || (leg.kind === 'walk' && leg.stop === 'start')) {
      onChange({ ...session, finishedAtMs: wallClock() })
      return
    }
    shift(status.legRemainingSec, legIndex + 1)
  }

  if (done) {
    const tookSec = finished ? elapsedSec : plan.totalSec
    return (
      <section ref={card} className="companion is-done" aria-label="Walk finished">
        <p className="eyebrow"><Icon name="check" size={14} />Walk finished</p>
        <h2 className="companion-now">{plan.name}</h2>
        <p className="hint">
          {finished ? <>Door to door in <b>{mins(tookSec)}</b>; the plan allowed {mins(plan.totalSec)}.</> : <>The planned {mins(plan.totalSec)} is up.</>}
          {' '}If you timed the walking itself, log it under “Walked it?” to compare with the estimate.
        </p>
        <button type="button" className="btn" onPointerDown={ripple} onClick={() => onChange(null)}>Done</button>
      </section>
    )
  }

  const backClock = clock(toIst(new Date(nowMs + status.untilBackSec * 1000)).secondOfDay)
  const next = legs[legIndex + 1]
  const spare = spareSec >= 60 ? `${mins(spareSec)} spare` : spareSec > -60 ? 'On time' : `${mins(-spareSec)} over your limit`
  const primary = leg.kind === 'stop' ? 'Leaving now' : leg.kind === 'buffer' || leg.stop === 'start' ? 'I’m back' : 'I’m here'
  const addSec = leg.kind === 'stop' ? 300 : 120

  return (
    <section ref={card} className="companion" aria-label="Walk in progress">
      <header className="companion-head">
        <p className="eyebrow"><span className="companion-pulse" aria-hidden="true" />Walking now · {plan.name}</p>
        <button type="button" className="companion-end" onClick={() => onChange(null)}>End walk</button>
      </header>

      <div className="companion-main">
        <div className="companion-leg">
          <h2 className="companion-now">{legHeading(leg)}</h2>
          <p className="hint">{next ? `Then: ${legPreview(next)}` : 'Last stretch.'}</p>
        </div>
        <div className="companion-clock" role="timer" aria-label={`${legCountdownLabel(leg)} ${Math.ceil(status.legRemainingSec / 60)} minutes`}>
          <span>{legCountdownLabel(leg)}</span>
          <b>{countdown(status.legRemainingSec)}</b>
        </div>
      </div>

      <div className="companion-track" aria-hidden="true">
        {legs.map((item, i) => {
          const span = Math.max(1, item.endSec - item.startSec)
          const filled = Math.min(1, Math.max(0, (status.planSec - item.startSec) / span))
          return <span key={`${item.kind}-${i}`} className={`seg ${item.kind}${i === legIndex ? ' is-now' : ''}`} style={{ flexGrow: span }}><i style={{ width: `${filled * 100}%` }} /></span>
        })}
      </div>
      <p className="sr-only" aria-live="polite">{legHeading(leg)}. Back at {startName} by {backClock}.</p>

      <dl className="companion-facts">
        <div><dt>Back at {startName}</dt><dd>{backClock}</dd></div>
        <div className={spareSec <= -60 ? 'is-late' : undefined}><dt>Against your limit</dt><dd>{spare}</dd></div>
      </dl>

      <div className="companion-actions">
        <button type="button" className="btn primary" onPointerDown={ripple} onClick={advance}><Icon name="check" size={17} />{primary}</button>
        {leg.kind !== 'buffer' && <button type="button" className="btn" onPointerDown={ripple} onClick={() => shift(-addSec, legIndex)}><Icon name="plus" size={17} />{addSec / 60} min</button>}
      </div>
    </section>
  )
}
