import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/planner/config';
import { plan } from '../src/core/planner/plan';
import { OCCASION_IDS, OCCASIONS } from '../src/core/planner/occasions';
import { compareScores, occasionPoints, timeFit } from '../src/core/planner/score';
import type { Dataset, PlanRequest } from '../src/core/types';
import { fixture, ist, tinyDataset, twoWay } from './helpers';

const THU_10AM = ist('2026-10-01', '10:00');

const request = (overrides: Partial<PlanRequest> = {}): PlanRequest => ({
  startId: 'start_gate',
  durationMin: 60,
  budgetInr: 150,
  occasion: 'friends',
  requiredPlaceIds: [],
  requireCafe: false,
  pace: 'normal',
  avoidSteps: false,
  rain: false,
  ...overrides,
});

/**
 * Start S and one seating place P, 600 m apart both ways. At relaxed pace
 * (1 m/s) with a 10-minute stop and 5-minute buffer the only plan is exactly
 * 10 + 10 + 10 + 5 = 35 minutes.
 */
function exactDataset(): Dataset {
  return tinyDataset(['S', 'P'], twoWay('sp', 'S', 'P', 600), [{ id: 'bench', name: 'Bench', nodeId: 'P' }]);
}
const exactRequest = (overrides: Partial<PlanRequest> = {}) =>
  request({ startId: 'start', pace: 'relaxed', durationMin: 35, budgetInr: 0, ...overrides });

describe('hard limits', () => {
  it('accepts a plan exactly at the duration limit', () => {
    const res = plan(exactDataset(), exactRequest(), THU_10AM);
    expect(res.plans).toHaveLength(1);
    expect(res.plans[0].totalSec).toBe(35 * 60);
  });

  it('rejects when extra dwell pushes the plan over, and reports the real minimum', () => {
    const res = plan(exactDataset(), exactRequest({ dwellOverridesMin: { bench: 11 } }), THU_10AM);
    expect(res.plans).toEqual([]);
    expect(res.blockers[0]).toMatchObject({ code: 'NOT_ENOUGH_TIME', minNeededMin: 36 });
    expect(res.blockers[0].message).toContain('Try 36 minutes');
  });

  it('reports the calculated minimum duration when time is too short', () => {
    const res = plan(exactDataset(), exactRequest({ durationMin: 30 }), THU_10AM);
    expect(res.blockers[0]).toMatchObject({ code: 'NOT_ENOUGH_TIME', minNeededMin: 35 });
  });

  it('accepts spend exactly at the budget', () => {
    const res = plan(fixture(), request({ budgetInr: 120, requireCafe: true }), THU_10AM);
    expect(res.plans.some((p) => p.spendHighInr === 120)).toBe(true);
    expect(res.plans.every((p) => p.spendHighInr <= 120)).toBe(true);
  });

  it('reports the cheapest option when the budget is too low', () => {
    const res = plan(fixture(), request({ budgetInr: 30, requireCafe: true }), THU_10AM);
    expect(res.blockers[0]).toMatchObject({ code: 'OVER_BUDGET', minSpendInr: 60 });
  });

  it('only uses free stops at ₹0', () => {
    const res = plan(fixture(), request({ budgetInr: 0 }), THU_10AM);
    expect(res.plans.length).toBeGreaterThan(0);
    expect(res.plans.every((p) => p.spendHighInr === 0 && p.visits.every((v) => v.category !== 'cafe'))).toBe(true);
  });
});

