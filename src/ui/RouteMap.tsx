import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { planGeometry } from '../core/geo'
import type { Dataset, Plan } from '../core/types'
import { clock } from './format'
import { useMediaQuery } from './hooks'
import { Icon } from './icons'
import { escapeHtml, mapTileConfiguration } from './mapTiles'
import { releaseTouchZoom } from './mapLifecycle'

// The planner and itinerary work independently of the optional map library and
// third-party tile service. Only tiles for the viewed area are requested.
const tileConfig = mapTileConfiguration({
  VITE_MAP_TILE_URL: import.meta.env.VITE_MAP_TILE_URL,
  VITE_MAP_TILE_ATTRIBUTION: import.meta.env.VITE_MAP_TILE_ATTRIBUTION,
  VITE_MAP_TILE_MAX_ZOOM: import.meta.env.VITE_MAP_TILE_MAX_ZOOM,
})
const MAX_FIT_ZOOM = Math.min(18, tileConfig.ok ? tileConfig.maxZoom : 19)
const MUTED = '#8a968f'

/** A stop in the selected walk: an index into its visits, or its start/finish. */
export type StopIndex = number | 'start'
export interface StopFocus {
  planId: string
  index: StopIndex
  /** Pan the map to it (an explicit "show on map"), rather than only highlighting. */
  reveal: boolean
}

interface Props {
  dataset: Dataset
  plans: Plan[]
  selectedId: string | null
  hoveredId: string | null
  startSec: number | null
  focus: StopFocus | null
  /** One-finger panning. Off for the inline phone map so the page can scroll past it. */
  touchPan: boolean
  /** Changing this re-frames the selected route, e.g. after the map changes size. */
  refitKey?: number
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onFocusStop: (focus: StopFocus | null) => void
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

const accentColour = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0d7a55'

/**
 * Leaflet 1.9.4 schedules its zoom-transition end 250 ms after a zoom starts and
 * does not cancel it in remove(). Mark the transition finished first, so that
 * callback returns early instead of touching removed panes.
 */
function removeMap(m: Leaflet.Map, L: typeof Leaflet) {
  releaseTouchZoom(m, L)
  m.stop()
  ;(m as unknown as { _animatingZoom?: boolean })._animatingZoom = false
  m.remove()
}

/** Draw the selected line from start to finish. Purely visual; cancelled by the next draw. */
function drawIn(line: Leaflet.Polyline): () => void {
  const path = line.getElement() as SVGPathElement | undefined
  if (!path || typeof path.getTotalLength !== 'function') return () => {}
  const length = path.getTotalLength()
  if (!(length > 0)) return () => {}
  const finish = () => {
    window.clearTimeout(fallback)
    path.removeEventListener('transitionend', finish)
    path.classList.remove('route-drawing')
    path.style.strokeDasharray = ''
    path.style.strokeDashoffset = ''
  }
  path.style.strokeDasharray = `${length}`
  path.style.strokeDashoffset = `${length}`
  path.getBoundingClientRect() // commit the hidden state before transitioning
  path.classList.add('route-drawing')
  path.style.strokeDashoffset = '0'
  path.addEventListener('transitionend', finish)
  const fallback = window.setTimeout(finish, 1400)
  return finish
}

export function RouteMap({ dataset, plans, selectedId, hoveredId, startSec, focus, touchPan, refitKey = 0, onSelect, onHover, onFocusStop }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const instructionsId = useId()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [L, setL] = useState<typeof Leaflet | null>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const layers = useRef<Leaflet.LayerGroup | null>(null)
  const routes = useRef(new Map<string, RouteLayers>())
  const callbacks = useRef({ onSelect, onHover, onFocusStop })
  const retryTiles = useRef<(() => void) | null>(null)
  const fittedKey = useRef('')
  // Read once per theme: getComputedStyle forces a full style recalculation.
  const accent = useRef('#0d7a55')
  const drawnKey = useRef('')
  const cancelDraw = useRef<() => void>(() => {})
  // Bumped whenever a new Leaflet map is created, so dependent layers rebuild.
  const [epoch, setEpoch] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'tiles-failed'>('loading')
  const geometries = useMemo(() => plans.map((plan) => {
    try { return { plan, key: geometryKey(plan), route: planGeometry(dataset, plan) } }
    catch { return { plan, key: geometryKey(plan), route: null } }
  }), [dataset, plans])
  const routeFailed = geometries.some(({ route }) => !route)

  useEffect(() => { callbacks.current = { onSelect, onHover, onFocusStop } }, [onSelect, onHover, onFocusStop])

  useEffect(() => {
    let cancelled = false
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => !cancelled && setL(mod.default ?? mod))
      .catch(() => !cancelled && setStatus('failed'))
    return () => { cancelled = true }
  }, [])

