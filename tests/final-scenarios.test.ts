import { describe, expect, it } from 'vitest';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import { OCCASION_IDS, OCCASIONS } from '../src/core/planner/occasions';
import { DEFAULT_CONFIG } from '../src/core/planner/config';
import { decodeShare, encodeShare } from '../src/core/share';
import type { Dataset, Occasion, Plan, PlanRequest } from '../src/core/types';
import demoJson from '../src/data/manipal-demo.json';

const dataset = demoJson as unknown as Dataset;
const morning = new Date('2026-10-02T10:00:00+05:30');
const baseRequest: PlanRequest = {
  startId: dataset.starts[0].id, occasion: 'friends', durationMin: 60, budgetInr: 200,
  requiredPlaceIds: [], requireCafe: false, pace: 'normal', rain: false, avoidSteps: false,
};

describe('untrusted occasion values', () => {
  it.each(['constructor', 'toString', '__proto__'])('rejects inherited object property %s in a shared link and direct request', (value) => {
    const request = { ...baseRequest, occasion: value as Occasion };
    const hash = encodeShare({ datasetVersion: dataset.datasetVersion, planId: 'g:student_plaza', request });
    expect(decodeShare(hash)).toMatchObject({ ok: false, reason: 'This link has an invalid occasion.' });
    expect(plan(dataset, request, morning)).toMatchObject({ plans: [], blockers: [{ code: 'INVALID_INPUT' }] });
  });
});

interface Scenario {
  name: string;
  at: string;
  patch: Partial<PlanRequest>;
  mustBlock?: boolean;
}

const scenarios: Scenario[] = [
  { name: 'mode defaults', at: '2026-10-02T10:00:00+05:30', patch: {} },
  { name: 'free short break', at: '2026-10-02T10:00:00+05:30', patch: { durationMin: 30, budgetInr: 0, requireCafe: false } },
  { name: 'tight food budget', at: '2026-10-02T10:00:00+05:30', patch: { budgetInr: 49, requireCafe: true } },
  { name: 'class deadline with buffer', at: '2026-10-02T10:00:00+05:30', patch: { durationMin: 60, backBy: '10:30', bufferMin: 10 } },
  { name: 'buffer exceeds time to class', at: '2026-10-02T10:00:00+05:30', patch: { backBy: '10:10', bufferMin: 15 }, mustBlock: true },
  { name: 'rain preference', at: '2026-10-02T10:00:00+05:30', patch: { durationMin: 90, budgetInr: 300, rain: true } },
  { name: 'avoid steps', at: '2026-10-02T10:00:00+05:30', patch: { durationMin: 90, budgetInr: 300, avoidSteps: true } },
  { name: 'rain and steps with fractional buffer', at: '2026-10-02T10:00:00+05:30', patch: { rain: true, avoidSteps: true, bufferMin: 7.5 } },
  { name: 'free required pass-bys', at: '2026-10-02T10:00:00+05:30', patch: {
    durationMin: 90, budgetInr: 0, requireCafe: false, requiredPlaceIds: ['food_court_1', 'student_plaza'],
    dwellOverridesMin: { food_court_1: 0, student_plaza: 0 },
  } },
  { name: 'short required stop without buffer', at: '2026-10-02T10:00:00+05:30', patch: {
    durationMin: 60, requireCafe: false, requiredPlaceIds: ['food_court_2'], bufferMin: 0, dwellOverridesMin: { food_court_2: 2.5 },
  } },
  { name: 'passing food court still needs a cafe stop', at: '2026-10-02T10:00:00+05:30', patch: {
    durationMin: 90, budgetInr: 300, requireCafe: true, requiredPlaceIds: ['food_court_2'], dwellOverridesMin: { food_court_2: 0 },
  } },
  { name: 'near evening deadline', at: '2026-10-02T17:35:00+05:30', patch: { durationMin: 90, budgetInr: 300, backBy: '18:00', bufferMin: 10 } },
  { name: 'passed class deadline', at: '2026-10-02T10:00:00+05:30', patch: { backBy: '09:59' }, mustBlock: true },
  { name: 'before supported hours', at: '2026-10-02T06:00:00+05:30', patch: {}, mustBlock: true },
  { name: 'after supported hours', at: '2026-10-02T20:00:00+05:30', patch: {}, mustBlock: true },
  { name: 'Sunday morning', at: '2026-10-04T09:15:00+05:30', patch: {} },
];

const edges = new Map(dataset.edges.map((edge) => [edge.id, edge]));
const nodes = new Map(dataset.nodes.map((node) => [node.id, node]));
const places = new Map(dataset.places.map((place) => [place.id, place]));
const clockSeconds = (hhmm: string) => {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 3600 + minute * 60;
};

