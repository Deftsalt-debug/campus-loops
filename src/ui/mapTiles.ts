export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const DEFAULT_VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

interface TileEnvironment {
  VITE_MAP_TILE_URL?: string
  VITE_MAP_TILE_ATTRIBUTION?: string
  VITE_MAP_TILE_MAX_ZOOM?: string
}

export type TileConfiguration =
  | { ok: true; url: string | null; attribution: string; maxZoom: number }
  | { ok: false; message: string }

/** An unset raster URL selects the OpenFreeMap vector street map.
 * Build-time overrides. Provider keys in VITE_* variables are public. */
export function mapTileConfiguration(env: TileEnvironment): TileConfiguration {
  const url = env.VITE_MAP_TILE_URL?.trim() || null
  const credit = env.VITE_MAP_TILE_ATTRIBUTION?.trim() || ''
  const zoom = env.VITE_MAP_TILE_MAX_ZOOM?.trim() || '19'
  const maxZoom = Number(zoom)
  if (!/^\d+$/.test(zoom) || !Number.isInteger(maxZoom) || maxZoom < 1 || maxZoom > 22) {
    return { ok: false, message: 'The map tile zoom limit must be an integer between 1 and 22.' }
  }
  if (!url) return { ok: true, url: null, attribution: OSM_ATTRIBUTION, maxZoom }
  if (!['{z}', '{x}', '{y}'].every((coordinate) => url.includes(coordinate))) {
    return { ok: false, message: 'The map tile address must include {z}, {x} and {y}.' }
  }
  if (/[{}]/.test(url.replace(/\{[zxysr]\}/g, ''))) {
    return { ok: false, message: 'The map tile address has an unsupported or incomplete placeholder.' }
  }
  try {
    // Replace raster template parameters before checking the address. Relative
    // addresses are deliberately limited to the current site's origin.
    const parsed = new URL(url.replace(/\{[zxysr]\}/g, '0'), 'https://campus-loops.invalid')
    const sameOrigin = url.startsWith('/') && !url.startsWith('//')
    if ((!url.startsWith('https://') && !sameOrigin) || parsed.protocol !== 'https:' || (sameOrigin && parsed.origin !== 'https://campus-loops.invalid') || parsed.username || parsed.password || parsed.hash) {
      return { ok: false, message: 'Use an HTTPS map tile address or a path on this site.' }
    }
  } catch {
    return { ok: false, message: 'The map tile address is invalid.' }
  }
  if (url !== OSM_TILE_URL && !credit) {
    return { ok: false, message: 'The custom map tile provider needs visible attribution.' }
  }
  return {
    ok: true,
    url,
    // Credit is plain text, never executable HTML from a configuration value.
    attribution: `${OSM_ATTRIBUTION}${credit ? ` · ${escapeHtml(credit)}` : ''}`,
    maxZoom,
  }
}
