// Generates src/data/fixtures/pilot-fixture.json: a SYNTHETIC dataset for
// development and tests. Every name, coordinate, price and opening time is
// made up. It is laid out on a 100 m grid near Manipal only so the map view
// lands somewhere sensible later. Never treat it as real campus data.
//
// Run: npm run data:fixture

import { writeFileSync } from 'node:fs';
import type { CuratedWalk, Dataset, Edge, GraphNode, LatLng, Place } from '../src/core/types';

const ORIGIN = { lat: 13.35, lng: 74.79 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const VERIFIED = '2026-09-20';
const SOURCE = 'synthetic fixture';

/** Grid units of 100 m east (x) and north (y) from the origin. */
const at = (x: number, y: number): LatLng => [
  Number((ORIGIN.lat + (y * 100) / M_PER_DEG_LAT).toFixed(7)),
  Number((ORIGIN.lng + (x * 100) / M_PER_DEG_LNG).toFixed(7)),
];

const nodeSpecs: [id: string, x: number, y: number, elevationM: number, label?: string][] = [
  ['gate', 0, 0, 70, 'Fixture Gate A'],
  ['n1', 1, 0, 70],
  ['n2', 2, 0, 71],
  ['n3', 3, 0, 71],
  ['lib', 4, 0, 72, 'Fixture Library Steps'],
  ['n4', 0, 1, 72],
  ['n5', 1, 1, 73],
  ['n6', 2, 1, 74],
  ['n7', 3, 1, 74],
  ['n8', 0, 2, 78],
  ['n9', 1, 2, 79],
  ['n10', 2, 2, 80],
  ['n11', 3, 2, 81],
  ['n12', 1, 3, 92],
  ['n13', 2, 3, 95],
  // An island with no path to the rest: must always be "unreachable".
  ['far1', 6, 6, 70],
  ['far2', 6.5, 6, 70],
];

const nodes: GraphNode[] = nodeSpecs.map(([id, x, y, elevationM, label]) => {
  const [lat, lng] = at(x, y);
  return { id, lat, lng, elevationM, ...(label ? { label } : {}) };
});
const nodeById = new Map(nodes.map((n) => [n.id, n]));

function meters(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dy = (points[i][0] - points[i - 1][0]) * M_PER_DEG_LAT;
    const dx = (points[i][1] - points[i - 1][1]) * M_PER_DEG_LNG;
    total += Math.hypot(dx, dy);
  }
  return Math.round(total * 10) / 10;
}

interface SegmentOptions {
  oneWay?: boolean;
  steps?: boolean;
  covered?: boolean;
  delaySeconds?: number;
  allowed?: boolean;
  verifiedAt?: string;
  /** Intermediate bend points in grid units. */
  via?: [number, number][];
}

const edges: Edge[] = [];
function segment(id: string, from: string, to: string, opts: SegmentOptions = {}) {
  const a = nodeById.get(from)!;
  const b = nodeById.get(to)!;
  const geometry: LatLng[] = [[a.lat, a.lng], ...(opts.via ?? []).map(([x, y]) => at(x, y)), [b.lat, b.lng]];
  const base = {
    segmentId: id,
    meters: meters(geometry),
    delaySeconds: opts.delaySeconds ?? 0,
    allowed: opts.allowed ?? true,
    steps: opts.steps ?? false,
    covered: opts.covered ?? false,
    verifiedAt: opts.verifiedAt ?? VERIFIED,
    source: SOURCE,
  };
  edges.push({ id: `${id}:f`, from, to, geometry, ...base });
  if (!opts.oneWay) edges.push({ id: `${id}:r`, from: to, to: from, geometry: [...geometry].reverse(), ...base });
}

// Covered corridor along the bottom row.
segment('s_g1', 'gate', 'n1', { covered: true });
segment('s_12', 'n1', 'n2', { covered: true });
segment('s_23', 'n2', 'n3', { covered: true });
segment('s_3l', 'n3', 'lib', { covered: true });
// West side; one edge has old verification data.
segment('s_g4', 'gate', 'n4', { verifiedAt: '2026-01-10' });
segment('s_48', 'n4', 'n8');
// Grid connectors.
segment('s_15', 'n1', 'n5');
segment('s_26', 'n2', 'n6', { delaySeconds: 45 }); // road crossing
segment('s_37', 'n3', 'n7');
segment('s_45', 'n4', 'n5');
segment('s_56', 'n5', 'n6', { covered: true });
segment('s_67', 'n6', 'n7');
segment('s_89', 'n8', 'n9');
segment('s_910', 'n9', 'n10');
segment('s_1011', 'n10', 'n11');
segment('s_59', 'n5', 'n9');
segment('s_610', 'n6', 'n10', { steps: true }); // short staircase
segment('s_711', 'n7', 'n11');
// Hill.
segment('s_912', 'n9', 'n12', { via: [[0.8, 2.5]] });
segment('s_1213', 'n12', 'n13');
segment('s_1013', 'n10', 'n13', { steps: true });
segment('s_1311', 'n13', 'n11', { oneWay: true }); // exit-only gate, downhill
// Restricted path: present in the data but never routable.
segment('s_7l', 'n7', 'lib', { allowed: false });
// Island.
segment('s_far', 'far1', 'far2');

const daily = (start: string, end: string) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start, end }));

const place = (p: Omit<Place, 'verifiedAt' | 'source'>): Place => ({ ...p, verifiedAt: VERIFIED, source: SOURCE });

