import { fitsOpenWindow } from '../time/clock';
import type { CuratedWalk, Edge, Place } from '../types';
import { placeIneligibility } from './candidates';
import { isCafeRequirementMet, spendOf, type Itinerary, type Limits, type RequestContext, type ScheduledVisit } from './context';
import type { RejectReason } from './search';

export type CuratedOutcome = { ok: true; itinerary: Itinerary } | { ok: false; reason: RejectReason };

/**
 * Check a verified closed walk against the same hard limits as generated
 * outings. Its edge order is fixed; only timing, spend and access are checked.
 */
export function evaluateCurated(
  walk: CuratedWalk,
  places: Map<string, Place>,
  ctx: RequestContext,
  limits: Limits,
  rain: boolean,
): CuratedOutcome {
  if (walk.startNodeId !== ctx.startNode) return { ok: false, reason: 'unreachable' };

  // Every edge must still be usable for this request (allowed, and no steps if avoiding them).
  const edges: Edge[] = [];
  for (const id of walk.edgeIds) {
    const edge = ctx.graph.edges.get(id);
    if (!edge) return { ok: false, reason: 'unreachable' };
    edges.push(edge);
  }

  const stops = [...walk.stops].sort((a, b) => a.afterEdge - b.afterEdge);
  const visits: ScheduledVisit[] = [];
  let elapsed = 0;
  let walkingSec = 0;
  let spendLow = 0;
  let spendHigh = 0;
  let stopIndex = 0;

  for (let i = 0; i <= edges.length; i++) {
    while (stopIndex < stops.length && stops[stopIndex].afterEdge === i) {
      const place = places.get(stops[stopIndex++].placeId);
      if (!place) return { ok: false, reason: 'unreachable' };
      const reason = placeIneligibility(place, ctx, limits.budgetInr, rain);
      const required = ctx.requiredIds.has(place.id);
      if (reason === 'OVER_BUDGET') return { ok: false, reason: 'budget' };
      if (reason === 'NOT_SHELTERED' && !required) return { ok: false, reason: 'requirements' };
      if (reason && reason !== 'NOT_SHELTERED') return { ok: false, reason: 'hours' };
      const dwellSec = ctx.dwellSec(place);
      if (
        place.hoursStatus === 'verified' &&
        !fitsOpenWindow(place.verifiedOpenWindows, ctx.weekday, ctx.nowSec + elapsed, ctx.nowSec + elapsed + dwellSec)
      ) {
        return { ok: false, reason: 'hours' };
      }
      visits.push({ place, arriveSec: elapsed, dwellSec });
      elapsed += dwellSec;
      const { low, high } = spendOf(place);
      spendLow += low;
      spendHigh += high;
    }
    if (i < edges.length) {
      const s = ctx.edgeSeconds(edges[i]);
      walkingSec += s;
      elapsed += s;
    }
  }

  for (const id of ctx.requiredIds) {
    if (!visits.some((v) => v.place.id === id)) return { ok: false, reason: 'requirements' };
  }
  if (ctx.requireCafe && !isCafeRequirementMet(visits)) return { ok: false, reason: 'requirements' };
  if (spendHigh > limits.budgetInr) return { ok: false, reason: 'budget' };

  const dwellSec = visits.reduce((sum, v) => sum + v.dwellSec, 0);
  const totalSec = walkingSec + dwellSec + ctx.bufferSec;
  if (totalSec > limits.availableSec) return { ok: false, reason: 'time' };

  return {
    ok: true,
    itinerary: {
      id: `c:${walk.id}`,
      kind: 'curated',
      walkName: walk.name,
      walkTags: walk.tags,
      edges,
      visits,
      walkingSec,
      dwellSec,
      totalSec,
      spendLowInr: spendLow,
      spendHighInr: spendHigh,
    },
  };
}
