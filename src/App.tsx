import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import osmSnapshot from '../data/osm/snapshot.json'
import { calibrationSummaryText } from './ui/calibration'
import { DatasetError, loadDataset } from './core/dataset/load'
import { plan, rebuildPlan } from './core/planner/plan'
import { decodeShare, encodeShare } from './core/share'
import { toIst } from './core/time/clock'
import type { Dataset, PlanResult } from './core/types'
import { clearLogs, exportLogsJson, listLogs } from './storage/calibrationLog'
import { listSavedPlans, removeSavedPlan, savePlan } from './storage/savedPlans'
import { Backdrop } from './ui/Backdrop'
import { ripple } from './ui/effects'
import { download, fromIstInput, istInputValue } from './ui/format'
import { PlanCard } from './ui/PlanCard'
import { PlanForm } from './ui/PlanForm'
import { RouteMap } from './ui/RouteMap'
import { initialForm, sharedForm, toRequest, type FormState } from './ui/planningState'

const DATASETS = {
  demo: () => import('./data/manipal-demo.json'),
  fixture: () => import('./data/fixtures/pilot-fixture.json'),
}

const REASON: Record<string, string> = {
  duration: 'your time limit',
  backBy: 'your back-by time',
  sunset: 'sunset',
  window: 'end of pilot hours',
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const t = setInterval(refresh, intervalMs)
    // Mobile browsers suspend timers in the background. Recheck deadlines as
    // soon as someone returns to the app, rather than showing a stale walk.
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [shared, setShared] = useState<{ planId: string; note: string | null; blocked?: boolean } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'map'>('list')
  const [toast, setToast] = useState<string | null>(null)
  const [logCount, setLogCount] = useState(() => listLogs().length)
  const [savedPlans, setSavedPlans] = useState(listSavedPlans)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const realNow = useNow(30_000)
  // One map instance only: in the side pane on wide screens, behind the Map tab on phones.
  const wide = useMediaQuery('(min-width: 960px)')

  const applyLink = useCallback((ds: Dataset, hash: string) => {
    const decoded = decodeShare(hash)
    setSelectedId(null)
    setHoveredId(null)
    setView('list')
    if (decoded.ok) {
      if (decoded.shared.datasetVersion !== ds.datasetVersion) {
        setShared({ planId: '', blocked: true, note: 'This walk uses a different version of the campus data. Its route needs updating before you use it.' })
        setForm(initialForm(ds))
      } else {
        setForm(sharedForm(ds, decoded.shared))
        setShared({ planId: decoded.shared.planId, note: null })
        setSelectedId(decoded.shared.planId)
      }
    } else {
      setForm(initialForm(ds))
      setShared(decoded.reason === 'empty' ? null : { planId: '', note: `${decoded.reason} Showing fresh plans instead.` })
    }
  }, [])

  // ---- Load the dataset, then apply a shared link if there is one ----
  useEffect(() => {
    let cancelled = false
    const which = new URLSearchParams(window.location.search).get('data') === 'fixture' ? 'fixture' : 'demo'
    DATASETS[which]()
      .then((mod) => {
        const { dataset: ds } = loadDataset(mod.default)
        if (cancelled) return
        setDataset(ds)
        applyLink(ds, window.location.hash)
      })
      .catch((err) => !cancelled && setLoadError(err instanceof DatasetError ? err.message : 'The map data failed to load. Check your connection and reload.'))
    return () => { cancelled = true }
  }, [applyLink])

  useEffect(() => {
    if (!dataset) return
    const onHash = () => applyLink(dataset, window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [dataset, applyLink])

  useEffect(() => {
    const refresh = () => { setSavedPlans(listSavedPlans()); setLogCount(listLogs().length) }
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  const update = useCallback((patch: Partial<FormState>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setShared(null) // editing leaves shared-link mode
  }, [])

  // ---- Plan (deferred so typing stays smooth) ----
  const deferredForm = useDeferredValue(form)
  // Stable unless the preview time or the 30-second clock changes, so hovering doesn't re-plan.
  const previewAt = deferredForm?.previewAt ?? ''
  const previewNow = useMemo(() => previewAt ? fromIstInput(previewAt) : null, [previewAt])
  const now = previewNow ?? realNow
  const durationError =
    form && !(form.durationMin >= 30 && form.durationMin <= 90) ? 'Choose between 30 and 90 minutes.' : null
  const budgetError = form && !(Number.isFinite(form.budgetInr) && form.budgetInr >= 0 && form.budgetInr <= 100000)
    ? 'Choose a budget between ₹0 and ₹100,000.' : null
  const previewError = form?.previewAt && !fromIstInput(form.previewAt) ? 'Choose a valid date and time.' : null

  const result: PlanResult | null = useMemo(() => {
    if (!dataset || !deferredForm || !(deferredForm.durationMin >= 30 && deferredForm.durationMin <= 90)) return null
    if (!Number.isFinite(deferredForm.budgetInr) || deferredForm.budgetInr < 0 || deferredForm.budgetInr > 100000 || (deferredForm.previewAt && !fromIstInput(deferredForm.previewAt))) return null
    if (shared?.blocked) return null
    const request = toRequest(deferredForm)
    return shared?.planId ? rebuildPlan(dataset, request, now, shared.planId) : plan(dataset, request, now)
    // `now` changes every 30 s; planning is fast enough to simply re-run.
  }, [dataset, deferredForm, shared, now])

  const plans = useMemo(() => result?.plans ?? [], [result])
  // If the chosen plan disappears (inputs changed), fall back to the best one.
  const selected = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null

  // Keep the address bar as a shareable link to the selected plan.
  const shareHash = dataset && deferredForm && selected
    ? encodeShare({
        datasetVersion: dataset.datasetVersion,
        request: toRequest(deferredForm),
        planId: selected.id,
        ...(deferredForm.previewAt ? { at: now.toISOString() } : {}),
      })
    : ''
  useEffect(() => {
    const url = `${window.location.pathname}${window.location.search}${shareHash}`
    if (!dataset || !form || shared || form !== deferredForm) return
    if (window.location.hash !== shareHash) window.history.replaceState(null, '', url)
  }, [shareHash, dataset, form, deferredForm, shared])
  const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${shareHash}`

  const startSec = result?.context ? toIst(now).secondOfDay : null
  const onSelect = useCallback((id: string) => {
    setSelectedId(id)
    setHoveredId(null)
  }, [])

  const saveCurrent = () => {
    if (!selected || !shareHash) return
    const status = savePlan({ hash: shareHash, name: selected.name, savedAt: new Date().toISOString() })
    notify(status === 'saved' ? 'Walk saved on this device' : status === 'full' ? 'Saved walks are full. Remove one to make room.' : 'Storage is unavailable in this browser')
    setSavedPlans(listSavedPlans())
  }

  const removeSaved = (hash: string) => {
    const ok = removeSavedPlan(hash)
    notify(ok ? 'Saved walk removed' : 'Storage is unavailable in this browser')
    setSavedPlans(listSavedPlans())
  }

  const changeView = (next: 'list' | 'map') => {
    setView(next)
    document.getElementById(`view-${next}`)?.focus()
  }

  if (loadError) {
    return (
      <main className="panel">
        <p className="notice danger" role="alert">{loadError}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Reload campus data</button>
      </main>
    )
  }
  if (!dataset || !form) {
    return (
      <main className="panel" aria-busy="true">
        <Backdrop />
        <p className="hint">Loading campus map…</p>
      </main>
    )
  }

  const map = (
    <RouteMap dataset={dataset} plans={plans} selectedId={selected?.id ?? null} hoveredId={hoveredId} startSec={startSec} onSelect={onSelect} />
  )
  const blocker = result?.blockers[0]
  const isDemo = dataset.isFixture

  return (
    <>
      <Backdrop />
      <a className="skip-link" href="#outings" onClick={(e) => { e.preventDefault(); document.getElementById('outings')?.focus() }}>Skip to suggested walks</a>
      <div className="app">
        <main className="panel">
          <header className="brand">
            <div className="logo" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M5 18c-2-4 0-9 4-11s9-1 10 3-2 7-6 7-5-3-3-5 4-1 4 1" />
                <circle cx="5" cy="18" r="1.6" fill="currentColor" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <p className="eyebrow">MIT Manipal · On foot</p>
              <h1>Campus Loops</h1>
            </div>
          </header>
          <div className="intro">
            <p className="intro-title">A little time.<br />A good walk.</p>
            <p>Pick your company, your budget, and the time you have. Find a way out—and back.</p>
          </div>
          {isDemo && (
            <details className="demo-note">
              <summary>Public demo · Check before you go</summary>
              <span>
                <b>Demo data.</b> Paths and places come from OpenStreetMap and haven't been walked or checked yet. Prices and some opening
                hours are placeholders. Check before you go.
              </span>
              {dataset.datasetVersion.startsWith('manipal-demo-') && <p>
                Map snapshot: <time dateTime={osmSnapshot.retrievedAt.slice(0, 10)}>{osmSnapshot.retrievedAt.slice(0, 10)}</time>.
                {' '}Checked against OpenStreetMap on <time dateTime={osmSnapshot.checkedLiveOn}>{osmSnapshot.checkedLiveOn}</time>.
                {' '}Starts and stops use nearby mapped paths; entrances, gates, steps and shelter still need local checks.
                {' '}<a href="https://www.openstreetmap.org/#map=16/13.3475/74.7925" target="_blank" rel="noopener noreferrer">View the source map</a>.
              </p>}
            </details>
          )}

          {form.previewAt && !previewError && (
            <div className="preview-notice" role="status">
              <span><b>Previewing a future or past walk</b><small>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(fromIstInput(form.previewAt)!)} IST</small></span>
              <button type="button" className="btn ghost" onClick={() => update({ previewAt: '' })}>Plan from now</button>
            </div>
          )}

          <PlanForm dataset={dataset} state={form} onChange={update} durationError={durationError} budgetError={budgetError} previewError={previewError} />

          {savedPlans.length > 0 && (
            <details className="more saved-walks card">
              <summary>Saved walks <span className="count">{savedPlans.length}</span></summary>
              <p className="hint">Only on this device. Opening a saved walk checks it again. Preview walks keep their chosen date.</p>
              <ul>
                {savedPlans.map((s) => (
                  <li key={s.hash}>
                    <button type="button" className="saved-open" onClick={() => { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${s.hash}`); applyLink(dataset, s.hash) }}>{s.name}</button>
                    <button type="button" className="btn ghost" aria-label={`Remove saved walk: ${s.name}`} onClick={() => removeSaved(s.hash)}>Remove</button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <section id="outings" tabIndex={-1} aria-label="Suggested outings" className="outings" aria-busy={form !== deferredForm}>
            <div className="results-heading"><h2>Your way out</h2><span role="status">{plans.length ? `${plans.length} walk${plans.length === 1 ? '' : 's'} found` : 'Let’s find your walk'}</span></div>
            {shared?.note && <div className="notice"><p>{shared.note}</p>{shared.blocked && <button type="button" className="btn" onClick={() => { setShared(null); setForm(initialForm(dataset)) }}>Plan again</button>}</div>}
            {shared?.planId && plans.length > 0 && <p className="notice"><span>Showing a shared plan, checked again just now.</span></p>}

            {result?.context && (
              <p className="context" aria-live="polite">
                <span>Leaving <b>{result.context.nowIst}</b>{form.previewAt ? ' (preview)' : ''}</span>
                {result.context.availableSec > 0 && <span>Back by <b>{result.context.deadlineIst}</b> · {REASON[result.context.deadlineReason]}</span>}
                <span>Sunset {result.context.sunsetIst}</span>
              </p>
            )}

            {blocker && (
              <div className={`notice ${blocker.code === 'PLAN_OUTDATED' ? '' : 'danger'}`} role="alert">
                <p>{blocker.message}</p>
                {['AFTER_SUNSET', 'OUTSIDE_WINDOW', 'BEFORE_SUNRISE'].includes(blocker.code) && (
                  <div className="row">
                    <button type="button" className="btn" onPointerDown={ripple} onClick={() => update({ previewAt: previewTomorrowAt(realNow, 10) })}>
                      Preview tomorrow 10:00
                    </button>
                    <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => update({ previewAt: previewTomorrowAt(realNow, 17) })}>
                      Tomorrow 17:00
                    </button>
                  </div>
                )}
                {blocker.code === 'PLAN_OUTDATED' && (
                  <div className="row">
                    <button type="button" className="btn primary" onPointerDown={ripple} onClick={() => setShared(null)}>Plan again</button>
                  </div>
                )}
              </div>
            )}

            {plans.length > 0 && (
              <div className="view-switch" role="tablist" aria-label="View">
                {(['list', 'map'] as const).map((v) => <button key={v} id={`view-${v}`} type="button" role="tab" aria-controls={`${v}-view`} tabIndex={view === v ? 0 : -1} aria-selected={view === v} onClick={() => setView(v)} onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); changeView(e.key === 'Home' ? 'list' : e.key === 'End' ? 'map' : view === 'list' ? 'map' : 'list') } }}>{v === 'list' ? 'Itineraries' : 'Map'}</button>)}
              </div>
            )}
            {!wide && <div id="map-view" role="tabpanel" aria-labelledby="view-map" hidden={view !== 'map' || plans.length === 0}>
              {view === 'map' && plans.length > 0 && <><p className="map-caption">{selected?.name} · Switch to Itineraries to choose another walk.</p><div className="map-inline">{map}</div></>}
            </div>}

            <div className="plans" id="list-view" role={wide ? undefined : 'tabpanel'} aria-labelledby={wide ? undefined : 'view-list'} hidden={!wide && view !== 'list' && plans.length > 0}>
              {plans.map((p, i) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  index={i}
                  dataset={dataset}
                  selected={p.id === selected?.id}
                  startSec={startSec ?? 0}
                  startAt={now}
                  pace={deferredForm?.pace ?? form.pace}
                  shareUrl={shareUrl}
                  onSelect={() => onSelect(p.id)}
                  onHover={(h) => setHoveredId(h && p.id !== selected?.id ? p.id : null)}
                  notify={notify}
                  onLogged={() => setLogCount(listLogs().length)}
                  onSave={saveCurrent}
                  saved={savedPlans.some((s) => s.hash === shareHash) && p.id === selected?.id}
                />
              ))}
            </div>
          </section>

          <footer className="foot">
            <p>{dataset.licence}</p>
            <p>
              Map attribution is shown on the map. The tile provider sees your IP address and the map area you view. Shared links contain the
              start point, route and preferences. Saved walks and calibration logs stay on this device. No accounts or analytics.
            </p>
            <details className="more calib">
              <summary>Calibration log ({logCount})</summary>
              <p className="hint">{calibrationSummaryText(listLogs())}</p>
              <div className="row">
                <button type="button" className="btn" onPointerDown={ripple} onClick={() => download('campus-loops-walks.json', 'application/json', exportLogsJson())}>
                  Export JSON
                </button>
                <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => { const ok = clearLogs(); setLogCount(listLogs().length); notify(ok ? 'Calibration log cleared' : 'Storage is unavailable in this browser') }}>
                  Clear
                </button>
                <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => setLogCount(listLogs().length)}>Refresh</button>
              </div>
            </details>
            <p>Data version {dataset.datasetVersion}. Daylight outings only. Times are India Standard Time.</p>
            <p><a href="https://github.com/Deftsalt-debug/campus-loops/issues" target="_blank" rel="noopener noreferrer">Report a path, price, or app issue</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Map data licence</a></p>
          </footer>
        </main>
        {wide && <aside className="map-pane" aria-label="Map"><div className="map-heading"><span className="eyebrow">Explore the neighbourhood</span><b>{selected?.name ?? 'Your walk starts here'}</b><span>Start and finish together. Numbered pins follow your itinerary.</span></div><div className="map-frame">{map}</div></aside>}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  )
}

function previewTomorrowAt(now: Date, hour: number): string {
  const ist = toIst(now)
  const today = new Date(Date.UTC(ist.year, ist.month - 1, ist.day, hour, 0) - 330 * 60_000)
  return istInputValue(new Date(today.getTime() + 86_400_000))
}
