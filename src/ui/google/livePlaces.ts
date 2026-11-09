import type { LiveVenue } from '../../core/livePlaces'
import type { Dataset, LatLng, PlaceCategory } from '../../core/types'
import { LiveLimitError, SESSION_LIMITS } from './limits'

// Results are cached only in memory for this page, as Google's terms require.

/** Pro-tier fields only: enough to draw a pin and name it. */
const PIN_FIELDS = ['id', 'displayName', 'location', 'types', 'primaryType', 'businessStatus']
/** One Enterprise-tier request per venue opened, for hours and price. */
const DETAIL_FIELDS = [...PIN_FIELDS, 'formattedAddress', 'googleMapsURI', 'regularOpeningHours', 'priceLevel', 'priceRange', 'rating', 'userRatingCount']

const NEARBY_TYPES: Record<Exclude<PlaceCategory, 'waypoint'>, string[]> = {
  cafe: ['restaurant', 'cafe', 'coffee_shop', 'bakery', 'fast_food_restaurant', 'ice_cream_shop', 'dessert_shop', 'juice_shop', 'food_court', 'cafeteria', 'tea_house'],
  landmark: ['tourist_attraction', 'library', 'museum', 'planetarium', 'historical_landmark', 'monument', 'art_gallery', 'hindu_temple', 'church', 'book_store', 'shopping_mall'],
  seating: ['park', 'garden', 'plaza', 'botanical_garden', 'playground', 'picnic_ground'],
}

export interface LiveSuggestion {
  placeId: string
  title: string
  detail: string
  types: string[]
  distanceM: number | null
  prediction: google.maps.places.PlacePrediction
}

export interface CampusArea {
  center: LatLng
  bounds: google.maps.LatLngBoundsLiteral
  radiusM: number
}