describe('required places and the café requirement', () => {
  it('fails honestly when there is no way back from a stop', () => {
    const ds = tinyDataset(['S', 'P'], [['sp', 'S', 'P', 100]], [{ id: 'oneway', nodeId: 'P' }]);
    expect(plan(ds, exactRequest({ durationMin: 60 }), THU_10AM).plans).toEqual([]);
    const required = plan(ds, exactRequest({ durationMin: 60, requiredPlaceIds: ['oneway'] }), THU_10AM);
    expect(required.blockers[0].code).toBe('REQUIRED_UNAVAILABLE');
  });

  it('says so when a café is required but none qualifies', () => {
    const res = plan(exactDataset(), exactRequest({ durationMin: 90, requireCafe: true }), THU_10AM);
    expect(res.blockers[0].code).toBe('NO_CAFE');
  });

  it('keeps a required stop even when candidates are trimmed hard', () => {
    const res = plan(fixture(), request({ requiredPlaceIds: ['p_tower'] }), THU_10AM, { ...DEFAULT_CONFIG, maxCandidates: 1 });
    expect(res.plans.length).toBeGreaterThan(0);
    expect(res.plans.every((p) => p.visits.some((v) => v.placeId === 'p_tower'))).toBe(true);
  });

  it('never schedules a place with an unknown price or unknown hours', () => {
    const juice = plan(fixture(), request({ requiredPlaceIds: ['p_juice'] }), THU_10AM);
    expect(juice.blockers[0]).toMatchObject({ code: 'REQUIRED_UNAVAILABLE' });
    expect(juice.blockers[0].message).toContain('prices');
    const books = plan(fixture(), request({ requiredPlaceIds: ['p_bookshop'] }), THU_10AM);
    expect(books.blockers[0].message).toContain('opening hours');
  });

  it('rejects a visit that would run past closing time', () => {
    // Monday 17:40: Café B closes at 18:00, too soon for a walk there plus a 15-minute stop.
    const res = plan(fixture(), request({ requiredPlaceIds: ['p_cafe_b'] }), ist('2026-10-05', '17:40'));
    expect(res.plans).toEqual([]);
    expect(res.blockers[0].code).toBe('REQUIRED_UNAVAILABLE');
  });

  it('knows a place is closed all day', () => {
    const res = plan(fixture(), request({ requiredPlaceIds: ['p_cafe_b'] }), ist('2026-10-04', '10:00'));
    expect(res.blockers[0].message).toContain('not open today');
  });

  it('refuses more required stops than the stop cap allows', () => {
    const res = plan(
      fixture(),
      request({ requiredPlaceIds: ['p_tower', 'p_bench'], requireCafe: true }),
      THU_10AM,
      { ...DEFAULT_CONFIG, maxStops: 2 },
    );
    expect(res.blockers[0].code).toBe('TOO_MANY_REQUIRED');
  });

  it('counts a required café towards the café requirement', () => {
    const res = plan(
      fixture(),
      request({ requiredPlaceIds: ['p_cafe_a', 'p_bench'], requireCafe: true }),
      THU_10AM,
      { ...DEFAULT_CONFIG, maxStops: 2 },
    );
    expect(res.plans.length).toBeGreaterThan(0);
  });
});

describe('deadlines: back-by, sunset and the pilot window', () => {
  it('uses a back-by time when it is tighter than the duration', () => {
    const res = plan(fixture(), request({ durationMin: 90, backBy: '10:45' }), THU_10AM);
    expect(res.context).toMatchObject({ deadlineReason: 'backBy', availableSec: 45 * 60, deadlineIst: '10:45' });
    expect(res.plans.every((p) => p.totalSec <= 45 * 60)).toBe(true);
  });

  it('cuts a long request short at sunset', () => {
    // Sunset on 1 Oct 2026 is about 18:20; the pilot window ends at 18:30.
    const res = plan(fixture(), request({ durationMin: 90 }), ist('2026-10-01', '17:40'));
    expect(res.context?.deadlineReason).toBe('sunset');
    expect(res.context!.availableSec).toBeLessThan(45 * 60);
    expect(res.plans.every((p) => p.totalSec <= res.context!.availableSec)).toBe(true);
  });

  it('refuses after sunset, before the window opens, and after a passed back-by', () => {
    expect(plan(fixture(), request(), ist('2026-10-01', '18:25')).blockers[0].code).toBe('AFTER_SUNSET');
    expect(plan(fixture(), request(), ist('2026-10-01', '06:30')).blockers[0].code).toBe('OUTSIDE_WINDOW');
    expect(plan(fixture(), request({ backBy: '09:30' }), THU_10AM).blockers[0].code).toBe('BACK_BY_PASSED');
  });
});

describe('input validation', () => {
  it.each<[string, Partial<PlanRequest>]>([
    ['duration below range', { durationMin: 20 }],
    ['duration above range', { durationMin: 120 }],
    ['negative budget', { budgetInr: -1 }],
    ['three required places', { requiredPlaceIds: ['p_tower', 'p_bench', 'p_view'] }],
    ['unknown place', { requiredPlaceIds: ['nope'] }],
    ['malformed back-by', { backBy: '6pm' }],
    ['negative dwell', { dwellOverridesMin: { p_bench: -5 } }],
  ])('rejects %s', (_label, overrides) => {
    expect(plan(fixture(), request(overrides), THU_10AM).blockers[0].code).toBe('INVALID_INPUT');
  });

  it('rejects an unknown start', () => {
    expect(plan(fixture(), request({ startId: 'nowhere' }), THU_10AM).blockers[0].code).toBe('UNKNOWN_START');
  });
});

