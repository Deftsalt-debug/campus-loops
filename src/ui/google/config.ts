interface GoogleEnvironment {
  VITE_GOOGLE_MAPS_API_KEY?: string
  VITE_GOOGLE_MAPS_MAP_ID?: string
}

export type GoogleConfiguration =
  | { enabled: true; key: string; mapId: string }
  | { enabled: false; message: string | null }

/** Google's sample map ID: fine for a demo; create a free map ID in Cloud Console for production. */
export const DEMO_MAP_ID = 'DEMO_MAP_ID'

/**
 * A browser key turns on Google Maps and live venues; without one the app keeps
 * the free OpenFreeMap street map. The key is public in the built JavaScript,
 * so it must be restricted to this site's referrers and to the two APIs used.
 */
export function googleMapsConfiguration(env: GoogleEnvironment): GoogleConfiguration {
  const key = env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''
  const mapId = env.VITE_GOOGLE_MAPS_MAP_ID?.trim() || DEMO_MAP_ID
  if (!key) return { enabled: false, message: null }
  if (!/^AIza[0-9A-Za-z_-]{35}$/.test(key)) {
    return { enabled: false, message: 'The Google Maps key is not a browser API key (it should start with “AIza” and be 39 characters).' }
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(mapId)) return { enabled: false, message: 'The Google Maps map ID is invalid.' }
  return { enabled: true, key, mapId }
}

export const googleConfig = googleMapsConfiguration({
  VITE_GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  VITE_GOOGLE_MAPS_MAP_ID: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
})
