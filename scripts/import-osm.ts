// Build the demo dataset from a saved OpenStreetMap snapshot.
//
//   npm run data:osm                  convert data/osm/raw.json -> src/data/manipal-demo.json
//   npm run data:osm -- --fetch       re-download the snapshot first (one request to the OSM API)
//   npm run data:osm -- --elevation   fetch missing node elevations (OpenTopoData SRTM 30 m, cached)
//
// The result is a DEMO, not a verified pilot dataset:
// - Paths are real OSM ways but have not been walked. Missing covered/step tags
//   are not proof that a route is sheltered or accessible.
// - Places are real OSM features anchored to the nearest path node, not a surveyed entrance.
// - Hours come from OSM `opening_hours` where present, otherwise placeholders. Prices
//   are placeholder ranges. Each place records which, and plans show a warning.
// - isFixture stays true so `data:check --production` refuses it.
//
// Data © OpenStreetMap contributors, available under the ODbL (openstreetmap.org/copyright).
// Elevation: SRTM 30 m via OpenTopoData (opentopodata.org).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validateDataset } from '../src/core/dataset/validate';
import type { Dataset, Edge, GraphNode, LatLng, Place, PlaceCategory } from '../src/core/types';
import { isPedestrianAllowed, pedestrianDirections, resolvePlaceHours } from './osm-rules';

