import { cumulativeDistances, haversineM, type RouteGeometry } from '../geo';
import type { LatLng } from '../types';

// Google Maps URLs: https://developers.google.com/maps/documentation/urls/get-started#directions-action
// Mobile browsers support up to 3 waypoints; other platforms support up to 9.
// Use the shared 3-point limit by default because the caller cannot know whether
// a phone has the Maps app installed. The URL must stay within 2,048 characters.

export const MAX_WAYPOINTS = 3;
const MAX_URL_LENGTH = 2048;
/** Shaping points closer than this to a stop, the start or each other are skipped. */
const MIN_SPACING_M = 80;

const fmt = ([lat, lng]: LatLng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

export interface GoogleMapsLink {
  url: string;
  /** Points sent as waypoints, in walking order (stops plus shaping points). */
  waypoints: LatLng[];
  shapingPoints: number;
}

/**
 * A walking-directions link that starts and ends at the start point and passes
 * all of the planner's up to three visits in order. Reserve their slots before
 * adding shaping points. A caller targeting a platform known to support more
 * waypoints can explicitly request up to nine. Spare slots use points sampled
 * evenly along our route, so Google's own path stays close to ours.
 * Google still chooses its own paths between points, so the result can differ
 * from the checked route; the KML export carries the exact path.
 */
export function googleMapsDirectionsUrl(route: RouteGeometry, maxWaypoints = MAX_WAYPOINTS): GoogleMapsLink {
  if (!Number.isInteger(maxWaypoints) || maxWaypoints < 0 || maxWaypoints > 9) {
    throw new RangeError('Google Maps supports an integer limit of 0–9 waypoints');
  }
  if (route.stops.length > maxWaypoints) throw new RangeError('The waypoint limit cannot include every visit');
  const dist = cumulativeDistances(route.path);
  const total = dist[dist.length - 1] ?? 0;

  type Point = { at: LatLng; d: number };
  const stops: Point[] = route.stops.map((s) => ({ at: s.at, d: dist[s.pathIndex] ?? 0 }));
  const shaping: Point[] = [];
  const slots = maxWaypoints - stops.length;
  const tooClose = (p: LatLng) =>
    haversineM(p, route.start) < MIN_SPACING_M ||
    [...stops, ...shaping].some((q) => haversineM(p, q.at) < MIN_SPACING_M);

  for (let i = 1; i <= slots && total > 0; i++) {
    const target = (total * i) / (slots + 1);
    let idx = dist.findIndex((d) => d >= target);
    if (idx === -1) idx = route.path.length - 1;
    const at = route.path[idx];
    if (!tooClose(at)) shaping.push({ at, d: dist[idx] });
  }

  const ordered = [...stops, ...shaping].sort((a, b) => a.d - b.d).map((p) => p.at);
  const build = (points: LatLng[]) => {
    const params = new URLSearchParams({ api: '1', origin: fmt(route.start), destination: fmt(route.start), travelmode: 'walking' });
    if (points.length) params.set('waypoints', points.map(fmt).join('|'));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  };

  // Drop shaping points (never stops) until the URL fits.
  let points = ordered;
  let url = build(points);
  while (url.length > MAX_URL_LENGTH && points.length > stops.length) {
    const removable = points.findIndex((p) => !stops.some((s) => s.at === p));
    points = points.filter((_p, i) => i !== removable);
    url = build(points);
  }
  return { url, waypoints: points, shapingPoints: points.length - stops.length };
}
