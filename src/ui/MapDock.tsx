import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { googleMapsDirectionsUrl, googleMapsPlaceUrl, googleMapsSearchUrl } from '../core/export/googleMaps'
import { planGeometry } from '../core/geo'
import { googlePlaceIdOf, isLivePlaceId, liveCategory, type LiveConversion, type LiveVenue } from '../core/livePlaces'
import type { Place, PlaceCategory } from '../core/types'
import { CATEGORY_LABEL, findCampusPlaces, openingSummary, placeHoursNote, placeNameMatches, priceLevelText, unconfirmedPlaceDetails } from './campusPlaces'
import { km, mins, rupees } from './format'
import { LiveLimitError } from './google/limits'
import type { LiveSuggestion } from './google/livePlaces'
import type { GoogleState } from './google/useGoogle'
import { resolveVenue } from './google/useLiveStops'
import { useDelayedFlag } from './hooks'
import { Icon } from './icons'
import { RouteMap, type RouteMapProps } from './RouteMap'
import './MapDock.css'

// Loaded only when a Google key is configured, so the free map stays light.
const GoogleRouteMap = lazy(() => import('./google/GoogleRouteMap').then((module) => ({ default: module.GoogleRouteMap })))
const googleLoading = <div className="map-shell vector-map-shell" data-map-status="loading"><div className="map" /><p className="map-status quiet" role="status">Loading Google Maps…</p></div>

type MapProps = Omit<RouteMapProps, 'touchPan' | 'selectedPlaceId' | 'onSelectPlace' | 'visiblePlaceIds' | 'campusKey' | 'livePins' | 'selectedLive' | 'onSelectGooglePlace'>

/** A Google venue opened from search, a category list or the basemap. */
type LiveSelection =
  | { status: 'loading'; placeId: string; name: string }
  | { status: 'ready'; venue: LiveVenue; conversion: LiveConversion }
  | { status: 'error'; placeId: string; name: string; message: string }

interface Suggestions { query: string; items: LiveSuggestion[]; loading: boolean; error: string | null }
const NO_SUGGESTIONS: Suggestions = { query: '', items: [], loading: false, error: null }
const NO_PINS: LiveVenue[] = []
const LIVE_KINDS = { cafe: 'food & coffee', landmark: 'landmark', seating: 'outdoor' } as const

interface Props extends MapProps {
  /** Side-by-side layout: the map is a full-height pane and always pannable. */
  wide: boolean
  /** Inputs changed and new walks are still being worked out. */
  pending: boolean
  title: string | null
  subtitle: string
  requiredPlaceIds?: string[]
  onTogglePlace?: (id: string) => void
  /** Google Maps for the page; 'off' keeps the free street map. */
  google?: GoogleState
  /** Make a Google venue a must-visit (it is registered first, then toggled). */
  onAddLivePlace?: (venue: LiveVenue, place: Place) => void
  /** Planner time, for "open now" on live venues. */
  now?: Date
}

/**
 * The single map instance. On phones it sits inline between the steps and can
 * expand to full screen; on wide screens CSS pins it beside the panel. It is
 * never unmounted when the layout changes, so it never rebuilds or flashes.
 */
