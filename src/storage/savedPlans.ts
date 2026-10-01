import { decodeShare } from '../core/share'
import { isIsoInstant } from '../core/time/clock'
import type { KeyValueStore } from './calibrationLog'

const KEY = 'campus-loops-saved-v1'
export const MAX_SAVED_PLANS = 12
export const MAX_BACKUP_BYTES = 64 * 1024
export const SAVED_PLANS_BACKUP_FORMAT = 'campus-loops-saved-walks'
export const SAVED_PLANS_BACKUP_VERSION = 1
export interface SavedPlan { hash: string; name: string; savedAt: string }

function valid(value: unknown): value is SavedPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  return typeof p.hash === 'string' && p.hash.startsWith('#') && decodeShare(p.hash).ok &&
    typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 240 &&
    typeof p.savedAt === 'string' && isIsoInstant(p.savedAt)
}

const cleanPlan = (p: SavedPlan): SavedPlan => ({ hash: p.hash, name: p.name, savedAt: p.savedAt })

function defaultStore(): KeyValueStore | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function readSavedPlans(store: KeyValueStore | null): SavedPlan[] | null {
  if (!store) return null
  try {
    const raw = store.getItem(KEY) ?? '[]'
    let value: unknown
    try { value = JSON.parse(raw) } catch { return [] }
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    return value.filter(valid).filter((p) => {
      if (seen.has(p.hash)) return false
      seen.add(p.hash)
      return true
    }).slice(0, MAX_SAVED_PLANS).map(cleanPlan)
  } catch { return null }
}

export function listSavedPlans(store: KeyValueStore | null = defaultStore()): SavedPlan[] {
  return readSavedPlans(store) ?? []
}

export function savePlan(p: SavedPlan, store: KeyValueStore | null = defaultStore()): 'saved' | 'full' | 'unavailable' {
  if (!valid(p)) return 'unavailable'
  const read = readSavedPlans(store)
  if (!store || !read) return 'unavailable'
  const existing = read.filter((s) => s.hash !== p.hash)
  if (existing.length >= MAX_SAVED_PLANS) return 'full'
  try {
    store.setItem(KEY, JSON.stringify([cleanPlan(p), ...existing]))
    return 'saved'
  } catch { return 'unavailable' }
}

export function removeSavedPlan(hash: string, store: KeyValueStore | null = defaultStore()): boolean {
  const existing = readSavedPlans(store)
  if (!store || !existing) return false
  try {
    store.setItem(KEY, JSON.stringify(existing.filter((s) => s.hash !== hash)))
    return true
  } catch { return false }
}

export type SavedPlansExport =
  | { ok: true; json: string; count: number }
  | { ok: false; message: string }

/** Export only documented saved-walk fields, never unrelated browser storage. */
export function exportSavedPlans(store: KeyValueStore | null = defaultStore()): SavedPlansExport {
  const plans = readSavedPlans(store)
  if (!plans) return { ok: false, message: 'Storage is unavailable in this browser. The backup could not be created.' }
  const json = JSON.stringify({ format: SAVED_PLANS_BACKUP_FORMAT, version: SAVED_PLANS_BACKUP_VERSION, plans }, null, 2)
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    return { ok: false, message: 'These saved walks exceed the 64 KB backup limit. Remove an unusually long entry and try again.' }
  }
  return {
    ok: true,
    count: plans.length,
    json,
  }
}

export type SavedPlansImport =
  | { ok: true; imported: number; skipped: number; total: number }
  | { ok: false; reason: 'invalid' | 'too-large' | 'too-many' | 'full' | 'unavailable'; message: string }

function exactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

/**
 * Validate the whole backup and capacity before one atomic Web Storage write.
 * Matching hashes keep the existing name/date. Hashes are intentionally not
 * rebuilt: opening a saved walk must still check its original dataset version.
 */
export function importSavedPlans(json: string, store: KeyValueStore | null = defaultStore()): SavedPlansImport {
  const invalid = (): SavedPlansImport => ({ ok: false, reason: 'invalid', message: 'This is not a valid Campus Loops saved-walk backup. Nothing was imported.' })
  if (typeof json !== 'string') return invalid()
  // The cheap character check avoids allocating an encoder buffer for huge input.
  if (json.length > MAX_BACKUP_BYTES || new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    return { ok: false, reason: 'too-large', message: 'Choose a saved-walk backup smaller than 64 KB. Nothing was imported.' }
  }
  let value: unknown
  try { value = JSON.parse(json) } catch { return invalid() }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, ['format', 'version', 'plans'])) return invalid()
  const backup = value as Record<string, unknown>
  if (backup.format !== SAVED_PLANS_BACKUP_FORMAT || backup.version !== SAVED_PLANS_BACKUP_VERSION || !Array.isArray(backup.plans)) return invalid()
  if (backup.plans.length > MAX_SAVED_PLANS) {
    return { ok: false, reason: 'too-many', message: `A backup can contain at most ${MAX_SAVED_PLANS} walks. Nothing was imported.` }
  }
  if (!backup.plans.every((plan) => valid(plan) && exactKeys(plan, ['hash', 'name', 'savedAt']))) return invalid()

  const existing = readSavedPlans(store)
  if (!store || !existing) {
    return { ok: false, reason: 'unavailable', message: 'Storage is unavailable in this browser. Nothing was imported.' }
  }
  const seen = new Set(existing.map((plan) => plan.hash))
  const additions: SavedPlan[] = []
  for (const plan of backup.plans as SavedPlan[]) {
    if (seen.has(plan.hash)) continue
    seen.add(plan.hash)
    additions.push(cleanPlan(plan))
  }
  if (existing.length + additions.length > MAX_SAVED_PLANS) {
    const removeCount = existing.length + additions.length - MAX_SAVED_PLANS
    return { ok: false, reason: 'full', message: `Remove ${removeCount} saved walk${removeCount === 1 ? '' : 's'} to make room, then restore again. Nothing was imported.` }
  }
  if (additions.length) {
    try { store.setItem(KEY, JSON.stringify([...existing, ...additions])) } catch {
      return { ok: false, reason: 'unavailable', message: 'Browser storage is full or unavailable. Nothing was imported.' }
    }
  }
  return { ok: true, imported: additions.length, skipped: backup.plans.length - additions.length, total: existing.length + additions.length }
}
