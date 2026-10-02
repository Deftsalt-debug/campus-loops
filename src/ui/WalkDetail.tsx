import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { planToGpx, planToIcs, planToKml, planToText } from '../core/export/files'
import { googleMapsDirectionsUrl } from '../core/export/googleMaps'
import { planGeometry } from '../core/geo'
import type { Dataset, Plan } from '../core/types'
import { getLogStorageStatus, saveLog } from '../storage/calibrationLog'
import { ripple } from './effects'
import { clock, download, km, mins, rupees, slug } from './format'
import { Icon } from './icons'
import type { StopFocus, StopIndex } from './RouteMap'
import './WalkDetail.css'

interface Props {
  plan: Plan
  index: number
  count: number
  dataset: Dataset
  startSec: number
  /** The instant the walk starts (now, or the preview time), for calendar export. */
  startAt: Date
  pace: 'relaxed' | 'normal'
  shareUrl: string
  focus: StopFocus | null
  /** Scroll the focused stop into view when the map points at it (side-by-side layouts). */
  followMap: boolean
  onFocusStop: (focus: StopFocus | null) => void
  notify: (message: string) => void
  onLogged: () => void
  onSave: () => void
  saved: boolean
}

/** Step 3. The chosen walk as a timeline you can trace on the map, then ways to take it with you. */
export const WalkDetail = memo(function WalkDetail({ plan, index, count, dataset, startSec, startAt, pace, shareUrl, focus, followMap, onFocusStop, notify, onLogged, onSave, saved }: Props) {
  const startName = dataset.starts.find((s) => s.nodeId === plan.startNodeId)?.name ?? 'Start'
  const route = useMemo(() => planGeometry(dataset, plan), [dataset, plan])
  const google = useMemo(() => googleMapsDirectionsUrl(route), [route])
  const file = slug(plan.name)
  const [actualMin, setActualMin] = useState('')
  const [copyFallback, setCopyFallback] = useState<'link' | 'text' | null>(null)
  const list = useRef<HTMLOListElement>(null)
  let stopNumber = 0

  // A pin tapped on the map brings its row into view beside it.
  useEffect(() => {
    if (!followMap || !focus || focus.reveal) return
    const row = list.current?.querySelector<HTMLElement>(`[data-stop="${focus.index}"]`)
    row?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [focus, followMap])

  const share = async () => {
    const text = `${plan.name} from ${startName}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Campus Loops plan', text, url: shareUrl })
        return
      }
      await navigator.clipboard.writeText(shareUrl)
      notify('Link copied')
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setCopyFallback('link')
        notify('Copy the link from the field below')
      }
    }
  }
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(planToText(plan, startName, startSec))
      notify('Itinerary copied')
    } catch {
      setCopyFallback('text')
      notify('Select and copy the itinerary below')
    }
  }
  const logWalk = () => {
    const minutes = Number(actualMin)
    if (!(minutes > 0 && minutes < 600)) {
      notify('Enter the walking minutes it actually took')
      return
    }
    const ok = saveLog({
      id: `${plan.id}@${Date.now()}`,
      planId: plan.id,
      datasetVersion: dataset.datasetVersion,
      pace,
      predictedWalkSec: plan.walkingSec,
      actualWalkSec: minutes * 60,
      loggedAt: new Date().toISOString(),
    })
    notify(ok ? 'Saved on this device. Thanks!' : getLogStorageStatus() === 'corrupt' ? 'Calibration data needs attention. Open Calibration log in About to export readable entries before clearing it.' : 'Storage is full or unavailable in this browser')
    if (ok) {
      setActualMin('')
      onLogged()
    }
  }

  const row = (key: StopIndex, i: number, time: number, mark: ReactNode, body: ReactNode, label: string) => (
    <li key={`${key}-${i}`} data-stop={key} className={focus?.index === key ? 'is-focus' : undefined} style={{ '--i': i } as CSSProperties}
      onPointerEnter={() => onFocusStop({ planId: plan.id, index: key, reveal: false })} onPointerLeave={() => onFocusStop(null)}>
      <time>{clock(time)}</time>
      <span className="dot">{mark}</span>
      <span className="stop-body">{body}</span>
      <button type="button" className="stop-locate" aria-label={`Show ${label} on the map`} onClick={() => onFocusStop({ planId: plan.id, index: key, reveal: true })}>
        <Icon name="pin" size={16} />
      </button>
    </li>
  )

  return (
    <article className="detail" aria-labelledby="detail-title">
      <header className="detail-head">
        <p className="eyebrow">Walk {index + 1} of {count}</p>
        <h3 id="detail-title">{plan.name}</h3>
        {plan.fit && <p className="fit">{plan.fit}</p>}
        <p className="explain">{plan.explanation}</p>
      </header>

      <dl className="detail-stats">
        <div><dt>Total</dt><dd>{mins(plan.totalSec)}</dd></div>
        <div><dt>Walking</dt><dd>{mins(plan.walkingSec)}</dd></div>
        <div><dt>Distance</dt><dd>{km(plan.distanceM)}</dd></div>
        <div><dt>Spend</dt><dd>{rupees(plan.spendLowInr, plan.spendHighInr)}</dd></div>
      </dl>

      <ol ref={list} className="timeline" aria-label="Itinerary">
        {row('start', 0, startSec, <i>S</i>, <>Leave <b>{startName}</b></>, `the start, ${startName}`)}
        {plan.visits.map((v, i) => row(
          i, i + 1, startSec + v.arriveOffsetSec,
          v.dwellSec > 0 ? <i>{++stopNumber}</i> : <i className="pass" />,
          <>
            {v.dwellSec > 0 ? <b>{v.name}</b> : <>Pass {v.name}</>}
            <small>
              {v.dwellSec > 0 ? `${mins(v.dwellSec)} stop` : 'no stop'}
              {v.spendHighInr > 0 ? ` · ${rupees(v.spendLowInr, v.spendHighInr)} each (estimate)` : ''}
            </small>
          </>,
          v.name,
        ))}
        {row('start', plan.visits.length + 1, startSec + plan.totalSec - plan.bufferSec, <i>S</i>, <>
          Back at <b>{startName}</b>
          <small>{mins(plan.bufferSec)} buffer · data {dataset.isFixture ? 'snapshot' : 'checked'} {plan.dataCheckedOn}</small>
        </>, `the finish, ${startName}`)}
      </ol>

      {plan.warnings.length > 0 && (
        <ul className="warnings">
          {plan.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div className="go">
        <a className="btn primary go-main" href={google.url} target="_blank" rel="noopener noreferrer" onPointerDown={ripple}>
          Start in Google Maps <Icon name="arrow" size={18} className="go-arrow" />
        </a>
        <div className="go-row">
          <button type="button" className="btn" onPointerDown={ripple} onClick={share}><Icon name="share" size={17} />Share</button>
          <button type="button" className={`btn${saved ? ' is-saved' : ''}`} onPointerDown={ripple} onClick={onSave} disabled={saved}>
            <Icon name={saved ? 'check' : 'bookmark'} size={17} />{saved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className="btn" onPointerDown={ripple} onClick={copyText}><Icon name="copy" size={17} />Copy</button>
        </div>
      </div>
      {copyFallback && <div className="copy-fallback">
        <label htmlFor={`copy-${plan.id}`}>{copyFallback === 'link' ? 'Link to this walk' : 'Itinerary to copy'}</label>
        <textarea id={`copy-${plan.id}`} className="input" readOnly rows={copyFallback === 'link' ? 3 : 8} value={copyFallback === 'link' ? shareUrl : planToText(plan, startName, startSec)} onFocus={(e) => e.currentTarget.select()} />
        <p className="hint">Select the text and use your device’s Copy command.</p>
        <button type="button" className="btn ghost" onClick={() => setCopyFallback(null)}>Close copy field</button>
      </div>}

      <details className="more">
        <summary>More ways to take it</summary>
        <div className="more-body">
          <div className="actions">
            <button type="button" className="btn ghost" onPointerDown={ripple}
              onClick={() => download(`${file}.kml`, 'application/vnd.google-earth.kml+xml', planToKml(plan, route, startName, dataset.licence))}>
              <Icon name="download" size={16} />KML for Google My Maps
            </button>
            <button type="button" className="btn ghost" onPointerDown={ripple}
              onClick={() => download(`${file}.gpx`, 'application/gpx+xml', planToGpx(plan, route, startName, dataset.licence))}>
              <Icon name="download" size={16} />GPX
            </button>
            <button type="button" className="btn ghost" onPointerDown={ripple}
              onClick={() => download(`${file}.ics`, 'text/calendar', planToIcs(plan, { startAt, stamp: new Date(), startName, startCoords: route.start, url: shareUrl, datasetVersion: dataset.datasetVersion }))}>
              <Icon name="download" size={16} />Add to calendar
            </button>
          </div>
          <p className="hint">
            Google Maps chooses its own path through {google.waypoints.length} route points and may differ from this plan. For the
            exact line, import the KML at <a href="https://www.google.com/mymaps" target="_blank" rel="noopener noreferrer">Google My Maps</a>{' '}
            (Create map → Import). It then appears in the Google Maps app under Saved → Maps.
          </p>
        </div>
      </details>

      <details className="more">
        <summary>Walked it? Log the real time</summary>
        <div className="more-body">
          <div className="row">
            <label className="sr-only" htmlFor={`actual-${plan.id}`}>Actual walking minutes</label>
            <input id={`actual-${plan.id}`} className="input small" type="number" inputMode="numeric" min={0.1} max={599.9} step="any"
              placeholder={String(Math.round(plan.walkingSec / 60))} value={actualMin} onChange={(e) => setActualMin(e.target.value)} />
            <span className="hint">walking minutes (planned {mins(plan.walkingSec)})</span>
            <button type="button" className="btn" onPointerDown={ripple} onClick={logWalk}>Save</button>
          </div>
          <p className="hint">Log walking time only, excluding stops and the buffer. Stays on this device for comparison; it does not change future estimates automatically.</p>
        </div>
      </details>
    </article>
  )
})
