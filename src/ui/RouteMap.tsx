import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type * as MapLibre from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Dataset, Plan, PlaceCategory } from '../core/types'
import { clock } from './format'
import { useMediaQuery } from './hooks'
import { Icon } from './icons'
import { DEFAULT_VECTOR_STYLE, mapTileConfiguration } from './mapTiles'
import { campusBounds, coordinateBounds, lngLat, mapRoutes, placeCoordinate, routeFeatures } from './mapGeometry'
import './RouteMap.css'

const tileConfig = mapTileConfiguration({
  VITE_MAP_TILE_URL: import.meta.env.VITE_MAP_TILE_URL,
  VITE_MAP_TILE_ATTRIBUTION: import.meta.env.VITE_MAP_TILE_ATTRIBUTION,
  VITE_MAP_TILE_MAX_ZOOM: import.meta.env.VITE_MAP_TILE_MAX_ZOOM,
})
const SOURCE = 'campus-walks'
const LAYERS = { other: 'walk-alternatives', casing: 'walk-casing', selected: 'walk-selected', hit: 'walk-hit' }
const EMPTY_FILTER: MapLibre.FilterSpecification = ['==', ['get', 'planId'], '']

type MapModule = typeof MapLibre
type MapStatus = 'loading' | 'ready' | 'degraded' | 'failed'
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
  refitKey?: number
  campusKey?: number
  selectedPlaceId?: string | null
  visiblePlaceIds?: string[]
  onSelectPlace?: (id: string) => void
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onFocusStop: (focus: StopFocus | null) => void
}
interface StopMarker {
  marker: MapLibre.Marker
  element: HTMLButtonElement
  planId: string
  index: StopIndex
}
interface VenueMarker {
  marker: MapLibre.Marker
  element: HTMLButtonElement
  label: HTMLSpanElement
  id: string
}

function fitPadding(map: MapLibre.Map) {
  const { clientHeight: height, clientWidth: width } = map.getContainer()
  return { top: Math.min(155, height * 0.27), bottom: Math.min(100, height * 0.2), left: Math.min(55, width * 0.12), right: Math.min(55, width * 0.12) }
}

function mapStyle(): string | MapLibre.StyleSpecification {
  if (!tileConfig.ok || !tileConfig.url) return DEFAULT_VECTOR_STYLE
  return {
    version: 8,
    sources: {
      basemap: { type: 'raster', tiles: [tileConfig.url.replaceAll('{s}', 'a').replaceAll('{r}', '')], tileSize: 256, maxzoom: tileConfig.maxZoom, attribution: tileConfig.attribution },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  }
}

const categoryPaths: Record<PlaceCategory, string> = {
  cafe: 'M5 4h12v8a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V4Zm12 1h2a3 3 0 0 1 0 6h-2M4 20h15',
  seating: 'M4 12h16M6 12V7h12v5M5 12v7m14-7v7M3 16h18',
  landmark: 'm3 8 9-5 9 5H3Zm2 3v8m7-8v8m7-8v8M3 21h18',
  waypoint: 'M12 21s7-6 7-12A7 7 0 0 0 5 9c0 6 7 12 7 12ZM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
}
function venueIcon(category: PlaceCategory) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', categoryPaths[category])
  svg.append(path)
  return svg
}

