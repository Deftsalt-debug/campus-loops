import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const mapHost = 'tiles.openfreemap.org'
const mapSearch = (page: Page) => page.getByRole('searchbox', { name: 'Find a place on the campus map' })
const mapReady = (page: Page) => expect(page.locator('.vector-map-shell')).toHaveAttribute('data-map-status', 'ready', { timeout: 45_000 })

test.beforeEach(async ({ page }) => {
  // Keep actual browser timers and network live, while plans use a repeatable daylight departure.
  await page.clock.setFixedTime(new Date('2026-10-05T04:30:00Z'))
})

function observeMap(page: Page) {
  const resources: { url: string; status: number }[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (new URL(response.url()).hostname === mapHost) resources.push({ url: response.url(), status: response.status() })
  })
  return { resources, errors }
}

async function openCampus(page: Page) {
  const response = await page.goto('./', { waitUntil: 'domcontentloaded' })
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Campus Loops', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Suggested walks' }).getByRole('button')).toHaveCount(3)
  await mapReady(page)
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)
  const canvas = await page.locator('.maplibregl-canvas').boundingBox()
  expect(canvas?.width, 'The map canvas must occupy the visible side panel').toBeGreaterThanOrEqual(300)
  expect(canvas?.height, 'A loaded but collapsed map canvas is unusable').toBeGreaterThanOrEqual(300)
}

