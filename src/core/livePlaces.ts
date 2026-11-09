import { haversineM } from './geo';
import { isPlaceIdentifier } from './identifiers';
import type { Dataset, LatLng, OpenWindow, Place, PlaceCategory } from './types';

// Live venues come from Google Maps at runtime (see src/ui/google/). This module
// stays framework-free: it receives plain values, never Google SDK objects, and
// turns one venue into a planner Place anchored to the saved walking network.
// Google's terms allow keeping place IDs indefinitely, but not caching other
// content, so converted places live only in memory for the current session.

export const LIVE_PREFIX = 'g_';
/** A venue farther than this from any walkable path node cannot be routed honestly. */
export const MAX_SNAP_M = 150;

export type GoogleBusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
export type GooglePriceLevel = 'FREE' | 'INEXPENSIVE' | 'MODERATE' | 'EXPENSIVE' | 'VERY_EXPENSIVE';

export interface GoogleTimePoint { day: number; hour: number; minute: number }

/** The subset of a Google Place this app reads, as plain data. */
export interface LiveVenue {
  placeId: string;
  name: string;
  location: LatLng;
  types: string[];
  primaryType?: string | null;
  address?: string | null;
  mapsUrl?: string | null;
  businessStatus?: GoogleBusinessStatus | null;
  /** Regular weekly hours in local (IST) time. Undefined: not requested; null: Google has none. */
  periods?: { open: GoogleTimePoint; close: GoogleTimePoint | null }[] | null;
  weekdayText?: string[] | null;
  priceLevel?: GooglePriceLevel | null;
  /** Per-person range in INR when Google publishes one. */
  priceRangeInr?: { low: number; high: number | null } | null;
  rating?: number | null;
  ratingCount?: number | null;
}

export const livePlaceId = (googlePlaceId: string): string | null => {
  const id = `${LIVE_PREFIX}${googlePlaceId}`;
  return /^[A-Za-z0-9_-]+$/.test(googlePlaceId) && isPlaceIdentifier(id) ? id : null;
};
export const isLivePlaceId = (id: string) => id.startsWith(LIVE_PREFIX);
export const googlePlaceIdOf = (id: string) => (isLivePlaceId(id) ? id.slice(LIVE_PREFIX.length) : null);

// ---- Classification ---------------------------------------------------------

const FOOD = new Set([
  'cafe', 'coffee_shop', 'tea_house', 'bakery', 'cafeteria', 'restaurant', 'food_court', 'fast_food_restaurant',
  'meal_takeaway', 'meal_delivery', 'ice_cream_shop', 'dessert_shop', 'dessert_restaurant', 'juice_shop',
  'sandwich_shop', 'snack_bar', 'confectionery', 'chocolate_shop', 'candy_store', 'donut_shop', 'bagel_shop',
  'bar', 'pub', 'wine_bar', 'brunch_restaurant', 'breakfast_restaurant', 'diner', 'food',
]);
const OUTDOOR = new Set([
  'park', 'city_park', 'garden', 'botanical_garden', 'plaza', 'picnic_ground', 'hiking_area', 'playground',
  'scenic_spot', 'national_park', 'state_park', 'dog_park', 'observation_deck', 'lake', 'beach',
]);
const NOT_A_STOP = new Set([
  'atm', 'parking', 'bus_stop', 'bus_station', 'transit_station', 'taxi_stand', 'gas_station', 'electric_vehicle_charging_station',
]);

const isFood = (t: string) => FOOD.has(t) || t.endsWith('_restaurant');
const has = (types: Set<string>, ...names: string[]) => names.some((n) => types.has(n));

export function liveCategory(venue: Pick<LiveVenue, 'types' | 'primaryType'>): PlaceCategory {
  const primary = venue.primaryType ?? '';
  // The primary type wins: a hotel with a restaurant is not a café stop.
  if (primary && isFood(primary)) return 'cafe';
  if (primary && OUTDOOR.has(primary)) return 'seating';
  if (primary && NOT_A_STOP.has(primary)) return 'waypoint';
  if (primary) return 'landmark';
  if (venue.types.some(isFood)) return 'cafe';
  if (venue.types.some((t) => OUTDOOR.has(t))) return 'seating';
  if (venue.types.some((t) => NOT_A_STOP.has(t))) return 'waypoint';
  return 'landmark';
}

