import { useEffect, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { planGeometry } from '../core/geo'
import type { Dataset, Plan } from '../core/types'
import { clock } from './format'

// Leaflet is loaded lazily so the form is usable before the map arrives, and a
// failed map never blocks planning: the itinerary list is complete on its own.

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

interface Props {
  dataset: Dataset
  plans: Plan[]
  selectedId: string | null
  hoveredId: string | null
  startSec: number | null
  onSelect: (id: string) => void
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function RouteMap({ dataset, plans, selectedId, hoveredId, startSec, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const [L, setL] = useState<typeof Leaflet | null>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const layers = useRef<Leaflet.LayerGroup | null>(null)
  /** Last selection the view was fitted to; hover and clock ticks must not move the map. */
  const fittedKey = useRef('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'tiles-failed'>('loading')
  // Bumped when a map instance is created, so the drawing effect runs against it.
  const [mapVersion, setMapVersion] = useState(0)

  // Load Leaflet once.
  useEffect(() => {
    let cancelled = false
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => !cancelled && setL(mod.default ?? mod))
      .catch(() => !cancelled && setStatus('failed'))
    return () => {
      cancelled = true
    }
  }, [])

  // Create the map when Leaflet and the container are ready.
  useEffect(() => {
    if (!L || !el.current || map.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: false })
    let tileErrors = 0
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION, crossOrigin: true })
    tiles.on('tileerror', () => {
      tileErrors++
      if (tileErrors > 4) setStatus('tiles-failed')
    })
    tiles.on('load', () => setStatus((s) => (s === 'tiles-failed' ? s : 'ready')))
    tiles.addTo(m)

    // Faint dots for every place, so the map shows what's around even before planning.
    const placeLayer = L.layerGroup().addTo(m)
    const nodes = new Map(dataset.nodes.map((n) => [n.id, n]))
    for (const p of dataset.places) {
      const n = nodes.get(p.nodeId)
      if (!n) continue
      L.marker([n.lat, n.lng], { icon: L.divIcon({ className: '', html: '<div class="place-dot"></div>', iconSize: [10, 10] }), keyboard: false })
        .bindTooltip(escapeHtml(p.name), { direction: 'top', offset: [0, -6] })
        .addTo(placeLayer)
    }
    // Frame the places and starts (the pilot area), not every road that runs off past it.
    const focus = [...dataset.places.map((p) => p.nodeId), ...dataset.starts.map((s) => s.nodeId)]
      .map((id) => nodes.get(id))
      .filter((n) => n !== undefined)
    const lats = focus.map((n) => n.lat)
    const lngs = focus.map((n) => n.lng)
    m.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [20, 20] })
    const routeLayer = L.layerGroup().addTo(m)
    layers.current = routeLayer
    // Lines added while a zoom animation is running keep that frame's projection.
    // Re-project ours once the map settles so they always sit exactly on the streets.
    m.on('zoomend moveend', () => {
      routeLayer.eachLayer((layer) => {
        if (layer instanceof L.Polyline) layer.redraw()
      })
    })
    map.current = m
    setStatus('ready')
    setMapVersion((v) => v + 1)

    // Keep the map sized correctly when its container changes (phone tab switch, window resize).
    const observer = new ResizeObserver(() => m.invalidateSize())
    observer.observe(el.current)
    return () => {
      observer.disconnect()
      m.remove()
      map.current = null
      layers.current = null
    }
  }, [L, dataset])

  // Draw routes whenever plans or selection change.
  useEffect(() => {
    const m = map.current
    const group = layers.current
    if (!L || !m || !group) return
    group.clearLayers()
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0d7a55'
    const focusId = hoveredId ?? selectedId
    let selectedBounds: Leaflet.LatLngBounds | null = null

    // Secondary routes first (muted), focused route last so it sits on top.
    const ordered = [...plans].sort((a, b) => Number(a.id === focusId) - Number(b.id === focusId))
    for (const plan of ordered) {
      const route = planGeometry(dataset, plan)
      const focused = plan.id === focusId
      if (plan.id === selectedId) selectedBounds = L.latLngBounds(route.path)
      if (!focused) {
        const line = L.polyline(route.path, { color: '#7d8a84', weight: 4, opacity: 0.55, dashArray: '6 8' })
        line.on('click', () => onSelect(plan.id))
        line.bindTooltip(escapeHtml(plan.name), { sticky: true })
        line.addTo(group)
        continue
      }
      L.polyline(route.path, { color: '#ffffff', weight: 9, opacity: 0.9 }).addTo(group)
      L.polyline(route.path, { color: accent, weight: 5, opacity: 1 }).addTo(group)

      const startName = dataset.starts.find((s) => s.nodeId === plan.startNodeId)?.name ?? 'Start'
      L.marker(route.start, { icon: L.divIcon({ className: '', html: '<div class="pin start">S</div>', iconSize: [32, 32] }), zIndexOffset: 1000 })
        .bindTooltip(`<b>Start &amp; finish</b><br>${escapeHtml(startName)}`, { direction: 'top', offset: [0, -14] })
        .addTo(group)
      let n = 0
      route.stops.forEach((s, i) => {
        const v = plan.visits[i]
        const html = s.passBy ? '<div class="pin pass"></div>' : `<div class="pin">${++n}</div>`
        const size: [number, number] = s.passBy ? [14, 14] : [28, 28]
        const when = startSec !== null ? `${clock(startSec + v.arriveOffsetSec)} · ` : ''
        const what = s.passBy ? 'pass by' : `${Math.round(v.dwellSec / 60)} min`
        L.marker(s.at, { icon: L.divIcon({ className: '', html, iconSize: size }), zIndexOffset: 900 })
          .bindTooltip(`<b>${escapeHtml(s.name)}</b><br>${when}${what}`, { direction: 'top', offset: [0, -12] })
          .addTo(group)
      })
    }
    const key = `${mapVersion}|${selectedId}|${plans.map((p) => p.id).join(',')}`
    if (selectedBounds && key !== fittedKey.current) {
      fittedKey.current = key
      m.stop()
      m.fitBounds(selectedBounds, { padding: [48, 48], maxZoom: 18, animate: true })
    }
  }, [L, mapVersion, dataset, plans, selectedId, hoveredId, startSec, onSelect])

  return (
    <div className="map-shell">
      <div ref={el} className="map" role="region" aria-label="Map of the selected route" />
      {status === 'loading' && <p className="map-status notice">Loading map…</p>}
      {status === 'failed' && <p className="map-status notice">The map couldn't load. The itinerary list has every step.</p>}
      {status === 'tiles-failed' && (
        <p className="map-status notice">Map pictures aren't loading (offline?). The route line and the itinerary are still accurate.</p>
      )}
    </div>
  )
}
