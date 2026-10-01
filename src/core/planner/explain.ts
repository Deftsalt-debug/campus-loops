import type { Occasion, Plan, PlaceCategory } from '../types';
import type { Itinerary, RequestContext } from './context';
import { matchedPhrases, OCCASIONS, occasionPoints } from './occasions';
import type { ScoreParts } from './score';

export interface PathMetrics {
  distanceM: number;
  coveredShare: number;
  retraceRatio: number;
  usesSteps: boolean;
  segmentIds: Set<string>;
}

export function pathMetrics(it: Itinerary): PathMetrics {
  const counts = new Map<string, number>();
  for (const e of it.edges) counts.set(e.segmentId, (counts.get(e.segmentId) ?? 0) + 1);
  let distanceM = 0;
  let coveredM = 0;
  let retracedM = 0;
  for (const e of it.edges) {
    distanceM += e.meters;
    if (e.covered) coveredM += e.meters;
    if (counts.get(e.segmentId)! > 1) retracedM += e.meters;
  }
  return {
    distanceM,
    // A walk with no distance has nothing uncovered and nothing retraced.
    coveredShare: distanceM > 0 ? coveredM / distanceM : 1,
    retraceRatio: distanceM > 0 ? retracedM / distanceM : 0,
    usesSteps: it.edges.some((e) => e.steps),
    segmentIds: new Set(counts.keys()),
  };
}

/**
 * Average occasion points over visits where people actually stop, counting a
 * curated walk's own tags as one more entry. Zero-dwell waypoints shape the
 * route but don't dilute the average; they only count when nothing else does.
 */
export function itineraryOccasion(it: Itinerary, occasion: Occasion): number {
  const stops = it.visits.filter((v) => v.dwellSec > 0);
  const scored = stops.length > 0 || it.kind === 'curated' ? stops : it.visits;
  const points = scored.map((v) => occasionPoints(v.place.category, v.place.tags, occasion));
  if (it.kind === 'curated') points.push(occasionPoints('waypoint', it.walkTags, occasion));
  return points.length ? points.reduce((a, b) => a + b, 0) / points.length : 0;
}

export function scoreParts(it: Itinerary, m: PathMetrics, occasion: Occasion, rain: boolean, availableSec: number): ScoreParts {
  return {
    occasion: itineraryOccasion(it, occasion),
    retraceRatio: m.retraceRatio,
    totalSec: it.totalSec,
    availableSec,
    coveredShare: m.coveredShare,
    rain,
    walkingShare: availableSec > 0 ? it.walkingSec / availableSec : 0,
    rankBy: OCCASIONS[occasion].rank,
    id: it.id,
  };
}

const PHRASES: Record<Exclude<PlaceCategory, 'waypoint'>, [string, string]> = {
  cafe: ['a café stop', 'café stops'],
  seating: ['a seated break', 'seated breaks'],
  landmark: ['a landmark visit', 'landmark visits'],
};
const NUMBERS = ['', 'one', 'two', 'three'];

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function stopPhrases(it: Itinerary): string[] {
  const counts = new Map<keyof typeof PHRASES, number>();
  for (const v of it.visits) {
    if (v.place.category === 'waypoint' || v.dwellSec === 0) continue;
    counts.set(v.place.category, (counts.get(v.place.category) ?? 0) + 1);
  }
  return (Object.keys(PHRASES) as (keyof typeof PHRASES)[])
    .filter((c) => counts.has(c))
    .map((c) => (counts.get(c)! === 1 ? PHRASES[c][0] : `${NUMBERS[counts.get(c)!]} ${PHRASES[c][1]}`));
}

/** A name describing what the outing contains, e.g. "Short walk with a café stop". */
export function planName(it: Itinerary, m: PathMetrics, outAndBackRetrace: number): string {
  const suffix = m.retraceRatio > outAndBackRetrace ? ' (out-and-back)' : '';
  if (it.walkName) return it.walkName + suffix;
  const minutes = it.totalSec / 60;
  const walk = minutes < 35 ? 'Short walk' : minutes > 70 ? 'Long walk' : 'Walk';
  const phrases = stopPhrases(it);
  if (phrases.length) return `${walk} with ${joinList(phrases)}${suffix}`;
  const via = it.visits.map((v) => v.place.name);
  return `${walk} via ${joinList(via)}${suffix}`;
}

function rupees(low: number, high: number): string {
  return low === high ? `₹${high}` : `₹${low}–${high}`;
}

/** Why the plan suits the chosen occasion, e.g. "Good for a date: a scenic spot and somewhere cozy…". */
export function occasionFit(it: Itinerary, occasion: Occasion): string {
  const profile = OCCASIONS[occasion];
  if (profile.rank === 'walking') {
    const share = it.totalSec > 0 ? Math.round((it.walkingSec / it.totalSec) * 100) : 0;
    return `${profile.label}: ${share}% of the time is walking.`;
  }
  const stops = it.visits.filter((v) => v.dwellSec > 0).map((v) => v.place);
  const phrases = matchedPhrases(it.kind === 'curated' ? [...stops, { category: 'waypoint', tags: it.walkTags }] : stops, occasion);
  return phrases.length ? `${profile.label}: ${joinList(phrases)}.` : '';
}

