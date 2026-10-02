import { describe, expect, it, vi } from 'vitest';
import type { WalkLog } from '../src/core/calibration';
import { clearLogs, getLogStorageStatus, listLogs, readLogs, removeLog, saveLog, exportLogsJson, type KeyValueStore } from '../src/storage/calibrationLog';

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
    expect(getLogStorageStatus(store)).toBe('corrupt');
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

  it('returns status and sanitized export records from the same storage read', () => {
    const store = memoryStore([]);
    store.getItem = vi.fn()
      .mockReturnValueOnce(JSON.stringify([{ ...valid, privateLocation: [13, 74] }, null]))
      .mockImplementation(() => { throw new Error('Storage became unavailable'); });
    const snapshot = readLogs(store);
    expect(snapshot).toEqual({ status: 'corrupt', logs: [valid] });
    expect(store.getItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.stringify(snapshot.logs))).toEqual([valid]);
    expect(readLogs(store)).toEqual({ status: 'unavailable', logs: [] });
  });

  it('does not overwrite existing logs when the storage read fails', () => {
    const write = vi.fn();
    const store: KeyValueStore = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: write,
      removeItem: vi.fn(),
    };
    expect(listLogs(store)).toEqual([]);
    expect(getLogStorageStatus(store)).toBe('unavailable');
    expect(saveLog(valid, store)).toBe(false);
    expect(removeLog(valid.id, store)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['broken JSON', '{}', 'null', JSON.stringify([valid, { broken: true }])])('preserves damaged storage while allowing readable export and explicit clear: %s', (raw) => {
    let value: string | null = raw;
    const store: KeyValueStore = {
      getItem: () => value,
      setItem: vi.fn((_key, next) => { value = next; }),
      removeItem: () => { value = null; },
    };
    expect(saveLog({ ...valid, id: 'new' }, store)).toBe(false);
    expect(getLogStorageStatus(store)).toBe('corrupt');
    expect(removeLog(valid.id, store)).toBe(false);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(value).toBe(raw);
    expect(JSON.parse(exportLogsJson(store))).toEqual(raw.startsWith('[') ? [valid] : []);
    expect(value).toBe(raw);
    expect(clearLogs(store)).toBe(true);
    expect(getLogStorageStatus(store)).toBe('ready');
    expect(saveLog(valid, store)).toBe(true);
    expect(listLogs(store)).toEqual([valid]);
  });

  it('refuses an append that would make previously readable calibration logs exceed the read limit', () => {
    // Fill the store just below the documented defensive read boundary using
    // valid rows, then append one row that crosses it. Nothing may be evicted.
    const entries: WalkLog[] = [];
    let encodedLength = 2; // JSON array brackets
    for (let index = 0; ; index++) {
      const entry = { ...valid, id: `walk-${index}`.padEnd(512, 'x'), planId: 'p'.repeat(512) };
      const nextLength = JSON.stringify(entry).length + (entries.length ? 1 : 0);
      if (encodedLength + nextLength > 1_000_000) break;
      entries.push(entry);
      encodedLength += nextLength;
    }
    const store = memoryStore(entries);
    const before = store.getItem('campusloops.calibration.v1');
    const write = vi.spyOn(store, 'setItem');
    expect(getLogStorageStatus(store)).toBe('ready');
    const overflow = { ...valid, id: 'new-walk'.padEnd(512, 'x'), planId: 'p'.repeat(512) };
    expect(saveLog(overflow, store)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(store.getItem('campusloops.calibration.v1')).toBe(before);
    expect(getLogStorageStatus(store)).toBe('ready');
    expect(JSON.parse(exportLogsJson(store))).toEqual(entries);
    // Removing or replacing a row with a shorter record still works at capacity.
    expect(saveLog({ ...valid, id: entries[0].id }, store)).toBe(true);
    expect(removeLog(entries[1].id, store)).toBe(true);
    expect(saveLog(overflow, store)).toBe(true);
    expect(getLogStorageStatus(store)).toBe('ready');
  });

  it('reads fresh calibration data for each mutation, preserving another tab’s latest log', () => {
    const store = memoryStore([valid]);
    listLogs(store);
    const otherTab = { ...valid, id: 'another-tab' };
    store.setItem('campusloops.calibration.v1', JSON.stringify([valid, otherTab]));
    const thisTab = { ...valid, id: 'this-tab' };
    expect(saveLog(thisTab, store)).toBe(true);
    expect(listLogs(store)).toEqual([valid, otherTab, thisTab]);
    expect(removeLog(valid.id, store)).toBe(true);
    expect(listLogs(store)).toEqual([otherTab, thisTab]);
  });

  it('bounds reading oversized storage and distinguishes quota failure from corruption', () => {
    const oversized = ' '.repeat(1_000_001);
    const store: KeyValueStore = { getItem: () => oversized, setItem: vi.fn(), removeItem: vi.fn() };
    expect(getLogStorageStatus(store)).toBe('corrupt');
    expect(saveLog(valid, store)).toBe(false);
    expect(removeLog(valid.id, store)).toBe(false);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(getLogStorageStatus(null)).toBe('unavailable');
    const full = memoryStore([valid]);
    full.setItem = () => { throw new Error('quota'); };
    expect(saveLog({ ...valid, id: 'new' }, full)).toBe(false);
    expect(getLogStorageStatus(full)).toBe('ready');
    expect(listLogs(full)).toEqual([valid]);
  });
});
