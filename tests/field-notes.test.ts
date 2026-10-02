import { describe, expect, it, vi } from 'vitest'
import type { KeyValueStore } from '../src/storage/calibrationLog'
import {
  exportFieldNotesJson, FIELD_NOTES_KEY, fieldNotesForDataset, fieldNotesToJson, MAX_FIELD_NOTES,
  readFieldNotes, removeFieldNote, repairFieldNotes, saveFieldNote,
} from '../src/storage/fieldNotes'
import type { FieldNote } from '../src/storage/fieldNotes'
import { tinyDataset } from './helpers'

const note: FieldNote = {
  id: 'note-1', datasetVersion: 'tiny', placeId: 'p0', placeName: 'Campus café',
  category: 'prices', text: 'Observed price on the menu: ₹40 for tea.', observedAt: '2026-10-01T10:00:00.000Z',
}

function memoryStore(notes: unknown[] = []): KeyValueStore & { value: string; writes: number } {
  return {
    value: JSON.stringify({ schemaVersion: 1, notes }), writes: 0,
    getItem(key) { expect(key).toBe(FIELD_NOTES_KEY); return this.value },
    setItem(key, value) { expect(key).toBe(FIELD_NOTES_KEY); this.value = value; this.writes++ },
    removeItem() { throw new Error('Whole storage removal is not part of this feature') },
  }
}

