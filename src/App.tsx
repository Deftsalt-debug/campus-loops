import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { DatasetError, loadDataset } from './core/dataset/load'
import { plan, rebuildPlan } from './core/planner/plan'
import { decodeShare, encodeShare } from './core/share'
import { toIst } from './core/time/clock'
import type { Dataset, PlanResult } from './core/types'
import { listLogs } from './storage/calibrationLog'
import { listSavedPlans, removeSavedPlan, savePlan } from './storage/savedPlans'
import { AboutPanel } from './ui/AboutPanel'
import { Backdrop } from './ui/Backdrop'
import { Drawer, type DrawerTab } from './ui/Drawer'
import { ripple } from './ui/effects'
import { FieldNotebook } from './ui/FieldNotebook'
import { fromIstInput, istInputValue } from './ui/format'
import { useMediaQuery } from './ui/hooks'
import { Icon, LoopMark } from './ui/icons'
import { MapDock } from './ui/MapDock'
import { OutingBuilder } from './ui/OutingBuilder'
import { PlanComparison } from './ui/PlanComparison'
import { initialForm, sharedForm, toRequest, type FormState } from './ui/planningState'
import type { StopFocus } from './ui/RouteMap'
import { SavedWalks } from './ui/SavedWalks'
import { WalkChooser } from './ui/WalkChooser'
import { WalkDetail } from './ui/WalkDetail'

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

