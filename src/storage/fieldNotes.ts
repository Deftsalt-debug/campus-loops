import type { Dataset } from '../core/types'
import { isIsoInstant } from '../core/time/clock'
import type { KeyValueStore } from './calibrationLog'

export const FIELD_NOTES_KEY = 'campusloops.field-notes.v1'
const MAX_FIELD_NOTES_STORAGE_LENGTH = 1_000_000
export const MAX_FIELD_NOTES = 100
export const MAX_FIELD_NOTE_LENGTH = 1500
export const FIELD_NOTE_CATEGORIES = ['prices', 'hours', 'access'] as const
export type FieldNoteCategory = typeof FIELD_NOTE_CATEGORIES[number]

/** User observations only: never used as verified planner inputs. */
export interface FieldNote {
  id: string
  datasetVersion: string
  placeId: string
  placeName: string
  category: FieldNoteCategory
  text: string
  observedAt: string
}

export interface FieldNotesSnapshot {
  notes: FieldNote[]
  status: 'ready' | 'unavailable' | 'corrupt' | 'unsupported'
}
export type FieldNoteResult = 'saved' | 'full' | 'invalid' | 'unavailable' | 'corrupt' | 'unsupported'

function defaultStore(): KeyValueStore | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

const nonblank = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit

function validNote(value: unknown): value is FieldNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const n = value as Record<string, unknown>
  return nonblank(n.id, 128) && nonblank(n.datasetVersion, 512) &&
    typeof n.placeId === 'string' && /^[A-Za-z0-9_:-]{1,120}$/.test(n.placeId) &&
    nonblank(n.placeName, 240) && nonblank(n.text, MAX_FIELD_NOTE_LENGTH) &&
    FIELD_NOTE_CATEGORIES.includes(n.category as FieldNoteCategory) &&
    typeof n.observedAt === 'string' && isIsoInstant(n.observedAt) &&
    isIsoInstant(new Date(n.observedAt).toISOString())
}

/** Explicit allowlist prevents hidden fields (including location) reaching disk or exports. */
function cleanNote(note: FieldNote): FieldNote {
  return {
    id: note.id.trim(), datasetVersion: note.datasetVersion.trim(), placeId: note.placeId,
    placeName: note.placeName.trim(), category: note.category, text: note.text.trim(),
    observedAt: new Date(note.observedAt).toISOString(),
  }
}

function newestFirst(notes: FieldNote[]): FieldNote[] {
  return notes.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id))
}

/** Report damaged/unsupported storage separately so a save cannot silently overwrite it. */
export function readFieldNotes(store: KeyValueStore | null = defaultStore()): FieldNotesSnapshot {
  if (!store) return { notes: [], status: 'unavailable' }
  let raw: string | null
  try { raw = store.getItem(FIELD_NOTES_KEY) } catch { return { notes: [], status: 'unavailable' } }
  if (raw === null) return { notes: [], status: 'ready' }
  // Normal maximum is well below this. Bound work on arbitrary browser-storage contents.
  if (raw.length > MAX_FIELD_NOTES_STORAGE_LENGTH) return { notes: [], status: 'corrupt' }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { notes: [], status: 'corrupt' } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { notes: [], status: 'corrupt' }
  const data = parsed as Record<string, unknown>
  if (data.schemaVersion !== 1) return { notes: [], status: 'unsupported' }
  if (!Array.isArray(data.notes)) return { notes: [], status: 'corrupt' }
  const unique = new Map<string, FieldNote>()
  let damaged = false
  for (const candidate of data.notes) {
    if (!validNote(candidate)) { damaged = true; continue }
    const note = cleanNote(candidate)
    if (unique.has(note.id)) damaged = true
    unique.set(note.id, note)
  }
  // The creation limit must never discard readable observations from existing
  // storage. Overflow notebooks remain exportable and removable until they
  // fall below the limit; saves still check capacity separately.
  return { notes: newestFirst([...unique.values()]), status: damaged ? 'corrupt' : 'ready' }
}

function writeNotes(notes: FieldNote[], store: KeyValueStore): boolean {
  try {
    const raw = JSON.stringify({ schemaVersion: 1, notes: notes.map(cleanNote) })
    // Escaped text can be larger than its character count. Never write a
    // notebook that the defensive reader would immediately reject as corrupt.
    if (raw.length > MAX_FIELD_NOTES_STORAGE_LENGTH) return false
    store.setItem(FIELD_NOTES_KEY, raw)
    return true
  } catch { return false }
}

export function saveFieldNote(note: FieldNote, store: KeyValueStore | null = defaultStore()): FieldNoteResult {
  if (!validNote(note)) return 'invalid'
  const snapshot = readFieldNotes(store)
  if (!store || snapshot.status !== 'ready') return snapshot.status === 'ready' ? 'unavailable' : snapshot.status
  const clean = cleanNote(note)
  const existing = snapshot.notes.filter((n) => n.id !== clean.id)
  if (existing.length >= MAX_FIELD_NOTES) return 'full'
  return writeNotes(newestFirst([clean, ...existing]), store) ? 'saved' : 'unavailable'
}

export function removeFieldNote(id: string, store: KeyValueStore | null = defaultStore()): boolean {
  const snapshot = readFieldNotes(store)
  return Boolean(store && snapshot.status === 'ready' && writeNotes(snapshot.notes.filter((n) => n.id !== id), store))
}

/** Explicit user action only: retain readable records and discard damaged entries. */
export function repairFieldNotes(store: KeyValueStore | null = defaultStore()): boolean {
  const snapshot = readFieldNotes(store)
  return Boolean(store && snapshot.status === 'corrupt' && writeNotes(snapshot.notes, store))
}

/** Older map observations remain relevant only if their place still exists. */
export function fieldNotesForDataset(notes: FieldNote[], dataset: Pick<Dataset, 'datasetVersion' | 'places'>): FieldNote[] {
  const placeIds = new Set(dataset.places.map((place) => place.id))
  return notes.filter((note) => note.datasetVersion === dataset.datasetVersion || placeIds.has(note.placeId))
}

/** Serialize a checked snapshot without reading a different notebook during export. */
export function fieldNotesToJson(notes: FieldNote[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: 'campus-loops-field-observations',
    verified: false,
    notes: notes.map(cleanNote),
  }, null, 2)
}

/** Export all readable observations, including other map versions, for manual review. */
export function exportFieldNotesJson(store: KeyValueStore | null = defaultStore()): string {
  return fieldNotesToJson(readFieldNotes(store).notes)
}