  // One map for the lifetime of the page. It is only recreated if the motion
  // preference changes, because Leaflet reads zoom animation at creation.
  useEffect(() => {
    if (!L || !el.current) return
    const container = el.current
    const routeCache = routes.current
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
    const onTheme = () => {
      accent.current = accentColour()
      for (const route of routeCache.values()) {
        if (route.line.options.opacity === 1) route.line.setStyle({ color: accent.current })
      }
    }
    accent.current = accentColour()
    const onReducedKeys = (event: KeyboardEvent) => {
      // Arrow keys on a child control or marker belong to that control, not the map.
      if (!m || event.target !== container || !reducedMotion || event.altKey || event.ctrlKey || event.metaKey) return
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
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
        dragging: false,
        trackResize: false,
        zoomAnimation: !reducedMotion,
        fadeAnimation: !reducedMotion,
        markerZoomAnimation: !reducedMotion,
        inertia: !reducedMotion,
        // Integer zoom keeps raster tiles crisp; fractional zoom scales (blurs) them.
        wheelPxPerZoomLevel: 90,
        // SVG paths remain selectable; Leaflet handles their projection on zoom.
        preferCanvas: false,
        maxZoom: tileConfig.ok ? tileConfig.maxZoom : 19,
      })
      L.control.zoom({ position: 'bottomright' }).addTo(m)
      map.current = m
      layers.current = L.layerGroup().addTo(m)
      if (tileConfig.ok) {
        tiles = L.tileLayer(tileConfig.url, {
          maxZoom: tileConfig.maxZoom,
          attribution: tileConfig.attribution,
          // Keep browser caching and the origin Referer required by OSM.
          referrerPolicy: 'strict-origin-when-cross-origin',
          // Leaflet's defaults: load while panning on desktop, after on phones,
          // and keep two rows of loaded tiles so short pans never flash grey.
          keepBuffer: 2,
          className: 'map-tiles',
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
      const focusPoints = [...dataset.places.map((place) => place.nodeId), ...dataset.starts.map((start) => start.nodeId)]
        .map((id) => nodes.get(id))
        .filter((node) => node !== undefined)
        .map((node) => [node.lat, node.lng] as [number, number])
      if (focusPoints.length) m.fitBounds(focusPoints, { padding: [20, 20], maxZoom: Math.min(17, MAX_FIT_ZOOM), animate: false })
      else m.setView([dataset.location.lat, dataset.location.lng], 15)
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(onResize)
        observer.observe(container)
      } else {
        window.addEventListener('resize', onResize)
      }
      dark.addEventListener('change', onTheme)
      container.addEventListener('keydown', onReducedKeys)
      // Let the dependent effects rebuild routes on this map once setup has finished.
      queueMicrotask(() => { if (active) setEpoch((e) => e + 1) })
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
      dark.removeEventListener('change', onTheme)
      container.removeEventListener('keydown', onReducedKeys)
      cancelDraw.current()
      retryTiles.current = null
      if (m) removeMap(m, L)
      map.current = null
      layers.current = null
      routeCache.clear()
      fittedKey.current = ''
      drawnKey.current = ''
    }
  }, [L, dataset, reducedMotion])