/** Search area: the walking network plus a margin, so suggestions stay near routes. */
export function campusArea(dataset: Dataset, marginM = 300): CampusArea {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity
  for (const node of dataset.nodes) {
    south = Math.min(south, node.lat); north = Math.max(north, node.lat)
    west = Math.min(west, node.lng); east = Math.max(east, node.lng)
  }
  if (!Number.isFinite(south)) {
    const { lat, lng } = dataset.location
    south = lat - 0.006; north = lat + 0.006; west = lng - 0.008; east = lng + 0.008
  }
  const dLat = marginM / 111_320
  const dLng = marginM / (111_320 * Math.cos(((south + north) / 2) * Math.PI / 180))
  const bounds = { south: south - dLat, north: north + dLat, west: west - dLng, east: east + dLng }
  const center: LatLng = [(bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2]
  const halfHeight = ((bounds.north - bounds.south) / 2) * 111_320
  const halfWidth = ((bounds.east - bounds.west) / 2) * 111_320 * Math.cos(center[0] * Math.PI / 180)
  return { center, bounds, radiusM: Math.min(50_000, Math.hypot(halfHeight, halfWidth)) }
}

const optional = <T,>(read: () => T): T | undefined => {
  // Reading a field that was not requested can throw in some API versions.
  try { return read() } catch { return undefined }
}

const inr = (money: google.maps.places.Money | null | undefined) =>
  money && money.currencyCode === 'INR' ? money.units + (money.nanos ?? 0) / 1e9 : null

/** Plain data from a Google Place, so the framework-free core never sees SDK objects. */
export function venueFromPlace(place: google.maps.places.Place): LiveVenue | null {
  const location = optional(() => place.location)
  if (!place.id || !location) return null
  const hours = optional(() => place.regularOpeningHours)
  const range = optional(() => place.priceRange)
  const low = inr(range?.startPrice)
  return {
    placeId: place.id,
    name: optional(() => place.displayName) ?? 'Google Maps place',
    location: [location.lat(), location.lng()],
    types: optional(() => place.types) ?? [],
    primaryType: optional(() => place.primaryType) ?? null,
    address: optional(() => place.formattedAddress) ?? null,
    mapsUrl: optional(() => place.googleMapsURI) ?? null,
    businessStatus: (optional(() => place.businessStatus) ?? null) as LiveVenue['businessStatus'],
    periods: hours === undefined ? undefined : hours?.periods.map((period) => ({
      open: { day: period.open.day, hour: period.open.hour, minute: period.open.minute },
      close: period.close ? { day: period.close.day, hour: period.close.hour, minute: period.close.minute } : null,
    })) ?? null,
    weekdayText: hours?.weekdayDescriptions ?? null,
    priceLevel: (optional(() => place.priceLevel) ?? null) as LiveVenue['priceLevel'],
    priceRangeInr: low === null ? null : { low, high: inr(range?.endPrice) },
    rating: optional(() => place.rating) ?? null,
    ratingCount: optional(() => place.userRatingCount) ?? null,
  }
}

/** Live Google search, details and nearby lists for one page, with caching and limits. */
export class LivePlaces {
  private readonly lib: google.maps.PlacesLibrary
  private readonly area: CampusArea
  private token: google.maps.places.AutocompleteSessionToken | null = null
  private readonly suggestions = new Map<string, Promise<LiveSuggestion[]>>()
  private readonly details = new Map<string, Promise<LiveVenue>>()
  private readonly nearbyLists = new Map<string, Promise<LiveVenue[]>>()
  readonly used = { suggest: 0, details: 0, nearby: 0 }

  constructor(lib: google.maps.PlacesLibrary, area: CampusArea) {
    this.lib = lib
    this.area = area
  }

  private spend(kind: keyof typeof SESSION_LIMITS) {
    if (this.used[kind] >= SESSION_LIMITS[kind]) throw new LiveLimitError()
    this.used[kind]++
  }

  /** Autocomplete within the campus area. One session token covers typing until a place is opened. */
  suggest(query: string): Promise<LiveSuggestion[]> {
    const text = query.trim().replace(/\s+/g, ' ').slice(0, 120)
    if (text.length < 2) return Promise.resolve([])
    const key = text.toLowerCase()
    const cached = this.suggestions.get(key)
    if (cached) return cached
    try { this.spend('suggest') } catch (error) { return Promise.reject(error) }
    this.token ??= new this.lib.AutocompleteSessionToken()
    const request = this.lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: text,
      sessionToken: this.token,
      locationRestriction: this.area.bounds,
      origin: { lat: this.area.center[0], lng: this.area.center[1] },
      includedRegionCodes: ['in'],
      language: 'en',
      region: 'in',
    }).then(({ suggestions }) => suggestions.flatMap((suggestion) => {
      const prediction = suggestion.placePrediction
      if (!prediction) return []
      return [{
        placeId: prediction.placeId,
        title: prediction.mainText?.text ?? prediction.text.text,
        detail: prediction.secondaryText?.text ?? '',
        types: prediction.types,
        distanceM: prediction.distanceMeters,
        prediction,
      }]
    }))
    this.suggestions.set(key, request)
    request.catch(() => this.suggestions.delete(key))
    return request
  }

  /** Full details for one venue: hours, price and rating. Ends any autocomplete session. */
  venue(placeId: string, prediction?: google.maps.places.PlacePrediction): Promise<LiveVenue> {
    const cached = this.details.get(placeId)
    if (cached) return cached
    try { this.spend('details') } catch (error) { return Promise.reject(error) }
    const place = prediction ? prediction.toPlace() : new this.lib.Place({ id: placeId })
    if (prediction) {
      // The session token is attached to this first fetchFields call; a new
      // search after it must start a new session to be billed correctly.
      this.token = null
      this.suggestions.clear()
    }
    const request = place.fetchFields({ fields: DETAIL_FIELDS }).then(({ place: fetched }) => {
      const venue = venueFromPlace(fetched)
      if (!venue) throw new Error('Google Maps returned this place without a location.')
      return venue
    })
    this.details.set(placeId, request)
    request.catch(() => this.details.delete(placeId))
    return request
  }

  /** Popular venues of one kind around campus, without paid detail fields. */
  nearby(category: Exclude<PlaceCategory, 'waypoint'>): Promise<LiveVenue[]> {
    const cached = this.nearbyLists.get(category)
    if (cached) return cached
    try { this.spend('nearby') } catch (error) { return Promise.reject(error) }
    const request = this.lib.Place.searchNearby({
      fields: PIN_FIELDS,
      includedTypes: NEARBY_TYPES[category],
      locationRestriction: { center: { lat: this.area.center[0], lng: this.area.center[1] }, radius: this.area.radiusM },
      maxResultCount: 20,
      rankPreference: this.lib.SearchNearbyRankPreference.POPULARITY,
      language: 'en',
      region: 'in',
    }).then(({ places }) => places.flatMap((place) => {
      const venue = venueFromPlace(place)
      return venue && venue.businessStatus !== 'CLOSED_PERMANENTLY' ? [venue] : []
    }))
    this.nearbyLists.set(category, request)
    request.catch(() => this.nearbyLists.delete(category))
    return request
  }
}
