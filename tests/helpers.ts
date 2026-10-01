import fixtureJson from '../src/data/fixtures/pilot-fixture.json';
import type { Dataset, Edge, GraphNode, Place } from '../src/core/types';

/** A fresh deep copy of the synthetic fixture, safe to mutate in a test. */
export function fixture(): Dataset {
  return structuredClone(fixtureJson) as unknown as Dataset;
}

/** An IST wall-clock time as a Date. 2026-10-01 is a Thursday; 2026-10-04 is a Sunday. */
export function ist(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

export type ArcSpec = [id: string, from: string, to: string, meters: number, extra?: Partial<Edge>];

/**
 * A tiny hand-checkable dataset. Nodes sit 0.001° apart so geometry is valid,
 * but routing tests only rely on the meters given here.
 */
export function tinyDataset(nodeIds: string[], arcs: ArcSpec[], places: Partial<Place>[] = []): Dataset {
  const nodes: GraphNode[] = nodeIds.map((id, i) => ({ id, lat: 13.35 + i * 0.001, lng: 74.79 }));
  const pos = new Map(nodes.map((n) => [n.id, [n.lat, n.lng] as [number, number]]));
  const edges: Edge[] = arcs.map(([id, from, to, meters, extra]) => ({
    id,
    segmentId: id,
    from,
    to,
    meters,
    delaySeconds: 0,
    geometry: [pos.get(from)!, pos.get(to)!],
    allowed: true,
    steps: false,
    covered: false,
    verifiedAt: '2026-09-20',
    source: 'test',
    ...extra,
  }));
  return {
    datasetVersion: 'tiny',
    timezone: 'Asia/Kolkata',
    isFixture: true,
    location: { lat: 13.3525, lng: 74.7928 },
    supportedWindow: { start: '07:00', end: '18:30' },
    licence: 'test',
    sources: ['test'],
    starts: [{ id: 'start', name: 'Start', nodeId: nodeIds[0] }],
    nodes,
    edges,
    places: places.map((p, i) => ({
      id: `p${i}`,
      name: `Place ${i}`,
      nodeId: nodeIds[0],
      category: 'seating',
      dwellDefaultMin: 10,
      spendLowInr: 0,
      spendHighInr: 0,
      tags: [],
      verifiedOpenWindows: [],
      hoursStatus: 'always',
      verifiedAt: '2026-09-20',
      source: 'test',
      ...p,
    })),
    curatedWalks: [],
  };
}

/** Two arcs for a path walkable both ways. */
export function twoWay(id: string, a: string, b: string, meters: number, extra: Partial<Edge> = {}): ArcSpec[] {
  return [
    [`${id}:f`, a, b, meters, { segmentId: id, ...extra }],
    [`${id}:r`, b, a, meters, { segmentId: id, ...extra }],
  ];
}
