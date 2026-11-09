// A small stand-in for the Maps JavaScript API, served in place of
// https://maps.googleapis.com/maps/api/js during browser QA. It implements only
// what the app calls, renders markers as ordinary DOM, and records every
// billable request so tests can check the free-tier guard rails.
;(() => {
  const google = (window.google ||= {})
  const maps = (google.maps ||= {})
  const venues = window.__fakeVenues || []
  const state = (window.__fakeGoogle = {
    requests: { autocomplete: 0, details: 0, nearby: 0 },
    detailFields: [],
    nearbyFields: [],
    tokens: [],
    maps: [],
    polylines: new Set(),
    info: null,
  })

  class LatLng {
    constructor(lat, lng) { this._lat = lat; this._lng = lng }
    lat() { return this._lat }
    lng() { return this._lng }
  }
  class MVCObject {
    constructor() { this.__listeners = {} }
    addListener(name, fn) {
      const list = (this.__listeners[name] ||= [])
      list.push(fn)
      return { remove: () => { this.__listeners[name] = list.filter((item) => item !== fn) } }
    }
    __emit(name, event) { for (const fn of [...(this.__listeners[name] || [])]) fn(event) }
  }
  const event = {
    clearInstanceListeners(object) { if (object) object.__listeners = {} },
    addListenerOnce(object, name, fn) {
      const listener = object.addListener(name, (...args) => { listener.remove(); fn(...args) })
      return listener
    },
  }

  class FakeMap extends MVCObject {
    constructor(div, options) {
      super()
      this.div = div
      this.options = { ...options }
      this.zoom = options.zoom
      this.center = options.center
      div.replaceChildren()
      this.canvas = document.createElement('div')
      this.canvas.className = 'fake-gmap'
      this.canvas.tabIndex = 0
      this.canvas.style.cssText = 'position:absolute;inset:0;display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px;padding:70px 8px 8px;overflow:auto;background:#e8eaed'
      this.layer = document.createElement('div')
      this.layer.className = 'fake-gmap-markers'
      this.layer.style.cssText = 'display:contents'
      // Basemap businesses Google would draw; clicking one emits an IconMouseEvent.
      this.pois = document.createElement('div')
      this.pois.className = 'fake-gmap-pois'
      this.pois.style.cssText = 'display:contents'
      for (const venue of venues.filter((item) => item.onBasemap)) {
        const poi = document.createElement('button')
        poi.type = 'button'
        poi.className = 'fake-poi'
        poi.textContent = venue.displayName
        poi.addEventListener('click', () => {
          let stopped = false
          this.__emit('click', { placeId: venue.id, latLng: new LatLng(venue.location.lat, venue.location.lng), stop() { stopped = true } })
          poi.dataset.stopped = String(stopped)
        })
        this.pois.append(poi)
      }
      this.canvas.append(this.pois, this.layer)
      div.append(this.canvas)
      state.maps.push(this)
      setTimeout(() => this.__emit('tilesloaded'), 30)
    }
    setOptions(options) { Object.assign(this.options, options) }
    getDiv() { return this.div }
    fitBounds(bounds) { this.bounds = bounds; this.zoom = 16; setTimeout(() => this.__emit('idle'), 0) }
    getZoom() { return this.zoom }
    setZoom(zoom) { this.zoom = zoom }
    setCenter(center) { this.center = center; setTimeout(() => this.__emit('idle'), 0) }
    panTo(center) { this.center = center; setTimeout(() => this.__emit('idle'), 0) }
  }
  class OverlayView extends MVCObject {
    setMap(map) { this.map = map; if (map) this.onAdd?.() }
    getProjection() {
      return this.map ? { fromLatLngToContainerPixel: ({ lat, lng }) => ({ x: (lng - 74.786) * 40_000, y: (13.356 - lat) * 40_000 }) } : null
    }
  }
  class Polyline extends MVCObject {
    constructor(options) { super(); this.options = options; if (options.map) state.polylines.add(this) }
    setOptions(options) { Object.assign(this.options, options) }
    setMap(map) { if (map) state.polylines.add(this); else state.polylines.delete(this) }
  }
  class InfoWindow extends MVCObject {
    constructor(options) { super(); this.options = options }
    setContent(content) { this.content = content }
    setPosition(position) { this.position = position }
    open() { state.info = this.content?.textContent ?? null }
    close() { state.info = null }
  }
  class Size { constructor(width, height) { this.width = width; this.height = height } }
  class AdvancedMarkerElement {
    constructor(options) { this.content = options.content; this.position = options.position; this._map = null; this.map = options.map ?? null }
    set map(map) {
      this._map = map
      if (map) map.layer.append(this.content)
      else this.content.remove()
    }
    get map() { return this._map }
  }

  const point = (data) => ({ ...data, location: new LatLng(data.location.lat, data.location.lng) })
  class Place {
    constructor({ id }) { this.id = id }
    async fetchFields({ fields }) {
      state.requests.details++
      state.detailFields.push(fields)
      if (this.__token) state.tokens.push({ kind: 'details', token: this.__token.serial })
      const data = venues.find((venue) => venue.id === this.id)
      await new Promise((resolve) => setTimeout(resolve, 40))
      if (!data) throw new Error('NOT_FOUND')
      Object.assign(this, point(data))
      if (data.regularOpeningHours) this.regularOpeningHours = data.regularOpeningHours
      return { place: this }
    }
    static async searchNearby(request) {
      state.requests.nearby++
      state.nearbyFields.push(request.fields)
      state.lastNearby = request
      const matches = venues.filter((venue) => venue.types.some((type) => request.includedTypes.includes(type)))
      return {
        places: matches.slice(0, request.maxResultCount).map((venue) => Object.assign(new Place({ id: venue.id }), {
          displayName: venue.displayName, location: new LatLng(venue.location.lat, venue.location.lng),
          types: venue.types, primaryType: venue.primaryType, businessStatus: venue.businessStatus,
        })),
      }
    }
  }
  let serial = 0
  class AutocompleteSessionToken { constructor() { this.serial = ++serial } }
  const AutocompleteSuggestion = {
    async fetchAutocompleteSuggestions(request) {
      state.requests.autocomplete++
      state.tokens.push({ kind: 'autocomplete', token: request.sessionToken?.serial ?? null, input: request.input })
      state.lastAutocomplete = { ...request, sessionToken: request.sessionToken?.serial }
      const words = request.input.toLowerCase().split(/\s+/)
      return {
        suggestions: venues.filter((venue) => words.every((word) => venue.displayName.toLowerCase().includes(word))).map((venue) => ({
          placePrediction: {
            placeId: venue.id,
            mainText: { text: venue.displayName },
            secondaryText: { text: venue.formattedAddress },
            text: { text: `${venue.displayName}, ${venue.formattedAddress}` },
            types: venue.types,
            distanceMeters: venue.distanceMeters ?? 300,
            toPlace() { const place = new Place({ id: venue.id }); place.__token = request.sessionToken; return place },
          },
        })),
      }
    },
  }

  const libraries = {
    maps: { Map: FakeMap, OverlayView, Polyline, InfoWindow },
    marker: { AdvancedMarkerElement },
    places: { Place, AutocompleteSuggestion, AutocompleteSessionToken, SearchNearbyRankPreference: { POPULARITY: 'POPULARITY', DISTANCE: 'DISTANCE' } },
    core: { ControlPosition: { RIGHT_BOTTOM: 9 }, Size, LatLng, event },
  }
  maps.importLibrary = async (name) => libraries[name]
  if (window.__fakeGoogleRejectKey) setTimeout(() => window.gm_authFailure?.(), 60)
  maps.__ib__?.()
})()
