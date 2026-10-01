import type { Edge } from '../types';
import type { ShortestPaths } from './dijkstra';

/**
 * Rebuild the arcs of the best path between the search source and `node`.
 * Forward search: source -> node. Reverse search: node -> source.
 * Returns null when unreachable and [] when node is the source.
 */
export function reconstructPath(sp: ShortestPaths, node: string): Edge[] | null {
  if (!sp.dist.has(node)) return null;
  const path: Edge[] = [];
  let current = node;
  const guard = sp.dist.size + 1;
  while (current !== sp.source) {
    const edge = sp.prevEdge.get(current);
    if (!edge || path.length > guard) throw new Error(`Broken predecessor chain at ${current}`);
    path.push(edge);
    current = sp.reverse ? edge.to : edge.from;
  }
  // Following predecessors from a forward search walks backwards, so flip it.
  return sp.reverse ? path : path.reverse();
}

/** True when the arcs form one connected walk from `start` to `end`. */
export function isContinuous(edges: Edge[], start: string, end: string): boolean {
  let at = start;
  for (const e of edges) {
    if (e.from !== at) return false;
    at = e.to;
  }
  return at === end;
}
