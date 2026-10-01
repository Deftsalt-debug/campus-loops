import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/core/graph/buildGraph';
import { edgeAscent, routingWeight, trueSeconds, type CostModel } from '../src/core/graph/edgeCost';
import { createRequestContext } from '../src/core/planner/context';
import type { Dataset } from '../src/core/types';
import { tinyDataset, twoWay } from './helpers';

const model: CostModel = { paceMps: 1, climbSecPerM: 6, rain: false, rainUncoveredMultiplier: 1.5 };

function withElevations(ds: Dataset, elevations: Record<string, number>): Dataset {
  ds.nodes.forEach((n) => (n.elevationM = elevations[n.id]));
  return ds;
}

describe('edge cost', () => {
  it('adds climb time only in the uphill direction', () => {
    const ds = withElevations(tinyDataset(['low', 'high'], twoWay('hill', 'low', 'high', 100)), { low: 70, high: 80 });
    const g = buildGraph(ds, { avoidSteps: false });
    const up = g.edges.get('hill:f')!;
    const down = g.edges.get('hill:r')!;
    expect(g.ascent.get(up.id)).toBe(10);
    expect(g.ascent.get(down.id)).toBe(0);
    expect(trueSeconds(up, 10, model)).toBe(100 + 60);
    expect(trueSeconds(down, 0, model)).toBe(100);
  });

  it('uses an explicit ascent over node elevations', () => {
    const ds = withElevations(tinyDataset(['a', 'b'], [['ab', 'a', 'b', 50, { ascentMeters: 4 }]]), { a: 70, b: 70 });
    const nodes = new Map(ds.nodes.map((n) => [n.id, n]));
    expect(edgeAscent(ds.edges[0], nodes)).toBe(4);
  });

  it('treats unknown elevation as flat', () => {
    const ds = tinyDataset(['a', 'b'], [['ab', 'a', 'b', 50]]);
    expect(edgeAscent(ds.edges[0], new Map(ds.nodes.map((n) => [n.id, n])))).toBe(0);
  });

  it('includes crossing delay and pace', () => {
    const [edge] = tinyDataset(['a', 'b'], [['ab', 'a', 'b', 120, { delaySeconds: 45 }]]).edges;
    expect(trueSeconds(edge, 0, { ...model, paceMps: 1.2 })).toBeCloseTo(100 + 45);
  });

  it('rejects negative inputs and a zero pace', () => {
    const [edge] = tinyDataset(['a', 'b'], [['ab', 'a', 'b', -5]]).edges;
    expect(() => trueSeconds(edge, 0, model)).toThrow(RangeError);
    const [ok] = tinyDataset(['a', 'b'], [['ab', 'a', 'b', 5]]).edges;
    expect(() => trueSeconds(ok, -1, model)).toThrow(RangeError);
    expect(() => trueSeconds(ok, 0, { ...model, paceMps: 0 })).toThrow(RangeError);
  });

  it('only inflates uncovered edges, and only in rain mode', () => {
    const ds = tinyDataset(['a', 'b'], [
      ['open', 'a', 'b', 100],
      ['roof', 'a', 'b', 100, { covered: true }],
    ]);
    const [open, roof] = ds.edges;
    expect(routingWeight(open, 0, model)).toBe(100);
    expect(routingWeight(open, 0, { ...model, rain: true })).toBe(150);
    expect(routingWeight(roof, 0, { ...model, rain: true })).toBe(100);
  });
});

describe('rain routing', () => {
  // S -> T directly is 100 m in the open; around via C is 130 m, fully covered.
  const ds = tinyDataset(
    ['S', 'C', 'T'],
    [...twoWay('open', 'S', 'T', 100), ...twoWay('sc', 'S', 'C', 65, { covered: true }), ...twoWay('ct', 'C', 'T', 65, { covered: true })],
  );

  const ctxFor = (rain: boolean) =>
    createRequestContext({
      graph: buildGraph(ds, { avoidSteps: false }),
      model: { ...model, rain },
      startNode: 'S',
      weekday: 4,
      nowSec: 36_000,
      bufferSec: 0,
      requiredIds: new Set(),
      requireCafe: false,
      avoidSteps: false,
      maxStops: 3,
      dwellSec: () => 0,
    });

  it('changes the chosen path but reports true walking seconds', () => {
    const dry = ctxFor(false).leg('S', 'T')!;
    const wet = ctxFor(true).leg('S', 'T')!;
    expect(dry.edges.map((e) => e.id)).toEqual(['open:f']);
    expect(dry.seconds).toBe(100);
    expect(wet.edges.map((e) => e.id)).toEqual(['sc:f', 'ct:f']);
    expect(wet.seconds).toBe(130); // true time, not the inflated routing weight
  });

  it('keeps a true-time lower bound for the way home', () => {
    expect(ctxFor(true).toStartLowerBound.dist.get('T')).toBe(100);
  });
});

describe('avoid steps', () => {
  it('removes stepped edges and reports unreachable when there is no other way', () => {
    const ds = tinyDataset(['A', 'B'], twoWay('stairs', 'A', 'B', 20, { steps: true }));
    expect(buildGraph(ds, { avoidSteps: false }).edges.size).toBe(2);
    const g = buildGraph(ds, { avoidSteps: true });
    expect(g.edges.size).toBe(0);
    expect(g.out.get('A')).toEqual([]);
  });
});
