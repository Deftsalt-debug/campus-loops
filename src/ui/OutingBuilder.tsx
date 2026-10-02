import { memo, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { DEFAULT_CONFIG } from '../core/planner/config'
import { OCCASION_IDS, OCCASIONS } from '../core/planner/occasions'
import type { Dataset, Occasion, PlaceCategory } from '../core/types'
import { CATEGORY_LABEL, findCampusPlaces, stopTimeError, toggleRequiredPlace, unconfirmedPlaceDetails, updateStopTime } from './campusPlaces'
import { ripple, spotlight } from './effects'
import { fromIstInput, rupees } from './format'
import { Icon } from './icons'
import { adjustedOptions, budgetPhrase, durationPhrase, OCCASION_PHRASE } from './outing'
import type { FormState } from './planningState'
import './OutingBuilder.css'
import './stopTimes.css'

const DURATIONS = [30, 45, 60, 90]
const BUDGETS = [0, 100, 200, 300]
const BUFFERS = [0, 5, 10, 15, 20, 30]

type Editor = 'occasion' | 'start' | 'duration' | 'budget' | 'stops' | 'options'

const EDITOR_TITLE: Record<Editor, string> = {
  occasion: "What's the occasion?",
  start: 'Start and finish at',
  duration: 'Time you have',
  budget: 'Budget per person',
  stops: 'Must-visit stops',
  options: 'Options',
}

interface Props {
  dataset: Dataset
  state: FormState
  onChange: (patch: Partial<FormState>) => void
  durationError: string | null
  budgetError: string | null
  previewError: string | null
}

/**
 * Step 1. The outing reads as a sentence; each underlined phrase opens a small
 * editor in the tray below. Results update live, so there is no submit step.
 */
export const OutingBuilder = memo(function OutingBuilder({ dataset, state, onChange, durationError, budgetError, previewError }: Props) {
  const [open, setOpen] = useState<Editor | null>(null)
  // The tray keeps showing its last editor while it collapses.
  const [shown, setShown] = useState<Editor>('occasion')
  const trayId = useId()
  const tray = useRef<HTMLDivElement>(null)
  const tokens = useRef<Partial<Record<Editor, HTMLButtonElement | null>>>({})
  const openedBy = useRef<Editor | null>(null)

  const close = (refocus = true) => {
    const was = openedBy.current
    openedBy.current = null
    setOpen(null)
    if (refocus && was) tokens.current[was]?.focus({ preventScroll: true })
  }
  const toggle = (editor: Editor) => {
    if (open === editor) { close(); return }
    openedBy.current = editor
    setShown(editor)
    setOpen(editor)
  }

  // Move focus into the editor that just opened and bring it into view.
  useEffect(() => {
    if (!open || !tray.current) return
    const el = tray.current
    // Prefer the current choice, then the first control. (A selector list would match in document order.)
    const target = el.querySelector<HTMLElement>('.tray-card [aria-checked="true"], .tray-card [aria-pressed="true"]')
      ?? el.querySelector<HTMLElement>('.tray-card input, .tray-card select, .tray-card button:not(.tray-done)')
    target?.focus({ preventScroll: true })
    const t = window.setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 260)
    return () => window.clearTimeout(t)
  }, [open])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); close() }
  }

  const start = dataset.starts.find((s) => s.id === state.startId)
  const mustCount = state.required.filter(Boolean).length
  const adjusted = adjustedOptions(state)
  const errorId = `${trayId}-error`
  const sentenceError = (open !== 'duration' ? durationError : null) ?? (open !== 'budget' ? budgetError : null)
    ?? (open !== 'options' && previewError ? `Preview time: ${previewError}` : null)
  const token = (editor: Editor, label: string, value: string, invalid = false) => (
    <button
      ref={(el) => { tokens.current[editor] = el }}
      type="button"
      className="token"
      aria-expanded={open === editor}
      aria-controls={trayId}
      aria-describedby={invalid ? errorId : undefined}
      data-invalid={invalid || undefined}
      onClick={() => toggle(editor)}
    >
      <span className="sr-only">{label}: </span>
      <span key={value} className="token-value">{value}</span>
    </button>
  )

  return (
    <form className="builder" onSubmit={(e) => e.preventDefault()} onKeyDown={onKeyDown} aria-label="Describe your outing">
      <p className="sentence">
        Out {token('occasion', 'Occasion', OCCASION_PHRASE[state.occasion])}{' '}
        from {token('start', 'Start and finish at', start?.name ?? 'somewhere')}{' '}
        for {token('duration', 'Time you have', durationPhrase(state.durationMin), Boolean(durationError))},{' '}
        spending {token('budget', 'Budget per person', budgetPhrase(state.budgetInr), Boolean(budgetError))}.
      </p>
      {/* Errors stay visible with the tray closed; the editor shows its own while open. */}
      {sentenceError && <p className="error" id={errorId} role="alert">{sentenceError}</p>}

      <div className="tune-row" role="group" aria-label="Fine-tune">
        <button type="button" className="chip tune" aria-pressed={state.requireCafe} onPointerDown={ripple} onClick={() => onChange({ requireCafe: !state.requireCafe })}>
          <Icon name={state.requireCafe ? 'check' : 'coffee'} size={16} />Café stop
        </button>
        <button ref={(el) => { tokens.current.stops = el }} type="button" className="chip tune" aria-expanded={open === 'stops'} aria-controls={trayId} onPointerDown={ripple} onClick={() => toggle('stops')}>
          <Icon name="pin" size={16} />{mustCount ? `${mustCount} must-visit${mustCount > 1 ? 's' : ''}` : 'Must-visit'}
        </button>
        <button ref={(el) => { tokens.current.options = el }} type="button" className="chip tune" aria-expanded={open === 'options'} aria-controls={trayId} onPointerDown={ripple} onClick={() => toggle('options')}>
          <Icon name="sliders" size={16} />Options
          {adjusted.length > 0 && <span className="tune-badge" aria-label={`${adjusted.length} changed`}>{adjusted.length}</span>}
        </button>
      </div>
      {adjusted.length > 0 && open !== 'options' && <p className="tune-summary">{adjusted.join(' · ')}</p>}

      {state.previewAt && !previewError && (
        <div className="preview-notice" role="status">
          <span><b>Previewing</b> {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(fromIstInput(state.previewAt)!)} IST</span>
          <button type="button" className="btn small" onPointerDown={ripple} onClick={() => onChange({ previewAt: '' })}>Plan from now</button>
        </div>
      )}

      <div ref={tray} id={trayId} className={`tray${open ? ' is-open' : ''}`} inert={!open} role="region" aria-label={EDITOR_TITLE[shown]}>
        <div className="tray-clip">
          <section key={shown} className="tray-card card spot" onPointerMove={spotlight}>
            <header className="tray-head">
              <h3>{EDITOR_TITLE[shown]}</h3>
              <button type="button" className="tray-done" onClick={() => close()}>Done</button>
            </header>
            {shown === 'occasion' && <OccasionEditor value={state.occasion} onPick={(id, done) => { onChange({ occasion: id, ...OCCASIONS[id].defaults }); if (done) close() }} />}
            {shown === 'start' && (
              <RadioList
                label="Start and finish"
                options={dataset.starts.map((s) => ({ id: s.id, label: s.name }))}
                value={state.startId}
                onPick={(id, done) => { onChange({ startId: id }); if (done) close() }}
              />
            )}
            {shown === 'duration' && (
              <NumberChoice
                id="duration" label="Minutes" unit="min" choices={DURATIONS} value={state.durationMin} min={30} max={90} step={1}
                format={(d) => `${d} min`} error={durationError} hint="Between 30 and 90 minutes, including stops and your return buffer."
                onPick={(v, done) => { onChange({ durationMin: v }); if (done) close() }}
              />
            )}
            {shown === 'budget' && (
              <NumberChoice
                id="budget" label="Budget in rupees" unit="₹" choices={BUDGETS} value={state.budgetInr} min={0} max={100000} step={10}
                format={(b) => (b === 0 ? 'Free' : `₹${b}`)} error={budgetError} hint="Per person. Prices in this demo are estimates."
                onPick={(v, done) => { onChange({ budgetInr: v }); if (done) close() }}
              />
            )}
            {shown === 'stops' && <StopsEditor dataset={dataset} state={state} onChange={onChange} />}
            {shown === 'options' && <OptionsEditor dataset={dataset} state={state} onChange={onChange} previewError={previewError} />}
          </section>
        </div>
      </div>
    </form>
  )
})

