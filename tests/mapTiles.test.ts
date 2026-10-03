import { describe, expect, it } from 'vitest'
import { OSM_TILE_URL, mapTileConfiguration } from '../src/ui/mapTiles'

describe('public map tile configuration', () => {
  it('uses a tile-free local overview by default, with credit for the bundled paths', () => {
    const config = mapTileConfiguration({})
    expect(config.ok).toBe(true)
    if (!config.ok) return
    expect(config.url).toBeNull()
    expect(config.maxZoom).toBe(19)
    expect(config.attribution).toContain('https://www.openstreetmap.org/copyright')
  })

  it('treats a blank tile URL as no remote tiles even when other settings remain', () => {
    const config = mapTileConfiguration({ VITE_MAP_TILE_URL: '  ', VITE_MAP_TILE_ATTRIBUTION: 'Previous provider', VITE_MAP_TILE_MAX_ZOOM: '18' })
    expect(config.ok && config.url).toBeNull()
  })

  it('supports an explicitly configured OSM server with its linked credit', () => {
    const config = mapTileConfiguration({ VITE_MAP_TILE_URL: OSM_TILE_URL })
    expect(config.ok).toBe(true)
    if (!config.ok) return
    expect(config.url).toBe(OSM_TILE_URL)
    expect(config.attribution).toContain('https://www.openstreetmap.org/copyright')
  })

  it('requires provider credit for custom templates and escapes it as text', () => {
    const url = 'https://{s}.example.org/{z}/{x}/{y}.png'
    expect(mapTileConfiguration({ VITE_MAP_TILE_URL: url }).ok).toBe(false)
    const config = mapTileConfiguration({ VITE_MAP_TILE_URL: url, VITE_MAP_TILE_ATTRIBUTION: 'Example <img onerror="x">', VITE_MAP_TILE_MAX_ZOOM: '17' })
    expect(config.ok).toBe(true)
    if (!config.ok) return
    expect(config.maxZoom).toBe(17)
    expect(config.attribution).toContain('Example &#60;img')
    expect(config.attribution).not.toContain('<img')
  })

  it('supports same-origin tiles', () => {
    expect(mapTileConfiguration({ VITE_MAP_TILE_URL: '/tiles/{z}/{x}/{y}.png', VITE_MAP_TILE_ATTRIBUTION: 'Local maps' }).ok).toBe(true)
  })

  it.each(['http://example.org/{z}/{x}/{y}', 'javascript:alert(1)/{z}/{x}/{y}', '//example.org/{z}/{x}/{y}', '/\\example.org/{z}/{x}/{y}', 'https://user:password@example.org/{z}/{x}/{y}', 'tiles/{z}/{x}/{y}', 'https://example.org/tiles#{z}/{x}/{y}'])('rejects unsafe or ambiguous URLs: %s', (url) => {
    expect(mapTileConfiguration({ VITE_MAP_TILE_URL: url, VITE_MAP_TILE_ATTRIBUTION: 'Example maps' }).ok).toBe(false)
  })

  it('rejects a template missing a coordinate', () => {
    expect(mapTileConfiguration({ VITE_MAP_TILE_URL: 'https://example.org/{z}/{x}', VITE_MAP_TILE_ATTRIBUTION: 'Example maps' }).ok).toBe(false)
  })

  it.each(['https://example.org/{z}/{x}/{y}?key={apiKey}', 'https://example.org/{z}/{x}/{y}/{broken', 'https://example.org/{z}/{x}/{y}/oops}'])('rejects templates that would fail inside Leaflet: %s', (url) => {
    expect(mapTileConfiguration({ VITE_MAP_TILE_URL: url, VITE_MAP_TILE_ATTRIBUTION: 'Example maps' })).toEqual({ ok: false, message: 'The map tile address has an unsupported or incomplete placeholder.' })
  })

  it('accepts the supported subdomain and retina placeholders', () => {
    expect(mapTileConfiguration({ VITE_MAP_TILE_URL: 'https://{s}.example.org/{z}/{x}/{y}{r}.png', VITE_MAP_TILE_ATTRIBUTION: 'Example maps' }).ok).toBe(true)
  })

  it.each(['0', '23', 'NaN', 'Infinity', '18.5', '-1'])('rejects invalid zoom limits: %s', (zoom) => {
    expect(mapTileConfiguration({ VITE_MAP_TILE_MAX_ZOOM: zoom }).ok).toBe(false)
  })
})
