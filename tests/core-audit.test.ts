import { describe, expect, it } from 'vitest';
import { planToGpx, planToIcs, planToKml } from '../src/core/export/files';
import { googleMapsDirectionsUrl } from '../src/core/export/googleMaps';
import { planGeometry } from '../src/core/geo';
import { buildGraph } from '../src/core/graph/buildGraph';
import { routingWeight, trueSeconds, type CostModel } from '../src/core/graph/edgeCost';
import { createRequestContext } from '../src/core/planner/context';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import { dijkstra } from '../src/core/routing/dijkstra';
import type { PlanRequest } from '../src/core/types';
import { ist, tinyDataset, twoWay } from './helpers';

const now = ist('2026-10-02', '10:00');
const model: CostModel = { paceMps: 1, climbSecPerM: 6, rain: false, rainUncoveredMultiplier: 1.5 };
const request: PlanRequest = {
  startId: 'start', durationMin: 60, budgetInr: 0, occasion: 'friends', requiredPlaceIds: ['bench'],
  requireCafe: false, pace: 'normal', avoidSteps: false, rain: false,
};
const campus = () => tinyDataset(['S', 'P', 'Q'], [
  ...twoWay('sp', 'S', 'P', 100), ...twoWay('pq', 'P', 'Q', 100),
], [{ id: 'bench', nodeId: 'P' }]);
const context = (dataset: ReturnType<typeof tinyDataset>) => createRequestContext({
  graph: buildGraph(dataset, { avoidSteps: false }), model, startNode: dataset.starts[0].nodeId,
  weekday: 5, nowSec: 36_000, bufferSec: 0, requiredIds: new Set(), requireCafe: false,
  avoidSteps: false, maxStops: 3, dwellSec: () => 0,
});

const scheduled = () => rebuildPlan(campus(), request, now, 'g:bench').plans[0];
const options = { startAt: now, stamp: now, startName: 'Gate', startCoords: [13.35, 74.79] as [number, number] };

describe('audit: routing cache identity and finite costs', () => {
  it('keeps leg endpoints distinct when valid dataset IDs contain delimiters', () => {
    const dataset = tinyDataset(['A', 'B>C', 'A>B', 'C'], [
      ...twoWay('first', 'A', 'B>C', 10), ...twoWay('second', 'A>B', 'C', 20),
    ]);
    const ctx = context(dataset);
    expect(ctx.leg('A', 'B>C')?.edges.map((edge) => edge.id)).toEqual(['first:f']);
    expect(ctx.leg('A>B', 'C')?.edges.map((edge) => edge.id)).toEqual(['second:f']);
  });

  it('keeps distinct walked segment sets separate in the loop cache', () => {
    const dataset = tinyDataset(['S', 'P', 'Q', 'R'], [
      ...twoWay('shared', 'S', 'P', 100),
      ['x', 'P', 'Q', 60, { segmentId: 'a,b' }], ['q-home', 'Q', 'S', 60],
      ['y', 'P', 'R', 70, { segmentId: 'a' }], ['r-home', 'R', 'S', 70],
    ]);
    const ctx = context(dataset);
    const first = ctx.loopHome('P', new Set(['shared', 'a,b']));
    const second = ctx.loopHome('P', new Set(['shared', 'a', 'b']));
    expect(first?.edges.map((edge) => edge.id)).toEqual(['y', 'r-home']);
    expect(second?.edges.map((edge) => edge.id)).toEqual(['x', 'q-home']);
  });

  it.each([Infinity, NaN, 0, -1])('rejects invalid pace %s', (paceMps) => {
    expect(() => trueSeconds(campus().edges[0], 0, { ...model, paceMps })).toThrow(RangeError);
  });

  it.each([Infinity, NaN, 0, -1, 0.5])('rejects invalid rain preference multiplier %s', (rainUncoveredMultiplier) => {
    expect(() => routingWeight(campus().edges[0], 0, { ...model, rain: true, rainUncoveredMultiplier })).toThrow(RangeError);
  });

  it('rejects overflow rather than returning an infinite edge time', () => {
    const edge = { ...campus().edges[0], meters: Number.MAX_VALUE };
    expect(() => trueSeconds(edge, 0, { ...model, paceMps: 0.1 })).toThrow(RangeError);
  });

  it('rejects overflow in accumulated shortest-path distance', () => {
    const dataset = tinyDataset(['S', 'A', 'B'], [['sa', 'S', 'A', 1e308], ['ab', 'A', 'B', 1e308]]);
    expect(() => dijkstra(buildGraph(dataset, { avoidSteps: false }), 'S', (edge) => edge.meters)).toThrow(RangeError);
  });
});

