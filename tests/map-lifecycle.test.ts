import type * as Leaflet from 'leaflet'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { releaseTouchZoom } from '../src/ui/mapLifecycle'

const leafletSource = readFileSync(createRequire(import.meta.url).resolve('leaflet'), 'utf8')
afterEach(() => vi.unstubAllGlobals())

interface TouchZoom {
  _zooming?: boolean
  _onTouchStart: (event: { touches: { clientX: number; clientY: number }[]; preventDefault: () => void }) => void
  _onTouchMove: Leaflet.DomEvent.EventHandlerFn
  _onTouchEnd: () => void
}

/** Run the installed Leaflet's actual event wrappers, touch handler and RAF utility. */
function gestureFixture({ moved, nativeTouch = true }: { moved: boolean; nativeTouch?: boolean }) {
  const target = Object.assign(new EventTarget(), {
    documentElement: { style: {} },
    createElement: () => ({ style: {}, firstChild: { style: {} } }),
    getElementsByTagName: () => [],
  })
  vi.stubGlobal('document', target)
  const frames = new Map<number, () => void>()
  let frameId = 0
  const window = Object.assign(new EventTarget(), {
    screen: {},
    ...(nativeTouch ? { TouchEvent: Event } : { PointerEvent: Event }),
    requestAnimationFrame: (fn: () => void) => { frames.set(++frameId, fn); return frameId },
    cancelAnimationFrame: (id: number) => { frames.delete(id) },
    setTimeout,
    clearTimeout,
  })
  const context = { window, document: target, navigator: { userAgent: 'mobile', platform: 'MacIntel' }, exports: {}, module: {} }
  runInNewContext(leafletSource, context)
  const L = context.exports as typeof Leaflet
  const map = {
    options: { touchZoom: true, zoomAnimation: false, bounceAtZoomLimits: true },
    mouseEventToContainerPoint: (point: { clientX: number; clientY: number }) => L.point(point.clientX, point.clientY),
    getSize: () => L.point(320, 280),
    containerPointToLatLng: () => L.latLng(13, 74),
    getZoom: () => 16,
    getScaleZoom: (scale: number, zoom: number) => zoom + Math.log2(scale),
    project: () => L.point(100, 100),
    unproject: (point: Leaflet.Point) => L.latLng(point.y / 100, point.x / 100),
    _limitZoom: Math.round,
    _moveStart: vi.fn(),
    _move: vi.fn(),
    _stop: vi.fn(),
    _resetView: vi.fn(),
  }
  const Handler = (L.Map as unknown as { TouchZoom: new (map: object) => TouchZoom }).TouchZoom
  const touchZoom = new Handler(map)
  touchZoom._onTouchMove = vi.fn(touchZoom._onTouchMove)
  touchZoom._onTouchEnd = vi.fn(touchZoom._onTouchEnd)
  const dispatch = (type: string, properties: object) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), properties))
  const points = [{ clientX: 80, clientY: 90 }, { clientX: 160, clientY: 90 }]
  if (!nativeTouch) {
    // Registering touchstart installs Leaflet's global pointer bookkeeping.
    const container = new EventTarget()
    L.DomEvent.on(container as unknown as HTMLElement, 'touchstart', touchZoom._onTouchStart as unknown as Leaflet.DomEvent.EventHandlerFn, touchZoom)
    points.forEach((point, i) => dispatch('pointerdown', { ...point, pointerId: i + 1, pointerType: 'touch' }))
  }
  touchZoom._onTouchStart({ touches: points, preventDefault: () => {} })
  const continueGesture = () => {
    if (nativeTouch) {
      dispatch('touchmove', { touches: points.map((point) => ({ clientX: point.clientX + 40, clientY: point.clientY + 20 })) })
      dispatch('touchend', { touches: [] })
      dispatch('touchcancel', { touches: [] })
    } else {
      dispatch('pointermove', { clientX: 120, clientY: 110, pointerId: 1, pointerType: 'touch' })
      dispatch('pointerup', { pointerId: 1, pointerType: 'touch' })
      dispatch('pointercancel', { pointerId: 2, pointerType: 'touch' })
    }
    frames.forEach((frame) => frame())
  }
  if (moved) {
    if (nativeTouch) dispatch('touchmove', { touches: points.map((point) => ({ clientX: point.clientX + 20, clientY: point.clientY })) })
    else dispatch('pointermove', { clientX: 100, clientY: 90, pointerId: 1, pointerType: 'touch' })
    expect(frames.size).toBe(1)
  } else {
    // The upstream no-movement early return leaves its document listeners attached.
    touchZoom._onTouchEnd()
  }
  vi.mocked(touchZoom._onTouchMove).mockClear()
  vi.mocked(touchZoom._onTouchEnd).mockClear()
  const remove = () => releaseTouchZoom({ touchZoom } as unknown as Leaflet.Map, L)
  return { touchZoom, map, frames, remove, continueGesture }
}

describe('map touch gesture teardown', () => {
  it.each([true, false])('releases Leaflet document wrappers and queued pinch frames with native touch = %s', (nativeTouch) => {
    const fixture = gestureFixture({ moved: true, nativeTouch })
    fixture.remove()
    fixture.continueGesture()
    expect(fixture.touchZoom._zooming).toBe(false)
    expect(fixture.touchZoom._onTouchMove).not.toHaveBeenCalled()
    expect(fixture.touchZoom._onTouchEnd).not.toHaveBeenCalled()
    expect(fixture.map._move).not.toHaveBeenCalled()
    expect(fixture.frames.size).toBe(0)
  })

  it('releases actual lingering document wrappers after a two-finger tap that never moved', () => {
    const fixture = gestureFixture({ moved: false })
    fixture.remove()
    fixture.continueGesture()
    expect(fixture.touchZoom._onTouchMove).not.toHaveBeenCalled()
    expect(fixture.touchZoom._onTouchEnd).not.toHaveBeenCalled()
  })

  it('is harmless after Leaflet completed a normal pinch and can be repeated', () => {
    const fixture = gestureFixture({ moved: true })
    fixture.touchZoom._onTouchEnd()
    expect(fixture.map._resetView).toHaveBeenCalledTimes(1)
    vi.mocked(fixture.touchZoom._onTouchEnd).mockClear()
    fixture.remove()
    fixture.remove()
    fixture.continueGesture()
    expect(fixture.map._resetView).toHaveBeenCalledTimes(1)
    expect(fixture.touchZoom._onTouchMove).not.toHaveBeenCalled()
    expect(fixture.touchZoom._onTouchEnd).not.toHaveBeenCalled()
  })

  it('safely handles a map whose optional touch handler failed to initialize', () => {
    expect(() => releaseTouchZoom({} as Leaflet.Map, {} as typeof Leaflet)).not.toThrow()
  })
})
