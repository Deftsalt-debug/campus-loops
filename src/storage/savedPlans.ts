import { decodeShare } from '../core/share'
import { isIsoInstant } from '../core/time/clock'
import type { KeyValueStore } from './calibrationLog'

export const SAVED_PLANS_KEY = 'campus-loops-saved-v1'
export const MAX_SAVED_PLANS = 12
export const MAX_BACKUP_BYTES = 64 * 1024
export const SAVED_PLANS_BACKUP_FORMAT = 'campus-loops-saved-walks'
export const SAVED_PLANS_BACKUP_VERSION = 1
export interface SavedPlan { hash: string; name: string; savedAt: string }
export interface SavedPlansSnapshot {
  plans: SavedPlan[]
  status: 'ready' | 'unavailable' | 'corrupt'
}

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

/** Salvage readable walks without treating damaged storage as empty writable storage. */
export function readSavedPlans(store: KeyValueStore | null = defaultStore()): SavedPlansSnapshot {
  if (!store) return { plans: [], status: 'unavailable' }
  try {
    const raw = store.getItem(SAVED_PLANS_KEY) ?? '[]'
    if (raw.length > 1_000_000) return { plans: [], status: 'corrupt' }
    let value: unknown
    try { value = JSON.parse(raw) } catch { return { plans: [], status: 'corrupt' } }
    if (!Array.isArray(value)) return { plans: [], status: 'corrupt' }
    const seen = new Set<string>()
    const plans: SavedPlan[] = []
    let damaged = false
    for (const candidate of value) {
      if (!valid(candidate)) { damaged = true; continue }
      if (seen.has(candidate.hash)) continue
      seen.add(candidate.hash)
      plans.push(cleanPlan(candidate))
    }
    // The creation limit cannot discard readable records from older or changed stores.
    return { plans, status: damaged ? 'corrupt' : 'ready' }
  } catch { return { plans: [], status: 'unavailable' } }
}

export function listSavedPlans(store: KeyValueStore | null = defaultStore()): SavedPlan[] {
  return readSavedPlans(store).plans
}

export function savePlan(p: SavedPlan, store: KeyValueStore | null = defaultStore()): 'saved' | 'full' | 'unavailable' | 'corrupt' {
  if (!valid(p)) return 'unavailable'
  const snapshot = readSavedPlans(store)
  if (!store || snapshot.status === 'unavailable') return 'unavailable'
  if (snapshot.status === 'corrupt') return 'corrupt'
  const existing = snapshot.plans.filter((s) => s.hash !== p.hash)
  if (existing.length >= MAX_SAVED_PLANS) return 'full'
  try {
    store.setItem(SAVED_PLANS_KEY, JSON.stringify([cleanPlan(p), ...existing]))
    return 'saved'
  } catch { return 'unavailable' }
}

export function removeSavedPlan(hash: string, store: KeyValueStore | null = defaultStore()): boolean {
  const snapshot = readSavedPlans(store)
  if (!store || snapshot.status !== 'ready') return false
  try {
    store.setItem(SAVED_PLANS_KEY, JSON.stringify(snapshot.plans.filter((s) => s.hash !== hash)))
    return true
  } catch { return false }
}

/** Explicit recovery action: retain all readable walks and discard unreadable records. */
export function repairSavedPlans(store: KeyValueStore | null = defaultStore()): boolean {
  const snapshot = readSavedPlans(store)
  if (!store || snapshot.status !== 'corrupt') return false
  try {
    store.setItem(SAVED_PLANS_KEY, JSON.stringify(snapshot.plans))
    return true
  } catch { return false }
}

export type SavedPlansExport =
  | { ok: true; json: string; count: number; warning?: string }
  | { ok: false; message: string }

/** Export only documented saved-walk fields, never unrelated browser storage. */
export function exportSavedPlans(store: KeyValueStore | null = defaultStore()): SavedPlansExport {
  const snapshot = readSavedPlans(store)
  const plans = snapshot.plans
  if (snapshot.status === 'unavailable') return { ok: false, message: 'Storage is unavailable in this browser. The backup could not be created.' }
  if (snapshot.status === 'corrupt' && plans.length === 0) {
    return { ok: false, message: 'Saved data is damaged and no readable walks could be exported. Existing data has been kept unchanged.' }
  }
  if (plans.length > MAX_SAVED_PLANS) {
    return { ok: false, message: `All ${plans.length} readable walks have been kept, but a restorable backup supports at most ${MAX_SAVED_PLANS}. Remove unwanted walks before exporting.` }
  }
  const json = JSON.stringify({ format: SAVED_PLANS_BACKUP_FORMAT, version: SAVED_PLANS_BACKUP_VERSION, plans }, null, 2)
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    return { ok: false, message: 'These saved walks exceed the 64 KB backup limit. Remove an unusually long entry and try again.' }
  }
  return {
    ok: true,
    count: plans.length,
    json,
    ...(snapshot.status === 'corrupt' ? { warning: 'Only readable walks are included. Damaged entries remain unchanged on this device until you choose Repair saved walks.' } : {}),
  }
}

export type SavedPlansImport =
  | { ok: true; imported: number; skipped: number; total: number }
  | { ok: false; reason: 'invalid' | 'too-large' | 'too-many' | 'full' | 'unavailable' | 'corrupt'; message: string }

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

  const snapshot = readSavedPlans(store)
  if (!store || snapshot.status === 'unavailable') {
    return { ok: false, reason: 'unavailable', message: 'Storage is unavailable in this browser. Nothing was imported.' }
  }
  if (snapshot.status === 'corrupt') {
    return { ok: false, reason: 'corrupt', message: 'Saved data needs repair before restoring a backup. Export readable walks, then choose Repair saved walks. Existing data has been kept unchanged.' }
  }
  const existing = snapshot.plans
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
    try { store.setItem(SAVED_PLANS_KEY, JSON.stringify([...existing, ...additions])) } catch {
      return { ok: false, reason: 'unavailable', message: 'Browser storage is full or unavailable. Nothing was imported.' }
    }
  }
  return { ok: true, imported: additions.length, skipped: backup.plans.length - additions.length, total: existing.length + additions.length }
}
