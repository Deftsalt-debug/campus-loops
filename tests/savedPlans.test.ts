import { describe, expect, it, vi } from 'vitest'
import { encodeShare } from '../src/core/share'
import type { KeyValueStore } from '../src/storage/calibrationLog'
import { listSavedPlans, MAX_SAVED_PLANS, removeSavedPlan, savePlan, type SavedPlan } from '../src/storage/savedPlans'
import { initialForm, toRequest } from '../src/ui/planningState'
import { fixture } from './helpers'

function memoryStore(raw = '[]'): KeyValueStore & { value: string } {
  return { value: raw, getItem() { return this.value }, setItem(_key, v) { this.value = v }, removeItem() { this.value = '[]' } }
}
function saved(budget = 200): SavedPlan {
  const ds = fixture()
  return { name: 'A campus walk', savedAt: '2026-10-01T10:00:00.000Z', hash: encodeShare({ datasetVersion: ds.datasetVersion, planId: 'g:a', request: { ...toRequest(initialForm(ds)), budgetInr: budget } }) }
}

describe('saved walks', () => {
  it('round-trips and updates an existing walk without duplicating it', () => {
    const store = memoryStore()
    expect(savePlan(saved(), store)).toBe('saved')
    expect(savePlan({ ...saved(), name: 'Renamed' }, store)).toBe('saved')
    expect(listSavedPlans(store)).toEqual([{ ...saved(), name: 'Renamed' }])
    expect(removeSavedPlan(saved().hash, store)).toBe(true)
    expect(listSavedPlans(store)).toEqual([])
  })
  it('caps storage without silently discarding an existing walk', () => {
    const store = memoryStore()
    for (let i = 0; i < MAX_SAVED_PLANS; i++) expect(savePlan(saved(i), store)).toBe('saved')
    expect(savePlan(saved(500), store)).toBe('full')
    expect(listSavedPlans(store)).toHaveLength(MAX_SAVED_PLANS)
    expect(savePlan(saved(0), store)).toBe('saved')
  })
  it.each(['garbage', '{}', 'null'])('recovers safely from corrupt storage %s', (raw) => expect(listSavedPlans(memoryStore(raw))).toEqual([]))
  it('filters invalid links and rows and removes duplicates', () => {
    const store = memoryStore(JSON.stringify([saved(), { ...saved(), hash: '#bad' }, { ...saved(), savedAt: 'never' }, { ...saved(), name: '' }, saved()]))
    expect(listSavedPlans(store)).toEqual([saved()])
  })
  it.each(['2026-02-30T10:00:00Z', '2026-10-01T10:00:00', '2026-10-01', '2026-10-01T24:00:00Z'])(
    'rejects invalid or timezone-dependent timestamps: %s', (savedAt) => {
      const store = memoryStore(JSON.stringify([{ ...saved(), savedAt }]))
      expect(listSavedPlans(store)).toEqual([])
      expect(savePlan({ ...saved(), savedAt }, store)).toBe('unavailable')
    },
  )
  it('rejects blank names and retains only documented fields', () => {
    const store = memoryStore(JSON.stringify([{ ...saved(), extraPrivateField: 'not part of the record' }]))
    expect(listSavedPlans(store)).toEqual([saved()])
    expect(savePlan({ ...saved(), name: '   ' }, store)).toBe('unavailable')
    const withExtra = { ...saved(), extraPrivateField: 'not part of the record' }
    expect(savePlan(withExtra, store)).toBe('saved')
    expect(JSON.parse(store.value)).toEqual([saved()])
  })
  it('handles absent and full storage', () => {
    expect(listSavedPlans(null)).toEqual([])
    expect(savePlan(saved(), null)).toBe('unavailable')
    const store = memoryStore()
    store.setItem = () => { throw new Error('quota') }
    expect(savePlan(saved(), store)).toBe('unavailable')
    expect(removeSavedPlan(saved().hash, store)).toBe(false)
  })
  it('does not overwrite saved walks when reading fails', () => {
    const store = memoryStore()
    store.getItem = () => { throw new Error('blocked') }
    store.setItem = vi.fn()
    expect(savePlan(saved(), store)).toBe('unavailable')
    expect(removeSavedPlan(saved().hash, store)).toBe(false)
    expect(store.setItem).not.toHaveBeenCalled()
  })
})
