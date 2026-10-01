import { useState } from 'react'
import { planToGpx, planToKml, planToText } from '../core/export/files'
import { googleMapsDirectionsUrl } from '../core/export/googleMaps'
import { planGeometry } from '../core/geo'
import type { Dataset, Plan } from '../core/types'
import { saveLog } from '../storage/calibrationLog'
import { ripple, spotlight } from './effects'
import { clock, download, km, mins, rupees, slug } from './format'

interface Props {
  plan: Plan
  index: number
  dataset: Dataset
  selected: boolean
  startSec: number
  pace: 'relaxed' | 'normal'
  shareUrl: string
  onSelect: () => void
  onHover: (hovering: boolean) => void
  notify: (message: string) => void
  onLogged: () => void
  onSave: () => void
  saved: boolean
}

export function PlanCard({ plan, index, dataset, selected, startSec, pace, shareUrl, onSelect, onHover, notify, onLogged, onSave, saved }: Props) {
  const startName = dataset.starts.find((s) => s.nodeId === plan.startNodeId)?.name ?? 'Start'
  const headingId = `plan-${index}-title`
  const stopCount = plan.visits.filter((v) => v.dwellSec > 0).length

  return (
    <article
      className="card spot plan"
      aria-current={selected}
      aria-labelledby={headingId}
      onPointerMove={spotlight}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onClick={() => !selected && onSelect()}
    >
      <div className="plan-head">
        <span className="num" aria-hidden="true">{index + 1}</span>
        <div style={{ minWidth: 0 }}>
          <h3 id={headingId}>
            <button type="button" className="select-btn" onClick={onSelect} aria-pressed={selected}>
              {plan.name}
            </button>
          </h3>
          {plan.fit && <p className="fit">{plan.fit}</p>}
          <div className="stats">
            <span className="stat">⏱ {mins(plan.totalSec)}</span>
            <span className="stat">🚶 {mins(plan.walkingSec)} · {km(plan.distanceM)}</span>
            <span className="stat">{rupees(plan.spendLowInr, plan.spendHighInr)}</span>
            {stopCount > 0 && <span className="stat">{stopCount} stop{stopCount > 1 ? 's' : ''}</span>}
          </div>
          <p className="explain">{plan.explanation}</p>
        </div>
      </div>
      {selected && (
        <PlanDetails key={plan.id} plan={plan} dataset={dataset} startName={startName} startSec={startSec} pace={pace} shareUrl={shareUrl} notify={notify} onLogged={onLogged} onSave={onSave} saved={saved} />
      )}
    </article>
  )
}

