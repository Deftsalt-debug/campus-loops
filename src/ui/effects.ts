import type { PointerEvent as ReactPointerEvent } from 'react'

// Small pointer effects shared by buttons and cards. Both are pure DOM
// side-effects so they don't cause React re-renders while the pointer moves.

let motionPreference: MediaQueryList | undefined
const reducedMotion = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  motionPreference ??= window.matchMedia('(prefers-reduced-motion: reduce)')
  return motionPreference.matches
}

/** Track the pointer inside an element (sets --mx/--my) for the spotlight border. */
export function spotlight(e: ReactPointerEvent<HTMLElement>) {
  if (e.pointerType === 'touch' || reducedMotion()) return
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
  el.style.setProperty('--my', `${e.clientY - rect.top}px`)
}

/** Material-style ripple from the press point. The host needs position: relative and overflow: hidden. */
export function ripple(e: ReactPointerEvent<HTMLElement>) {
  if (reducedMotion() || e.button !== 0 || !e.isPrimary) return
  const el = e.currentTarget
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return
  const rect = el.getBoundingClientRect()
  const size = Math.hypot(rect.width, rect.height) * 2
  // Bound DOM work when somebody repeatedly presses a control.
  const existing = Array.from(el.children).filter((child) => child.classList.contains('ripple'))
  existing.slice(0, Math.max(0, existing.length - 3)).forEach((child) => child.remove())
  const span = document.createElement('span')
  span.className = 'ripple'
  span.setAttribute('aria-hidden', 'true')
  span.style.width = span.style.height = `${size}px`
  span.style.left = `${e.clientX - rect.left - size / 2}px`
  span.style.top = `${e.clientY - rect.top - size / 2}px`
  el.appendChild(span)
  const cleanUp = () => {
    window.clearTimeout(timeout)
    span.removeEventListener('animationend', cleanUp)
    span.removeEventListener('animationcancel', cleanUp)
    span.remove()
  }
  // Switching reduced motion on mid-animation or unloading its stylesheet can
  // suppress animationend. The fallback prevents abandoned effect elements.
  const timeout = window.setTimeout(cleanUp, 800)
  span.addEventListener('animationend', cleanUp, { once: true })
  span.addEventListener('animationcancel', cleanUp, { once: true })
}
