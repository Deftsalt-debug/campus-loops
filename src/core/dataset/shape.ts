import type { Issue } from './validate';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const number = (value: unknown) => typeof value === 'number';
const boolean = (value: unknown) => typeof value === 'boolean';
const strings = (value: unknown) => Array.isArray(value) && value.every(string);
const coordinates = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every(number);

/** Check parsed JSON before semantic validation reads any nested properties. */
export function datasetShapeIssues(value: unknown): Issue[] {
  const issues: Issue[] = [];
  const error = (path: string) => issues.push({ level: 'error', code: 'SHAPE', message: `Dataset field "${path}" is missing or has an invalid type.` });
  if (!record(value)) {
    error('dataset');
    return issues;
  }
  const fields = (object: Record<string, unknown>, path: string, checks: Record<string, (v: unknown) => boolean>) => {
    for (const [key, check] of Object.entries(checks)) {
      if (!check(object[key])) error(path ? `${path}.${key}` : key);
    }
  };
  const optional = (check: (v: unknown) => boolean) => (v: unknown) => v === undefined || check(v);
  const nullableNumber = (v: unknown) => v === null || number(v);
  const oneOf = (values: string[]) => (v: unknown) => typeof v === 'string' && values.includes(v);
  const entries = (key: string, inspect: (item: Record<string, unknown>, path: string) => void) => {
    const array = value[key];
    if (!Array.isArray(array)) {
      error(key);
      return;
    }
    array.forEach((item, index) => {
      const path = `${key}[${index}]`;
      if (!record(item)) error(path);
      else inspect(item, path);
    });
  };

  fields(value, '', { datasetVersion: string, timezone: string, isFixture: boolean, licence: string, sources: strings });
  for (const key of ['location', 'supportedWindow']) {
    if (!record(value[key])) error(key);
    else fields(value[key], key, key === 'location' ? { lat: number, lng: number } : { start: string, end: string });
  }
  entries('nodes', (item, path) => fields(item, path, {
    id: string, lat: number, lng: number, label: optional(string), elevationM: optional(number),
  }));
  entries('edges', (item, path) => fields(item, path, {
    id: string, segmentId: string, from: string, to: string, meters: number, delaySeconds: number,
    ascentMeters: optional(number), geometry: (v) => Array.isArray(v) && v.every(coordinates),
    allowed: boolean, steps: boolean, covered: boolean, verifiedAt: string, source: string,
  }));
  entries('places', (item, path) => {
    fields(item, path, {
      id: string, name: string, nodeId: string, category: oneOf(['cafe', 'seating', 'landmark', 'waypoint']),
      dwellDefaultMin: number, spendLowInr: nullableNumber, spendHighInr: nullableNumber, tags: strings,
      hoursStatus: oneOf(['verified', 'always', 'unknown']),
      hoursSource: optional(oneOf(['survey', 'osm', 'placeholder'])),
      spendSource: optional(oneOf(['survey', 'osm', 'placeholder'])), verifiedAt: string, source: string,
    });
    if (!Array.isArray(item.verifiedOpenWindows)) error(`${path}.verifiedOpenWindows`);
    else item.verifiedOpenWindows.forEach((window, index) => {
      const windowPath = `${path}.verifiedOpenWindows[${index}]`;
      if (!record(window)) error(windowPath);
      else fields(window, windowPath, { day: number, start: string, end: string });
    });
  });
  entries('starts', (item, path) => fields(item, path, { id: string, name: string, nodeId: string }));
  entries('curatedWalks', (item, path) => {
    fields(item, path, { id: string, name: string, startNodeId: string, edgeIds: strings, tags: strings, verifiedAt: string });
    if (!Array.isArray(item.stops)) error(`${path}.stops`);
    else item.stops.forEach((stop, index) => {
      const stopPath = `${path}.stops[${index}]`;
      if (!record(stop)) error(stopPath);
      else fields(stop, stopPath, { placeId: string, afterEdge: number });
    });
  });
  return issues;
}