/** Occasion tags from Google's types, using the dataset's existing vocabulary. */
export function liveTags(venue: Pick<LiveVenue, 'types' | 'primaryType'>, category: PlaceCategory): string[] {
  const types = new Set([...venue.types, ...(venue.primaryType ? [venue.primaryType] : [])]);
  const tags = new Set<string>();
  if (category === 'cafe') {
    tags.add('sheltered');
    if (has(types, 'cafe', 'coffee_shop', 'tea_house')) ['coffee', 'cozy', 'conversation'].forEach((t) => tags.add(t));
    if (has(types, 'ice_cream_shop', 'dessert_shop', 'dessert_restaurant', 'bakery', 'confectionery', 'chocolate_shop', 'donut_shop')) tags.add('dessert');
    if (has(types, 'bakery', 'fast_food_restaurant', 'meal_takeaway', 'sandwich_shop', 'snack_bar', 'food_court', 'cafeteria', 'juice_shop')) tags.add('snacks');
    if (has(types, 'fast_food_restaurant', 'meal_takeaway', 'cafeteria', 'food_court', 'juice_shop', 'snack_bar')) tags.add('quick');
    if (has(types, 'restaurant', 'food_court', 'fast_food_restaurant', 'cafeteria', 'bar', 'pub') || [...types].some((t) => t.endsWith('_restaurant'))) {
      tags.add('group');
      tags.add('lively');
    }
  } else if (category === 'seating') {
    ['seating', 'nature', 'scenic'].forEach((t) => tags.add(t));
    if (has(types, 'plaza', 'playground')) { tags.delete('nature'); tags.add('group'); }
    tags.add('photo');
  } else if (category === 'landmark') {
    if (has(types, 'tourist_attraction', 'historical_landmark', 'monument', 'museum', 'planetarium', 'cultural_landmark', 'sculpture')) {
      tags.add('iconic');
      tags.add('photo');
    }
    if (has(types, 'library', 'book_store', 'place_of_worship', 'hindu_temple', 'church', 'mosque')) tags.add('quiet');
    if (has(types, 'library', 'book_store', 'museum', 'art_gallery', 'shopping_mall', 'store', 'planetarium')) tags.add('sheltered');
  }
  return [...tags];
}

/** Typical visit lengths, matched to the saved catalogue's defaults. */
export function liveDwellMin(category: PlaceCategory, tags: string[]): number {
  if (category === 'cafe') return tags.includes('quick') || (tags.includes('dessert') && !tags.includes('coffee')) ? 20 : tags.includes('coffee') ? 25 : 35;
  if (category === 'seating') return 15;
  if (category === 'landmark') return 10;
  return 0;
}

// ---- Prices -----------------------------------------------------------------

/**
 * Per-person INR ranges for Google's price levels, following the bands Google
 * Maps shows in India (₹1–200, ₹200–400, …) with a realistic floor.
 */
const LEVEL_INR: Record<GooglePriceLevel, [number, number]> = {
  FREE: [0, 0],
  INEXPENSIVE: [50, 200],
  MODERATE: [200, 400],
  EXPENSIVE: [400, 800],
  VERY_EXPENSIVE: [800, 1600],
};
/** When Google has no price, a cautious food estimate keeps the stop plannable but flagged. */
const FOOD_ESTIMATE_INR: [number, number] = [100, 350];

export function liveSpend(venue: LiveVenue, category: PlaceCategory): Pick<Place, 'spendLowInr' | 'spendHighInr' | 'spendSource'> {
  const range = venue.priceRangeInr;
  if (range && Number.isFinite(range.low) && range.low >= 0) {
    const high = range.high !== null && Number.isFinite(range.high) && range.high >= range.low ? range.high : Math.max(range.low * 2, range.low + 200);
    return { spendLowInr: Math.round(range.low), spendHighInr: Math.round(high), spendSource: 'google' };
  }
  if (venue.priceLevel && venue.priceLevel in LEVEL_INR) {
    const [low, high] = LEVEL_INR[venue.priceLevel];
    return { spendLowInr: low, spendHighInr: high, spendSource: 'google' };
  }
  if (category === 'cafe') return { spendLowInr: FOOD_ESTIMATE_INR[0], spendHighInr: FOOD_ESTIMATE_INR[1], spendSource: 'placeholder' };
  return { spendLowInr: 0, spendHighInr: 0, spendSource: 'placeholder' };
}

