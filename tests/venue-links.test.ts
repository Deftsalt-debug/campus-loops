import { describe, expect, it } from 'vitest';
import { googleMapsPlaceUrl, googleMapsSearchUrl } from '../src/core/export/googleMaps';
import type { Place } from '../src/core/types';
import demoJson from '../src/data/manipal-demo.json';
import { placeHoursNote } from '../src/ui/campusPlaces';

describe('current venue lookup', () => {
  it('searches by venue name and locality instead of an approximate walking-path coordinate', () => {
    const url = new URL(googleMapsPlaceUrl('MIT Central Library (outside)'));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe('MIT Central Library, Manipal, Karnataka, India');
    expect([...url.searchParams.keys()]).toEqual(['api', 'query']);
  });

  it('keeps accented names and URL metacharacters inside the search term', () => {
    const query = 'Café & tea #1?key=example near MIT Manipal';
    const url = new URL(googleMapsSearchUrl(query));
    expect(url.searchParams.get('query')).toBe(query);
    expect(url.searchParams.has('key')).toBe(false);
    expect(url.hash).toBe('');
    expect(url.hostname).toBe('www.google.com');
  });

  it('keeps long Unicode queries within the mobile URL contract and supplies a useful empty search', () => {
    expect(googleMapsSearchUrl('🌿'.repeat(500)).length).toBeLessThanOrEqual(2048);
    expect(new URL(googleMapsSearchUrl('  ')).searchParams.get('query')).toContain('MIT Manipal');
    expect(new URL(googleMapsPlaceUrl('🌿'.repeat(500))).searchParams.get('query')).toContain('Manipal, Karnataka, India');
  });

  it('provides a key-free listing search for every saved campus venue', () => {
    expect(demoJson.places.length).toBeGreaterThan(0);
    for (const place of demoJson.places) {
      const url = new URL(googleMapsPlaceUrl(place.name));
      expect(url.searchParams.get('query')).toContain('Manipal, Karnataka, India');
      expect(url.searchParams.get('query')).toContain(place.name.replace(/\s*\((?:outside|exterior)\)$/i, ''));
      expect(url.searchParams.has('query_place_id')).toBe(false);
      expect(url.searchParams.has('key')).toBe(false);
    }
  });
});

describe('saved hours provenance', () => {
  const place = demoJson.places[0] as Place;

  it('never presents a placeholder schedule as verified hours or an assumed outdoor stop as always open', () => {
    expect(placeHoursNote({ ...place, hoursStatus: 'verified', hoursSource: 'placeholder' })).toContain('estimates');
    expect(placeHoursNote({ ...place, hoursStatus: 'always', hoursSource: 'placeholder' })).toContain('access assumed');
  });

  it('labels unknown hours even when the source is OSM', () => {
    expect(placeHoursNote({ ...place, hoursStatus: 'unknown', hoursSource: 'osm' })).toBe('Opening hours unconfirmed');
  });

  it('identifies the recorded date without implying that saved OSM or survey data is live', () => {
    expect(placeHoursNote({ ...place, hoursSource: 'osm' })).toBe(`Hours from saved OpenStreetMap data (${place.verifiedAt})`);
    expect(placeHoursNote({ ...place, hoursSource: 'survey' })).toContain('confirm today’s hours');
  });
});
