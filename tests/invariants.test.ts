import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/planner/config';
import { OCCASION_IDS, OCCASIONS } from '../src/core/planner/occasions';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import type { Occasion, Pace, PlanRequest } from '../src/core/types';
import { fixture, ist } from './helpers';

// Every plan the planner returns must obey these, whatever the request.
// Times and costs are recomputed here independently of the planner code.

const ds = fixture();
const edges = new Map(ds.edges.map((e) => [e.id, e]));
const nodes = new Map(ds.nodes.map((n) => [n.id, n]));
const places = new Map(ds.places.map((p) => [p.id, p]));

function independentSeconds(edgeId: string, pace: Pace): number {
  const e = edges.get(edgeId)!;
  const climb = e.ascentMeters ?? Math.max(0, nodes.get(e.to)!.elevationM! - nodes.get(e.from)!.elevationM!);
  return e.meters / DEFAULT_CONFIG.paceMps[pace] + climb * DEFAULT_CONFIG.climbSecPerM + e.delaySeconds;
}

const durations = [30, 45, 60, 90];
const budgets = [0, 100, 200];
const occasions: Occasion[] = OCCASION_IDS;
const times = [ist('2026-10-01', '10:00'), ist('2026-10-01', '17:30'), ist('2026-10-04', '09:15')];

const cases: [string, PlanRequest, Date][] = [];
for (const startId of ['start_gate', 'start_lib'])
  for (const durationMin of durations)
    for (const budgetInr of budgets)
      for (const occasion of occasions)
        for (const rain of [false, true])
          for (const now of times) {
            const flags = [rain && 'rain', budgetInr >= 100 && 'cafe'].filter(Boolean).join('+');
            cases.push([
              `${startId} ${durationMin}min ₹${budgetInr} ${occasion} ${flags} @${now.toISOString()}`,
              {
                startId,
                durationMin,
                budgetInr,
                occasion,
                rain,
                requireCafe: budgetInr >= 100 && occasion === 'friends',
                avoidSteps: occasion === 'catchup' || occasion === 'solo',
                pace: durationMin >= 60 ? 'relaxed' : 'normal',
                requiredPlaceIds: occasion === 'guest' && durationMin === 90 ? ['p_tower'] : [],
              },
              now,
            ]);
          }

describe('plan invariants across the request matrix', () => {
  it('covers a meaningful number of plans', () => {
    const total = cases.reduce((n, [, r, now]) => n + plan(ds, r, now).plans.length, 0);
    expect(total).toBeGreaterThan(200);
  });

  it.each(cases)('%s', (_label, req, now) => {
    const res = plan(ds, req, now);
    // Either plans or an honest blocker, never neither.
    expect(res.plans.length > 0 || res.blockers.length > 0).toBe(true);
    expect(res.plans.length).toBeLessThanOrEqual(DEFAULT_CONFIG.maxResults);
    if (res.plans.length) expect(res.blockers).toEqual([]);

    const startNode = ds.starts.find((s) => s.id === req.startId)!.nodeId;
    for (const p of res.plans) {
      // Continuous walk that starts and ends at the start.
      let at = startNode;
      for (const id of p.edgeIds) {
        const e = edges.get(id)!;
        expect(e.from).toBe(at);
        expect(e.allowed).toBe(true);
        if (req.avoidSteps) expect(e.steps).toBe(false);
        at = e.to;
      }
      expect(at).toBe(startNode);

      // Time components add up and fit the deadline.
      const walk = p.edgeIds.reduce((s, id) => s + independentSeconds(id, req.pace), 0);
      expect(p.walkingSec).toBeCloseTo(walk, 6);
      expect(p.dwellSec).toBe(p.visits.reduce((s, v) => s + v.dwellSec, 0));
      expect(p.totalSec).toBeCloseTo(p.walkingSec + p.dwellSec + p.bufferSec, 6);
      expect(p.totalSec).toBeLessThanOrEqual(res.context!.availableSec);
      expect(res.context!.availableSec).toBeLessThanOrEqual(req.durationMin * 60);

      // Spend within budget, from checked prices only.
      expect(p.spendHighInr).toBeLessThanOrEqual(req.budgetInr);
      expect(p.spendHighInr).toBe(p.visits.reduce((s, v) => s + v.spendHighInr, 0));

      // Requirements.
      for (const id of req.requiredPlaceIds) expect(p.visits.map((v) => v.placeId)).toContain(id);
      if (req.requireCafe) expect(p.visits.some((v) => v.category === 'cafe')).toBe(true);

      // Every visit is to a schedulable place, in order, inside its hours.
      let lastArrive = -1;
      for (const v of p.visits) {
        const place = places.get(v.placeId)!;
        expect(place.hoursStatus).not.toBe('unknown');
        expect(place.spendHighInr).not.toBeNull();
        expect(v.arriveOffsetSec).toBeGreaterThanOrEqual(lastArrive);
        lastArrive = v.arriveOffsetSec;
        if (req.rain && v.dwellSec > 0 && !req.requiredPlaceIds.includes(v.placeId)) {
          expect(place.tags).toContain('sheltered');
        }
      }
      // Distinct stops, within the mode's stop cap.
      expect(new Set(p.visits.map((v) => v.placeId)).size).toBe(p.visits.length);
      expect(p.visits.length).toBeLessThanOrEqual(OCCASIONS[req.occasion].maxStops ?? DEFAULT_CONFIG.maxStops);

      // A shared link to this plan rebuilds exactly the same plan at the same moment.
      expect(rebuildPlan(ds, req, now, p.id).plans).toEqual([p]);
    }
  });
});
