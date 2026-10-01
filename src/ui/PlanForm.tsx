import { useState, type KeyboardEvent } from 'react'
import { DEFAULT_CONFIG } from '../core/planner/config'
import { OCCASION_IDS, OCCASIONS } from '../core/planner/occasions'
import type { Dataset, Occasion, PlaceCategory } from '../core/types'
import { CATEGORY_LABEL, findCampusPlaces, toggleRequiredPlace, unconfirmedPlaceDetails } from './campusPlaces'
import { ripple, spotlight } from './effects'
import { rupees } from './format'
import type { FormState } from './planningState'

const DURATIONS = [30, 45, 60, 90]
const BUDGETS = [0, 100, 200, 300]
const BUFFERS = [0, 5, 10, 15, 20, 30]

interface Props {
  dataset: Dataset
  state: FormState
  onChange: (patch: Partial<FormState>) => void
  durationError: string | null
  budgetError: string | null
  previewError: string | null
}

export function PlanForm({ dataset, state, onChange, durationError, budgetError, previewError }: Props) {
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeCategory, setPlaceCategory] = useState<PlaceCategory | 'all'>('all')
  const pickMode = (id: Occasion) => onChange({ occasion: id, ...OCCASIONS[id].defaults })
  const schedulable = dataset.places.filter((p) => p.category !== 'waypoint')
  const groups = (['cafe', 'seating', 'landmark'] as const).map((c) => ({ c, places: schedulable.filter((p) => p.category === c) }))
  const matches = findCampusPlaces(dataset.places, placeQuery, placeCategory)
  const bufferMin = state.bufferMin ?? DEFAULT_CONFIG.defaultBufferMin

  const moveFocus = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!delta && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next = OCCASION_IDS[e.key === 'Home' ? 0 : e.key === 'End' ? OCCASION_IDS.length - 1 : (i + delta! + OCCASION_IDS.length) % OCCASION_IDS.length]
    pickMode(next)
    document.getElementById(`mode-${next}`)?.focus()
  }

  return (
    <form className="form" onSubmit={(e) => e.preventDefault()}>
      <section className="card spot" onPointerMove={spotlight} aria-labelledby="mode-title">
        <h2 className="section-title" id="mode-title">What's the occasion?</h2>
        <div className="modes" role="radiogroup" aria-labelledby="mode-title">
          {OCCASION_IDS.map((id, i) => {
            const m = OCCASIONS[id]
            const checked = state.occasion === id
            return (
              <button
                key={id}
                id={`mode-${id}`}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                className="mode"
                onPointerDown={ripple}
                onClick={() => pickMode(id)}
                onKeyDown={(e) => moveFocus(e, i)}
              >
                <strong>{m.label}</strong>
                <span>{m.blurb}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="card spot form" onPointerMove={spotlight} aria-label="Outing details">
        <div className="field">
          <label htmlFor="start">Start and finish at</label>
          <select id="start" className="input" value={state.startId} onChange={(e) => onChange({ startId: e.target.value })}>
            {dataset.starts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="field">
          <span className="label" id="time-label">Time you have</span>
          <div className="row" role="group" aria-labelledby="time-label">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={state.durationMin === d} onPointerDown={ripple} onClick={() => onChange({ durationMin: d })}>
                {d}m
              </button>
            ))}
            <label className="sr-only" htmlFor="duration">Minutes</label>
            <input
              id="duration"
              className="input small"
              type="number"
              inputMode="numeric"
              min={30}
              max={90}
              value={Number.isFinite(state.durationMin) ? state.durationMin : ''}
              aria-invalid={Boolean(durationError)}
              aria-describedby={durationError ? 'duration-error' : undefined}
              onChange={(e) => onChange({ durationMin: e.target.value === '' ? NaN : Number(e.target.value) })}
            />
          </div>
          {durationError && <p className="error" id="duration-error">{durationError}</p>}
        </div>

        <div className="field">
          <span className="label" id="budget-label">Budget per person</span>
          <div className="row" role="group" aria-labelledby="budget-label">
            {BUDGETS.map((b) => (
              <button key={b} type="button" className="chip" aria-pressed={state.budgetInr === b} onPointerDown={ripple} onClick={() => onChange({ budgetInr: b })}>
                {b === 0 ? 'Free' : `₹${b}`}
              </button>
            ))}
            <label className="sr-only" htmlFor="budget">Budget in rupees</label>
            <input
              id="budget"
              className="input small"
              type="number"
              inputMode="numeric"
              min={0}
              step={10}
              value={Number.isFinite(state.budgetInr) ? state.budgetInr : ''}
              max={100000}
              aria-invalid={Boolean(budgetError)}
              aria-describedby={budgetError ? 'budget-error' : undefined}
              onChange={(e) => onChange({ budgetInr: e.target.value === '' ? NaN : Number(e.target.value) })}
            />
          </div>
          {budgetError && <p className="error" id="budget-error">{budgetError}</p>}
        </div>

        <div className="two">
          {[0, 1].map((i) => (
            <div className="field" key={i}>
              <label htmlFor={`must-${i}`}>Must visit {i + 1}</label>
              <select
                id={`must-${i}`}
                className="input"
                value={state.required[i]}
                onChange={(e) =>
                  onChange({ required: i === 0 ? [e.target.value, state.required[1]] : [state.required[0], e.target.value] })
                }
              >
                <option value="">Anywhere</option>
                {groups.map(({ c, places }) => (
                  <optgroup key={c} label={CATEGORY_LABEL[c]}>
                    {places.map((p) => {
                      const unavailable = unconfirmedPlaceDetails(p)
                      return <option key={p.id} value={p.id} disabled={state.required[1 - i] === p.id || Boolean(unavailable)}>{p.name}{unavailable ? ` — ${unavailable.toLowerCase()}` : ''}</option>
                    })}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
        </div>

        <details className="more campus-finder">
          <summary>Find a campus stop</summary>
          <div className="form">
            <p className="hint" id="place-search-hint">Search places and interests, then add up to two must-visits. The planner checks whether they fit your walk.</p>
            <div className="field">
              <label htmlFor="place-search">Place or interest</label>
              <input id="place-search" className="input" type="search" value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} placeholder="Try food, library, quiet…" aria-describedby="place-search-hint" />
            </div>
            <div className="row" role="group" aria-label="Filter campus places">
              {(['all', 'cafe', 'seating', 'landmark'] as const).map((category) => (
                <button key={category} type="button" className="chip" aria-pressed={placeCategory === category} onClick={() => setPlaceCategory(category)}>{category === 'all' ? 'All' : CATEGORY_LABEL[category]}</button>
              ))}
            </div>
            <p className="hint" role="status">{matches.length} place{matches.length === 1 ? '' : 's'} found · {state.required.filter(Boolean).length} of 2 must-visits chosen</p>
            {matches.length === 0 ? <p className="hint">Try a different name, interest, or category.</p> : (
              <ul className="campus-places">
                {matches.map((place) => {
                  const chosen = state.required.includes(place.id)
                  const unavailable = unconfirmedPlaceDetails(place)
                  const full = state.required.every(Boolean)
                  return (
                    <li key={place.id}>
                      <div>
                        <b>{place.name}</b>
                        <small>{CATEGORY_LABEL[place.category]} · {place.spendLowInr === null || place.spendHighInr === null ? 'Price unconfirmed' : `${rupees(place.spendLowInr, place.spendHighInr)}${place.spendHighInr > 0 ? ' estimate' : ''}`}</small>
                        <small>{unavailable ? `${unavailable}; unavailable for planning.` : place.tags.slice(0, 3).join(' · ')}</small>
                      </div>
                      <button type="button" className="btn ghost" aria-label={`${chosen ? 'Remove' : 'Add'} ${place.name} ${chosen ? 'from' : 'to'} must-visits`} aria-pressed={chosen} disabled={!chosen && (Boolean(unavailable) || full)} onClick={() => onChange({ required: toggleRequiredPlace(state.required, place.id) })}>{chosen ? 'Remove' : 'Add'}</button>
                    </li>
                  )
                })}
              </ul>
            )}
            {state.required.every(Boolean) && <p className="hint">Both slots are filled. Remove a must-visit to choose another.</p>}
            <p className="hint">Descriptions and prices come from the campus dataset. Confirm opening hours and facilities locally.</p>
          </div>
        </details>

        <label className="switch">
          <span>Include a café or food stop</span>
          <input type="checkbox" checked={state.requireCafe} onChange={(e) => onChange({ requireCafe: e.target.checked })} />
        </label>

        <details className="more">
          <summary>More options</summary>
          <div className="form">
            <div className="field">
              <span className="label" id="pace-label">Pace</span>
              <div className="row" role="group" aria-labelledby="pace-label">
                {(['relaxed', 'normal'] as const).map((p) => (
                  <button key={p} type="button" className="chip" aria-pressed={state.pace === p} onPointerDown={ripple} onClick={() => onChange({ pace: p })}>
                    {p === 'relaxed' ? 'Relaxed' : 'Normal'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="backby">Back by (optional)</label>
              <input id="backby" className="input" type="time" value={state.backBy} onChange={(e) => onChange({ backBy: e.target.value })} />
              <p className="hint">For hostel in-times or a class. Plans always end before sunset.</p>
            </div>
            <div className="field">
              <label htmlFor="return-buffer">Return buffer</label>
              <select id="return-buffer" className="input" value={bufferMin} aria-describedby="return-buffer-hint" onChange={(e) => onChange({ bufferMin: Number(e.target.value) })}>
                {!BUFFERS.includes(bufferMin) && <option value={bufferMin}>{bufferMin} minutes (from shared walk)</option>}
                {BUFFERS.map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? 'No buffer' : `${minutes} minutes${minutes === DEFAULT_CONFIG.defaultBufferMin ? ' (default)' : ''}`}</option>)}
              </select>
              <p className="hint" id="return-buffer-hint">Set aside time for queues, campus gates, or reaching class after returning. This is included in the time you have.</p>
            </div>
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
                <input id="preview" className="input" style={{ flex: 1 }} type="datetime-local" value={state.previewAt} aria-invalid={Boolean(previewError)} aria-describedby={previewError ? 'preview-error' : 'preview-hint'} onChange={(e) => onChange({ previewAt: e.target.value })} />
                {state.previewAt && (
                  <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => onChange({ previewAt: '' })}>Use now</button>
                )}
              </div>
              {previewError && <p className="error" id="preview-error">{previewError}</p>}
              <p className="hint" id="preview-hint">Times are India Standard Time. Leave empty to plan from right now.</p>
            </div>
            {state.dwellOverridesMin && <p className="hint">This shared walk includes custom stop times.</p>}
          </div>
        </details>
      </section>
    </form>
  )
}