describe('modes', () => {
  it('rain mode schedules only sheltered stops and says how much is covered', () => {
    const res = plan(fixture(), request({ rain: true, occasion: 'catchup', budgetInr: 0 }), THU_10AM);
    const places = new Map(fixture().places.map((p) => [p.id, p]));
    expect(res.plans.length).toBeGreaterThan(0);
    for (const p of res.plans) {
      for (const v of p.visits) if (v.dwellSec > 0) expect(places.get(v.placeId)!.tags).toContain('sheltered');
      expect(p.explanation).toMatch(/% of the walking is covered/);
    }
  });

  it('avoid steps never uses a stepped edge', () => {
    const steps = new Set(fixture().edges.filter((e) => e.steps).map((e) => e.id));
    for (const occasion of OCCASION_IDS) {
      const res = plan(fixture(), request({ occasion, durationMin: 90, avoidSteps: true }), THU_10AM);
      expect(res.plans.length).toBeGreaterThan(0);
      for (const p of res.plans) {
        expect(p.usesSteps).toBe(false);
        expect(p.edgeIds.some((id) => steps.has(id))).toBe(false);
      }
    }
  });

  it('includes a no-purchase curated walk when it fits', () => {
    // Without places, only curated walks remain. The hill walk's viewpoint is gone, so it can't qualify.
    const ds = fixture();
    ds.places = [];
    const res = plan(ds, request({ occasion: 'catchup', budgetInr: 0 }), THU_10AM);
    expect(res.plans.map((p) => p.id)).toEqual(['c:w_pond']);
    expect(res.plans[0]).toMatchObject({ kind: 'curated', visits: [], spendHighInr: 0, retraceRatio: 0, outAndBack: false });
  });

  it('labels a retraced route as out-and-back', () => {
    const res = plan(exactDataset(), exactRequest(), THU_10AM);
    expect(res.plans[0].outAndBack).toBe(true);
    expect(res.plans[0].retraceRatio).toBe(1);
    expect(res.plans[0].name).toContain('(out-and-back)');
  });

  it('warns about old verification data', () => {
    const ds = fixture();
    ds.places = [];
    const [pond] = plan(ds, request({ occasion: 'catchup', budgetInr: 0 }), THU_10AM).plans;
    expect(pond.dataCheckedOn).toBe('2026-01-10');
    expect(pond.warnings.join(' ')).toContain('last checked on 2026-01-10');
  });

  it('drops a curated walk that duplicates a better generated loop', () => {
    const res = plan(fixture(), request({ occasion: 'catchup', budgetInr: 0 }), THU_10AM);
    expect(res.plans.map((p) => p.id)).not.toContain('c:w_pond');
    expect(res.plans[0].id).toBe('g:p_pond.p_bench.p_shelter');
  });
});