const BBOX = { minLng: 74.786, minLat: 13.3395, maxLng: 74.7985, maxLat: 13.3555 };
const RAW = 'data/osm/raw.json';
const METADATA = 'data/osm/snapshot.json';
const ELEVATION_CACHE = 'data/osm/elevation.json';
const OUT = 'src/data/manipal-demo.json';
const USER_AGENT = 'CampusLoops/0.2 (student project; https://github.com/Deftsalt-debug/campus-loops)';
const SNAPSHOT_URL = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${BBOX.minLng},${BBOX.minLat},${BBOX.maxLng},${BBOX.maxLat}`;

const WALKABLE = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'living_street', 'residential', 'service', 'unclassified',
  'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link', 'track', 'corridor',
]);

interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }
type OsmElement = OsmNode | OsmWay | { type: 'relation'; id: number; tags?: Record<string, string> };

// ---- Curated places: which OSM features become stops, and how we describe them ----
// Tags drive occasion scoring (see src/core/planner/occasions.ts). Prices are placeholder
// ranges per person in INR until someone checks a menu.
interface PlaceSpec {
  osm: `${'n' | 'w'}${number}`;
  id: string;
  name?: string; // override, e.g. for an unnamed OSM feature
  category: PlaceCategory;
  tags: string[];
  dwellMin: number;
  spend: [number, number] | 'free';
  /** Used only when OSM has no simple opening_hours. */
  placeholderHours?: [string, string];
}

const PLACES: PlaceSpec[] = [
  { osm: 'n13781284649', id: 'starbucks', category: 'cafe', tags: ['quiet', 'conversation', 'cozy', 'sheltered', 'wifi', 'coffee'], dwellMin: 25, spend: [250, 450], placeholderHours: ['08:00', '23:00'] },
  { osm: 'n6081442985', id: 'barista', category: 'cafe', tags: ['quiet', 'conversation', 'cozy', 'sheltered', 'coffee'], dwellMin: 25, spend: [200, 400], placeholderHours: ['09:00', '22:00'] },
  { osm: 'n11874456640', id: 'sugar_plum', category: 'cafe', tags: ['dessert', 'snacks', 'cozy', 'sheltered'], dwellMin: 15, spend: [80, 200], placeholderHours: ['09:00', '21:30'] },
  { osm: 'n6081395487', id: 'hadika', category: 'cafe', tags: ['group', 'lively', 'snacks', 'sheltered'], dwellMin: 30, spend: [150, 300], placeholderHours: ['09:00', '22:30'] },
  { osm: 'n6081442986', id: 'eye_of_the_tiger', category: 'cafe', tags: ['group', 'lively', 'snacks', 'sheltered'], dwellMin: 30, spend: [150, 300], placeholderHours: ['11:00', '22:30'] },
  { osm: 'n2559569715', id: 'dollops', category: 'cafe', tags: ['group', 'lively', 'sheltered'], dwellMin: 40, spend: [200, 400], placeholderHours: ['11:00', '22:30'] },
  { osm: 'n11880467076', id: 'pai_tiffins', category: 'cafe', tags: ['snacks', 'quick', 'sheltered'], dwellMin: 20, spend: [60, 150], placeholderHours: ['07:30', '21:30'] },
  { osm: 'n6698939485', id: 'mit_cafeteria', category: 'cafe', tags: ['snacks', 'quick', 'group', 'sheltered'], dwellMin: 20, spend: [50, 150], placeholderHours: ['08:00', '20:00'] },
  { osm: 'w186260324', id: 'food_court_1', category: 'cafe', tags: ['group', 'lively', 'snacks', 'quick', 'sheltered'], dwellMin: 25, spend: [80, 200], placeholderHours: ['08:00', '21:00'] },
  { osm: 'w1174034502', id: 'food_court_2', category: 'cafe', tags: ['group', 'lively', 'snacks', 'quick', 'sheltered'], dwellMin: 25, spend: [80, 200], placeholderHours: ['08:00', '21:00'] },
  { osm: 'w408586525', id: 'chef_plates', category: 'cafe', tags: ['cozy', 'group', 'sheltered'], dwellMin: 45, spend: [300, 600], placeholderHours: ['11:00', '22:30'] },
  { osm: 'w1493868574', id: 'adithya_mess', category: 'cafe', tags: ['snacks', 'quick', 'sheltered'], dwellMin: 25, spend: [80, 180], placeholderHours: ['07:30', '22:00'] },
  { osm: 'n6641211421', id: 'student_plaza', category: 'landmark', tags: ['iconic', 'photo', 'group', 'lively', 'seating'], dwellMin: 10, spend: 'free' },
  { osm: 'n3684798238', id: 'central_library', name: 'MIT Central Library (outside)', category: 'landmark', tags: ['iconic', 'photo', 'quiet'], dwellMin: 5, spend: 'free' },
  { osm: 'w364433913', id: 'library_lawns', name: 'Lawns east of Central Library', category: 'seating', tags: ['seating', 'nature', 'scenic', 'quiet', 'conversation', 'shade'], dwellMin: 15, spend: 'free' },
  { osm: 'w186259462', id: 'kmc_greens', category: 'seating', tags: ['seating', 'nature', 'scenic', 'group', 'photo'], dwellMin: 15, spend: 'free' },
  { osm: 'w246982718', id: 'planetarium', name: 'Dr. TMA Pai Planetarium (outside)', category: 'landmark', tags: ['iconic', 'photo'], dwellMin: 5, spend: 'free' },
  { osm: 'n1969584177', id: 'tiger_circle_fountain', name: 'Fountain near Tiger Circle', category: 'waypoint', tags: ['photo'], dwellMin: 0, spend: 'free' },
];

// Public landmarks to start from: [id, display name, lat, lng]. Each snaps to the nearest path node.
const STARTS: [string, string, number, number][] = [
  ['tiger_circle', 'Tiger Circle', 13.35241, 74.78725],
  ['central_library', 'MIT Central Library', 13.3515, 74.7932],
  ['student_plaza', 'Student Plaza', 13.34732, 74.79335],
  ['kmc_greens', 'KMC Greens', 13.35346, 74.78679],
];

// ---- Helpers ----
function haversine([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

async function fetchSnapshot() {
  const res = await fetch(SNAPSHOT_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`OSM API returned ${res.status}`);
  const text = await res.text();
  const snapshot = JSON.parse(text) as { elements?: { timestamp?: string }[] };
  if (!Array.isArray(snapshot.elements) || snapshot.elements.length === 0) throw new Error('OSM returned an empty or invalid snapshot');
  const retrievedAt = new Date().toISOString();
  const metadata = {
    sourceUrl: SNAPSHOT_URL,
    retrievedAt,
    checkedLiveOn: retrievedAt.slice(0, 10),
    sha256: createHash('sha256').update(text).digest('hex'),
    latestElementEdit: snapshot.elements.map((e) => e.timestamp ?? '').sort().at(-1),
    fieldVerified: false,
  };
  // OSM nodes can move while retaining their IDs. Never reuse a height sampled
  // at an old coordinate after refreshing geometry.
  if (existsSync(ELEVATION_CACHE) && existsSync(RAW)) {
    const previous = JSON.parse(readFileSync(RAW, 'utf8')) as { elements: OsmElement[] };
    const current = new Map((snapshot.elements as OsmElement[]).filter((e) => e.type === 'node').map((e) => [e.id, e as OsmNode]));
    const cache = JSON.parse(readFileSync(ELEVATION_CACHE, 'utf8')) as Record<string, number>;
    for (const old of previous.elements) {
      if (old.type !== 'node') continue;
      const next = current.get(old.id);
      if (!next || next.lat !== old.lat || next.lon !== old.lon) delete cache[`n${old.id}`];
    }
    writeFileSync(ELEVATION_CACHE, JSON.stringify(cache, null, 1) + '\n');
  }
  writeFileSync(RAW, text);
  writeFileSync(METADATA, JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Saved ${RAW}`);
}

