import { memo, useMemo, type CSSProperties } from 'react'
import { planGeometry } from '../core/geo'
import type { Dataset, Plan } from '../core/types'
import { spotlight } from './effects'
import { km, mins, rupees } from './format'
import { Icon } from './icons'
import { routeThumbnail } from './outing'
import './WalkChooser.css'

interface Props {
  dataset: Dataset
  plans: Plan[]
  selectedId: string | null
  /** A walk highlighted from elsewhere, e.g. hovering its line on the map. */
  linkedId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

/** Step 2. Compact, comparable choices; each card carries its route's shape. */
export const WalkChooser = memo(function WalkChooser({ dataset, plans, selectedId, linkedId, onSelect, onHover }: Props) {
  const thumbs = useMemo(() => new Map(plans.map((plan) => {
    try { return [plan.id, routeThumbnail(planGeometry(dataset, plan).path)] as const }
    catch { return [plan.id, null] as const }
  })), [dataset, plans])

  return (
    <ol className="walks" aria-label="Suggested walks">
      {plans.map((plan, i) => {
        const selected = plan.id === selectedId
        const thumb = thumbs.get(plan.id)
        const stops = plan.visits.filter((v) => v.dwellSec > 0).length
        return (
          <li key={plan.id} style={{ '--i': i } as CSSProperties}>
            <button
              type="button"
              className={`walk card spot${plan.id === linkedId && !selected ? ' is-linked' : ''}`}
              aria-pressed={selected}
              onPointerMove={spotlight}
              onPointerEnter={() => onHover(selected ? null : plan.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(selected ? null : plan.id)}
              onBlur={() => onHover(null)}
              onClick={() => { onSelect(plan.id); onHover(null) }}
            >
              <svg className="walk-thumb" viewBox="0 0 44 44" aria-hidden="true">
                {thumb?.d && <path pathLength={1} d={thumb.d} />}
                {thumb?.start && <circle cx={thumb.start[0]} cy={thumb.start[1]} r="3" />}
              </svg>
              <span className="walk-body">
                <span className="walk-name"><span className="walk-num" aria-hidden="true">{i + 1}</span>{plan.name}</span>
                {plan.fit && <span className="walk-fit">{plan.fit}</span>}
                <span className="walk-stats">
                  <span>{mins(plan.totalSec)}</span>
                  <span>{km(plan.distanceM)} walk</span>
                  <span>{rupees(plan.spendLowInr, plan.spendHighInr)}</span>
                  {stops > 0 && <span>{stops} stop{stops > 1 ? 's' : ''}</span>}
                </span>
              </span>
              <span className="walk-tick" aria-hidden="true"><Icon name="check" size={14} /></span>
            </button>
          </li>
        )
      })}
    </ol>
  )
})
