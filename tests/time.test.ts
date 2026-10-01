import { describe, expect, it } from 'vitest';
import { fitsOpenWindow, formatMinutes, isCalendarDate, isHHMM, isIsoInstant, parseHHMM, toIst } from '../src/core/time/clock';
import { sunTimes } from '../src/core/time/sun';

const MANIPAL = { lat: 13.3525, lng: 74.7928 };
const sun = (y: number, m: number, d: number) => sunTimes(y, m, d, MANIPAL.lat, MANIPAL.lng, 330)!;

describe('sunTimes', () => {
  // Reference: US Naval Observatory API (aa.usno.navy.mil/api/rstt/oneday) for
  // 13.3525 N, 74.7928 E, tz +5.5, fetched 2026-10-01. USNO rounds to the minute.
  it.each([
    ['2026-06-21', 2026, 6, 21, '06:05', '19:00'],
    ['2026-12-21', 2026, 12, 21, '06:49', '18:09'],
  ])('matches USNO within a minute on %s', (_label, y, m, d, rise, set) => {
    const s = sun(y, m, d);
    expect(Math.abs(s.sunriseMin - parseHHMM(rise))).toBeLessThanOrEqual(1);
    expect(Math.abs(s.sunsetMin - parseHHMM(set))).toBeLessThanOrEqual(1);
  });

  it('keeps Manipal sunset between 17:45 and 19:15 all year', () => {
    for (let m = 1; m <= 12; m++) {
      for (const d of [1, 15]) {
        const s = sun(2026, m, d);
        expect(s.sunsetMin).toBeGreaterThan(parseHHMM('17:45'));
        expect(s.sunsetMin).toBeLessThan(parseHHMM('19:15'));
        expect(s.sunriseMin).toBeLessThan(s.solarNoonMin);
        expect(s.solarNoonMin).toBeLessThan(s.sunsetMin);
      }
    }
  });

  it('gives about 12 hours of daylight at the equinox', () => {
    const s = sun(2026, 3, 20);
    expect(Math.abs(s.sunsetMin - s.sunriseMin - 12 * 60)).toBeLessThan(15);
  });

  it('has earlier sunsets in December than in June', () => {
    expect(sun(2026, 12, 15).sunsetMin).toBeLessThan(sun(2026, 6, 15).sunsetMin);
  });
});

describe('IST clock', () => {
  it('validates real Gregorian dates and explicit timezone timestamps', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isIsoInstant('2026-10-01T10:00:00+05:30')).toBe(true);
    expect(isIsoInstant('2026-10-01T04:30:00.000Z')).toBe(true);
    expect(isIsoInstant('2026-10-01T10:00:00')).toBe(false);
    expect(isIsoInstant('2026-02-30T10:00:00Z')).toBe(false);
  });
  it('converts across UTC midnight', () => {
    // 20:00 UTC on Wednesday 30 Sep is 01:30 IST on Thursday 1 Oct.
    const t = toIst(new Date('2026-09-30T20:00:00Z'));
    expect([t.year, t.month, t.day, t.weekday]).toEqual([2026, 10, 1, 4]);
    expect(t.secondOfDay).toBe(90 * 60);
  });

  it('parses and formats HH:MM', () => {
    expect(parseHHMM('18:30')).toBe(1110);
    expect(formatMinutes(1110.9)).toBe('18:30');
    expect(isHHMM('7:30')).toBe(false);
    expect(() => parseHHMM('24:00')).toThrow(RangeError);
  });

  it('requires a visit to fit inside a single verified window', () => {
    const windows = [
      { day: 4, start: '09:00', end: '12:00' },
      { day: 4, start: '13:00', end: '18:00' },
    ];
    const at = (hhmm: string) => parseHHMM(hhmm) * 60;
    expect(fitsOpenWindow(windows, 4, at('09:00'), at('12:00'))).toBe(true); // exactly at both edges
    expect(fitsOpenWindow(windows, 4, at('08:59'), at('09:30'))).toBe(false); // before opening
    expect(fitsOpenWindow(windows, 4, at('11:50'), at('12:10'))).toBe(false); // closes during the visit
    expect(fitsOpenWindow(windows, 4, at('11:30'), at('13:30'))).toBe(false); // spans the lunch closure
    expect(fitsOpenWindow(windows, 5, at('10:00'), at('10:30'))).toBe(false); // other weekday
  });
});
