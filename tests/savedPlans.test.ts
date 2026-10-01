import { describe, expect, it, vi } from 'vitest'
import { encodeShare } from '../src/core/share'
import type { KeyValueStore } from '../src/storage/calibrationLog'
import { exportSavedPlans, importSavedPlans, listSavedPlans, MAX_BACKUP_BYTES, MAX_SAVED_PLANS, removeSavedPlan, savePlan, SAVED_PLANS_BACKUP_FORMAT, SAVED_PLANS_BACKUP_VERSION, type SavedPlan } from '../src/storage/savedPlans'
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

function backup(plans: unknown[] = [saved()]): string {
  return JSON.stringify({ format: SAVED_PLANS_BACKUP_FORMAT, version: SAVED_PLANS_BACKUP_VERSION, plans })
}

describe('saved-walk backups', () => {
  it('exports and restores a versioned backup without changing original links', () => {
    const source = memoryStore()
    const oldDataset = { ...saved(), hash: saved().hash.replace(/d=[^&]+/, 'd=older-campus-dataset'), name: 'Monsoon walk 🌧️' }
    savePlan(oldDataset, source)
    savePlan(saved(50), source)
    const exported = exportSavedPlans(source)
    expect(exported.ok).toBe(true)
    if (!exported.ok) throw new Error(exported.message)
    expect(exported.count).toBe(2)
    expect(JSON.parse(exported.json)).toEqual({ format: SAVED_PLANS_BACKUP_FORMAT, version: 1, plans: [saved(50), oldDataset] })
    const destination = memoryStore()
    expect(importSavedPlans(exported.json, destination)).toEqual({ ok: true, imported: 2, skipped: 0, total: 2 })
    expect(listSavedPlans(destination)).toEqual(listSavedPlans(source))
  })

  it('exports only saved records and documented fields', () => {
    const records = { 'campus-loops-saved-v1': JSON.stringify([{ ...saved(), privateData: 'do not export' }]), 'other-private-store': 'secret', 'campusloops.calibration.v1': 'private logs' }
    const store: KeyValueStore = { getItem: vi.fn((key) => records[key as keyof typeof records] ?? null), setItem: vi.fn(), removeItem: vi.fn() }
    const exported = exportSavedPlans(store)
    expect(exported.ok).toBe(true)
    if (!exported.ok) throw new Error(exported.message)
    expect(JSON.parse(exported.json).plans).toEqual([saved()])
    expect(store.getItem).toHaveBeenCalledExactlyOnceWith('campus-loops-saved-v1')
    expect(store.setItem).not.toHaveBeenCalled()
    expect(exported.json).not.toMatch(/secret|private/i)
  })

  it('preserves existing metadata and skips duplicates both in storage and inside the file', () => {
    const original = { ...saved(), name: 'Keep my name', savedAt: '2026-09-01T10:00:00Z' }
    const store = memoryStore(JSON.stringify([original]))
    const added = saved(75)
    const result = importSavedPlans(backup([saved(), added, { ...added, name: 'Duplicate renamed' }]), store)
    expect(result).toEqual({ ok: true, imported: 1, skipped: 2, total: 2 })
    expect(listSavedPlans(store)).toEqual([original, added])
  })

  it('does not write for an empty backup or an entirely duplicate backup, even when the store is full', () => {
    const plans = Array.from({ length: MAX_SAVED_PLANS }, (_, i) => saved(i))
    const store = memoryStore(JSON.stringify(plans))
    store.setItem = vi.fn(() => { throw new Error('quota') })
    expect(importSavedPlans(backup([]), store)).toEqual({ ok: true, imported: 0, skipped: 0, total: MAX_SAVED_PLANS })
    expect(importSavedPlans(backup(plans), store)).toEqual({ ok: true, imported: 0, skipped: MAX_SAVED_PLANS, total: MAX_SAVED_PLANS })
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('rejects insufficient capacity without importing the subset that would fit', () => {
    const store = memoryStore(JSON.stringify(Array.from({ length: MAX_SAVED_PLANS - 1 }, (_, i) => saved(i))))
    const original = store.value
    const write = vi.spyOn(store, 'setItem')
    expect(importSavedPlans(backup([saved(500), saved(600)]), store)).toMatchObject({ ok: false, reason: 'full' })
    expect(store.value).toBe(original)
    expect(write).not.toHaveBeenCalled()
  })

  it('validates every record before any mutation', () => {
    const store = memoryStore(JSON.stringify([saved(0)]))
    const original = store.value
    const write = vi.spyOn(store, 'setItem')
    expect(importSavedPlans(backup([saved(1), saved(2), { ...saved(3), hash: '#v=1&d=invalid' }]), store)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(store.value).toBe(original)
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects a link without its fragment marker before restoring any records', () => {
    const store = memoryStore(JSON.stringify([saved(0)]))
    const original = store.value
    const write = vi.spyOn(store, 'setItem')
    // The shared-link parser accepts raw query text, but saved links are joined
    // to the current pathname when opened and must remain URL fragments.
    expect(importSavedPlans(backup([saved(1), { ...saved(2), hash: saved(2).hash.slice(1) }]), store)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(store.value).toBe(original)
    expect(write).not.toHaveBeenCalled()
    expect(savePlan({ ...saved(2), hash: saved(2).hash.slice(1) }, store)).toBe('unavailable')
    expect(listSavedPlans(memoryStore(JSON.stringify([{ ...saved(), hash: saved().hash.slice(1) }])))).toEqual([])
  })

  it.each([
    '', 'not JSON', 'null', '[]', '{}', JSON.stringify([saved()]),
    JSON.stringify({ format: 'different-app', version: 1, plans: [saved()] }),
    JSON.stringify({ format: SAVED_PLANS_BACKUP_FORMAT, version: '1', plans: [saved()] }),
    JSON.stringify({ format: SAVED_PLANS_BACKUP_FORMAT, version: 2, plans: [saved()] }),
    JSON.stringify({ format: SAVED_PLANS_BACKUP_FORMAT, version: 1, plans: {} }),
    JSON.stringify({ format: SAVED_PLANS_BACKUP_FORMAT, version: 1, plans: [], secret: 'extra' }),
    backup([null]), backup([[]]), backup([{}]), backup(['a plan']),
    backup([{ ...saved(), name: '   ' }]),
    backup([{ ...saved(), name: 'x'.repeat(241) }]),
    backup([{ ...saved(), savedAt: '2026-02-30T10:00:00Z' }]),
    backup([{ ...saved(), savedAt: '2026-10-01T10:00:00' }]),
    backup([{ ...saved(), hash: 'https://malicious.example/' }]),
    backup([{ ...saved(), hash: `${saved().hash}&v=1` }]),
    backup([{ ...saved(), hash: saved().hash.replace('b=200', 'b=-1') }]),
    backup([{ ...saved(), extraPrivateField: 'unexpected' }]),
    `{"format":"${SAVED_PLANS_BACKUP_FORMAT}","version":1,"plans":[],"__proto__":{"polluted":true}}`,
  ])('rejects malformed or unsupported backup %# without storage writes', (json) => {
    const store = memoryStore(JSON.stringify([saved(0)]))
    const original = store.value
    const write = vi.spyOn(store, 'setItem')
    expect(importSavedPlans(json, store)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(store.value).toBe(original)
    expect(write).not.toHaveBeenCalled()
    expect(Object.hasOwn({}, 'polluted')).toBe(false)
  })

  it('bounds import size by UTF-8 bytes and bounds record count before storing anything', () => {
    const store = memoryStore()
    const write = vi.spyOn(store, 'setItem')
    expect(importSavedPlans(' '.repeat(MAX_BACKUP_BYTES + 1), store)).toMatchObject({ ok: false, reason: 'too-large' })
    const unicode = '🌧️'.repeat(12_000)
    expect(unicode.length).toBeLessThan(MAX_BACKUP_BYTES)
    expect(importSavedPlans(unicode, store)).toMatchObject({ ok: false, reason: 'too-large' })
    expect(importSavedPlans(backup(Array.from({ length: MAX_SAVED_PLANS + 1 }, () => saved())), store)).toMatchObject({ ok: false, reason: 'too-many' })
    expect(write).not.toHaveBeenCalled()
  })

  it('accepts a file exactly at the size limit', () => {
    const json = backup()
    const padded = json + ' '.repeat(MAX_BACKUP_BYTES - new TextEncoder().encode(json).byteLength)
    expect(importSavedPlans(padded, memoryStore())).toEqual({ ok: true, imported: 1, skipped: 0, total: 1 })
  })

  it('reports blocked storage without treating it as an empty export or overwriting it', () => {
    expect(exportSavedPlans(null)).toMatchObject({ ok: false })
    expect(importSavedPlans(backup(), null)).toMatchObject({ ok: false, reason: 'unavailable' })
    const store = memoryStore()
    store.getItem = () => { throw new Error('blocked') }
    store.setItem = vi.fn()
    expect(exportSavedPlans(store)).toMatchObject({ ok: false })
    expect(importSavedPlans(backup(), store)).toMatchObject({ ok: false, reason: 'unavailable' })
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('leaves saved data untouched when the atomic storage write hits quota', () => {
    const store = memoryStore(JSON.stringify([saved(0)]))
    const original = store.value
    store.setItem = vi.fn(() => { throw new Error('quota') })
    expect(importSavedPlans(backup([saved(1), saved(2)]), store)).toMatchObject({ ok: false, reason: 'unavailable' })
    expect(store.value).toBe(original)
    expect(store.setItem).toHaveBeenCalledTimes(1)
  })

  it('allows an empty export to be restored', () => {
    const exported = exportSavedPlans(memoryStore())
    expect(exported.ok).toBe(true)
    if (!exported.ok) throw new Error(exported.message)
    expect(exported.count).toBe(0)
    expect(importSavedPlans(exported.json, memoryStore())).toEqual({ ok: true, imported: 0, skipped: 0, total: 0 })
  })

  it('does not produce an export too large to restore, even for hostile stored strings', () => {
    const plans = Array.from({ length: MAX_SAVED_PLANS }, (_, i) => ({ ...saved(i), hash: `${saved(i).hash}&extra=${'\u0000'.repeat(1500)}` }))
    const store = memoryStore(JSON.stringify(plans))
    expect(listSavedPlans(store)).toHaveLength(MAX_SAVED_PLANS)
    expect(exportSavedPlans(store)).toMatchObject({ ok: false })
  })
})