/** One useful sentence about why this plan fits. */
export function planExplanation(it: Itinerary, m: PathMetrics, availableSec: number, rain: boolean): string {
  const parts: string[] = [];
  const cafes = it.visits.filter((v) => v.place.category === 'cafe');
  if (cafes.length) parts.push(`a café (about ${rupees(it.spendLowInr, it.spendHighInr)} per person)`);
  if (it.visits.some((v) => v.place.category === 'seating' && v.dwellSec > 0)) parts.push('a seated break');
  const spareMin = Math.floor((availableSec - it.totalSec) / 60);
  const spare = spareMin > 0 ? `${spareMin} min of spare time` : 'no spare time beyond the buffer';
  const rainNote = rain ? ` ${Math.round(m.coveredShare * 100)}% of the walking is covered.` : '';
  if (!parts.length) {
    const free = it.spendHighInr === 0 ? 'No purchase needed' : `Estimated ${rupees(it.spendLowInr, it.spendHighInr)} per person`;
    return `${free}, with ${spare}.${rainNote}`;
  }
  return `Includes ${joinList(parts)}, with ${spare}.${rainNote}`;
}

const DAY_MS = 86_400_000;

/** Turn a feasible itinerary into the user-facing plan with names, warnings and metrics. */
export function toPlan(
  it: Itinerary,
  m: PathMetrics,
  ctx: RequestContext,
  opts: {
    availableSec: number;
    rain: boolean;
    now: Date;
    staleAfterDays: number;
    outAndBackRetrace: number;
    occasion: Occasion;
  },
): Plan {
  const warnings: string[] = [];
  if (m.usesSteps) warnings.push('Includes steps.');
  // Covered share in rain mode is already stated in the explanation.
  for (const v of it.visits) {
    if (opts.rain && v.dwellSec > 0 && !v.place.tags.includes('sheltered')) {
      warnings.push(`${v.place.name} is not sheltered.`);
    }
  }
  const placeholderHours = it.visits.filter((v) => v.place.hoursSource === 'placeholder' && v.dwellSec > 0);
  const placeholderPrices = it.visits.filter((v) => v.place.spendSource === 'placeholder');
  if (placeholderPrices.length) warnings.push(`Price estimates are placeholders, not checked: ${placeholderPrices.map((v) => v.place.name).join(', ')}.`);
  if (placeholderHours.length) warnings.push(`Opening hours are placeholders, not checked: ${placeholderHours.map((v) => v.place.name).join(', ')}.`);
  const osmHours = it.visits.filter((v) => v.place.hoursSource === 'osm' && v.place.hoursStatus === 'verified');
  if (osmHours.length) warnings.push(`Hours from OpenStreetMap, not checked in person: ${osmHours.map((v) => v.place.name).join(', ')}.`);
  const checkedDates = [...it.edges.map((e) => e.verifiedAt), ...it.visits.map((v) => v.place.verifiedAt)].sort();
  const dataCheckedOn = checkedDates[0] ?? '';
  if (dataCheckedOn && opts.now.getTime() - Date.parse(dataCheckedOn) > opts.staleAfterDays * DAY_MS) {
    warnings.push(`Some path or place details were last checked on ${dataCheckedOn}.`);
  }

  return {
    id: it.id,
    kind: it.kind,
    name: planName(it, m, opts.outAndBackRetrace),
    fit: occasionFit(it, opts.occasion),
    explanation: planExplanation(it, m, opts.availableSec, opts.rain),
    startNodeId: ctx.startNode,
    edgeIds: it.edges.map((e) => e.id),
    visits: it.visits.map((v) => ({
      placeId: v.place.id,
      name: v.place.name,
      category: v.place.category,
      arriveOffsetSec: v.arriveSec,
      dwellSec: v.dwellSec,
      spendLowInr: v.place.spendLowInr ?? 0,
      spendHighInr: v.place.spendHighInr ?? 0,
    })),
    walkingSec: it.walkingSec,
    dwellSec: it.dwellSec,
    bufferSec: ctx.bufferSec,
    totalSec: it.totalSec,
    availableSec: opts.availableSec,
    distanceM: m.distanceM,
    spendLowInr: it.spendLowInr,
    spendHighInr: it.spendHighInr,
    coveredShare: m.coveredShare,
    retraceRatio: m.retraceRatio,
    outAndBack: m.retraceRatio > opts.outAndBackRetrace,
    usesSteps: m.usesSteps,
    dataCheckedOn,
    warnings,
  };
}