function PlanDetails({
  plan,
  dataset,
  startName,
  startSec,
  pace,
  shareUrl,
  notify,
  onLogged,
  onSave,
  saved,
}: {
  plan: Plan
  dataset: Dataset
  startName: string
  startSec: number
  pace: 'relaxed' | 'normal'
  shareUrl: string
  notify: (message: string) => void
  onLogged: () => void
  onSave: () => void
  saved: boolean
}) {
  const route = planGeometry(dataset, plan)
  const google = googleMapsDirectionsUrl(route)
  const file = slug(plan.name)
  const [actualMin, setActualMin] = useState('')
  const [copyFallback, setCopyFallback] = useState<'link' | 'text' | null>(null)
  let stopNumber = 0

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
    notify(ok ? 'Saved on this device. Thanks!' : 'Storage is unavailable in this browser')
    if (ok) {
      setActualMin('')
      onLogged()
    }
  }

  return (
    <div className="details" onClick={(e) => e.stopPropagation()}>
      <ol className="timeline" aria-label="Itinerary">
        <li>
          <time>{clock(startSec)}</time>
          <span className="dot"><i>S</i></span>
          <span>Leave <b>{startName}</b></span>
        </li>
        {plan.visits.map((v) => (
          <li key={v.placeId}>
            <time>{clock(startSec + v.arriveOffsetSec)}</time>
            <span className="dot">{v.dwellSec > 0 ? <i>{++stopNumber}</i> : <i className="pass" />}</span>
            <span>
              {v.dwellSec > 0 ? <b>{v.name}</b> : <>Pass {v.name}</>}
              <small>
                {v.dwellSec > 0 ? `${mins(v.dwellSec)} stop` : 'no stop'}
                {v.spendHighInr > 0 ? ` · ${rupees(v.spendLowInr, v.spendHighInr)} each (estimate)` : ''}
              </small>
            </span>
          </li>
        ))}
        <li>
          <time>{clock(startSec + plan.totalSec - plan.bufferSec)}</time>
          <span className="dot"><i>S</i></span>
          <span>
            Back at <b>{startName}</b>
            <small>{mins(plan.bufferSec)} buffer · data {dataset.isFixture ? 'snapshot' : 'checked'} {plan.dataCheckedOn}</small>
          </span>
        </li>
      </ol>

      {plan.warnings.length > 0 && (
        <ul className="warnings">
          {plan.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div className="actions">
        <a className="btn primary" href={google.url} target="_blank" rel="noopener noreferrer" onPointerDown={ripple}>
          Open in Google Maps
        </a>
        <button type="button" className="btn" onPointerDown={ripple} onClick={share}>Share</button>
        <button type="button" className="btn" onPointerDown={ripple} onClick={onSave} disabled={saved}>{saved ? 'Saved on device' : 'Save walk'}</button>
        <button type="button" className="btn" onPointerDown={ripple} onClick={copyText}>Copy text</button>
      </div>
      {copyFallback && <div className="copy-fallback">
        <label htmlFor={`copy-${plan.id}`}>{copyFallback === 'link' ? 'Link to this walk' : 'Itinerary to copy'}</label>
        <textarea id={`copy-${plan.id}`} className="input" readOnly rows={copyFallback === 'link' ? 3 : 8} value={copyFallback === 'link' ? shareUrl : planToText(plan, startName, startSec)} onFocus={(e) => e.currentTarget.select()} />
        <p className="hint">Select the text and use your device’s Copy command.</p>
        <button type="button" className="btn ghost" onClick={() => setCopyFallback(null)}>Close copy field</button>
      </div>}
      <div className="actions">
        <button
          type="button"
          className="btn ghost"
          onPointerDown={ripple}
          onClick={() => download(`${file}.kml`, 'application/vnd.google-earth.kml+xml', planToKml(plan, route, startName, dataset.licence))}
        >
          KML for Google My Maps
        </button>
        <button
          type="button"
          className="btn ghost"
          onPointerDown={ripple}
          onClick={() => download(`${file}.gpx`, 'application/gpx+xml', planToGpx(plan, route, startName, dataset.licence))}
        >
          GPX
        </button>
      </div>
      <p className="hint">
        Google Maps finds its own path through {google.waypoints.length} points along this route, so it can differ slightly. For the
        exact line, import the KML at <a href="https://www.google.com/mymaps" target="_blank" rel="noopener noreferrer">Google My Maps</a>{' '}
        (Create map → Import). It then appears in the Google Maps app under Saved → Maps.
      </p>

      <details className="more">
        <summary>Walked it? Log the real time</summary>
        <div className="row">
          <label className="sr-only" htmlFor={`actual-${plan.id}`}>Actual walking minutes</label>
          <input
            id={`actual-${plan.id}`}
            className="input small"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={String(Math.round(plan.walkingSec / 60))}
            value={actualMin}
            onChange={(e) => setActualMin(e.target.value)}
          />
          <span className="hint">walking minutes (planned {mins(plan.walkingSec)})</span>
          <button type="button" className="btn" onPointerDown={ripple} onClick={logWalk}>Save</button>
        </div>
        <p className="hint">Stays on this device. It helps tune the walking-pace estimates.</p>
      </details>
    </div>
  )
}