/** One native WebGL map, with remote streets/buildings and the planner's exact walking geometry. */
export function RouteMap({ dataset, plans, selectedId, hoveredId, startSec, focus, touchPan, refitKey = 0, campusKey = 0, selectedPlaceId = null, visiblePlaceIds, onSelectPlace, onSelect, onHover, onFocusStop }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const instructionsId = useId()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [module, setModule] = useState<MapModule | null>(null)
  const [status, setStatus] = useState<MapStatus>('loading')
  const [retry, setRetry] = useState(0)
  const [epoch, setEpoch] = useState(0)
  const map = useRef<MapLibre.Map | null>(null)
  const stops = useRef<StopMarker[]>([])
  const venues = useRef<VenueMarker[]>([])
  const popup = useRef<MapLibre.Popup | null>(null)
  const fitKey = useRef('')
  const sourceKey = useRef('')
  const stopKey = useRef('')
  const revealedFocus = useRef<StopFocus | null>(null)
  const callbacks = useRef({ onSelect, onHover, onFocusStop, onSelectPlace })
  const current = useRef({ selectedId, hoveredId, selectedPlaceId, reducedMotion })
  const geometries = useMemo(() => mapRoutes(dataset, plans), [dataset, plans])
  const routeFailed = geometries.some(({ geometry }) => !geometry)

  useEffect(() => { callbacks.current = { onSelect, onHover, onFocusStop, onSelectPlace } }, [onSelect, onHover, onFocusStop, onSelectPlace])
  useEffect(() => { current.current = { selectedId, hoveredId, selectedPlaceId, reducedMotion } }, [selectedId, hoveredId, selectedPlaceId, reducedMotion])

  useEffect(() => {
    let active = true
    Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      .then(([mod]) => {
        if (!active) return
        mod.setWorkerUrl(workerUrl)
        mod.setWorkerCount(1)
        setModule(mod)
      })
      .catch(() => { if (active) setStatus('failed') })
    return () => { active = false }
  }, [retry])

  useEffect(() => {
    if (!module || !el.current) return
    let active = true
    let failed = false
    let fatal = false
    let loaded = false
    let instance: MapLibre.Map | null = null
    let observer: ResizeObserver | null = null
    let resizeFrame = 0
    const canvas = el.current
    const timer = window.setTimeout(() => { if (active && !loaded) { failed = true; setStatus('failed') } }, 20_000)
    const markFailed = () => { if (active) { failed = true; fatal = true; setStatus('failed') } }
    const resourceFailed = () => { if (active) { failed = true; setStatus(loaded ? 'degraded' : 'failed') } }
    const onResize = () => {
      if (resizeFrame) return
      resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; if (active) instance?.resize() })
    }
    const onOnline = () => { if (active && failed) setRetry((value) => value + 1) }
    queueMicrotask(() => { if (active && !failed) setStatus('loading') })
    try {
      if (!tileConfig.ok) throw new Error(tileConfig.message)
      const m = new module.Map({
        container: canvas,
        style: mapStyle(),
        center: [dataset.location.lng, dataset.location.lat],
        zoom: Math.min(14.8, tileConfig.url ? tileConfig.maxZoom : 19),
        minZoom: Math.min(11, tileConfig.url ? tileConfig.maxZoom : 19),
        maxZoom: tileConfig.url ? tileConfig.maxZoom : 19,
        pitch: 0,
        maxPitch: 0,
        dragRotate: false,
        touchPitch: false,
        touchZoomRotate: true,
        scrollZoom: false,
        attributionControl: false,
        trackResize: false,
        renderWorldCopies: false,
        fadeDuration: current.current.reducedMotion ? 0 : 180,
        canvasContextAttributes: { antialias: false },
      })
      instance = m
      map.current = m
      m.touchZoomRotate.disableRotation()
      m.keyboard.disableRotation()
      m.addControl(new module.NavigationControl({ showCompass: false }), 'bottom-right')
      m.addControl(new module.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left')
      m.addControl(new module.AttributionControl({ compact: false }), 'bottom-right')
      m.getCanvas().setAttribute('aria-label', 'MIT Manipal street map. Use arrow keys to pan; plus and minus to zoom.')
      m.getCanvas().setAttribute('aria-describedby', instructionsId)
      m.getCanvas().addEventListener('webglcontextlost', markFailed)
      m.on('error', resourceFailed)
      m.on('style.load', () => {
        if (!active) return
        m.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        m.addLayer({ id: LAYERS.other, type: 'line', source: SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#758998', 'line-width': 3.5, 'line-opacity': 0.62 } })
        m.addLayer({ id: LAYERS.casing, type: 'line', source: SOURCE, filter: EMPTY_FILTER, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.95 } })
        m.addLayer({ id: LAYERS.selected, type: 'line', source: SOURCE, filter: EMPTY_FILTER, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': 5, 'line-opacity': 1 } })
        m.addLayer({ id: LAYERS.hit, type: 'line', source: SOURCE, paint: { 'line-width': 20, 'line-opacity': 0 } })
        setEpoch((value) => value + 1)
      })
      m.on('idle', () => {
        if (!active || fatal || canvas.clientWidth === 0 || canvas.clientHeight === 0) return
        // A failed tile or font must not erase a usable street map. Recovery
        // needs visible provider geography, never just our route overlay.
        if (failed && !m.queryRenderedFeatures().some((feature) => feature.source !== SOURCE)) return
        loaded = true
        window.clearTimeout(timer)
        setStatus(failed ? 'degraded' : 'ready')
      })
      const routeAt = (event: MapLibre.MapMouseEvent) => {
        if (!m.getLayer(LAYERS.hit)) return null
        const features = m.queryRenderedFeatures(event.point, { layers: [LAYERS.hit] })
        const ids = features.map((feature) => feature.properties.planId as string)
        return ids.includes(current.current.selectedId ?? '') ? current.current.selectedId : ids[0] ?? null
      }
      m.on('mousemove', (event) => {
        const id = routeAt(event)
        m.getCanvas().style.cursor = id ? 'pointer' : ''
        if (id !== current.current.hoveredId) callbacks.current.onHover(id)
      })
      m.on('mouseout', () => callbacks.current.onHover(null))
      m.on('click', (event) => { const id = routeAt(event); if (id) callbacks.current.onSelect(id) })
      m.fitBounds(campusBounds(dataset), { padding: fitPadding(m), maxZoom: 15.8, duration: 0 })
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(onResize)
        observer.observe(canvas)
      } else window.addEventListener('resize', onResize)
      window.addEventListener('online', onOnline)
    } catch { markFailed() }
    return () => {
      active = false
      window.clearTimeout(timer)
      cancelAnimationFrame(resizeFrame)
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('online', onOnline)
      stops.current.forEach(({ marker }) => marker.remove())
      venues.current.forEach(({ marker }) => marker.remove())
      stops.current = []; venues.current = []
      popup.current?.remove(); popup.current = null
      if (instance) {
        instance.getCanvas().removeEventListener('webglcontextlost', markFailed)
        instance.remove()
      }
      map.current = null
      fitKey.current = ''; sourceKey.current = ''; stopKey.current = ''; revealedFocus.current = null
    }
  }, [module, dataset, retry, instructionsId])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (touchPan) { m.dragPan.enable(); m.scrollZoom.enable(); m.cooperativeGestures.disable() }
    else { m.dragPan.enable(); m.scrollZoom.disable(); m.cooperativeGestures.enable() }
  }, [touchPan, epoch])

  useEffect(() => {
    const m = map.current
    if (!m || !module || !m.getSource(SOURCE)) return
    const key = geometries.map((route) => route.key).join('|')
    if (sourceKey.current !== key) {
      ;(m.getSource(SOURCE) as MapLibre.GeoJSONSource).setData(routeFeatures(geometries))
      sourceKey.current = key
    }
    const shown = geometries.find((route) => route.id === hoveredId && route.geometry) ?? geometries.find((route) => route.id === selectedId)
    const filter: MapLibre.FilterSpecification = ['==', ['get', 'planId'], shown?.id ?? '']
    m.setFilter(LAYERS.selected, filter)
    m.setFilter(LAYERS.casing, filter)
    m.setPaintProperty(LAYERS.selected, 'line-opacity', shown?.id === selectedId ? 1 : 0.85)
    if (stopKey.current === (shown?.key ?? '')) return
    stops.current.forEach(({ marker }) => marker.remove())
    stops.current = []
    popup.current?.remove()
    stopKey.current = shown?.key ?? ''
    if (!shown?.geometry) return
    const addStop = (index: StopIndex, at: [number, number], label: string, passBy = false) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'map-stop-marker'
      const pin = document.createElement('span')
      pin.className = `map-stop-pin${index === 'start' ? ' is-start' : ''}${passBy ? ' is-pass' : ''}`
      pin.textContent = label
      pin.setAttribute('aria-hidden', 'true')
      element.append(pin)
      const planId = shown.id
      element.addEventListener('click', (event) => { event.stopPropagation(); callbacks.current.onSelect(planId); callbacks.current.onFocusStop({ planId, index, reveal: false }) })
      element.addEventListener('focus', () => callbacks.current.onFocusStop({ planId, index, reveal: false }))
      element.addEventListener('mouseenter', () => callbacks.current.onFocusStop({ planId, index, reveal: false }))
      element.addEventListener('mouseleave', () => { if (document.activeElement !== element) callbacks.current.onFocusStop(null) })
      element.addEventListener('blur', () => callbacks.current.onFocusStop(null))
      const marker = new module.Marker({ element, anchor: 'center' }).setLngLat(lngLat(at)).addTo(m)
      stops.current.push({ marker, element, planId, index })
    }
    addStop('start', shown.geometry.start, 'S')
    let number = 0
    shown.geometry.stops.forEach((stop, index) => addStop(index, stop.at, stop.passBy ? '' : String(++number), stop.passBy))
  }, [module, geometries, selectedId, hoveredId, epoch])

  useEffect(() => {
    const m = map.current
    if (!module || !m || !m.getSource(SOURCE)) return
    for (const { marker, element, planId, index } of stops.current) {
      const plan = plans.find((plan) => plan.id === planId)
      if (!plan) continue
      const visit = index === 'start' ? null : plan.visits[index]
      const startName = dataset.starts.find((start) => start.nodeId === plan.startNodeId)?.name ?? 'Start'
      const when = visit && startSec !== null ? `${clock(startSec + visit.arriveOffsetSec)} · ` : ''
      const name = visit ? visit.name : `Start and finish: ${startName}`
      const detail = visit ? `${when}${visit.dwellSec === 0 ? 'Pass by' : `${Math.round(visit.dwellSec / 60)} min stop`}` : ''
      element.setAttribute('aria-label', `${name}${detail ? `, ${detail}` : ''}`)
      element.setAttribute('title', `${name}${detail ? ` — ${detail}` : ''}`)
      const focused = focus?.planId === planId && focus.index === index
      element.classList.toggle('is-focus', focused)
      if (focused) {
        const content = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = name
        content.append(title)
        if (detail) { const text = document.createElement('span'); text.textContent = detail; content.append(text) }
        popup.current ??= new module.Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 24, className: 'walk-stop-popup', maxWidth: '240px' })
        popup.current.setLngLat(marker.getLngLat()).setDOMContent(content).addTo(m)
        if (focus.reveal && revealedFocus.current !== focus) m.easeTo({ center: marker.getLngLat(), offset: [0, 15], duration: reducedMotion ? 0 : 450 })
      }
    }
    revealedFocus.current = focus
    if (!focus || !stops.current.some((stop) => stop.planId === focus.planId && stop.index === focus.index)) popup.current?.remove()
  }, [module, dataset, plans, startSec, focus, selectedId, hoveredId, reducedMotion, epoch])

  useEffect(() => {
    const m = map.current
    if (!module || !m || !m.getSource(SOURCE)) return
    for (const place of dataset.places) {
      const at = placeCoordinate(dataset, place)
      if (!at) continue
      const element = document.createElement('button')
      element.type = 'button'
      element.className = `map-place-marker is-${place.category}`
      element.setAttribute('aria-label', `${place.name}, ${place.category === 'cafe' ? 'food and drink' : place.category}. Show venue details.`)
      element.title = place.name
      const icon = document.createElement('span')
      icon.className = 'map-place-icon'
      icon.append(venueIcon(place.category))
      const label = document.createElement('span')
      label.className = 'map-place-name'
      label.textContent = place.name.replace(' (outside)', '')
      element.append(icon, label)
      element.addEventListener('click', (event) => { event.stopPropagation(); callbacks.current.onSelectPlace?.(place.id) })
      const marker = new module.Marker({ element, anchor: 'center' }).setLngLat(lngLat(at)).addTo(m)
      venues.current.push({ marker, element, label, id: place.id })
    }
    return () => { venues.current.forEach(({ marker }) => marker.remove()); venues.current = [] }
  }, [module, dataset, epoch])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const visible = visiblePlaceIds ? new Set(visiblePlaceIds) : null
    for (const venue of venues.current) {
      venue.element.toggleAttribute('hidden', Boolean(visible && !visible.has(venue.id)))
      venue.element.classList.toggle('is-selected', venue.id === selectedPlaceId)
      venue.element.setAttribute('aria-pressed', String(venue.id === selectedPlaceId))
    }
    const layoutLabels = () => {
      const boxes: [number, number, number, number][] = []
      const ordered = [...venues.current].sort((a, b) => Number(b.id === selectedPlaceId) - Number(a.id === selectedPlaceId))
      for (const venue of ordered) {
        if (venue.element.hidden) continue
        const selected = venue.id === selectedPlaceId
        const { x, y } = m.project(venue.marker.getLngLat())
        const width = Math.min(150, (venue.label.textContent?.length ?? 0) * 6.5 + 8)
        const box: [number, number, number, number] = [x + 16, y - 13, x + 16 + width, y + 13]
        const collision = boxes.some(([left, top, right, bottom]) => box[0] < right && box[2] > left && box[1] < bottom && box[3] > top)
        const hide = !selected && (m.getZoom() < 14.8 || collision)
        venue.element.classList.toggle('is-label-hidden', hide)
        if (!hide) boxes.push(box)
      }
    }
    layoutLabels()
    m.on('moveend', layoutLabels)
    return () => { m.off('moveend', layoutLabels) }
  }, [visiblePlaceIds, selectedPlaceId, dataset, epoch])

  useEffect(() => {
    const m = map.current
    const route = geometries.find((route) => route.id === selectedId)
    if (!m || !route?.geometry || !m.getSource(SOURCE) || fitKey.current === route.key) return
    const first = !fitKey.current
    fitKey.current = route.key
    const bounds = coordinateBounds(route.geometry.path)
    if (bounds) m.fitBounds(bounds, { padding: fitPadding(m), maxZoom: 16.6, duration: first || reducedMotion ? 0 : 550 })
  }, [geometries, selectedId, reducedMotion, epoch])

  useEffect(() => {
    const m = map.current
    const place = dataset.places.find((place) => place.id === selectedPlaceId)
    const at = place && placeCoordinate(dataset, place)
    if (!m || !at) return
    m.easeTo({ center: lngLat(at), zoom: Math.max(m.getZoom(), 16.7), offset: [0, -55], duration: reducedMotion ? 0 : 500 })
  }, [dataset, selectedPlaceId, reducedMotion, epoch])

  const showRoute = () => {
    const m = map.current
    const route = geometries.find((route) => route.id === selectedId)
    const bounds = route?.geometry && coordinateBounds(route.geometry.path)
    if (m && bounds) m.fitBounds(bounds, { padding: fitPadding(m), maxZoom: 17.6, duration: reducedMotion ? 0 : 500 })
  }
  const resizeFitRef = useRef(showRoute)
  useEffect(() => {
    resizeFitRef.current = () => {
      const m = map.current
      const place = dataset.places.find((place) => place.id === selectedPlaceId)
      const at = place && placeCoordinate(dataset, place)
      if (m && at) m.easeTo({ center: lngLat(at), offset: [0, -55], duration: reducedMotion ? 0 : 450 })
      else showRoute()
    }
  })
  useEffect(() => {
    if (!refitKey) return
    const timer = window.setTimeout(() => { map.current?.resize(); resizeFitRef.current() }, 80)
    return () => window.clearTimeout(timer)
  }, [refitKey])
  useEffect(() => {
    if (!campusKey || !map.current) return
    const m = map.current
    m.fitBounds(campusBounds(dataset), { padding: fitPadding(m), maxZoom: 15.8, duration: reducedMotion ? 0 : 550 })
  }, [campusKey, dataset, reducedMotion])

  const selectedName = plans.find((plan) => plan.id === selectedId)?.name
  const canRefit = Boolean(selectedName && geometries.some(({ id, geometry }) => id === selectedId && geometry) && (status === 'ready' || status === 'degraded'))
  return (
    <div className={`map-shell vector-map-shell${status === 'failed' ? ' has-map-error' : ''}`} data-map-status={status}>
      <p id={instructionsId} className="sr-only">Street map of MIT Manipal and the surrounding area. Use arrow keys to move and plus or minus to zoom. Tab to venues and route stops for details. Walking routes use saved public path data; check current hours in Google Maps.</p>
      <div ref={el} className="map" role="region" aria-label={selectedName ? `MIT Manipal street map: ${selectedName}` : 'MIT Manipal street map'} aria-describedby={instructionsId} />
      {canRefit && <button type="button" className="map-btn map-refit" onClick={showRoute} aria-label={`Show the entire route for ${selectedName}`}><Icon name="target" size={16} /><span>Show entire route</span></button>}
      {status === 'loading' && <p className="map-status quiet" role="status">Loading street map…</p>}
      {status === 'failed' && <div className="map-status notice map-load-error" role="status"><strong>The street map is unavailable.</strong><p>{!tileConfig.ok ? tileConfig.message : 'Check your connection and try again. You can still open venues and directions in Google Maps.'}</p><button type="button" className="btn small" onClick={() => setRetry((value) => value + 1)}>Retry map</button></div>}
      {status === 'degraded' && <div className="map-status notice compact" role="status"><p>Some map details could not load.</p><button type="button" className="btn small" onClick={() => setRetry((value) => value + 1)}>Retry map</button></div>}
      {routeFailed && (status === 'ready' || status === 'degraded') && <p className="map-status notice" role="status">Some walking routes could not be drawn. Use the itinerary for those walks.</p>}
    </div>
  )
}
