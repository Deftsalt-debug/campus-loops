import type { Graph } from '../graph/buildGraph';
import type { Edge } from '../types';
import { MinHeap } from './minHeap';

export interface ShortestPaths {
  source: string;
  /** Best known weight from the source. Unreachable nodes are absent, never estimated. */
  dist: Map<string, number>;
  /** The arc used to reach each node on its best path (absent for the source). */
  prevEdge: Map<string, Edge>;
  reverse: boolean;
}

/**
 * Single-source Dijkstra over directed arcs.
 *
 * Forward: dist(v) = cheapest walk source -> v.
 * Reverse: walks arcs backwards, so dist(v) = cheapest walk v -> source.
 *   prevEdge(v) is then the first arc of that walk, leaving v.
 *
 * Works only with nonnegative weights; a negative or non-finite weight throws
 * rather than silently producing a wrong answer.
 */
export function dijkstra(
  graph: Graph,
  source: string,
  weight: (edge: Edge) => number,
  options: { reverse?: boolean } = {},
): ShortestPaths {
  const reverse = options.reverse ?? false;
  const dist = new Map<string, number>();
  const prevEdge = new Map<string, Edge>();
  if (!graph.nodes.has(source)) return { source, dist, prevEdge, reverse };

  const settled = new Set<string>();
  const heap = new MinHeap<string>();
  dist.set(source, 0);
  heap.push(source, 0);

  while (heap.size > 0) {
    const { item: u, priority: d } = heap.pop()!;
    // Lazy deletion: an older, longer entry for u can still be in the heap.
    if (settled.has(u) || d > dist.get(u)!) continue;
    settled.add(u);

    const arcs = (reverse ? graph.in.get(u) : graph.out.get(u)) ?? [];
    for (const edge of arcs) {
      const w = weight(edge);
      if (!Number.isFinite(w) || w < 0) {
        throw new RangeError(`Edge ${edge.id} has invalid weight ${w}; Dijkstra needs nonnegative weights`);
      }
      const v = reverse ? edge.from : edge.to;
      if (settled.has(v)) continue;
      const candidate = d + w;
      const known = dist.get(v);
      // Strict < keeps the first path found on ties, which is deterministic
      // because adjacency lists are sorted and the heap is FIFO on ties.
      if (known === undefined || candidate < known) {
        dist.set(v, candidate);
        prevEdge.set(v, edge);
        heap.push(v, candidate);
      }
    }
  }
  return { source, dist, prevEdge, reverse };
}
