import { describe, expect, it } from 'vitest';
import { validateDataset } from '../src/core/dataset/validate';
import { googleMapsPlaceUrl } from '../src/core/export/googleMaps';
import { haversineM } from '../src/core/geo';
import {
  googlePlaceIdOf, liveCategory, liveIdsIn, liveOpenWindows, livePlaceId, liveSpend, liveTags,
  matchCataloguePlace, MAX_SNAP_M, nearestWalkableNode, toLivePlace, withLivePlaces, type LiveVenue,
} from '../src/core/livePlaces';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import { decodeShare, encodeShare } from '../src/core/share';
import type { Dataset, LatLng, PlanRequest } from '../src/core/types';
import demoJson from '../src/data/manipal-demo.json';
import { openingSummary, priceLevelText } from '../src/ui/campusPlaces';
import { googleMapsConfiguration } from '../src/ui/google/config';
import { campusArea } from '../src/ui/google/livePlaces';
import { ist } from './helpers';

const demo = demoJson as unknown as Dataset;
const PLACE_ID = 'ChIJx9Lr6tGkvjsRz2Lq0fjU8lE';
const daily = (open: string, close: string) => Array.from({ length: 7 }, (_, day) => {
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  return { open: { day, hour: oh, minute: om }, close: { day, hour: ch, minute: cm } };
});

const start = demo.nodes.find((n) => n.id === demo.starts[0].nodeId)!;
/** A walkable node a few hundred metres from the first start, as a stand-in venue location. */
const nearby = demo.nodes
  .map((n) => ({ n, d: haversineM([start.lat, start.lng], [n.lat, n.lng]) }))
  .filter(({ n, d }) => d > 220 && d < 420 && nearestWalkableNode(demo, [n.lat, n.lng])?.nodeId === n.id)
  .sort((a, b) => a.d - b.d)[0].n;
const offset = ([lat, lng]: LatLng, metresNorth: number): LatLng => [lat + metresNorth / 111_320, lng];

function venue(overrides: Partial<LiveVenue> = {}): LiveVenue {
  return {
    placeId: PLACE_ID,
    name: 'The Snack Shack',
    location: offset([nearby.lat, nearby.lng], 25),
    types: ['cafe', 'food', 'point_of_interest', 'establishment'],
    primaryType: 'cafe',
    businessStatus: 'OPERATIONAL',
    periods: daily('08:00', '22:30'),
    priceLevel: 'INEXPENSIVE',
    priceRangeInr: null,
    rating: 4.4,
    ratingCount: 812,
    ...overrides,
  };
}

describe('Google place identifiers', () => {
  it('prefixes valid place IDs and rejects anything a share link could not carry', () => {
    expect(livePlaceId(PLACE_ID)).toBe(`g_${PLACE_ID}`);
    expect(googlePlaceIdOf(`g_${PLACE_ID}`)).toBe(PLACE_ID);
    expect(googlePlaceIdOf('starbucks')).toBeNull();
    expect(livePlaceId('bad.id')).toBeNull();
    expect(livePlaceId('has space')).toBeNull();
    expect(livePlaceId('x'.repeat(130))).toBeNull();
    expect(liveIdsIn(['starbucks', `g_${PLACE_ID}`, '', `g_${PLACE_ID}`])).toEqual([`g_${PLACE_ID}`]);
  });
});

describe('classifying Google venues', () => {
  it('lets the primary type decide, so a hotel with a restaurant is not a café stop', () => {
    expect(liveCategory({ primaryType: 'south_indian_restaurant', types: ['restaurant'] })).toBe('cafe');
    expect(liveCategory({ primaryType: 'hotel', types: ['restaurant', 'lodging'] })).toBe('landmark');
    expect(liveCategory({ primaryType: 'park', types: ['park'] })).toBe('seating');
    expect(liveCategory({ primaryType: 'atm', types: ['atm', 'finance'] })).toBe('waypoint');
    expect(liveCategory({ primaryType: null, types: ['bakery', 'store'] })).toBe('cafe');
    expect(liveCategory({ types: ['establishment'] })).toBe('landmark');
  });

  it('uses the occasion vocabulary the planner already scores', () => {
    expect(liveTags({ primaryType: 'coffee_shop', types: ['coffee_shop', 'cafe'] }, 'cafe')).toEqual(expect.arrayContaining(['sheltered', 'coffee', 'cozy', 'conversation']));
    expect(liveTags({ primaryType: 'fast_food_restaurant', types: ['fast_food_restaurant'] }, 'cafe')).toEqual(expect.arrayContaining(['quick', 'snacks', 'group', 'lively']));
    expect(liveTags({ primaryType: 'park', types: ['park'] }, 'seating')).toEqual(expect.arrayContaining(['seating', 'nature', 'scenic']));
    expect(liveTags({ primaryType: 'library', types: ['library'] }, 'landmark')).toEqual(expect.arrayContaining(['quiet', 'sheltered']));
  });
});

