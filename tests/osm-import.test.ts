import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPedestrianAllowed, parseOpeningHours, pedestrianDirections, resolvePlaceHours } from '../scripts/osm-rules';
import { haversineM } from '../src/core/geo';
import type { LatLng } from '../src/core/types';
import demo from '../src/data/manipal-demo.json';

describe('OSM pedestrian import rules', () => {
  it.each(['no', 'private', 'destination', 'customers', 'permit', 'use_sidepath'])('rejects foot=%s for general outings', (foot) => {
    expect(isPedestrianAllowed({ foot })).toBe(false);
  });

  it('lets explicit pedestrian permission override general vehicle restrictions', () => {
    expect(isPedestrianAllowed({ access: 'private', foot: 'yes' })).toBe(true);
    expect(isPedestrianAllowed({ access: 'yes', foot: 'private' })).toBe(false);
    expect(isPedestrianAllowed({ access: 'destination' })).toBe(false);
  });

  it('honors restricted nodes and refuses conditions the planner cannot evaluate', () => {
    expect(isPedestrianAllowed({ barrier: 'gate', access: 'private' })).toBe(false);
    expect(isPedestrianAllowed({ barrier: 'wall' })).toBe(false);
    expect(isPedestrianAllowed({ foot: 'yes', 'foot:conditional': 'no @ (sunset-sunrise)' })).toBe(false);
  });

  it('excludes locked barriers even where legal pedestrian access is granted', () => {
    expect(isPedestrianAllowed({ barrier: 'gate', foot: 'yes', locked: 'yes' })).toBe(false);
    expect(isPedestrianAllowed({ barrier: 'gate', foot: 'yes', locked: 'no' })).toBe(true);
    expect(pedestrianDirections({ highway: 'path', locked: 'yes' })).toEqual({ forward: false, reverse: false });
  });

  it('does not guess conditional lock availability', () => {
    const tags = { barrier: 'gate', foot: 'yes', locked: 'no', 'locked:conditional': 'yes @ (sunset-sunrise)' };
    expect(isPedestrianAllowed(tags)).toBe(false);
    expect(pedestrianDirections(tags)).toEqual({ forward: false, reverse: false });
  });

  it.each(['alternating', 'reversible', 'unknown', ''])('does not treat unsupported pedestrian one-way %s as two-way', (oneway) => {
    expect(pedestrianDirections({ 'oneway:foot': oneway })).toEqual({ forward: false, reverse: false });
    expect(pedestrianDirections({ highway: 'path', oneway })).toEqual({ forward: false, reverse: false });
    expect(pedestrianDirections({ highway: 'residential', oneway })).toEqual({ forward: true, reverse: true });
  });

  it('keeps vehicle one-way roads walkable in both directions', () => {
    expect(pedestrianDirections({ highway: 'residential', oneway: 'yes' })).toEqual({ forward: true, reverse: true });
  });

  it('honors forward and reversed pedestrian one-ways', () => {
    expect(pedestrianDirections({ 'oneway:foot': 'yes' })).toEqual({ forward: true, reverse: false });
    expect(pedestrianDirections({ 'oneway:foot': '-1' })).toEqual({ forward: false, reverse: true });
    expect(pedestrianDirections({ 'foot:backward': 'no' })).toEqual({ forward: true, reverse: false });
    expect(pedestrianDirections({ 'foot:forward': 'no' })).toEqual({ forward: false, reverse: true });
  });

  it('gives explicit pedestrian exceptions priority over a generic path one-way', () => {
    expect(pedestrianDirections({ highway: 'path', oneway: 'yes', 'oneway:foot': 'no' })).toEqual({ forward: true, reverse: true });
    expect(pedestrianDirections({ highway: 'steps', oneway: '-1' })).toEqual({ forward: false, reverse: true });
  });

  it('applies directional access restrictions without losing specific pedestrian permissions', () => {
    expect(pedestrianDirections({ access: 'no', 'foot:forward': 'yes' })).toEqual({ forward: true, reverse: false });
    expect(pedestrianDirections({ 'access:backward': 'no' })).toEqual({ forward: true, reverse: false });
    expect(pedestrianDirections({ foot: 'yes', 'access:backward': 'no' })).toEqual({ forward: true, reverse: true });
  });

  it.each(['foot:forward:conditional', 'foot:backward:conditional', 'access:backward:conditional', 'oneway:foot:conditional'])('does not guess conditional direction: %s', (key) => {
    expect(pedestrianDirections({ [key]: 'no @ (Mo-Fr)' })).toEqual({ forward: false, reverse: false });
  });
});