describe('ranking and diversity', () => {
  it('does not reward adding stops by default (points are averaged)', () => {
    expect(occasionPoints('cafe', ['group'], 'friends')).toBe(2);
    expect(occasionPoints('landmark', ['iconic'], 'friends')).toBe(0);
    expect(occasionPoints('seating', ['quiet', 'seating', 'conversation'], 'catchup')).toBe(2);
  });

  it('prefers a full loop past a waypoint over retracing the same stops', () => {
    const res = plan(fixture(), request({ occasion: 'catchup', budgetInr: 0 }), THU_10AM);
    expect(res.plans[0].retraceRatio).toBe(0);
    expect(res.plans[0].visits.map((v) => v.placeId)).toContain('p_pond');
  });

  it('subtracts a point for tags a mode avoids, never going below zero', () => {
    expect(occasionPoints('cafe', ['quiet', 'coffee'], 'meeting')).toBe(2);
    expect(occasionPoints('cafe', ['quiet', 'coffee', 'lively'], 'meeting')).toBe(1);
    expect(occasionPoints('cafe', ['lively', 'group'], 'meeting')).toBe(0);
    expect(occasionPoints('cafe', ['dessert', 'quick'], 'date')).toBe(0);
  });

  it('gives every mode sensible, valid defaults', () => {
    for (const id of OCCASION_IDS) {
      const d = OCCASIONS[id].defaults;
      expect(d.durationMin).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minDurationMin);
      expect(d.durationMin).toBeLessThanOrEqual(DEFAULT_CONFIG.maxDurationMin);
      expect(d.budgetInr).toBeGreaterThanOrEqual(0);
      expect(OCCASIONS[id].rules.length).toBeLessThanOrEqual(2);
    }
  });

  it('caps stops per mode (walking meetings have at most two)', () => {
    const res = plan(fixture(), request({ occasion: 'meeting', durationMin: 90, budgetInr: 200 }), THU_10AM);
    expect(res.plans.length).toBeGreaterThan(0);
    expect(res.plans.every((p) => p.visits.length <= 2)).toBe(true);
    const tooMany = plan(fixture(), request({ occasion: 'meeting', requiredPlaceIds: ['p_tower', 'p_bench'], requireCafe: true }), THU_10AM);
    expect(tooMany.blockers[0].code).toBe('TOO_MANY_REQUIRED');
  });

  it('ranks the most walking first in Active walk mode', () => {
    const res = plan(fixture(), request({ occasion: 'active', durationMin: 90, budgetInr: 0 }), THU_10AM);
    expect(res.plans.length).toBeGreaterThan(1);
    const shares = res.plans.map((p) => p.walkingSec / p.availableSec);
    expect(shares[0]).toBeGreaterThanOrEqual(Math.max(...shares.slice(1)) - 0.05);
    expect(res.plans[0].fit).toMatch(/% of the time is walking/);
  });

  it('explains why a plan suits the occasion', () => {
    const res = plan(fixture(), request({ occasion: 'friends', requireCafe: true }), THU_10AM);
    expect(res.plans[0].fit).toBe('Friends: a lively group spot and food.');
  });

  it('treats any plan using half the time or more as an equally good fit', () => {
    expect(timeFit(42 * 60, 60 * 60)).toBe(1);
    expect(timeFit(59 * 60, 60 * 60)).toBe(1);
    expect(timeFit(15 * 60, 60 * 60)).toBe(0.5);
  });

  it('ranks occasion first, then less retracing', () => {
    const base = { totalSec: 1800, availableSec: 3600, coveredShare: 1, rain: false, walkingShare: 0.3, rankBy: 'stops' as const };
    const better = { ...base, occasion: 2, retraceRatio: 1, id: 'b' };
    const worse = { ...base, occasion: 1, retraceRatio: 0, id: 'a' };
    expect(compareScores(better, worse)).toBeLessThan(0);
    const loop = { ...base, occasion: 2, retraceRatio: 0, id: 'z' };
    expect(compareScores(loop, better)).toBeLessThan(0);
  });

  it('ranks covered walking above less retracing in rain mode', () => {
    const base = { occasion: 0, totalSec: 1800, availableSec: 3600, rain: true, walkingShare: 0.3, rankBy: 'stops' as const };
    const dryLoop = { ...base, retraceRatio: 0, coveredShare: 0.17, id: 'a' };
    const coveredRetrace = { ...base, retraceRatio: 1, coveredShare: 1, id: 'b' };
    expect(compareScores(coveredRetrace, dryLoop)).toBeLessThan(0);
    expect(compareScores({ ...dryLoop, rain: false }, { ...coveredRetrace, rain: false })).toBeLessThan(0);
  });

  it('returns at most three distinct plans and never duplicates a stop set', () => {
    const res = plan(fixture(), request({ durationMin: 90, budgetInr: 200 }), THU_10AM);
    expect(res.plans.length).toBeLessThanOrEqual(3);
    const keys = res.plans.map((p) => p.visits.map((v) => v.placeId).sort().join('.') || p.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns a single plan when only one is genuinely possible', () => {
    expect(plan(exactDataset(), exactRequest({ durationMin: 90 }), THU_10AM).plans).toHaveLength(1);
  });

  it('is deterministic', () => {
    const r = request({ durationMin: 90, requireCafe: true, rain: true });
    expect(plan(fixture(), r, THU_10AM)).toEqual(plan(fixture(), r, THU_10AM));
  });
});
