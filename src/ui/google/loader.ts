import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import type { GoogleConfiguration } from './config'

export interface GoogleLibraries {
  maps: google.maps.MapsLibrary
  marker: google.maps.MarkerLibrary
  places: google.maps.PlacesLibrary
  core: google.maps.CoreLibrary
}

type EnabledConfig = Extract<GoogleConfiguration, { enabled: true }>

let loading: Promise<GoogleLibraries> | null = null
let configured = false
let authFailed = false
const authListeners = new Set<() => void>()

declare global {
  interface Window { gm_authFailure?: () => void }
}

/**
 * Google calls this global when the key is rejected: wrong referrer, API not
 * enabled, or no billing account. The map then shows Google's error tile, so
 * the app switches back to the free street map instead.
 */
function watchAuthFailure() {
  if (typeof window === 'undefined' || window.gm_authFailure) return
  window.gm_authFailure = () => {
    authFailed = true
    authListeners.forEach((listener) => listener())
  }
}

export function onGoogleAuthFailure(listener: () => void): () => void {
  if (authFailed) queueMicrotask(listener)
  authListeners.add(listener)
  return () => { authListeners.delete(listener) }
}

export const googleAuthFailed = () => authFailed

/** Load the Maps JavaScript API once per page; a failed load can be retried. */
export function loadGoogle(config: EnabledConfig): Promise<GoogleLibraries> {
  if (authFailed) return Promise.reject(new Error('Google Maps rejected the API key.'))
  if (loading) return loading
  watchAuthFailure()
  // Options can be set only once per page; a retry reuses them.
  if (!configured) setOptions({ key: config.key, v: 'weekly', language: 'en', region: 'IN' })
  configured = true
  loading = Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('places'), importLibrary('core')])
    .then(([maps, marker, places, core]) => ({ maps, marker, places, core }))
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}