describe('field notebook persistence', () => {
  it('adds, chronologically sorts, reloads and removes a dated observation', () => {
    const store = memoryStore()
    expect(saveFieldNote(note, store)).toBe('saved')
    const older = { ...note, id: 'older', observedAt: '2026-09-30T10:00:00.000Z', category: 'hours' as const }
    expect(saveFieldNote(older, store)).toBe('saved')
    expect(readFieldNotes(store)).toEqual({ notes: [note, older], status: 'ready' })
    expect(removeFieldNote(note.id, store)).toBe(true)
    expect(readFieldNotes(store).notes).toEqual([older])
  })

  it('keeps observations across map versions without editing dataset facts', () => {
    const dataset = tinyDataset(['start'], [], [{ id: 'p0', name: 'Campus café' }])
    const before = structuredClone(dataset)
    const old = { ...note, id: 'old', datasetVersion: 'tiny-previous' }
    const other = { ...note, id: 'other', datasetVersion: 'other-map', placeId: 'other' }
    const removed = { ...note, id: 'removed', placeId: 'no-longer-listed' }
    const store = memoryStore([note, old, other, removed])
    const snapshot = readFieldNotes(store)
    expect(fieldNotesForDataset(snapshot.notes, dataset).map((entry) => entry.id).sort()).toEqual(['note-1', 'old', 'removed'])
    expect(snapshot.notes).toHaveLength(4)
    expect(dataset).toEqual(before)
  })

  it('normalizes whitespace and timezone offsets, storing only documented fields', () => {
    const store = memoryStore()
    const submitted = { ...note, id: ' note-1 ', text: '  Menu checked.  ', observedAt: '2026-10-01T15:30:00+05:30', preciseLocation: [13.3, 74.7], userEmail: 'private@example.test' }
    expect(saveFieldNote(submitted, store)).toBe('saved')
    expect(readFieldNotes(store).notes).toEqual([{ ...note, text: 'Menu checked.' }])
    expect(store.value).not.toContain('preciseLocation')
    expect(store.value).not.toContain('userEmail')
  })

  it('exports every readable map version with a schema and unverified label, without hidden location data', () => {
    const store = memoryStore([{ ...note, preciseLocation: [13.3, 74.7] }, { ...note, id: 'older', datasetVersion: 'older-map', placeId: 'removed' }])
    const exported = JSON.parse(exportFieldNotesJson(store))
    expect(exported.schemaVersion).toBe(1)
    expect(exported.kind).toBe('campus-loops-field-observations')
    expect(exported.verified).toBe(false)
    expect(exported.notes).toHaveLength(2)
    expect(exported.notes[0]).toEqual(note)
    expect(exportFieldNotesJson(store)).not.toContain('preciseLocation')
  })

  it('exports the checked notebook snapshot even if browser storage changes afterwards', () => {
    const store = memoryStore([{ ...note, preciseLocation: [13.3, 74.7] }])
    const snapshot = readFieldNotes(store)
    store.getItem = () => { throw new Error('Storage became unavailable') }
    expect(JSON.parse(fieldNotesToJson(snapshot.notes))).toEqual({
      schemaVersion: 1, kind: 'campus-loops-field-observations', verified: false, notes: [note],
    })
  })

  it('bounds the notebook without silently evicting old observations', () => {
    const store = memoryStore(Array.from({ length: MAX_FIELD_NOTES }, (_, index) => ({ ...note, id: `note-${index}` })))
    const before = store.value
    expect(saveFieldNote({ ...note, id: 'overflow' }, store)).toBe('full')
    expect(store.value).toBe(before)
    expect(saveFieldNote({ ...note, text: 'Updated check.' }, store)).toBe('saved')
    expect(readFieldNotes(store).notes).toHaveLength(MAX_FIELD_NOTES)
    expect(removeFieldNote('note-0', store)).toBe(true)
    expect(saveFieldNote({ ...note, id: 'new' }, store)).toBe('saved')
  })

  it('accepts the full text limit and rejects the next character', () => {
    const store = memoryStore()
    expect(saveFieldNote({ ...note, text: 'a'.repeat(1500) }, store)).toBe('saved')
    expect(saveFieldNote({ ...note, text: 'a'.repeat(1501) }, store)).toBe('invalid')
    expect(readFieldNotes(store).notes[0].text).toHaveLength(1500)
  })

  it.each([
    { id: '' }, { id: ' '.repeat(2) }, { id: 'x'.repeat(129) },
    { datasetVersion: '' }, { datasetVersion: 'x'.repeat(513) },
    { placeId: '' }, { placeId: '../other' }, { placeId: 'x'.repeat(121) },
    { placeName: '' }, { placeName: 'x'.repeat(241) },
    { text: '' }, { text: ' \n\t ' }, { text: 'x'.repeat(1501) },
    { category: 'emergency' }, { category: null }, { observedAt: 'today' },
    { observedAt: '2026-10-01T10:00:00' }, { observedAt: '2026-02-30T10:00:00Z' },
    { observedAt: '2026-10-01T24:00:00Z' }, { observedAt: '2026-10-01T10:00:00+25:30' },
    { observedAt: '0000-01-01T00:00:00+23:59' }, { observedAt: '9999-12-31T23:59:59-23:59' },
  ])('rejects invalid observations before a write: %j', (patch) => {
    const store = memoryStore([note])
    expect(saveFieldNote({ ...note, ...patch } as FieldNote, store)).toBe('invalid')
    expect(store.writes).toBe(0)
    expect(readFieldNotes(store).notes).toEqual([note])
  })

  it('handles first use with no storage key', () => {
    const store = memoryStore()
    store.getItem = () => null
    expect(readFieldNotes(store)).toEqual({ notes: [], status: 'ready' })
    expect(saveFieldNote(note, store)).toBe('saved')
  })

  it.each(['broken json', '[]', 'null', '{"schemaVersion":1,"notes":null}'])('preserves corrupt bytes until an explicit repair: %s', (raw) => {
    const store = memoryStore()
    store.value = raw
    expect(readFieldNotes(store)).toEqual({ notes: [], status: 'corrupt' })
    expect(saveFieldNote(note, store)).toBe('corrupt')
    expect(removeFieldNote(note.id, store)).toBe(false)
    expect(store.value).toBe(raw)
    expect(repairFieldNotes(store)).toBe(true)
    expect(saveFieldNote(note, store)).toBe('saved')
  })

  it.each([2, '1', undefined])('does not overwrite an unsupported schema: %s', (schemaVersion) => {
    const store = memoryStore()
    store.value = JSON.stringify({ schemaVersion, notes: [note] })
    const before = store.value
    expect(readFieldNotes(store).status).toBe('unsupported')
    expect(saveFieldNote(note, store)).toBe('unsupported')
    expect(removeFieldNote(note.id, store)).toBe(false)
    expect(repairFieldNotes(store)).toBe(false)
    expect(store.value).toBe(before)
  })

  it('recovers readable notes, deduplicates IDs and explicitly repairs damaged entries', () => {
    const store = memoryStore([note, { ...note, text: 'Newer value.' }, { ...note, id: 'invalid', observedAt: 'yesterday' }])
    expect(readFieldNotes(store)).toEqual({ notes: [{ ...note, text: 'Newer value.' }], status: 'corrupt' })
    expect(JSON.parse(exportFieldNotesJson(store)).notes).toHaveLength(1)
    expect(repairFieldNotes(store)).toBe(true)
    expect(readFieldNotes(store).status).toBe('ready')
    expect(readFieldNotes(store).notes).toHaveLength(1)
  })

  it('preserves an overflow notebook for export and removal while blocking additions', () => {
    const store = memoryStore(Array.from({ length: 101 }, (_, index) => ({ ...note, id: String(index) })))
    const before = store.value
    expect(readFieldNotes(store).notes).toHaveLength(101)
    expect(readFieldNotes(store).status).toBe('ready')
    expect(JSON.parse(exportFieldNotesJson(store)).notes).toHaveLength(101)
    expect(saveFieldNote({ ...note, id: 'new' }, store)).toBe('full')
    expect(repairFieldNotes(store)).toBe(false)
    expect(store.value).toBe(before)
    expect(removeFieldNote('0', store)).toBe(true)
    expect(readFieldNotes(store).notes).toHaveLength(MAX_FIELD_NOTES)
    expect(saveFieldNote({ ...note, id: 'new' }, store)).toBe('full')
    expect(removeFieldNote('1', store)).toBe(true)
    expect(saveFieldNote({ ...note, id: 'new' }, store)).toBe('saved')
    expect(readFieldNotes(store).notes).toHaveLength(MAX_FIELD_NOTES)
    expect(JSON.parse(exportFieldNotesJson(store)).notes.map((entry: FieldNote) => entry.id).sort()).toEqual([
      ...Array.from({ length: 99 }, (_, index) => String(index + 2)), 'new',
    ].sort())
  })

  it('repairs damaged entries without discarding readable overflow notes', () => {
    const notes = Array.from({ length: 101 }, (_, index) => ({ ...note, id: String(index) }))
    const store = memoryStore([...notes, { ...note, id: 'invalid', observedAt: 'yesterday' }])
    expect(readFieldNotes(store).status).toBe('corrupt')
    expect(JSON.parse(exportFieldNotesJson(store)).notes).toHaveLength(101)
    expect(repairFieldNotes(store)).toBe(true)
    expect(readFieldNotes(store).status).toBe('ready')
    expect(readFieldNotes(store).notes).toHaveLength(101)
    expect(JSON.parse(store.value).notes).toHaveLength(101)
  })

  it('rejects a save before JSON escaping can make the notebook exceed its readable size', () => {
    // All fields are within their character limits. Escaped control characters
    // can nevertheless make JSON much larger than those limits suggest.
    const entry = {
      ...note, datasetVersion: `v${'\u0000'.repeat(511)}`, placeName: `n${'\u0000'.repeat(239)}`,
      text: `t${'\u0000'.repeat(1499)}`,
    };
    const notes: FieldNote[] = [];
    let candidate = { ...entry, id: 'note-0' };
    while (JSON.stringify({ schemaVersion: 1, notes: [...notes, candidate] }).length <= 1_000_000) {
      notes.push(candidate);
      candidate = { ...entry, id: `note-${notes.length}` };
    }
    expect(notes.length).toBeLessThan(MAX_FIELD_NOTES);
    const store = memoryStore(notes);
    const before = store.value;
    expect(readFieldNotes(store).status).toBe('ready');
    expect(saveFieldNote(candidate, store)).toBe('unavailable');
    expect(store.value).toBe(before);
    expect(store.writes).toBe(0);
    expect(readFieldNotes(store).status).toBe('ready');
    expect(JSON.parse(exportFieldNotesJson(store)).notes).toHaveLength(notes.length);
    expect(removeFieldNote(notes[0].id, store)).toBe(true);
    expect(saveFieldNote(candidate, store)).toBe('saved');
    expect(readFieldNotes(store).status).toBe('ready');
  })

  it('bounds oversized persisted payloads without overwriting their contents', () => {
    const store = memoryStore()
    store.value = 'a'.repeat(1_000_001)
    expect(readFieldNotes(store)).toEqual({ notes: [], status: 'corrupt' })
    expect(saveFieldNote(note, store)).toBe('corrupt')
    expect(removeFieldNote(note.id, store)).toBe(false)
    expect(store.writes).toBe(0)
  })

  it('handles missing/blocked storage without destructive writes', () => {
    expect(readFieldNotes(null).status).toBe('unavailable')
    expect(saveFieldNote(note, null)).toBe('unavailable')
    expect(removeFieldNote(note.id, null)).toBe(false)
    const store = memoryStore([note])
    store.getItem = () => { throw new Error('SecurityError') }
    store.setItem = vi.fn()
    expect(readFieldNotes(store).status).toBe('unavailable')
    expect(saveFieldNote(note, store)).toBe('unavailable')
    expect(removeFieldNote(note.id, store)).toBe(false)
    expect(repairFieldNotes(store)).toBe(false)
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('preserves existing notes after quota errors for saves and removals', () => {
    const store = memoryStore([note])
    const before = store.value
    store.setItem = () => { throw new Error('QuotaExceededError') }
    expect(saveFieldNote({ ...note, id: 'new' }, store)).toBe('unavailable')
    expect(removeFieldNote(note.id, store)).toBe(false)
    expect(store.value).toBe(before)
  })

  it('reads fresh data for each mutation, retaining another tab’s latest note', () => {
    const store = memoryStore([note])
    readFieldNotes(store)
    store.value = JSON.stringify({ schemaVersion: 1, notes: [note, { ...note, id: 'another-tab' }] })
    expect(saveFieldNote({ ...note, id: 'this-tab' }, store)).toBe('saved')
    expect(readFieldNotes(store).notes.map((entry) => entry.id).sort()).toEqual(['another-tab', 'note-1', 'this-tab'])
  })
})