async function fetchElevations(points: Map<string, LatLng>, cache: Record<string, number>) {
  const missing = [...points].filter(([id]) => cache[id] === undefined);
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const locations = batch.map(([, [lat, lng]]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join('|');
    const res = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locations}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`OpenTopoData returned ${res.status}`);
    const body = (await res.json()) as { results: { elevation: number | null }[] };
    body.results.forEach((r, j) => {
      if (typeof r.elevation === 'number') cache[batch[j][0]] = r.elevation;
    });
    console.log(`  elevation ${Math.min(i + 100, missing.length)}/${missing.length}`);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // public API: 1 request per second
  }
  writeFileSync(ELEVATION_CACHE, JSON.stringify(cache, null, 1) + '\n');
}

// ---- Main ----
const args = process.argv.slice(2);
if (args.some((arg) => !['--fetch', '--elevation'].includes(arg))) throw new Error('Supported options: --fetch, --elevation');
if (args.includes('--fetch') || !existsSync(RAW)) await fetchSnapshot();

const rawText = readFileSync(RAW, 'utf8');
const metadata = JSON.parse(readFileSync(METADATA, 'utf8')) as { retrievedAt: string; sha256: string; sourceUrl: string };
if (createHash('sha256').update(rawText).digest('hex') !== metadata.sha256 || metadata.sourceUrl !== SNAPSHOT_URL) {
  throw new Error('Snapshot provenance does not match raw.json; run data:osm -- --fetch to refresh both');
}
const snapshotDate = metadata.retrievedAt.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !Number.isFinite(Date.parse(metadata.retrievedAt))) throw new Error('Invalid snapshot retrieval date');
const raw = JSON.parse(rawText) as { elements: OsmElement[] };
const osmNodes = new Map<number, OsmNode>();
const osmWays = new Map<number, OsmWay>();
for (const e of raw.elements) {
  if (e.type === 'node') osmNodes.set(e.id, e);
  else if (e.type === 'way') osmWays.set(e.id, e);
}

const walkWays = [...osmWays.values()].filter(
  (w) => w.tags && WALKABLE.has(w.tags.highway) && w.tags.area !== 'yes' && w.nodes.every((n) => osmNodes.has(n)),
);

