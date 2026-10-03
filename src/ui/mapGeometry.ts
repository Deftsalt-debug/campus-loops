import type { FeatureCollection, LineString } from 'geojson'
import { planGeometry } from '../core/geo'
import type { Dataset, LatLng, Plan, Place } from '../core/types'

/** The routing core uses [latitude, longitude]; GeoJSON and MapLibre use the reverse. */
export const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat]

export function placeCoordinate(dataset: Dataset, place: Place): LatLng | null {
  if (place.position) return place.position
  const anchor = dataset.nodes.find((node) => node.id === place.nodeId)
  return anchor ? [anchor.lat, anchor.lng] : null
}

export function coordinateBounds(points: LatLng[]): [[number, number], [number, number]] | null {
  if (!points.length) return null
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  for (const [lat, lng] of points) {
    west = Math.min(west, lng); east = Math.max(east, lng)
    south = Math.min(south, lat); north = Math.max(north, lat)
  }
  return [[west, south], [east, north]]
}

/** Include venue positions and walk starts, never only the currently selected outing. */
export function campusBounds(dataset: Dataset): [[number, number], [number, number]] {
  const nodes = new Map(dataset.nodes.map((node) => [node.id, node]))
  const points = dataset.places.flatMap((place) => {
    const at = placeCoordinate(dataset, place)
    return at ? [at] : []
  })
  for (const start of dataset.starts) {
    const node = nodes.get(start.nodeId)
    if (node) points.push([node.lat, node.lng])
  }
  return coordinateBounds(points) ?? [
    [dataset.location.lng - 0.008, dataset.location.lat - 0.006],
    [dataset.location.lng + 0.008, dataset.location.lat + 0.006],
  ]
}

/** Clock and price changes must not rebuild a route's lines or focusable stop markers. */
export function routeGeometryKey(plan: Plan): string {
  return JSON.stringify([plan.id, plan.startNodeId, plan.edgeIds, plan.visits.map((visit) => [visit.placeId, visit.afterEdge, visit.dwellSec === 0])])
}

export function mapRoutes(dataset: Dataset, plans: Plan[]) {
  return plans.map((plan) => {
    try { return { id: plan.id, key: routeGeometryKey(plan), geometry: planGeometry(dataset, plan) } }
    catch { return { id: plan.id, key: routeGeometryKey(plan), geometry: null } }
  })
}

export function routeFeatures(routes: ReturnType<typeof mapRoutes>): FeatureCollection<LineString, { planId: string }> {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap(({ id, geometry }) => geometry && geometry.path.length > 1 ? [{
      type: 'Feature' as const,
      properties: { planId: id },
      geometry: { type: 'LineString' as const, coordinates: geometry.path.map(lngLat) },
    }] : []),
  }
}
