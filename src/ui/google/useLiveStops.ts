import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { googlePlaceIdOf, matchCataloguePlace, toLivePlace, withLivePlaces, type LiveConversion, type LiveVenue } from '../../core/livePlaces'
import { toIst } from '../../core/time/clock'
import type { Dataset, Place } from '../../core/types'
import { LiveLimitError } from './limits'
import type { GoogleState } from './useGoogle'

export type LiveEntry =
  | { status: 'ready'; place: Place; venue: LiveVenue }
  | { status: 'error'; message: string }

export const todayIst = (now = new Date()) => {
  const ist = toIst(now)
  return `${ist.year}-${String(ist.month).padStart(2, '0')}-${String(ist.day).padStart(2, '0')}`
}

/** Planner place for a Google venue: the saved catalogue entry when it is the same place. */
export function resolveVenue(dataset: Dataset, venue: LiveVenue): LiveConversion | { ok: true; catalogue: Place } {
  const saved = matchCataloguePlace(dataset, venue)
  return saved ? { ok: true, catalogue: saved } : toLivePlace(dataset, venue, todayIst())
}

const failure = (error: unknown) => error instanceof LiveLimitError ? error.message
  : 'Google Maps details for this place could not be loaded. Check your connection, or remove it and plan again.'
const UNAVAILABLE = 'This walk includes a Google Maps place, and live Google places are not available on this site right now.'

/**
 * The Google places a walk depends on (must-visits, custom stop times and the
 * stops of a shared route). Each loads once; nothing is stored beyond the page.
 * An ID with no entry yet is still loading.
 */
export function useLiveStops(dataset: Dataset | null, google: GoogleState, neededIds: string[]) {
  const [entries, setEntries] = useState<Record<string, LiveEntry>>({})
  const [attempt, setAttempt] = useState(0)
  const requested = useRef(new Set<string>())

  const register = useCallback((venue: LiveVenue, place: Place) => {
    requested.current.add(place.id)
    setEntries((current) => ({ ...current, [place.id]: { status: 'ready', place, venue } }))
  }, [])
  /** Forget failed lookups so they are requested again. */
  const retry = useCallback(() => {
    setEntries((current) => {
      const failed = Object.keys(current).filter((id) => current[id].status === 'error')
      failed.forEach((id) => requested.current.delete(id))
      return Object.fromEntries(Object.entries(current).filter(([id]) => !failed.includes(id)))
    })
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!dataset || google.status !== 'ready') return
    for (const id of neededIds) {
      if (requested.current.has(id)) continue
      requested.current.add(id)
      const settle = (entry: LiveEntry) => setEntries((current) => ({ ...current, [id]: entry }))
      const googleId = googlePlaceIdOf(id)
      if (!googleId) { queueMicrotask(() => settle({ status: 'error', message: 'This stop is not a Google Maps place.' })); continue }
      google.live.venue(googleId)
        .then((venue) => {
          const converted = toLivePlace(dataset, venue, todayIst())
          if (converted.ok && converted.place.id === id) settle({ status: 'ready', place: converted.place, venue })
          else settle({ status: 'error', message: converted.ok ? 'This Google Maps place has changed its identifier.' : converted.message })
        })
        .catch((error: unknown) => settle({ status: 'error', message: failure(error) }))
    }
  }, [neededIds, google, dataset, attempt])

  const unavailable = google.status === 'off' || google.status === 'failed'
  const places = useMemo(() => neededIds.flatMap((id) => {
    const entry = entries[id]
    return entry?.status === 'ready' ? [entry.place] : []
  }), [neededIds, entries])
  const merged = useMemo(() => dataset && withLivePlaces(dataset, places), [dataset, places])
  const errors = neededIds.flatMap((id) => {
    const entry = entries[id]
    if (entry?.status === 'error') return [{ id, message: entry.message }]
    return !entry && unavailable ? [{ id, message: UNAVAILABLE }] : []
  })
  const loading = !unavailable && neededIds.some((id) => !entries[id])
  return { dataset: merged, loading, errors, register, retry }
}
