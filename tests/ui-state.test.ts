import { describe, expect, it } from 'vitest'
import { fromIstInput, istInputValue } from '../src/ui/format'
import { initialForm, sharedForm, toRequest } from '../src/ui/planningState'
import { fixture } from './helpers'

describe('shared planning state', () => {
  it('preserves buffer, stop times, required stops, and preview time through the form', () => {
    const ds = fixture()
    const request = { ...toRequest(initialForm(ds)), requiredPlaceIds: ds.places.slice(0, 2).map((p) => p.id), bufferMin: 0, dwellOverridesMin: { [ds.places[0].id]: 7.5 }, backBy: '18:00' }
    const form = sharedForm(ds, { datasetVersion: ds.datasetVersion, planId: 'g:a', request, at: '2026-10-02T04:30:00.000Z' })
    expect(toRequest(form)).toEqual(request)
    expect(form.previewAt).toBe('2026-10-02T10:00')
    expect(fromIstInput(form.previewAt)?.toISOString()).toBe('2026-10-02T04:30:00.000Z')
  })
  it('a non-preview link plans from the current clock', () => {
    const ds = fixture()
    expect(sharedForm(ds, { datasetVersion: ds.datasetVersion, planId: 'g:a', request: toRequest(initialForm(ds)) }).previewAt).toBe('')
  })
})

describe('IST preview input', () => {
  it('round-trips across UTC midnight regardless of the host timezone', () => {
    const value = '2026-10-01T01:00'
    expect(fromIstInput(value)?.toISOString()).toBe('2026-09-30T19:30:00.000Z')
    expect(istInputValue(fromIstInput(value)!)).toBe(value)
  })
  it.each(['', '2026-02-30T10:00', '2026-13-01T10:00', '2026-10-01T24:00', '2026-10-01T10:60', '2026-10-01', '2026-10-01T10:00Z'])('rejects invalid wall-clock value %s', (value) => {
    expect(fromIstInput(value)).toBeNull()
  })
})
