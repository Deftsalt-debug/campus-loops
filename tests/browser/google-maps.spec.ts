import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import demoJson from '../../src/data/manipal-demo.json' with { type: 'json' }

// Runs against a build with a placeholder Google key (playwright.google.config.ts).
// The Maps JavaScript API is replaced by tests/browser/fake-google-maps.js, so
// these checks cover the app's own Google integration without network or billing.

const demo = demoJson as unknown as { starts: { nodeId: string }[]; nodes: { id: string; lat: number; lng: number }[]; places: { id: string; position?: [number, number] }[] }
const start = demo.nodes.find((node) => node.id === demo.starts[0].nodeId)!
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos(a.lat * Math.PI / 180))
const near = demo.nodes.filter((node) => { const d = metres(node, start); return d > 220 && d < 420 }).sort((a, b) => metres(a, start) - metres(b, start))
const starbucks = demo.places.find((place) => place.id === 'starbucks')!.position!
const daily = (open: number, close: number) => Array.from({ length: 7 }, (_, day) => ({ open: { day, hour: open, minute: 0 }, close: { day, hour: close, minute: 30 } }))

const SNACK = 'ChIJfakeSnackShack000000001'
const VENUES = [
  {
    id: SNACK, displayName: 'The Snack Shack', location: { lat: near[0].lat + 0.0002, lng: near[0].lng }, onBasemap: true,
    types: ['cafe', 'food', 'establishment'], primaryType: 'cafe', businessStatus: 'OPERATIONAL',
    formattedAddress: 'Madhav Nagar, Manipal, Karnataka', googleMapsURI: `https://maps.google.com/?cid=1234567890`,
    regularOpeningHours: { periods: daily(8, 22), weekdayDescriptions: [] }, priceLevel: 'INEXPENSIVE', rating: 4.4, userRatingCount: 812,
  },
  {
    id: 'ChIJfakeBookHub000000000002', displayName: 'Manipal Book Hub', location: { lat: near[3].lat, lng: near[3].lng + 0.0002 },
    types: ['book_store', 'store'], primaryType: 'book_store', businessStatus: 'OPERATIONAL', formattedAddress: 'Manipal',
    regularOpeningHours: { periods: daily(9, 20), weekdayDescriptions: [] }, priceLevel: null, rating: 4.1, userRatingCount: 40,
  },
  {
    id: 'ChIJfakeHilltop000000000003', displayName: 'Hilltop Lake View', location: { lat: 13.372, lng: 74.752 },
    types: ['park', 'tourist_attraction'], primaryType: 'park', businessStatus: 'OPERATIONAL', formattedAddress: 'Alevoor, Karnataka',
    priceLevel: null, rating: 4.6, userRatingCount: 2100,
  },
  {
    id: 'ChIJfakeStarbucks00000000004', displayName: 'Starbucks Coffee', location: { lat: starbucks[0] + 0.0001, lng: starbucks[1] },
    types: ['coffee_shop', 'cafe'], primaryType: 'coffee_shop', businessStatus: 'OPERATIONAL', formattedAddress: 'Manipal',
    regularOpeningHours: { periods: daily(8, 22), weekdayDescriptions: [] }, priceLevel: 'MODERATE', rating: 4.2, userRatingCount: 300,
  },
]

const mapSearch = (page: Page) => page.getByRole('searchbox', { name: 'Find a place on the campus map' })
const fake = <T,>(page: Page, read: (state: Record<string, any>) => T) => page.evaluate(read, undefined as never).catch(() => null) as Promise<T>
const requests = (page: Page) => page.evaluate(() => (window as any).__fakeGoogle.requests as { autocomplete: number; details: number; nearby: number })

async function useFakeGoogle(page: Page, options: { reject?: boolean } = {}) {
  const script = await readFile(new URL('./fake-google-maps.js', import.meta.url), 'utf8')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.setFixedTime(new Date('2026-10-05T04:30:00Z')) // Monday 10:00 IST
  await page.addInitScript(({ venues, reject }) => {
    ;(window as any).__fakeVenues = venues
    ;(window as any).__fakeGoogleRejectKey = reject
  }, { venues: VENUES, reject: Boolean(options.reject) })
  const scriptUrls: string[] = []
  await page.route('https://maps.googleapis.com/**', (route) => {
    scriptUrls.push(route.request().url())
    return route.request().url().startsWith('https://maps.googleapis.com/maps/api/js')
      ? route.fulfill({ contentType: 'text/javascript', body: script })
      : route.abort()
  })
  return { errors, scriptUrls }
}

