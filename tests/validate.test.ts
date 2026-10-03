import { describe, expect, it } from 'vitest';
import { DatasetError, loadDataset } from '../src/core/dataset/load';
import { validateDataset } from '../src/core/dataset/validate';
import type { Dataset, LatLng } from '../src/core/types';
import { fixture } from './helpers';

const errorCodes = (ds: Dataset, production = false) =>
  validateDataset(ds, { production }).filter((i) => i.level === 'error').map((i) => i.code);

describe('validateDataset', () => {
  it('accepts the fixture with warnings only', () => {
    const issues = validateDataset(fixture());
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['FIXTURE', 'UNKNOWN_PRICE', 'UNKNOWN_HOURS', 'UNREACHABLE_NODE', 'UNREACHABLE_PLACE']),
    );
  });

  it('refuses fixture data in production mode', () => {
    expect(errorCodes(fixture(), true)).toEqual(['FIXTURE']);
  });

  it('refuses an empty dataset even when it is labelled as production data', () => {
    const ds = fixture();
    Object.assign(ds, { isFixture: false, nodes: [], edges: [], starts: [], places: [], curatedWalks: [] });
    expect(errorCodes(ds, true)).toEqual(['EMPTY_DATASET', 'EMPTY_DATASET', 'EMPTY_DATASET']);
    expect(() => loadDataset(ds, { production: true })).toThrow(DatasetError);
  });

  it('requires at least one selectable start even when the graph is populated', () => {
    const ds = fixture();
    ds.starts = [];
    expect(errorCodes(ds)).toContain('EMPTY_DATASET');
  });

  it('rejects the place-ID collision between one dotted place and an ordered pair', () => {
    const ds = fixture();
    const base = ds.places[0];
    ds.places.push({ ...base, id: 'a' }, { ...base, id: 'b' });
    expect(errorCodes(ds)).toEqual([]);
    ds.places.push({ ...base, id: 'a.b' });
    expect(errorCodes(ds)).toEqual(['BAD_ID']);
    expect(() => loadDataset(ds)).toThrow(DatasetError);
  });

  it.each(['with space', 'with\nnewline', 'trailing\n', 'a,b', 'a~b', 'a/b', 'x'.repeat(121)])('rejects a place ID that cannot round-trip in a share link: %s', (id) => {
    const ds = fixture();
    ds.places.push({ ...ds.places[0], id });
    expect(errorCodes(ds)).toContain('BAD_ID');
  });

  it('retains supported punctuation and the maximum place ID length', () => {
    const ds = fixture();
    ds.places.push({ ...ds.places[0], id: 'Cafe_1:west-wing' }, { ...ds.places[0], id: 'x'.repeat(120) });
    expect(errorCodes(ds)).toEqual([]);
  });

  it('accepts a mapped feature position separate from its routing anchor', () => {
    const ds = fixture();
    ds.places[0].position = [13.35, 74.79];
    ds.places[0].osmRef = 'node/13781284649';
    expect(errorCodes(ds)).toEqual([]);
    expect(loadDataset(ds).dataset.places[0].position).toEqual([13.35, 74.79]);
  });

  it.each<LatLng>([[NaN, 74.79], [13.35, Infinity], [-Infinity, 74.79], [90.01, 74.79], [-90.01, 74.79], [13.35, 180.01], [13.35, -180.01]])('rejects invalid venue coordinates [%s, %s]', (lat, lng) => {
    const ds = fixture();
    ds.places[0].position = [lat, lng];
    expect(errorCodes(ds)).toContain('BAD_NUMBER');
    expect(() => loadDataset(ds)).toThrow(DatasetError);
  });

  it.each(['node/0', 'way/-1', 'node/1.5', 'relation/1', 'node/1?edit=true', '//example.com', 'node/1\n'])('rejects an invalid OSM source reference: %s', (osmRef) => {
    const ds = fixture();
    Object.assign(ds.places[0], { osmRef });
    expect(errorCodes(ds)).toContain('BAD_ID');
  });

  it.each(['dataset', 'start', 'curated'] as const)('rejects a %s identifier that cannot be shared', (kind) => {
    const ds = fixture();
    if (kind === 'dataset') ds.datasetVersion = 'invalid version';
    else if (kind === 'start') ds.starts[0].id = 'invalid start';
    else ds.curatedWalks[0].id = 'x'.repeat(121);
    expect(errorCodes(ds)).toContain('BAD_ID');
  });

  it.each<[string, (ds: Dataset) => void, string]>([
    ['duplicate node ids', (ds) => ds.nodes.push({ ...ds.nodes[0] }), 'DUPLICATE_ID'],
    ['an edge to a missing node', (ds) => (ds.edges[0].to = 'ghost'), 'MISSING_REF'],
    ['a place on a missing node', (ds) => (ds.places[0].nodeId = 'ghost'), 'MISSING_REF'],
    ['negative meters', (ds) => (ds.edges[0].meters = -1), 'BAD_NUMBER'],
    ['negative delay', (ds) => (ds.edges[0].delaySeconds = -5), 'BAD_NUMBER'],
    ['infinite dwell', (ds) => (ds.places[0].dwellDefaultMin = Infinity), 'BAD_NUMBER'],
    ['geometry not starting at its node', (ds) => (ds.edges[0].geometry[0] = [13.36, 74.8]), 'GEOMETRY'],
    ['a segment whose arcs are not reverses', (ds) => (ds.edges[1].to = 'n4'), 'SEGMENT'],
    ['low spend above high', (ds) => (ds.places[0].spendLowInr = 500), 'SPEND_RANGE'],
    ['only one spend bound', (ds) => (ds.places[0].spendHighInr = null), 'SPEND_RANGE'],
    ['verified hours without windows', (ds) => (ds.places[0].verifiedOpenWindows = []), 'HOURS'],
    ['a window ending before it starts', (ds) => (ds.places[0].verifiedOpenWindows[0].end = '07:00'), 'HOURS'],
    ['a bad date', (ds) => (ds.edges[0].verifiedAt = 'last week'), 'BAD_DATE'],
    ['an impossible date', (ds) => (ds.edges[0].verifiedAt = '2026-02-30'), 'BAD_DATE'],
    ['invalid route coordinates', (ds) => ds.edges[0].geometry.splice(1, 0, [91, 74]), 'GEOMETRY'],
    ['an invalid daylight reference', (ds) => (ds.location.lat = NaN), 'BAD_NUMBER'],
    ['a curated walk that skips an edge', (ds) => ds.curatedWalks[0].edgeIds.splice(2, 1), 'WALK_CONTINUITY'],
    ['a curated stop off the route', (ds) => (ds.curatedWalks[1].stops[0].afterEdge = 2), 'WALK_STOP'],
    ['a curated walk on a restricted edge', (ds) => (ds.edges.find((e) => e.id === 's_g4:f')!.allowed = false), 'WALK_DISALLOWED'],
    ['an empty curated walk', (ds) => (ds.curatedWalks[0].edgeIds = []), 'WALK_CONTINUITY'],
    ['a duplicated curated stop', (ds) => ds.curatedWalks[1].stops.push({ ...ds.curatedWalks[1].stops[0] }), 'WALK_STOP'],
    ['a non-IST timezone', (ds) => ((ds as { timezone: string }).timezone = 'UTC'), 'TIMEZONE'],
  ])('flags %s', (_label, mutate, code) => {
    const ds = fixture();
    mutate(ds);
    expect(errorCodes(ds)).toContain(code);
  });

  it('flags a start with no way out and back', () => {
    const ds = fixture();
    ds.starts.push({ id: 'island', name: 'Island', nodeId: 'far2' });
    ds.places = ds.places.filter((p) => p.nodeId !== 'far1');
    expect(errorCodes(ds)).toContain('START_NO_RETURN');
  });
});

