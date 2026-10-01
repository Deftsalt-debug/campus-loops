import type { Occasion, Place } from '../types';
import { parseHHMM } from '../time/clock';
import type { RequestContext } from './context';
import { occasionPoints } from './score';

export type Ineligibility =
  | 'UNKNOWN_HOURS'
  | 'UNKNOWN_PRICE'
  | 'CLOSED_TODAY'
  | 'UNREACHABLE'
  | 'OVER_BUDGET'
  | 'NOT_SHELTERED';

/** Why a place cannot be scheduled for this request, or null if it can. */
export function placeIneligibility(
  place: Place,
  ctx: RequestContext,
  budgetInr: number,
  rain: boolean,
): Ineligibility | null {
  if (place.hoursStatus === 'unknown') return 'UNKNOWN_HOURS';
  if (place.spendLowInr === null || place.spendHighInr === null) return 'UNKNOWN_PRICE';
  if (place.hoursStatus === 'verified' && !place.verifiedOpenWindows.some((w) => w.day === ctx.weekday)) {
    return 'CLOSED_TODAY';
  }
  if (!ctx.fromStart.dist.has(place.nodeId) || !ctx.toStartLowerBound.dist.has(place.nodeId)) {
    return 'UNREACHABLE';
  }
  if (place.spendHighInr > budgetInr) return 'OVER_BUDGET';
  if (rain && ctx.dwellSec(place) > 0 && !place.tags.includes('sheltered')) return 'NOT_SHELTERED';
  return null;
}

export interface CandidateOptions {
  budgetInr: number;
  availableSec: number;
  rain: boolean;
  occasion: Occasion;
  maxCandidates: number;
  cafesKeptWhenRequired: number;
}

/**
 * Narrow places to at most `maxCandidates`, deterministically:
 * 1. every required place (checked for hard unavailability before this);
 * 2. when a café is required, the best few eligible cafés;
 * 3. the remaining eligible places by occasion points, then closeness, then id.
 */
export function selectCandidates(places: Place[], ctx: RequestContext, opts: CandidateOptions): Place[] {
  const chosen = new Map<string, Place>();
  for (const p of places) {
    if (!ctx.requiredIds.has(p.id)) continue;
    const reason = placeIneligibility(p, ctx, opts.budgetInr, opts.rain);
    // A required place stays even if it breaks the budget or is unsheltered:
    // the search then fails honestly instead of silently dropping it.
    if (reason === null || reason === 'OVER_BUDGET' || reason === 'NOT_SHELTERED') chosen.set(p.id, p);
  }

  const ranked = places
    .filter((p) => !ctx.requiredIds.has(p.id) && placeIneligibility(p, ctx, opts.budgetInr, opts.rain) === null)
    .filter((p) => {
      // Only discard impossible stops: any actual route takes at least the
      // shortest outbound/return times. This keeps closed or distant places
      // from consuming the limited candidate slots ahead of feasible ones.
      const earliestArrival = ctx.nowSec + ctx.fromStart.dist.get(p.nodeId)!;
      const latestDeparture = ctx.nowSec + opts.availableSec - ctx.toStartLowerBound.dist.get(p.nodeId)! - ctx.bufferSec;
      const dwell = ctx.dwellSec(p);
      if (earliestArrival + dwell > latestDeparture) return false;
      return p.hoursStatus !== 'verified' || p.verifiedOpenWindows.some((w) =>
        w.day === ctx.weekday &&
        Math.max(earliestArrival, parseHHMM(w.start) * 60) + dwell <= Math.min(latestDeparture, parseHHMM(w.end) * 60),
      );
    })
    .map((p) => ({
      place: p,
      points: occasionPoints(p.category, p.tags, opts.occasion),
      distance: ctx.fromStart.dist.get(p.nodeId)!,
    }))
    .sort((a, b) => b.points - a.points || a.distance - b.distance || (a.place.id < b.place.id ? -1 : 1));

  const add = (p: Place) => {
    if (chosen.size < opts.maxCandidates) chosen.set(p.id, p);
  };
  if (ctx.requireCafe) {
    ranked
      .filter((r) => r.place.category === 'cafe')
      .slice(0, opts.cafesKeptWhenRequired)
      .forEach((r) => add(r.place));
  }
  ranked.forEach((r) => add(r.place));

  return [...chosen.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}
