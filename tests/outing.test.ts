import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/planner/config'
import { OCCASION_IDS, OCCASIONS } from '../src/core/planner/occasions'
import { adjustedOptions, budgetPhrase, durationPhrase, OCCASION_PHRASE, routeThumbnail } from '../src/ui/outing'
import { initialForm } from '../src/ui/planningState'
import { fixture } from './helpers'

describe('outing sentence', () => {
  it('has a distinct phrase for every occasion', () => {
    const phrases = OCCASION_IDS.map((id) => OCCASION_PHRASE[id])
    expect(phrases.every((p) => p.length > 0)).toBe(true)
    expect(new Set(phrases).size).toBe(OCCASION_IDS.length)
  })

  it('describes duration and budget, including free and incomplete values', () => {
    expect(durationPhrase(45)).toBe('45 min')
    expect(durationPhrase(NaN)).toBe('… min')
    expect(budgetPhrase(0)).toBe('nothing')
    expect(budgetPhrase(200)).toBe('up to ₹200')
    expect(budgetPhrase(12500)).toBe('up to ₹12,500')
    expect(budgetPhrase(NaN)).toBe('up to ₹…')
  })
})

describe('adjusted options', () => {
  it('is empty for a fresh plan and after picking any occasion', () => {
    const base = initialForm(fixture())
    expect(adjustedOptions(base)).toEqual([])
    for (const id of OCCASION_IDS) {
      expect(adjustedOptions({ ...base, occasion: id, ...OCCASIONS[id].defaults })).toEqual([])
    }
  })

  it('lists every setting that differs from the occasion defaults', () => {
    const base = initialForm(fixture())
    const pace = base.pace === 'relaxed' ? 'normal' : 'relaxed'
    const form = { ...base, pace, backBy: '18:30', bufferMin: 15, avoidSteps: true, rain: true, previewAt: '2026-10-02T10:00' } as const
    expect(adjustedOptions(form)).toEqual([
      pace === 'relaxed' ? 'Relaxed pace' : 'Normal pace', 'Back by 18:30', '15 min buffer', 'Avoid steps', 'Rain mode', 'Preview time',
    ])
  })

  it('treats the default buffer as unchanged and zero as a change', () => {
    const base = initialForm(fixture())
    expect(adjustedOptions({ ...base, bufferMin: DEFAULT_CONFIG.defaultBufferMin })).toEqual([])
    expect(adjustedOptions({ ...base, bufferMin: 0 })).toEqual(['No buffer'])
  })
})

describe('route thumbnail', () => {
  const box = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))

  it('fits the route inside the padded box and keeps the start point', () => {
    const t = routeThumbnail([[13.35, 74.79], [13.351, 74.79], [13.351, 74.792], [13.35, 74.79]], 44, 5)
    expect(t.d.startsWith('M')).toBe(true)
    const values = box(t.d)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(5)
    expect(Math.max(...values)).toBeLessThanOrEqual(39)
    expect(t.start).toEqual(values.slice(0, 2) as [number, number])
  })

  it('preserves the aspect ratio of a long, thin route by centring it', () => {
    const t = routeThumbnail([[13.35, 74.79], [13.35, 74.8]], 44, 4)
    const [x1, y1, x2, y2] = box(t.d)
    expect(y1).toBe(22)
    expect(y2).toBe(22)
    expect(Math.abs(x2 - x1)).toBeCloseTo(36, 0)
  })

  it('drops points that would land on the same pixel', () => {
    const near = Array.from({ length: 50 }, (_, i) => [13.35 + i * 1e-9, 74.79] as [number, number])
    const t = routeThumbnail([...near, [13.36, 74.8]])
    expect(t.d.match(/L/g)?.length).toBe(1)
  })

  it('handles single points and empty paths', () => {
    expect(routeThumbnail([])).toEqual({ d: '', start: null })
    const dot = routeThumbnail([[13.35, 74.79]], 40, 4)
    expect(dot.d).toBe('M20 20h0')
    expect(dot.start).toEqual([20, 20])
  })
})
