import { useEffect, useRef, useState, type ComponentProps } from 'react'
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
  // Rotating or resizing into the side-by-side layout ends full screen.
  if (wide && expanded) setExpanded(false)
  const full = expanded && !wide
  const touchPan = wide || full

  // Expanded: lock page scroll, close with Escape, keep focus on the controls.
  useEffect(() => {
    if (!full) return
    const root = document.documentElement
    const dock = ref.current
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    // Behave as a modal: everything the full-screen map covers leaves the tab order and accessibility tree.
    const covered = [...(dock?.parentElement?.children ?? [])].filter((el): el is HTMLElement => el !== dock && el instanceof HTMLElement && !el.inert)
    covered.forEach((el) => { el.inert = true })
    dock?.querySelector<HTMLElement>('.map-expand')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setExpanded(false); setRefitKey((k) => k + 1) } }
    window.addEventListener('keydown', onKey)
    return () => {
      root.style.overflow = previous
      covered.forEach((el) => { el.inert = false })
      window.removeEventListener('keydown', onKey)
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
    <section ref={ref} className={`map-dock${full ? ' is-expanded' : ''}${busy ? ' is-busy' : ''}`} aria-label={full ? 'Map, full screen' : 'Map'} aria-busy={pending}>
      <div className="map-progress" aria-hidden="true" />
      <div className="map-label">
        <span className="eyebrow">{subtitle}</span>
        <b key={title ?? ''}>{title ?? 'Your walk starts here'}</b>
      </div>
      {!wide && (
        <button type="button" className="map-btn map-expand" onClick={() => { setExpanded((v) => !v); setRefitKey((k) => k + 1) }} aria-pressed={full}
          aria-label={full ? 'Close full-screen map' : 'Expand map to full screen'}>
          <Icon name={full ? 'collapse' : 'expand'} size={16} />
        </button>
      )}
      <RouteMap {...map} touchPan={touchPan} refitKey={refitKey} />
      <p className={`map-gesture${hint ? ' is-on' : ''}`} aria-hidden="true">Use two fingers to move the map, or expand it</p>
    </section>
  )
}
