import { useEffect, useRef } from 'react'

// A dot grid behind the app. Dots near the pointer brighten and grow, and a
// click sends out a ripple that lights dots as it passes. It only animates
// while something is moving, then stops drawing. With reduced motion turned on
// it draws a static grid.

const SPACING = 26
const RADIUS = 150
const RIPPLE_SPEED = 0.9 // px per ms
const RIPPLE_LIFE = 900 // ms

interface Ripple {
  x: number
  y: number
  born: number
}

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    let dot = '22, 32, 27'
    let glow = '13, 122, 85'
    const readColours = () => {
      const css = getComputedStyle(document.documentElement)
      dot = css.getPropertyValue('--dot').trim() || dot
      glow = css.getPropertyValue('--glow').trim() || glow
    }

    let width = 0
    let height = 0
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Pointer target and an eased follower, for a smooth glide.
    const target = { x: -9999, y: -9999 }
    const eased = { x: -9999, y: -9999 }
    let presence = 0 // fades the hotspot in and out
    let pointerInside = false
    let ripples: Ripple[] = []
    let frame = 0

    const draw = (now: number) => {
      frame = 0
      ctx.clearRect(0, 0, width, height)

      eased.x += (target.x - eased.x) * 0.22
      eased.y += (target.y - eased.y) * 0.22
      presence += ((pointerInside ? 1 : 0) - presence) * 0.15
      ripples = ripples.filter((r) => now - r.born < RIPPLE_LIFE)

      // Soft glow under the pointer.
      if (presence > 0.01) {
        const g = ctx.createRadialGradient(eased.x, eased.y, 0, eased.x, eased.y, RADIUS * 1.6)
        g.addColorStop(0, `rgba(${glow}, ${0.16 * presence})`)
        g.addColorStop(1, `rgba(${glow}, 0)`)
        ctx.fillStyle = g
        ctx.fillRect(eased.x - RADIUS * 2, eased.y - RADIUS * 2, RADIUS * 4, RADIUS * 4)
      }

      const offsetX = (width % SPACING) / 2
      const offsetY = (height % SPACING) / 2
      for (let x = offsetX; x <= width; x += SPACING) {
        for (let y = offsetY; y <= height; y += SPACING) {
          let boost = 0
          if (presence > 0.01) {
            const d = Math.hypot(x - eased.x, y - eased.y)
            if (d < RADIUS) boost = (1 - d / RADIUS) ** 2 * presence
          }
          for (const r of ripples) {
            const age = now - r.born
            const ring = age * RIPPLE_SPEED
            const d = Math.hypot(x - r.x, y - r.y)
            const band = Math.abs(d - ring)
            if (band < 26) boost = Math.max(boost, (1 - band / 26) * (1 - age / RIPPLE_LIFE))
          }
          if (boost > 0.02) {
            ctx.fillStyle = `rgba(${glow}, ${0.25 + boost * 0.75})`
            ctx.beginPath()
            ctx.arc(x, y, 1.1 + boost * 2.4, 0, Math.PI * 2)
            ctx.fill()
          } else {
            ctx.fillStyle = `rgba(${dot}, 0.13)`
            ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5)
          }
        }
      }

      const settling =
        Math.abs(target.x - eased.x) > 0.5 || Math.abs(target.y - eased.y) > 0.5 || Math.abs((pointerInside ? 1 : 0) - presence) > 0.01
      if (!reduced.matches && (settling || ripples.length > 0)) frame = requestAnimationFrame(draw)
    }

    const kick = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (!pointerInside) {
        // Jump straight to the pointer on entry instead of gliding from far away.
        eased.x = e.clientX
        eased.y = e.clientY
      }
      target.x = e.clientX
      target.y = e.clientY
      pointerInside = true
      if (!reduced.matches) kick()
    }
    const onLeave = () => {
      pointerInside = false
      kick()
    }
    const onDown = (e: PointerEvent) => {
      if (reduced.matches) return
      ripples.push({ x: e.clientX, y: e.clientY, born: performance.now() })
      kick()
    }
    const onResize = () => {
      resize()
      kick()
    }
    const onTheme = () => {
      readColours()
      kick()
    }

    readColours()
    resize()
    kick()
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    window.addEventListener('resize', onResize)
    dark.addEventListener('change', onTheme)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      window.removeEventListener('resize', onResize)
      dark.removeEventListener('change', onTheme)
    }
  }, [])

  return <canvas ref={ref} className="backdrop" aria-hidden="true" />
}
