// Build the demo dataset from a saved OpenStreetMap snapshot.
//
//   npm run data:osm                  convert data/osm/raw.json -> src/data/manipal-demo.json
//   npm run data:osm -- --fetch       re-download the snapshot first (one request to the OSM API)
//   npm run data:osm -- --elevation   fetch missing node elevations (OpenTopoData SRTM 30 m, cached)
//
// The result is a DEMO, not a verified pilot dataset:
// - Paths are real OSM ways but have not been walked. Covered paths and steps aren't
//   tagged in OSM here, so every edge is open and stepless until surveyed.
// - Places are real OSM features anchored to the nearest path node, not a surveyed entrance.
// - Hours come from OSM `opening_hours` where present, otherwise placeholders. Prices
//   are placeholder ranges. Each place records which, and plans show a warning.
// - isFixture stays true so `data:check --production` refuses it.
//
// Data © OpenStreetMap contributors, available under the ODbL (openstreetmap.org/copyright).
// Elevation: SRTM 30 m via OpenTopoData (opentopodata.org).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Dataset, DataSource, Edge, GraphNode, LatLng, OpenWindow, Place, PlaceCategory } from '../src/core/types';

const BBOX = { minLng: 74.786, minLat: 13.3395, maxLng: 74.7985, maxLat: 13.3555 };
const RAW = 'data/osm/raw.json';
const ELEVATION_CACHE = 'data/osm/elevation.json';
const OUT = 'src/data/manipal-demo.json';
const SNAPSHOT_DATE = '2026-10-01';
const USER_AGENT = 'CampusLoops/0.2 (student project; https://github.com/Deftsalt-debug/campus-loops)';

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
  { osm: 'n3684798238', id: 'central_library', category: 'landmark', tags: ['iconic', 'photo', 'quiet'], dwellMin: 5, spend: 'free' },
  { osm: 'w364433913', id: 'library_lawns', name: 'Lawns east of Central Library', category: 'seating', tags: ['seating', 'nature', 'scenic', 'quiet', 'conversation', 'shade'], dwellMin: 15, spend: 'free' },
  { osm: 'w186259462', id: 'kmc_greens', category: 'seating', tags: ['seating', 'nature', 'scenic', 'group', 'photo'], dwellMin: 15, spend: 'free' },
  { osm: 'w246982718', id: 'planetarium', category: 'landmark', tags: ['iconic', 'photo'], dwellMin: 5, spend: 'free' },
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

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Parse only simple OSM opening_hours such as "Mo-Su 08:00-23:00" or "Mo-Sa 09:00-21:00; Su 10:00-20:00". */
export function parseOpeningHours(value: string): OpenWindow[] | null {
  if (value.trim() === '24/7') return DAYS.map((_d, day) => ({ day, start: '00:00', end: '23:59' }));
  const windows: OpenWindow[] = [];
  for (const rule of value.split(';').map((r) => r.trim()).filter(Boolean)) {
    const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?) (\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(rule);
    if (!m) return null; // anything more complex: don't guess
    const [from, to = from] = m[1].split('-');
    // OSM weeks run Monday..Sunday; map to 0 = Sunday indices.
    const order = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    const a = order.indexOf(from);
    const b = order.indexOf(to);
    if (a > b) return null;
    const end = m[3] === '24:00' ? '23:59' : m[3];
    for (let i = a; i <= b; i++) windows.push({ day: DAYS.indexOf(order[i]), start: m[2], end });
  }
  return windows.length ? windows : null;
}

async function fetchSnapshot() {
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${BBOX.minLng},${BBOX.minLat},${BBOX.maxLng},${BBOX.maxLat}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`OSM API returned ${res.status}`);
  writeFileSync(RAW, await res.text());
  console.log(`Saved ${RAW}`);
}

