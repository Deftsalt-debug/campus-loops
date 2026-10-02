// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutingBuilder } from '../src/ui/OutingBuilder'
import { Backdrop } from '../src/ui/Backdrop'
import { Drawer, type DrawerTab } from '../src/ui/Drawer'
import { initialForm, type FormState } from '../src/ui/planningState'
import { plan } from '../src/core/planner/plan'
import { toRequest } from '../src/ui/planningState'
import { fixture, ist } from './helpers'
import type { RouteMap } from '../src/ui/RouteMap'

const mapState = vi.hoisted(() => ({ mounts: 0, unmounts: 0, props: null as ComponentProps<typeof RouteMap> | null }))
vi.mock('../src/ui/RouteMap', async () => {
  const { useEffect } = await import('react')
  return { RouteMap: (props: ComponentProps<typeof RouteMap>) => {
    useEffect(() => { mapState.props = props })
    useEffect(() => { mapState.mounts++; return () => { mapState.unmounts++ } }, [])
    return <div className="map-shell"><div className="map" tabIndex={0} /><button type="button" className="map-refit">Show entire route</button></div>
  } }
})
import { MapDock } from '../src/ui/MapDock'

const dataset = fixture()
const plans = plan(dataset, toRequest(initialForm(dataset)), ist('2026-10-02', '10:00')).plans
let root: Root
let container: HTMLDivElement
let reduced = false
const motionListeners = new Set<() => void>()
const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy()
  await act(async () => { (element as HTMLElement).click() })
}
const button = (label: string) => [...container.querySelectorAll('button')].find((el) => el.textContent?.includes(label))
const fill = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const render = async (element: React.ReactNode) => { await act(async () => root.render(element)) }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  reduced = false; motionListeners.clear()
  mapState.mounts = 0; mapState.unmounts = 0; mapState.props = null
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('reduced-motion') ? reduced : false },
    addEventListener: (_: string, fn: () => void) => motionListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => motionListeners.delete(fn),
  }))
  Object.defineProperty(HTMLElement.prototype, 'inert', { configurable: true, get() { return this.hasAttribute('inert') }, set(value: boolean) { this.toggleAttribute('inert', value) } })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

function Builder({ initial }: { initial: FormState }) {
  const [state, setState] = useState(initial)
  return <OutingBuilder dataset={dataset} state={state} onChange={(patch) => setState((old) => ({ ...old, ...patch }))} durationError={null} budgetError={null} previewError={null} />
}

describe('recoverable stop-time edits', () => {
  it('keeps an invalid stop time visible and linked when its editor closes', async () => {
    const place = dataset.places.find((p) => p.category !== 'waypoint')!
    await render(<Builder initial={{ ...initialForm(dataset), required: [place.id, ''] }} />)
    await click(button('must-visit'))
    await fill(container.querySelector<HTMLInputElement>('#stop-time-0')!, '')
    await click(button('Done'))
    const error = [...container.querySelectorAll('[role="alert"]')].find((el) => !el.closest('.tray'))
    expect(error?.textContent).toContain('stop time')
    const trigger = button('must-visit')!
    expect(trigger.getAttribute('aria-describedby')).toBe(error?.id)
    expect(container.querySelector('.tray')?.hasAttribute('inert')).toBe(true)
    await click(trigger)
    expect(document.activeElement?.id).toBe('stop-time-0')
    expect(trigger.getAttribute('aria-describedby')).toBe('stop-time-0-error')
    expect([...container.querySelectorAll('[role="alert"]')].filter((el) => !el.closest('.tray'))).toHaveLength(0)
    await fill(container.querySelector<HTMLInputElement>('#stop-time-0')!, '5')
    await click(button('Done'))
    expect([...container.querySelectorAll('[role="alert"]')].filter((el) => !el.closest('.tray'))).toHaveLength(0)
  })

  it('links to the first invalid field in displayed stop order', async () => {
    const [first, second] = dataset.places.filter((p) => p.category !== 'waypoint')
    await render(<Builder initial={{ ...initialForm(dataset), required: [second.id, first.id], dwellOverridesMin: { [first.id]: NaN, [second.id]: NaN } }} />)
    const trigger = button('must-visit')!
    await click(trigger)
    expect(document.activeElement?.id).toBe('stop-time-0')
    expect(trigger.getAttribute('aria-describedby')).toBe('stop-time-0-error')
  })

  it('exposes custom times from a shared walk even with no required places', async () => {
    const place = dataset.places.find((p) => p.category !== 'waypoint')!
    await render(<Builder initial={{ ...initialForm(dataset), required: ['', ''], dwellOverridesMin: { [place.id]: 7.5 } }} />)
    const summary = container.querySelector('.stops-summary')
    expect(summary?.textContent).toContain(place.name)
    expect(summary?.textContent).toContain('7.5 min')
    await click(button('Stop times'))
    expect(container.querySelector<HTMLInputElement>('#stop-time-0')?.value).toBe('7.5')
  })
})

