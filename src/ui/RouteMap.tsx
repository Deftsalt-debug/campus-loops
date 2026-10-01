import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { planGeometry } from '../core/geo'
import type { Dataset, Plan } from '../core/types'
import { clock } from './format'
import { escapeHtml, mapTileConfiguration } from './mapTiles'

// The planner and itinerary work independently of the optional map library and
// third-party tile service. Only tiles for the viewed area are requested.
const tileConfig = mapTileConfiguration({
  VITE_MAP_TILE_URL: import.meta.env.VITE_MAP_TILE_URL,
  VITE_MAP_TILE_ATTRIBUTION: import.meta.env.VITE_MAP_TILE_ATTRIBUTION,
  VITE_MAP_TILE_MAX_ZOOM: import.meta.env.VITE_MAP_TILE_MAX_ZOOM,
})
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Props {
  dataset: Dataset
  plans: Plan[]
  selectedId: string | null
  hoveredId: string | null
  startSec: number | null
  onSelect: (id: string) => void
}

interface RouteLayers {
  geometryKey: string
  group: Leaflet.LayerGroup
  casing: Leaflet.Polyline
  line: Leaflet.Polyline
  markers: Leaflet.LayerGroup
  startMarker: Leaflet.Marker
  stopMarkers: Leaflet.Marker[]
  geometry: ReturnType<typeof planGeometry>
  bounds: Leaflet.LatLngBounds
}

/** A clock tick does not change geometry, even when the planner returns new objects. */
function geometryKey(plan: Plan): string {
  return JSON.stringify([plan.startNodeId, plan.edgeIds, plan.visits.map((visit) => [visit.placeId, visit.afterEdge, visit.dwellSec === 0])])
}

