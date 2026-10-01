import type { WalkLog } from '../core/calibration';

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
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(o.loggedAt) &&
    Number.isFinite(Date.parse(o.loggedAt))
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

function readLogs(store: KeyValueStore): WalkLog[] {
  // A failed read must reach save/remove so they cannot overwrite existing logs.
  const raw = store.getItem(KEY);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '[]');
  } catch {
    return []; // Corrupt JSON is recoverable by saving a fresh valid record.
  }
  if (!Array.isArray(parsed)) return [];
  const logs = new Map<string, WalkLog>();
  for (const entry of parsed) {
    if (isWalkLog(entry)) {
      // The newest stored record with an ID wins, matching saveLog replacement.
      logs.delete(entry.id);
      logs.set(entry.id, cleanLog(entry));
    }
  }
  return [...logs.values()];
}

/** Saved logs. Corrupt or unreadable storage gives an empty list rather than an error. */
export function listLogs(store: KeyValueStore | null = defaultStore()): WalkLog[] {
  if (!store) return [];
  try {
    return readLogs(store);
  } catch {
    return [];
  }
}

/** Returns false when storage is unavailable or full. */
export function saveLog(log: WalkLog, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store || !isWalkLog(log)) return false;
  try {
    const logs = readLogs(store).filter((l) => l.id !== log.id);
    store.setItem(KEY, JSON.stringify([...logs, cleanLog(log)]));
    return true;
  } catch {
    return false;
  }
}

export function removeLog(id: string, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(readLogs(store).filter((l) => l.id !== id)));
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
