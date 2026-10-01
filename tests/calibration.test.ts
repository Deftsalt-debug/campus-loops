import { describe, expect, it } from 'vitest';
import { suggestedPaceMps, summarise, type WalkLog } from '../src/core/calibration';
import { clearLogs, exportLogsJson, listLogs, removeLog, saveLog, type KeyValueStore } from '../src/storage/calibrationLog';

const log = (id: string, predicted: number, actual: number, extra: Partial<WalkLog> = {}): WalkLog => ({
  id,
  planId: 'g:p_cafe_a',
  datasetVersion: 'fixture-1',
  pace: 'normal',
  predictedWalkSec: predicted,
  actualWalkSec: actual,
  loggedAt: '2026-10-01T10:00:00+05:30',
  ...extra,
});

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('summarise', () => {
  it('computes the median ratio and the share within 20%', () => {
    const s = summarise([log('a', 100, 110), log('b', 100, 130), log('c', 100, 90)]);
    expect(s.count).toBe(3);
    expect(s.medianWalkRatio).toBeCloseTo(1.1);
    expect(s.within20Share).toBeCloseTo(2 / 3);
  });

  it('averages the middle pair for an even count', () => {
    expect(summarise([log('a', 100, 100), log('b', 100, 120)]).medianWalkRatio).toBeCloseTo(1.1);
  });

  it('filters by pace and ignores unusable logs', () => {
    const logs = [log('a', 100, 150), log('b', 0, 50), log('c', 100, 100, { pace: 'relaxed' })];
    expect(summarise(logs, 'normal')).toMatchObject({ count: 1, medianWalkRatio: 1.5 });
    expect(summarise([])).toEqual({ count: 0, medianWalkRatio: null, within20Share: null, medianDwellRatio: null });
  });

  it('summarises dwell separately', () => {
    const s = summarise([log('a', 100, 100, { predictedDwellSec: 600, actualDwellSec: 900 })]);
    expect(s.medianDwellRatio).toBeCloseTo(1.5);
  });

  it('suggests a slower pace when walks run long', () => {
    expect(suggestedPaceMps(1.2, summarise([log('a', 100, 120)]))).toBeCloseTo(1.0);
    expect(suggestedPaceMps(1.2, summarise([]))).toBeNull();
  });
});

describe('calibration storage', () => {
  it('saves, lists, removes and clears', () => {
    const store = new MemoryStore();
    expect(saveLog(log('a', 100, 110), store)).toBe(true);
    expect(saveLog(log('b', 100, 90), store)).toBe(true);
    expect(saveLog(log('a', 100, 120), store)).toBe(true); // same id replaces
    expect(listLogs(store).map((l) => [l.id, l.actualWalkSec])).toEqual([['b', 90], ['a', 120]]);
    expect(JSON.parse(exportLogsJson(store))).toHaveLength(2);
    removeLog('b', store);
    expect(listLogs(store).map((l) => l.id)).toEqual(['a']);
    clearLogs(store);
    expect(listLogs(store)).toEqual([]);
  });

  it('survives corrupt data and drops malformed entries', () => {
    const store = new MemoryStore();
    store.setItem('campusloops.calibration.v1', '{not json');
    expect(listLogs(store)).toEqual([]);
    store.setItem('campusloops.calibration.v1', JSON.stringify([log('ok', 1, 1), { id: 'bad' }]));
    expect(listLogs(store).map((l) => l.id)).toEqual(['ok']);
  });

  it('reports failure when storage is unavailable or throws', () => {
    expect(saveLog(log('a', 1, 1), null)).toBe(false);
    expect(listLogs(null)).toEqual([]);
    const full: KeyValueStore = {
      getItem: () => '[]',
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(saveLog(log('a', 1, 1), full)).toBe(false);
  });
});
