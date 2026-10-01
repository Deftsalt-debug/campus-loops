import { describe, expect, it } from 'vitest';
import { planToGpx, planToIcs, planToKml, planToText } from '../src/core/export/files';
import { loadDataset } from '../src/core/dataset/load';
import { googleMapsDirectionsUrl, MAX_WAYPOINTS } from '../src/core/export/googleMaps';
import { haversineM, planGeometry } from '../src/core/geo';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import { decodeShare, encodeShare } from '../src/core/share';
import type { Plan, PlanRequest } from '../src/core/types';
import { fixture, ist, tinyDataset, twoWay } from './helpers';

const ds = fixture();
const req: PlanRequest = {
  startId: 'start_gate',
  durationMin: 90,
  budgetInr: 200,
  occasion: 'guest',
  requiredPlaceIds: ['p_tower'],
  requireCafe: true,
  pace: 'relaxed',
  avoidSteps: false,
  rain: false,
};
const now = ist('2026-10-01', '10:00');
const result = plan(ds, req, now);
const p = result.plans[0];
const route = planGeometry(ds, p);

describe('planGeometry', () => {
  it('uses the scheduled arrival when a curated route passes a stop twice', () => {
    const repeated = tinyDataset(['S', 'P', 'Q'], [...twoWay('sp', 'S', 'P', 100), ...twoWay('pq', 'P', 'Q', 100)], [{ id: 'bench', nodeId: 'P' }]);
    repeated.curatedWalks = [{
      id: 'repeat', name: 'Stop on the return', startNodeId: 'S', edgeIds: ['sp:f', 'pq:f', 'pq:r', 'sp:r'],
      stops: [{ placeId: 'bench', afterEdge: 3 }], tags: [], verifiedAt: '2026-09-20',
    }];
    const [selected] = rebuildPlan(repeated, { ...req, startId: 'start', requiredPlaceIds: [], requireCafe: false }, now, 'c:repeat').plans;
    expect(selected.visits[0].afterEdge).toBe(3);
    expect(planGeometry(repeated, selected).stops[0].pathIndex).toBe(3);
  });
  it('rebuilds a continuous path that starts and ends at the start', () => {
    expect(route.path[0]).toEqual(route.start);
    expect(route.path[route.path.length - 1]).toEqual(route.start);
    for (let i = 1; i < route.path.length; i++) {
      expect(haversineM(route.path[i - 1], route.path[i])).toBeLessThan(300); // no teleporting jumps
    }
  });

  it('places every stop on the path, in visit order', () => {
    expect(route.stops.map((s) => s.placeId)).toEqual(p.visits.map((v) => v.placeId));
    let last = -1;
    for (const s of route.stops) {
      expect(route.path[s.pathIndex]).toEqual(s.at);
      expect(s.pathIndex).toBeGreaterThanOrEqual(last);
      last = s.pathIndex;
    }
  });
});

describe('Google Maps link', () => {
  const link = googleMapsDirectionsUrl(route);
  const url = new URL(link.url);

  it('is a documented, key-free walking directions URL that loops back to the start', () => {
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('travelmode')).toBe('walking');
    expect(url.searchParams.get('origin')).toBe(url.searchParams.get('destination'));
    expect(url.searchParams.has('key')).toBe(false);
    expect(link.url.length).toBeLessThanOrEqual(2048);
  });

  it('passes every stop, in order, within the waypoint limit', () => {
    const waypoints = url.searchParams.get('waypoints')!.split('|');
    expect(waypoints.length).toBeLessThanOrEqual(MAX_WAYPOINTS);
    const stopStrings = route.stops.map((s) => `${s.at[0].toFixed(6)},${s.at[1].toFixed(6)}`);
    const positions = stopStrings.map((s) => waypoints.indexOf(s));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('respects a tighter waypoint limit for mobile browsers', () => {
    const mobile = googleMapsDirectionsUrl(route, 3);
    expect(mobile.waypoints.length).toBeLessThanOrEqual(3);
  });
});

describe('file exports', () => {
  it('writes KML with the exact path in lng,lat order and escaped text', () => {
    const tricky = { ...p, name: 'Tea & "talk" <3' };
    const kml = planToKml(tricky, route, 'Gate <A>', '© test');
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml).toContain('Tea &amp; &quot;talk&quot; &lt;3');
    expect(kml).not.toContain('<A>');
    const coords = /<LineString>.*?<coordinates>(.*?)<\/coordinates>/s.exec(kml)![1].trim().split(' ');
    expect(coords).toHaveLength(route.path.length);
    const [lng, lat] = coords[0].split(',').map(Number);
    expect([lat, lng]).toEqual([Number(route.start[0].toFixed(7)), Number(route.start[1].toFixed(7))]);
  });

  it('writes GPX with one track point per path point and a waypoint per stop', () => {
    const gpx = planToGpx(p, route, 'Gate A', '© test');
    expect(gpx.match(/<trkpt /g)).toHaveLength(route.path.length);
    expect(gpx.match(/<wpt /g)).toHaveLength(route.stops.length + 1);
  });

  it('writes a readable text itinerary with clock times', () => {
    const text = planToText(p, 'Gate A', 10 * 3600);
    expect(text.startsWith(p.name)).toBe(true);
    expect(text).toContain('10:00  Leave Gate A');
    expect(text).toContain('Back at Gate A');
  });
});

