
export { occasionPoints } from './occasions';

export interface ScoreParts {
  /** Average occasion points over scheduled visits (and curated walk tags), 0–2. */
  occasion: number;
  retraceRatio: number;
  totalSec: number;
  availableSec: number;
  coveredShare: number;
  rain: boolean;
  /** Walking time / available time; ranked first after occasion for "walking" modes. */
  walkingShare: number;
  rankBy: 'stops' | 'walking';
  id: string;
}

/**
 * Time fit: anything using at least half the available time is equally good,
 * so a calm 42-minute plan is not punished against a crammed 59-minute one.
 */
export function timeFit(totalSec: number, availableSec: number): number {
  if (availableSec <= 0) return 0;
  const ratio = totalSec / availableSec;
  return ratio >= 0.5 ? 1 : ratio / 0.5;
}

const round = (value: number, step: number) => Math.round(value / step) * step;

/**
 * Lexicographic ranking: occasion match, then less retracing, then time fit.
 * In rain mode, covered share comes straight after occasion: staying dry
 * matters more than avoiding a retraced path. Walking-first modes (Active walk)
 * then prefer the larger share of time spent walking. Values are bucketed so a tiny
 * difference in one criterion doesn't override the next one.
 * Negative result means `a` ranks before `b`.
 */
export function compareScores(a: ScoreParts, b: ScoreParts): number {
  const keys: [number, number][] = [[round(b.occasion, 0.01), round(a.occasion, 0.01)]];
  if (a.rain) keys.push([round(b.coveredShare, 0.1), round(a.coveredShare, 0.1)]);
  // Active modes want the most walking that fits, so it outranks retracing and time fit.
  if (a.rankBy === 'walking') keys.push([round(b.walkingShare, 0.05), round(a.walkingShare, 0.05)]);
  keys.push(
    [round(a.retraceRatio, 0.1), round(b.retraceRatio, 0.1)],
    [round(timeFit(b.totalSec, b.availableSec), 0.05), round(timeFit(a.totalSec, a.availableSec), 0.05)],
  );
  for (const [x, y] of keys) {
    if (x !== y) return x - y;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
