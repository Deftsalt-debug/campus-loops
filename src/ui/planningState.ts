import { OCCASIONS } from '../core/planner/occasions'
import type { SharedPlan } from '../core/share'
import type { Dataset, Occasion, Pace, PlanRequest } from '../core/types'
import { istInputValue } from './format'

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
  /** Empty means now; otherwise an IST datetime-local value. */
  previewAt: string
  bufferMin?: number
  dwellOverridesMin?: Record<string, number>
}

export function initialForm(dataset: Dataset): FormState {
  return {
    startId: dataset.starts[0]?.id ?? '', occasion: 'friends',
    ...OCCASIONS.friends.defaults,
    required: ['', ''], avoidSteps: false, rain: false, backBy: '', previewAt: '',
  }
}

export function toRequest(f: FormState): PlanRequest {
  return {
    startId: f.startId, occasion: f.occasion, durationMin: f.durationMin,
    budgetInr: f.budgetInr, requiredPlaceIds: f.required.filter(Boolean),
    requireCafe: f.requireCafe, pace: f.pace, avoidSteps: f.avoidSteps, rain: f.rain,
    ...(f.backBy ? { backBy: f.backBy } : {}),
    ...(f.bufferMin !== undefined ? { bufferMin: f.bufferMin } : {}),
    ...(f.dwellOverridesMin ? { dwellOverridesMin: f.dwellOverridesMin } : {}),
  }
}

/** Keep every supported request field when opening a shared or saved walk. */
export function sharedForm(dataset: Dataset, shared: SharedPlan): FormState {
  const r = shared.request
  return {
    ...initialForm(dataset), ...r,
    required: [r.requiredPlaceIds[0] ?? '', r.requiredPlaceIds[1] ?? ''],
    backBy: r.backBy ?? '', previewAt: shared.at ? istInputValue(new Date(shared.at)) : '',
  }
}
