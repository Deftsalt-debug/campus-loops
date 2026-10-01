import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { calibrationSummaryText } from './ui/calibration'
import { DatasetError, loadDataset } from './core/dataset/load'
import { OCCASIONS } from './core/planner/occasions'
import { plan, rebuildPlan } from './core/planner/plan'
import { decodeShare, encodeShare } from './core/share'
import { toIst } from './core/time/clock'
import type { Dataset, PlanRequest, PlanResult } from './core/types'
import { clearLogs, exportLogsJson, listLogs } from './storage/calibrationLog'
import { Backdrop } from './ui/Backdrop'
import { ripple } from './ui/effects'
import { download, fromIstInput, istInputValue } from './ui/format'
import { PlanCard } from './ui/PlanCard'
import { PlanForm, type FormState } from './ui/PlanForm'
import { RouteMap } from './ui/RouteMap'

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

function initialForm(dataset: Dataset): FormState {
  return {
    startId: dataset.starts[0]?.id ?? '',
    occasion: 'friends',
    ...OCCASIONS.friends.defaults,
    required: ['', ''],
    avoidSteps: false,
    rain: false,
    backBy: '',
    previewAt: '',
  }
}

function toRequest(f: FormState): PlanRequest {
  return {
    startId: f.startId,
    occasion: f.occasion,
    durationMin: f.durationMin,
    budgetInr: f.budgetInr,
    requiredPlaceIds: f.required.filter(Boolean),
    requireCafe: f.requireCafe,
    pace: f.pace,
    avoidSteps: f.avoidSteps,
    rain: f.rain,
    ...(f.backBy ? { backBy: f.backBy } : {}),
  }
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
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [shared, setShared] = useState<{ planId: string; note: string | null } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'map'>('list')
  const [toast, setToast] = useState<string | null>(null)
  const [logCount, setLogCount] = useState(() => listLogs().length)
  const realNow = useNow(30_000)
  // One map instance only: in the side pane on wide screens, behind the Map tab on phones.
  const wide = useMediaQuery('(min-width: 960px)')

  // ---- Load the dataset, then apply a shared link if there is one ----
  useEffect(() => {
    const which = new URLSearchParams(window.location.search).get('data') === 'fixture' ? 'fixture' : 'demo'
    DATASETS[which]()
      .then((mod) => {
        const { dataset: ds } = loadDataset(mod.default)
        let f = initialForm(ds)
        const decoded = decodeShare(window.location.hash)
        if (decoded.ok) {
          const s = decoded.shared
          if (s.datasetVersion !== ds.datasetVersion) {
            setShared({ planId: '', note: 'This shared link was made with an older version of the map data, so its route may have changed. Here are fresh plans instead.' })
          } else {
            const r = s.request
            f = {
              ...f,
              startId: r.startId,
              occasion: r.occasion,
              durationMin: r.durationMin,
              budgetInr: r.budgetInr,
              pace: r.pace,
              requireCafe: r.requireCafe,
              avoidSteps: r.avoidSteps,
              rain: r.rain,
              backBy: r.backBy ?? '',
              required: [r.requiredPlaceIds[0] ?? '', r.requiredPlaceIds[1] ?? ''],
              previewAt: s.at ? istInputValue(new Date(s.at)) : '',
            }
            setShared({ planId: s.planId, note: null })
            setSelectedId(s.planId)
          }
        } else if (window.location.hash.length > 1 && decoded.reason !== 'empty') {
          setShared({ planId: '', note: `${decoded.reason} Showing fresh plans instead.` })
        }
        setDataset(ds)
        setForm(f)
      })
      .catch((err) => setLoadError(err instanceof DatasetError ? err.message : 'The map data failed to load. Check your connection and reload.'))
  }, [])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2200)
  }, [])

  const update = useCallback((patch: Partial<FormState>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setShared((s) => (s?.planId ? null : s)) // editing leaves shared-link mode
  }, [])

  // ---- Plan (deferred so typing stays smooth) ----
  const deferredForm = useDeferredValue(form)
  // Stable unless the preview time or the 30-second clock changes, so hovering doesn't re-plan.
  const previewAt = deferredForm?.previewAt ?? ''
  const now = useMemo(() => (previewAt ? fromIstInput(previewAt) ?? realNow : realNow), [previewAt, realNow])
  const durationError =
    form && !(form.durationMin >= 30 && form.durationMin <= 90) ? 'Choose between 30 and 90 minutes.' : null

  const result: PlanResult | null = useMemo(() => {
    if (!dataset || !deferredForm || !(deferredForm.durationMin >= 30 && deferredForm.durationMin <= 90)) return null
    const request = toRequest(deferredForm)
    return shared?.planId ? rebuildPlan(dataset, request, now, shared.planId) : plan(dataset, request, now)
    // `now` changes every 30 s; planning is fast enough to simply re-run.
  }, [dataset, deferredForm, shared, now])

  const plans = useMemo(() => result?.plans ?? [], [result])
  // If the chosen plan disappears (inputs changed), fall back to the best one.
  const selected = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null

  // Keep the address bar as a shareable link to the selected plan.
  const shareHash = dataset && form && selected
    ? encodeShare({
        datasetVersion: dataset.datasetVersion,
        request: toRequest(form),
        planId: selected.id,
        ...(form.previewAt ? { at: (fromIstInput(form.previewAt) ?? realNow).toISOString() } : {}),
      })
    : ''
  useEffect(() => {
    const url = `${window.location.pathname}${window.location.search}${shareHash}`
    if (shareHash && window.location.hash !== shareHash) window.history.replaceState(null, '', url)
  }, [shareHash])
  const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${shareHash}`

  const startSec = result?.context ? toIst(now).secondOfDay : null
  const onSelect = useCallback((id: string) => {
    setSelectedId(id)
    setHoveredId(null)
  }, [])

  if (loadError) {
    return (
      <main className="panel">
        <p className="notice danger" role="alert">{loadError}</p>
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
              <h1>Campus Loops</h1>
              <p>Walks around MIT Manipal that get you back in time.</p>
            </div>
          </header>
          {isDemo && (
            <p className="notice" role="note">
              <span>
                <b>Demo data.</b> Paths and places come from OpenStreetMap and haven't been walked or checked yet. Prices and some opening
                hours are placeholders. Check before you go.
              </span>
            </p>
          )}

          <PlanForm dataset={dataset} state={form} onChange={update} durationError={durationError} />

          <section aria-live="polite" aria-label="Suggested outings" style={{ display: 'grid', gap: 12 }}>
            {shared?.note && <p className="notice">{shared.note}</p>}
            {shared?.planId && plans.length > 0 && <p className="notice"><span>Showing a shared plan, checked again just now.</span></p>}

            {result?.context && (
              <p className="context">
                <span>Leaving <b>{result.context.nowIst}</b>{form.previewAt ? ' (preview)' : ''}</span>
                <span>Back by <b>{result.context.deadlineIst}</b> · {REASON[result.context.deadlineReason]}</span>
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
                <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>List</button>
                <button type="button" role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>Map</button>
              </div>
            )}
            {!wide && view === 'map' && plans.length > 0 && <div className="map-inline">{map}</div>}

            <div className="plans">
              {plans.map((p, i) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  index={i}
                  dataset={dataset}
                  selected={p.id === selected?.id}
                  startSec={startSec ?? 0}
                  pace={form.pace}
                  shareUrl={shareUrl}
                  onSelect={() => onSelect(p.id)}
                  onHover={(h) => setHoveredId(h && p.id !== selected?.id ? p.id : null)}
                  notify={notify}
                  onLogged={() => setLogCount(listLogs().length)}
                />
              ))}
            </div>
          </section>

          <footer className="foot">
            <p>{dataset.licence}</p>
            <p>
              Map tiles © OpenStreetMap contributors. The tile server sees your IP address and the map area you view. Shared links contain the
              start point, route and preferences, so they aren't private. Nothing else leaves your device.
            </p>
            <details className="more calib">
              <summary>Calibration log ({logCount})</summary>
              <p className="hint">{calibrationSummaryText(listLogs())}</p>
              <div className="row">
                <button type="button" className="btn" onPointerDown={ripple} onClick={() => download('campus-loops-walks.json', 'application/json', exportLogsJson())}>
                  Export JSON
                </button>
                <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => { clearLogs(); setLogCount(0); notify('Calibration log cleared') }}>
                  Clear
                </button>
                <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => setLogCount(listLogs().length)}>Refresh</button>
              </div>
            </details>
            <p>Data version {dataset.datasetVersion}. Daylight outings only. Times are India Standard Time.</p>
          </footer>
        </main>
        {wide && <aside className="map-pane" aria-label="Map">{map}</aside>}
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