// ---- Opening hours ----------------------------------------------------------

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const LAST_MINUTE = 23 * 60 + 59;

/**
 * Google's weekly periods → planner windows. A period without a close is open
 * around the clock. Periods crossing midnight are split at the day boundary;
 * windows end at 23:59 because the planner's HH:MM times stop there.
 */
export function liveOpenWindows(periods: NonNullable<LiveVenue['periods']>): OpenWindow[] | 'always' | null {
  if (periods.length === 1 && !periods[0].close && periods[0].open.hour === 0 && periods[0].open.minute === 0) return 'always';
  const windows: OpenWindow[] = [];
  const valid = (p: GoogleTimePoint) => Number.isInteger(p.day) && p.day >= 0 && p.day <= 6 && Number.isInteger(p.hour) && p.hour >= 0 && p.hour <= 24 && Number.isInteger(p.minute) && p.minute >= 0 && p.minute <= 59;
  for (const { open, close } of periods) {
    if (!valid(open) || (close && !valid(close))) return null;
    if (!close) return null; // Only the single all-week period may omit its close.
    const start = open.day * 1440 + Math.min(open.hour * 60 + open.minute, 1440);
    let end = close.day * 1440 + Math.min(close.hour * 60 + close.minute, 1440);
    if (end <= start) end += 7 * 1440; // Wraps past Saturday night.
    for (let at = start; at < end;) {
      const dayStart = Math.floor(at / 1440) * 1440;
      const stop = Math.min(end, dayStart + 1440);
      const from = at - dayStart;
      const to = Math.min(stop - dayStart, 1440);
      if (to - from >= 1 && from <= LAST_MINUTE) {
        windows.push({ day: (dayStart / 1440) % 7, start: hhmm(from), end: hhmm(Math.min(to, LAST_MINUTE)) });
      }
      at = stop;
    }
  }
  const merged = windows
    .filter((w) => w.start < w.end)
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  return merged.length ? merged : null;
}

// ---- Anchoring --------------------------------------------------------------

const connected = new WeakMap<Dataset, Set<string>>();

