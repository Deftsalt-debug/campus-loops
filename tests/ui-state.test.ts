import { describe, expect, it } from 'vitest'
import { fromIstInput, istInputValue } from '../src/ui/format'
import { initialForm, sharedForm, toRequest } from '../src/ui/planningState'
import { findCampusPlaces, toggleRequiredPlace, unconfirmedPlaceDetails } from '../src/ui/campusPlaces'
import { plan } from '../src/core/planner/plan'
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
