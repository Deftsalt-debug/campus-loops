import type { WalkLog } from '../core/calibration';
import { isIsoInstant } from '../core/time/clock';

// Calibration logs live only in this browser. They never sync between
// devices and disappear if site data is cleared.

const KEY = 'campusloops.calibration.v1';

/** The subset of the Web Storage API we use, so tests can pass a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // Access can throw in private windows or with storage blocked.
  }
}

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 512;

const isSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isWalkLog(v: unknown): v is WalkLog {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isIdentifier(o.id) &&
    isIdentifier(o.planId) &&
    isIdentifier(o.datasetVersion) &&
    (o.pace === 'relaxed' || o.pace === 'normal') &&
    isSeconds(o.predictedWalkSec) &&
    isSeconds(o.actualWalkSec) &&
    (o.predictedDwellSec === undefined || isSeconds(o.predictedDwellSec)) &&
    (o.actualDwellSec === undefined || isSeconds(o.actualDwellSec)) &&
    typeof o.loggedAt === 'string' &&
    isIsoInstant(o.loggedAt)
  );
}

/** Keep only the documented fields, including in exports of older stored records. */
function cleanLog(log: WalkLog): WalkLog {
  return {
    id: log.id,
    planId: log.planId,
    datasetVersion: log.datasetVersion,
    pace: log.pace,
    predictedWalkSec: log.predictedWalkSec,
    actualWalkSec: log.actualWalkSec,
    ...(log.predictedDwellSec === undefined ? {} : { predictedDwellSec: log.predictedDwellSec }),
    ...(log.actualDwellSec === undefined ? {} : { actualDwellSec: log.actualDwellSec }),
    loggedAt: log.loggedAt,
  };
}

export type LogStorageStatus = 'ready' | 'corrupt' | 'unavailable';

function readLogSnapshot(store: KeyValueStore | null): { logs: WalkLog[]; status: LogStorageStatus } {
  if (!store) return { logs: [], status: 'unavailable' };
  let raw: string | null;
  try { raw = store.getItem(KEY); } catch { return { logs: [], status: 'unavailable' }; }
  // Bound work on arbitrary storage contents without modifying oversized data.
  if (raw !== null && raw.length > 1_000_000) return { logs: [], status: 'corrupt' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '[]');
  } catch {
    return { logs: [], status: 'corrupt' };
  }
  if (!Array.isArray(parsed)) return { logs: [], status: 'corrupt' };
  const logs = new Map<string, WalkLog>();
  let damaged = false;
  for (const entry of parsed) {
    if (isWalkLog(entry)) {
      // The newest stored record with an ID wins, matching saveLog replacement.
      logs.delete(entry.id);
      logs.set(entry.id, cleanLog(entry));
    } else damaged = true;
  }
  return { logs: [...logs.values()], status: damaged ? 'corrupt' : 'ready' };
}

/** Keep damaged data distinct from blocked storage so recovery advice cannot erase valid logs. */
export function getLogStorageStatus(store: KeyValueStore | null = defaultStore()): LogStorageStatus {
  return readLogSnapshot(store).status;
}

/** Readable saved logs; malformed rows are omitted without modifying the original store. */
export function listLogs(store: KeyValueStore | null = defaultStore()): WalkLog[] {
  return readLogSnapshot(store).logs;
}

/** Returns false when storage is unavailable, full, or damaged; never repairs implicitly. */
export function saveLog(log: WalkLog, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store || !isWalkLog(log)) return false;
  const snapshot = readLogSnapshot(store);
  if (snapshot.status !== 'ready') return false;
  try {
    const logs = snapshot.logs.filter((l) => l.id !== log.id);
    store.setItem(KEY, JSON.stringify([...logs, cleanLog(log)]));
    return true;
  } catch {
    return false;
  }
}

export function removeLog(id: string, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  const snapshot = readLogSnapshot(store);
  if (snapshot.status !== 'ready') return false;
  try {
    store.setItem(KEY, JSON.stringify(snapshot.logs.filter((l) => l.id !== id)));
    return true;
  } catch {
    return false;
  }
}

export function clearLogs(store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

/** Pretty JSON for the user to download or paste into a calibration review. */
export function exportLogsJson(store: KeyValueStore | null = defaultStore()): string {
  return JSON.stringify(listLogs(store), null, 2);
}