// ---------- Editors ----------

function rovingRadios<T extends string>(ids: readonly T[], idFor: (id: T) => string, onPick: (id: T, done: boolean) => void) {
  return (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key]
    if (!delta && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next = ids[e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + delta + ids.length) % ids.length]
    onPick(next, false)
    document.getElementById(idFor(next))?.focus()
  }
}

function OccasionEditor({ value, onPick }: { value: Occasion; onPick: (id: Occasion, done: boolean) => void }) {
  const move = rovingRadios(OCCASION_IDS, (id) => `mode-${id}`, onPick)
  return (
    <div className="modes" role="radiogroup" aria-label="Occasion">
      {OCCASION_IDS.map((id, i) => {
        const checked = value === id
        return (
          <button key={id} id={`mode-${id}`} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
            className="mode" style={{ '--i': i } as CSSProperties} onPointerDown={ripple} onClick={() => onPick(id, true)} onKeyDown={(e) => move(e, i)}>
            <strong>{OCCASIONS[id].label}</strong>
            <span>{OCCASIONS[id].blurb}</span>
          </button>
        )
      })}
    </div>
  )
}

function RadioList({ label, options, value, onPick }: { label: string; options: { id: string; label: string }[]; value: string; onPick: (id: string, done: boolean) => void }) {
  const base = useId()
  const ids = options.map((o) => o.id)
  const move = rovingRadios(ids, (id) => `${base}-${ids.indexOf(id)}`, onPick)
  return (
    <div className="radio-list" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const checked = o.id === value
        return (
          <button key={o.id} id={`${base}-${i}`} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
            className="radio-item" style={{ '--i': i } as CSSProperties} onPointerDown={ripple} onClick={() => onPick(o.id, true)} onKeyDown={(e) => move(e, i)}>
            <span className="radio-dot" aria-hidden="true" />{o.label}
          </button>
        )
      })}
    </div>
  )
}