export function RouteMap({ dataset, plans, selectedId, hoveredId, startSec, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const instructionsId = useId()
  const [L, setL] = useState<typeof Leaflet | null>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const layers = useRef<Leaflet.LayerGroup | null>(null)
  const routes = useRef(new Map<string, RouteLayers>())
  const select = useRef(onSelect)
  const retryTiles = useRef<(() => void) | null>(null)
  const fittedKey = useRef('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'tiles-failed'>('loading')
  const geometries = useMemo(() => plans.map((plan) => {
    try { return { plan, key: geometryKey(plan), route: planGeometry(dataset, plan) } }
    catch { return { plan, key: geometryKey(plan), route: null } }
  }), [dataset, plans])
  const routeFailed = geometries.some(({ route }) => !route)

  useEffect(() => { select.current = onSelect }, [onSelect])

  useEffect(() => {
    let cancelled = false
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => !cancelled && setL(mod.default ?? mod))
      .catch(() => !cancelled && setStatus('failed'))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!L || !el.current) return
    const container = el.current
    const routeCache = routes.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    let m: Leaflet.Map | null = null
    let observer: ResizeObserver | null = null
    let resizeFrame = 0
    let slowTilesTimer = 0
    let tiles: Leaflet.TileLayer | null = null
    let active = true
    const failures = new Set<HTMLImageElement>()

    const updateTileStatus = () => {
      if (active) setStatus(failures.size ? 'tiles-failed' : 'ready')
    }
    const retry = () => {
      if (!tiles || !active) return
      failures.clear()
      tiles.redraw()
      setStatus('loading')
    }
    const onMotion = () => {
      if (!m) return
      // Zoom transitions stay disabled across preference changes: touch-zoom
      // completion also reads this option instead of the cached map capability.
      m.options.fadeAnimation = !reduced.matches
      m.options.inertia = !reduced.matches
      if (reduced.matches) m.stop()
    }
    const onTheme = () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0d7a55'
      for (const route of routeCache.values()) {
        if (route.line.options.opacity === 1) route.line.setStyle({ color: accent })
      }
    }
    const onReducedKeys = (event: KeyboardEvent) => {
      // Arrow keys on a child control or marker belong to that control, not the map.
      if (!m || event.target !== container || !reduced.matches || event.altKey || event.ctrlKey || event.metaKey) return
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const direction = directions[event.key]
      if (!direction) return
      const delta = (m.options.keyboardPanDelta ?? 80) * (event.shiftKey ? 3 : 1)
      event.preventDefault()
      event.stopPropagation()
      m.panBy([direction[0] * delta, direction[1] * delta], { animate: false })
    }
    const onResize = () => {
      if (resizeFrame) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0
        if (active) m?.invalidateSize({ pan: false, animate: false, debounceMoveend: true })
      })
    }
    try {
      m = L.map(container, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
        trackResize: false,
        // Leaflet 1.9.4 leaves its zoom-completion timeout alive after remove().
        // This map remounts at layout breakpoints, so avoid that transition path
        // through the public options while retaining normal pan and tile fades.
        zoomAnimation: false,
        fadeAnimation: !reduced.matches,
        markerZoomAnimation: false,
        inertia: !reduced.matches,
        // SVG paths remain selectable; Leaflet handles their projection on zoom.
        preferCanvas: false,
        maxZoom: tileConfig.ok ? tileConfig.maxZoom : 19,
      })
      map.current = m
      layers.current = L.layerGroup().addTo(m)
      if (tileConfig.ok) {
        tiles = L.tileLayer(tileConfig.url, {
          maxZoom: tileConfig.maxZoom,
          attribution: tileConfig.attribution,
          // Keep browser caching and the origin Referer required by OSM.
          referrerPolicy: 'strict-origin-when-cross-origin',
          updateWhenIdle: true,
          updateWhenZooming: false,
          keepBuffer: 1,
        })
        tiles.on('loading', () => {
          window.clearTimeout(slowTilesTimer)
          slowTilesTimer = window.setTimeout(() => {
            if (active && tiles?.isLoading()) setStatus('tiles-failed')
          }, 12_000)
        })
        tiles.on('tileerror', ({ tile }) => {
          failures.add(tile)
          if (active) setStatus('tiles-failed')
        })
        tiles.on('tileload', ({ tile }) => { failures.delete(tile) })
        tiles.on('tileunload', ({ tile }) => {
          failures.delete(tile)
          if (!tiles?.isLoading()) updateTileStatus()
        })
        tiles.on('load', () => {
          window.clearTimeout(slowTilesTimer)
          updateTileStatus()
        })
        tiles.addTo(m)
        retryTiles.current = retry
        window.addEventListener('online', retry)
      }

      const placeLayer = L.layerGroup().addTo(m)
      const nodes = new Map(dataset.nodes.map((node) => [node.id, node]))
      const placeIcon = L.divIcon({ className: '', html: '<div class="place-dot"></div>', iconSize: [10, 10] })
      for (const place of dataset.places) {
        const node = nodes.get(place.nodeId)
        if (!node) continue
        L.marker([node.lat, node.lng], { icon: placeIcon, keyboard: false, title: place.name })
          .bindTooltip(escapeHtml(place.name), { direction: 'top', offset: [0, -6] })
          .addTo(placeLayer)
      }
      const focus = [...dataset.places.map((place) => place.nodeId), ...dataset.starts.map((start) => start.nodeId)]
        .map((id) => nodes.get(id))
        .filter((node) => node !== undefined)
        .map((node) => [node.lat, node.lng] as [number, number])
      if (focus.length) m.fitBounds(focus, { padding: [20, 20], maxZoom: Math.min(17, tileConfig.ok ? tileConfig.maxZoom : 19), animate: false })
      else m.setView([dataset.location.lat, dataset.location.lng], 15)
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(onResize)
        observer.observe(container)
      } else {
        window.addEventListener('resize', onResize)
      }
      reduced.addEventListener('change', onMotion)
      dark.addEventListener('change', onTheme)
      container.addEventListener('keydown', onReducedKeys)
    } catch {
      // Report initialization errors after the imperative setup has unwound.
      // Guard the deferred update in case this map was removed in the meantime.
      queueMicrotask(() => { if (active) setStatus('failed') })
    }
    return () => {
      active = false
      window.clearTimeout(slowTilesTimer)
      cancelAnimationFrame(resizeFrame)
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('online', retry)
      reduced.removeEventListener('change', onMotion)
      dark.removeEventListener('change', onTheme)
      container.removeEventListener('keydown', onReducedKeys)
      retryTiles.current = null
      m?.remove()
      map.current = null
      layers.current = null
      routeCache.clear()
      fittedKey.current = ''
    }
  }, [L, dataset])

  // Retain paths and keyboard-focusable markers across hovering and clock ticks.
  // Rebuild only when a plan's actual walked geometry changes.
  useEffect(() => {
    const group = layers.current
    if (!L || !map.current || !group) return
    const retained = new Set(plans.map((plan) => plan.id))
    for (const [id, route] of routes.current) {
      if (!retained.has(id)) {
        group.removeLayer(route.group)
        routes.current.delete(id)
      }
    }
    for (const { plan, key, route: geometry } of geometries) {
      const previous = routes.current.get(plan.id)
      if (geometry && previous?.geometryKey === key) continue
      if (previous) {
        group.removeLayer(previous.group)
        routes.current.delete(plan.id)
      }
      if (geometry) {
        const routeGroup = L.layerGroup().addTo(group)
        const casing = L.polyline(geometry.path, { color: '#ffffff', weight: 9, opacity: 0, interactive: false }).addTo(routeGroup)
        const line = L.polyline(geometry.path, { color: '#7d8a84', weight: 4, opacity: 0.55, dashArray: '6 8' })
          .on('click', () => select.current(plan.id))
          .bindTooltip(escapeHtml(plan.name), { sticky: true })
          .addTo(routeGroup)
        const markers = L.layerGroup()
        const startMarker = L.marker(geometry.start, {
          icon: L.divIcon({ className: '', html: '<div class="pin start">S</div>', iconSize: [32, 32] }),
          zIndexOffset: 1000,
          autoPanOnFocus: false,
        }).bindTooltip('', { direction: 'top', offset: [0, -14] }).addTo(markers)
        let stopNumber = 0
        const stopMarkers = geometry.stops.map((stop) => {
          const html = stop.passBy ? '<div class="pin pass"></div>' : `<div class="pin">${++stopNumber}</div>`
          const size: [number, number] = stop.passBy ? [14, 14] : [28, 28]
          return L.marker(stop.at, {
            icon: L.divIcon({ className: '', html, iconSize: size }),
            zIndexOffset: 900,
            autoPanOnFocus: false,
          }).bindTooltip('', { direction: 'top', offset: [0, -12] }).addTo(markers)
        })
        routes.current.set(plan.id, { geometryKey: key, group: routeGroup, casing, line, markers, startMarker, stopMarkers, geometry, bounds: L.latLngBounds(geometry.path) })
      }
    }
  }, [L, dataset, plans, geometries])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0d7a55'
    // Keyboard edits or a clock tick can remove a card while the pointer stays
    // still. A stale hover must not hide the newly selected route and its pins.
    const focusId = hoveredId && routes.current.has(hoveredId) ? hoveredId : selectedId
    for (const [id, route] of routes.current) {
      const focused = id === focusId
      route.casing.setStyle({ opacity: focused ? 0.9 : 0 })
      route.line.setStyle({ color: focused ? accent : '#7d8a84', weight: focused ? 5 : 4, opacity: focused ? 1 : 0.55, dashArray: focused ? undefined : '6 8' })
      if (focused) {
        route.casing.bringToFront()
        route.line.bringToFront()
        if (!route.group.hasLayer(route.markers)) route.group.addLayer(route.markers)
      } else {
        route.group.removeLayer(route.markers)
      }
    }
    // Fitting depends on selected geometry, never a hover or a clock change.
    const selected = selectedId ? routes.current.get(selectedId) : undefined
    const key = selected ? `${selectedId}|${selected.geometryKey}` : ''
    if (selected && key !== fittedKey.current) {
      fittedKey.current = key
      m.stop()
      m.fitBounds(selected.bounds, { padding: [40, 40], maxZoom: Math.min(18, tileConfig.ok ? tileConfig.maxZoom : 19), animate: !prefersReducedMotion() })
    }
  }, [L, dataset, plans, selectedId, hoveredId])

  useEffect(() => {
    for (const plan of plans) {
      const route = routes.current.get(plan.id)
      if (!route) continue
      route.line.setTooltipContent(escapeHtml(plan.name))
      const startName = dataset.starts.find((start) => start.nodeId === plan.startNodeId)?.name ?? 'Start'
      route.startMarker.setTooltipContent(`<b>Start &amp; finish</b><br>${escapeHtml(startName)}`)
      const startElement = route.startMarker.getElement()
      startElement?.setAttribute('aria-label', `Start and finish: ${startName}`)
      if (startElement) startElement.title = `Start and finish: ${startName}`
      route.stopMarkers.forEach((marker, i) => {
        const visit = plan.visits[i]
        const stop = route.geometry.stops[i]
        const when = startSec !== null ? `${clock(startSec + visit.arriveOffsetSec)} · ` : ''
        const what = stop.passBy ? 'pass by' : `${Math.round(visit.dwellSec / 60)} min`
        marker.setTooltipContent(`<b>${escapeHtml(visit.name)}</b><br>${when}${what}`)
        const markerElement = marker.getElement()
        const label = `${visit.name}, ${when}${what}`
        markerElement?.setAttribute('aria-label', label)
        if (markerElement) markerElement.title = label
      })
    }
  }, [L, dataset, plans, startSec, selectedId, hoveredId])

  const selectedName = plans.find((plan) => plan.id === selectedId)?.name
  const showRoute = () => {
    const m = map.current
    const route = selectedId ? routes.current.get(selectedId) : undefined
    if (!m || !route) return
    m.stop()
    m.fitBounds(route.bounds, { padding: [40, 40], maxZoom: Math.min(18, tileConfig.ok ? tileConfig.maxZoom : 19), animate: !prefersReducedMotion() })
  }
  return (
    <div className="map-shell">
      <p id={instructionsId} className="sr-only">Use the arrow keys to move the map and plus or minus to zoom. Tab to route stops for details. The itinerary also lists every stop.</p>
      <div ref={el} className="map" role="region" aria-label={selectedName ? `Route map: ${selectedName}` : 'Campus route map'} aria-describedby={instructionsId} tabIndex={0} />
      {selectedName && geometries.some(({ plan, route }) => plan.id === selectedId && route) && L && status !== 'failed' && <button type="button" className="btn map-refit" onClick={showRoute} aria-label={`Show the entire route for ${selectedName}`}>Show entire route</button>}
      {status === 'loading' && tileConfig.ok && <p className="map-status notice" role="status">Loading map…</p>}
      {status === 'failed' && <div className="map-status notice" role="status"><p>The map couldn't load. Use the itinerary list for the route, or reload to try again.</p><button type="button" className="btn" onClick={() => window.location.reload()}>Reload map</button></div>}
      {!tileConfig.ok && status !== 'failed' && <p className="map-status notice" role="status">Map pictures are unavailable: {tileConfig.message} Use the itinerary list.</p>}
      {routeFailed && status === 'ready' && <p className="map-status notice" role="status">Some route lines couldn't be drawn. Use the itinerary list.</p>}
      {status === 'tiles-failed' && (
        <div className="map-status notice" role="status">
          <p>Map pictures are unavailable or taking too long. Route lines use the loaded campus data; check local conditions before you go.</p>
          <button type="button" className="btn" onClick={() => retryTiles.current?.()}>Retry map pictures</button>
        </div>
      )}
    </div>
  )
}
