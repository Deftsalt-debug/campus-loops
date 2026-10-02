import { DEFAULT_CONFIG } from '../core/planner/config'
import { OCCASIONS } from '../core/planner/occasions'
import type { Occasion } from '../core/types'
import type { FormState } from './planningState'

// The outing is described as one sentence: "Out with friends from Tiger Circle
// for 60 min, spending up to ₹200." Each phrase here is a tappable token.

/** Reads after "Out …", so each phrase carries its own preposition. */
export const OCCASION_PHRASE: Record<Occasion, string> = {
  date: 'on a date',
  friends: 'with friends',
  catchup: 'for a catch-up',
  meeting: 'for a walking meeting',
  guest: 'showing someone around',
  solo: 'for a solo reset',
  study_break: 'on a study break',
  active: 'for an active walk',
}

export const durationPhrase = (minutes: number) => (Number.isFinite(minutes) ? `${minutes} min` : '… min')

export const budgetPhrase = (inr: number) =>
  !Number.isFinite(inr) ? 'up to ₹…' : inr === 0 ? 'nothing' : `up to ₹${inr.toLocaleString('en-IN')}`

/**
 * Settings that differ from what the chosen occasion would pick on its own.
 * They are summarised on the Options token so a changed setting is never hidden.
 */
export function adjustedOptions(form: FormState): string[] {
  const out: string[] = []
  if (form.pace !== OCCASIONS[form.occasion].defaults.pace) out.push(form.pace === 'relaxed' ? 'Relaxed pace' : 'Normal pace')
  if (form.backBy) out.push(`Back by ${form.backBy}`)
  if (form.bufferMin !== undefined && form.bufferMin !== DEFAULT_CONFIG.defaultBufferMin) {
    out.push(form.bufferMin === 0 ? 'No buffer' : `${form.bufferMin} min buffer`)
  }
  if (form.avoidSteps) out.push('Avoid steps')
  if (form.rain) out.push('Rain mode')
  if (form.previewAt) out.push('Preview time')
  return out
}

export type LatLng = [number, number]

export interface RouteThumbnail {
  /** SVG path data in a size×size box, or '' when there is nothing to draw. */
  d: string
  start: [number, number] | null
}

/**
 * Project a walked path into a small square for the walk cards, so each card
 * carries the shape you will see on the map. Keeps the aspect ratio, centres
 * the route, and drops points closer than half a pixel to the previous one.
 */
export function routeThumbnail(path: LatLng[], size = 44, pad = 5): RouteThumbnail {
  if (path.length === 0) return { d: '', start: null }
  // Equirectangular is exact enough at campus scale.
  const cos = Math.cos((path[0][0] * Math.PI) / 180)
  const pts = path.map(([lat, lng]) => [lng * cos, -lat] as const)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const span = Math.max(maxX - minX, maxY - minY)
  const inner = size - pad * 2
  const scale = span > 0 ? inner / span : 0
  const offX = pad + (inner - (maxX - minX) * scale) / 2
  const offY = pad + (inner - (maxY - minY) * scale) / 2
  const round = (v: number) => Math.round(v * 10) / 10
  const project = ([x, y]: readonly [number, number]): [number, number] => [round(offX + (x - minX) * scale), round(offY + (y - minY) * scale)]

  const out: [number, number][] = []
  for (const p of pts) {
    const q = project(p)
    const last = out.at(-1)
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) >= 0.5) out.push(q)
  }
  const d = out.length === 1 ? `M${out[0][0]} ${out[0][1]}h0` : out.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')
  return { d, start: out[0] }
}
