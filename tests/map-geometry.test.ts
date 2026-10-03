import { describe, expect, it } from 'vitest'
import { plan } from '../src/core/planner/plan'
import { planGeometry } from '../src/core/geo'
import { campusBounds, coordinateBounds, lngLat, mapRoutes, placeCoordinate, routeFeatures, routeGeometryKey } from '../src/ui/mapGeometry'
import { fixture, ist, tinyDataset, twoWay } from './helpers'

const dataset = fixture()
const selected = plan(dataset, {
  startId: 'start_gate', durationMin: 60, budgetInr: 200, occasion: 'friends',
  requiredPlaceIds: [], requireCafe: false, pace: 'normal', avoidSteps: false, rain: false,
}, ist('2026-10-01', '10:00')).plans[0]

describe('native street-map geometry', () => {
  it('preserves every bend of the planner route in GeoJSON longitude/latitude order', () => {
    const geometry = planGeometry(dataset, selected)
    const feature = routeFeatures(mapRoutes(dataset, [selected])).features[0]
    expect(feature.properties.planId).toBe(selected.id)
    expect(feature.geometry.coordinates).toEqual(geometry.path.map(([lat, lng]) => [lng, lat]))
    expect(feature.geometry.coordinates[0]).toEqual(feature.geometry.coordinates.at(-1))
    expect(dataset.edges).not.toHaveLength(0)
  })

  it('excludes a broken route without losing valid alternative lines', () => {
    const broken = { ...selected, id: 'invalid', edgeIds: ['missing'] }
    const mapped = mapRoutes(dataset, [broken, selected])
    expect(mapped[0].geometry).toBeNull()
    expect(routeFeatures(mapped).features.map((feature) => feature.properties.planId)).toEqual([selected.id])
  })

  it('puts venue labels at mapped feature coordinates while route stops stay on their walking anchors', () => {
    const copy = structuredClone(dataset)
    const visited = copy.places.find((place) => place.id === selected.visits[0].placeId)!
    const originalStop = planGeometry(copy, selected).stops[0].at
    visited.position = [13.35, 74.78]
    expect(placeCoordinate(copy, visited)).toEqual([13.35, 74.78])
    expect(planGeometry(copy, selected).stops[0].at).toEqual(originalStop)
    expect(planGeometry(copy, selected).stops[0].at).not.toEqual(visited.position)
  })

  it('falls back to an existing walk anchor without inventing coordinates for an unknown node', () => {
    const d = tinyDataset(['A', 'B'], twoWay('ab', 'A', 'B', 100), [{ nodeId: 'B' }, { nodeId: 'missing' }])
    expect(placeCoordinate(d, d.places[0])).toEqual([d.nodes[1].lat, d.nodes[1].lng])
    expect(placeCoordinate(d, d.places[1])).toBeNull()
  })

  it('frames source venue coordinates and starts across the campus rather than only their anchors', () => {
    const d = tinyDataset(['A', 'B'], twoWay('ab', 'A', 'B', 100), [{ nodeId: 'B', position: [13.36, 74.81] }])
    expect(campusBounds(d)).toEqual([[74.79, 13.35], [74.81, 13.36]])
    expect(coordinateBounds([])).toBeNull()
    d.places = []; d.starts = []
    expect(campusBounds(d)[0][0]).toBeLessThan(d.location.lng)
    expect(campusBounds(d)[1][1]).toBeGreaterThan(d.location.lat)
  })

  it('keeps marker geometry stable across clock ticks but invalidates changed walking paths and pass-by stops', () => {
    expect(routeGeometryKey({ ...selected, totalSec: selected.totalSec + 60, visits: selected.visits.map((visit) => ({ ...visit, arriveOffsetSec: visit.arriveOffsetSec + 60 })) })).toBe(routeGeometryKey(selected))
    expect(routeGeometryKey({ ...selected, edgeIds: [...selected.edgeIds, 'new-edge'] })).not.toBe(routeGeometryKey(selected))
    expect(routeGeometryKey({ ...selected, visits: selected.visits.map((visit) => ({ ...visit, dwellSec: visit.dwellSec === 0 ? 60 : 0 })) })).not.toBe(routeGeometryKey(selected))
    expect(lngLat([13.35, 74.79])).toEqual([74.79, 13.35])
  })
})