describe('persistent map fullscreen lifecycle', () => {
  const dock = (wide: boolean) => <><button id="before-map">Before</button><MapDock wide={wide} pending={false} title={plans[0].name} subtitle="Test walk" dataset={dataset} plans={plans} selectedId={plans[0].id} hoveredId={null} startSec={36000} focus={null} onSelect={() => {}} onHover={() => {}} onFocusStop={() => {}} /><button id="after-map">After</button></>
  it('retains a single map through repeated full screen, Escape, and responsive changes', async () => {
    await render(dock(false))
    const original = container.querySelector('.map')
    for (let i = 0; i < 3; i++) {
      await click(container.querySelector('.map-expand'))
      expect(container.querySelector('.map-dock')?.getAttribute('aria-modal')).toBe('true')
      expect(container.querySelector('#before-map')?.hasAttribute('inert')).toBe(true)
      expect(document.documentElement.style.overflow).toBe('hidden')
      await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      expect(document.documentElement.style.overflow).toBe('')
      expect(container.querySelector('#before-map')?.hasAttribute('inert')).toBe(false)
      expect(mapState.props?.touchPan).toBe(false)
    }
    await click(container.querySelector('.map-expand'))
    await render(dock(true))
    expect(document.documentElement.style.overflow).toBe('')
    expect(mapState.props?.touchPan).toBe(true)
    expect(container.querySelector('.map')).toBe(original)
    expect(mapState.mounts).toBe(1); expect(mapState.unmounts).toBe(0)
    expect(document.activeElement).toBe(original)
  })
})

describe('drawer interrupted close', () => {
  it('can reopen the same tab after its parent closes during an exit animation', async () => {
    const close = vi.fn()
    const drawer = (tab: DrawerTab | null) => <Drawer tab={tab} onTab={() => {}} onClose={close} panels={{ saved: { label: 'Saved', render: () => 'Saved content' }, notes: { label: 'Notebook', render: () => 'Notes' }, about: { label: 'About', render: () => 'About' } }} />
    await render(drawer('saved'))
    await click(container.querySelector('[aria-label="Close"]'))
    expect(container.querySelector('dialog')?.classList.contains('is-closing')).toBe(true)
    await render(drawer(null))
    await render(drawer('saved'))
    expect(container.querySelector('dialog')?.open).toBe(true)
    expect(container.querySelector('dialog')?.classList.contains('is-closing')).toBe(false)
    reduced = true
    await click(container.querySelector('[aria-label="Close"]'))
    expect(close).toHaveBeenCalledTimes(1)
    expect(container.querySelector('dialog')?.open).toBe(false)
  })
})

describe('backdrop stays out of map gestures', () => {
  it('does not start a hotspot or ripple for map pointer activity', async () => {
    await render(<><Backdrop /><div className="map-shell"><button id="map-test">Map control</button></div></>)
    const target = container.querySelector('#map-test')!
    await act(async () => {
      target.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse', clientX: 100, clientY: 100 }))
      target.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'mouse', clientX: 100, clientY: 100, button: 0, isPrimary: true }))
    })
    expect(container.querySelector('.backdrop-glow')?.classList.contains('is-on')).toBe(false)
    expect(container.querySelectorAll('.backdrop-ripple')).toHaveLength(0)
  })
  it('cancels the moving hotspot when reduced motion is enabled', async () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    await render(<><Backdrop /><button id="plain-control">Control</button></>)
    const target = container.querySelector('#plain-control')!
    await act(async () => {
      target.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse', clientX: 100, clientY: 100 }))
      target.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { pointerType: 'mouse', clientX: 200, clientY: 200 }))
    })
    expect(container.querySelector('.backdrop-glow')?.classList.contains('is-on')).toBe(true)
    await act(async () => { reduced = true; motionListeners.forEach((listener) => listener()) })
    expect(cancel).toHaveBeenCalled()
    expect(container.querySelector('.backdrop-glow')?.classList.contains('is-on')).toBe(false)
  })

})
