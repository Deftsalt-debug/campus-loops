import type { Pace } from './types';

/**
 * One real walk, recorded on the device after following a plan. Used to
 * check the walking-pace and climb assumptions against reality.
 */
export interface WalkLog {
  id: string;
  planId: string;
  datasetVersion: string;
  pace: Pace;
  predictedWalkSec: number;
  actualWalkSec: number;
  predictedDwellSec?: number;
  actualDwellSec?: number;
  /** ISO timestamp. */
  loggedAt: string;
}

export interface CalibrationSummary {
  count: number;
  /** Median actual/predicted walking time. Above 1 means walks take longer than planned. */
  medianWalkRatio: number | null;
  /** Share of walks whose walking time was within ±20% of the prediction. */
  within20Share: number | null;
  medianDwellRatio: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const usable = (predicted: number | undefined, actual: number | undefined): actual is number =>
  typeof predicted === 'number' && predicted > 0 && typeof actual === 'number' && Number.isFinite(actual) && actual >= 0;

export function summarise(logs: WalkLog[], pace?: Pace): CalibrationSummary {
  const relevant = pace ? logs.filter((l) => l.pace === pace) : logs;
  const walkRatios = relevant
    .filter((l) => usable(l.predictedWalkSec, l.actualWalkSec))
    .map((l) => l.actualWalkSec / l.predictedWalkSec);
  const dwellRatios = relevant
    .filter((l) => usable(l.predictedDwellSec, l.actualDwellSec))
    .map((l) => l.actualDwellSec! / l.predictedDwellSec!);
  return {
    count: walkRatios.length,
    medianWalkRatio: median(walkRatios),
    within20Share: walkRatios.length ? walkRatios.filter((r) => Math.abs(r - 1) <= 0.2).length / walkRatios.length : null,
    medianDwellRatio: median(dwellRatios),
  };
}

/** Pace that would have made the median walk exact. A suggestion to review, never applied automatically. */
export function suggestedPaceMps(currentPaceMps: number, summary: CalibrationSummary): number | null {
  return summary.medianWalkRatio ? currentPaceMps / summary.medianWalkRatio : null;
}
