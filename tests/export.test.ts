import { describe, expect, it } from 'vitest';
import { planToGpx, planToKml, planToText } from '../src/core/export/files';
import { googleMapsDirectionsUrl, MAX_WAYPOINTS } from '../src/core/export/googleMaps';
import { haversineM, planGeometry } from '../src/core/geo';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import { decodeShare, encodeShare } from '../src/core/share';
import type { PlanRequest } from '../src/core/types';
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