const smooth = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [shared, setShared] = useState<{ planId: string; note: string | null; blocked?: boolean } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focus, setFocus] = useState<StopFocus | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [drawer, setDrawer] = useState<DrawerTab | null>(null)
  const [toast, setToast] = useState<{ text: string; id: number; on: boolean } | null>(null)
  const [savedBump, setSavedBump] = useState(0)
  const [logCount, setLogCount] = useState(() => listLogs().length)
  const [savedPlans, setSavedPlans] = useState(listSavedPlans)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const realNow = useNow(30_000)
  // The panel and map sit side by side from this width; below it they stack.
  const wide = useMediaQuery('(min-width: 960px)')

  const applyLink = useCallback((ds: Dataset, hash: string) => {
    const decoded = decodeShare(hash)
    setSelectedId(null)
    setHoveredId(null)
    setFocus(null)
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
    setToast((t) => ({ text: message, id: (t?.id ?? 0) + 1, on: true }))
    if (toastTimer.current) clearTimeout(toastTimer.current)
    // Keep the text while it fades out; the live region only announces new text.
    toastTimer.current = setTimeout(() => setToast((t) => (t ? { ...t, on: false } : t)), 3500)
  }, [])

  const update = useCallback((patch: Partial<FormState>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setShared(null) // editing leaves shared-link mode
  }, [])

  // ---- Plan (deferred so typing and tapping stay instant) ----
  const deferredForm = useDeferredValue(form)
  const pending = form !== deferredForm
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
  // The card a person taps answers immediately; the map and itinerary follow in
  // a deferred render, so the press paints first and the heavier work never delays it.
  const deferredSelectedId = useDeferredValue(selectedId)
  // If the chosen plan disappears (inputs changed), fall back to the best one.
  const chosen = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null
  const selected = plans.find((p) => p.id === deferredSelectedId) ?? plans[0] ?? null
  const selectedIndex = selected ? plans.indexOf(selected) : -1
  const activeFocus = focus && focus.planId === selected?.id ? focus : null

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
    setFocus((f) => (f?.planId === id ? f : null))
  }, [])
  const onFocusStop = useCallback((next: StopFocus | null) => setFocus(next), [])

  // "Show on map" from the itinerary: on a phone the map is above, so bring it into view.
  useEffect(() => {
    if (!activeFocus?.reveal || wide) return
    const dock = document.querySelector('.map-dock')
    if (!dock) return
    const r = dock.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight) dock.scrollIntoView({ block: 'center', behavior: smooth() })
  }, [activeFocus, wide])

  const selectedName = selected?.name
  const saveCurrent = useCallback(() => {
    if (!selectedName || !shareHash) return
    const status = savePlan({ hash: shareHash, name: selectedName, savedAt: new Date().toISOString() })
    notify(status === 'saved' ? 'Walk saved on this device' : status === 'full' ? 'Saved walks are full. Remove one to make room.' : status === 'corrupt' ? 'Saved walks need repair. Open Saved walks to export readable entries and repair.' : 'Storage is unavailable in this browser')
    if (status === 'saved') setSavedBump((n) => n + 1)
    setSavedPlans(listSavedPlans())
  }, [selectedName, shareHash, notify])
  const refreshLogs = useCallback(() => setLogCount(listLogs().length), [])

  const removeSaved = (hash: string) => {
    const ok = removeSavedPlan(hash)
    notify(ok ? 'Saved walk removed' : 'The saved walk could not be removed. Open Saved walks for storage or repair details.')
    setSavedPlans(listSavedPlans())
  }

  if (loadError) {
    return (
      <main className="panel solo">
        <p className="notice danger" role="alert">{loadError}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Reload campus data</button>
      </main>
    )
  }
  if (!dataset || !form) {
    return (
      <main className="panel solo loading" aria-busy="true">
        <Backdrop />
        <span className="loading-mark"><LoopMark size={34} /></span>
        <p className="hint">Loading campus map…</p>
      </main>
    )
  }

  const blocker = result?.blockers[0]
  const isDemo = dataset.isFixture
  const startName = dataset.starts.find((s) => s.id === (deferredForm ?? form).startId)?.name ?? 'Campus'

  return (
    <>
      <Backdrop />
      <a className="skip-link" href="#outings" onClick={(e) => { e.preventDefault(); document.getElementById('outings')?.focus() }}>Skip to suggested walks</a>
      <div className="app">
        <main className="panel">
          <header className="topbar">
            <div className="brand">
              <div className="logo" aria-hidden="true"><LoopMark /></div>
              <div>
                <p className="eyebrow">MIT Manipal · On foot</p>
                <h1>Campus Loops</h1>
              </div>
            </div>
            <nav className="topbar-actions" aria-label="Your things">
              {isDemo && <button type="button" className="demo-pill" aria-label="Demo data: about this data" onClick={() => setDrawer('about')}><Icon name="info" size={14} />Demo<span className="demo-word">&nbsp;data</span></button>}
              <button type="button" className="icon-btn" onClick={() => setDrawer('saved')} aria-label={`Saved walks, ${savedPlans.length}`}>
                <Icon name="bookmark" />
                {savedPlans.length > 0 && <span key={savedBump} className={`icon-count${savedBump ? ' bump' : ''}`}>{savedPlans.length}</span>}
              </button>
              <button type="button" className="icon-btn" onClick={() => setDrawer('notes')} aria-label="Field notebook, privacy and data"><Icon name="menu" /></button>
            </nav>
          </header>

          <section className="step step-1" aria-labelledby="step-1">
            <p className="tagline">A little time. A good walk.</p>
            <h2 className="step-label" id="step-1"><span className="step-num" aria-hidden="true">1</span>Your outing</h2>
            <OutingBuilder dataset={dataset} state={form} onChange={update} durationError={durationError} budgetError={budgetError} previewError={previewError} />
          </section>

          <MapDock
            wide={wide}
            pending={pending}
            title={selected?.name ?? null}
            subtitle={selected ? `Walk ${selectedIndex + 1} · from ${startName}` : 'Explore the neighbourhood'}
            dataset={dataset}
            plans={plans}
            selectedId={selected?.id ?? null}
            hoveredId={hoveredId}
            startSec={startSec}
            focus={activeFocus}
            onSelect={onSelect}
            onHover={setHoveredId}
            onFocusStop={onFocusStop}
          />

          <section id="outings" tabIndex={-1} className="step step-2" aria-labelledby="step-2" aria-busy={pending}>
            <div className="step-head">
              <h2 className="step-label" id="step-2"><span className="step-num" aria-hidden="true">2</span>Choose a walk</h2>
              <span className="step-meta" role="status">{plans.length ? `${plans.length} walk${plans.length === 1 ? '' : 's'} found` : ''}</span>
              {plans.length >= 2 && (
                <button type="button" className="link-btn compare-toggle" aria-expanded={compareOpen} aria-controls="compare" onClick={() => setCompareOpen((v) => !v)}>
                  Compare<Icon name="chevron" size={16} />
                </button>
              )}
            </div>

            {result?.context && (
              <p className="context" aria-live="polite">
                <span>Leaving <b>{result.context.nowIst}</b>{form.previewAt ? ' (preview)' : ''}</span>
                {result.context.availableSec > 0 && <span>Back by <b>{result.context.deadlineIst}</b> · {REASON[result.context.deadlineReason]}</span>}
                <span>Sunset {result.context.sunsetIst}</span>
              </p>
            )}

            {shared?.note && <div className="notice"><p>{shared.note}</p>{shared.blocked && <button type="button" className="btn" onClick={() => { setShared(null); setForm(initialForm(dataset)) }}>Plan again</button>}</div>}
            {shared?.planId && plans.length > 0 && <p className="notice soft"><span>Showing a shared plan, checked again just now.</span></p>}

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

            {plans.length === 0 && !blocker && !shared?.note && (
              <p className="empty-state">
                {durationError || budgetError || previewError ? 'Fix the highlighted choice above to see walks.' : 'Finding walks…'}
              </p>
            )}

            {plans.length >= 2 && (
              <div id="compare" className={`reveal${compareOpen ? ' is-open' : ''}`} inert={!compareOpen}>
                <div className="reveal-clip"><PlanComparison plans={plans} selectedId={chosen?.id ?? null} onSelect={onSelect} /></div>
              </div>
            )}

            <WalkChooser dataset={dataset} plans={plans} selectedId={chosen?.id ?? null} linkedId={hoveredId} onSelect={onSelect} onHover={setHoveredId} />
          </section>

          {selected && startSec !== null && (
            <section className="step step-3" aria-labelledby="step-3">
              <h2 className="step-label" id="step-3"><span className="step-num" aria-hidden="true">3</span>Head out</h2>
              <WalkDetail
                key={selected.id}
                plan={selected}
                index={selectedIndex}
                count={plans.length}
                dataset={dataset}
                startSec={startSec}
                startAt={now}
                pace={deferredForm?.pace ?? form.pace}
                shareUrl={shareUrl}
                focus={activeFocus}
                followMap={wide}
                onFocusStop={onFocusStop}
                notify={notify}
                onLogged={refreshLogs}
                onSave={saveCurrent}
                saved={savedPlans.some((s) => s.hash === shareHash)}
              />
            </section>
          )}

          <footer className="foot">
            <p>{dataset.licence}</p>
            <p>
              <button type="button" className="link-btn" onClick={() => setDrawer('about')}>About, privacy &amp; data</button>
              {' · '}Times are IST · Daylight outings only
            </p>
          </footer>
        </main>
      </div>

      <Drawer
        tab={drawer}
        onTab={setDrawer}
        onClose={() => setDrawer(null)}
        panels={{
          saved: {
            label: 'Saved', count: savedPlans.length,
            render: () => (
              <SavedWalks savedPlans={savedPlans}
                onOpen={(hash) => { setDrawer(null); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`); applyLink(dataset, hash) }}
                onRemove={removeSaved} onImported={() => setSavedPlans(listSavedPlans())} notify={notify} />
            ),
          },
          notes: { label: 'Notebook', render: () => <FieldNotebook dataset={dataset} notify={notify} /> },
          about: { label: 'About', render: () => <AboutPanel dataset={dataset} logCount={logCount} onLogsChanged={refreshLogs} notify={notify} /> },
        }}
      />
      <div className={`toast${toast?.on ? ' is-on' : ''}`} role="status" aria-live="polite">
        {toast && <span key={toast.id}>{toast.text}</span>}
      </div>
    </>
  )
}

function previewTomorrowAt(now: Date, hour: number): string {
  const ist = toIst(now)
  const today = new Date(Date.UTC(ist.year, ist.month - 1, ist.day, hour, 0) - 330 * 60_000)
  return istInputValue(new Date(today.getTime() + 86_400_000))
}
