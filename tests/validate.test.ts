import { describe, expect, it } from 'vitest';
import { DatasetError, loadDataset } from '../src/core/dataset/load';
import { validateDataset } from '../src/core/dataset/validate';
import type { Dataset } from '../src/core/types';
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
    ['a curated walk that skips an edge', (ds) => ds.curatedWalks[0].edgeIds.splice(2, 1), 'WALK_CONTINUITY'],
    ['a curated stop off the route', (ds) => (ds.curatedWalks[1].stops[0].afterEdge = 2), 'WALK_STOP'],
    ['a curated walk on a restricted edge', (ds) => (ds.edges.find((e) => e.id === 's_g4:f')!.allowed = false), 'WALK_DISALLOWED'],
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