describe('Google opening hours', () => {
  it('converts regular daily hours', () => {
    const windows = liveOpenWindows(daily('08:00', '22:30'));
    expect(windows).toHaveLength(7);
    expect(windows).toContainEqual({ day: 3, start: '08:00', end: '22:30' });
  });

  it('keeps split lunch and dinner periods separate', () => {
    const windows = liveOpenWindows([
      { open: { day: 1, hour: 12, minute: 0 }, close: { day: 1, hour: 15, minute: 0 } },
      { open: { day: 1, hour: 19, minute: 0 }, close: { day: 1, hour: 23, minute: 0 } },
    ]);
    expect(windows).toEqual([{ day: 1, start: '12:00', end: '15:00' }, { day: 1, start: '19:00', end: '23:00' }]);
  });

  it('splits periods that run past midnight, including Saturday into Sunday', () => {
    expect(liveOpenWindows([{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }]))
      .toEqual([{ day: 5, start: '18:00', end: '23:59' }, { day: 6, start: '00:00', end: '02:00' }]);
    expect(liveOpenWindows([{ open: { day: 6, hour: 20, minute: 0 }, close: { day: 0, hour: 1, minute: 30 } }]))
      .toEqual([{ day: 0, start: '00:00', end: '01:30' }, { day: 6, start: '20:00', end: '23:59' }]);
  });

  it('recognises 24-hour venues and refuses malformed periods', () => {
    expect(liveOpenWindows([{ open: { day: 0, hour: 0, minute: 0 }, close: null }])).toBe('always');
    expect(liveOpenWindows([{ open: { day: 2, hour: 9, minute: 0 }, close: null }])).toBeNull();
    expect(liveOpenWindows([{ open: { day: 9, hour: 9, minute: 0 }, close: { day: 9, hour: 10, minute: 0 } }])).toBeNull();
    expect(liveOpenWindows([])).toBeNull();
  });
});

describe('Google prices', () => {
  it('prefers a published INR range, then the price level, then a flagged estimate', () => {
    expect(liveSpend(venue({ priceRangeInr: { low: 200, high: 400 } }), 'cafe')).toEqual({ spendLowInr: 200, spendHighInr: 400, spendSource: 'google' });
    expect(liveSpend(venue({ priceRangeInr: { low: 300, high: null } }), 'cafe')).toEqual({ spendLowInr: 300, spendHighInr: 600, spendSource: 'google' });
    expect(liveSpend(venue({ priceLevel: 'MODERATE' }), 'cafe')).toEqual({ spendLowInr: 200, spendHighInr: 400, spendSource: 'google' });
    expect(liveSpend(venue({ priceLevel: 'INEXPENSIVE' }), 'cafe')).toEqual({ spendLowInr: 50, spendHighInr: 200, spendSource: 'google' });
    expect(liveSpend(venue({ priceLevel: null }), 'cafe').spendSource).toBe('placeholder');
    expect(liveSpend(venue({ priceLevel: null }), 'seating')).toEqual({ spendLowInr: 0, spendHighInr: 0, spendSource: 'placeholder' });
  });
});

