import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { liveCategory } from '../../core/livePlaces'
import type { LatLng } from '../../core/types'
import { clock } from '../format'
import { useMediaQuery } from '../hooks'
import { Icon } from '../icons'
import { campusBounds, coordinateBounds, mapRoutes, placeCoordinate } from '../mapGeometry'
import { layoutPlaceLabels, placeMarkerElement, stopDescription, stopMarkerElement, stopPopupContent } from '../mapMarkers'
import type { RouteMapProps, StopFocus, StopIndex } from '../RouteMap'
import type { GoogleLibraries } from './loader'
import '../RouteMap.css'

interface Props extends RouteMapProps {
  libs: GoogleLibraries
  mapId: string
  /** The map cannot work (rejected key, unreachable service): fall back to the free map. */
  onFatal: (message: string) => void
}

type Marker = google.maps.marker.AdvancedMarkerElement
interface StopMarker { marker: Marker; element: HTMLButtonElement; planId: string; index: StopIndex; at: LatLng }
interface VenueMarker { marker: Marker; element: HTMLButtonElement; label: HTMLSpanElement; id: string; at: LatLng }
interface RouteLines { casing: google.maps.Polyline; line: google.maps.Polyline; hit: google.maps.Polyline }

const literal = ([lat, lng]: LatLng): google.maps.LatLngLiteral => ({ lat, lng })
const boundsLiteral = (b: [[number, number], [number, number]]): google.maps.LatLngBoundsLiteral => ({ west: b[0][0], south: b[0][1], east: b[1][0], north: b[1][1] })

function fitPadding(map: google.maps.Map): google.maps.Padding {
  const { clientHeight: height, clientWidth: width } = map.getDiv()
  return { top: Math.min(155, height * 0.27), bottom: Math.min(100, height * 0.2), left: Math.min(55, width * 0.12), right: Math.min(55, width * 0.12) }
}

/** Centre that puts `at` this many pixels above the map's centre at a zoom level. */
function offsetCenter([lat, lng]: LatLng, zoom: number, pixelsUp: number): google.maps.LatLngLiteral {
  const metresPerPixel = (156_543.033_92 * Math.cos(lat * Math.PI / 180)) / 2 ** zoom
  return { lat: lat - (pixelsUp * metresPerPixel) / 111_320, lng }
}

/**
 * Google's own map, with its current venues and labels, plus the planner's exact
 * walking geometry. Business icons on the basemap are clickable and open live
 * details; the route and stops behave exactly like the free map's.
 */
