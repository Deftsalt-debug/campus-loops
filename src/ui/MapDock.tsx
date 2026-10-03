import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { googleMapsDirectionsUrl, googleMapsSearchUrl } from '../core/export/googleMaps'
import { planGeometry } from '../core/geo'
import { useDelayedFlag } from './hooks'
import { Icon } from './icons'
import { RouteMap } from './RouteMap'
import './MapDock.css'

type MapProps = Omit<ComponentProps<typeof RouteMap>, 'touchPan'>

interface Props extends MapProps {
  /** Side-by-side layout: the map is a full-height pane and always pannable. */
  wide: boolean
  /** Inputs changed and new walks are still being worked out. */
  pending: boolean
  title: string | null
  subtitle: string
}

/**
 * The single map instance. On phones it sits inline between the steps and can
 * expand to full screen; on wide screens CSS pins it beside the panel. It is
 * never unmounted when the layout changes, so it never rebuilds or flashes.
 */
export function MapDock({ wide, pending, title, subtitle, ...map }: Props) {
  const ref = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [hint, setHint] = useState(false)
  const [refitKey, setRefitKey] = useState(0)
  const busy = useDelayedFlag(pending, 140)
  // These normal links work even if the optional Leaflet chunk fails to load.
  const campusUrl = googleMapsSearchUrl('MIT Manipal, Karnataka, India')
  const walkUrl = useMemo(() => {
    const selected = map.plans.find((plan) => plan.id === map.selectedId)
    if (!selected) return null
    try { return googleMapsDirectionsUrl(planGeometry(map.dataset, selected)).url }
    catch { return null }
  }, [map.dataset, map.plans, map.selectedId])
  // Rotating or resizing into the side-by-side layout ends full screen.
  if (wide && expanded) setExpanded(false)
  const full = expanded && !wide
  const touchPan = wide || full

  // Expanded: lock page scroll and make the map a keyboard-accessible modal.
  useEffect(() => {
    if (!full) return
    const root = document.documentElement
    const dock = ref.current
    if (!dock) return
    const previousOverflow = root.style.overflow
    const previousFocus = document.activeElement
    root.style.overflow = 'hidden'
    // The skip link and other app siblings also sit outside <main>. Walk up
    // the ancestor chain so none of the covered page remains focusable.
    const covered: HTMLElement[] = []
    let branch: HTMLElement = dock
    while (branch.parentElement) {
      const parent = branch.parentElement
      for (const sibling of parent.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
          covered.push(sibling)
          sibling.inert = true
        }
      }
      if (parent === document.body) break
      branch = parent
    }
    const controls = () => [...dock.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0)
    dock.querySelector<HTMLElement>('.map-expand')?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setExpanded(false)
        setRefitKey((key) => key + 1)
      } else if (event.key === 'Tab') {
        const items = controls()
        const first = items[0]
        const last = items.at(-1)
        if (!first) { event.preventDefault(); dock.focus(); return }
        if (!items.includes(document.activeElement as HTMLElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      root.style.overflow = previousOverflow
      covered.forEach((element) => { element.inert = false })
      window.removeEventListener('keydown', onKey, true)
      // The expand button disappears if resizing closes the modal; in that
      // case keep the keyboard at the map instead of losing focus to <body>.
      if (previousFocus instanceof HTMLElement && previousFocus !== document.body && previousFocus.isConnected && !previousFocus.closest('[inert]')) {
        previousFocus.focus({ preventScroll: true })
      } else {
        dock.querySelector<HTMLElement>('.map-expand, .map')?.focus({ preventScroll: true })
      }
    }
  }, [full])

  // Inline on a phone, one finger scrolls the page. Explain that once it is tried.
  useEffect(() => {
    const el = ref.current
    if (!el || touchPan) return
    let timer = 0
    let startY = 0
    const onStart = (e: TouchEvent) => { startY = e.touches[0]?.clientY ?? 0 }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || Math.abs((e.touches[0]?.clientY ?? 0) - startY) > 24) return
      setHint(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setHint(false), 1600)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      setHint(false)
    }
  }, [touchPan])

  return (
    <section ref={ref} className={`map-dock${full ? ' is-expanded' : ''}${busy ? ' is-busy' : ''}`} aria-label={full ? 'Map, full screen' : 'Map'} role={full ? 'dialog' : undefined} aria-modal={full || undefined} tabIndex={full ? -1 : undefined} aria-busy={pending}>
      <div className="map-progress" aria-hidden="true" />
      <div className="map-label">
        <span className="eyebrow">Saved campus overview</span>
        <b key={title ?? ''}>{title ?? 'MIT Manipal'}</b>
        <span className="sr-only">{subtitle}</span>
      </div>
      {!wide && (
        <button type="button" className="map-btn map-expand" onClick={() => { setExpanded((v) => !v); setRefitKey((k) => k + 1) }} aria-pressed={full}
          aria-label={full ? 'Close full-screen map' : 'Expand map to full screen'}>
          <Icon name={full ? 'collapse' : 'expand'} size={16} />
        </button>
      )}
      <RouteMap {...map} touchPan={touchPan} refitKey={refitKey} />
      <nav className="map-external" aria-label="Google Maps">
        <a href={campusUrl} target="_blank" rel="noopener noreferrer" aria-label="Explore MIT Manipal in Google Maps">
          Google Maps <Icon name="arrow" size={14} />
        </a>
        {walkUrl && <a href={walkUrl} target="_blank" rel="noopener noreferrer" aria-label="Open this walk in Google Maps">
          This walk <Icon name="arrow" size={14} />
        </a>}
      </nav>
      <p className={`map-gesture${hint ? ' is-on' : ''}`} aria-hidden="true">Use two fingers to move the map, or expand it</p>
    </section>
  )
}