async function photograph(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.locator('.map-dock').screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function openGoogleMap(page: Page) {
  await page.goto('./', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('list', { name: 'Suggested walks' }).getByRole('button')).toHaveCount(3)
  await expect(page.locator('.google-map-shell')).toHaveAttribute('data-map-status', 'ready')
}

test('Google map draws walks, finds live venues and plans to them', async ({ page }, testInfo) => {
  const observed = await useFakeGoogle(page)
  await openGoogleMap(page)
  const loaded = new URL(observed.scriptUrls[0])
  expect(loaded.searchParams.get('key')).toMatch(/^AIza/)
  expect(loaded.searchParams.get('libraries')?.split(',').sort()).toEqual(['core', 'maps', 'marker', 'places'])
  expect(loaded.searchParams.get('region')).toBe('IN')
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0)
  await expect(page.locator('.google-map-shell .map-place-marker:not(.is-live)')).toHaveCount(18)
  await expect(page.locator('.map-stop-marker').first()).toHaveAccessibleName(/Start and finish:/)
  expect(await fake(page, () => (window as any).__fakeGoogle.polylines.size)).toBe(9)
  expect(await fake(page, () => (window as any).__fakeGoogle.maps.length)).toBe(1)
  expect(await requests(page)).toEqual({ autocomplete: 0, details: 0, nearby: 0 })

  // Live search: typing waits for a pause, so one query is one request.
  await mapSearch(page).fill('snack')
  const liveResults = page.getByRole('list', { name: 'Google Maps places' })
  await expect(liveResults.getByRole('button', { name: /The Snack Shack/ })).toBeVisible()
  await photograph(page, testInfo, 'google-search-results')
  await expect(page.getByRole('list', { name: 'Matching campus places' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Campus places with matching tags' }).getByRole('button')).toHaveCount(8)
  expect((await requests(page)).autocomplete).toBe(1)
  const auto = await fake(page, () => (window as any).__fakeGoogle.lastAutocomplete)
  expect(auto.includedRegionCodes).toEqual(['in'])
  expect(auto.locationRestriction.north).toBeGreaterThan(auto.locationRestriction.south)
  await liveResults.getByRole('button', { name: /The Snack Shack/ }).click()
  const card = page.getByRole('region', { name: 'Place details: The Snack Shack', exact: true })
  await expect(card).toContainText('★ 4.4 (812)')
  await expect(card).toContainText('Open now · until 22:30')
  await expect(card).toContainText('Live details from Google Maps')
  await expect(card.getByRole('link', { name: 'Google Maps', exact: true })).toHaveAttribute('href', 'https://maps.google.com/?cid=1234567890')
  // One details request, billed to the same autocomplete session.
  expect((await requests(page)).details).toBe(1)
  const tokens = await fake(page, () => (window as any).__fakeGoogle.tokens as { kind: string; token: number }[])
  expect(new Set(tokens.map((entry) => entry.token)).size).toBe(1)
  expect(tokens.at(-1)?.kind).toBe('details')
  const fields = await fake(page, () => (window as any).__fakeGoogle.detailFields[0] as string[])
  expect(fields).toEqual(expect.arrayContaining(['regularOpeningHours', 'priceLevel', 'location']))
  expect(fields).not.toContain('reviews')
  await expect(page.locator('.map-place-marker.is-live.is-selected')).toHaveCount(1)
  await photograph(page, testInfo, 'google-live-card')

  await card.getByRole('button', { name: 'Add to walk', exact: true }).click()
  await expect(page.getByRole('button', { name: '1 must-visit', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Itinerary' })).toContainText('The Snack Shack')
  await expect(page.locator('.step-3')).toContainText('Google Maps today')
  // The stop now has a planner pin; its card offers removal and keeps live provenance.
  await expect(page.locator('.google-map-shell .map-place-marker:not(.is-live)')).toHaveCount(19)
  await page.getByRole('button', { name: 'The Snack Shack, food and drink. Show venue details.', exact: true }).dispatchEvent('click')
  const stopCard = page.getByRole('region', { name: 'Place details: The Snack Shack', exact: true })
  await expect(stopCard.getByRole('button', { name: 'Remove stop', exact: true })).toBeVisible()
  await expect(stopCard).toContainText('Open now · until 22:30')
  await expect(stopCard).toContainText('Live details from Google Maps')
  await stopCard.getByRole('button', { name: 'Close place details', exact: true }).click()
  await page.getByRole('button', { name: 'Close map search results', exact: true }).click()
  const stopLink = page.getByRole('link', { name: 'Check hours & location for The Snack Shack on Google Maps' })
  expect(new URL((await stopLink.getAttribute('href'))!).searchParams.get('query_place_id')).toBe(SNACK)
  expect(decodeURIComponent(new URL(page.url()).hash)).toContain(`g_${SNACK}`)
  expect((await requests(page)).details).toBe(1)

  // The shared link reloads Google's details and rebuilds the same walk.
  const shared = page.url()
  await page.goto('about:blank')
  await page.goto(shared, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('list', { name: 'Itinerary' })).toContainText('The Snack Shack')
  await expect(page.getByText('Shared plan recalculated against saved route data, current Google Maps details and your departure time.')).toBeVisible()
  expect((await requests(page)).details).toBe(1)
  expect(observed.errors).toEqual([])
})

test('basemap venues, saved matches, unreachable spots and category lists', async ({ page }, testInfo) => {
  const observed = await useFakeGoogle(page)
  await openGoogleMap(page)

  // A business Google draws on the map opens our card, not Google's info window.
  await page.locator('.fake-poi', { hasText: 'The Snack Shack' }).dispatchEvent('click')
  await expect(page.getByRole('region', { name: 'Place details: The Snack Shack', exact: true })).toBeVisible()
  await expect(page.locator('.fake-poi', { hasText: 'The Snack Shack' })).toHaveAttribute('data-stopped', 'true')
  await page.getByRole('button', { name: 'Close place details', exact: true }).click()
  await page.getByRole('button', { name: 'Close map search results', exact: true }).click()

  // A Google listing for a saved venue opens the curated entry.
  await mapSearch(page).fill('starbucks')
  await expect(page.getByRole('list', { name: 'Matching campus places' }).getByRole('button', { name: /Starbucks/ })).toBeVisible()
  await page.getByRole('list', { name: 'Google Maps places' }).getByRole('button', { name: /Starbucks Coffee/ }).click()
  await expect(page.getByRole('region', { name: 'Place details: Starbucks', exact: true })).toBeVisible()

  // Too far from the saved paths: explained, linked out, never added.
  await mapSearch(page).fill('hilltop')
  await page.getByRole('list', { name: 'Google Maps places' }).getByRole('button', { name: /Hilltop Lake View/ }).click()
  const far = page.getByRole('region', { name: 'Place details: Hilltop Lake View', exact: true })
  await expect(far).toContainText('outside the saved campus walking paths')
  await expect(far.getByRole('button', { name: 'Add to walk' })).toHaveCount(0)
  await photograph(page, testInfo, 'google-unreachable-card')
  await expect(far.getByRole('link', { name: 'Google Maps', exact: true })).toHaveAttribute('href', /query_place_id=ChIJfakeHilltop/)
  await page.getByRole('button', { name: 'Close place details', exact: true }).click()
  await page.getByRole('button', { name: 'Close map search results', exact: true }).click()

  // Category chips list popular Google venues with cheap fields only, once per page.
  const chips = page.getByRole('group', { name: 'Places on the map' })
  await chips.getByRole('button', { name: 'Landmarks', exact: true }).click()
  await expect(page.locator('.map-live-status')).toContainText('popular landmark spots from Google Maps')
  await expect(page.locator('.map-place-marker.is-live', { hasText: 'Manipal Book Hub' })).toHaveCount(1)
  await photograph(page, testInfo, 'google-category-pins')
  const nearbyFields = await fake(page, () => (window as any).__fakeGoogle.nearbyFields[0] as string[])
  expect(nearbyFields).not.toContain('regularOpeningHours')
  expect(nearbyFields).not.toContain('priceLevel')
  await chips.getByRole('button', { name: 'All places', exact: true }).click()
  await expect(page.locator('.map-place-marker.is-live')).toHaveCount(0)
  await chips.getByRole('button', { name: 'Landmarks', exact: true }).click()
  await expect(page.locator('.map-place-marker.is-live', { hasText: 'Manipal Book Hub' })).toHaveCount(1)
  expect((await requests(page)).nearby).toBe(1)
  await page.locator('.map-place-marker.is-live', { hasText: 'Manipal Book Hub' }).dispatchEvent('click')
  const book = page.getByRole('region', { name: 'Place details: Manipal Book Hub', exact: true })
  await expect(book).toContainText('Open now · until 20:30')
  await expect(book.getByRole('button', { name: 'Add to walk', exact: true })).toBeEnabled()
  expect(observed.errors).toEqual([])
})

test('phones open live venues full screen', async ({ page }, testInfo) => {
  const observed = await useFakeGoogle(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await openGoogleMap(page)
  await mapSearch(page).fill('snack')
  await page.getByRole('list', { name: 'Google Maps places' }).getByRole('button', { name: /The Snack Shack/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Map, full screen', exact: true })
  await expect(dialog).toBeVisible()
  const card = dialog.getByRole('region', { name: 'Place details: The Snack Shack', exact: true })
  await expect(card.getByRole('button', { name: 'Add to walk', exact: true })).toBeInViewport()
  const bounds = await card.boundingBox()
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await photograph(page, testInfo, 'google-mobile-card')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(observed.errors).toEqual([])
})

test('a rejected Google key falls back to the free street map', async ({ page }, testInfo) => {
  const observed = await useFakeGoogle(page, { reject: true })
  await page.goto('./', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('.map-fallback')).toContainText('Google Maps isn’t available on this site right now')
  await expect(page.locator('.vector-map-shell')).toHaveAttribute('data-map-status', 'ready', { timeout: 45_000 })
  await expect(page.locator('.map-place-marker')).toHaveCount(18)
  await photograph(page, testInfo, 'google-rejected-fallback')
  await page.getByRole('button', { name: 'Dismiss map notice', exact: true }).click()
  await expect(page.locator('.map-fallback')).toHaveCount(0)
  expect(observed.errors).toEqual([])
})
