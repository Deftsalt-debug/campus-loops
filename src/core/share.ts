import { isOccasion } from './planner/occasions';
import { DEFAULT_CONFIG } from './planner/config';
import { isPlaceIdentifier, isShareIdentifier } from './identifiers';
import { isHHMM, isIsoInstant } from './time/clock';
import type { PlanRequest } from './types';

// Shareable links keep everything in the URL fragment (#...), which browsers
// don't send to the server. Fragments are not secret: anyone with the link can
// read the start point, route and preferences. Use public landmarks only.

export const SHARE_VERSION = '1';
const MAX_LENGTH = 2000;
const DECIMAL = /^\d+(?:\.\d+)?$/;

function isPlanIdentifier(id: string): boolean {
  if (id.startsWith('c:')) return isShareIdentifier(id.slice(2));
  if (!id.startsWith('g:') && !id.startsWith('l:')) return false;
  const stops = id.slice(2).split('.');
  return stops.length <= DEFAULT_CONFIG.maxStops && stops.every(isPlaceIdentifier);
}

export interface SharedPlan {
  datasetVersion: string;
  request: PlanRequest;
  planId: string;
  /** Planning time as an ISO string, only when the sharer used a preview time. */
  at?: string;
}

export function encodeShare(shared: SharedPlan): string {
  const r = shared.request;
  const p = new URLSearchParams({
    v: SHARE_VERSION,
    d: shared.datasetVersion,
    s: r.startId,
    o: r.occasion,
    t: String(r.durationMin),
    b: String(r.budgetInr),
    p: r.pace,
    id: shared.planId,
  });
  if (r.requiredPlaceIds.length) p.set('r', r.requiredPlaceIds.join(','));
  if (r.requireCafe) p.set('c', '1');
  if (r.avoidSteps) p.set('a', '1');
  if (r.rain) p.set('w', '1');
  if (r.backBy) p.set('k', r.backBy);
  if (r.bufferMin !== undefined) p.set('f', String(r.bufferMin));
  const dwell = Object.entries(r.dwellOverridesMin ?? {});
  if (dwell.length) p.set('dw', dwell.map(([id, m]) => `${id}~${m}`).join(','));
  if (shared.at) p.set('at', shared.at);
  return `#${p.toString()}`;
}

export type DecodeResult = { ok: true; shared: SharedPlan } | { ok: false; reason: string };

/** Parse a fragment as untrusted input: every field is type- and range-checked. */
export function decodeShare(hash: string): DecodeResult {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return { ok: false, reason: 'empty' };
  if (raw.length > MAX_LENGTH) return { ok: false, reason: 'This link is too long to be a Campus Loops plan.' };
  const p = new URLSearchParams(raw);
  if (p.get('v') !== SHARE_VERSION) return { ok: false, reason: 'This link was made by a different version of Campus Loops.' };

  const bad = (what: string): DecodeResult => ({ ok: false, reason: `This link has an invalid ${what}.` });
  const keys = [...p.keys()];
  if (new Set(keys).size !== keys.length) return bad('repeated field');
  for (const key of ['c', 'a', 'w']) {
    if (p.has(key) && p.get(key) !== '1' && p.get(key) !== '0') return bad('preference');
  }
  const d = p.get('d') ?? '';
  const s = p.get('s') ?? '';
  const id = p.get('id') ?? '';
  if (!isShareIdentifier(d)) return bad('dataset');
  if (!isShareIdentifier(s)) return bad('start');
  if (!isPlanIdentifier(id)) return bad('plan id');
  const occasion = p.get('o');
  if (!isOccasion(occasion)) return bad('occasion');
  const pace = p.get('p');
  if (pace !== 'relaxed' && pace !== 'normal') return bad('pace');
  const num = (key: string, min: number, max: number) => {
    const raw = p.get(key);
    const v = Number(raw);
    return raw !== null && DECIMAL.test(raw) && Number.isFinite(v) && v >= min && v <= max ? v : null;
  };
  const durationMin = num('t', DEFAULT_CONFIG.minDurationMin, DEFAULT_CONFIG.maxDurationMin);
  const budgetInr = num('b', 0, 100_000);
  if (durationMin === null) return bad('duration');
  if (budgetInr === null) return bad('budget');
  const required = p.get('r') ? p.get('r')!.split(',') : [];
  if (required.length > DEFAULT_CONFIG.maxRequired || required.some((x) => !isPlaceIdentifier(x)) || new Set(required).size !== required.length) return bad('stop list');
  const backBy = p.get('k') ?? undefined;
  if (backBy !== undefined && !isHHMM(backBy)) return bad('back-by time');
  const bufferMin = p.has('f') ? num('f', 0, 30) : undefined;
  if (bufferMin === null) return bad('buffer');
  const dwellOverridesMin: Record<string, number> = Object.create(null);
  for (const pair of p.get('dw')?.split(',') ?? []) {
    const parts = pair.split('~');
    const [pid, m] = parts;
    const minutes = Number(m);
    if (parts.length !== 2 || !isPlaceIdentifier(pid ?? '') || !DECIMAL.test(m ?? '') || !Number.isFinite(minutes) || minutes < 0 || minutes > DEFAULT_CONFIG.maxDwellMin || Object.hasOwn(dwellOverridesMin, pid)) {
      return bad('stop time');
    }
    dwellOverridesMin[pid] = minutes;
  }
  const at = p.get('at') ?? undefined;
  if (at !== undefined && !isIsoInstant(at)) return bad('planning time');

  return {
    ok: true,
    shared: {
      datasetVersion: d,
      planId: id,
      at,
      request: {
        startId: s,
        occasion,
        durationMin,
        budgetInr,
        pace,
        requiredPlaceIds: required,
        requireCafe: p.get('c') === '1',
        avoidSteps: p.get('a') === '1',
        rain: p.get('w') === '1',
        ...(backBy ? { backBy } : {}),
        ...(bufferMin !== undefined ? { bufferMin } : {}),
        ...(Object.keys(dwellOverridesMin).length ? { dwellOverridesMin } : {}),
      },
    },
  };
}
