import { useEffect, useRef } from 'react'
import './Backdrop.css'

// The dot grid is a CSS background painted once. Pointer effects are two kinds
// of small layers moved only with transform/opacity, so they run on the
// compositor and never compete with the map or the planner for main-thread
// frames. (A full-viewport canvas redrawn every frame did, on every tap.)
const SPACING = 26
const GLOW = 170 // radius of the cursor hotspot
const MAX_RIPPLES = 4

export function Backdrop() {
  const root = useRef<HTMLDivElement>(null)
  const glow = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = root.current
    const spot = glow.current
    if (!host || !spot) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const target = { x: -9999, y: -9999 }
    const eased = { x: -9999, y: -9999 }
    let frame = 0
    let last = 0
    let inside = false

    // Keep the hotspot's own dots on the page grid as it moves.
    const place = () => {
      const left = eased.x - GLOW
      const top = eased.y - GLOW
      spot.style.transform = `translate3d(${left}px, ${top}px, 0)`
      spot.style.backgroundPosition = `${-mod(left)}px ${-mod(top)}px`
    }
    const step = (now: number) => {
      frame = 0
      // Time-based easing behaves the same on 60 Hz and 120 Hz displays.
      const elapsed = last ? Math.min(64, now - last) : 1000 / 60
      last = now
      const follow = 1 - 0.78 ** (elapsed / (1000 / 60))
      eased.x += (target.x - eased.x) * follow
      eased.y += (target.y - eased.y) * follow
      place()
      if (Math.abs(target.x - eased.x) > 0.4 || Math.abs(target.y - eased.y) > 0.4) frame = requestAnimationFrame(step)
      else last = 0
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || reduced.matches) return
      target.x = e.clientX
      target.y = e.clientY
      if (!inside) {
        inside = true
        eased.x = e.clientX
        eased.y = e.clientY
        place()
        spot.classList.add('is-on')
      }
      if (!frame) frame = requestAnimationFrame(step)
    }
    const onLeave = () => {
      inside = false
      spot.classList.remove('is-on')
    }
    const onDown = (e: PointerEvent) => {
      if (reduced.matches || e.button !== 0 || !e.isPrimary || document.hidden) return
      const ring = document.createElement('span')
      ring.className = 'backdrop-ripple'
      ring.style.left = `${e.clientX}px`
      ring.style.top = `${e.clientY}px`
      // Start the ring's dots on the page grid.
      ring.style.backgroundPosition = `${-mod(e.clientX - 400)}px ${-mod(e.clientY - 400)}px`
      host.querySelectorAll('.backdrop-ripple').forEach((old, i, all) => { if (i < all.length - (MAX_RIPPLES - 1)) old.remove() })
      host.appendChild(ring)
      const done = () => ring.remove()
      ring.addEventListener('animationend', done, { once: true })
      window.setTimeout(done, 1200) // in case the animation never runs
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    reduced.addEventListener('change', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      reduced.removeEventListener('change', onLeave)
    }
  }, [])

  return (
    <div ref={root} className="backdrop" aria-hidden="true">
      <div ref={glow} className="backdrop-glow" />
    </div>
  )
}

const mod = (v: number) => ((v % SPACING) + SPACING) % SPACING