function NumberChoice({ id, label, unit, choices, value, min, max, step, format, error, hint, onPick }: {
  id: string; label: string; unit: string; choices: number[]; value: number; min: number; max: number; step: number
  format: (v: number) => string; error: string | null; hint: string; onPick: (v: number, done: boolean) => void
}) {
  return (
    <div className="field">
      <div className="row" role="group" aria-label={label}>
        {choices.map((c, i) => (
          <button key={c} type="button" className="chip" style={{ '--i': i } as CSSProperties} aria-pressed={value === c} onPointerDown={ripple} onClick={() => onPick(c, true)}>{format(c)}</button>
        ))}
        <label className="custom-number">
          <span className="sr-only">{label}, custom</span>
          <span aria-hidden="true">{unit === '₹' ? '₹' : 'Other'}</span>
          <input id={id} className="input small" type="number" inputMode="numeric" min={min} max={max} step={step}
            value={Number.isFinite(value) ? value : ''} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            onChange={(e) => onPick(e.target.value === '' ? NaN : Number(e.target.value), false)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !error) { e.preventDefault(); onPick(value, true) } }} />
          {unit !== '₹' && <span aria-hidden="true">{unit}</span>}
        </label>
      </div>
      {error && <p className="error" id={`${id}-error`}>{error}</p>}
      <p className="hint" id={`${id}-hint`}>{hint}</p>
    </div>
  )
}

