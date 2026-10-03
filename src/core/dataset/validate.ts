import { buildGraph } from '../graph/buildGraph';
import { trueSeconds } from '../graph/edgeCost';
import { dijkstra } from '../routing/dijkstra';
import { isPlaceIdentifier, isShareIdentifier } from '../identifiers';
import { isCalendarDate, isHHMM, parseHHMM } from '../time/clock';
import type { Dataset, LatLng } from '../types';
import { datasetShapeIssues } from './shape';

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface ValidateOptions {
  /** Treat fixture data as an error (use before deploying). */
  production?: boolean;
}

/** Geometry endpoints must sit within this distance of their nodes. */
const ENDPOINT_TOLERANCE_M = 3;

function metersBetween([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const r = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

const isNonNegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Check a dataset before any routing uses it. Errors mean the data is unsafe
 * to plan with; warnings are worth a look but don't block development.
 */
export function validateDataset(data: Dataset, options: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = datasetShapeIssues(data);
  if (issues.length > 0) return issues;
  const error = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message });

  for (const key of ['nodes', 'edges', 'places', 'starts', 'curatedWalks', 'sources'] as const) {
    if (!Array.isArray(data[key])) {
      error('SHAPE', `Dataset field "${key}" must be an array.`);
      return issues;
    }
  }
  for (const key of ['nodes', 'edges', 'starts'] as const) {
    if (data[key].length === 0) error('EMPTY_DATASET', `Dataset field "${key}" must contain at least one entry.`);
  }
  if (!data.datasetVersion) error('SHAPE', 'datasetVersion is missing.');
  if (!isShareIdentifier(data.datasetVersion)) error('BAD_ID', 'datasetVersion must use 1–120 letters, digits, underscores, dots, colons or hyphens.');
  if (data.timezone !== 'Asia/Kolkata') error('TIMEZONE', 'Only Asia/Kolkata is supported (fixed +05:30 offset).');
  if (!data.licence) error('SHAPE', 'Licence/source notice is missing.');
  if (!Number.isFinite(data.location.lat) || Math.abs(data.location.lat) > 90 || !Number.isFinite(data.location.lng) || Math.abs(data.location.lng) > 180) {
    error('BAD_NUMBER', 'Dataset location has invalid coordinates.');
  }
  if (!isHHMM(data.supportedWindow?.start ?? '') || !isHHMM(data.supportedWindow?.end ?? '')) {
    error('WINDOW_FORMAT', 'supportedWindow must use HH:MM times.');
  } else if (parseHHMM(data.supportedWindow.start) >= parseHHMM(data.supportedWindow.end)) {
    error('WINDOW_FORMAT', 'supportedWindow must start before it ends.');
  }
  if (data.isFixture) {
    if (options.production) error('FIXTURE', 'This is fixture data and must not be deployed.');
    else warn('FIXTURE', 'Dataset is marked as fixture/demo data: not field-verified.');
  }

  // ---- Unique IDs ----
  const checkUnique = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) error('DUPLICATE_ID', `Duplicate ${kind} id "${id}".`);
      seen.add(id);
    }
    return seen;
  };
  checkUnique('node', data.nodes.map((n) => n.id));
  const edgeIds = checkUnique('edge', data.edges.map((e) => e.id));
  const placeIds = checkUnique('place', data.places.map((p) => p.id));
  checkUnique('start', data.starts.map((s) => s.id));
  checkUnique('curated walk', data.curatedWalks.map((w) => w.id));
  const nodes = new Map(data.nodes.map((n) => [n.id, n]));

  const checkDate = (what: string, value: string) => {
    if (!isCalendarDate(value)) error('BAD_DATE', `${what} verifiedAt must be a valid YYYY-MM-DD calendar date.`);
  };

  // ---- Nodes ----
  for (const n of data.nodes) {
    if (!Number.isFinite(n.lat) || Math.abs(n.lat) > 90 || !Number.isFinite(n.lng) || Math.abs(n.lng) > 180) {
      error('BAD_NUMBER', `Node ${n.id} has invalid coordinates.`);
    }
    if (n.elevationM !== undefined && !Number.isFinite(n.elevationM)) error('BAD_NUMBER', `Node ${n.id} has invalid elevation.`);
  }

  // ---- Edges ----
  const bySegment = new Map<string, typeof data.edges>();
  for (const e of data.edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to) {
      error('MISSING_REF', `Edge ${e.id} refers to a missing node.`);
      continue;
    }
    if (e.from === e.to) error('SELF_LOOP', `Edge ${e.id} starts and ends at the same node.`);
    if (!isNonNegative(e.meters)) error('BAD_NUMBER', `Edge ${e.id} meters must be finite and nonnegative.`);
    if (!isNonNegative(e.delaySeconds)) error('BAD_NUMBER', `Edge ${e.id} delaySeconds must be finite and nonnegative.`);
    if (e.ascentMeters !== undefined && !isNonNegative(e.ascentMeters)) {
      error('BAD_NUMBER', `Edge ${e.id} ascentMeters must be finite and nonnegative.`);
    }
    checkDate(`Edge ${e.id}`, e.verifiedAt);
    if (!e.source) error('MISSING_SOURCE', `Edge ${e.id} has no source.`);

    if (!Array.isArray(e.geometry) || e.geometry.length < 2) {
      error('GEOMETRY', `Edge ${e.id} needs at least two geometry points.`);
    } else {
      if (e.geometry.some(([lat, lng]) => !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180)) {
        error('GEOMETRY', `Edge ${e.id} has invalid geometry coordinates.`);
      }
      const first = e.geometry[0];
      const last = e.geometry[e.geometry.length - 1];
      if (metersBetween(first, [from.lat, from.lng]) > ENDPOINT_TOLERANCE_M) {
        error('GEOMETRY', `Edge ${e.id} geometry does not start at node ${e.from}.`);
      }
      if (metersBetween(last, [to.lat, to.lng]) > ENDPOINT_TOLERANCE_M) {
        error('GEOMETRY', `Edge ${e.id} geometry does not end at node ${e.to}.`);
      }
      let traced = 0;
      for (let i = 1; i < e.geometry.length; i++) traced += metersBetween(e.geometry[i - 1], e.geometry[i]);
      // A path can't be shorter than its drawn line; much longer usually means a typo.
      if (isNonNegative(e.meters) && (e.meters < traced * 0.9 || e.meters > traced * 1.5 + 5)) {
        warn('LENGTH_MISMATCH', `Edge ${e.id} is ${e.meters} m but its geometry traces ${Math.round(traced)} m.`);
      }
    }
    const group = bySegment.get(e.segmentId) ?? [];
    group.push(e);
    bySegment.set(e.segmentId, group);
  }

  // ---- Segments: at most one arc each way, and a reverse arc really is the reverse ----
  for (const [segmentId, arcs] of bySegment) {
    if (arcs.length > 2) error('SEGMENT', `Segment ${segmentId} has more than two arcs.`);
    if (arcs.length === 2) {
      const [a, b] = arcs;
      if (a.from !== b.to || a.to !== b.from) error('SEGMENT', `Segment ${segmentId} arcs are not reverses of each other.`);
      if (a.meters !== b.meters || a.steps !== b.steps || a.covered !== b.covered) {
        warn('SEGMENT', `Segment ${segmentId} arcs disagree on length, steps or cover.`);
      }
    }
  }

  // ---- Places ----
  let placeholders = 0;
  for (const p of data.places) {
    if (!isPlaceIdentifier(p.id)) error('BAD_ID', `Place id "${p.id}" must use 1–120 letters, digits, underscores, colons or hyphens; dots separate stops in shared routes.`);
    if (!nodes.has(p.nodeId)) error('MISSING_REF', `Place ${p.id} refers to missing node ${p.nodeId}.`);
    if (p.position && (!Number.isFinite(p.position[0]) || Math.abs(p.position[0]) > 90 || !Number.isFinite(p.position[1]) || Math.abs(p.position[1]) > 180)) {
      error('BAD_NUMBER', `Place ${p.id} has invalid display coordinates.`);
    }
    if (p.osmRef !== undefined && p.osmRef.match(/^(node|way)\/[1-9]\d*/)?.[0] !== p.osmRef) {
      error('BAD_ID', `Place ${p.id} has an invalid OpenStreetMap feature reference.`);
    }
    if (!isNonNegative(p.dwellDefaultMin)) error('BAD_NUMBER', `Place ${p.id} dwell must be finite and nonnegative.`);
    if ((p.spendLowInr === null) !== (p.spendHighInr === null)) {
      error('SPEND_RANGE', `Place ${p.id} must have both or neither spend bounds.`);
    } else if (p.spendLowInr !== null && p.spendHighInr !== null) {
      if (!isNonNegative(p.spendLowInr) || !isNonNegative(p.spendHighInr)) error('BAD_NUMBER', `Place ${p.id} spend must be nonnegative.`);
      else if (p.spendLowInr > p.spendHighInr) error('SPEND_RANGE', `Place ${p.id} low spend exceeds high spend.`);
    } else if (p.category === 'cafe') {
      warn('UNKNOWN_PRICE', `Café ${p.id} has no checked price, so it will never be scheduled.`);
    }
    if (p.hoursStatus === 'verified' && p.verifiedOpenWindows.length === 0) {
      error('HOURS', `Place ${p.id} is marked verified but has no open windows.`);
    }
    if (p.hoursStatus === 'unknown') warn('UNKNOWN_HOURS', `Place ${p.id} has unverified hours, so it will never be scheduled.`);
    for (const w of p.verifiedOpenWindows) {
      if (!Number.isInteger(w.day) || w.day < 0 || w.day > 6 || !isHHMM(w.start) || !isHHMM(w.end)) {
        error('HOURS', `Place ${p.id} has a malformed open window.`);
      } else if (parseHHMM(w.start) >= parseHHMM(w.end)) {
        error('HOURS', `Place ${p.id} has an open window that ends before it starts.`);
      }
    }
    for (const [what, source] of [['hours', p.hoursSource], ['prices', p.spendSource]] as const) {
      if (source === 'placeholder') {
        if (options.production) error('PLACEHOLDER', `Place ${p.id} ${what} are placeholders, not checked.`);
        else placeholders++;
      }
    }
    checkDate(`Place ${p.id}`, p.verifiedAt);
    if (!p.source) error('MISSING_SOURCE', `Place ${p.id} has no source.`);
  }

  if (placeholders > 0) warn('PLACEHOLDER', `${placeholders} place hours/price values are placeholders; plans will flag them.`);

  // ---- Starts ----
  for (const s of data.starts) {
    if (!isShareIdentifier(s.id)) error('BAD_ID', `Start id "${s.id}" must use 1–120 letters, digits, underscores, dots, colons or hyphens.`);
    if (!nodes.has(s.nodeId)) error('MISSING_REF', `Start ${s.id} refers to missing node ${s.nodeId}.`);
  }

  // ---- Curated walks: continuous, closed, and stops on the route ----
  const edgesById = new Map(data.edges.map((e) => [e.id, e]));
  for (const w of data.curatedWalks) {
    if (!isShareIdentifier(w.id)) error('BAD_ID', `Walk id "${w.id}" must use 1–120 letters, digits, underscores, dots, colons or hyphens.`);
    checkDate(`Walk ${w.id}`, w.verifiedAt);
    if (!nodes.has(w.startNodeId)) error('MISSING_REF', `Walk ${w.id} starts at a missing node.`);
    if (w.edgeIds.length === 0) error('WALK_CONTINUITY', `Walk ${w.id} has no walking edges.`);
    if (new Set(w.stops.map((s) => s.placeId)).size !== w.stops.length) error('WALK_STOP', `Walk ${w.id} lists a stop more than once.`);
    const walkEdges = w.edgeIds.map((id) => edgesById.get(id));
    if (walkEdges.some((e) => !e) || w.edgeIds.some((id) => !edgeIds.has(id))) {
      error('MISSING_REF', `Walk ${w.id} refers to a missing edge.`);
      continue;
    }
    const sequence = [w.startNodeId];
    let continuous = true;
    for (const e of walkEdges) {
      if (e!.from !== sequence[sequence.length - 1]) continuous = false;
      if (!e!.allowed) error('WALK_DISALLOWED', `Walk ${w.id} uses disallowed edge ${e!.id}.`);
      sequence.push(e!.to);
    }
    if (!continuous) error('WALK_CONTINUITY', `Walk ${w.id} edges are not continuous.`);
    if (sequence[sequence.length - 1] !== w.startNodeId) error('WALK_CONTINUITY', `Walk ${w.id} does not return to its start.`);
    for (const s of w.stops) {
      const place = data.places.find((p) => p.id === s.placeId);
      if (!place || !placeIds.has(s.placeId)) {
        error('MISSING_REF', `Walk ${w.id} stop refers to missing place ${s.placeId}.`);
      } else if (!Number.isInteger(s.afterEdge) || s.afterEdge < 0 || s.afterEdge > walkEdges.length) {
        error('WALK_STOP', `Walk ${w.id} stop ${s.placeId} has an invalid position.`);
      } else if (continuous && sequence[s.afterEdge] !== place.nodeId) {
        error('WALK_STOP', `Walk ${w.id} stop ${s.placeId} is not on the route at position ${s.afterEdge}.`);
      }
    }
  }

  // Graph checks need structurally sound data; the fixture flag alone doesn't stop them.
  if (issues.some((i) => i.level === 'error' && i.code !== 'FIXTURE' && i.code !== 'PLACEHOLDER')) return issues;

  // ---- Graph checks: every start can get out and back; nothing is silently cut off ----
  const graph = buildGraph(data, { avoidSteps: false });
  const model = { paceMps: 1, climbSecPerM: 0, rain: false, rainUncoveredMultiplier: 1 };
  const seconds = (e: (typeof data.edges)[number]) => trueSeconds(e, 0, model);
  const reachedFromSomeStart = new Set<string>();
  for (const s of data.starts) {
    const out = dijkstra(graph, s.nodeId, seconds);
    const back = dijkstra(graph, s.nodeId, seconds, { reverse: true });
    out.dist.forEach((_d, id) => reachedFromSomeStart.add(id));
    const roundTripPlace = data.places.some((p) => p.nodeId !== s.nodeId && out.dist.has(p.nodeId) && back.dist.has(p.nodeId));
    const walk = data.curatedWalks.some((w) => w.startNodeId === s.nodeId);
    if (!roundTripPlace && !walk) error('START_NO_RETURN', `Start ${s.id} has no place it can reach and return from, and no curated walk.`);
  }
  for (const n of data.nodes) {
    if (!reachedFromSomeStart.has(n.id)) warn('UNREACHABLE_NODE', `Node ${n.id} can't be reached from any start.`);
  }
  for (const p of data.places) {
    if (!reachedFromSomeStart.has(p.nodeId)) warn('UNREACHABLE_PLACE', `Place ${p.id} can't be reached from any start.`);
  }
  return issues;
}
