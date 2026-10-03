import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { plan } from '../src/core/planner/plan'
import { MapDock } from '../src/ui/MapDock'
import { fixture, ist } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const dataset = fixture()
const selected = plan(dataset, {
  startId: 'start_gate', durationMin: 60, budgetInr: 200, occasion: 'friends',
  requiredPlaceIds: [], requireCafe: false, pace: 'normal', avoidSteps: false, rain: false,
}, ist('2026-10-01', '10:00')).plans[0]

function render(overrides: Partial<ComponentProps<typeof MapDock>> = {}) {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  const html = renderToStaticMarkup(createElement(MapDock, {
    dataset, plans: [], selectedId: null, hoveredId: null, startSec: null, focus: null,
    onSelect: () => {}, onHover: () => {}, onFocusStop: () => {},
    wide: false, pending: false, title: null, subtitle: 'Campus',
    ...overrides,
  }))
  const links = [...html.matchAll(/href="(https:\/\/www\.google\.com\/maps[^"]+)"/g)]
    .map((match) => new URL(match[1].replaceAll('&amp;', '&')))
  return { html, links }
}

describe('Google Maps navigation outside the street-map renderer', () => {
  it('offers the campus map with no plans, before MapLibre has initialized', () => {
    const { html, links } = render()
    expect(html).toContain('MIT Manipal')
    expect(html).toContain('Loading street map')
    expect(links).toHaveLength(1)
    expect(links[0].pathname).toBe('/maps/search/')
    expect(links[0].searchParams.get('query')).toBe('MIT Manipal, Karnataka, India')
    expect(links[0].searchParams.get('api')).toBe('1')
  })

  it('offers walking directions for the selected route independently of MapLibre initialization', () => {
    const { links } = render({ plans: [selected], selectedId: selected.id, title: selected.name })
    expect(links).toHaveLength(2)
    const directions = links.find((link) => link.pathname === '/maps/dir/')!
    expect(directions.searchParams.get('travelmode')).toBe('walking')
    expect(directions.searchParams.get('origin')).toBe(directions.searchParams.get('destination'))
  })

  it('keeps the campus link usable if the selected route geometry cannot be exported', () => {
    const broken = { ...selected, edgeIds: ['missing-edge'] }
    const { links } = render({ plans: [broken], selectedId: broken.id })
    expect(links).toHaveLength(1)
    expect(links[0].pathname).toBe('/maps/search/')
  })
})