describe('audit: malformed direct planner input', () => {
  it.each([
    null, [], {}, { ...request, requiredPlaceIds: null }, { ...request, requiredPlaceIds: 'bench' },
    { ...request, requireCafe: 'false' }, { ...request, rain: 1 }, { ...request, avoidSteps: null },
    { ...request, startId: 12 }, { ...request, dwellOverridesMin: [] }, { ...request, dwellOverridesMin: null },
  ])('returns an input blocker for malformed request %#', (value) => {
    expect(plan(campus(), value as unknown as PlanRequest, now)).toMatchObject({ plans: [], blockers: [{ code: 'INVALID_INPUT' }] });
  });
});

describe('audit: exporting checked routes', () => {
  it('refuses a disconnected edge sequence instead of drawing or exporting a jump', () => {
    expect(() => planGeometry(campus(), { ...scheduled(), edgeIds: ['pq:f', 'sp:r'], visits: [] })).toThrow(/continuous/);
  });

  it('refuses an open edge sequence for a return-to-start plan', () => {
    expect(() => planGeometry(campus(), { ...scheduled(), edgeIds: ['sp:f'] })).toThrow(/return/);
  });

  it('reports an unknown start clearly', () => {
    expect(() => planGeometry(campus(), { ...scheduled(), startNodeId: 'missing' })).toThrow(/unknown start/);
  });

  it.each([-1, 0.5, NaN, Infinity, 10])('rejects unsupported Google Maps waypoint limit %s', (limit) => {
    const route = planGeometry(campus(), scheduled());
    expect(() => googleMapsDirectionsUrl(route, limit)).toThrow(RangeError);
  });

  it('never drops a visit to fit a Google Maps waypoint limit', () => {
    expect(() => googleMapsDirectionsUrl(planGeometry(campus(), scheduled()), 0)).toThrow(RangeError);
  });

  it('labels a cafe pass-by without claiming a cafe stop or purchase', () => {
    const dataset = campus();
    dataset.places[0].category = 'cafe';
    const outing = rebuildPlan(dataset, { ...request, dwellOverridesMin: { bench: 0 } }, now, 'g:bench').plans[0];
    expect(outing.explanation).toContain('No purchase needed');
    expect(outing.explanation).not.toContain('Includes a café');
  });

  it('escapes every calendar newline form as text', () => {
    const outing = { ...scheduled(), name: 'Walk\rATTENDEE:evil\r\nBEGIN:VEVENT\nEND:VEVENT' };
    const calendar = planToIcs(outing, { ...options, startName: 'Gate\rORGANIZER:evil' });
    expect(calendar.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(calendar.replace(/\r\n /g, '').split('\r\n').filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('replaces forbidden calendar controls while preserving valid Unicode and tabs', () => {
    const controls = [...Array(32).keys(), 127].filter((code) => ![9, 10, 13].includes(code));
    const outing = { ...scheduled(), name: `Walk${String.fromCharCode(...controls)}\t₹ café 🚶` };
    const calendar = planToIcs(outing, options);
    for (const code of controls) expect(calendar.includes(String.fromCharCode(code))).toBe(false);
    expect(calendar.replace(/\r\n /g, '')).toContain('\t₹ café 🚶');
  });

  it.each(['https://example.test/\r\nATTENDEE:evil', 'https://example.test/\nBEGIN:VEVENT', 'javascript:alert(1)'])('rejects an unsafe calendar URL %#', (url) => {
    expect(() => planToIcs(scheduled(), { ...options, url })).toThrow(RangeError);
  });

  it('keeps a legitimate fragment URL in the calendar', () => {
    expect(planToIcs(scheduled(), { ...options, url: 'https://example.test/#v=1&id=g%3Abench' }).replace(/\r\n /g, '')).toContain('URL:https://example.test/#v=1&id=g%3Abench\r\n');
  });

  it('replaces characters forbidden by XML 1.0 in route labels', () => {
    const outing = { ...scheduled(), name: 'Walk\u0000\u000b & <talk>' };
    const route = planGeometry(campus(), outing);
    for (const exported of [planToKml(outing, route, 'Gate', 'source'), planToGpx(outing, route, 'Gate', 'source')]) {
      for (const code of [0, 11]) expect(exported.includes(String.fromCharCode(code))).toBe(false);
      expect(exported).toContain('&amp; &lt;talk&gt;');
    }
  });
});
