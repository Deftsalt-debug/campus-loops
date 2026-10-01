import { describe, expect, it } from 'vitest';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import { decodeShare, encodeShare } from '../src/core/share';
import type { Dataset, PlanRequest } from '../src/core/types';
import demoJson from '../src/data/manipal-demo.json';
import { ist } from './helpers';

const campus = demoJson as unknown as Dataset;
const morning = ist('2026-10-02', '10:00');
const classBreak: PlanRequest = {
  startId: 'food_court_1', occasion: 'study_break', durationMin: 45,
  budgetInr: 0, pace: 'normal', requiredPlaceIds: ['central_library'],
  requireCafe: false, avoidSteps: false, rain: false, bufferMin: 10, backBy: '10:45',
};

describe('MIT Manipal student scenarios', () => {
  it('fits a free Food Court 1 library break and leaves ten minutes for reaching class', () => {
    const result = plan(campus, classBreak, morning);
    expect(result.plans.length).toBeGreaterThan(0);
    for (const walk of result.plans) {
      expect(walk.spendHighInr).toBe(0);
      expect(walk.bufferSec).toBe(600);
      expect(walk.totalSec).toBeLessThanOrEqual(45 * 60);
      expect(walk.totalSec - walk.bufferSec).toBeLessThanOrEqual(35 * 60);
      expect(walk.visits.some((v) => v.placeId === 'central_library')).toBe(true);
      expect(walk.visits.length).toBeLessThanOrEqual(2);
      const edges = new Map(campus.edges.map((edge) => [edge.id, edge]));
      let node = campus.starts.find((start) => start.id === classBreak.startId)!.nodeId;
      for (const id of walk.edgeIds) {
        const edge = edges.get(id)!;
        expect(edge.from).toBe(node);
        expect(edge.allowed).toBe(true);
        node = edge.to;
      }
      expect(node).toBe(walk.startNodeId);
    }
  });

  it('rejects that outing when class starts at 10:30, without relaxing the buffer', () => {
    const result = plan(campus, { ...classBreak, backBy: '10:30' }, morning);
    expect(result.context?.availableSec).toBe(30 * 60);
    expect(result.context?.deadlineReason).toBe('backBy');
    expect(result.plans).toEqual([]);
    expect(result.blockers[0].code).toBe('NOT_ENOUGH_TIME');
    expect(result.blockers[0].minNeededMin).toBeGreaterThan(30);
  });

  it('does not use a cafe price lower bound to promise a zero-budget meal', () => {
    const result = plan(campus, { ...classBreak, requiredPlaceIds: ['food_court_1'], requireCafe: true, durationMin: 60, backBy: '11:00' }, morning);
    expect(result.plans).toEqual([]);
    expect(result.blockers[0].code).toBe('OVER_BUDGET');
    expect(result.blockers[0].minSpendInr).toBeGreaterThan(0);
  });

  it('shares and rebuilds the same class-break route with its deadline and buffer intact', () => {
    const walk = plan(campus, classBreak, morning).plans[0];
    expect(walk).toBeDefined();
    const decoded = decodeShare(encodeShare({ datasetVersion: campus.datasetVersion, request: classBreak, planId: walk.id, at: morning.toISOString() }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.shared.request).toEqual(classBreak);
    expect(rebuildPlan(campus, decoded.shared.request, morning, decoded.shared.planId).plans).toEqual([walk]);
    const late = rebuildPlan(campus, decoded.shared.request, ist('2026-10-02', '10:46'), decoded.shared.planId);
    expect(late.plans).toEqual([]);
    expect(late.blockers[0].code).toBe('BACK_BY_PASSED');
  });

  it('requires a daylight preview after a late hostel return time', () => {
    const result = plan(campus, { ...classBreak, backBy: '22:00' }, ist('2026-10-02', '20:00'));
    expect(result.plans).toEqual([]);
    expect(['AFTER_SUNSET', 'OUTSIDE_WINDOW']).toContain(result.blockers[0].code);
  });
});