/** Nodes reachable from the first start and back again over allowed edges. */
function walkableNodes(dataset: Dataset): Set<string> {
  const cached = connected.get(dataset);
  if (cached) return cached;
  const out = new Map<string, string[]>();
  const back = new Map<string, string[]>();
  for (const e of dataset.edges) {
    if (!e.allowed) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    (back.get(e.to) ?? back.set(e.to, []).get(e.to)!).push(e.from);
  }
  const reach = (from: string, next: Map<string, string[]>) => {
    const seen = new Set([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const n of next.get(queue[i]) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return seen;
  };
  const origin = dataset.starts[0]?.nodeId;
  const result = new Set<string>();
  if (origin) {
    const forward = reach(origin, out);
    for (const id of reach(origin, back)) if (forward.has(id)) result.add(id);
  }
  connected.set(dataset, result);
  return result;
}

export function nearestWalkableNode(dataset: Dataset, at: LatLng): { nodeId: string; meters: number } | null {
  const usable = walkableNodes(dataset);
  let best: { nodeId: string; meters: number } | null = null;
  for (const node of dataset.nodes) {
    if (!usable.has(node.id)) continue;
    const meters = haversineM(at, [node.lat, node.lng]);
    if (!best || meters < best.meters) best = { nodeId: node.id, meters };
  }
  return best;
}

// ---- Matching the saved catalogue ------------------------------------------

const words = (name: string) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 && !['the', 'mit', 'manipal', 'cafe', 'restaurant'].includes(w));

/** A Google venue that is already in the saved catalogue reuses the curated entry. */
export function matchCataloguePlace(dataset: Dataset, venue: Pick<LiveVenue, 'name' | 'location'>): Place | null {
  const target = new Set(words(venue.name));
  let best: { place: Place; meters: number } | null = null;
  for (const place of dataset.places) {
    if (isLivePlaceId(place.id) || !place.position) continue;
    const meters = haversineM(place.position, venue.location);
    if (meters > 90) continue;
    const own = words(place.name);
    const shared = own.filter((w) => target.has(w)).length;
    const similar = own.length > 0 && target.size > 0 && shared / Math.min(own.length, target.size) >= 0.5;
    if (similar && (!best || meters < best.meters)) best = { place, meters };
  }
  return best?.place ?? null;
}

// ---- Conversion -------------------------------------------------------------

export type LiveConversion =
  | { ok: true; place: Place; snapM: number }
  | { ok: false; reason: 'BAD_ID' | 'CLOSED' | 'TOO_FAR' | 'NOT_A_STOP'; message: string };

/** Turn a Google venue into a plannable stop, or say exactly why it cannot be one. */
export function toLivePlace(dataset: Dataset, venue: LiveVenue, checkedOn: string): LiveConversion {
  const id = livePlaceId(venue.placeId);
  if (!id) return { ok: false, reason: 'BAD_ID', message: 'This Google Maps place has an identifier the planner cannot store.' };
  if (venue.businessStatus === 'CLOSED_PERMANENTLY') return { ok: false, reason: 'CLOSED', message: 'Google Maps lists this place as permanently closed.' };
  if (venue.businessStatus === 'CLOSED_TEMPORARILY') return { ok: false, reason: 'CLOSED', message: 'Google Maps lists this place as temporarily closed.' };
  const category = liveCategory(venue);
  if (category === 'waypoint') return { ok: false, reason: 'NOT_A_STOP', message: 'This is a transport or service point, not a place to stop on a walk.' };
  const anchor = nearestWalkableNode(dataset, venue.location);
  if (!anchor || anchor.meters > MAX_SNAP_M) {
    const distance = anchor && (anchor.meters >= 1000 ? `${(anchor.meters / 1000).toFixed(1)} km` : `${Math.round(anchor.meters / 10) * 10} m`);
    const away = distance ? ` It is about ${distance} from the nearest one.` : '';
    return { ok: false, reason: 'TOO_FAR', message: `This place is outside the saved campus walking paths.${away}` };
  }
  const tags = liveTags(venue, category);
  const hours = venue.periods ? liveOpenWindows(venue.periods) : null;
  // Open spaces without listed hours are treated like the catalogue's outdoor stops.
  const outdoor = category === 'seating' || (category === 'landmark' && !venue.types.some((t) => ['library', 'museum', 'planetarium', 'store', 'shopping_mall', 'book_store', 'art_gallery'].includes(t)));
  const place: Place = {
    id,
    name: venue.name.trim().slice(0, 120) || 'Google Maps place',
    nodeId: anchor.nodeId,
    position: venue.location,
    category,
    dwellDefaultMin: liveDwellMin(category, tags),
    ...liveSpend(venue, category),
    tags,
    ...(hours === 'always'
      ? { hoursStatus: 'always' as const, verifiedOpenWindows: [], hoursSource: 'google' as const }
      : hours
        ? { hoursStatus: 'verified' as const, verifiedOpenWindows: hours, hoursSource: 'google' as const }
        : outdoor
          ? { hoursStatus: 'always' as const, verifiedOpenWindows: [], hoursSource: 'placeholder' as const }
          : { hoursStatus: 'unknown' as const, verifiedOpenWindows: [], hoursSource: 'google' as const }),
    verifiedAt: checkedOn,
    source: `Google Maps place ${venue.placeId}, details fetched ${checkedOn}; anchored to path node ${Math.round(anchor.meters)} m away (entrance not surveyed)`,
  };
  return { ok: true, place, snapM: anchor.meters };
}

/** The planner's dataset plus the live places this outing needs. The graph is unchanged. */
export function withLivePlaces(dataset: Dataset, live: Place[]): Dataset {
  if (!live.length) return dataset;
  const known = new Set(dataset.places.map((p) => p.id));
  const extra = live.filter((p) => isLivePlaceId(p.id) && !known.has(p.id) && known.add(p.id));
  return extra.length ? { ...dataset, places: [...dataset.places, ...extra] } : dataset;
}

/** Every live place a request or plan refers to, so a shared walk can load them first. */
export function liveIdsIn(ids: Iterable<string>): string[] {
  return [...new Set([...ids].filter(isLivePlaceId))];
}