export function GoogleRouteMap({ libs, mapId, onFatal, dataset, plans, selectedId, hoveredId, startSec, focus, touchPan, refitKey = 0, campusKey = 0, selectedPlaceId = null, visiblePlaceIds, livePins = [], selectedLive = null, onSelectPlace, onSelectGooglePlace, onSelect, onHover, onFocusStop }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const instructionsId = useId()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const [ready, setReady] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const map = useRef<google.maps.Map | null>(null)
  const overlay = useRef<google.maps.OverlayView | null>(null)
  const info = useRef<google.maps.InfoWindow | null>(null)
  const lines = useRef(new Map<string, RouteLines>())
  const stops = useRef<StopMarker[]>([])
  const venues = useRef<VenueMarker[]>([])
  const pins = useRef<VenueMarker[]>([])
  const fitKey = useRef('')
  const sourceKey = useRef('')
  const stopKey = useRef('')
  const revealedFocus = useRef<StopFocus | null>(null)
  const datasetRef = useRef(dataset)
  const callbacks = useRef({ onSelect, onHover, onFocusStop, onSelectPlace, onSelectGooglePlace, onFatal })
  const current = useRef({ selectedId, hoveredId, reducedMotion })
  const selection = useRef({ selectedPlaceId, selectedLive })
  const geometries = useMemo(() => mapRoutes(dataset, plans), [dataset, plans])
  const routeFailed = geometries.some(({ geometry }) => !geometry)
  const { datasetVersion } = dataset

  useEffect(() => { callbacks.current = { onSelect, onHover, onFocusStop, onSelectPlace, onSelectGooglePlace, onFatal } }, [onSelect, onHover, onFocusStop, onSelectPlace, onSelectGooglePlace, onFatal])
  useEffect(() => { current.current = { selectedId, hoveredId, reducedMotion } }, [selectedId, hoveredId, reducedMotion])
  useEffect(() => { datasetRef.current = dataset }, [dataset])
  useEffect(() => { selection.current = { selectedPlaceId, selectedLive } }, [selectedPlaceId, selectedLive])

  // ---- One map per page (rebuilt only if the system colour scheme flips) ----
  useEffect(() => {
    const container = el.current
    if (!container) return
    const base = datasetRef.current
    let active = true
    let loaded = false
    const timer = window.setTimeout(() => {
      if (active && !loaded) callbacks.current.onFatal('Google Maps took too long to load. Showing the free street map instead.')
    }, 25_000)
    const m = new libs.maps.Map(container, {
      mapId,
      center: { lat: base.location.lat, lng: base.location.lng },
      zoom: 15.5,
      minZoom: 12,
      maxZoom: 21,
      colorScheme: dark ? 'DARK' : 'LIGHT',
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: libs.core.ControlPosition.RIGHT_BOTTOM },
      scaleControl: true,
      clickableIcons: true,
      keyboardShortcuts: true,
      isFractionalZoomEnabled: true,
      gestureHandling: 'cooperative',
      tilt: 0,
      heading: 0,
      tiltInteractionEnabled: false,
      headingInteractionEnabled: false,
    })
    map.current = m
    const routeLines = lines.current
    const view = new libs.maps.OverlayView()
    view.onAdd = () => {}
    view.draw = () => {}
    view.onRemove = () => {}
    view.setMap(m)
    overlay.current = view
    const listeners = [
      m.addListener('tilesloaded', () => {
        if (!active || loaded) return
        loaded = true
        window.clearTimeout(timer)
        setReady(true)
      }),
      // A basemap business or landmark: show its live details instead of Google's info window.
      m.addListener('click', (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
        if ('placeId' in event && event.placeId) {
          event.stop()
          callbacks.current.onSelectGooglePlace?.(event.placeId)
        }
      }),
    ]
    m.fitBounds(boundsLiteral(campusBounds(base)), fitPadding(m))
    container.setAttribute('aria-describedby', instructionsId)
    setEpoch((value) => value + 1)
    return () => {
      active = false
      window.clearTimeout(timer)
      listeners.forEach((listener) => listener.remove())
      stops.current.forEach(({ marker }) => { marker.map = null })
      venues.current.forEach(({ marker }) => { marker.map = null })
      pins.current.forEach(({ marker }) => { marker.map = null })
      routeLines.forEach(({ casing, line, hit }) => [casing, line, hit].forEach((polyline) => polyline.setMap(null)))
      stops.current = []; venues.current = []; pins.current = []; routeLines.clear()
      info.current?.close(); info.current = null
      view.setMap(null); overlay.current = null
      libs.core.event.clearInstanceListeners(m)
      map.current = null
      setReady(false)
      fitKey.current = ''; sourceKey.current = ''; stopKey.current = ''; revealedFocus.current = null
    }
  }, [libs, mapId, dark, datasetVersion, instructionsId])

  useEffect(() => { map.current?.setOptions({ gestureHandling: touchPan ? 'greedy' : 'cooperative' }) }, [touchPan, epoch])

  // ---- Routes ----
  useEffect(() => {
    const m = map.current
    if (!m) return
    const key = geometries.map((route) => route.key).join('|')
    if (sourceKey.current !== key) {
      lines.current.forEach(({ casing, line, hit }) => [casing, line, hit].forEach((polyline) => polyline.setMap(null)))
      lines.current.clear()
      for (const route of geometries) {
        if (!route.geometry || route.geometry.path.length < 2) continue
        const path = route.geometry.path.map(literal)
        const casing = new libs.maps.Polyline({ map: m, path, clickable: false, visible: false, strokeColor: '#ffffff', strokeOpacity: 0.95, strokeWeight: 9, zIndex: 10 })
        const line = new libs.maps.Polyline({ map: m, path, clickable: false, strokeColor: '#758998', strokeOpacity: 0.62, strokeWeight: 3.5, zIndex: 5 })
        // A wide, nearly invisible line makes routes easy to hover and tap.
        const hit = new libs.maps.Polyline({ map: m, path, clickable: true, strokeColor: '#000000', strokeOpacity: 0.01, strokeWeight: 20, zIndex: 12 })
        const id = route.id
        hit.addListener('mouseover', () => { if (current.current.hoveredId !== id) callbacks.current.onHover(id) })
        hit.addListener('mouseout', () => callbacks.current.onHover(null))
        hit.addListener('click', () => callbacks.current.onSelect(id))
        lines.current.set(id, { casing, line, hit })
      }
      sourceKey.current = key
    }
    const shown = geometries.find((route) => route.id === hoveredId && route.geometry) ?? geometries.find((route) => route.id === selectedId)
    lines.current.forEach(({ casing, line, hit }, id) => {
      const on = id === shown?.id
      casing.setOptions({ visible: on })
      line.setOptions(on
        ? { strokeColor: '#1a73e8', strokeWeight: 5, strokeOpacity: id === selectedId ? 1 : 0.85, zIndex: 11 }
        : { strokeColor: '#758998', strokeWeight: 3.5, strokeOpacity: 0.62, zIndex: 5 })
      hit.setOptions({ zIndex: on ? 13 : 12 })
    })
    if (stopKey.current === (shown?.key ?? '')) return
    stops.current.forEach(({ marker }) => { marker.map = null })
    stops.current = []
    info.current?.close()
    stopKey.current = shown?.key ?? ''
    if (!shown?.geometry) return
    const addStop = (index: StopIndex, at: LatLng, label: string, passBy = false) => {
      const element = stopMarkerElement(shown.id, index, label, passBy, () => callbacks.current)
      const marker = new libs.marker.AdvancedMarkerElement({ map: m, position: literal(at), content: element, anchorLeft: '-50%', anchorTop: '-50%', zIndex: 40 })
      stops.current.push({ marker, element, planId: shown.id, index, at })
    }
    addStop('start', shown.geometry.start, 'S')
    let number = 0
    shown.geometry.stops.forEach((stop, index) => addStop(index, stop.at, stop.passBy ? '' : String(++number), stop.passBy))
  }, [libs, geometries, selectedId, hoveredId, epoch])

  // ---- Stop names, times and the focused stop's popup ----
  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const { element, planId, index, at } of stops.current) {
      const plan = plans.find((item) => item.id === planId)
      if (!plan) continue
      const visit = index === 'start' ? null : plan.visits[index]
      const startName = dataset.starts.find((start) => start.nodeId === plan.startNodeId)?.name ?? 'Start'
      const when = visit && startSec !== null ? `${clock(startSec + visit.arriveOffsetSec)} · ` : ''
      const name = visit ? visit.name : `Start and finish: ${startName}`
      const { label, title, detail } = stopDescription(name, when, visit ? visit.dwellSec : null)
      element.setAttribute('aria-label', label)
      element.setAttribute('title', title)
      const focused = focus?.planId === planId && focus.index === index
      element.classList.toggle('is-focus', focused)
      if (focused) {
        info.current ??= new libs.maps.InfoWindow({ headerDisabled: true, disableAutoPan: true, pixelOffset: new libs.core.Size(0, -18), maxWidth: 240 })
        info.current.setContent(stopPopupContent(name, detail))
        info.current.setPosition(literal(at))
        info.current.open({ map: m, shouldFocus: false })
        if (focus.reveal && revealedFocus.current !== focus) {
          const target = offsetCenter(at, m.getZoom() ?? 16, -15)
          if (reducedMotion) m.setCenter(target); else m.panTo(target)
        }
      }
    }
    revealedFocus.current = focus
    if (!focus || !stops.current.some((stop) => stop.planId === focus.planId && stop.index === focus.index)) info.current?.close()
  }, [libs, dataset, plans, startSec, focus, selectedId, hoveredId, reducedMotion, epoch])

  // ---- Saved catalogue venues and live stops ----
  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const place of dataset.places) {
      const at = placeCoordinate(dataset, place)
      if (!at) continue
      const { element, label } = placeMarkerElement(place.name, place.category, () => callbacks.current.onSelectPlace?.(place.id))
      const marker = new libs.marker.AdvancedMarkerElement({ map: m, position: literal(at), content: element, anchorLeft: '-50%', anchorTop: '-50%', zIndex: 20 })
      venues.current.push({ marker, element, label, id: place.id, at })
    }
    return () => { venues.current.forEach(({ marker }) => { marker.map = null }); venues.current = [] }
  }, [libs, dataset, epoch])

  // ---- Google results: category lists and the venue being viewed ----
  useEffect(() => {
    const m = map.current
    if (!m) return
    const saved = new Set(dataset.places.map((place) => place.id))
    const shown = [...livePins]
    if (selectedLive && !shown.some((pin) => pin.placeId === selectedLive.placeId)) shown.push(selectedLive)
    for (const venue of shown) {
      if (saved.has(`g_${venue.placeId}`)) continue
      const { element, label } = placeMarkerElement(venue.name, liveCategory(venue), () => callbacks.current.onSelectGooglePlace?.(venue.placeId), true)
      const marker = new libs.marker.AdvancedMarkerElement({ map: m, position: literal(venue.location), content: element, anchorLeft: '-50%', anchorTop: '-50%', zIndex: 18 })
      pins.current.push({ marker, element, label, id: venue.placeId, at: venue.location })
    }
    return () => { pins.current.forEach(({ marker }) => { marker.map = null }); pins.current = [] }
  }, [libs, dataset, livePins, selectedLive, epoch])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const visible = visiblePlaceIds ? new Set(visiblePlaceIds) : null
    const selectedLiveId = selectedLive?.placeId ?? null
    for (const venue of venues.current) {
      const hidden = Boolean(visible && !visible.has(venue.id) && venue.id !== selectedPlaceId)
      venue.element.toggleAttribute('hidden', hidden)
      venue.element.classList.toggle('is-selected', venue.id === selectedPlaceId)
      venue.element.setAttribute('aria-pressed', String(venue.id === selectedPlaceId))
    }
    for (const pin of pins.current) {
      pin.element.classList.toggle('is-selected', pin.id === selectedLiveId)
      pin.element.setAttribute('aria-pressed', String(pin.id === selectedLiveId))
    }
    const project = (venue: VenueMarker) => {
      const point = overlay.current?.getProjection()?.fromLatLngToContainerPixel(literal(venue.at))
      return point ? { x: point.x, y: point.y } : null
    }
    const layout = () => {
      const zoom = m.getZoom() ?? 0
      layoutPlaceLabels(venues.current, selectedPlaceId, zoom, 15.5, project)
      // Google already labels its own venues; ours appear once zoomed in.
      layoutPlaceLabels(pins.current, selectedLiveId, zoom, 17, project)
    }
    layout()
    const listener = m.addListener('idle', layout)
    return () => listener.remove()
  }, [visiblePlaceIds, selectedPlaceId, selectedLive, livePins, dataset, epoch, ready])

  // ---- Camera ----
  const fitRoute = (maxZoom: number) => {
    const m = map.current
    const route = geometries.find((item) => item.id === current.current.selectedId)
    const bounds = route?.geometry && coordinateBounds(route.geometry.path)
    if (!m || !bounds) return false
    m.fitBounds(boundsLiteral(bounds), fitPadding(m))
    libs.core.event.addListenerOnce(m, 'idle', () => { if ((m.getZoom() ?? 0) > maxZoom) m.setZoom(maxZoom) })
    return true
  }
  const fitRouteRef = useRef(fitRoute)
  useEffect(() => { fitRouteRef.current = fitRoute })

  useEffect(() => {
    const route = geometries.find((item) => item.id === selectedId)
    if (!map.current || !route?.geometry || fitKey.current === route.key) return
    fitKey.current = route.key
    fitRouteRef.current(16.6)
  }, [geometries, selectedId, epoch])

  const focusOn = (at: LatLng) => {
    const m = map.current
    if (!m) return
    const zoom = Math.max(m.getZoom() ?? 0, 17)
    const target = offsetCenter(at, zoom, 55)
    if (reducedMotion) { m.setZoom(zoom); m.setCenter(target) }
    else { m.setZoom(zoom); m.panTo(target) }
  }
  const focusOnRef = useRef(focusOn)
  useEffect(() => { focusOnRef.current = focusOn })

  useEffect(() => {
    const place = dataset.places.find((item) => item.id === selectedPlaceId)
    const at = place && placeCoordinate(dataset, place)
    if (at) focusOnRef.current(at)
  }, [dataset, selectedPlaceId, epoch])
  useEffect(() => { if (selectedLive) focusOnRef.current(selectedLive.location) }, [selectedLive, epoch])

  useEffect(() => {
    if (!refitKey) return
    const timer = window.setTimeout(() => {
      const { selectedPlaceId: placeId, selectedLive: venue } = selection.current
      const place = datasetRef.current.places.find((item) => item.id === placeId)
      const at = place ? placeCoordinate(datasetRef.current, place) : venue?.location
      if (at) focusOnRef.current(at)
      else fitRouteRef.current(17.6)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [refitKey])

  useEffect(() => {
    const m = map.current
    if (!campusKey || !m) return
    m.fitBounds(boundsLiteral(campusBounds(datasetRef.current)), fitPadding(m))
  }, [campusKey])

  const selectedName = plans.find((plan) => plan.id === selectedId)?.name
  const canRefit = Boolean(ready && selectedName && geometries.some(({ id, geometry }) => id === selectedId && geometry))
  return (
    <div className="map-shell vector-map-shell google-map-shell" data-map-status={ready ? 'ready' : 'loading'} data-map-provider="google">
      <p id={instructionsId} className="sr-only">Google Maps view of MIT Manipal and the surrounding area. Use arrow keys to move and plus or minus to zoom. Tab to venues and route stops for details; select a business on the map for its current Google Maps listing. Walking routes use saved public path data.</p>
      <div ref={el} className="map" role="region" aria-label={selectedName ? `MIT Manipal map: ${selectedName}` : 'MIT Manipal map'} />
      {canRefit && <button type="button" className="map-btn map-refit" onClick={() => fitRouteRef.current(17.6)} aria-label={`Show the entire route for ${selectedName}`}><Icon name="target" size={16} /><span>Show entire route</span></button>}
      {!ready && <p className="map-status quiet" role="status">Loading Google Maps…</p>}
      {routeFailed && ready && <p className="map-status notice" role="status">Some walking routes could not be drawn. Use the itinerary for those walks.</p>}
    </div>
  )
}