// Nodes where the graph must split: way ends, shared nodes, and anchors for places and starts.
const useCount = new Map<number, number>();
for (const w of walkWays) {
  w.nodes.forEach((n, i) => useCount.set(n, (useCount.get(n) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
}

// Anchors may only sit on ways people are allowed to walk.
const segmentAllowed = (tags: Record<string, string>, points: number[]) => {
  const direction = pedestrianDirections(tags);
  return (direction.forward || direction.reverse) && points.every((id) => isPedestrianAllowed(osmNodes.get(id)?.tags ?? {}));
};
const wayNodeIds = [...new Set(walkWays.filter((w) => segmentAllowed(w.tags!, w.nodes)).flatMap((w) => w.nodes))];
function nearestWayNode(lat: number, lng: number): { id: number; distance: number } {
  let best = { id: -1, distance: Infinity };
  for (const id of wayNodeIds) {
    const n = osmNodes.get(id)!;
    const d = haversine([lat, lng], [n.lat, n.lon]);
    if (d < best.distance) best = { id, distance: d };
  }
  return best;
}

function centre(ref: PlaceSpec['osm']): LatLng {
  const id = Number(ref.slice(1));
  if (ref[0] === 'n') {
    const n = osmNodes.get(id);
    if (!n) throw new Error(`Node ${ref} not in snapshot`);
    return [n.lat, n.lon];
  }
  const w = osmWays.get(id);
  if (!w) throw new Error(`Way ${ref} not in snapshot`);
  const pts = w.nodes.map((n) => osmNodes.get(n)!);
  return [pts.reduce((s, p) => s + p.lat, 0) / pts.length, pts.reduce((s, p) => s + p.lon, 0) / pts.length];
}

const anchors = new Set<number>();
const placeAnchors = PLACES.map((spec) => {
  const [lat, lng] = centre(spec.osm);
  const near = nearestWayNode(lat, lng);
  if (near.distance > 120) throw new Error(`${spec.id} is ${Math.round(near.distance)} m from any path`);
  anchors.add(near.id);
  return { spec, anchor: near.id, distance: near.distance };
});
const foodCourtStarts: typeof STARTS = [
  ['food_court_1', 'MIT Food Court 1', ...centre('w186260324')],
  ['food_court_2', 'MIT Food Court 2', ...centre('w1174034502')],
];
const startAnchors = [...STARTS, ...foodCourtStarts].map(([id, name, lat, lng]) => {
  const near = nearestWayNode(lat, lng);
  if (near.distance > 120) throw new Error(`Start ${id} is ${Math.round(near.distance)} m from any path`);
  anchors.add(near.id);
  return { id, name, anchor: near.id, distance: near.distance };
});

const isSplit = (n: number) => (useCount.get(n) ?? 0) >= 2 || anchors.has(n);

// Split each way into edges between split nodes, keeping every intermediate point as geometry.
interface RawSegment { segmentId: string; from: number; to: number; points: number[]; tags: Record<string, string> }
const segments: RawSegment[] = [];
for (const w of walkWays) {
  let startIdx = 0;
  let k = 0;
  for (let i = 1; i < w.nodes.length; i++) {
    if (i === w.nodes.length - 1 || isSplit(w.nodes[i])) {
      const points = w.nodes.slice(startIdx, i + 1);
      if (points[0] !== points[points.length - 1]) {
        segments.push({ segmentId: `w${w.id}_${k++}`, from: points[0], to: points[points.length - 1], points, tags: w.tags! });
      }
      startIdx = i;
    }
  }
}

// Restricted segments must not connect otherwise unreachable public components.
const allowedSegments = segments.filter((s) => segmentAllowed(s.tags, s.points));
// Keep the largest accessible connected component; validate directed return paths below.
const adjacency = new Map<number, number[]>();
for (const s of allowedSegments) {
  adjacency.set(s.from, [...(adjacency.get(s.from) ?? []), s.to]);
  adjacency.set(s.to, [...(adjacency.get(s.to) ?? []), s.from]);
}
let largest = new Set<number>();
const seen = new Set<number>();
for (const startNode of adjacency.keys()) {
  if (seen.has(startNode)) continue;
  const component = new Set<number>([startNode]);
  const stack = [startNode];
  seen.add(startNode);
  while (stack.length) {
    for (const next of adjacency.get(stack.pop()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        component.add(next);
        stack.push(next);
      }
    }
  }
  if (component.size > largest.size) largest = component;
}
const kept = allowedSegments.filter((s) => largest.has(s.from));
const keptNodeIds = new Set(kept.flatMap((s) => [s.from, s.to]));
for (const { spec, anchor } of placeAnchors) {
  if (!keptNodeIds.has(anchor)) throw new Error(`${spec.id} anchors outside the main network`);
}
for (const { id, anchor } of startAnchors) {
  if (!keptNodeIds.has(anchor)) throw new Error(`Start ${id} anchors outside the main network`);
}

// ---- Elevation (cached; fetched only with --elevation) ----
const cache: Record<string, number> = existsSync(ELEVATION_CACHE) ? JSON.parse(readFileSync(ELEVATION_CACHE, 'utf8')) : {};
const nodePoints = new Map([...keptNodeIds].map((id) => [`n${id}`, [osmNodes.get(id)!.lat, osmNodes.get(id)!.lon] as LatLng]));
if (args.includes('--elevation')) await fetchElevations(nodePoints, cache);

const nodes: GraphNode[] = [...keptNodeIds]
  .sort((a, b) => a - b)
  .map((id) => {
    const n = osmNodes.get(id)!;
    const elevationM = cache[`n${id}`];
    return { id: `n${id}`, lat: n.lat, lng: n.lon, ...(elevationM !== undefined ? { elevationM } : {}) };
  });

const SOURCE = `OpenStreetMap snapshot ${snapshotDate} (not field-verified)`;
const edges: Edge[] = [];
for (const s of kept) {
  const geometry = s.points.map((id) => [osmNodes.get(id)!.lat, osmNodes.get(id)!.lon] as LatLng);
  let meters = 0;
  for (let i = 1; i < geometry.length; i++) meters += haversine(geometry[i - 1], geometry[i]);
  const t = s.tags;
  const base = {
    segmentId: s.segmentId,
    meters: Math.round(meters * 10) / 10,
    delaySeconds: 0,
    allowed: true,
    steps: t.highway === 'steps',
    covered: t.covered === 'yes' || t.covered === 'arcade' || t.tunnel === 'building_passage',
    verifiedAt: snapshotDate,
    source: SOURCE,
  };
  // Vehicle one-way rules don't bind pedestrians; only explicit foot one-ways do.
  const direction = pedestrianDirections(t);
  if (direction.forward) edges.push({ id: `${s.segmentId}:f`, from: `n${s.from}`, to: `n${s.to}`, geometry, ...base });
  if (direction.reverse) edges.push({ id: `${s.segmentId}:r`, from: `n${s.to}`, to: `n${s.from}`, geometry: [...geometry].reverse(), ...base });
}

const places: Place[] = placeAnchors.map(({ spec, anchor, distance }) => {
  const osmId = Number(spec.osm.slice(1));
  const tags = (spec.osm[0] === 'n' ? osmNodes.get(osmId)?.tags : osmWays.get(osmId)?.tags) ?? {};
  const name = spec.name ?? tags.name ?? spec.id;
  const hours = resolvePlaceHours(tags.opening_hours, spec.placeholderHours, spec.spend === 'free' && !spec.placeholderHours);
  return {
    id: spec.id,
    name,
    nodeId: `n${anchor}`,
    category: spec.category,
    dwellDefaultMin: spec.dwellMin,
    spendLowInr: spec.spend === 'free' ? 0 : spec.spend[0],
    spendHighInr: spec.spend === 'free' ? 0 : spec.spend[1],
    tags: spec.tags,
    ...hours,
    spendSource: 'placeholder',
    verifiedAt: snapshotDate,
    source: `OSM ${spec.osm[0] === 'n' ? 'node' : 'way'} ${osmId}; anchored to path node ${Math.round(distance)} m away (entrance not surveyed)`,
  };
});

const dataset: Dataset = {
  datasetVersion: `manipal-demo-${snapshotDate}-r2-${metadata.sha256.slice(0, 8)}`,
  timezone: 'Asia/Kolkata',
  isFixture: true,
  location: { lat: 13.3475, lng: 74.7925 },
  supportedWindow: { start: '06:30', end: '19:00' },
  licence:
    'Paths and places © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright). Elevation: SRTM 30 m via OpenTopoData. ' +
    'Prices, free stops and outdoor availability are placeholders; other hours are from OSM or placeholders. Not field-verified; demo only.',
  sources: ['OpenStreetMap', 'SRTM via OpenTopoData', 'placeholder estimates'],
  starts: startAnchors.map(({ id, name, anchor }) => ({ id, name, nodeId: `n${anchor}` })),
  nodes,
  edges,
  places,
  curatedWalks: [],
};

const errors = validateDataset(dataset).filter((issue) => issue.level === 'error');
if (errors.length) throw new Error(`Generated dataset is invalid:\n${errors.map((issue) => issue.message).join('\n')}`);
writeFileSync(OUT, JSON.stringify(dataset) + '\n');
const elevated = nodes.filter((n) => n.elevationM !== undefined).length;
console.log(
  `Wrote ${OUT}: ${nodes.length} nodes (${elevated} with elevation), ${edges.length} arcs from ${kept.length} segments ` +
    `(dropped ${segments.length - kept.length} restricted/disconnected), ${places.length} places, ${startAnchors.length} starts`,
);
for (const s of startAnchors) console.log(`  start ${s.name}: snapped ${Math.round(s.distance)} m`);
for (const p of placeAnchors) console.log(`  place ${p.spec.id}: snapped ${Math.round(p.distance)} m`);
