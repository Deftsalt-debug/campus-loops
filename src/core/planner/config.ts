import type { Pace } from '../types';

/** Every tunable planning assumption in one place. Calibrate these in field tests. */
export interface PlannerConfig {
  paceMps: Record<Pace, number>;
  climbSecPerM: number;
  rainUncoveredMultiplier: number;
  minDurationMin: number;
  maxDurationMin: number;
  defaultBufferMin: number;
  maxRequired: number;
  maxStops: number;
  maxCandidates: number;
  /** Best eligible cafés kept as candidates when a café is required. */
  cafesKeptWhenRequired: number;
  maxResults: number;
  /** Segment overlap (Jaccard) above which two plans count as near-duplicates. */
  duplicateOverlap: number;
  /** Retraced share of distance above which a plan is labelled out-and-back. */
  outAndBackRetrace: number;
  /** Routing cost multiplier on already-walked segments when looking for a different way home. */
  loopReuseFactor: number;
  /** A loop return may take at most this multiple of the quickest return (fixed, so shared plans rebuild identically). */
  loopMaxDetour: number;
  /** Places this close to the start (round trip, seconds) aren't an outing on their own. */
  minStopRoundTripSec: number;
  /** Data older than this gets a "last checked" warning. */
  staleAfterDays: number;
  maxDwellMin: number;
}

export const DEFAULT_CONFIG: PlannerConfig = {
  paceMps: { relaxed: 1.0, normal: 1.2 },
  climbSecPerM: 6,
  rainUncoveredMultiplier: 1.5,
  minDurationMin: 30,
  maxDurationMin: 90,
  defaultBufferMin: 5,
  maxRequired: 2,
  maxStops: 3,
  maxCandidates: 12,
  cafesKeptWhenRequired: 3,
  maxResults: 3,
  duplicateOverlap: 0.8,
  outAndBackRetrace: 0.5,
  loopReuseFactor: 4,
  loopMaxDetour: 2,
  minStopRoundTripSec: 120,
  staleAfterDays: 120,
  maxDwellMin: 120,
};