  // Panning and wheel zoom follow the layout without recreating the map.
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (touchPan) { m.dragging.enable(); m.scrollWheelZoom.enable() } else { m.dragging.disable(); m.scrollWheelZoom.disable() }
  }, [touchPan, epoch])

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
        const id = plan.id
        const routeGroup = L.layerGroup().addTo(group)
        const casing = L.polyline(geometry.path, { color: '#ffffff', weight: 10, opacity: 0, interactive: false, className: 'route-casing' }).addTo(routeGroup)
        const line = L.polyline(geometry.path, { color: MUTED, weight: 4, opacity: 0.6, dashArray: '6 8', className: 'route-line' })
          .on('click', () => callbacks.current.onSelect(id))
          .on('mouseover', () => callbacks.current.onHover(id))
          .on('mouseout', () => callbacks.current.onHover(null))
          .bindTooltip(escapeHtml(plan.name), { sticky: true, className: 'route-tip' })
          .addTo(routeGroup)
        const markers = L.layerGroup()
        const startMarker = L.marker(geometry.start, {
          icon: L.divIcon({ className: '', html: '<div class="pin start">S</div>', iconSize: [32, 32] }),
          zIndexOffset: 1000,
          autoPanOnFocus: false,
        }).bindTooltip('', { direction: 'top', offset: [0, -14] })
          .on('click', () => { callbacks.current.onSelect(id); callbacks.current.onFocusStop({ planId: id, index: 'start', reveal: false }) })
          .addTo(markers)
        let stopNumber = 0
        const stopMarkers = geometry.stops.map((stop, i) => {
          const html = stop.passBy ? `<div class="pin pass" style="--i:${i}"></div>` : `<div class="pin" style="--i:${i}">${++stopNumber}</div>`
          const size: [number, number] = stop.passBy ? [14, 14] : [28, 28]
          return L.marker(stop.at, {
            icon: L.divIcon({ className: '', html, iconSize: size }),
            zIndexOffset: 900,
            autoPanOnFocus: false,
          }).bindTooltip('', { direction: 'top', offset: [0, -12] })
            .on('click', () => { callbacks.current.onSelect(id); callbacks.current.onFocusStop({ planId: id, index: i, reveal: false }) })
            .addTo(markers)
        })
        routes.current.set(plan.id, { geometryKey: key, group: routeGroup, casing, line, markers, startMarker, stopMarkers, geometry, bounds: L.latLngBounds(geometry.path) })
      }
    }
  }, [L, dataset, plans, geometries, epoch])

  useEffect(() => {
    const m = map.current
    if (!m) return
    // Keyboard edits or a clock tick can remove a card while the pointer stays
    // still. A stale hover must not hide the newly selected route and its pins.
    const focusId = hoveredId && routes.current.has(hoveredId) ? hoveredId : selectedId
    for (const [id, route] of routes.current) {
      const focused = id === focusId
      const preview = focused && id !== selectedId
      route.casing.setStyle({ opacity: focused ? 0.9 : 0 })
      route.line.setStyle({ color: focused ? accent.current : MUTED, weight: focused ? 5 : 4, opacity: focused ? (preview ? 0.8 : 1) : 0.5, dashArray: focused ? undefined : '6 8' })
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
      const first = fittedKey.current === ''
      fittedKey.current = key
      m.stop()
      if (reducedMotion || first) m.fitBounds(selected.bounds, { padding: [48, 48], maxZoom: MAX_FIT_ZOOM, animate: false })
      else m.flyToBounds(selected.bounds, { padding: [48, 48], maxZoom: MAX_FIT_ZOOM, duration: 0.65, easeLinearity: 0.3 })
    }
    // Draw the newly selected line once the camera has settled on it.
    if (selected && key !== drawnKey.current && !reducedMotion) {
      drawnKey.current = key
      cancelDraw.current()
      let started = false
      const start = () => {
        if (started) return
        started = true
        window.clearTimeout(timer)
        m.off('moveend', start)
        cancelDraw.current = drawIn(selected.line)
      }
      const timer = window.setTimeout(start, 700)
      m.once('moveend', start)
      cancelDraw.current = () => { started = true; window.clearTimeout(timer); m.off('moveend', start) }
    }
  }, [L, dataset, plans, selectedId, hoveredId, reducedMotion, epoch])

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
  }, [L, dataset, plans, startSec, selectedId, hoveredId, epoch])

  // Highlight the stop being pointed at in the itinerary, and pan to it on request.
  useEffect(() => {
    const m = map.current
    const route = selectedId ? routes.current.get(selectedId) : undefined
    if (!m || !route) return
    const all = [route.startMarker, ...route.stopMarkers]
    const target = focus?.planId === selectedId ? (focus.index === 'start' ? route.startMarker : route.stopMarkers[focus.index]) : undefined
    for (const marker of all) {
      const on = marker === target
      marker.getElement()?.querySelector('.pin')?.classList.toggle('is-focus', on)
      if (on) marker.openTooltip()
      else marker.closeTooltip()
    }
    if (target && focus?.reveal) {
      m.stop()
      m.panInside(target.getLatLng(), { padding: [70, 70], animate: !reducedMotion })
    }
  }, [focus, selectedId, plans, hoveredId, reducedMotion, epoch])

  const selectedName = plans.find((plan) => plan.id === selectedId)?.name
  const showRoute = () => {
    const m = map.current
    const route = selectedId ? routes.current.get(selectedId) : undefined
    if (!m || !route) return
    m.stop()
    if (reducedMotion) m.fitBounds(route.bounds, { padding: [48, 48], maxZoom: MAX_FIT_ZOOM, animate: false })
    else m.flyToBounds(route.bounds, { padding: [48, 48], maxZoom: MAX_FIT_ZOOM, duration: 0.5 })
  }
  const showRouteRef = useRef(showRoute)
  useEffect(() => { showRouteRef.current = showRoute })
  // After a size change (expand / collapse), measure first, then re-frame.
  useEffect(() => {
    if (!refitKey) return
    const t = window.setTimeout(() => {
      map.current?.invalidateSize({ pan: false, animate: false })
      showRouteRef.current()
    }, 80)
    return () => window.clearTimeout(t)
  }, [refitKey])
  const canRefit = Boolean(selectedName && geometries.some(({ plan, route }) => plan.id === selectedId && route) && L && status !== 'failed')
  return (
    <div className="map-shell">
      <p id={instructionsId} className="sr-only">Use the arrow keys to move the map and plus or minus to zoom. Tab to route stops for details. The itinerary also lists every stop.</p>
      <div ref={el} className="map" role="region" aria-label={selectedName ? `Route map: ${selectedName}` : 'Campus route map'} aria-describedby={instructionsId} tabIndex={0} />
      {canRefit && <button type="button" className="map-btn map-refit" onClick={showRoute} aria-label={`Show the entire route for ${selectedName}`}><Icon name="target" size={16} /><span>Show entire route</span></button>}
      {status === 'loading' && tileConfig.ok && <p className="map-status quiet" role="status">Loading map…</p>}
      {status === 'failed' && <div className="map-status notice" role="status"><p>The map couldn't load. Use the itinerary list for the route, or reload to try again.</p><button type="button" className="btn" onClick={() => window.location.reload()}>Reload map</button></div>}
      {!tileConfig.ok && status !== 'failed' && <p className="map-status notice" role="status">Map pictures are unavailable: {tileConfig.message} Use the itinerary list.</p>}
      {routeFailed && status === 'ready' && <p className="map-status notice" role="status">Some route lines couldn't be drawn. Use the itinerary list.</p>}
      {status === 'tiles-failed' && (
        <div className="map-status notice compact" role="status">
          <p>Map pictures are unavailable or slow. Route lines still use the campus data.</p>
          <button type="button" className="btn small" onClick={() => retryTiles.current?.()}>Retry</button>
        </div>
      )}
    </div>
  )
}
