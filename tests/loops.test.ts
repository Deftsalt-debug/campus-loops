import { describe, expect, it } from 'vitest';
import { planGeometry } from '../src/core/geo';
import { DEFAULT_CONFIG } from '../src/core/planner/config';
import { OCCASION_IDS, OCCASIONS } from '../src/core/planner/occasions';
import { plan, rebuildPlan } from '../src/core/planner/plan';
import type { Dataset, PlanRequest } from '../src/core/types';
import demoJson from '../src/data/manipal-demo.json';
import { ist, tinyDataset, twoWay } from './helpers';

const demo = demoJson as unknown as Dataset;
const MIDDAY = ist('2026-10-01', '13:00');
const NO_LOOPS = { ...DEFAULT_CONFIG, loopMaxDetour: 1 };

const defaultsFor = (startId: string, occasion: PlanRequest['occasion']): PlanRequest => ({
  startId,
  occasion,
  ...OCCASIONS[occasion].defaults,
  requiredPlaceIds: [],
  avoidSteps: false,
  rain: false,
});

/**
 * A block: S—A (200 m), then A—B (100 m), B—C (variable), C—S (200 m). The
 * quickest way back from the café at A retraces S—A (200 m); the loop home
 * A→B→C→S is 300 m + B—C, so it qualifies while that's ≤ 2 × 200 m.
 */
function squareBlock(bcMeters: number): Dataset {
  return tinyDataset(
    ['S', 'A', 'B', 'C'],
    [...twoWay('sa', 'S', 'A', 200), ...twoWay('ab', 'A', 'B', 100), ...twoWay('bc', 'B', 'C', bcMeters), ...twoWay('cs', 'C', 'S', 200)],
    [{ id: 'cafe', name: 'Corner Café', nodeId: 'A', category: 'cafe', spendLowInr: 50, spendHighInr: 100, hoursStatus: 'always' }],
  );
}
const squareRequest: PlanRequest = {
  startId: 'start', occasion: 'friends', durationMin: 60, budgetInr: 200, pace: 'relaxed',
  requiredPlaceIds: [], requireCafe: true, avoidSteps: false, rain: false,
};

describe('loop returns', () => {
  it('goes home a different way when the detour is reasonable', () => {
    const [best] = plan(squareBlock(50), squareRequest, MIDDAY).plans;
    expect(best.id).toBe('l:cafe');
    expect(best.outAndBack).toBe(false);
    expect(best.retraceRatio).toBe(0);
    // Out S→A, then home A→B→C→S: a closed loop, no segment walked twice.
    expect(best.edgeIds).toEqual(['sa:f', 'ab:f', 'bc:f', 'cs:f']);
  });

  it('keeps the quickest way home when the loop would more than double it', () => {
    // Loop home would be 300 + 150 = 450 m, more than twice the 200 m direct return.
    const [best] = plan(squareBlock(150), squareRequest, MIDDAY).plans;
    expect(best.id).toBe('g:cafe');
    expect(best.outAndBack).toBe(true);
  });

  it('never lets a loop break the time limit', () => {
    // At 1 m/s with an 18-minute stop and 5-minute buffer: out-and-back (400 m) ≈ 29.7 min, loop (550 m) ≈ 32.2 min.
    const res = plan(squareBlock(50), { ...squareRequest, durationMin: 30, dwellOverridesMin: { cafe: 18 } }, MIDDAY);
    expect(res.plans.map((p) => p.id)).toEqual(['g:cafe']);
  });

  it('rebuilds a shared loop exactly, and refuses it once it no longer fits', () => {
    const [loop] = plan(squareBlock(50), squareRequest, MIDDAY).plans;
    expect(loop.id).toBe('l:cafe');
    expect(rebuildPlan(squareBlock(50), squareRequest, MIDDAY, loop.id).plans).toEqual([loop]);
    const tight = rebuildPlan(squareBlock(50), { ...squareRequest, durationMin: 30, dwellOverridesMin: { cafe: 18 } }, MIDDAY, loop.id);
    expect(tight.blockers[0].code).toBe('PLAN_OUTDATED');
  });

  it('roughly halves out-and-back suggestions on the real campus network', () => {
    const shares = [DEFAULT_CONFIG, NO_LOOPS].map((config) => {
      let plans = 0;
      let outAndBack = 0;
      for (const s of demo.starts) {
        for (const occasion of OCCASION_IDS) {
          for (const p of plan(demo, defaultsFor(s.id, occasion), MIDDAY, config).plans) {
            plans++;
            if (p.outAndBack) outAndBack++;
          }
        }
      }
      return outAndBack / plans;
    });
    const [withLoops, without] = shares;
    expect(without).toBeGreaterThan(0.7);
    expect(withLoops).toBeLessThan(without * 0.6);
  });

  it('draws every loop as one continuous closed path', () => {
    for (const s of demo.starts) {
      for (const p of plan(demo, defaultsFor(s.id, 'date'), MIDDAY).plans.filter((x) => x.id.startsWith('l:'))) {
        const route = planGeometry(demo, p);
        expect(route.path[0]).toEqual(route.path.at(-1));
        expect(rebuildPlan(demo, defaultsFor(s.id, 'date'), MIDDAY, p.id).plans).toEqual([p]);
      }
    }
  });
});

describe('real outings only', () => {
  it('does not suggest sitting at the place you started from', () => {
    for (const s of demo.starts) {
      const startNode = demo.nodes.find((n) => n.id === s.nodeId)!;
      for (const occasion of OCCASION_IDS) {
        for (const p of plan(demo, defaultsFor(s.id, occasion), MIDDAY).plans) {
          for (const v of p.visits.filter((x) => x.dwellSec > 0)) {
            const place = demo.places.find((x) => x.id === v.placeId)!;
            expect(place.nodeId === startNode.id, `${s.id} ${occasion}: ${p.name}`).toBe(false);
          }
        }
      }
    }
  });

  it('still allows a nearby place when you explicitly require it', () => {
    const ds = tinyDataset(['S', 'P', 'Q'], [...twoWay('sp', 'S', 'P', 30), ...twoWay('pq', 'P', 'Q', 500)], [
      { id: 'bench', nodeId: 'P' },
      { id: 'far', nodeId: 'Q' },
    ]);
    const req: PlanRequest = { ...squareRequest, requireCafe: false, budgetInr: 0, occasion: 'catchup' };
    expect(plan(ds, req, MIDDAY).plans.every((p) => !p.visits.some((v) => v.placeId === 'bench' && p.visits.length === 1))).toBe(true);
    expect(plan(ds, { ...req, requiredPlaceIds: ['bench'] }, MIDDAY).plans.length).toBeGreaterThan(0);
  });
});

describe('mode defaults', () => {
  // Starting at a food court, a study break's nearest food is the food court itself,
  // which isn't an outing; that pairing is the one known, honest gap.
  const knownGaps = new Set(['food_court_2:study_break']);

  it.each(demo.starts.flatMap((s) => OCCASION_IDS.map((o) => [s.id, o] as const)))('finds a walk from %s with the %s defaults', (startId, occasion) => {
    const res = plan(demo, defaultsFor(startId, occasion), MIDDAY);
    if (knownGaps.has(`${startId}:${occasion}`)) {
      expect(res.blockers[0]?.minNeededMin).toBeGreaterThan(OCCASIONS[occasion].defaults.durationMin);
    } else {
      expect(res.plans.length, res.blockers[0]?.message).toBeGreaterThan(0);
    }
  });
});
