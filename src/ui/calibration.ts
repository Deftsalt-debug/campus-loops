import { summarise, type WalkLog } from '../core/calibration'

export function calibrationSummaryText(logs: WalkLog[]): string {
  const s = summarise(logs)
  if (s.count === 0) return 'No walks logged yet. After a walk, open its plan and log the real walking time.'
  const ratio = s.medianWalkRatio!
  const direction = ratio > 1.05 ? 'longer than planned' : ratio < 0.95 ? 'shorter than planned' : 'about as planned'
  return `${s.count} walk${s.count > 1 ? 's' : ''} logged. Median walk took ${Math.round(ratio * 100)}% of the estimate (${direction}); ${Math.round(
    s.within20Share! * 100,
  )}% within ±20%.`
}
