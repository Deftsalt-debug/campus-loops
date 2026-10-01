import { describe, expect, it } from 'vitest';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import type { PlanRequest } from '../src/core/types';
import { ist, tinyDataset, twoWay } from './helpers';

const now = ist('2026-10-01', '10:00');
const request: PlanRequest = {
  startId: 'start', occasion: 'friends', durationMin: 60, budgetInr: 100,
  pace: 'normal', requiredPlaceIds: ['cafe'], requireCafe: false, avoidSteps: false,
  rain: false, dwellOverridesMin: { cafe: 0 },
};
const campus = () => tinyDataset(['S', 'A', 'B'], [
  ...twoWay('sa', 'S', 'A', 200), ...twoWay('ab', 'A', 'B', 100),
], [
  { id: 'cafe', nodeId: 'A', category: 'cafe', spendLowInr: 50, spendHighInr: 100 },
  { id: 'second', nodeId: 'B', category: 'cafe', spendLowInr: 40, spendHighInr: 80 },
]);

describe('zero-minute pass-bys', () => {
  it('does not charge for passing a café and keeps itinerary costs consistent', () => {
    const result = plan(campus(), { ...request, budgetInr: 0 }, now);
    expect(result.plans.length).toBeGreaterThan(0);
    for (const walk of result.plans) {
      expect(walk.spendHighInr).toBe(0);
      expect(walk.visits.find((v) => v.placeId === 'cafe')).toMatchObject({ dwellSec: 0, spendLowInr: 0, spendHighInr: 0 });
    }
  });
  it('requires a second positive-duration café visit when the required café is a pass-by', () => {
    const result = plan(campus(), { ...request, requireCafe: true }, now);
    expect(result.plans.length).toBeGreaterThan(0);
    for (const walk of result.plans) {
      expect(walk.visits.find((v) => v.placeId === 'second')?.dwellSec).toBeGreaterThan(0);
      expect(walk.spendHighInr).toBe(80);
    }
  });
  it('blocks a café requirement when every café is a pass-by', () => {
    const result = plan(campus(), { ...request, requireCafe: true, dwellOverridesMin: { cafe: 0, second: 0 } }, now);
    expect(result.plans).toEqual([]);
    expect(result.blockers[0].code).toBe('NO_CAFE');
  });
  it('counts a needed café against the mode stop limit', () => {
    const result = plan(campus(), { ...request, occasion: 'meeting', requiredPlaceIds: ['cafe', 'second'], dwellOverridesMin: { cafe: 0, second: 0 }, requireCafe: true }, now);
    expect(result.plans).toEqual([]);
    expect(result.blockers[0].code).toBe('TOO_MANY_REQUIRED');
  });
  it('applies the same pass-by spend and café rules to curated rebuilds', () => {
    const ds = campus();
    ds.curatedWalks = [{ id: 'curated', name: 'Café circuit', startNodeId: 'S', edgeIds: ['sa:f', 'sa:r'], stops: [{ placeId: 'cafe', afterEdge: 1 }], tags: [], verifiedAt: '2026-09-20' }];
    const free = rebuildPlan(ds, { ...request, budgetInr: 0 }, now, 'c:curated');
    expect(free.plans[0]?.spendHighInr).toBe(0);
    expect(rebuildPlan(ds, { ...request, requireCafe: true }, now, 'c:curated').blockers[0].code).toBe('PLAN_OUTDATED');
  });
});

describe('rain-aware return feasibility', () => {
  const ds = tinyDataset(['S', 'A', 'B'], [
    ...twoWay('sa', 'S', 'A', 700, { covered: true }),
    ['ab', 'A', 'B', 300], ['bs', 'B', 'S', 350],
  ], [{ id: 'cafe', nodeId: 'A', category: 'cafe', dwellDefaultMin: 2, tags: ['sheltered'] }]);
  const rainRequest: PlanRequest = { ...request, durationMin: 30, pace: 'relaxed', rain: true, dwellOverridesMin: {}, requireCafe: true };
  it('offers a feasible loop even when the sheltered return exceeds the deadline', () => {
    const result = plan(ds, rainRequest, now);
    expect(result.plans[0]?.id).toBe('l:cafe');
    expect(result.plans[0]?.totalSec).toBe(1770);
    expect(rebuildPlan(ds, rainRequest, now, 'l:cafe').plans).toEqual(result.plans);
  });
  it('uses the quicker loop when explaining the minimum time needed in rain', () => {
    const result = plan(ds, { ...rainRequest, backBy: '10:29' }, now);
    expect(result.blockers[0]).toMatchObject({ code: 'NOT_ENOUGH_TIME', minNeededMin: 30 });
  });
});
