// Export a dataset as GeoJSON for a visual check on https://geojson.io
// Usage: npm run data:geojson [-- path/to/dataset.json]
// Writes out/<datasetVersion>.geojson. GeoJSON uses [lng, lat] order.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { validateDataset } from '../src/core/dataset/validate';
import type { Dataset } from '../src/core/types';

const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'src/data/manipal-demo.json';
const data = JSON.parse(readFileSync(file, 'utf8')) as Dataset;
const errors = validateDataset(data).filter((issue) => issue.level === 'error');
if (errors.length) throw new Error(`Cannot export an invalid dataset: ${errors.map((issue) => issue.message).join('; ')}`);
if (!/^[a-zA-Z0-9._-]+$/.test(data.datasetVersion)) throw new Error('datasetVersion must be safe to use as a filename');
const nodes = new Map(data.nodes.map((n) => [n.id, n]));

// geojson.io understands simplestyle properties, so colour edges by what matters most.
function edgeColour(e: Dataset['edges'][number]): string {
  if (!e.allowed) return '#d62728'; // red: restricted
  if (e.steps) return '#ff7f0e'; // orange: steps
  if (e.covered) return '#2ca02c'; // green: covered
  return '#1f77b4'; // blue: open path
}

// One feature per physical segment, so two-way paths aren't drawn twice.
const seen = new Set<string>();
const edgeFeatures = data.edges
  .filter((e) => !seen.has(e.segmentId) && seen.add(e.segmentId))
  .map((e) => {
    const twoWay = data.edges.some((o) => o.segmentId === e.segmentId && o.id !== e.id);
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: e.geometry.map(([lat, lng]) => [lng, lat]) },
      properties: {
        kind: 'edge',
        segmentId: e.segmentId,
        meters: e.meters,
        oneWay: !twoWay,
        allowed: e.allowed,
        steps: e.steps,
        covered: e.covered,
        delaySeconds: e.delaySeconds,
        ascentMeters: e.ascentMeters ?? null,
        verifiedAt: e.verifiedAt,
        stroke: edgeColour(e),
        'stroke-width': 3,
      },
    };
  });

const nodeFeatures = data.nodes.map((n) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
  properties: { kind: 'node', id: n.id, label: n.label ?? null, elevationM: n.elevationM ?? null, 'marker-size': 'small', 'marker-color': '#7f7f7f' },
}));

const placeFeatures = data.places.map((p) => {
  const n = nodes.get(p.nodeId)!;
  const [lat, lng] = p.position ?? [n.lat, n.lng];
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      kind: 'place',
      id: p.id,
      name: p.name,
      routingNodeId: p.nodeId,
      osmRef: p.osmRef ?? null,
      category: p.category,
      spend: p.spendLowInr === null ? 'unknown' : `₹${p.spendLowInr}–${p.spendHighInr}`,
      hoursStatus: p.hoursStatus,
      tags: p.tags.join(', '),
      'marker-color': p.category === 'cafe' ? '#8c564b' : '#9467bd',
      'marker-symbol': p.category === 'cafe' ? 'cafe' : 'star',
    },
  };
});

const collection = { type: 'FeatureCollection', features: [...edgeFeatures, ...nodeFeatures, ...placeFeatures] };
mkdirSync('out', { recursive: true });
const outFile = `out/${data.datasetVersion}.geojson`;
writeFileSync(outFile, JSON.stringify(collection, null, 2) + '\n');
console.log(`Wrote ${outFile}: ${edgeFeatures.length} segments, ${nodeFeatures.length} nodes, ${placeFeatures.length} places`);
