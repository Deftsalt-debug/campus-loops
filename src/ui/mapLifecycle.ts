import type * as Leaflet from 'leaflet'

/**
 * Leaflet 1.9.4 only removes the container's touchstart hook in disable().
 * Its document listeners survive a pinch with no movement, and a queued pinch
 * frame can still run after remove(). Release both before removing the map.
 */
export function releaseTouchZoom(map: Leaflet.Map, L: typeof Leaflet): void {
  const touch = map.touchZoom as Leaflet.Handler & {
    _zooming?: boolean
    _animRequest?: number
    _onTouchMove?: Leaflet.DomEvent.EventHandlerFn
    _onTouchEnd?: Leaflet.DomEvent.EventHandlerFn
  }
  if (!touch) return
  touch._zooming = false
  if (touch._animRequest !== undefined) L.Util.cancelAnimFrame(touch._animRequest)
  // Leaflet accepts EventTargets here, although its declaration only names HTMLElement.
  const target = document as unknown as HTMLElement
  if (touch._onTouchMove) L.DomEvent.off(target, 'touchmove', touch._onTouchMove, touch)
  if (touch._onTouchEnd) L.DomEvent.off(target, 'touchend touchcancel', touch._onTouchEnd, touch)
}
