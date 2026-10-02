import type { SVGProps } from 'react'

// Hand-drawn-style stroke icons, 24-unit grid, inherit the text colour.
const paths = {
  bookmark: 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z',
  menu: 'M4 7h16M4 12h16M4 17h10',
  close: 'M6 6l12 12M18 6L6 18',
  share: 'M12 4v11M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5',
  copy: 'M9 9h10v11H9zM5 15V5a1 1 0 0 1 1-1h9',
  arrow: 'M5 12h13M13 6l6 6-6 6',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  coffee: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1 1 1.5 1 2.5M11.5 3.5c0 1 1 1.5 1 2.5',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  pin: 'M12 21s-6-5.6-6-10.5A6 6 0 0 1 18 10.5C18 15.4 12 21 12 21zM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  chevron: 'M8 10l4 4 4-4',
  target: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  download: 'M12 4v11M8 11l4 4 4-4M5 19h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5v.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={paths[name]} />
    </svg>
  )
}

/** The Campus Loops mark: a loop that comes back to where it started. */
export function LoopMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="loop-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path pathLength={1} d="M5 18c-2-4 0-9 4-11s9-1 10 3-2 7-6 7-5-3-3-5 4-1 4 1" />
      <circle cx="5" cy="18" r="1.6" fill="currentColor" />
    </svg>
  )
}