/** Independently replay each edge and stop, instead of trusting reported totals. */
function checkPlan(walk: Plan, request: PlanRequest, now: Date) {
  const start = dataset.starts.find((candidate) => candidate.id === request.startId)!;
  expect(walk.startNodeId).toBe(start.nodeId);
  expect(walk.edgeIds.length).toBeGreaterThan(0);
  const nodeAt = [start.nodeId];
  const walkingAt = [0];
  let distance = 0;
  for (const id of walk.edgeIds) {
    const edge = edges.get(id)!;
    expect(edge).toBeDefined();
    expect(edge.from).toBe(nodeAt[nodeAt.length - 1]);
    expect(edge.allowed).toBe(true);
    if (request.avoidSteps) expect(edge.steps).toBe(false);
    nodeAt.push(edge.to);
    const fromElevation = nodes.get(edge.from)?.elevationM;
    const toElevation = nodes.get(edge.to)?.elevationM;
    const ascent = edge.ascentMeters ?? (fromElevation !== undefined && toElevation !== undefined ? Math.max(0, toElevation - fromElevation) : 0);
    const seconds = edge.meters / DEFAULT_CONFIG.paceMps[request.pace] + ascent * DEFAULT_CONFIG.climbSecPerM + edge.delaySeconds;
    walkingAt.push(walkingAt[walkingAt.length - 1] + seconds);
    distance += edge.meters;
  }
  expect(nodeAt[nodeAt.length - 1]).toBe(start.nodeId);
  expect(distance).toBeGreaterThan(0);
  expect(walk.distanceM).toBeCloseTo(distance, 6);
  expect(walk.walkingSec).toBeGreaterThan(0);
  expect(walk.walkingSec).toBeCloseTo(walkingAt[walkingAt.length - 1], 6);

  const local = new Date(now.getTime() + 330 * 60_000);
  const nowSec = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
  let dwell = 0;
  let low = 0;
  let high = 0;
  let lastEdge = 0;
  for (const visit of walk.visits) {
    const place = places.get(visit.placeId)!;
    expect(place).toBeDefined();
    expect(place.hoursStatus).not.toBe('unknown');
    expect(place.spendLowInr).not.toBeNull();
    expect(place.spendHighInr).not.toBeNull();
    const afterEdge = visit.afterEdge!;
    expect(Number.isInteger(afterEdge)).toBe(true);
    expect(afterEdge).toBeGreaterThanOrEqual(lastEdge);
    expect(nodeAt[afterEdge]).toBe(place.nodeId);
    expect(visit.arriveOffsetSec).toBeCloseTo(walkingAt[afterEdge] + dwell, 6);
    expect(visit.dwellSec).toBe((request.dwellOverridesMin?.[place.id] ?? place.dwellDefaultMin) * 60);
    const arrival = nowSec + visit.arriveOffsetSec;
    const departure = arrival + visit.dwellSec;
    if (place.hoursStatus === 'verified') {
      expect(place.verifiedOpenWindows.some((window) => window.day === local.getUTCDay() &&
        clockSeconds(window.start) <= arrival && departure <= clockSeconds(window.end))).toBe(true);
    }
    if (request.rain && visit.dwellSec > 0 && !request.requiredPlaceIds.includes(place.id)) {
      expect(place.tags).toContain('sheltered');
    }
    const expectedLow = visit.dwellSec === 0 ? 0 : place.spendLowInr!;
    const expectedHigh = visit.dwellSec === 0 ? 0 : place.spendHighInr!;
    expect(visit.spendLowInr).toBe(expectedLow);
    expect(visit.spendHighInr).toBe(expectedHigh);
    low += expectedLow;
    high += expectedHigh;
    dwell += visit.dwellSec;
    lastEdge = afterEdge;
  }
  expect(walk.spendLowInr).toBe(low);
  expect(walk.spendHighInr).toBe(high);
  expect(high).toBeLessThanOrEqual(request.budgetInr);
  expect(walk.dwellSec).toBe(dwell);
  expect(walk.bufferSec).toBe((request.bufferMin ?? DEFAULT_CONFIG.defaultBufferMin) * 60);
  expect(walk.totalSec).toBeCloseTo(walkingAt[walkingAt.length - 1] + dwell + walk.bufferSec, 6);
  expect(walk.totalSec).toBeLessThanOrEqual(request.durationMin * 60);
  expect(nowSec + walk.totalSec).toBeLessThanOrEqual(clockSeconds(dataset.supportedWindow.end));
  if (request.backBy) expect(nowSec + walk.totalSec).toBeLessThanOrEqual(clockSeconds(request.backBy));
  for (const id of request.requiredPlaceIds) expect(walk.visits.some((visit) => visit.placeId === id)).toBe(true);
  if (request.requireCafe) expect(walk.visits.some((visit) => visit.category === 'cafe' && visit.dwellSec > 0)).toBe(true);
  expect(new Set(walk.visits.map((visit) => visit.placeId)).size).toBe(walk.visits.length);
  expect(walk.visits.length).toBeLessThanOrEqual(OCCASIONS[request.occasion].maxStops ?? DEFAULT_CONFIG.maxStops);

  const shared = { datasetVersion: dataset.datasetVersion, request, planId: walk.id, at: now.toISOString() };
  const decoded = decodeShare(encodeShare(shared));
  expect(decoded).toEqual({ ok: true, shared });
  if (!decoded.ok) throw new Error('A returned plan could not be shared');
  expect(rebuildPlan(dataset, decoded.shared.request, new Date(decoded.shared.at!), decoded.shared.planId).plans).toEqual([walk]);
}

describe('final real-campus scenario audit', () => {
  it.each(dataset.starts.flatMap((start) => OCCASION_IDS.map((occasion) => [start.id, occasion] as const)))(
    'replays sixteen scenarios from %s for %s', (startId, occasion) => {
      let checkedWalks = 0;
      for (const scenario of scenarios) {
        const request = { ...baseRequest, ...OCCASIONS[occasion].defaults, startId, occasion, ...scenario.patch };
        const now = new Date(scenario.at);
        const result = plan(dataset, request, now);
        expect(result.plans.length > 0 || result.blockers.length > 0, scenario.name).toBe(true);
        if (scenario.mustBlock) expect(result.plans.length, scenario.name).toBe(0);
        expect(result.plans.length, scenario.name).toBeLessThanOrEqual(DEFAULT_CONFIG.maxResults);
        for (const walk of result.plans) {
          expect(result.blockers, scenario.name).toEqual([]);
          expect(walk.totalSec, scenario.name).toBeLessThanOrEqual(result.context!.availableSec);
          checkPlan(walk, request, now);
          checkedWalks++;
        }
      }
      expect(checkedWalks, 'Every start and occasion must yield at least one usable walk across the scenarios').toBeGreaterThan(0);
    },
  );
});
