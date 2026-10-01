import type { Dataset, Edge, LatLng, Plan } from './types';

export function haversineM([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export interface RouteGeometry {
  /** Every point of the walked path, in order, without repeated joints. */
  path: LatLng[];
  start: LatLng;
  /** One entry per visit, in plan order, with its index into `path`. */
  stops: { placeId: string; name: string; at: LatLng; pathIndex: number; passBy: boolean }[];
  bounds: [LatLng, LatLng];
}

/** Turn a plan's edge ids back into map geometry, using the exact surveyed/OSM path shapes. */
export function planGeometry(dataset: Dataset, plan: Plan): RouteGeometry {
  const edges = new Map<string, Edge>(dataset.edges.map((e) => [e.id, e]));
  const nodes = new Map(dataset.nodes.map((n) => [n.id, n]));
  const places = new Map(dataset.places.map((p) => [p.id, p]));
  const startNode = nodes.get(plan.startNodeId)!;
  const start: LatLng = [startNode.lat, startNode.lng];

  const path: LatLng[] = [start];
  // nodeIndex[k] = index in `path` where the walk has completed k edges.
  const nodeAt: { nodeId: string; pathIndex: number }[] = [{ nodeId: plan.startNodeId, pathIndex: 0 }];
  for (const id of plan.edgeIds) {
    const edge = edges.get(id);
    if (!edge) throw new Error(`Plan uses unknown edge ${id}`);
    path.push(...edge.geometry.slice(1));
    nodeAt.push({ nodeId: edge.to, pathIndex: path.length - 1 });
  }

  // Use the scheduled arrival edge so a curated route can pass a node before
  // stopping there. Older plans without this field fall back to walk order.
  let cursor = 0;
  const stops = plan.visits.map((v) => {
    const place = places.get(v.placeId)!;
    if (!place) throw new Error(`Plan visits unknown place ${v.placeId}`);
    const k = v.afterEdge ?? nodeAt.findIndex((n, index) => index >= cursor && n.nodeId === place.nodeId);
    if (!Number.isInteger(k) || k < cursor || nodeAt[k]?.nodeId !== place.nodeId) {
      throw new Error(`Plan stop ${v.placeId} is not on the route at its scheduled arrival`);
    }
    cursor = k;
    const node = nodes.get(place.nodeId)!;
    return { placeId: v.placeId, name: v.name, at: [node.lat, node.lng] as LatLng, pathIndex: nodeAt[k].pathIndex, passBy: v.dwellSec === 0 };
  });

  let [minLat, minLng, maxLat, maxLng] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lat, lng] of path) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return { path, start, stops, bounds: [[minLat, minLng], [maxLat, maxLng]] };
}

/** Cumulative distance along a path, in metres, for each point. */
export function cumulativeDistances(path: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + haversineM(path[i - 1], path[i]));
  return out;
}
