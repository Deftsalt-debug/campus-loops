import { describe, expect, it } from 'vitest';
import { suggestedPaceMps, summarise, type CalibrationSummary, type WalkLog } from '../src/core/calibration';

const log = (predicted: number, actual: number): WalkLog => ({
  id: 'walk', planId: 'g:bench', datasetVersion: 'test', pace: 'normal',
  predictedWalkSec: predicted, actualWalkSec: actual, loggedAt: '2026-10-01T10:00:00Z',
});

describe('finite calibration calculations', () => {
  it('ignores nonfinite predictions and ratios that overflow', () => {
    const summary = summarise([log(Infinity, 10), log(Number.MIN_VALUE, 10), log(100, 120)]);
    expect(summary).toMatchObject({ count: 1, medianWalkRatio: 1.2 });
  });

  it('averages finite large ratios without overflowing', () => {
    expect(summarise([log(1, 1e308), log(1, 1e308)]).medianWalkRatio).toBe(1e308);
  });

  it.each([0, -1, NaN, Infinity])('does not suggest a pace from invalid current speed %s', (speed) => {
    expect(suggestedPaceMps(speed, summarise([log(100, 100)]))).toBeNull();
  });

  it.each([0, -1, NaN, Infinity, Number.MIN_VALUE])('does not suggest an invalid or overflowing pace from ratio %s', (ratio) => {
    const summary: CalibrationSummary = { count: 1, medianWalkRatio: ratio, within20Share: 0, medianDwellRatio: null };
    expect(suggestedPaceMps(1.2, summary)).toBeNull();
  });
});
