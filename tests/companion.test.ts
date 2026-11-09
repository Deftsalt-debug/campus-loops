import { describe, expect, it } from 'vitest';
import { companionLegs, companionSpareSec, companionStatus, countdown } from '../src/core/companion';
import type { Plan, Visit } from '../src/core/types';
import { plan } from '../src/core/planner/plan';
import { fixture, ist } from './helpers';

function visit(name: string, arriveOffsetSec: number, dwellSec: number): Visit {
  return { placeId: name, name, category: 'cafe', arriveOffsetSec, dwellSec, spendLowInr: 0, spendHighInr: 0 };
}

/** 10 min walk, 20 min stop, 2 min walk past a landmark, 8 more to a 5 min stop, 10 min back, 5 min buffer. */
function samplePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'g:test', kind: 'generated', name: 'Test walk', fit: '', explanation: '', startNodeId: 'n0', edgeIds: [],
    visits: [visit('Cafe', 600, 1200), visit('Statue', 1920, 0), visit('Garden', 2400, 300)],
    walkingSec: 1800, dwellSec: 1500, bufferSec: 300, totalSec: 3600, availableSec: 3900,
    distanceM: 2000, spendLowInr: 0, spendHighInr: 0, coveredShare: 0, retraceRatio: 0, outAndBack: false, usesSteps: false,
    dataCheckedOn: '2026-10-01', warnings: [],
    ...overrides,
  };
}

describe('companionLegs', () => {
  it('alternates walking and stops, ignores pass-by places, and ends with the buffer', () => {
    const legs = companionLegs(samplePlan(), 'Gate');
    expect(legs.map((l) => [l.kind, l.place, l.startSec, l.endSec])).toEqual([
      ['walk', 'Cafe', 0, 600],
      ['stop', 'Cafe', 600, 1800],
      ['walk', 'Garden', 1800, 2400],
      ['stop', 'Garden', 2400, 2700],
      ['walk', 'Gate', 2700, 3300],
      ['buffer', 'Gate', 3300, 3600],
    ]);
    expect(legs.map((l) => l.stop)).toEqual([0, 0, 2, 2, 'start', 'start']);
  });

  it('covers the whole plan with no gaps or overlaps', () => {
    const legs = companionLegs(samplePlan(), 'Gate');
    expect(legs[0].startSec).toBe(0);
    expect(legs.at(-1)!.endSec).toBe(3600);
    for (let i = 1; i < legs.length; i += 1) expect(legs[i].startSec).toBe(legs[i - 1].endSec);
  });

  it('is a single walk and buffer for a plan with no stops', () => {
    const legs = companionLegs(samplePlan({ visits: [], dwellSec: 0, totalSec: 2100, walkingSec: 1800 }), 'Gate');
    expect(legs.map((l) => l.kind)).toEqual(['walk', 'buffer']);
  });

  it('omits the buffer leg when the plan has none', () => {
    const legs = companionLegs(samplePlan({ bufferSec: 0, totalSec: 3300 }), 'Gate');
    expect(legs.at(-1)).toMatchObject({ kind: 'walk', place: 'Gate', endSec: 3300 });
  });

  it('tiles every plan the real planner produces', () => {
    const result = plan(fixture(), {
      startId: fixture().starts[0].id, durationMin: 60, budgetInr: 200, occasion: 'friends',
      requiredPlaceIds: [], requireCafe: false, pace: 'normal', avoidSteps: false, rain: false,
    }, ist('2026-10-01', '10:00'));
    expect(result.plans.length).toBeGreaterThan(0);
    for (const p of result.plans) {
      const legs = companionLegs(p, 'Start');
      expect(legs[0].startSec).toBe(0);
      expect(legs.at(-1)!.endSec).toBe(p.totalSec);
      for (let i = 1; i < legs.length; i += 1) expect(legs[i].startSec).toBe(legs[i - 1].endSec);
      const stopSec = legs.filter((l) => l.kind === 'stop').reduce((sum, l) => sum + l.endSec - l.startSec, 0);
      expect(stopSec).toBe(p.dwellSec);
    }
  });
});

describe('companionStatus', () => {
  const p = samplePlan();
  const legs = companionLegs(p, 'Gate');

  it('reports the current leg and the time left in it', () => {
    const s = companionStatus(p, legs, 300);
    expect(s).toMatchObject({ phase: 'active', legIndex: 0, legRemainingSec: 300, untilBackSec: 3000, progress: 300 / 3600 });
  });

  it('gives a boundary instant to the leg that starts there', () => {
    expect(companionStatus(p, legs, 600).leg).toMatchObject({ kind: 'stop', place: 'Cafe' });
    expect(companionStatus(p, legs, 3300).leg.kind).toBe('buffer');
  });

  it('treats a rewound clock in the first leg as extra time for it', () => {
    expect(companionStatus(p, legs, -120)).toMatchObject({ phase: 'active', legIndex: 0, legRemainingSec: 720, untilBackSec: 3420, progress: 0 });
  });

  it('keeps a walker who asked for longer at a stop in that stop', () => {
    // Arrived at the café (leg 1) on time, then added 5 min: the clock reads 300, before the stop began.
    const s = companionStatus(p, legs, 300, 1);
    expect(s).toMatchObject({ phase: 'active', legIndex: 1, legRemainingSec: 1500 });
    expect(s.leg).toMatchObject({ kind: 'stop', place: 'Cafe' });
    // Without the floor the same clock would read as still walking there.
    expect(companionStatus(p, legs, 300).leg.kind).toBe('walk');
  });

  it('lets the clock run past a confirmed leg as usual', () => {
    expect(companionStatus(p, legs, 2000, 1)).toMatchObject({ legIndex: 2 });
    expect(companionStatus(p, legs, 100, 99).legIndex).toBe(legs.length - 1);
  });

  it('is done once the plan, buffer included, has run out', () => {
    expect(companionStatus(p, legs, 3599).phase).toBe('active');
    expect(companionStatus(p, legs, 3600)).toMatchObject({ phase: 'done', legRemainingSec: 0, untilBackSec: 0, progress: 1 });
    expect(companionStatus(p, legs, 99999).phase).toBe('done');
  });

  it('survives a plan with no legs', () => {
    expect(companionStatus(samplePlan({ totalSec: 0, bufferSec: 0, visits: [] }), [], 0).phase).toBe('done');
  });
});

describe('companionSpareSec', () => {
  const p = samplePlan(); // 3600 planned inside a 3900 limit

  it('is the planned slack when the walker is exactly on plan', () => {
    expect(companionSpareSec(p, 1000, 1000)).toBe(300);
  });

  it('grows when the walker is ahead and shrinks when behind', () => {
    expect(companionSpareSec(p, 1000, 1300)).toBe(600);
    expect(companionSpareSec(p, 1000, 700)).toBe(0);
    expect(companionSpareSec(p, 1000, 400)).toBe(-300);
  });
});

describe('countdown', () => {
  it('formats minutes and zero-padded seconds, rounding up so it never shows 0:00 early', () => {
    expect(countdown(754)).toBe('12:34');
    expect(countdown(59.2)).toBe('1:00');
    expect(countdown(0.4)).toBe('0:01');
    expect(countdown(0)).toBe('0:00');
    expect(countdown(-5)).toBe('0:00');
    expect(countdown(3725)).toBe('62:05');
  });
});