describe('loadDataset', () => {
  it.each<[string, (ds: Dataset) => void]>([
    ['null node', (ds) => (ds.nodes as unknown[]).push(null)],
    ['nonboolean access flag', (ds) => ((ds.edges[0] as unknown as Record<string, unknown>).allowed = 'false')],
    ['missing location', (ds) => ((ds as unknown as Record<string, unknown>).location = null)],
    ['missing place tags', (ds) => ((ds.places[0] as unknown as Record<string, unknown>).tags = null)],
    ['missing windows', (ds) => ((ds.places[0] as unknown as Record<string, unknown>).verifiedOpenWindows = null)],
    ['null window', (ds) => (ds.places[0].verifiedOpenWindows as unknown[]).push(null)],
    ['malformed geometry point', (ds) => (ds.edges[0].geometry as unknown[]).push([13])],
    ['incomplete venue coordinate', (ds) => Object.assign(ds.places[0], { position: [13] })],
    ['excess venue coordinates', (ds) => Object.assign(ds.places[0], { position: [13, 74, 1] })],
    ['nonnumeric venue coordinate', (ds) => Object.assign(ds.places[0], { position: ['13', 74] })],
    ['null venue position', (ds) => Object.assign(ds.places[0], { position: null })],
    ['object venue position', (ds) => Object.assign(ds.places[0], { position: { lat: 13, lng: 74 } })],
    ['nonstring source reference', (ds) => Object.assign(ds.places[0], { osmRef: 1 })],
    ['unknown hours status', (ds) => ((ds.places[0] as unknown as Record<string, unknown>).hoursStatus = 'open')],
    ['invalid fixture flag', (ds) => ((ds as unknown as Record<string, unknown>).isFixture = 'false')],
  ])('reports a DatasetError for %s rather than crashing during validation', (_label, mutate) => {
    const ds = fixture();
    mutate(ds);
    expect(() => loadDataset(ds)).toThrow(DatasetError);
    expect(validateDataset(ds).some((issue) => issue.code === 'SHAPE')).toBe(true);
  });
  it('returns typed data and warnings for a valid dataset', () => {
    const { dataset, issues } = loadDataset(fixture());
    expect(dataset.datasetVersion).toBe('fixture-1');
    expect(issues.every((i) => i.level === 'warning')).toBe(true);
  });

  it('throws instead of planning on broken data', () => {
    const ds = fixture();
    ds.edges[0].meters = -1;
    expect(() => loadDataset(ds)).toThrow(DatasetError);
    expect(() => loadDataset(null)).toThrow(DatasetError);
  });
});
