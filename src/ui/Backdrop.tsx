import { useEffect, useRef } from 'react'

// The dot grid rests between interactions. A tiny repeating tile draws the
// static dots, and only the area touched by a hotspot or ripple is animated.
const SPACING = 26
const RADIUS = 150
const RIPPLE_SPEED = 0.9
const RIPPLE_LIFE = 900
const MAX_RIPPLES = 6

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
    let width = 0
    let height = 0
    let dpr = 1
    let spacing = SPACING
    let grid: CanvasPattern | null = null
    let needsResize = false
    let frame = 0
    let lastFrame = 0
    const target = { x: -9999, y: -9999 }
    const eased = { x: -9999, y: -9999 }
    let presence = 0
    let pointerInside = false
    let ripples: Ripple[] = []

    const readColours = () => {
      const css = getComputedStyle(document.documentElement)
      dot = css.getPropertyValue('--dot').trim() || dot
      glow = css.getPropertyValue('--glow').trim() || glow
    }
    const cacheGrid = () => {
      const tile = document.createElement('canvas')
      tile.width = tile.height = Math.round(SPACING * dpr)
      const tileCtx = tile.getContext('2d')
      if (!tileCtx) return
      spacing = tile.width / dpr
      tileCtx.fillStyle = `rgba(${dot}, 0.13)`
      tileCtx.fillRect(tile.width / 2 - 0.75 * dpr, tile.height / 2 - 0.75 * dpr, 1.5 * dpr, 1.5 * dpr)
      grid = ctx.createPattern(tile, 'repeat')
    }
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cacheGrid()
      needsResize = false
    }

    const draw = (now: number) => {
      frame = 0
      if (document.hidden) return
      if (needsResize) resize()
      const elapsed = lastFrame ? Math.min(64, now - lastFrame) : 1000 / 60
      lastFrame = now
      ctx.clearRect(0, 0, width, height)
      const offsetX = (width % spacing) / 2
      const offsetY = (height % spacing) / 2
      if (grid) {
        const shiftX = (offsetX - spacing / 2) * dpr
        const shiftY = (offsetY - spacing / 2) * dpr
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, shiftX, shiftY)
        ctx.fillStyle = grid
        ctx.fillRect(-shiftX, -shiftY, canvas.width, canvas.height)
        ctx.restore()
      }
      if (reduced.matches) {
        lastFrame = 0
        return
      }

      // Time-based easing behaves consistently on 60 Hz and 120 Hz displays.
      const follow = 1 - 0.78 ** (elapsed / (1000 / 60))
      const fade = 1 - 0.85 ** (elapsed / (1000 / 60))
      eased.x += (target.x - eased.x) * follow
      eased.y += (target.y - eased.y) * follow
      presence += ((pointerInside ? 1 : 0) - presence) * fade
      ripples = ripples.filter((ripple) => now - ripple.born < RIPPLE_LIFE)

      let minX = width
      let minY = height
      let maxX = 0
      let maxY = 0
      if (presence > 0.01) {
        const gradient = ctx.createRadialGradient(eased.x, eased.y, 0, eased.x, eased.y, RADIUS * 1.6)
        gradient.addColorStop(0, `rgba(${glow}, ${0.16 * presence})`)
        gradient.addColorStop(1, `rgba(${glow}, 0)`)
        ctx.fillStyle = gradient
        ctx.fillRect(eased.x - RADIUS * 2, eased.y - RADIUS * 2, RADIUS * 4, RADIUS * 4)
        minX = eased.x - RADIUS
        minY = eased.y - RADIUS
        maxX = eased.x + RADIUS
        maxY = eased.y + RADIUS
      }
      for (const ripple of ripples) {
        const radius = (now - ripple.born) * RIPPLE_SPEED + spacing
        minX = Math.min(minX, ripple.x - radius)
        minY = Math.min(minY, ripple.y - radius)
        maxX = Math.max(maxX, ripple.x + radius)
        maxY = Math.max(maxY, ripple.y + radius)
      }
      const firstX = offsetX + Math.max(0, Math.ceil((minX - offsetX) / spacing)) * spacing
      const firstY = offsetY + Math.max(0, Math.ceil((minY - offsetY) / spacing)) * spacing
      for (let x = firstX; x <= Math.min(width, maxX); x += spacing) {
        for (let y = firstY; y <= Math.min(height, maxY); y += spacing) {
          let boost = 0
          if (presence > 0.01) {
            const dx = x - eased.x
            const dy = y - eased.y
            const squaredDistance = dx * dx + dy * dy
            if (squaredDistance < RADIUS * RADIUS) boost = (1 - Math.sqrt(squaredDistance) / RADIUS) ** 2 * presence
          }
          for (const ripple of ripples) {
            const age = now - ripple.born
            const band = Math.abs(Math.hypot(x - ripple.x, y - ripple.y) - age * RIPPLE_SPEED)
            if (band < spacing) boost = Math.max(boost, (1 - band / spacing) * (1 - age / RIPPLE_LIFE))
          }
          if (boost <= 0.02) continue
          ctx.fillStyle = `rgba(${glow}, ${0.25 + boost * 0.75})`
          ctx.beginPath()
          ctx.arc(x, y, 1.1 + boost * 2.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      const settling =
        Math.abs(target.x - eased.x) > 0.5 || Math.abs(target.y - eased.y) > 0.5 || Math.abs((pointerInside ? 1 : 0) - presence) > 0.01
      if (settling || ripples.length > 0) frame = requestAnimationFrame(draw)
      else lastFrame = 0
    }
    const kick = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(draw)
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || reduced.matches || document.hidden) return
      if (!pointerInside) {
        eased.x = event.clientX
        eased.y = event.clientY
      }
      target.x = event.clientX
      target.y = event.clientY
      pointerInside = true
      kick()
    }
    const onLeave = () => {
      pointerInside = false
      kick()
    }
    const onDown = (event: PointerEvent) => {
      if (reduced.matches || document.hidden || event.button !== 0 || !event.isPrimary) return
      ripples = [...ripples.slice(-(MAX_RIPPLES - 1)), { x: event.clientX, y: event.clientY, born: performance.now() }]
      kick()
    }
    const onResize = () => {
      needsResize = true
      kick()
    }
    const onTheme = () => {
      readColours()
      cacheGrid()
      kick()
    }
    const resetMotion = () => {
      cancelAnimationFrame(frame)
      frame = 0
      lastFrame = 0
      presence = 0
      pointerInside = false
      ripples = []
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
    document.addEventListener('visibilitychange', resetMotion)
    dark.addEventListener('change', onTheme)
    reduced.addEventListener('change', resetMotion)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', resetMotion)
      dark.removeEventListener('change', onTheme)
      reduced.removeEventListener('change', resetMotion)
    }
  }, [])

  return <canvas ref={ref} className="backdrop" aria-hidden="true" />
}