describe('turning a Google venue into a planner stop', () => {
  it('anchors a nearby venue to the walking network and passes dataset validation', () => {
    const converted = toLivePlace(demo, venue(), '2026-10-03');
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.snapM).toBeLessThan(MAX_SNAP_M);
    expect(converted.place).toMatchObject({ id: `g_${PLACE_ID}`, category: 'cafe', hoursStatus: 'verified', hoursSource: 'google', spendSource: 'google', verifiedAt: '2026-10-03' });
    const merged = withLivePlaces(demo, [converted.place]);
    expect(merged.places).toHaveLength(demo.places.length + 1);
    expect(merged.edges).toBe(demo.edges);
    expect(validateDataset(merged).filter((issue) => issue.level === 'error')).toEqual([]);
    expect(withLivePlaces(merged, [converted.place])).toBe(merged);
  });

  it('says why a venue cannot be routed', () => {
    const far = toLivePlace(demo, venue({ location: [13.37, 74.75] }), '2026-10-03');
    expect(far).toMatchObject({ ok: false, reason: 'TOO_FAR' });
    if (!far.ok) expect(far.message).toMatch(/outside the saved campus walking paths\. It is about \d+\.\d km from the nearest one\./);
    expect(toLivePlace(demo, venue({ businessStatus: 'CLOSED_PERMANENTLY' }), '2026-10-03')).toMatchObject({ ok: false, reason: 'CLOSED' });
    expect(toLivePlace(demo, venue({ businessStatus: 'CLOSED_TEMPORARILY' }), '2026-10-03')).toMatchObject({ ok: false, reason: 'CLOSED' });
    expect(toLivePlace(demo, venue({ primaryType: 'atm', types: ['atm'] }), '2026-10-03')).toMatchObject({ ok: false, reason: 'NOT_A_STOP' });
    expect(toLivePlace(demo, venue({ placeId: 'bad.id' }), '2026-10-03')).toMatchObject({ ok: false, reason: 'BAD_ID' });
  });

  it('treats a café without listed hours as unconfirmed, but an open space as always open', () => {
    const cafe = toLivePlace(demo, venue({ periods: null }), '2026-10-03');
    expect(cafe.ok && cafe.place.hoursStatus).toBe('unknown');
    const park = toLivePlace(demo, venue({ primaryType: 'park', types: ['park'], periods: null, priceLevel: null }), '2026-10-03');
    expect(park.ok && park.place).toMatchObject({ hoursStatus: 'always', hoursSource: 'placeholder', spendHighInr: 0 });
  });

  it('reuses the saved catalogue entry for the same venue', () => {
    const starbucks = demo.places.find((p) => p.id === 'starbucks')!;
    expect(matchCataloguePlace(demo, { name: 'Starbucks Coffee', location: offset(starbucks.position!, 20) })?.id).toBe('starbucks');
    expect(matchCataloguePlace(demo, { name: 'Domino’s Pizza', location: offset(starbucks.position!, 20) })).toBeNull();
    expect(matchCataloguePlace(demo, { name: 'Starbucks', location: offset(starbucks.position!, 400) })).toBeNull();
  });
});

describe('planning and sharing walks with a Google venue', () => {
  const converted = toLivePlace(demo, venue(), '2026-10-03');
  if (!converted.ok) throw new Error(converted.message);
  const live = withLivePlaces(demo, [converted.place]);
  const request: PlanRequest = {
    startId: demo.starts[0].id, durationMin: 60, budgetInr: 400, occasion: 'friends',
    requiredPlaceIds: [converted.place.id], requireCafe: false, pace: 'normal', avoidSteps: false, rain: false,
  };
  const now = ist('2026-10-01', '10:00');

  it('routes to the venue and flags its live details', () => {
    const result = plan(live, request, now);
    expect(result.blockers).toEqual([]);
    expect(result.plans.length).toBeGreaterThan(0);
    for (const walk of result.plans) {
      expect(walk.visits.map((v) => v.placeId)).toContain(converted.place.id);
      expect(walk.warnings.join(' ')).toContain('Google Maps today');
    }
  });

  it('respects Google hours: a closed venue blocks the walk with a reason', () => {
    const late = withLivePlaces(demo, [{ ...converted.place, verifiedOpenWindows: [{ day: 4, start: '18:00', end: '22:00' }] }]);
    const result = plan(late, request, now);
    expect(result.plans).toEqual([]);
    expect(result.blockers[0].code).toBe('REQUIRED_UNAVAILABLE');
  });

  it('survives a share link and rebuilds the same route', () => {
    const chosen = plan(live, request, now).plans[0];
    const hash = encodeShare({ datasetVersion: demo.datasetVersion, request, planId: chosen.id });
    const decoded = decodeShare(hash);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.shared.request.requiredPlaceIds).toEqual([converted.place.id]);
    expect(liveIdsIn([...decoded.shared.request.requiredPlaceIds, ...decoded.shared.planId.slice(2).split('.')])).toEqual([converted.place.id]);
    const rebuilt = rebuildPlan(live, decoded.shared.request, now, decoded.shared.planId);
    expect(rebuilt.plans[0].edgeIds).toEqual(chosen.edgeIds);
    // Without the live place loaded the planner refuses rather than guessing.
    expect(plan(demo, request, now).blockers[0].message).toMatch(/not in this dataset/);
  });
});