const places: Place[] = [
  place({
    id: 'p_cafe_a', name: 'Fixture Café A', nodeId: 'n6', category: 'cafe', dwellDefaultMin: 20,
    spendLowInr: 80, spendHighInr: 120, tags: ['group', 'lively', 'snacks', 'sheltered'],
    verifiedOpenWindows: daily('08:00', '20:00'), hoursStatus: 'verified',
  }),
  place({
    id: 'p_cafe_b', name: 'Fixture Café B', nodeId: 'n11', category: 'cafe', dwellDefaultMin: 15,
    spendLowInr: 40, spendHighInr: 60, tags: ['quiet', 'conversation', 'sheltered'],
    verifiedOpenWindows: [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '18:00' })), hoursStatus: 'verified',
  }),
  place({
    id: 'p_juice', name: 'Fixture Juice Stall', nodeId: 'n3', category: 'cafe', dwellDefaultMin: 10,
    spendLowInr: null, spendHighInr: null, tags: ['snacks'],
    verifiedOpenWindows: daily('08:00', '19:00'), hoursStatus: 'verified',
  }),
  place({
    id: 'p_bench', name: 'Fixture Bench Garden', nodeId: 'n9', category: 'seating', dwellDefaultMin: 10,
    spendLowInr: 0, spendHighInr: 0, tags: ['seating', 'quiet', 'conversation', 'shade'],
    verifiedOpenWindows: [], hoursStatus: 'always',
  }),
  place({
    id: 'p_shelter', name: 'Fixture Covered Seating', nodeId: 'n5', category: 'seating', dwellDefaultMin: 10,
    spendLowInr: 0, spendHighInr: 0, tags: ['seating', 'sheltered', 'conversation'],
    verifiedOpenWindows: [], hoursStatus: 'always',
  }),
  place({
    id: 'p_view', name: 'Fixture Hilltop Viewpoint', nodeId: 'n13', category: 'landmark', dwellDefaultMin: 10,
    spendLowInr: 0, spendHighInr: 0, tags: ['view', 'photo', 'iconic'],
    verifiedOpenWindows: [], hoursStatus: 'always',
  }),
  place({
    id: 'p_tower', name: 'Fixture Clock Tower', nodeId: 'n2', category: 'landmark', dwellDefaultMin: 5,
    spendLowInr: 0, spendHighInr: 0, tags: ['iconic', 'photo', 'sheltered'],
    verifiedOpenWindows: [], hoursStatus: 'always',
  }),
  place({
    id: 'p_pond', name: 'Fixture Pond', nodeId: 'n8', category: 'waypoint', dwellDefaultMin: 0,
    spendLowInr: 0, spendHighInr: 0, tags: ['view'],
    verifiedOpenWindows: [], hoursStatus: 'always',
  }),
  place({
    id: 'p_bookshop', name: 'Fixture Bookshop', nodeId: 'n10', category: 'landmark', dwellDefaultMin: 15,
    spendLowInr: 0, spendHighInr: 0, tags: ['quiet', 'sheltered'],
    verifiedOpenWindows: [], hoursStatus: 'unknown',
  }),
  place({
    id: 'p_island', name: 'Fixture Island Kiosk', nodeId: 'far1', category: 'cafe', dwellDefaultMin: 10,
    spendLowInr: 30, spendHighInr: 50, tags: ['snacks', 'sheltered'],
    verifiedOpenWindows: daily('08:00', '20:00'), hoursStatus: 'verified',
  }),
];

const curatedWalks: CuratedWalk[] = [
  {
    id: 'w_pond',
    name: 'Fixture Pond Loop',
    startNodeId: 'gate',
    edgeIds: ['s_g4:f', 's_48:f', 's_89:f', 's_59:r', 's_15:r', 's_g1:r'],
    stops: [],
    tags: ['quiet', 'conversation', 'view'],
    verifiedAt: VERIFIED,
  },
  {
    id: 'w_hill',
    name: 'Fixture Hill Circuit',
    startNodeId: 'gate',
    edgeIds: [
      's_g1:f', 's_15:f', 's_59:f', 's_912:f', 's_1213:f', 's_1311:f',
      's_711:r', 's_37:r', 's_23:r', 's_12:r', 's_g1:r',
    ],
    stops: [{ placeId: 'p_view', afterEdge: 5 }],
    tags: ['view', 'photo'],
    verifiedAt: VERIFIED,
  },
];

const dataset: Dataset = {
  datasetVersion: 'fixture-1',
  timezone: 'Asia/Kolkata',
  isFixture: true,
  location: { lat: 13.3525, lng: 74.7928 },
  supportedWindow: { start: '07:00', end: '18:30' },
  licence: 'Synthetic development data. No real-world source; not for navigation.',
  sources: ['synthetic'],
  starts: [
    { id: 'start_gate', name: 'Fixture Gate A', nodeId: 'gate' },
    { id: 'start_lib', name: 'Fixture Library Steps', nodeId: 'lib' },
  ],
  nodes,
  edges,
  places,
  curatedWalks,
};

const out = new URL('../src/data/fixtures/pilot-fixture.json', import.meta.url);
writeFileSync(out, JSON.stringify(dataset, null, 2) + '\n');
console.log(`Wrote ${nodes.length} nodes, ${edges.length} arcs, ${places.length} places, ${curatedWalks.length} walks to ${out.pathname}`);
