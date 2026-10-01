import type { OpenWindow, Place } from '../src/core/types';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const PUBLIC_ACCESS = new Set(['yes', 'designated', 'permissive', 'official']);
const PEDESTRIAN_WAYS = new Set(['footway', 'path', 'steps']);

function unsupportedCondition(tags: Record<string, string>): boolean {
  return Object.keys(tags).some((key) => /^(?:foot|access|oneway:foot)(?::[^:]+)*:conditional$/.test(key)) ||
    (PEDESTRIAN_WAYS.has(tags.highway) && tags['oneway:conditional'] !== undefined);
}

function publicAccess(value: string | undefined): boolean {
  return value === undefined || PUBLIC_ACCESS.has(value);
}

/** The demo cannot evaluate permits, destination-only access, or conditional restrictions. */
export function isPedestrianAllowed(tags: Record<string, string>): boolean {
  if (unsupportedCondition(tags)) return false;
  const access = tags.foot ?? tags.access;
  if (!publicAccess(access)) return false;
  if (['wall', 'fence', 'retaining_wall', 'hedge'].includes(tags.barrier) && !tags.foot) return false;
  return true;
}

/** Explicit pedestrian rules override generic one-way tags; road one-ways govern vehicles. */
export function pedestrianDirections(tags: Record<string, string>): { forward: boolean; reverse: boolean } {
  if (unsupportedCondition(tags)) return { forward: false, reverse: false };
  const oneWay = tags['oneway:foot'] ?? (PEDESTRIAN_WAYS.has(tags.highway) ? tags.oneway : undefined);
  const forward = !['-1', 'reverse'].includes(oneWay ?? '') &&
    publicAccess(tags['foot:forward'] ?? tags.foot ?? tags['access:forward'] ?? tags.access);
  const reverse = !['yes', '1', 'true'].includes(oneWay ?? '') &&
    publicAccess(tags['foot:backward'] ?? tags.foot ?? tags['access:backward'] ?? tags.access);
  return { forward, reverse };
}

/** Parse a conservative subset of OSM hours, rejecting rules the planner cannot represent. */
export function parseOpeningHours(value: string): OpenWindow[] | null {
  if (value.trim() === '24/7') return DAYS.map((_d, day) => ({ day, start: '00:00', end: '23:59' }));
  const windows: OpenWindow[] = [];
  const order = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const clock = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  for (const rule of value.split(';').map((r) => r.trim())) {
    const match = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?) ([0-2]\d:[0-5]\d)-([0-2]\d:[0-5]\d)$/.exec(rule);
    if (!match) return null;
    const [from, to = from] = match[1].split('-');
    const a = order.indexOf(from);
    const b = order.indexOf(to);
    const end = match[3] === '24:00' ? '23:59' : match[3];
    if (a > b || clock(match[2]) >= 1440 || clock(end) >= 1440 || clock(match[2]) >= clock(end)) return null;
    for (let i = a; i <= b; i++) {
      const day = DAYS.indexOf(order[i]);
      // Semicolon-separated OSM rules can override earlier rules on the same day.
      // This deliberately small parser must not turn that override into a union.
      if (windows.some((window) => window.day === day)) return null;
      windows.push({ day, start: match[2], end });
    }
  }
  return windows.length ? windows : null;
}

/** An explicit closure or unsupported expression must never become guessed opening hours. */
export function resolvePlaceHours(
  openingHours: string | undefined,
  placeholderHours: [string, string] | undefined,
  outdoorFree: boolean,
): Pick<Place, 'hoursStatus' | 'hoursSource' | 'verifiedOpenWindows'> {
  if (openingHours !== undefined) {
    const parsed = parseOpeningHours(openingHours);
    return { hoursStatus: parsed ? 'verified' : 'unknown', hoursSource: 'osm', verifiedOpenWindows: parsed ?? [] };
  }
  if (outdoorFree) return { hoursStatus: 'always', hoursSource: 'placeholder', verifiedOpenWindows: [] };
  const [start, end] = placeholderHours ?? ['09:00', '21:00'];
  return {
    hoursStatus: 'verified',
    hoursSource: 'placeholder',
    verifiedOpenWindows: DAYS.map((_day, day) => ({ day, start, end })),
  };
}