function StopsEditor({ dataset, state, onChange }: { dataset: Dataset; state: FormState; onChange: (patch: Partial<FormState>) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PlaceCategory | 'all'>('all')
  const matches = findCampusPlaces(dataset.places, query, category)
  const chosen = state.required.filter(Boolean).flatMap((id) => dataset.places.filter((p) => p.id === id))
  const full = state.required.every(Boolean)
  // Keep custom times from shared links visible and editable, including when
  // their place is no longer a must-visit, so invalid edits stay recoverable.
  const timedIds = new Set([...state.required.filter(Boolean), ...Object.keys(state.dwellOverridesMin ?? {})])
  const timed = [...timedIds].flatMap((id) => dataset.places.filter((p) => p.id === id))

  return (
    <div className="form">
      <div className="chosen-stops" aria-live="polite">
        {chosen.length === 0 ? <p className="hint">Add up to two places the walk must include. The planner checks whether they fit.</p>
          : chosen.map((p) => (
            <span key={p.id} className="stop-chip">
              <Icon name="pin" size={14} />{p.name}
              <button type="button" aria-label={`Remove ${p.name} from must-visits`} onClick={() => onChange({ required: toggleRequiredPlace(state.required, p.id) })}><Icon name="close" size={14} /></button>
            </span>
          ))}
      </div>

      {timed.length > 0 && (
        <fieldset className="stop-times" aria-describedby="stop-times-hint">
          <legend>Time at your stops</legend>
          <p className="hint" id="stop-times-hint">Walking time is added separately. Set 0 to pass by without stopping.</p>
          {timed.map((place, index) => {
            const custom = Object.hasOwn(state.dwellOverridesMin ?? {}, place.id)
            const minutes = custom ? state.dwellOverridesMin![place.id] : place.dwellDefaultMin
            const error = stopTimeError(minutes)
            const id = `stop-time-${index}`
            return (
              <div className="field stop-time" key={place.id}>
                <label htmlFor={id}>{place.name} · minutes</label>
                <div className="row">
                  <input id={id} className="input small" type="number" inputMode="decimal" min={0} max={DEFAULT_CONFIG.maxDwellMin} step="any"
                    value={Number.isFinite(minutes) ? minutes : ''} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
                    onChange={(e) => onChange({ dwellOverridesMin: updateStopTime(state.dwellOverridesMin, place.id, e.target.value) })} />
                  <button type="button" className="btn ghost small" disabled={!custom} aria-label={`Reset ${place.name} to the default ${place.dwellDefaultMin} minutes`}
                    onClick={() => onChange({ dwellOverridesMin: updateStopTime(state.dwellOverridesMin, place.id, null) })}>Default · {place.dwellDefaultMin}m</button>
                </div>
                <p className="hint" id={`${id}-hint`}>{!state.required.includes(place.id) ? 'Applies if this place is included. ' : ''}{minutes === 0 && place.category === 'cafe' ? 'Passing by does not count as a café or food stop.' : `Default visit: ${place.dwellDefaultMin} minutes.`}</p>
                {error && <p className="error" id={`${id}-error`} role="alert">{error}</p>}
              </div>
            )
          })}
        </fieldset>
      )}

      <div className="search-field">
        <Icon name="search" size={16} />
        <label className="sr-only" htmlFor="place-search">Search campus places</label>
        <input id="place-search" className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Food, library, quiet…" />
      </div>
      <div className="row" role="group" aria-label="Filter campus places">
        {(['all', 'cafe', 'seating', 'landmark'] as const).map((c) => (
          <button key={c} type="button" className="chip small" aria-pressed={category === c} onClick={() => setCategory(c)}>{c === 'all' ? 'All' : CATEGORY_LABEL[c]}</button>
        ))}
      </div>
      <p className="hint" role="status">{matches.length} place{matches.length === 1 ? '' : 's'} · {chosen.length} of 2 chosen{full ? '. Remove one to choose another.' : ''}</p>
      {matches.length === 0 ? <p className="hint">Try a different name, interest, or category.</p> : (
        <ul className="campus-places">
          {matches.map((place, i) => {
            const isChosen = state.required.includes(place.id)
            const unavailable = unconfirmedPlaceDetails(place)
            return (
              <li key={place.id} style={{ '--i': Math.min(i, 8) } as CSSProperties}>
                <div>
                  <b>{place.name}</b>
                  <small>{CATEGORY_LABEL[place.category]} · {place.spendLowInr === null || place.spendHighInr === null ? 'Price unconfirmed' : `${rupees(place.spendLowInr, place.spendHighInr)}${place.spendHighInr > 0 ? ' estimate' : ''}`}</small>
                  <small>{unavailable ? `${unavailable}; unavailable for planning.` : place.tags.slice(0, 3).join(' · ')}</small>
                </div>
                <button type="button" className={`add-stop${isChosen ? ' is-on' : ''}`} aria-label={`${isChosen ? 'Remove' : 'Add'} ${place.name} ${isChosen ? 'from' : 'to'} must-visits`}
                  aria-pressed={isChosen} disabled={!isChosen && (Boolean(unavailable) || full)} onClick={() => onChange({ required: toggleRequiredPlace(state.required, place.id) })}>
                  <Icon name={isChosen ? 'check' : 'plus'} size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="hint">Descriptions and prices come from the campus dataset. Confirm opening hours and facilities locally.</p>
    </div>
  )
}

function OptionsEditor({ dataset, state, onChange, previewError }: { dataset: Dataset; state: FormState; onChange: (patch: Partial<FormState>) => void; previewError: string | null }) {
  const bufferMin = state.bufferMin ?? DEFAULT_CONFIG.defaultBufferMin
  return (
    <div className="form">
      <Field label="Pace" id="pace-label">
        <div className="row" role="group" aria-labelledby="pace-label">
          {(['relaxed', 'normal'] as const).map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={state.pace === p} onPointerDown={ripple} onClick={() => onChange({ pace: p })}>{p === 'relaxed' ? 'Relaxed' : 'Normal'}</button>
          ))}
        </div>
      </Field>
      <div className="two">
        <div className="field">
          <label htmlFor="backby">Back by (optional)</label>
          <input id="backby" className="input" type="time" value={state.backBy} aria-describedby="backby-hint" onChange={(e) => onChange({ backBy: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="return-buffer">Return buffer</label>
          <select id="return-buffer" className="input" value={bufferMin} aria-describedby="return-buffer-hint" onChange={(e) => onChange({ bufferMin: Number(e.target.value) })}>
            {!BUFFERS.includes(bufferMin) && <option value={bufferMin}>{bufferMin} minutes (from shared walk)</option>}
            {BUFFERS.map((m) => <option key={m} value={m}>{m === 0 ? 'No buffer' : `${m} minutes${m === DEFAULT_CONFIG.defaultBufferMin ? ' (default)' : ''}`}</option>)}
          </select>
        </div>
      </div>
      <p className="hint" id="backby-hint">For hostel in-times or a class. Plans always end before sunset.</p>
      <p className="hint" id="return-buffer-hint">The buffer covers queues, gates, or reaching class after returning, and is included in the time you have.</p>
      <label className="switch">
        <span>Avoid steps<small>Excludes paths marked with steps. Not a wheelchair-access guarantee.</small></span>
        <input type="checkbox" checked={state.avoidSteps} onChange={(e) => onChange({ avoidSteps: e.target.checked })} />
      </label>
      <label className="switch">
        <span>Rain mode<small>Prefers covered paths and sheltered stops. Must-visit places may be unsheltered.</small></span>
        <input type="checkbox" checked={state.rain} onChange={(e) => onChange({ rain: e.target.checked })} />
      </label>
      {dataset.isFixture && <p className="hint">Steps and path cover have not been surveyed in this demo. Check the route before relying on these options.</p>}
      <div className="field">
        <label htmlFor="preview">Plan as if it's… (preview)</label>
        <div className="row">
          <input id="preview" className="input" style={{ flex: 1 }} type="datetime-local" value={state.previewAt} aria-invalid={Boolean(previewError)}
            aria-describedby={previewError ? 'preview-error' : 'preview-hint'} onChange={(e) => onChange({ previewAt: e.target.value })} />
          {state.previewAt && <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => onChange({ previewAt: '' })}>Use now</button>}
        </div>
        {previewError && <p className="error" id="preview-error">{previewError}</p>}
        <p className="hint" id="preview-hint">Times are India Standard Time. Leave empty to plan from right now.</p>
      </div>
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <div className="field"><span className="label" id={id}>{label}</span>{children}</div>
}
