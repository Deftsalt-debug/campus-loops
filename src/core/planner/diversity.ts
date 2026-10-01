export interface DiversityItem {
  stopKey: string;
  segmentIds: Set<string>;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Walk the ranked list and keep an item only if it is not a near-duplicate of
 * one already kept: same set of stops (in any order), or physical path
 * overlap above `maxOverlap`. Returns fewer than `limit` items rather than padding.
 */
export function pickDiverse<T extends DiversityItem>(ranked: T[], limit: number, maxOverlap: number): T[] {
  const kept: T[] = [];
  for (const item of ranked) {
    if (kept.length >= limit) break;
    const duplicate = kept.some(
      (k) => k.stopKey === item.stopKey || jaccard(k.segmentIds, item.segmentIds) > maxOverlap,
    );
    if (!duplicate) kept.push(item);
  }
  return kept;
}
