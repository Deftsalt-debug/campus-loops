import { describe, expect, it, vi } from 'vitest';
import type { WalkLog } from '../src/core/calibration';
import { listLogs, removeLog, saveLog, exportLogsJson, type KeyValueStore } from '../src/storage/calibrationLog';

const valid: WalkLog = {
  id: 'walk-1',
  planId: 'g:cafe',
  datasetVersion: 'demo-1',
  pace: 'normal',
  predictedWalkSec: 1200,
  actualWalkSec: 1320,
  loggedAt: '2026-10-01T10:00:00.000Z',
};

function memoryStore(entries: unknown[]): KeyValueStore {
  let value = JSON.stringify(entries);
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    removeItem: () => { value = '[]'; },
  };
}

describe('calibration storage boundaries', () => {
  it.each([
    { id: '' },
    { planId: ' ' },
    { datasetVersion: 'x'.repeat(513) },
    { predictedWalkSec: -1 },
    { actualWalkSec: -1 },
    { predictedDwellSec: '300' },
    { actualDwellSec: -5 },
    { loggedAt: 'today' },
    { loggedAt: '2026-10-01T10:00:00' },
    { loggedAt: '2026-02-30T10:00:00Z' },
    { loggedAt: '2026-10-01T24:00:00Z' },
    { pace: 'fast' },
  ])('drops malformed stored fields: %j', (patch) => {
    const store = memoryStore([{ ...valid, ...patch }]);
    expect(listLogs(store)).toEqual([]);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite times before JSON can turn them into null: %s', (seconds) => {
    const store = memoryStore([valid]);
    expect(saveLog({ ...valid, actualWalkSec: seconds }, store)).toBe(false);
    expect(saveLog({ ...valid, predictedWalkSec: seconds }, store)).toBe(false);
    expect(saveLog({ ...valid, predictedDwellSec: seconds }, store)).toBe(false);
    expect(saveLog({ ...valid, actualDwellSec: seconds }, store)).toBe(false);
    expect(listLogs(store)).toEqual([valid]);
  });

  it('retains zero-second dwell and an explicit timestamp offset', () => {
    const entry = { ...valid, predictedDwellSec: 0, actualDwellSec: 0, loggedAt: '2026-10-01T15:30:00+05:30' };
    const store = memoryStore([]);
    expect(saveLog(entry, store)).toBe(true);
    expect(listLogs(store)).toEqual([entry]);
  });

  it('keeps the latest duplicate once and exports only documented fields', () => {
    const store = memoryStore([
      { ...valid, actualWalkSec: 1000, unrelatedPrivateField: 'exclude from export' },
      { ...valid, actualWalkSec: 1400, unrelatedPrivateField: 'exclude from export' },
    ]);
    expect(listLogs(store)).toEqual([{ ...valid, actualWalkSec: 1400 }]);
    expect(exportLogsJson(store)).not.toContain('unrelatedPrivateField');
  });

  it('does not overwrite existing logs when the storage read fails', () => {
    const write = vi.fn();
    const store: KeyValueStore = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: write,
      removeItem: vi.fn(),
    };
    expect(listLogs(store)).toEqual([]);
    expect(saveLog(valid, store)).toBe(false);
    expect(removeLog(valid.id, store)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
