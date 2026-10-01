import type { OpenWindow } from '../types';

// India has a single timezone with no daylight saving, so Asia/Kolkata is a
// fixed UTC+05:30 offset. Using the offset directly avoids depending on the
// device's own timezone or Intl data.
export const IST_OFFSET_MIN = 330;

export interface IstMoment {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  weekday: number; // 0 = Sunday
  /** Seconds since IST midnight. */
  secondOfDay: number;
}

export function toIst(now: Date): IstMoment {
  const shifted = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    secondOfDay: shifted.getUTCHours() * 3600 + shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds(),
  };
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHHMM(value: string): boolean {
  return HHMM.test(value);
}

/** Reject impossible calendar dates that Date.parse would silently normalize. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** An ISO timestamp with an explicit timezone, portable between recipients. */
export function isIsoInstant(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return Boolean(match && isCalendarDate(match[1]) && Number.isFinite(Date.parse(value)));
}

/** "18:30" -> 1110 minutes after midnight. Throws on malformed input. */
export function parseHHMM(value: string): number {
  const m = HHMM.exec(value);
  if (!m) throw new RangeError(`Expected HH:MM, got "${value}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes after midnight (fractional allowed) -> "HH:MM", rounded down. */
export function formatMinutes(minutes: number): string {
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * True when [arriveSec, leaveSec] (seconds after IST midnight) lies inside a
 * single verified window for that weekday. A visit spanning two windows is
 * rejected because the place may close in between.
 */
export function fitsOpenWindow(
  windows: OpenWindow[],
  weekday: number,
  arriveSec: number,
  leaveSec: number,
): boolean {
  return windows.some(
    (w) => w.day === weekday && parseHHMM(w.start) * 60 <= arriveSec && leaveSec <= parseHHMM(w.end) * 60,
  );
}