describe('share links', () => {
  it('round-trips and uniquely rebuilds three maximum-length place IDs', () => {
    const ids = ['a', 'b', 'c'].map((letter) => letter.repeat(120));
    const longIds = tinyDataset(['S', 'P', 'Q', 'R'], [
      ...twoWay('sp', 'S', 'P', 100), ...twoWay('sq', 'S', 'Q', 100), ...twoWay('sr', 'S', 'R', 100),
    ], ids.map((id, i) => ({ id, nodeId: ['P', 'Q', 'R'][i], category: i === 2 ? 'cafe' : 'seating' })));
    longIds.datasetVersion = 'v'.repeat(120);
    longIds.starts[0].id = 's'.repeat(120);
    const { dataset } = loadDataset(longIds);
    const request = { ...req, startId: dataset.starts[0].id, requiredPlaceIds: ids.slice(0, 2), requireCafe: true };
    const [planned] = plan(dataset, request, now).plans;
    expect(planned.id).toHaveLength(364);
    const shared = { datasetVersion: dataset.datasetVersion, request, planId: planned.id };
    const decoded = decodeShare(encodeShare(shared));
    expect(decoded).toEqual({ ok: true, shared });
    if (!decoded.ok) throw new Error('Maximum-length valid route failed to decode');
    expect(rebuildPlan(dataset, decoded.shared.request, now, decoded.shared.planId).plans).toEqual([planned]);
  });

  it('round-trips a maximum-length curated identifier including dots', () => {
    const shared = { datasetVersion: ds.datasetVersion, request: req, planId: `c:${'a.'.repeat(60)}` };
    expect(decodeShare(encodeShare(shared))).toEqual({ ok: true, shared });
  });

  it.each([
    ['id', `g:${'a'.repeat(121)}`], ['id', `c:${'a'.repeat(121)}`],
    ['id', `g:${Array(4).fill('a'.repeat(120)).join('.')}`], ['id', 'g:a..b'],
    ['id', 'g:a\n'], ['id', 'other:a'],
    ['d', 'd'.repeat(121)], ['s', 's'.repeat(121)], ['s', 'start\n'],
    ['r', 'a.b'], ['r', 'a'.repeat(121)], ['dw', 'a.b~5'],
  ])('rejects malformed or oversized identifiers without loosening fragment limits: %s=%s', (key, value) => {
    const params = new URLSearchParams(encodeShare({ datasetVersion: ds.datasetVersion, request: req, planId: p.id }).slice(1));
    params.set(key, value);
    expect(decodeShare(`#${params}`).ok).toBe(false);
  });

  it.each([
    ['r', 'p_tower,p_bench,p_pond'],
    ['t', '29'], ['t', '91'], ['f', '31'], ['dw', 'p_tower~121'],
  ])('rejects unsupported planner limits instead of truncating or adapting %s=%s', (key, value) => {
    const params = new URLSearchParams(encodeShare({ datasetVersion: ds.datasetVersion, request: req, planId: p.id }).slice(1));
    params.set(key, value);
    expect(decodeShare(`#${params}`).ok).toBe(false);
  });

  it.each([30, 90])('preserves supported planner limits at %s minutes', (durationMin) => {
    const shared = {
      datasetVersion: ds.datasetVersion, planId: p.id,
      request: { ...req, durationMin, bufferMin: 30, requiredPlaceIds: ['p_tower', 'p_bench'], dwellOverridesMin: { p_tower: 120, p_bench: 0 } },
    };
    expect(decodeShare(encodeShare(shared))).toEqual({ ok: true, shared });
  });

  it('round-trips a preview time as the same timezone-independent instant', () => {
    const shared = { datasetVersion: ds.datasetVersion, request: req, planId: p.id, at: now.toISOString() };
    expect(decodeShare(encodeShare(shared))).toEqual({ ok: true, shared });
  });

  it('keeps a prototype-named dwell override as ordinary data', () => {
    const hash = encodeShare({ datasetVersion: ds.datasetVersion, request: req, planId: p.id }) + '&dw=__proto__~7';
    const decoded = decodeShare(hash);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(Object.hasOwn(decoded.shared.request.dwellOverridesMin!, '__proto__')).toBe(true);
      expect(decoded.shared.request.dwellOverridesMin!['__proto__']).toBe(7);
    }
  });

  it.each([
    '&b=', '&b=%20', '&b=0x10', '&b=1e2', '&a=true', '&w=2', '&c=', '&dw=p_tower~',
    '&dw=p_tower~7~8', '&dw=p_tower~7,p_tower~8', '&r=p_tower,p_tower',
    '&at=2026-10-01T10:00:00', '&at=2026-02-30T10:00:00Z', '&at=October+1,+2026',
  ])('rejects ambiguous or malformed share values (%s)', (extra) => {
    const params = new URLSearchParams(encodeShare({ datasetVersion: ds.datasetVersion, request: req, planId: p.id }).slice(1));
    const update = new URLSearchParams(extra.slice(1));
    for (const [key, value] of update) params.set(key, value);
    expect(decodeShare(`#${params}`).ok).toBe(false);
  });

  it('rejects repeated fields instead of choosing one silently', () => {
    expect(decodeShare(encodeShare({ datasetVersion: ds.datasetVersion, request: req, planId: p.id }) + '&a=1&a=0').ok).toBe(false);
  });
  it('round-trips a request and plan id', () => {
    const shared = { datasetVersion: ds.datasetVersion, request: { ...req, backBy: '17:30', dwellOverridesMin: { p_tower: 7 } }, planId: p.id };
    const decoded = decodeShare(encodeShare(shared));
    expect(decoded).toEqual({ ok: true, shared });
  });

  it('stays well under the practical length limit', () => {
    expect(encodeShare({ datasetVersion: ds.datasetVersion, request: req, planId: p.id }).length).toBeLessThan(400);
  });

  it.each([
    ['', 'empty'],
    ['#v=2&d=x', 'version'],
    ['#v=1&d=fixture-1&s=start_gate&o=party&t=60&b=0&p=normal&id=g:x', 'occasion'],
    ['#v=1&d=fixture-1&s=start_gate&o=date&t=-5&b=0&p=normal&id=g:x', 'duration'],
    ['#v=1&d=fixture-1&s=<script>&o=date&t=60&b=0&p=normal&id=g:x', 'start'],
    ['#v=1&d=fixture-1&s=start_gate&o=date&t=60&b=0&p=normal&id=g:x&k=25:00', 'back-by'],
    [`#v=1&${'x'.repeat(3000)}`, 'too long'],
  ])('rejects a malformed or hostile link (%s)', (hash, _label) => {
    expect(decodeShare(hash).ok).toBe(false);
  });
});

