import type { Place, PlaceCategory } from '../core/types'

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