async function fetchElevations(points: Map<string, LatLng>, cache: Record<string, number>) {
  const missing = [...points].filter(([id]) => cache[id] === undefined);
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const locations = batch.map(([, [lat, lng]]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join('|');
    const res = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locations}`, { headers: { 'User-Agent': USER_AGENT } });
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
if (args.includes('--fetch') || !existsSync(RAW)) await fetchSnapshot();

const raw = JSON.parse(readFileSync(RAW, 'utf8')) as { elements: OsmElement[] };
const osmNodes = new Map<number, OsmNode>();
const osmWays = new Map<number, OsmWay>();
for (const e of raw.elements) {
  if (e.type === 'node') osmNodes.set(e.id, e);
  else if (e.type === 'way') osmWays.set(e.id, e);
}

const isAllowed = (t: Record<string, string>) => {
  if (t.foot === 'no') return false;
  if ((t.access === 'private' || t.access === 'no') && !['yes', 'designated', 'permissive'].includes(t.foot ?? '')) return false;
  return true;
};

const walkWays = [...osmWays.values()].filter(
  (w) => w.tags && WALKABLE.has(w.tags.highway) && w.tags.area !== 'yes' && w.nodes.every((n) => osmNodes.has(n)),
);

// Nodes where the graph must split: way ends, shared nodes, and anchors for places and starts.
const useCount = new Map<number, number>();
for (const w of walkWays) {
  w.nodes.forEach((n, i) => useCount.set(n, (useCount.get(n) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
}

// Anchors may only sit on ways people are allowed to walk.
const wayNodeIds = [...new Set(walkWays.filter((w) => isAllowed(w.tags!)).flatMap((w) => w.nodes))];
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
const startAnchors = STARTS.map(([id, name, lat, lng]) => {
  const near = nearestWayNode(lat, lng);
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

// Keep only the largest connected component (undirected), so nothing is silently cut off.
const adjacency = new Map<number, number[]>();
for (const s of segments) {
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
const kept = segments.filter((s) => largest.has(s.from));
const keptNodeIds = new Set(kept.flatMap((s) => [s.from, s.to]));
for (const { spec, anchor } of placeAnchors) {
  if (!keptNodeIds.has(anchor)) throw new Error(`${spec.id} anchors outside the main network`);
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

const SOURCE = `OpenStreetMap snapshot ${SNAPSHOT_DATE} (unreviewed)`;
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
    allowed: isAllowed(t),
    steps: t.highway === 'steps',
    covered: t.covered === 'yes' || t.covered === 'arcade' || t.tunnel === 'building_passage',
    verifiedAt: SNAPSHOT_DATE,
    source: SOURCE,
  };
  // Vehicle one-way rules don't bind pedestrians; only explicit foot one-ways do.
  const footOneWay = t['oneway:foot'] === 'yes' || (['footway', 'path', 'steps'].includes(t.highway) && t.oneway === 'yes');
  edges.push({ id: `${s.segmentId}:f`, from: `n${s.from}`, to: `n${s.to}`, geometry, ...base });
  if (!footOneWay) edges.push({ id: `${s.segmentId}:r`, from: `n${s.to}`, to: `n${s.from}`, geometry: [...geometry].reverse(), ...base });
}

const places: Place[] = placeAnchors.map(({ spec, anchor, distance }) => {
  const osmId = Number(spec.osm.slice(1));
  const tags = (spec.osm[0] === 'n' ? osmNodes.get(osmId)?.tags : osmWays.get(osmId)?.tags) ?? {};
  const name = spec.name ?? tags.name ?? spec.id;
  const parsed = tags.opening_hours ? parseOpeningHours(tags.opening_hours) : null;
  const outdoorFree = spec.spend === 'free' && !spec.placeholderHours;
  let hoursStatus: Place['hoursStatus'] = 'always';
  let windows: OpenWindow[] = [];
  let hoursSource: DataSource = 'osm';
  if (!outdoorFree) {
    hoursStatus = 'verified';
    if (parsed) windows = parsed;
    else {
      const [start, end] = spec.placeholderHours ?? ['09:00', '21:00'];
      windows = DAYS.map((_d, day) => ({ day, start, end }));
      hoursSource = 'placeholder';
    }
  }
  return {
    id: spec.id,
    name,
    nodeId: `n${anchor}`,
    category: spec.category,
    dwellDefaultMin: spec.dwellMin,
    spendLowInr: spec.spend === 'free' ? 0 : spec.spend[0],
    spendHighInr: spec.spend === 'free' ? 0 : spec.spend[1],
    tags: spec.tags,
    verifiedOpenWindows: windows,
    hoursStatus,
    hoursSource,
    spendSource: spec.spend === 'free' ? 'osm' : 'placeholder',
    verifiedAt: SNAPSHOT_DATE,
    source: `OSM ${spec.osm[0] === 'n' ? 'node' : 'way'} ${osmId}; anchored to path node ${Math.round(distance)} m away (entrance not surveyed)`,
  };
});

const dataset: Dataset = {
  datasetVersion: `manipal-demo-${SNAPSHOT_DATE}`,
  timezone: 'Asia/Kolkata',
  isFixture: true,
  location: { lat: 13.3475, lng: 74.7925 },
  supportedWindow: { start: '06:30', end: '19:00' },
  licence:
    'Paths and places © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright). Elevation: SRTM 30 m via OpenTopoData. ' +
    'Prices are placeholders and hours are from OSM or placeholders. Not field-verified; demo only.',
  sources: ['OpenStreetMap', 'SRTM via OpenTopoData', 'placeholder estimates'],
  starts: startAnchors.map(({ id, name, anchor }) => ({ id, name, nodeId: `n${anchor}` })),
  nodes,
  edges,
  places,
  curatedWalks: [],
};

writeFileSync(OUT, JSON.stringify(dataset) + '\n');
const elevated = nodes.filter((n) => n.elevationM !== undefined).length;
console.log(
  `Wrote ${OUT}: ${nodes.length} nodes (${elevated} with elevation), ${edges.length} arcs from ${kept.length} segments ` +
    `(dropped ${segments.length - kept.length} disconnected), ${places.length} places, ${STARTS.length} starts`,
);
for (const s of startAnchors) console.log(`  start ${s.name}: snapped ${Math.round(s.distance)} m`);
for (const p of placeAnchors) console.log(`  place ${p.spec.id}: snapped ${Math.round(p.distance)} m`);
