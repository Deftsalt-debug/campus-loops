import type { Place, PlaceCategory } from '../core/types'
import { DEFAULT_CONFIG } from '../core/planner/config'

export const CATEGORY_LABEL: Record<PlaceCategory, string> = {
  cafe: 'Food & coffee', seating: 'Places to sit', landmark: 'Landmarks', waypoint: 'Waypoints',
}

const normalise = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Search only the supplied campus catalogue; tags are descriptions, not live guarantees. */
export function findCampusPlaces(places: Place[], query: string, category: PlaceCategory | 'all' = 'all'): Place[] {
  const words = normalise(query).split(' ').filter(Boolean)
  return places.filter((place) => {
    if (place.category === 'waypoint' || (category !== 'all' && place.category !== category)) return false
    const searchable = normalise([place.name, CATEGORY_LABEL[place.category], ...place.tags].join(' '))
    return words.every((word) => searchable.includes(word))
  })
}

export function unconfirmedPlaceDetails(place: Place): string | null {
  if (place.hoursStatus === 'unknown') return 'Hours unconfirmed'
  if (place.spendLowInr === null || place.spendHighInr === null) return 'Price unconfirmed'
  return null
}

/** A saved planning window must never be presented as live business availability. */
export function placeHoursNote(place: Place): string {
  if (place.hoursStatus === 'unknown') return 'Opening hours unconfirmed';
  if (place.hoursSource === 'placeholder') {
    return place.hoursStatus === 'always'
      ? 'Outdoor access assumed; check before visiting'
      : 'Opening hours are estimates; check before visiting';
  }
  if (place.hoursSource === 'osm') return `Hours from saved OpenStreetMap data (${place.verifiedAt})`;
  return `Hours recorded ${place.verifiedAt}; confirm today’s hours`;
}

/** Toggle a must-visit without losing another stop or creating a duplicate. */
export function toggleRequiredPlace(required: [string, string], placeId: string): [string, string] {
  if (!placeId) return required
  if (required.includes(placeId)) return required.map((id) => id === placeId ? '' : id) as [string, string]
  const slot = required.indexOf('')
  if (slot === -1) return required
  const next: [string, string] = [...required]
  next[slot] = placeId
  return next
}

/** Update one stop without dropping custom times carried by a shared walk. */
export function updateStopTime(
  overrides: Record<string, number> | undefined,
  placeId: string,
  input: string | null,
): Record<string, number> | undefined {
  const next = { ...overrides }
  if (input === null) delete next[placeId]
  // A cleared input must invalidate the plan until corrected or reset. Treating
  // it as zero, or keeping the previous value, would show a misleading route.
  else Object.defineProperty(next, placeId, {
    value: input.trim() === '' ? NaN : Number(input), enumerable: true, writable: true, configurable: true,
  })
  return Object.keys(next).length ? next : undefined
}

export function stopTimeError(minutes: number): string | null {
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= DEFAULT_CONFIG.maxDwellMin
    ? null
    : `Choose between 0 and ${DEFAULT_CONFIG.maxDwellMin} minutes, or reset to the default.`
}
