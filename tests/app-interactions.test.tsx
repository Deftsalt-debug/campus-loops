// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeShare } from '../src/core/share'
import type { RouteMap } from '../src/ui/RouteMap'

const mapState = vi.hoisted(() => ({ mounts: 0, props: null as ComponentProps<typeof RouteMap> | null }))
vi.mock('../src/ui/Backdrop', () => ({ Backdrop: () => null }))
vi.mock('../src/ui/RouteMap', async () => {
  const { useEffect } = await import('react')
  return { RouteMap: (props: ComponentProps<typeof RouteMap>) => {
    useEffect(() => { mapState.props = props })
    useEffect(() => { mapState.mounts++ }, [])
    return <div className="map-shell"><div className="map" tabIndex={0} /></div>
  } }
})
import App from '../src/App'

let root: Root
let container: HTMLDivElement
const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy()
  await act(async () => { (element as HTMLElement).click() })
}
const currentMap = () => mapState.props
const button = (text: string) => [...container.querySelectorAll('button')].find((el) => el.textContent?.includes(text))

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-02T04:30:00Z'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mapState.mounts = 0; mapState.props = null
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<App />))
  await act(async () => { await vi.dynamicImportSettled() })
  expect(currentMap()?.plans.length).toBeGreaterThan(1)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('three-step flow regression checks', () => {
  it('keeps the last quick duration edit authoritative for cards, itinerary, map and URL', async () => {
    await click(button('Time you have:'))
    await act(async () => {
      for (const text of ['30 min', '90 min', '45 min']) {
        [...container.querySelectorAll('.number-choices button, .tray-card button')].find((el) => el.textContent === text)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
    })
    const decoded = decodeShare(window.location.hash)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.shared.request.durationMin).toBe(45)
    expect(mapState.props?.selectedId).toBe(decoded.shared.planId)
    expect(container.querySelector('#detail-title')?.textContent).toBe(mapState.props?.plans.find((p) => p.id === decoded.shared.planId)?.name)
    expect(container.querySelector('.walk[aria-pressed="true"] .walk-name')?.textContent).toContain(container.querySelector('#detail-title')?.textContent)
    expect(mapState.mounts).toBe(1)
  })

  it('clears old invalid input and drawer state when a saved walk is opened', async () => {
    await click(container.querySelector('.go-row button:nth-child(2)'))
    await click(button('Time you have:'))
    const input = container.querySelector<HTMLInputElement>('#duration')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await click(container.querySelector('[aria-label^="Saved walks,"]'))
    expect(container.querySelector('dialog')?.open).toBe(true)
    await click(container.querySelector('.saved-open'))
    expect(container.querySelector('dialog')?.open).toBe(false)
    expect(container.querySelector('#duration')?.getAttribute('aria-invalid')).toBe('false')
    expect(mapState.props?.plans.length).toBe(1)
    expect(mapState.mounts).toBe(1)
  })

  it('rebuilds a chosen shared walk without replacing the map instance', async () => {
    const choices = container.querySelectorAll('.walk')
    await click(choices[1])
    const shared = window.location.hash
    const selected = mapState.props?.selectedId
    await click(button('Café stop'))
    await act(async () => {
      window.history.replaceState(null, '', `/${shared}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(mapState.props?.plans.length).toBe(1)
    expect(mapState.props?.selectedId).toBe(selected)
    expect(container.textContent).toContain('Showing a shared plan')
    expect(mapState.mounts).toBe(1)
  })
})
