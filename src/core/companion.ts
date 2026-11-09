import type { Plan } from './types';

/**
 * The live walk companion turns a plan into a sequence of legs and answers,
 * for any moment during the walk, "what should I be doing and how long do I
 * have?". It is pure arithmetic on the plan's own offsets, so it never
 * disagrees with the itinerary shown beside it.
 */

export type LegKind = 'walk' | 'stop' | 'buffer';

export interface CompanionLeg {
  kind: LegKind;
  /** Where the leg ends (walk), where it happens (stop), or the start point (buffer). */
  place: string;
  /** The itinerary row this leg leads to or sits at: a visit index, or the start/finish. */
  stop: number | 'start';
  /** Seconds after departure. */
  startSec: number;
  endSec: number;
}

/**
 * Split a plan into walk and stop legs, ending with the return buffer.
 * Places the route only passes (no dwell) do not break a walking leg.
 */
export function companionLegs(plan: Plan, startName: string): CompanionLeg[] {
  const legs: CompanionLeg[] = [];
  let cursor = 0;
  plan.visits.forEach((visit, index) => {
    if (visit.dwellSec <= 0) return;
    if (visit.arriveOffsetSec > cursor) {
      legs.push({ kind: 'walk', place: visit.name, stop: index, startSec: cursor, endSec: visit.arriveOffsetSec });
    }
    const leaveSec = visit.arriveOffsetSec + visit.dwellSec;
    legs.push({ kind: 'stop', place: visit.name, stop: index, startSec: visit.arriveOffsetSec, endSec: leaveSec });
    cursor = leaveSec;
  });
  const backSec = Math.max(cursor, plan.totalSec - plan.bufferSec);
  if (backSec > cursor) legs.push({ kind: 'walk', place: startName, stop: 'start', startSec: cursor, endSec: backSec });
  if (plan.totalSec > backSec) legs.push({ kind: 'buffer', place: startName, stop: 'start', startSec: backSec, endSec: plan.totalSec });
  return legs;
}

export interface CompanionStatus {
  /** `done` once the plan's own clock, buffer included, has run out. */
  phase: 'active' | 'done';
  legIndex: number;
  leg: CompanionLeg;
  /** Seconds until the current leg ends; 0 when done. */
  legRemainingSec: number;
  /** Seconds until the walker is back at the start, buffer excluded. */
  untilBackSec: number;
  /** Position on the plan's clock, capped at its end. Negative when extra time was added in the first leg. */
  planSec: number;
  /** 0–1 through the whole plan, buffer included. */
  progress: number;
}

/**
 * Where a walker is on the plan's clock.
 *
 * @param planSec Seconds along the plan: real time since departure, shifted by
 *   any "I'm here already" or "we need longer" adjustment the walker made.
 * @param legFloor The leg the walker has confirmed reaching. Asking for more
 *   time rewinds the clock, and without this a longer stay at a café would
 *   read as still walking to it. Below the floor leg's start, the walker is
 *   simply in that leg with more than its planned time left.
 */
export function companionStatus(plan: Plan, legs: CompanionLeg[], planSec: number, legFloor = 0): CompanionStatus {
  const total = Math.max(plan.totalSec, 1);
  const at = Math.min(planSec, plan.totalSec);
  const backSec = plan.totalSec - plan.bufferSec;
  const last = legs.length - 1;
  if (planSec >= plan.totalSec || legs.length === 0) {
    const leg = legs[last] ?? { kind: 'buffer', place: '', stop: 'start', startSec: 0, endSec: 0 };
    return { phase: 'done', legIndex: Math.max(last, 0), leg, legRemainingSec: 0, untilBackSec: 0, planSec: Math.max(at, 0), progress: 1 };
  }
  // A leg owns its start instant, so arriving exactly on time shows the stop, not the walk to it.
  let legIndex = legs.findIndex((leg) => at < leg.endSec);
  if (legIndex < 0) legIndex = last;
  legIndex = Math.min(last, Math.max(legIndex, legFloor));
  const leg = legs[legIndex];
  return {
    phase: 'active',
    legIndex,
    leg,
    legRemainingSec: Math.max(0, leg.endSec - at),
    untilBackSec: Math.max(0, backSec - at),
    planSec: at,
    progress: Math.min(1, Math.max(0, at / total)),
  };
}

/**
 * How the walk compares with the limit it was planned against.
 * Positive `spareSec` is slack before the deadline once the return buffer is
 * kept; negative means the walk now overruns it.
 */
export function companionSpareSec(plan: Plan, elapsedSec: number, planSec: number): number {
  const remainingSec = Math.max(0, plan.totalSec - planSec);
  return plan.availableSec - (elapsedSec + remainingSec);
}

/** "12:05" style countdown; minutes are not capped at 59 because legs are short. */
export function countdown(sec: number): string {
  const whole = Math.max(0, Math.ceil(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