describe('live venue display', () => {
  const converted = toLivePlace(demo, venue(), '2026-10-03');
  const place = converted.ok ? converted.place : null!;

  it('summarises opening times from live hours only', () => {
    expect(openingSummary(place, ist('2026-10-01', '10:00'))).toBe('Open now · until 22:30');
    expect(openingSummary(place, ist('2026-10-01', '07:15'))).toBe('Closed now · opens 08:00');
    expect(openingSummary(place, ist('2026-10-01', '23:00'))).toBe('Closed now · opens tomorrow 08:00');
    expect(openingSummary({ ...place, verifiedOpenWindows: [{ day: 1, start: '09:00', end: '17:00' }] }, ist('2026-10-01', '10:00'))).toBe('Closed now · opens Monday 09:00');
    expect(openingSummary({ ...place, hoursStatus: 'always', verifiedOpenWindows: [] }, ist('2026-10-01', '10:00'))).toBe('Open 24 hours');
    expect(openingSummary(demo.places.find((p) => p.id === 'starbucks')!, ist('2026-10-01', '10:00'))).toBeNull();
  });

  it('shows price levels as rupee symbols', () => {
    expect(priceLevelText('INEXPENSIVE')).toBe('₹');
    expect(priceLevelText('VERY_EXPENSIVE')).toBe('₹₹₹₹');
    expect(priceLevelText('FREE')).toBe('Free');
    expect(priceLevelText(null)).toBeNull();
  });

  it('links to the exact Google listing when a place ID is known', () => {
    const url = new URL(googleMapsPlaceUrl('The Snack Shack', PLACE_ID));
    expect(url.searchParams.get('query_place_id')).toBe(PLACE_ID);
    expect(url.searchParams.get('query')).toBe('The Snack Shack, Manipal, Karnataka, India');
    expect(new URL(googleMapsPlaceUrl('Barista')).searchParams.has('query_place_id')).toBe(false);
    expect(new URL(googleMapsPlaceUrl('Barista', 'bad id&x=1')).searchParams.has('query_place_id')).toBe(false);
  });
});

describe('Google Maps configuration', () => {
  const key = `AIza${'A'.repeat(35)}`;
  it('stays on the free map without a key and rejects malformed values', () => {
    expect(googleMapsConfiguration({})).toEqual({ enabled: false, message: null });
    expect(googleMapsConfiguration({ VITE_GOOGLE_MAPS_API_KEY: '  ' })).toEqual({ enabled: false, message: null });
    expect(googleMapsConfiguration({ VITE_GOOGLE_MAPS_API_KEY: 'secret' })).toMatchObject({ enabled: false, message: expect.stringContaining('browser API key') });
    expect(googleMapsConfiguration({ VITE_GOOGLE_MAPS_API_KEY: key, VITE_GOOGLE_MAPS_MAP_ID: 'bad id!' })).toMatchObject({ enabled: false });
  });
  it('enables Google Maps with the demo map ID by default', () => {
    expect(googleMapsConfiguration({ VITE_GOOGLE_MAPS_API_KEY: ` ${key} ` })).toEqual({ enabled: true, key, mapId: 'DEMO_MAP_ID' });
    expect(googleMapsConfiguration({ VITE_GOOGLE_MAPS_API_KEY: key, VITE_GOOGLE_MAPS_MAP_ID: 'a1b2c3d4e5' })).toEqual({ enabled: true, key, mapId: 'a1b2c3d4e5' });
  });
});

describe('live search area', () => {
  it('covers every walking node with a margin, within Google’s radius limit', () => {
    const area = campusArea(demo);
    for (const node of demo.nodes) {
      expect(node.lat).toBeGreaterThan(area.bounds.south);
      expect(node.lat).toBeLessThan(area.bounds.north);
      expect(node.lng).toBeGreaterThan(area.bounds.west);
      expect(node.lng).toBeLessThan(area.bounds.east);
    }
    expect(area.radiusM).toBeGreaterThan(800);
    expect(area.radiusM).toBeLessThanOrEqual(50_000);
  });
});
