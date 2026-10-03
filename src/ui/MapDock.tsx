import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { googleMapsDirectionsUrl, googleMapsPlaceUrl, googleMapsSearchUrl } from '../core/export/googleMaps'
import { planGeometry } from '../core/geo'
import type { PlaceCategory } from '../core/types'
import { CATEGORY_LABEL, findCampusPlaces, placeHoursNote, unconfirmedPlaceDetails } from './campusPlaces'
import { km, mins } from './format'
import { useDelayedFlag } from './hooks'
import { Icon } from './icons'
import { RouteMap } from './RouteMap'
import './MapDock.css'

type MapProps = Omit<ComponentProps<typeof RouteMap>, 'touchPan' | 'selectedPlaceId' | 'onSelectPlace' | 'visiblePlaceIds' | 'campusKey'>

interface Props extends MapProps {
  /** Side-by-side layout: the map is a full-height pane and always pannable. */
  wide: boolean
  /** Inputs changed and new walks are still being worked out. */
  pending: boolean
  title: string | null
  subtitle: string
  requiredPlaceIds?: string[]
  onTogglePlace?: (id: string) => void
}

/**
 * The single map instance. On phones it sits inline between the steps and can
 * expand to full screen; on wide screens CSS pins it beside the panel. It is
 * never unmounted when the layout changes, so it never rebuilds or flashes.
 */
export function MapDock({ wide, pending, title, subtitle, requiredPlaceIds = [], onTogglePlace, ...map }: Props) {
  const ref = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [hint, setHint] = useState(false)
  const [refitKey, setRefitKey] = useState(0)
  const [campusKey, setCampusKey] = useState(0)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [category, setCategory] = useState<PlaceCategory | 'all'>('all')
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const searchField = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => findCampusPlaces(map.dataset.places, query, category), [map.dataset.places, query, category])
  const visiblePlaceIds = useMemo(() => findCampusPlaces(map.dataset.places, '', category).map((place) => place.id), [map.dataset.places, category])
  const place = map.dataset.places.find((item) => item.id === selectedPlaceId)
  const selected = map.plans.find((plan) => plan.id === map.selectedId)
  const required = place ? requiredPlaceIds.includes(place.id) : false
  const unavailable = place ? unconfirmedPlaceDetails(place) : null
  const fullStops = requiredPlaceIds.filter(Boolean).length >= 2
  const choosePlace = (id: string) => {
    setSelectedPlaceId(id)
    setSearchOpen(false)
    if (!wide && !expanded) {
      setExpanded(true)
      setRefitKey((key) => key + 1)
    }
  }
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
        dock.querySelector<HTMLElement>('.map-expand, .maplibregl-canvas')?.focus({ preventScroll: true })
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
            placeholder="Search MIT & Manipal"
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true) }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setSearchOpen(false) } }}
            aria-controls={searchOpen ? 'map-search-results' : undefined} />
          <button type="button" className="map-home" aria-label="Show the MIT campus area" onClick={() => {
            setQuery(''); setSearchOpen(false); setSelectedPlaceId(null); setCategory('all'); setCampusKey((key) => key + 1)
          }}><Icon name="target" size={19} /></button>
        </div>
        <div className="map-categories" role="group" aria-label="Places on the map">
          {(['all', 'cafe', 'landmark', 'seating'] as const).map((item) => (
            <button type="button" key={item} aria-pressed={category === item} onClick={() => {
              setCategory(item); setSelectedPlaceId(null); setSearchOpen(false)
            }}>
              <Icon name={item === 'cafe' ? 'coffee' : item === 'seating' ? 'bookmark' : 'pin'} size={15} />
              {item === 'all' ? 'All places' : item === 'cafe' ? 'Food & coffee' : item === 'seating' ? 'Outdoors' : 'Landmarks'}
            </button>
          ))}
        </div>
        {searchOpen && <div className="map-search-results" id="map-search-results">
          <div className="map-search-heading"><span>{matches.length} campus places</span><button type="button" aria-label="Close map search results" onClick={() => setSearchOpen(false)}><Icon name="close" size={16} /></button></div>
          {matches.length > 0 ? <ul aria-label="Matching campus places">
            {matches.map((item) => <li key={item.id}><button type="button" onClick={() => choosePlace(item.id)}>
              <span className={`map-result-icon is-${item.category}`}><Icon name={item.category === 'cafe' ? 'coffee' : 'pin'} size={18} /></span>
              <span><b>{item.name}</b><small>{CATEGORY_LABEL[item.category]} · Manipal</small></span>
              <Icon name="arrow" size={16} />
            </button></li>)}
          </ul> : <p>No matching place in this campus catalogue.</p>}
          <a href={googleMapsSearchUrl(`${query.trim() || 'places'} near MIT Manipal, Karnataka, India`)} target="_blank" rel="noopener noreferrer">Search more places on Google Maps <Icon name="arrow" size={15} /></a>
        </div>}
      </div>
      {!wide && (
        <button type="button" className="map-btn map-expand" onClick={() => { setExpanded((v) => !v); setRefitKey((k) => k + 1) }} aria-pressed={full}
          aria-label={full ? 'Close full-screen map' : 'Expand map to full screen'}>
          <Icon name={full ? 'collapse' : 'expand'} size={16} />
        </button>
      )}
      <RouteMap {...map} touchPan={touchPan} refitKey={refitKey} campusKey={campusKey}
        selectedPlaceId={selectedPlaceId} onSelectPlace={choosePlace} visiblePlaceIds={visiblePlaceIds} />
      {place ? <section className="map-place-card" aria-label={`Place details: ${place.name}`}>
        <button type="button" className="map-card-close" aria-label="Close place details" onClick={() => { setSelectedPlaceId(null); searchField.current?.focus() }}><Icon name="close" size={18} /></button>
        <p className="map-card-category"><Icon name={place.category === 'cafe' ? 'coffee' : 'pin'} size={15} />{CATEGORY_LABEL[place.category]}</p>
        <h3>{place.name}</h3>
        <p className="map-card-note">{placeHoursNote(place)}.</p>
        <div className="map-card-actions">
          {onTogglePlace && <button type="button" className="btn primary" disabled={!required && (Boolean(unavailable) || fullStops)} onClick={() => onTogglePlace(place.id)}>
            <Icon name={required ? 'check' : 'plus'} size={17} />{required ? 'Remove stop' : 'Add to walk'}
          </button>}
          <a className="btn" href={googleMapsPlaceUrl(place.name)} target="_blank" rel="noopener noreferrer">Google Maps <Icon name="arrow" size={16} /></a>
        </div>
        {!required && (unavailable || fullStops) && <p className="map-card-note">{unavailable ? `${unavailable}; check the venue’s listing.` : 'Remove a must-visit to add another stop.'}</p>}
        <p className="map-card-source">{place.osmRef ? <a href={`https://www.openstreetmap.org/${place.osmRef}`} target="_blank" rel="noopener noreferrer">Mapped location · OpenStreetMap</a> : 'Mapped campus location'}<span>Entrances may differ from the walking path.</span></p>
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