describe('OSM hours import', () => {
  it('maps weekdays to the planner week and supports different Sunday hours', () => {
    const windows = parseOpeningHours('Mo-Sa 09:00-21:00; Su 10:00-20:00');
    expect(windows).toHaveLength(7);
    expect(windows?.[0]).toEqual({ day: 1, start: '09:00', end: '21:00' });
    expect(windows?.[6]).toEqual({ day: 0, start: '10:00', end: '20:00' });
  });

  it('represents midnight conservatively within same-day planner windows', () => {
    expect(parseOpeningHours('24/7')).toHaveLength(7);
    expect(parseOpeningHours('Mo 08:00-24:00')).toEqual([{ day: 1, start: '08:00', end: '23:59' }]);
  });

  it.each(['Mo 29:00-30:00', 'Mo 08:90-20:00', 'Mo 09:00-25:00', 'Mo 24:00-24:00', 'Mo 22:00-02:00', 'Mo 09:00-09:00', 'Mo-Fr 09:00-21:00; PH off', 'Mo-Fr 09:00-17:00; Mo 10:00-12:00', 'Mo 09:00-21:00;', ''])('refuses invalid or unsupported hours: %s', (value) => {
    expect(parseOpeningHours(value)).toBeNull();
  });

  it.each(['closed', 'off', 'Mo-Fr 09:00-21:00; PH off', 'Mo 22:00-02:00'])('never replaces an explicit closure or unsupported expression with guessed hours: %s', (value) => {
    expect(resolvePlaceHours(value, ['09:00', '21:00'], false)).toEqual({ hoursStatus: 'unknown', hoursSource: 'osm', verifiedOpenWindows: [] });
    expect(resolvePlaceHours(value, undefined, true).hoursStatus).toBe('unknown');
  });

  it('uses labeled demo assumptions only when opening_hours is absent', () => {
    expect(resolvePlaceHours(undefined, ['09:00', '21:00'], false).hoursSource).toBe('placeholder');
    expect(resolvePlaceHours(undefined, undefined, true)).toEqual({ hoursStatus: 'always', hoursSource: 'placeholder', verifiedOpenWindows: [] });
    expect(resolvePlaceHours('Mo 09:00-21:00', undefined, true).hoursSource).toBe('osm');
  });
});

describe('saved map provenance', () => {
  it('ties the dated dataset to the exact saved snapshot', () => {
    const metadata = JSON.parse(readFileSync('data/osm/snapshot.json', 'utf8'));
    const bytes = readFileSync('data/osm/raw.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.sha256);
    expect(demo.datasetVersion).toBe(`manipal-demo-${metadata.retrievedAt.slice(0, 10)}-r2-${metadata.sha256.slice(0, 8)}`);
    expect(metadata.fieldVerified).toBe(false);
    expect(demo.isFixture).toBe(true);
  });

  it('places every venue at its source feature, while preserving a separate documented path anchor', () => {
    type SourceNode = { type: 'node'; id: number; lat: number; lon: number };
    type SourceWay = { type: 'way'; id: number; nodes: number[] };
    const snapshot = JSON.parse(readFileSync('data/osm/raw.json', 'utf8')) as { elements: (SourceNode | SourceWay)[] };
    const sourceNodes = new Map(snapshot.elements.filter((element): element is SourceNode => element.type === 'node').map((node) => [node.id, node]));
    const sourceWays = new Map(snapshot.elements.filter((element): element is SourceWay => element.type === 'way').map((way) => [way.id, way]));
    const anchors = new Map(demo.nodes.map((node) => [node.id, node]));
    for (const place of demo.places) {
      const [kind, id] = place.osmRef.split('/');
      const points = kind === 'node'
        ? [sourceNodes.get(Number(id))!]
        : sourceWays.get(Number(id))!.nodes.map((nodeId) => sourceNodes.get(nodeId)!);
      expect(points.length, place.id).toBeGreaterThan(0);
      expect(points.every(Boolean), place.id).toBe(true);
      // Nodes retain the original mapped coordinate; ways retain the importer
      // centre of their saved vertices, not their nearby walk-network anchor.
      const sourcePosition: LatLng = [
        points.reduce((total, point) => total + point.lat, 0) / points.length,
        points.reduce((total, point) => total + point.lon, 0) / points.length,
      ];
      expect(place.position, place.id).toEqual(sourcePosition);
      expect(place.source, place.id).toContain(`OSM ${kind} ${id};`);
      const anchor = anchors.get(place.nodeId)!;
      const distance = haversineM(sourcePosition, [anchor.lat, anchor.lng]);
      expect(distance, place.id).toBeLessThanOrEqual(120);
      expect(place.source, place.id).toContain(`anchored to path node ${Math.round(distance)} m away (entrance not surveyed)`);
    }
  });
});
