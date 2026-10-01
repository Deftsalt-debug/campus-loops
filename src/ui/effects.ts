import type { PointerEvent as ReactPointerEvent } from 'react'

// Small pointer effects shared by buttons and cards. Both are pure DOM
// side-effects so they don't cause React re-renders while the pointer moves.

/** Track the pointer inside an element (sets --mx/--my) for the spotlight border. */
export function spotlight(e: ReactPointerEvent<HTMLElement>) {
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
  el.style.setProperty('--my', `${e.clientY - rect.top}px`)
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Material-style ripple from the press point. The host needs position: relative and overflow: hidden. */
export function ripple(e: ReactPointerEvent<HTMLElement>) {
  if (reducedMotion()) return
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height) * 2.2
  const span = document.createElement('span')
  span.className = 'ripple'
  span.style.width = span.style.height = `${size}px`
  span.style.left = `${e.clientX - rect.left - size / 2}px`
  span.style.top = `${e.clientY - rect.top - size / 2}px`
  el.appendChild(span)
  span.addEventListener('animationend', () => span.remove(), { once: true })
}
