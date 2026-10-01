import type { Graph } from '../graph/buildGraph';
import { routingWeight, trueSeconds, type CostModel } from '../graph/edgeCost';
import { dijkstra, type ShortestPaths } from '../routing/dijkstra';
import { reconstructPath } from '../routing/path';
import type { Edge, Place } from '../types';

/** One walking leg between two nodes, timed in true seconds. */
export interface Leg {
  edges: Edge[];
  seconds: number;
  meters: number;
}

/** A scheduled visit before it is turned into a user-facing Visit. */
export interface ScheduledVisit {
  place: Place;
  arriveSec: number;
  dwellSec: number;
  /** Number of walk edges completed at arrival; distinguishes repeated nodes. */
  afterEdge: number;
}

/** A feasible candidate outing, generated or curated, before ranking. */
export interface Itinerary {
  id: string;
  kind: 'generated' | 'curated';
  /** Curated walk name, when there is one. */
  walkName?: string;
  walkTags: string[];
  edges: Edge[];
  visits: ScheduledVisit[];
  walkingSec: number;
  dwellSec: number;
  totalSec: number;
  spendLowInr: number;
  spendHighInr: number;
}

/** The time and money limits a search must respect. */
export interface Limits {
  availableSec: number;
  budgetInr: number;
}

/** Per-request routing state shared by the generated and curated searches. */
export interface RequestContext {
  graph: Graph;
  model: CostModel;
  startNode: string;
  /** Weekday and seconds since IST midnight when the outing begins. */
  weekday: number;
  nowSec: number;
  bufferSec: number;
  requiredIds: Set<string>;
  requireCafe: boolean;
  avoidSteps: boolean;
  maxStops: number;
  dwellSec: (place: Place) => number;
  edgeSeconds: (edge: Edge) => number;
  /** Shortest true-time walk from the start to each node. */
  fromStart: ShortestPaths;
  /** Shortest true-time walk from each node back to the start (a lower bound for any return). */
  toStartLowerBound: ShortestPaths;
  /** Rain-aware leg between two nodes; null when unreachable. Cached per request. */
  leg: (from: string, to: string) => Leg | null;
}

export function createRequestContext(
  args: Omit<RequestContext, 'edgeSeconds' | 'fromStart' | 'toStartLowerBound' | 'leg'>,
): RequestContext {
  const { graph, model, startNode } = args;
  const secondsCache = new Map<string, number>();
  const edgeSeconds = (edge: Edge) => {
    let s = secondsCache.get(edge.id);
    if (s === undefined) {
      s = trueSeconds(edge, graph.ascent.get(edge.id) ?? 0, model);
      secondsCache.set(edge.id, s);
    }
    return s;
  };
  const weight = (edge: Edge) => routingWeight(edge, graph.ascent.get(edge.id) ?? 0, model);

  // One Dijkstra per distinct source node, reused for every leg in this request.
  const searches = new Map<string, ShortestPaths>();
  const legs = new Map<string, Leg | null>();
  const leg = (from: string, to: string): Leg | null => {
    const key = `${from}>${to}`;
    if (legs.has(key)) return legs.get(key)!;
    let sp = searches.get(from);
    if (!sp) {
      sp = dijkstra(graph, from, weight);
      searches.set(from, sp);
    }
    const edges = reconstructPath(sp, to);
    const result = edges && {
      edges,
      seconds: edges.reduce((sum, e) => sum + edgeSeconds(e), 0),
      meters: edges.reduce((sum, e) => sum + e.meters, 0),
    };
    legs.set(key, result);
    return result;
  };

  return {
    ...args,
    edgeSeconds,
    fromStart: dijkstra(graph, startNode, edgeSeconds),
    toStartLowerBound: dijkstra(graph, startNode, edgeSeconds, { reverse: true }),
    leg,
  };
}

/** Sum of upper or lower spend over visits. Unknown prices never reach here. */
export function spendOf(place: Place): { low: number; high: number } {
  return { low: place.spendLowInr ?? 0, high: place.spendHighInr ?? 0 };
}

export function isCafeRequirementMet(visits: { place: Place }[]): boolean {
  return visits.some((v) => v.place.category === 'cafe');
}
