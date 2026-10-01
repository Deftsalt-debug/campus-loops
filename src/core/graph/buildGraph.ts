import type { Dataset, Edge, GraphNode } from '../types';
import { edgeAscent } from './edgeCost';

/** Adjacency lists over the edges a request may use. */
export interface Graph {
  nodes: Map<string, GraphNode>;
  /** Usable edges only. */
  edges: Map<string, Edge>;
  /** Outgoing arcs per node, sorted by edge id so results are deterministic. */
  out: Map<string, Edge[]>;
  /** Incoming arcs per node, for searches run backwards towards a target. */
  in: Map<string, Edge[]>;
  /** Climb per usable edge id, in metres. */
  ascent: Map<string, number>;
}

export interface GraphFilter {
  avoidSteps: boolean;
}

export function buildGraph(dataset: Dataset, filter: GraphFilter): Graph {
  const nodes = new Map(dataset.nodes.map((n) => [n.id, n]));
  const edges = new Map<string, Edge>();
  const out = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  const ascent = new Map<string, number>();
  for (const n of dataset.nodes) {
    out.set(n.id, []);
    incoming.set(n.id, []);
  }

  const usable = dataset.edges
    .filter((e) => e.allowed && !(filter.avoidSteps && e.steps))
    .filter((e) => nodes.has(e.from) && nodes.has(e.to))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const e of usable) {
    edges.set(e.id, e);
    out.get(e.from)!.push(e);
    incoming.get(e.to)!.push(e);
    ascent.set(e.id, edgeAscent(e, nodes));
  }
  return { nodes, edges, out, in: incoming, ascent };
}
