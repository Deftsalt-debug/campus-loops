import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/core/graph/buildGraph';
import { dijkstra } from '../src/core/routing/dijkstra';
import { isContinuous, reconstructPath } from '../src/core/routing/path';
import type { Edge } from '../src/core/types';
import { tinyDataset, twoWay, type ArcSpec } from './helpers';

const byMeters = (e: Edge) => e.meters;
const ids = (edges: Edge[] | null) => edges?.map((e) => e.id) ?? null;

function graphOf(nodes: string[], arcs: ArcSpec[], avoidSteps = false) {
  return buildGraph(tinyDataset(nodes, arcs), { avoidSteps });
}

describe('dijkstra', () => {
  it('finds a known shortest path rather than the fewest hops', () => {
    // A->D direct is 10; A->B->C->D is 3.
    const g = graphOf(['A', 'B', 'C', 'D'], [
      ['ad', 'A', 'D', 10],
      ['ab', 'A', 'B', 1],
      ['bc', 'B', 'C', 1],
      ['cd', 'C', 'D', 1],
    ]);
    const sp = dijkstra(g, 'A', byMeters);
    expect(sp.dist.get('D')).toBe(3);
    expect(ids(reconstructPath(sp, 'D'))).toEqual(['ab', 'bc', 'cd']);
  });

  it('resolves ties deterministically', () => {
    const arcs: ArcSpec[] = [
      ['a1', 'A', 'B', 1],
      ['a2', 'A', 'C', 1],
      ['b', 'B', 'D', 1],
      ['c', 'C', 'D', 1],
    ];
    const first = ids(reconstructPath(dijkstra(graphOf(['A', 'B', 'C', 'D'], arcs), 'A', byMeters), 'D'));
    const reversedInput = ids(
      reconstructPath(dijkstra(graphOf(['A', 'B', 'C', 'D'], [...arcs].reverse()), 'A', byMeters), 'D'),
    );
    expect(first).toEqual(['a1', 'b']);
    expect(reversedInput).toEqual(first);
  });

  it('respects one-way arcs', () => {
    const g = graphOf(['A', 'B'], [['ab', 'A', 'B', 5]]);
    expect(dijkstra(g, 'A', byMeters).dist.get('B')).toBe(5);
    expect(dijkstra(g, 'B', byMeters).dist.has('A')).toBe(false);
  });

  it('leaves unreachable nodes out instead of estimating them', () => {
    const g = graphOf(['A', 'B', 'X'], twoWay('ab', 'A', 'B', 5));
    const sp = dijkstra(g, 'A', byMeters);
    expect(sp.dist.has('X')).toBe(false);
    expect(reconstructPath(sp, 'X')).toBeNull();
  });

  it('returns an empty path from a node to itself', () => {
    const g = graphOf(['A', 'B'], twoWay('ab', 'A', 'B', 5));
    expect(reconstructPath(dijkstra(g, 'A', byMeters), 'A')).toEqual([]);
  });

  it('handles zero-length connectors', () => {
    const g = graphOf(['A', 'B', 'C'], [
      ['ab', 'A', 'B', 0],
      ['bc', 'B', 'C', 4],
    ]);
    const sp = dijkstra(g, 'A', byMeters);
    expect(sp.dist.get('B')).toBe(0);
    expect(sp.dist.get('C')).toBe(4);
  });

  it('rejects negative and non-finite weights', () => {
    const g = graphOf(['A', 'B'], [['ab', 'A', 'B', 5]]);
    expect(() => dijkstra(g, 'A', () => -1)).toThrow(RangeError);
    expect(() => dijkstra(g, 'A', () => NaN)).toThrow(RangeError);
  });

  it('skips stale heap entries after a later improvement', () => {
    // B is first pushed at 10, then improved to 2 via C. The stale entry must not win.
    const g = graphOf(['A', 'B', 'C', 'D'], [
      ['ab', 'A', 'B', 10],
      ['ac', 'A', 'C', 1],
      ['cb', 'C', 'B', 1],
      ['bd', 'B', 'D', 1],
    ]);
    const sp = dijkstra(g, 'A', byMeters);
    expect(sp.dist.get('B')).toBe(2);
    expect(ids(reconstructPath(sp, 'D'))).toEqual(['ac', 'cb', 'bd']);
  });

  it('runs in reverse to find the way back to a target', () => {
    // One-way loop: A->B->C->A. Going out and coming back use different arcs.
    const g = graphOf(['A', 'B', 'C'], [
      ['ab', 'A', 'B', 1],
      ['bc', 'B', 'C', 1],
      ['ca', 'C', 'A', 1],
    ]);
    const out = dijkstra(g, 'A', byMeters);
    const back = dijkstra(g, 'A', byMeters, { reverse: true });
    expect(ids(reconstructPath(out, 'B'))).toEqual(['ab']);
    const home = reconstructPath(back, 'B')!;
    expect(ids(home)).toEqual(['bc', 'ca']);
    expect(isContinuous(home, 'B', 'A')).toBe(true);
    expect(back.dist.get('B')).toBe(2);
  });

  it('does not route over disallowed or (when avoiding) stepped edges', () => {
    const arcs: ArcSpec[] = [
      ...twoWay('short', 'A', 'B', 1, { allowed: false }),
      ...twoWay('steps', 'A', 'C', 1, { steps: true }),
      ...twoWay('long', 'A', 'C', 9),
      ...twoWay('cb', 'C', 'B', 1),
    ];
    const withSteps = dijkstra(graphOf(['A', 'B', 'C'], arcs), 'A', byMeters);
    expect(withSteps.dist.get('B')).toBe(2);
    const noSteps = dijkstra(graphOf(['A', 'B', 'C'], arcs, true), 'A', byMeters);
    expect(noSteps.dist.get('B')).toBe(10);
  });

  it('agrees with brute-force path enumeration on random tiny graphs', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const nodes = ['A', 'B', 'C', 'D', 'E', 'F'];

    for (let trial = 0; trial < 200; trial++) {
      const arcs: ArcSpec[] = [];
      for (const u of nodes) {
        for (const v of nodes) {
          if (u !== v && rand() < 0.35) arcs.push([`${u}${v}`, u, v, Math.floor(rand() * 20)]);
        }
      }
      const g = graphOf(nodes, arcs);
      const sp = dijkstra(g, 'A', byMeters);

      // Brute force: try every simple path from A (fine for 6 nodes, nonnegative weights).
      const best = new Map<string, number>([['A', 0]]);
      const walk = (at: string, cost: number, seen: Set<string>) => {
        for (const [, from, to, meters] of arcs) {
          if (from !== at || seen.has(to)) continue;
          const c = cost + meters;
          if (c < (best.get(to) ?? Infinity)) best.set(to, c);
          seen.add(to);
          walk(to, c, seen);
          seen.delete(to);
        }
      };
      walk('A', 0, new Set(['A']));

      for (const n of nodes) {
        expect(sp.dist.get(n), `trial ${trial}, node ${n}`).toBe(best.get(n));
        const path = reconstructPath(sp, n);
        if (best.has(n)) {
          expect(isContinuous(path!, 'A', n)).toBe(true);
          expect(path!.reduce((s, e) => s + e.meters, 0)).toBe(best.get(n));
        } else {
          expect(path).toBeNull();
        }
      }
    }
  });
});
