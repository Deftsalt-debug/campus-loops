import { decodeShare } from '../core/share'
import { isIsoInstant } from '../core/time/clock'
import type { KeyValueStore } from './calibrationLog'

const KEY = 'campus-loops-saved-v1'
export const MAX_SAVED_PLANS = 12
export interface SavedPlan { hash: string; name: string; savedAt: string }

function valid(value: unknown): value is SavedPlan {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return typeof p.hash === 'string' && decodeShare(p.hash).ok &&
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