async function photograph(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForLoadState('networkidle')
  const path = testInfo.outputPath(`${name}.png`)
  await page.locator('.map-dock').screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

function assertActualBasemap(resources: { url: string; status: number }[]) {
  expect(resources.filter(({ status }) => status >= 400), 'Every requested map resource must load successfully').toEqual([])
  for (const pattern of [/\/styles\/liberty$/, /\/planet$/, /\/planet\/.+\.pbf$/, /\/fonts\/.+\.pbf$/, /\/sprites\/.+\.png$/]) {
    expect(resources.some(({ url, status }) => pattern.test(url) && status === 200), `Real basemap resource ${pattern}`).toBe(true)
  }
}

test('detailed streets, venue discovery, route selection and walking exports', async ({ page }, testInfo) => {
  const observed = observeMap(page)
  await openCampus(page)
  assertActualBasemap(observed.resources)
  await expect(page.locator('.map-place-marker')).toHaveCount(18)
  await expect(page.locator('.map-stop-marker').first()).toHaveAccessibleName(/Start and finish:/)
  await photograph(page, testInfo, 'desktop-route')
  await page.getByRole('button', { name: 'Barista, food and drink. Show venue details.', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Place details: Barista', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close place details', exact: true }).click()
  await page.getByRole('button', { name: 'Close map search results', exact: true }).click()
  await page.getByRole('button', { name: /Show the entire route for/ }).click()
  await page.setViewportSize({ width: 960, height: 900 })
  const searchBounds = await page.locator('.map-search-box').boundingBox()
  const refitBounds = await page.getByRole('button', { name: /Show the entire route for/ }).boundingBox()
  expect(searchBounds!.x + searchBounds!.width).toBeLessThanOrEqual(refitBounds!.x)
  await photograph(page, testInfo, 'desktop-960-route')
  await page.setViewportSize({ width: 1280, height: 900 })

  const walks = page.getByRole('list', { name: 'Suggested walks' }).getByRole('button')
  await walks.nth(1).click()
  await expect(walks.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.detail-head .eyebrow')).toHaveText('Walk 2 of 3')
  const routeLink = page.getByRole('link', { name: 'Open this walk in Google Maps', exact: true })
  const routeUrl = new URL((await routeLink.getAttribute('href'))!)
  expect(routeUrl.origin).toBe('https://www.google.com')
  expect(routeUrl.searchParams.get('travelmode')).toBe('walking')
  expect(await routeLink.getAttribute('href')).toBe(await page.getByRole('link', { name: 'Start in Google Maps', exact: true }).getAttribute('href'))
  await page.getByRole('button', { name: /Show the entire route for/ }).click()

  await page.getByRole('button', { name: 'Show the MIT campus area' }).click()
  await page.getByRole('group', { name: 'Places on the map' }).getByRole('button', { name: 'Landmarks', exact: true }).click()
  await expect(page.locator('.map-place-marker.is-cafe:not([hidden])')).toHaveCount(0)
  await expect(page.locator('.map-place-marker.is-landmark:not([hidden])').first()).toBeVisible()
  await page.getByRole('group', { name: 'Places on the map' }).getByRole('button', { name: 'All places', exact: true }).click()
  await mapSearch(page).fill('barista')
  await expect(page.getByRole('list', { name: 'Matching campus places' }).getByRole('button')).toHaveCount(1)
  await page.getByRole('list', { name: 'Matching campus places' }).getByRole('button', { name: /Barista/ }).click()
  const place = page.getByRole('region', { name: 'Place details: Barista', exact: true })
  await expect(place).toBeVisible()
  await expect(place).toContainText('Opening hours are estimates; check before visiting')
  const listing = new URL((await place.getByRole('link', { name: 'Google Maps', exact: true }).getAttribute('href'))!)
  expect(listing.origin).toBe('https://www.google.com')
  expect(listing.searchParams.get('query')).toBe('Barista, Manipal, Karnataka, India')
  await expect(place.getByRole('link', { name: 'Mapped location · OpenStreetMap' })).toHaveAttribute('href', /https:\/\/www\.openstreetmap\.org\/(node|way)\/\d+$/)
  await photograph(page, testInfo, 'desktop-venue')
  await place.getByRole('button', { name: 'Add to walk', exact: true }).click()
  await expect(page.getByRole('button', { name: '1 must-visit', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Nothing fits within ₹200 per person')
  await page.getByRole('button', { name: /^Budget per person:/ }).click()
  await page.getByRole('spinbutton', { name: 'Budget in rupees, custom' }).fill('400')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Itinerary' })).toContainText('Barista')

  await mapSearch(page).fill('a brand new cafe')
  await expect(page.locator('.map-search-results')).toContainText('No matching place in this campus catalogue')
  const discovery = new URL((await page.getByRole('link', { name: 'Search more places on Google Maps' }).getAttribute('href'))!)
  expect(discovery.searchParams.get('query')).toContain('a brand new cafe near MIT Manipal')
  await page.getByRole('button', { name: 'Close map search results' }).click()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Saved walks, 1', exact: true })).toBeVisible()
  await page.getByText('More ways to take it', { exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'KML for Google My Maps', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.kml$/)
  const kml = await readFile((await download.path())!, 'utf8')
  expect(kml).toContain('<coordinates>')
  expect(kml).toContain('Barista')
  await mapReady(page)
  assertActualBasemap(observed.resources)
  expect(observed.errors).toEqual([])
})

test('mobile map, full-screen keyboard focus, venue cards and responsive controls', async ({ page }, testInfo) => {
  const observed = observeMap(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await openCampus(page)
  await page.locator('.map-dock').scrollIntoViewIfNeeded()
  await photograph(page, testInfo, 'mobile-inline')
  await page.setViewportSize({ width: 320, height: 568 })
  await mapSearch(page).fill('library')
  await page.getByRole('list', { name: 'Matching campus places' }).getByRole('button', { name: /MIT Central Library/ }).click()
  await expect(page.getByRole('dialog', { name: 'Map, full screen', exact: true })).toBeVisible()
  await expect.poll(() => page.locator('.map-place-marker.is-selected .map-place-icon').evaluate((element) => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  }), { message: 'The selected venue pin must be visible above the place card, even on a short phone' }).toBe(true)
  const credit = page.locator('.maplibregl-ctrl-attrib a[href*="copyright"]')
  await expect(credit).toBeInViewport()
  expect(await credit.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  }), 'Map attribution must stay readable and clickable below the venue card').toBe(true)
  await photograph(page, testInfo, 'mobile-320-short-venue')
  await page.keyboard.press('Escape')
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const expand = page.getByRole('button', { name: 'Expand map to full screen', exact: true })
    await expand.click()
    const dialog = page.getByRole('dialog', { name: 'Map, full screen', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(page.getByRole('button', { name: 'Close full-screen map' })).toBeFocused()
    await mapSearch(page).fill('library')
    await page.keyboard.press('Escape')
    await expect(page.locator('.map-search-results')).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(mapSearch(page)).toHaveValue('library')
    await mapSearch(page).click()
    await mapSearch(page).fill('library')
    await page.getByRole('list', { name: 'Matching campus places' }).getByRole('button', { name: /MIT Central Library/ }).click()
    const place = dialog.getByRole('region', { name: 'Place details: MIT Central Library (outside)', exact: true })
    await expect(place).toBeVisible()
    await expect(place.getByRole('link', { name: 'Google Maps', exact: true })).toBeInViewport()
    const bounds = await place.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
    await photograph(page, testInfo, `mobile-${width}-venue`)
    for (let index = 0; index < 28; index++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(expand).toBeFocused()
    await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Expand map to full screen' })).toHaveCount(0)
  await mapReady(page)
  assertActualBasemap(observed.resources)
  expect(observed.errors).toEqual([])
})

test('a map-service failure stays actionable and retry restores the real map', async ({ page }, testInfo) => {
  const observed = observeMap(page)
  await page.route('https://tiles.openfreemap.org/styles/liberty', (route) => route.abort('failed'))
  await page.goto('./', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.vector-map-shell')).toHaveAttribute('data-map-status', 'failed')
  await expect(page.getByText('The street map is unavailable.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open this walk in Google Maps', exact: true })).toBeVisible()
  await mapSearch(page).fill('barista')
  await page.getByRole('list', { name: 'Matching campus places' }).getByRole('button', { name: /Barista/ }).click()
  await expect(page.getByRole('region', { name: 'Place details: Barista' }).getByRole('link', { name: 'Google Maps', exact: true })).toBeVisible()
  await photograph(page, testInfo, 'map-service-failure')
  await page.unroute('https://tiles.openfreemap.org/styles/liberty')
  await page.getByRole('button', { name: 'Retry map', exact: true }).click()
  await mapReady(page)
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)
  assertActualBasemap(observed.resources)
  expect(observed.errors).toEqual([])
})