export function MapDock({ wide, pending, title, subtitle, requiredPlaceIds = [], onTogglePlace, google = { status: 'off', message: null }, onAddLivePlace, now, ...map }: Props) {
  const ref = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [hint, setHint] = useState(false)
  const [refitKey, setRefitKey] = useState(0)
  const [campusKey, setCampusKey] = useState(0)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [category, setCategory] = useState<PlaceCategory | 'all'>('all')
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [fallback, setFallback] = useState<string | null>(null)
  const [noticeClosed, setNoticeClosed] = useState(false)
  const [live, setLive] = useState<LiveSelection | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestions>(NO_SUGGESTIONS)
  const [pins, setPins] = useState<{ category: PlaceCategory; venues: LiveVenue[]; error: string | null } | null>(null)
  const searchField = useRef<HTMLInputElement>(null)
  const liveRequest = useRef(0)
  const googleMap = google.status === 'ready' && !fallback ? google : null
  const googleWaiting = google.status === 'loading' && !fallback
  const matches = useMemo(() => findCampusPlaces(map.dataset.places, query, category), [map.dataset.places, query, category])
  const visiblePlaceIds = useMemo(() => findCampusPlaces(map.dataset.places, '', category).map((place) => place.id), [map.dataset.places, category])
  const place = map.dataset.places.find((item) => item.id === selectedPlaceId)
  const selected = map.plans.find((plan) => plan.id === map.selectedId)
  const required = place ? requiredPlaceIds.includes(place.id) : false
  const unavailable = place ? unconfirmedPlaceDetails(place) : null
  const fullStops = requiredPlaceIds.filter(Boolean).length >= 2
  const reveal = () => {
    setSearchOpen(false)
    if (!wide && !expanded) {
      setExpanded(true)
      setRefitKey((key) => key + 1)
    }
  }
  const choosePlace = (id: string) => {
    liveRequest.current++
    setLive(null)
    setSelectedPlaceId(id)
    reveal()
  }
  // Open a Google venue: one details request, then the saved entry if it is the same place.
  const openLive = useCallback((placeId: string, name = 'Google Maps place', prediction?: LiveSuggestion['prediction']) => {
    if (google.status !== 'ready') return
    const request = ++liveRequest.current
    const saved = map.dataset.places.find((place) => googlePlaceIdOf(place.id) === placeId)
    if (saved) { setLive(null); setSelectedPlaceId(saved.id); return }
    setSelectedPlaceId(null)
    setLive({ status: 'loading', placeId, name })
    google.live.venue(placeId, prediction)
      .then((venue) => {
        if (request !== liveRequest.current) return
        const resolved = resolveVenue(map.dataset, venue)
        if ('catalogue' in resolved) { setLive(null); setSelectedPlaceId(resolved.catalogue.id) }
        else setLive({ status: 'ready', venue, conversion: resolved })
      })
      .catch((error: unknown) => {
        if (request !== liveRequest.current) return
        setLive({ status: 'error', placeId, name, message: error instanceof LiveLimitError ? error.message : 'Google Maps details could not be loaded. Check your connection and try again.' })
      })
  }, [google, map.dataset])
  const onSelectGooglePlace = useCallback((placeId: string) => {
    openLive(placeId)
    setSearchOpen(false)
    if (!wide && !expanded) { setExpanded(true); setRefitKey((key) => key + 1) }
  }, [openLive, wide, expanded])

  // Live suggestions, debounced so typing does not spend one request per key.
  const liveQuery = googleMap && query.trim().length >= 2 ? query.trim() : ''
  useEffect(() => {
    if (!liveQuery || google.status !== 'ready') return
    let active = true
    const timer = window.setTimeout(() => {
      setSuggestions((current) => ({ ...current, query: liveQuery, loading: true, error: null }))
      google.live.suggest(liveQuery)
        .then((items) => { if (active) setSuggestions({ query: liveQuery, items, loading: false, error: null }) })
        .catch((error: unknown) => {
          if (active) setSuggestions({ query: liveQuery, items: [], loading: false, error: error instanceof LiveLimitError ? error.message : 'Live Google results are unavailable right now.' })
        })
    }, 320)
    return () => { active = false; window.clearTimeout(timer) }
  }, [liveQuery, google])
  const shownSuggestions = liveQuery && suggestions.query === liveQuery ? suggestions : liveQuery ? { ...NO_SUGGESTIONS, loading: true } : NO_SUGGESTIONS
  const savedGoogleIds = useMemo(() => new Set(map.dataset.places.map((place) => googlePlaceIdOf(place.id)).filter(Boolean)), [map.dataset.places])
  const liveItems = shownSuggestions.items.filter((item) => !savedGoogleIds.has(item.placeId))
  // With live results, places named by the query come first, then Google, then tag matches.
  const named = liveQuery ? matches.filter((item) => placeNameMatches(item, query)) : matches
  const tagged = liveQuery ? matches.filter((item) => !named.includes(item)) : []
  const campusResult = (item: Place) => <li key={item.id}><button type="button" onClick={() => choosePlace(item.id)}>
    <span className={`map-result-icon is-${item.category}`}><Icon name={item.category === 'cafe' ? 'coffee' : 'pin'} size={18} /></span>
    <span><b>{item.name}</b><small>{CATEGORY_LABEL[item.category]} · {isLivePlaceId(item.id) ? 'Google Maps · in your walk' : 'Manipal'}</small></span>
    <Icon name="arrow" size={16} />
  </button></li>

  // Category chips also list popular Google venues of that kind around campus.
  const pickCategory = (item: PlaceCategory | 'all') => {
    setCategory(item); setSelectedPlaceId(null); setSearchOpen(false)
    if (item === 'all' || item === 'waypoint' || google.status !== 'ready' || fallback) { setPins(null); return }
    setPins({ category: item, venues: NO_PINS, error: null })
    google.live.nearby(item)
      .then((venues) => setPins((current) => current?.category === item ? { category: item, venues, error: null } : current))
      .catch((error: unknown) => setPins((current) => current?.category === item
        ? { category: item, venues: NO_PINS, error: error instanceof LiveLimitError ? error.message : 'Google Maps places could not be loaded.' } : current))
  }
  const livePins = googleMap && pins ? pins.venues : NO_PINS
  const liveVenue = live?.status === 'ready' ? live.venue : null
  const busy = useDelayedFlag(pending, 140)
  // Navigation stays usable if the interactive map fails to load.
  const campusUrl = googleMapsSearchUrl('MIT Manipal, Karnataka, India')
  const walkUrl = useMemo(() => {
    const selected = map.plans.find((plan) => plan.id === map.selectedId)
    if (!selected) return null
    try { return googleMapsDirectionsUrl(planGeometry(map.dataset, selected)).url }
    catch { return null }
  }, [map.dataset, map.plans, map.selectedId])
  const [previousSelection, setPreviousSelection] = useState(map.selectedId)
  if (previousSelection !== map.selectedId) {
    setPreviousSelection(map.selectedId)
    setSelectedPlaceId(null)
    setLive(null)
  }
  // Rotating or resizing into the side-by-side layout ends full screen.
  if (wide && expanded) setExpanded(false)
  const full = expanded && !wide
  const touchPan = wide || full

  // Expanded: lock page scroll and make the map a keyboard-accessible modal.
  useEffect(() => {
    if (!full) return
    const root = document.documentElement
    const dock = ref.current
    if (!dock) return
    const previousOverflow = root.style.overflow
    const previousFocus = document.activeElement
    root.style.overflow = 'hidden'
    // The skip link and other app siblings also sit outside <main>. Walk up
    // the ancestor chain so none of the covered page remains focusable.
    const covered: HTMLElement[] = []
    let branch: HTMLElement = dock
    while (branch.parentElement) {
      const parent = branch.parentElement
      for (const sibling of parent.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
          covered.push(sibling)
          sibling.inert = true
        }
      }
      if (parent === document.body) break
      branch = parent
    }
    const controls = () => [...dock.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0)
    dock.querySelector<HTMLElement>('.map-expand')?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setExpanded(false)
        setRefitKey((key) => key + 1)
      } else if (event.key === 'Tab') {
        const items = controls()
        const first = items[0]
        const last = items.at(-1)
        if (!first) { event.preventDefault(); dock.focus(); return }
        if (!items.includes(document.activeElement as HTMLElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
      }
    }
    // Inner controls can consume Escape (for example, dismissing search)
    // before the enclosing full-screen map closes.
    window.addEventListener('keydown', onKey)
    return () => {
      root.style.overflow = previousOverflow
      covered.forEach((element) => { element.inert = false })
      window.removeEventListener('keydown', onKey)
      // The expand button disappears if resizing closes the modal; in that
      // case keep the keyboard at the map instead of losing focus to <body>.
      if (previousFocus instanceof HTMLElement && previousFocus !== document.body && previousFocus.isConnected && !previousFocus.closest('[inert]')) {
        previousFocus.focus({ preventScroll: true })
      } else {
        dock.querySelector<HTMLElement>('.map-expand, .maplibregl-canvas, .google-map-shell .map')?.focus({ preventScroll: true })
      }
    }
  }, [full])

  // Inline on a phone, one finger scrolls the page. Explain that once it is tried.
  useEffect(() => {
    const el = ref.current
    if (!el || touchPan) return
    let timer = 0
    let startY = 0
    const onStart = (e: TouchEvent) => { startY = e.touches[0]?.clientY ?? 0 }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || Math.abs((e.touches[0]?.clientY ?? 0) - startY) > 24) return
      setHint(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setHint(false), 1600)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      setHint(false)
    }
  }, [touchPan])

  return (
    <section ref={ref} className={`map-dock${full ? ' is-expanded' : ''}${busy ? ' is-busy' : ''}`} aria-label={full ? 'Map, full screen' : 'Map'} role={full ? 'dialog' : undefined} aria-modal={full || undefined} tabIndex={full ? -1 : undefined} aria-busy={pending}>
      <div className="map-progress" aria-hidden="true" />
      <div className="map-explorer">
        <div className="map-search-box">
          <Icon name="search" size={20} />
          <label className="sr-only" htmlFor="map-place-search">Find a place on the campus map</label>
          <input ref={searchField} id="map-place-search" type="search" value={query} maxLength={120}
            placeholder={googleMap ? 'Search Google Maps around MIT' : 'Search MIT & Manipal'}
            onFocus={() => setSearchOpen(true)}
            onClick={() => setSearchOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchOpen) {
                event.preventDefault()
                event.stopPropagation()
                setSearchOpen(false)
              }
            }}
            aria-controls={searchOpen ? 'map-search-results' : undefined} />
          <button type="button" className="map-home" aria-label="Show the MIT campus area" onClick={() => {
            liveRequest.current++
            setQuery(''); setSearchOpen(false); setSelectedPlaceId(null); setLive(null); setCategory('all'); setPins(null); setCampusKey((key) => key + 1)
          }}><Icon name="target" size={19} /></button>
        </div>
        <div className="map-categories" role="group" aria-label="Places on the map">
          {(['all', 'cafe', 'landmark', 'seating'] as const).map((item) => (
            <button type="button" key={item} aria-pressed={category === item} onClick={() => pickCategory(item)}>
              <Icon name={item === 'cafe' ? 'coffee' : item === 'seating' ? 'bookmark' : 'pin'} size={15} />
              {item === 'all' ? 'All places' : item === 'cafe' ? 'Food & coffee' : item === 'seating' ? 'Outdoors' : 'Landmarks'}
            </button>
          ))}
        </div>
        {googleMap && pins && !searchOpen && <p className="map-live-status" role="status">
          {pins.error ?? (pins.venues.length ? `${pins.venues.length} popular ${LIVE_KINDS[pins.category as keyof typeof LIVE_KINDS]} spots from Google Maps` : `Finding ${LIVE_KINDS[pins.category as keyof typeof LIVE_KINDS]} spots on Google Maps…`)}
        </p>}
        {searchOpen && <div className="map-search-results" id="map-search-results">
          <div className="map-search-heading"><span>{liveQuery ? `${named.length} saved campus place${named.length === 1 ? '' : 's'}` : `${matches.length} campus places`}</span><button type="button" aria-label="Close map search results" onClick={() => setSearchOpen(false)}><Icon name="close" size={16} /></button></div>
          {named.length > 0 ? <ul aria-label="Matching campus places">{named.map(campusResult)}</ul>
            : !liveQuery && <p>No matching place in this campus catalogue.</p>}
          {liveQuery && <>
            <div className="map-search-heading is-live" aria-live="polite"><span>{shownSuggestions.loading ? 'Searching Google Maps…' : shownSuggestions.error ?? `${liveItems.length} on Google Maps`}</span></div>
            {liveItems.length > 0 && <ul aria-label="Google Maps places">
              {liveItems.map((item) => <li key={item.placeId}><button type="button" onClick={() => { openLive(item.placeId, item.title, item.prediction); reveal() }}>
                <span className={`map-result-icon is-${liveCategory(item)} is-live`}><Icon name={liveCategory(item) === 'cafe' ? 'coffee' : 'pin'} size={18} /></span>
                <span><b>{item.title}</b><small>{[item.distanceM !== null ? km(item.distanceM) : null, item.detail].filter(Boolean).join(' · ')}</small></span>
                <Icon name="arrow" size={16} />
              </button></li>)}
            </ul>}
            {tagged.length > 0 && <>
              <div className="map-search-heading is-live"><span>{tagged.length} more saved place{tagged.length === 1 ? '' : 's'} tagged “{query.trim()}”</span></div>
              <ul aria-label="Campus places with matching tags">{tagged.map(campusResult)}</ul>
            </>}
          </>}
          <a href={googleMapsSearchUrl(`${query.trim() || 'places'} near MIT Manipal, Karnataka, India`)} target="_blank" rel="noopener noreferrer">Search more places on Google Maps <Icon name="arrow" size={15} /></a>
        </div>}
      </div>
      {!wide && (
        <button type="button" className="map-btn map-expand" onClick={() => { setExpanded((v) => !v); setRefitKey((k) => k + 1) }} aria-pressed={full}
          aria-label={full ? 'Close full-screen map' : 'Expand map to full screen'}>
          <Icon name={full ? 'collapse' : 'expand'} size={16} />
        </button>
      )}
      {googleMap ? <Suspense fallback={googleLoading}><GoogleRouteMap {...map} libs={googleMap.libs} mapId={googleMap.mapId} onFatal={setFallback}
          touchPan={touchPan} refitKey={refitKey} campusKey={campusKey}
          selectedPlaceId={selectedPlaceId} onSelectPlace={choosePlace} visiblePlaceIds={visiblePlaceIds}
          livePins={livePins} selectedLive={liveVenue} onSelectGooglePlace={onSelectGooglePlace} /></Suspense>
        : googleWaiting ? googleLoading
        : <RouteMap {...map} touchPan={touchPan} refitKey={refitKey} campusKey={campusKey}
          selectedPlaceId={selectedPlaceId} onSelectPlace={choosePlace} visiblePlaceIds={visiblePlaceIds} />}
      {(fallback || google.status === 'failed') && !noticeClosed && !searchOpen && <div className="map-fallback" role="status">
        <p>{fallback ?? (google.status === 'failed' ? google.message : '')}</p>
        <button type="button" aria-label="Dismiss map notice" onClick={() => setNoticeClosed(true)}><Icon name="close" size={16} /></button>
      </div>}
      {live ? <LiveCard live={live} now={now} required={live.status === 'ready' && live.conversion.ok ? requiredPlaceIds.includes(live.conversion.place.id) : false}
        fullStops={fullStops} canAdd={Boolean(onAddLivePlace)}
        onAdd={(venue, item) => onAddLivePlace?.(venue, item)}
        onRemove={(id) => onTogglePlace?.(id)}
        onRetry={(placeId, name) => openLive(placeId, name)}
        onClose={() => { liveRequest.current++; setLive(null); searchField.current?.focus() }} />
      : place ? <section className="map-place-card" aria-label={`Place details: ${place.name}`}>
        <button type="button" className="map-card-close" aria-label="Close place details" onClick={() => { setSelectedPlaceId(null); searchField.current?.focus() }}><Icon name="close" size={18} /></button>
        <p className="map-card-category"><Icon name={place.category === 'cafe' ? 'coffee' : 'pin'} size={15} />{CATEGORY_LABEL[place.category]}</p>
        <h3>{place.name}</h3>
        {now && openingSummary(place, now) && <p className="map-card-meta"><Icon name="clock" size={15} />{openingSummary(place, now)}</p>}
        <p className="map-card-note">{placeHoursNote(place)}.</p>
        <div className="map-card-actions">
          {onTogglePlace && <button type="button" className="btn primary" disabled={!required && (Boolean(unavailable) || fullStops)} onClick={() => onTogglePlace(place.id)}>
            <Icon name={required ? 'check' : 'plus'} size={17} />{required ? 'Remove stop' : 'Add to walk'}
          </button>}
          <a className="btn" href={googleMapsPlaceUrl(place.name, googlePlaceIdOf(place.id))} target="_blank" rel="noopener noreferrer">Google Maps <Icon name="arrow" size={16} /></a>
        </div>
        {!required && (unavailable || fullStops) && <p className="map-card-note">{unavailable ? `${unavailable}; check the venue’s listing.` : 'Remove a must-visit to add another stop.'}</p>}
        <p className="map-card-source">{place.osmRef ? <a href={`https://www.openstreetmap.org/${place.osmRef}`} target="_blank" rel="noopener noreferrer">Mapped location · OpenStreetMap</a> : isLivePlaceId(place.id) ? 'Live details from Google Maps' : 'Mapped campus location'}<span>Entrances may differ from the walking path.</span></p>
      </section> : <div className="map-route-card">
        <div><span className="map-card-category">{selected ? 'Your walking route' : 'Explore the neighbourhood'}</span><b>{title ?? 'MIT Manipal & nearby'}</b>
          <span className="map-route-metrics">{selected ? `${km(selected.distanceM)} · ${mins(selected.walkingSec)} walking · ${selected.visits.length} stop${selected.visits.length === 1 ? '' : 's'}` : 'Tap a place to see details and add it to your walk.'}</span>
        </div>
        <a href={walkUrl ?? campusUrl} target="_blank" rel="noopener noreferrer" aria-label={walkUrl ? 'Open this walk in Google Maps' : 'Explore MIT Manipal in Google Maps'}><Icon name="arrow" size={22} /><span>Google Maps</span></a>
        {walkUrl && <a className="sr-only" href={campusUrl} target="_blank" rel="noopener noreferrer" aria-label="Explore MIT Manipal in Google Maps">Explore MIT Manipal</a>}
        <span className="sr-only">{subtitle}</span>
      </div>}
      <p className={`map-gesture${hint ? ' is-on' : ''}`} aria-hidden="true">Use two fingers to move the map, or expand it</p>
    </section>
  )
}

