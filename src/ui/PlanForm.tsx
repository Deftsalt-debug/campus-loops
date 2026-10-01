import type { KeyboardEvent } from 'react'
import { OCCASION_IDS, OCCASIONS } from '../core/planner/occasions'
import type { Dataset, Occasion, Pace } from '../core/types'
import { ripple, spotlight } from './effects'

export interface FormState {
  startId: string
  occasion: Occasion
  durationMin: number
  budgetInr: number
  required: [string, string]
  requireCafe: boolean
  pace: Pace
  backBy: string
  avoidSteps: boolean
  rain: boolean
  /** Empty = now. Otherwise an IST datetime-local value for previewing another time. */
  previewAt: string
}

const DURATIONS = [30, 45, 60, 90]
const BUDGETS = [0, 100, 200, 300]
const CATEGORY_LABEL = { cafe: 'Food & coffee', seating: 'Places to sit', landmark: 'Landmarks', waypoint: 'Waypoints' } as const

interface Props {
  dataset: Dataset
  state: FormState
  onChange: (patch: Partial<FormState>) => void
  durationError: string | null
}

export function PlanForm({ dataset, state, onChange, durationError }: Props) {
  const pickMode = (id: Occasion) => onChange({ occasion: id, ...OCCASIONS[id].defaults })
  const schedulable = dataset.places.filter((p) => p.category !== 'waypoint')
  const groups = (['cafe', 'seating', 'landmark'] as const).map((c) => ({ c, places: schedulable.filter((p) => p.category === c) }))

  const moveFocus = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!delta) return
    e.preventDefault()
    const next = OCCASION_IDS[(i + delta + OCCASION_IDS.length) % OCCASION_IDS.length]
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
              value={state.budgetInr}
              onChange={(e) => onChange({ budgetInr: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
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
                    {places.map((p) => (
                      <option key={p.id} value={p.id} disabled={state.required[1 - i] === p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
        </div>

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
            <label className="switch">
              <span>Avoid steps<small>Only paths without stairs. Not a wheelchair-access guarantee.</small></span>
              <input type="checkbox" checked={state.avoidSteps} onChange={(e) => onChange({ avoidSteps: e.target.checked })} />
            </label>
            <label className="switch">
              <span>Rain mode<small>Sheltered stops only; prefers covered paths.</small></span>
              <input type="checkbox" checked={state.rain} onChange={(e) => onChange({ rain: e.target.checked })} />
            </label>
            <div className="field">
              <label htmlFor="preview">Plan as if it's… (preview)</label>
              <div className="row">
                <input id="preview" className="input" style={{ flex: 1 }} type="datetime-local" value={state.previewAt} onChange={(e) => onChange({ previewAt: e.target.value })} />
                {state.previewAt && (
                  <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => onChange({ previewAt: '' })}>Use now</button>
                )}
              </div>
              <p className="hint">Times are India Standard Time. Leave empty to plan from right now.</p>
            </div>
          </div>
        </details>
      </section>
    </form>
  )
}
