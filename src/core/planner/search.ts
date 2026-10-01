import { fitsOpenWindow } from '../time/clock';
import type { Edge, Place } from '../types';
import {
  isCafeRequirementMet,
  spendOf,
  type Itinerary,
  type Leg,
  type Limits,
  type RequestContext,
  type ScheduledVisit,
} from './context';

export type RejectReason = 'time' | 'budget' | 'hours' | 'unreachable' | 'requirements';

export interface SearchResult {
  itineraries: Itinerary[];
  /** How often each hard limit cut off a branch. Useful for explaining failures. */
  rejections: Record<RejectReason, number>;
  /** Number of complete sequences evaluated. */
  evaluated: number;
}

/**
 * Depth-first search over ordered sequences of 1..maxStops distinct
 * candidates, each joined by the leg the router picked, then home.
 *
 * Every prune is safe: costs only grow as stops are added, so a prefix
 * that already breaks a hard limit cannot be rescued by adding stops.
 * - time: arrival + dwell + the *shortest possible* way home + buffer > available
 * - budget: summed upper-bound spend > budget
 * - hours: a visit doesn't fit its verified window (the prefix's timing is fixed)
 * - requirements: more required stops are missing than slots remain
 * With 12 candidates this explores at most 1,464 sequences, usually far fewer.
 */
export interface SearchOptions {
  /** Rebuild exactly this plan (from a shared link) instead of searching freely. */
  onlyPlanId?: string;
  /** Also build "different way home" variants. Off for failure diagnostics, which only need minimums. */
  loops?: boolean;
}

/** Generated plan ids: g:a.b (quickest way home) or l:a.b (loop home). */
export function generatedPlanId(kind: 'g' | 'l', placeIds: string[]): string {
  return `${kind}:${placeIds.join('.')}`;
}

export function searchGenerated(ctx: RequestContext, candidates: Place[], limits: Limits, options: SearchOptions = {}): SearchResult {
  const { onlyPlanId, loops = true } = options;
  // The stop sequence and return kind a rebuild is restricted to.
  const onlyKind = onlyPlanId?.slice(0, 1);
  const onlyStops = onlyPlanId?.slice(2);
  const rejections: Record<RejectReason, number> = { time: 0, budget: 0, hours: 0, unreachable: 0, requirements: 0 };
  const itineraries: Itinerary[] = [];
  let evaluated = 0;

  const visits: ScheduledVisit[] = [];
  const legs: Leg[] = [];

  const requiredCafes = candidates.filter((p) => ctx.requiredIds.has(p.id) && p.category === 'cafe');

  /** Stops still needed to satisfy required places and the café requirement. */
  const missingRequired = () => {
    const visited = (id: string) => visits.some((v) => v.place.id === id);
    let missing = 0;
    for (const id of ctx.requiredIds) if (!visited(id)) missing++;
    // A pending required café will satisfy the café requirement too, so it needs no extra slot.
    const cafePending = requiredCafes.some((p) => !visited(p.id));
    if (ctx.requireCafe && !isCafeRequirementMet(visits) && !cafePending) missing++;
    return missing;
  };

  const visit = (at: string, elapsedSec: number, spendLow: number, spendHigh: number) => {
    if (visits.length > 0) {
      const home = ctx.leg(at, ctx.startNode);
      if (!home) {
        rejections.unreachable++;
      } else if (missingRequired() === 0 && (!onlyStops || visits.map((v) => v.place.id).join('.') === onlyStops)) {
        evaluated++;
        // Check the same total the plan will report, so rounding can't disagree.
        const quickest = buildItinerary('g', [...legs, home], [...visits], spendLow, spendHigh, ctx);
        if (quickest.totalSec > limits.availableSec) {
          rejections.time++;
        } else if (quickest.edges.some((edge) => edge.meters > 0)) {
          // A stop at the start can be part of a walk, but staying there is
          // not an outing. Keep searching so later stops can add a real leg.
          if (!onlyKind || onlyKind === 'g') itineraries.push(quickest);
          // If the quickest way home retraces the way out, also offer a real loop.
          // A loop is never quicker, so only feasible quickest plans can have one.
          if (loops && (!onlyKind || onlyKind === 'l')) {
            const walked = new Set(legs.flatMap((l) => l.edges.map((e) => e.segmentId)));
            const loopLeg = ctx.loopHome(at, walked);
            if (loopLeg) {
              const loop = buildItinerary('l', [...legs, loopLeg], [...visits], spendLow, spendHigh, ctx);
              if (loop.totalSec <= limits.availableSec) itineraries.push(loop);
            }
          }
        }
      }
    }
    if (visits.length === ctx.maxStops) return;
    if (missingRequired() > ctx.maxStops - visits.length) {
      rejections.requirements++;
      return;
    }

    for (const place of candidates) {
      if (visits.some((v) => v.place.id === place.id)) continue;
      if (onlyPlanId) {
        // Rebuilding a saved route must not search every permutation in the
        // dataset, but its stops must survive the recommendation shortlist.
        const prefix = [...visits.map((v) => v.place.id), place.id].join('.');
        if (prefix !== onlyStops && !onlyStops!.startsWith(`${prefix}.`)) continue;
      }
      const leg = ctx.leg(at, place.nodeId);
      if (!leg) {
        rejections.unreachable++;
        continue;
      }
      const { low, high } = spendOf(place);
      if (spendHigh + high > limits.budgetInr) {
        rejections.budget++;
        continue;
      }
      const arriveSec = elapsedSec + leg.seconds;
      const dwellSec = ctx.dwellSec(place);
      const departSec = arriveSec + dwellSec;
      const shortestHome = ctx.toStartLowerBound.dist.get(place.nodeId);
      if (shortestHome === undefined) {
        rejections.unreachable++;
        continue;
      }
      if (departSec + shortestHome + ctx.bufferSec > limits.availableSec) {
        rejections.time++;
        continue;
      }
      if (
        place.hoursStatus === 'verified' &&
        !fitsOpenWindow(place.verifiedOpenWindows, ctx.weekday, ctx.nowSec + arriveSec, ctx.nowSec + departSec)
      ) {
        rejections.hours++;
        continue;
      }
      visits.push({ place, arriveSec, dwellSec, afterEdge: legs.reduce((sum, l) => sum + l.edges.length, 0) + leg.edges.length });
      legs.push(leg);
      visit(place.nodeId, departSec, spendLow + low, spendHigh + high);
      visits.pop();
      legs.pop();
    }
  };

  visit(ctx.startNode, 0, 0, 0);
  return { itineraries, rejections, evaluated };
}

function buildItinerary(
  kind: 'g' | 'l',
  legs: Leg[],
  visits: ScheduledVisit[],
  spendLowInr: number,
  spendHighInr: number,
  ctx: RequestContext,
): Itinerary {
  const edges: Edge[] = legs.flatMap((l) => l.edges);
  const walkingSec = legs.reduce((sum, l) => sum + l.seconds, 0);
  const dwellSec = visits.reduce((sum, v) => sum + v.dwellSec, 0);
  return {
    id: generatedPlanId(kind, visits.map((v) => v.place.id)),
    kind: 'generated',
    walkTags: [],
    edges,
    visits,
    walkingSec,
    dwellSec,
    totalSec: walkingSec + dwellSec + ctx.bufferSec,
    spendLowInr,
    spendHighInr,
  };
}
