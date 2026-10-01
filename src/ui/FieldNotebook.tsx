import { useEffect, useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Dataset } from '../core/types'
import {
  exportFieldNotesJson, FIELD_NOTES_KEY, fieldNotesForDataset, MAX_FIELD_NOTE_LENGTH, MAX_FIELD_NOTES,
  readFieldNotes, removeFieldNote, repairFieldNotes, saveFieldNote,
} from '../storage/fieldNotes'
import type { FieldNoteCategory, FieldNoteResult } from '../storage/fieldNotes'
import { download, fromIstInput, istInputValue } from './format'
import './FieldNotebook.css'

const LABELS: Record<FieldNoteCategory, string> = { prices: 'Prices', hours: 'Opening hours', access: 'Access & conditions' }
const ERRORS: Record<Exclude<FieldNoteResult, 'saved'>, string> = {
  full: 'Your notebook is full. Export your notes, then remove an older one to make room.',
  invalid: 'Choose a place and enter a valid date and a note of 1–1,500 characters.',
  unavailable: 'Could not save on this device. Browser storage may be blocked or full. Your draft is still here.',
  corrupt: 'Saved data needs repair before you can make changes. Export readable notes first.',
  unsupported: 'This notebook uses an unsupported format. Existing data has been kept unchanged.',
}

interface Props { dataset: Dataset; notify: (message: string) => void }

