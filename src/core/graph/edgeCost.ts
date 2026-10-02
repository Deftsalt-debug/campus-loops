import type { Edge, GraphNode } from '../types';

export interface CostModel {
  /** Flat walking speed. Planning default, to be calibrated in field tests. */
  paceMps: number;
  /** Extra seconds per metre climbed (Naismith: 1 h per 600 m, so 6 s/m). */
  climbSecPerM: number;
  rain: boolean;
  /** In rain mode, uncovered edges look this much longer when choosing a path. */
  rainUncoveredMultiplier: number;
}

/**
 * Metres climbed when walking this arc in its own direction.
 * An explicit ascentMeters wins (for a path that dips or crests between its
 * ends); otherwise it is derived from node elevations, or 0 if unknown.
 * Descent is ignored: gentle downhill is about as fast as flat on campus paths.
 */
export function edgeAscent(edge: Edge, nodes: Map<string, GraphNode>): number {
  if (edge.ascentMeters !== undefined) return edge.ascentMeters;
  const a = nodes.get(edge.from)?.elevationM;
  const b = nodes.get(edge.to)?.elevationM;
  if (a === undefined || b === undefined) return 0;
  return Math.max(0, b - a);
}

/** Estimated walking time for one arc. This is the time shown to users. */
export function trueSeconds(edge: Edge, ascentM: number, model: CostModel): number {
  if (!Number.isFinite(model.paceMps) || model.paceMps <= 0) throw new RangeError('paceMps must be finite and positive');
  const parts = [edge.meters, edge.delaySeconds, ascentM, model.climbSecPerM];
  if (parts.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new RangeError(`Edge ${edge.id} has a negative or non-finite cost component`);
  }
  const seconds = edge.meters / model.paceMps + ascentM * model.climbSecPerM + edge.delaySeconds;
  if (!Number.isFinite(seconds)) throw new RangeError(`Edge ${edge.id} walking time overflowed`);
  return seconds;
}

/**
 * Weight Dijkstra minimises. Equal to trueSeconds except in rain mode, where
 * uncovered arcs are made to look longer so covered paths are preferred.
 * Plans always report trueSeconds, never this weight.
 */
export function routingWeight(edge: Edge, ascentM: number, model: CostModel): number {
  const seconds = trueSeconds(edge, ascentM, model);
  if (!Number.isFinite(model.rainUncoveredMultiplier) || model.rainUncoveredMultiplier < 1) {
    throw new RangeError('rainUncoveredMultiplier must be finite and at least 1');
  }
  const weight = model.rain && !edge.covered ? seconds * model.rainUncoveredMultiplier : seconds;
  if (!Number.isFinite(weight)) throw new RangeError(`Edge ${edge.id} routing weight overflowed`);
  return weight;
}
