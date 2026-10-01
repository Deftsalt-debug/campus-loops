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

function isWalkLog(v: unknown): v is WalkLog {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.planId === 'string' &&
    typeof o.datasetVersion === 'string' &&
    (o.pace === 'relaxed' || o.pace === 'normal') &&
    typeof o.predictedWalkSec === 'number' &&
    typeof o.actualWalkSec === 'number' &&
    typeof o.loggedAt === 'string'
  );
}

/** Saved logs. Corrupt or unreadable storage gives an empty list rather than an error. */
export function listLogs(store: KeyValueStore | null = defaultStore()): WalkLog[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isWalkLog) : [];
  } catch {
    return [];
  }
}

/** Returns false when storage is unavailable or full. */
export function saveLog(log: WalkLog, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store || !isWalkLog(log)) return false;
  try {
    const logs = listLogs(store).filter((l) => l.id !== log.id);
    store.setItem(KEY, JSON.stringify([...logs, log]));
    return true;
  } catch {
    return false;
  }
}

export function removeLog(id: string, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(listLogs(store).filter((l) => l.id !== id)));
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