export function FieldNotebook({ dataset, notify }: Props) {
  const id = useId()
  const [snapshot, setSnapshot] = useState(readFieldNotes)
  const [placeId, setPlaceId] = useState('')
  const [category, setCategory] = useState<FieldNoteCategory>('prices')
  const [observedAt, setObservedAt] = useState(() => istInputValue(new Date()))
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const places = useMemo(() => [...dataset.places].sort((a, b) => a.name.localeCompare(b.name)), [dataset])
  const relevant = useMemo(() => fieldNotesForDataset(snapshot.notes, dataset), [snapshot.notes, dataset])
  const notes = showAll ? snapshot.notes : relevant
  const selectedPlaceId = places.some((place) => place.id === placeId) ? placeId : ''

  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key === FIELD_NOTES_KEY) setSnapshot(readFieldNotes())
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const place = dataset.places.find((entry) => entry.id === selectedPlaceId)
    const date = fromIstInput(observedAt)
    if (!place || !date || !text.trim()) { setError(ERRORS.invalid); return }
    if (date.getTime() > Date.now()) { setError('The observation date cannot be in the future.'); return }
    const result = saveFieldNote({
      id: globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      datasetVersion: dataset.datasetVersion, placeId: place.id, placeName: place.name,
      category, text, observedAt: date.toISOString(),
    })
    setSnapshot(readFieldNotes())
    if (result !== 'saved') { setError(ERRORS[result]); return }
    setText('')
    setError('')
    setObservedAt(istInputValue(new Date()))
    notify('Observation saved only on this device')
  }

  const remove = (noteId: string) => {
    const ok = removeFieldNote(noteId)
    setSnapshot(readFieldNotes())
    setError(ok ? '' : 'Could not remove this note. Browser storage may be unavailable or need repair.')
    if (ok) notify('Observation removed from this device')
  }

  const exportNotes = () => {
    const current = readFieldNotes()
    setSnapshot(current)
    if (current.status === 'unavailable' || current.status === 'unsupported' || current.notes.length === 0) {
      setError('No readable observations are available to export.'); return
    }
    try {
      download('campus-loops-field-notes.json', 'application/json', exportFieldNotesJson())
      setError('')
      notify('Field notes exported for your review')
    } catch { setError('The download could not start. Your saved notes are still on this device.') }
  }

  return (
    <details className="more card field-notebook">
      <summary>Campus field notebook <span className="count">{snapshot.notes.length}</span></summary>
      <p className="hint">Keep what you notice on campus: a meal price, opening hours or a blocked entrance. These are your observations, not verified route data. They do not change plans.</p>
      <p className="hint" id={`${id}-privacy`}>Only in this browser; clearing site data removes notes. Nothing is sent automatically. Keep notes about places and avoid personal details.</p>

      {snapshot.status === 'unavailable' && <p className="field-note-error" role="status">Browser storage is unavailable. Saving and exporting need access to this device’s storage.</p>}
      {snapshot.status === 'unsupported' && <p className="field-note-error" role="status">{ERRORS.unsupported}</p>}
      {snapshot.status === 'corrupt' && <div className="field-note-error" role="status">
        <p>Some saved data could not be read. Changes are paused to protect your notebook. Export readable notes before repairing; repair discards unreadable entries.</p>
        <button type="button" className="btn" onClick={() => {
          const ok = repairFieldNotes()
          setSnapshot(readFieldNotes())
          setError(ok ? '' : 'Could not repair the notebook. Browser storage may be blocked or full.')
          if (ok) notify('Notebook repaired; readable notes were kept')
        }}>Repair notebook</button>
      </div>}

      <form className="field-note-form" onSubmit={save} aria-describedby={`${id}-privacy`}>
        <label htmlFor={`${id}-place`}>Place</label>
        <select id={`${id}-place`} className="input" value={selectedPlaceId} onChange={(e) => setPlaceId(e.target.value)} required>
          <option value="">Choose a campus place</option>
          {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
        </select>
        <div className="field-note-grid">
          <div>
            <label htmlFor={`${id}-category`}>Observation</label>
            <select id={`${id}-category`} className="input" value={category} onChange={(e) => setCategory(e.target.value as FieldNoteCategory)}>
              {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-date`}>Observed at (IST)</label>
            <input id={`${id}-date`} className="input" type="datetime-local" required value={observedAt} onChange={(e) => setObservedAt(e.target.value)} />
          </div>
        </div>
        <label htmlFor={`${id}-text`}>What did you notice?</label>
        <textarea id={`${id}-text`} className="input" rows={3} required maxLength={MAX_FIELD_NOTE_LENGTH} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={`${id}-length`} placeholder="Describe what you observed and any limits to what you checked." />
        <p className="hint" id={`${id}-length`}>{text.length.toLocaleString('en-IN')} / 1,500 characters · {snapshot.notes.length} / {MAX_FIELD_NOTES} notes on this device</p>
        <button type="submit" className="btn" disabled={snapshot.status !== 'ready' || places.length === 0 || snapshot.notes.length >= MAX_FIELD_NOTES}>Save observation</button>
        {snapshot.notes.length >= MAX_FIELD_NOTES && <p className="hint">Notebook full. Export, then remove a note to make room.</p>}
      </form>

      {error && <p className="field-note-error" role="alert">{error}</p>}
      <div className="actions field-note-tools">
        <button type="button" className="btn ghost" onClick={exportNotes} disabled={snapshot.notes.length === 0}>Export all notes (JSON)</button>
        {relevant.length < snapshot.notes.length && <button type="button" className="btn ghost" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show this catalogue' : `Show all ${snapshot.notes.length} notes`}</button>}
      </div>
      {notes.length === 0 ? <p className="hint">{snapshot.notes.length > 0 ? 'No observations for this catalogue. Your other notes remain on this device and are included in exports.' : 'No observations yet. Add your first campus check above.'}</p> : <ul className="field-note-list" aria-label="Your campus observations">
        {notes.map((note) => <li key={note.id}>
          <div className="field-note-heading"><strong>{note.placeName}</strong><span>{LABELS[note.category]}</span></div>
          <time dateTime={note.observedAt}>{istInputValue(new Date(note.observedAt)).replace('T', ' ')} IST</time>
          {note.datasetVersion !== dataset.datasetVersion && <p className="hint">Different map version: {note.datasetVersion}. Recheck before relying on it.</p>}
          <p className="field-note-text">{note.text}</p>
          <button type="button" className="btn ghost" disabled={snapshot.status !== 'ready'} aria-label={`Remove ${LABELS[note.category].toLowerCase()} observation for ${note.placeName} from ${istInputValue(new Date(note.observedAt)).replace('T', ' ')} IST`} onClick={() => remove(note.id)}>Remove note</button>
        </li>)}
      </ul>}
    </details>
  )
}