describe('calendar export (.ics)', () => {
  const startAt = ist('2026-10-02', '16:30');
  const stamp = new Date('2026-10-01T12:00:00Z');
  const ics = planToIcs(p, { startAt, stamp, startName: 'Gate A', startCoords: route.start, url: 'https://example.test/#v=1&id=x' });
  // Undo RFC 5545 line folding to read whole properties.
  const unfolded = ics.replace(/\r\n /g, '');
  const prop = (name: string) => unfolded.split('\r\n').find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1);
  const uid = (event: string) => event.replace(/\r\n /g, '').split('\r\n').find((line) => line.startsWith('UID:'));

  it('is a well-formed calendar with one event and a reminder', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(unfolded).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M');
    // Only CRLF line endings, never a bare LF.
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('runs from leaving to getting back, in UTC', () => {
    expect(prop('DTSTART')).toBe('20261002T110000Z'); // 16:30 IST
    const end = new Date(startAt.getTime() + p.totalSec * 1000);
    expect(prop('DTEND')).toBe(end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
    expect(prop('DTSTAMP')).toBe('20261001T120000Z');
    expect(prop('UID')).toMatch(/^[A-Za-z0-9_.:-]+-20261002T110000Z@campus-loops$/);
  });

  it('carries the itinerary with clock times and the link', () => {
    const description = prop('DESCRIPTION')!;
    expect(description).toContain('16:30  Leave Gate A');
    expect(description).toContain('https://example.test/#v=1&id=x');
    expect(prop('LOCATION')).toBe('Gate A\\, MIT Manipal');
    expect(prop('GEO')).toBe(`${route.start[0].toFixed(6)};${route.start[1].toFixed(6)}`);
  });

  it('gives the same stop sequence from different starts distinct calendar identities', () => {
    const campus = tinyDataset(['A', 'B', 'P'], [...twoWay('ap', 'A', 'P', 100), ...twoWay('bp', 'B', 'P', 100)], [{ id: 'bench', nodeId: 'P' }]);
    campus.starts = [{ id: 'start-a', name: 'Gate A', nodeId: 'A' }, { id: 'start-b', name: 'Gate B', nodeId: 'B' }];
    const request = { ...req, durationMin: 60, requiredPlaceIds: ['bench'], requireCafe: false };
    const fromA = rebuildPlan(campus, { ...request, startId: 'start-a' }, startAt, 'g:bench').plans[0];
    const fromB = rebuildPlan(campus, { ...request, startId: 'start-b' }, startAt, 'g:bench').plans[0];
    expect(fromA).toBeDefined();
    expect(fromB).toBeDefined();
    expect(fromA.id).toBe(fromB.id);
    expect(fromA.startNodeId).not.toBe(fromB.startNodeId);
    const exportRoute = (outing: Plan) => planToIcs(outing, {
      startAt, stamp, startName: 'Campus start', startCoords: planGeometry(campus, outing).start, datasetVersion: campus.datasetVersion,
    });
    expect(uid(exportRoute(fromA))).not.toBe(uid(exportRoute(fromB)));
  });

  it('keeps an outing identity stable across re-exports but distinguishes changed routes and map versions', () => {
    const options = { startAt, stamp, startName: 'Gate A', startCoords: route.start, datasetVersion: ds.datasetVersion };
    const original = uid(planToIcs(p, options));
    expect(uid(planToIcs({ ...p, name: 'Updated display name' }, {
      ...options, stamp: new Date(stamp.getTime() + 86_400_000), startName: 'Renamed Gate A', url: 'https://example.test/#different-link',
    }))).toBe(original);
    expect(uid(planToIcs(p, { ...options, datasetVersion: `${ds.datasetVersion}-revised` }))).not.toBe(original);
    expect(uid(planToIcs(p, { ...options, startAt: new Date(startAt.getTime() + 60_000) }))).not.toBe(original);
    expect(uid(planToIcs({ ...p, startNodeId: 'different-start-node' }, options))).not.toBe(original);
    expect(uid(planToIcs({ ...p, edgeIds: [...p.edgeIds, 'new-route-edge'] }, options))).not.toBe(original);
    expect(uid(planToIcs({ ...p, edgeIds: [...p.edgeIds].reverse() }, options))).not.toBe(original);
    expect(uid(planToIcs(p, { ...options, startCoords: [route.start[0] + 0.001, route.start[1]] }))).not.toBe(original);
  });

  it('escapes text so commas, semicolons and backslashes cannot break fields', () => {
    const tricky = { ...p, name: 'Tea; talk, and a \\ backslash' };
    const out = planToIcs(tricky, { startAt, stamp, startName: 'Gate A', startCoords: route.start }).replace(/\r\n /g, '');
    expect(out).toContain('SUMMARY:Walk: Tea\\; talk\\, and a \\\\ backslash');
  });

  it('folds long lines at 75 octets without splitting multi-byte characters', () => {
    const long = { ...p, name: `${'₹'.repeat(60)} long walk` };
    const out = planToIcs(long, { startAt, stamp, startName: 'Gate A', startCoords: route.start });
    const encoder = new TextEncoder();
    for (const line of out.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(out.replace(/\r\n /g, '')).toContain(`SUMMARY:Walk: ${'₹'.repeat(60)} long walk`);
  });
});
