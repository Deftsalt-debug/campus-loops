import { describe, expect, it } from 'vitest';
import { validateDataset } from '../src/core/dataset/validate';
import { googleMapsDirectionsUrl } from '../src/core/export/googleMaps';
import { planGeometry } from '../src/core/geo';
import { OCCASION_IDS, OCCASIONS } from '../src/core/planner/occasions';
import { plan } from '../src/core/planner/plan';
import type { Dataset } from '../src/core/types';
import demoJson from '../src/data/manipal-demo.json';
import { ist } from './helpers';

// The real-geometry demo around MIT Manipal, built from OpenStreetMap by scripts/import-osm.ts.
const demo = demoJson as unknown as Dataset;
const BBOX = { minLat: 13.3395, maxLat: 13.3555, minLng: 74.786, maxLng: 74.7985 };

describe('Manipal demo dataset', () => {
  it('validates with no errors, but is refused in production', () => {
    const issues = validateDataset(demo);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    const prod = validateDataset(demo, { production: true }).filter((i) => i.level === 'error').map((i) => i.code);
    expect(prod).toContain('FIXTURE');
    expect(prod).toContain('PLACEHOLDER');
  });

  it('keeps every node near the imported bounding box (OSM returns whole ways) and with an elevation', () => {
    for (const n of demo.nodes) {
      expect(n.lat).toBeGreaterThanOrEqual(BBOX.minLat - 0.01);
      expect(n.lat).toBeLessThanOrEqual(BBOX.maxLat + 0.01);
      expect(n.lng).toBeGreaterThanOrEqual(BBOX.minLng - 0.01);
      expect(n.lng).toBeLessThanOrEqual(BBOX.maxLng + 0.01);
      expect(n.elevationM).toBeTypeOf('number');
    }
  });

  it('credits OpenStreetMap', () => {
    expect(demo.licence).toContain('OpenStreetMap contributors');
    expect(demo.licence).toContain('ODbL');
  });

  // A typical weekday morning: every start and every mode should find something honest.
  it.each(demo.starts.flatMap((s) => OCCASION_IDS.map((o) => [s.id, o] as const)))('plans from %s for %s', (startId, occasion) => {
    const d = OCCASIONS[occasion].defaults;
    const res = plan(demo, { startId, occasion, ...d, requiredPlaceIds: [], avoidSteps: false, rain: false }, ist('2026-10-01', '10:30'));
    expect(res.plans.length + res.blockers.length).toBeGreaterThan(0);
    for (const p of res.plans) {
      const route = planGeometry(demo, p);
      expect(route.path[0]).toEqual(route.path[route.path.length - 1]);
      expect(googleMapsDirectionsUrl(route).url.length).toBeLessThanOrEqual(2048);
      expect(p.totalSec).toBeLessThanOrEqual(d.durationMin * 60);
    }
  });

  it('never shows two results with the same name', () => {
    for (const s of demo.starts) {
      for (const occasion of OCCASION_IDS) {
        const d = OCCASIONS[occasion].defaults;
        const res = plan(demo, { startId: s.id, occasion, ...d, requiredPlaceIds: [], avoidSteps: false, rain: false }, ist('2026-10-02', '10:30'));
        const names = res.plans.map((p) => p.name);
        expect(new Set(names).size, `${s.id} ${occasion}: ${names.join(' | ')}`).toBe(names.length);
      }
    }
  });

  it('finds real plans for the headline use case', () => {
    const res = plan(
      demo,
      { startId: 'tiger_circle', occasion: 'friends', durationMin: 60, budgetInr: 300, pace: 'normal', requiredPlaceIds: [], requireCafe: true, avoidSteps: false, rain: false },
      ist('2026-10-01', '16:00'),
    );
    expect(res.plans.length).toBeGreaterThan(0);
    expect(res.plans[0].visits.some((v) => v.category === 'cafe')).toBe(true);
    expect(res.plans[0].warnings.join(' ')).toMatch(/placeholder/);
  });
});
