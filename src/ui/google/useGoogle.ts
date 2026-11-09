import { useEffect, useState } from 'react'
import type { Dataset } from '../../core/types'
import { googleConfig } from './config'
import type { LivePlaces } from './livePlaces'
import type { GoogleLibraries } from './loader'

export type GoogleState =
  | { status: 'off'; message: string | null }
  | { status: 'loading' }
  | { status: 'ready'; libs: GoogleLibraries; live: LivePlaces; mapId: string }
  | { status: 'failed'; message: string }

const REJECTED = 'Google Maps isn’t available on this site right now, so this is the free street map.'
const UNREACHABLE = 'Google Maps could not be reached, so this is the free street map.'
const OWNER_HINT = 'Campus Loops: Google Maps rejected the API key. Check that the key’s project has billing enabled, the Maps JavaScript API and Places API (New) are enabled, and this site’s address is an allowed referrer. See README → Google Maps.'
const services = new Map<string, LivePlaces>()

/**
 * Google Maps for the whole page: the map, live search and venue details share
 * one script load and one cache. Any failure falls back to the free map.
 */
export function useGoogle(dataset: Dataset | null): GoogleState {
  const [state, setState] = useState<GoogleState>(() =>
    googleConfig.enabled ? { status: 'loading' } : { status: 'off', message: googleConfig.message })

  useEffect(() => {
    if (!googleConfig.enabled && googleConfig.message) console.warn(`Campus Loops: ${googleConfig.message} Using the free street map.`)
    if (!googleConfig.enabled || !dataset) return
    const config = googleConfig
    let active = true
    let stopWatching = () => {}
    // The loader and Places service are fetched only when a key is configured.
    Promise.all([import('./loader'), import('./livePlaces')])
      .then(async ([loader, places]) => {
        if (!active) return
        stopWatching = loader.onGoogleAuthFailure(() => {
          console.warn(OWNER_HINT)
          if (active) setState({ status: 'failed', message: REJECTED })
        })
        try {
          const libs = await loader.loadGoogle(config)
          if (!active || loader.googleAuthFailed()) return
          let live = services.get(dataset.datasetVersion)
          if (!live) {
            live = new places.LivePlaces(libs.places, places.campusArea(dataset))
            services.set(dataset.datasetVersion, live)
          }
          setState({ status: 'ready', libs, live, mapId: config.mapId })
        } catch {
          if (active) setState({ status: 'failed', message: loader.googleAuthFailed() ? REJECTED : UNREACHABLE })
        }
      })
      .catch(() => { if (active) setState({ status: 'failed', message: UNREACHABLE }) })
    return () => { active = false; stopWatching() }
  }, [dataset])

  return state
}
