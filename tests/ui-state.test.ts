import { describe, expect, it } from 'vitest'
import { fromIstInput, istInputValue, slug } from '../src/ui/format'
import { initialForm, sharedForm, toRequest } from '../src/ui/planningState'
import { findCampusPlaces, stopTimeError, toggleRequiredPlace, unconfirmedPlaceDetails, updateStopTime } from '../src/ui/campusPlaces'
import { plan, rebuildPlan } from '../src/core/planner/plan'
import { decodeShare, encodeShare } from '../src/core/share'
import { fixture, ist, tinyDataset, twoWay } from './helpers'

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

describe('campus stop discovery', () => {
  it('matches names, categories and interests across case, accents and punctuation', () => {
    const place = { ...fixture().places[0], id: 'food_court', name: 'MIT Food Court 1', category: 'cafe' as const, tags: ['quiet', 'sheltered'] }
    const places = [place]
    expect(findCampusPlaces(places, ' MIT food ')).toEqual(places)
    expect(findCampusPlaces(places, 'QUIÉT coffee')).toEqual(places)
    expect(findCampusPlaces(places, 'food-court 1', 'cafe')).toEqual(places)
    expect(findCampusPlaces(places, 'food', 'seating')).toEqual([])
    expect(findCampusPlaces(places, 'library')).toEqual([])
  })

  it('excludes pass-by waypoints, but keeps unconfirmed stops discoverable', () => {
    const base = fixture().places[0]
    const places = [{ ...base, id: 'unknown', hoursStatus: 'unknown' as const }, { ...base, id: 'pass', category: 'waypoint' as const }]
    expect(findCampusPlaces(places, '').map((p) => p.id)).toEqual(['unknown'])
    expect(unconfirmedPlaceDetails(places[0])).toBe('Hours unconfirmed')
    expect(unconfirmedPlaceDetails({ ...base, spendLowInr: null })).toBe('Price unconfirmed')
    expect(unconfirmedPlaceDetails({ ...base, hoursStatus: 'always', spendLowInr: 0, spendHighInr: 0 })).toBeNull()
  })

  it('supports adding, removing and replacing either must-visit without silently dropping a choice', () => {
    let required: [string, string] = ['', '']
    required = toggleRequiredPlace(required, 'library')
    required = toggleRequiredPlace(required, 'food')
    expect(required).toEqual(['library', 'food'])
    expect(toggleRequiredPlace(required, 'lawns')).toEqual(['library', 'food'])
    required = toggleRequiredPlace(required, 'library')
    expect(required).toEqual(['', 'food'])
    required = toggleRequiredPlace(required, 'lawns')
    expect(required).toEqual(['lawns', 'food'])
    const form = { ...initialForm(fixture()), required, bufferMin: 15 }
    expect(toRequest(form)).toMatchObject({ requiredPlaceIds: ['lawns', 'food'], bufferMin: 15 })
  })

  it('reserves the chosen return buffer before a class deadline', () => {
    const ds = tinyDataset(['gate', 'lawn'], twoWay('walk', 'gate', 'lawn', 300), [{ id: 'lawn', name: 'Library lawn', nodeId: 'lawn', dwellDefaultMin: 10 }])
    const state = { ...initialForm(ds), durationMin: 30, requireCafe: false, pace: 'normal' as const, backBy: '10:30', required: toggleRequiredPlace(['', ''], 'lawn') }
    const now = ist('2026-10-01', '10:00')
    const withRoom = plan(ds, toRequest({ ...state, bufferMin: 10 }), now)
    expect(withRoom.plans.length).toBeGreaterThan(0)
    for (const walk of withRoom.plans) {
      expect(walk.bufferSec).toBe(600)
      expect(walk.totalSec).toBeLessThanOrEqual(30 * 60)
      expect(walk.totalSec - walk.bufferSec).toBeLessThanOrEqual(20 * 60)
      expect(walk.visits.some((visit) => visit.placeId === 'lawn')).toBe(true)
    }
    expect(plan(ds, toRequest({ ...state, bufferMin: 20 }), now).plans).toEqual([])
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

describe('custom stop times', () => {
  const ds = () => tinyDataset(['gate', 'lawn'], twoWay('walk', 'gate', 'lawn', 360), [{ id: 'lawn', name: 'Library lawn', nodeId: 'lawn', dwellDefaultMin: 10 }])
  const now = ist('2026-10-01', '10:00')
  const state = () => ({ ...initialForm(ds()), durationMin: 30, requireCafe: false, pace: 'normal' as const, backBy: '10:30', required: ['lawn', ''] as [string, string], bufferMin: 5 })

  it('changes the actual stop and return time, rejects a missed class deadline, and restores the dataset default', () => {
    const original = plan(ds(), toRequest(state()), now).plans[0]
    expect(original.totalSec).toBe(25 * 60) // 5 out + 10 stop + 5 home + 5 buffer
    let dwellOverridesMin = updateStopTime(undefined, 'lawn', '15')
    const longer = plan(ds(), toRequest({ ...state(), dwellOverridesMin }), now).plans[0]
    expect(longer.visits[0].dwellSec).toBe(15 * 60)
    expect(longer.totalSec).toBe(30 * 60)
    dwellOverridesMin = updateStopTime(dwellOverridesMin, 'lawn', '15.5')
    const tooLong = plan(ds(), toRequest({ ...state(), dwellOverridesMin }), now)
    expect(tooLong.plans).toEqual([])
    expect(tooLong.blockers[0].code).toBe('NOT_ENOUGH_TIME')
    dwellOverridesMin = updateStopTime(dwellOverridesMin, 'lawn', null)
    expect(dwellOverridesMin).toBeUndefined()
    expect(plan(ds(), toRequest({ ...state(), dwellOverridesMin }), now).plans[0]).toEqual(original)
  })

  it('keeps every stop-time customization through sharing and rebuilding the exact walk', () => {
    const dataset = ds()
    const form = { ...state(), dwellOverridesMin: updateStopTime(undefined, 'lawn', '7.5') }
    const request = toRequest(form)
    const selected = plan(dataset, request, now).plans[0]
    expect(selected.totalSec).toBe(22.5 * 60)
    const encoded = encodeShare({ datasetVersion: dataset.datasetVersion, request, planId: selected.id, at: now.toISOString() })
    const decoded = decodeShare(encoded)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) throw new Error(decoded.reason)
    const restored = sharedForm(dataset, decoded.shared)
    expect(toRequest(restored)).toEqual(request)
    expect(rebuildPlan(dataset, toRequest(restored), now, selected.id).plans[0]).toEqual(selected)
  })

  it('edits and resets only the chosen stop, preserving shared overrides after changing must-visits', () => {
    const original = { lawn: 7.5, food: 20 }
    const updated = updateStopTime(original, 'lawn', '0')
    expect(updated).toEqual({ lawn: 0, food: 20 })
    expect(original).toEqual({ lawn: 7.5, food: 20 })
    const form = { ...state(), required: toggleRequiredPlace(state().required, 'lawn'), dwellOverridesMin: updated }
    expect(toRequest(form).dwellOverridesMin).toEqual({ lawn: 0, food: 20 })
    expect(updateStopTime(updated, 'lawn', null)).toEqual({ food: 20 })
    expect(updateStopTime(updated, 'missing', null)).toEqual(updated)
  })

  it.each(['', ' ', '-1', '121', 'NaN', 'Infinity', 'invalid'])('blocks planning for invalid input %j instead of retaining an earlier valid value', (value) => {
    const dwellOverridesMin = updateStopTime({ lawn: 10 }, 'lawn', value)
    expect(stopTimeError(dwellOverridesMin!.lawn)).not.toBeNull()
    const result = plan(ds(), toRequest({ ...state(), dwellOverridesMin }), now)
    expect(result.plans).toEqual([])
    expect(result.blockers[0].code).toBe('INVALID_INPUT')
    expect(plan(ds(), toRequest({ ...state(), dwellOverridesMin: updateStopTime(dwellOverridesMin, 'lawn', null) }), now).plans).toHaveLength(1)
  })

  it('permits a zero-minute pass-by while preserving the walking and return buffer', () => {
    const walk = plan(ds(), toRequest({ ...state(), dwellOverridesMin: updateStopTime(undefined, 'lawn', '0') }), now).plans[0]
    expect(walk.visits[0].dwellSec).toBe(0)
    expect(walk.walkingSec).toBe(10 * 60)
    expect(walk.bufferSec).toBe(5 * 60)
    expect(walk.totalSec).toBe(15 * 60)
    expect(stopTimeError(0)).toBeNull()
    expect(stopTimeError(120)).toBeNull()
  })

  it('keeps unusual valid place IDs as own properties without changing the override prototype', () => {
    const overrides = updateStopTime(undefined, '__proto__', '7.5')!
    expect(Object.hasOwn(overrides, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(overrides)).toBe(Object.prototype)
    expect(overrides.__proto__).toBe(7.5)
    expect(updateStopTime(overrides, '__proto__', null)).toBeUndefined()
  })
})

describe('download file names', () => {
  it('folds accents instead of dropping letters', () => {
    expect(slug('Walk with a café stop · MIT Cafeteria')).toBe('walk-with-a-cafe-stop-mit-cafeteria')
    expect(slug('Crème brûlée & naïve façade')).toBe('creme-brulee-naive-facade')
  })
  it('trims separators, caps the length, and never returns an empty name', () => {
    expect(slug('  --Library (outside)--  ')).toBe('library-outside')
    expect(slug('x'.repeat(80))).toHaveLength(48)
    expect(slug('₹ · —')).toBe('route')
  })
})