interface LiveCardProps {
  live: LiveSelection
  now?: Date
  required: boolean
  fullStops: boolean
  canAdd: boolean
  onAdd: (venue: LiveVenue, place: Place) => void
  onRemove: (id: string) => void
  onRetry: (placeId: string, name: string) => void
  onClose: () => void
}

/** A Google venue's current listing, and whether the planner can route to it. */
function LiveCard({ live, now, required, fullStops, canAdd, onAdd, onRemove, onRetry, onClose }: LiveCardProps) {
  const name = live.status === 'ready' ? live.venue.name : live.name
  const close = <button type="button" className="map-card-close" aria-label="Close place details" onClick={onClose}><Icon name="close" size={18} /></button>
  if (live.status !== 'ready') {
    return (
      <section className="map-place-card" aria-label={`Place details: ${name}`} aria-busy={live.status === 'loading'}>
        {close}
        <p className="map-card-category"><Icon name="pin" size={15} />Google Maps</p>
        <h3>{name}</h3>
        {live.status === 'loading' ? <p className="map-card-note" role="status">Loading current details from Google Maps…</p> : <>
          <p className="map-card-note" role="alert">{live.message}</p>
          <div className="map-card-actions"><button type="button" className="btn" onClick={() => onRetry(live.placeId, live.name)}>Try again</button></div>
        </>}
      </section>
    )
  }
  const { venue, conversion } = live
  const category = conversion.ok ? conversion.place.category : liveCategory(venue)
  const unavailable = conversion.ok ? unconfirmedPlaceDetails(conversion.place) : conversion.message
  const opening = conversion.ok && now ? openingSummary(conversion.place, now) : null
  const price = priceLevelText(venue.priceLevel)
  const facts = [
    venue.rating ? `★ ${venue.rating.toFixed(1)}${venue.ratingCount ? ` (${venue.ratingCount.toLocaleString('en-IN')})` : ''}` : null,
    price,
    conversion.ok && conversion.place.spendHighInr !== null && conversion.place.spendLowInr !== null && category === 'cafe'
      ? `${rupees(conversion.place.spendLowInr, conversion.place.spendHighInr)} pp${conversion.place.spendSource === 'placeholder' ? ' (estimate)' : ''}` : null,
  ].filter(Boolean)
  return (
    <section className="map-place-card is-live" aria-label={`Place details: ${venue.name}`}>
      {close}
      <p className="map-card-category"><Icon name={category === 'cafe' ? 'coffee' : 'pin'} size={15} />{CATEGORY_LABEL[category]} · Google Maps</p>
      <h3>{venue.name}</h3>
      {facts.length > 0 && <p className="map-card-facts">{facts.join(' · ')}</p>}
      {opening && <p className="map-card-meta"><Icon name="clock" size={15} />{opening}</p>}
      {venue.address && <p className="map-card-note">{venue.address}</p>}
      {conversion.ok && !opening && <p className="map-card-note">{placeHoursNote(conversion.place)}.</p>}
      <div className="map-card-actions">
        {canAdd && conversion.ok && <button type="button" className="btn primary" disabled={!required && (Boolean(unavailable) || fullStops)}
          onClick={() => (required ? onRemove(conversion.place.id) : onAdd(venue, conversion.place))}>
          <Icon name={required ? 'check' : 'plus'} size={17} />{required ? 'Remove stop' : 'Add to walk'}
        </button>}
        <a className="btn" href={venue.mapsUrl ?? googleMapsPlaceUrl(venue.name, venue.placeId)} target="_blank" rel="noopener noreferrer">Google Maps <Icon name="arrow" size={16} /></a>
      </div>
      {!required && (unavailable || fullStops) && <p className="map-card-note">{unavailable ? (conversion.ok ? `${unavailable}; check the venue’s listing.` : unavailable) : 'Remove a must-visit to add another stop.'}</p>}
      <p className="map-card-source">Live details from Google Maps<span>{conversion.ok ? `Walks reach it from a path about ${Math.max(10, Math.round(conversion.snapM / 10) * 10)} m away; entrances may differ.` : 'Open it in Google Maps for directions.'}</span></p>
    </section>
  )
}
