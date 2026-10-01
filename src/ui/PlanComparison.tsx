import type { Plan } from '../core/types'
import { km, mins, rupees } from './format'
import './PlanComparison.css'

interface Props { plans: Plan[]; selectedId: string | null; onSelect: (id: string) => void }

export function PlanComparison({ plans, selectedId, onSelect }: Props) {
  if (plans.length < 2) return null
  return (
    <details className="more plan-comparison">
      <summary>Compare these walks</summary>
      <p className="hint">Total time includes stops and your return buffer. Spare time is what remains before your deadline, after that buffer. Costs are estimates per person.</p>
      <div className="comparison-scroll" role="region" aria-label="Walk comparison" tabIndex={0}>
        <table>
          <caption className="sr-only">Compare time, walking distance and estimated cost</caption>
          <thead><tr><th scope="col">Walk</th>{plans.map((plan, index) => <th key={plan.id} scope="col">
            <button type="button" className="comparison-choice" aria-pressed={selectedId === plan.id} onClick={() => onSelect(plan.id)}>
              <span>{index + 1}. {plan.name}</span><small>{selectedId === plan.id ? 'Selected' : 'Select walk'}</small>
            </button>
          </th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">Total time</th>{plans.map((p) => <td key={p.id}>{mins(p.totalSec)}</td>)}</tr>
            <tr><th scope="row">Walking</th>{plans.map((p) => <td key={p.id}>{mins(p.walkingSec)}<small>{km(p.distanceM)}</small></td>)}</tr>
            <tr><th scope="row">Stops</th>{plans.map((p) => <td key={p.id}>{mins(p.dwellSec)}</td>)}</tr>
            <tr><th scope="row">Return buffer</th>{plans.map((p) => <td key={p.id}>{mins(p.bufferSec)}</td>)}</tr>
            <tr><th scope="row">Spare time</th>{plans.map((p) => <td key={p.id}>{Math.floor(Math.max(0, p.availableSec - p.totalSec) / 60)} min</td>)}</tr>
            <tr><th scope="row">Cost</th>{plans.map((p) => <td key={p.id}>{rupees(p.spendLowInr, p.spendHighInr)}</td>)}</tr>
            <tr><th scope="row">Route</th>{plans.map((p) => <td key={p.id}>{p.outAndBack ? 'Mostly retraced' : 'Less retracing'}<small>{Math.round(p.retraceRatio * 100)}% retraced</small></td>)}</tr>
          </tbody>
        </table>
      </div>
    </details>
  )
}
