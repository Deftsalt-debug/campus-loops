import type { PlaceCategory } from '../core/types'
import type { StopFocus, StopIndex } from './RouteMap'

// DOM for map markers, shared by the MapLibre and Google maps so both behave
// the same: every marker is an ordinary keyboard-accessible button.

const categoryPaths: Record<PlaceCategory, string> = {
  cafe: 'M5 4h12v8a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V4Zm12 1h2a3 3 0 0 1 0 6h-2M4 20h15',
  seating: 'M4 12h16M6 12V7h12v5M5 12v7m14-7v7M3 16h18',
  landmark: 'm3 8 9-5 9 5H3Zm2 3v8m7-8v8m7-8v8M3 21h18',
  waypoint: 'M12 21s7-6 7-12A7 7 0 0 0 5 9c0 6 7 12 7 12ZM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
}

export function venueIcon(category: PlaceCategory) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', categoryPaths[category])
  svg.append(path)
  return svg
}

const CATEGORY_WORDS: Record<PlaceCategory, string> = { cafe: 'food and drink', seating: 'outdoor place', landmark: 'landmark', waypoint: 'waypoint' }

/** A venue pin with an optional name label; `live` marks a Google Maps result. */
export function placeMarkerElement(name: string, category: PlaceCategory, onClick: () => void, live = false) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = `map-place-marker is-${category}${live ? ' is-live' : ''}`
  element.setAttribute('aria-label', `${name}, ${CATEGORY_WORDS[category]}${live ? ' on Google Maps' : ''}. Show venue details.`)
  element.title = name
  const icon = document.createElement('span')
  icon.className = 'map-place-icon'
  icon.append(venueIcon(category))
  const label = document.createElement('span')
  label.className = 'map-place-name'
  label.textContent = name.replace(' (outside)', '')
  element.append(icon, label)
  element.addEventListener('click', (event) => { event.stopPropagation(); onClick() })
  return { element, label }
}

export interface StopCallbacks {
  onSelect: (planId: string) => void
  onFocusStop: (focus: StopFocus | null) => void
}

/** A numbered route stop. Hovering or focusing it highlights the itinerary row. */
export function stopMarkerElement(planId: string, index: StopIndex, label: string, passBy: boolean, callbacks: () => StopCallbacks) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'map-stop-marker'
  const pin = document.createElement('span')
  pin.className = `map-stop-pin${index === 'start' ? ' is-start' : ''}${passBy ? ' is-pass' : ''}`
  pin.textContent = label
  pin.setAttribute('aria-hidden', 'true')
  element.append(pin)
  element.addEventListener('click', (event) => { event.stopPropagation(); callbacks().onSelect(planId); callbacks().onFocusStop({ planId, index, reveal: false }) })
  element.addEventListener('focus', () => callbacks().onFocusStop({ planId, index, reveal: false }))
  element.addEventListener('mouseenter', () => callbacks().onFocusStop({ planId, index, reveal: false }))
  element.addEventListener('mouseleave', () => { if (document.activeElement !== element) callbacks().onFocusStop(null) })
  element.addEventListener('blur', () => callbacks().onFocusStop(null))
  return element
}

export function stopPopupContent(name: string, detail: string) {
  const content = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = name
  content.append(title)
  if (detail) { const text = document.createElement('span'); text.textContent = detail; content.append(text) }
  return content
}

/**
 * Hide venue names that would overlap, keeping the selected one. `project`
 * returns a marker's screen position, or null if it is not on screen.
 */
export function layoutPlaceLabels<T extends { element: HTMLElement; label: HTMLElement; id: string }>(
  venues: T[], selectedId: string | null | undefined, zoom: number, minZoom: number, project: (venue: T) => { x: number; y: number } | null,
) {
  const boxes: [number, number, number, number][] = []
  const ordered = [...venues].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId))
  for (const venue of ordered) {
    if (venue.element.hidden) continue
    const selected = venue.id === selectedId
    const at = project(venue)
    if (!at) continue
    const width = Math.min(150, (venue.label.textContent?.length ?? 0) * 6.5 + 8)
    const box: [number, number, number, number] = [at.x + 16, at.y - 13, at.x + 16 + width, at.y + 13]
    const collision = boxes.some(([left, top, right, bottom]) => box[0] < right && box[2] > left && box[1] < bottom && box[3] > top)
    const hide = !selected && (zoom < minZoom || collision)
    venue.element.classList.toggle('is-label-hidden', hide)
    if (!hide) boxes.push(box)
  }
}

/** Accessible name and visible detail for one stop of a plan. */
export function stopDescription(name: string, when: string, dwellSec: number | null) {
  const detail = dwellSec === null ? '' : `${when}${dwellSec === 0 ? 'Pass by' : `${Math.round(dwellSec / 60)} min stop`}`
  return { label: `${name}${detail ? `, ${detail}` : ''}`, title: `${name}${detail ? ` — ${detail}` : ''}`, detail }
}
