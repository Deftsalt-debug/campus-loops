# Campus Loops MVP roadmap

**Fourth revision, 2 October 2026:** editable stop durations, a walk comparison table, validated saved-walk backup/restore, and a local field notebook are implemented. The notebook supports collecting evidence for Week 1; its observations require review before changing route data. Targeted loop routing reduces search work while preserving the benchmark's route results. Rain-return feasibility, café pass-by rules and calendar identity have regression coverage.

Updated 1 October 2026. **Status:** Weeks 2–5 are implemented. That covers the routing core, the planner, a responsive React + Leaflet interface, eight occasion modes, share links, Google Maps / KML / GPX export and the calibration log. The app is deployed to GitHub Pages on a **demo dataset**: real paths and places from an OpenStreetMap snapshot, with placeholder prices and some placeholder hours. Week 1 (field verification) has **not** been done, so the release must stay labelled a demo. See `MANIFEST.md` for a full guide.

**Third revision, 1 October 2026 (evening):** loop returns (a different way home when the quickest one retraces the way out, at most 2× the quickest return), calendar export, mode defaults that actually work on the campus data, and no "outings" to the place you started from.

**Second revision, 1 October 2026:**
- Real-geometry demo data imported from OpenStreetMap (`scripts/import-osm.ts`) with SRTM elevation, so map routes follow actual streets
- Eight occasion modes (date, friends, catch-up, walking meeting, show someone around, solo reset, study break, active walk), each with its own rules, avoided tags, defaults and stop cap
- Google Maps directions links (no API key), KML for Google My Maps, GPX, and a text itinerary
- Validated share links that re-check the exact route instead of substituting one
- The Week 4 interface, with an interactive backdrop
- Per-place `hoursSource` and `spendSource` so placeholders are flagged in plans and refused in production

**First revision, 1 October 2026,** added: a back-by time and an enforced sunset limit, hill-aware walking times and an avoid-steps filter, rain mode, dataset tooling, and an on-device calibration log. It also changed the planner to use a pruned search that reports exact minimums when nothing fits.

## 1. The product worth building

Campus Loops helps someone answer: **“I have an hour and ₹150. Where can we walk, stop, and get back in time?”**

Start with one small, verified part of MIT Manipal and its immediate surroundings. The useful result is a complete outing: a walk, optional places to spend time, an estimated cost, and a return to the start. A calm chat, an outing with friends, and showing a guest around can favour different stops.

**My assessment:** this is a realistic student MVP and a good next project after learning Dijkstra. Its value will come from trustworthy local details and sensible suggestions. The difficult part is likely to be keeping paths, access, prices, and opening hours accurate. Whether people want it often enough is still unproven. Test that before building a community platform.

A strong first release can have 10–15 useful places and a handful of good walks. It does not need to cover all of Manipal. No local place names, opening times, or prices in this document have been verified; examples below are fictional.

### The first validation step

Ask five students to describe a recent real outing: how much time they had, where they went, what they spent, and what was annoying to plan. Show three manually prepared itinerary cards. Ask them to pick one for an actual outing, rather than asking whether they “like the idea.”

Proceed if several people can name a situation where they would use it and at least a few will test a walk. If everyone already has the same two favourite routes, useful curation and sharing may matter more than automated planning.

## 2. A deliberately small first release

### Inputs

- **Start:** choose a verified public landmark from a short list; return to the same place
- **Time available:** 30, 45, 60, or 90 minutes, with a numeric override within that range
- **Budget:** maximum estimated spend per person in INR; ₹0 is valid
- **Occasion:** quiet conversation, friends, or showing a guest around
- **Optional stops:** choose up to two must-visit places; a separate “Include a café” toggle is a requirement when enabled
- **Pace:** relaxed or normal, under the “Options” editor
- **Stop time:** each selected stop has an editable dwell time; sitting and talking count as time
- **Back by (optional):** a clock time today, such as a hostel in-time. The planner works to whichever comes first: the chosen duration, the back-by time, sunset, or the end of the pilot window. It tells the user which one applied.
- **Avoid steps:** a hard filter that removes every edge marked `steps`. It is not a wheelchair-access promise.
- **Rain mode:** schedules only stops tagged `sheltered`, prefers covered paths when choosing routes, ranks plans with more cover first, and states the covered share of the walk. Manipal's June–September monsoon makes this a real need.

Default to walking only with no paid stop required. The initial pilot is **daylight outings only**, and the planner enforces this. Sunrise and sunset for the dataset location are calculated on the device with the NOAA equations (no API call); they match US Naval Observatory times to within a minute. No plan may end after sunset. Use the device's current date and time to assess known hours, in `Asia/Kolkata` (a fixed +05:30 offset, because India has no daylight saving), and display that assumption. Future-date planning can wait.

### Output

Show up to three genuinely different suggestions, each with:

1. A name based on what it contains, such as “Short walk with a seated break”
2. Total planned duration, split into walking, stops, and a buffer
3. Estimated spending range per person and what it covers
4. Ordered stops with arrival offsets and dwell times
5. A path on the map, distance, and a clear return point
6. One useful explanation, such as “Includes a seated stop and 10 minutes of spare time”
7. Any access or data-quality warning, plus when relevant data was checked
8. A Share button and an editable plan

Show one result if only one is genuinely suitable. Never pad the list with duplicates.

### Included and deferred

**Include:** a verified graph, itinerary planning, a responsive map/list interface, clear empty states, local favourites, shareable links, and static hosting.

**Added since:** occasion modes, Google Maps hand-off (links and KML; no Google API key or embedded Google map).

**Defer:** accounts, a public feed, ratings, comments, live GPS tracking, navigation voice prompts, bookings, payments, AI chat, recommendation models, live crowd estimates, multi-campus coverage, and a custom map editor.

A map is useful, but the list must explain the whole outing on its own.

## 3. Keep the technical setup small

Recommended default: **Vite + TypeScript + plain HTML/CSS + Leaflet**, with static JSON data and Vitest for the routing tests. Vite provides a development server and a static production build; Leaflet supplies the map, markers, and route polylines. It does not calculate walking routes. [Vite guide](https://vite.dev/guide/) · [Leaflet quick start](https://leafletjs.com/examples/quick-start/) · [Vitest guide](https://vitest.dev/guide/)

**Decision (1 October 2026): Vite + React + TypeScript**, Vitest for tests, oxlint for linting and tsx for data scripts. The routing core lives in `src/core/`, and a lint rule stops it importing React, Leaflet, UI or storage code. The core can therefore be tested and reused without the interface.

Current structure (✓ = exists; the rest is planned):

```text
src/
  core/                     ✓ framework-free routing core
    types.ts                ✓
    dataset/validate.ts     ✓ all data checks from §4
    dataset/load.ts         ✓ validate-then-type loader
    graph/buildGraph.ts     ✓ adjacency lists, step filter
    graph/edgeCost.ts       ✓ pace + climb + delay; rain routing weight
    routing/minHeap.ts      ✓
    routing/dijkstra.ts     ✓ forward and reverse
    routing/path.ts         ✓ reconstruction, continuity
    time/clock.ts           ✓ IST, open windows
    time/sun.ts             ✓ sunrise/sunset
    planner/                ✓ candidates, search, curated, score, diversity, explain, plan
    calibration.ts          ✓ walk-log statistics
  storage/calibrationLog.ts ✓ on-device log
  data/fixtures/            ✓ synthetic dataset (never production)
  App.tsx                   ✓ planner playground (replaced in Week 4)
  ui/                       … form, results, map (Week 4)
  share.ts                  … URL encode/decode (Week 5)
scripts/                    ✓ build-fixture, validate-data, export-geojson
tests/                      ✓ heap, routing, cost, time, planner, invariants, validate, calibration
```

No backend, database, server-side rendering, global state library, or routing API is necessary for this bounded dataset. Add a dependency only when it removes a clear piece of work. Implementing the small heap and Dijkstra yourself is useful here because you want to understand the data structures; test them carefully.

## 4. Build a trustworthy local dataset

### Start with observation

Choose a walkable pilot area that you can personally check. Aim initially for 30–80 graph nodes, 10–15 places, and 3–5 manually checked walks. These are scope targets, not claims about how much data is available.

Nodes are junctions, path ends, gates, crossings, and entrances. Places attach to their actual reachable entrance node, not the centre of a building. Edges follow real traversable paths, with geometry points where the path bends.

Useful local information includes seating, shade, steps, surface, a usable public entrance, permission restrictions, and the typical time someone wants to spend there. Record only observations you can support. A café website or a direct menu check can support a price estimate; a friend's memory alone should not be labelled current.

### Where OpenStreetMap fits

OSM can provide a starting extract of mapped paths, crossings, entrances, and places. Overpass can query OSM data for a bounded area; it is a data retrieval tool, not a routing engine. Use it during curation, then save a reviewed snapshot. Do not call a public Overpass server for every user's plan. [Overpass API documentation](https://wiki.openstreetmap.org/wiki/Overpass_API)

Inspect campus coverage before committing to an import pipeline. If mapping is sparse, a small manually surveyed graph is a better first step than importing the entire city and trying to repair it. Do not trace copyrighted third-party maps without permission.

OSM pedestrian access tags are evidence to inspect, not proof that a gate is open now. Missing access data does not establish permission. Motor-vehicle one-way rules should not automatically become pedestrian restrictions. [OSM pedestrian access documentation](https://wiki.openstreetmap.org/wiki/Key:foot)

### Graph and tiles are separate

- **Graph:** the nodes and edges your algorithm can use
- **Basemap tiles:** the pictures behind your route
- **Places:** the stops, amenities, costs, and dwell times

A line looking plausible on a basemap does not make it a valid edge. Never connect two nearby points through a wall, building, restricted area, or unsafe crossing merely because the distance is short.

### Minimum data shape

Use JSON and explicit units. A compact schema is enough:

```ts
type Node = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  elevationM?: number;     // used to derive edge climb
};

type Edge = {
  id: string;
  segmentId: string;       // same physical segment in either direction
  from: string;
  to: string;             // one directed arc; add reverse arc if permitted
  meters: number;
  delaySeconds: number;   // nonnegative crossing or gate allowance
  ascentMeters?: number;  // climb in this direction; overrides node elevations
  geometry: [number, number][]; // consistently [lat, lng] for this app
  allowed: boolean;
  steps: boolean;
  covered: boolean;       // roofed along its whole length
  verifiedAt: string;
  source: string;
};

type Place = {
  id: string;
  name: string;
  nodeId: string;
  category: 'cafe' | 'seating' | 'landmark' | 'waypoint';
  dwellDefaultMin: number;
  spendLowInr: number | null;
  spendHighInr: number | null;
  tags: string[];         // e.g. seating, sheltered, conversation
  verifiedOpenWindows: { day: number; start: string; end: string }[];
  hoursStatus: 'verified' | 'always' | 'unknown'; // always = open public space
  verifiedAt: string;
  source: string;
};
```

Add `datasetVersion`, `timezone`, licence/source metadata, `isFixture`, `location` (used for the sunset calculation), `supportedWindow` (the daily hours in which every edge has been checked), and `starts` at the dataset level.

**Elevation:** campus hills change walking times noticeably. Free 30 m digital elevation models such as Copernicus GLO-30 are too coarse to separate a staircase from the road beside it. Treat them as a first estimate for node elevations, then use an explicit `ascentMeters` on edges where the field survey shows a crest or dip. Record which source each value came from. The simple hours format supports weekly windows; manually exclude exceptional closures and special-day uncertainty. Do not claim a full opening-hours parser.

A curated loop record needs an ID, start node, ordered edge IDs, optional stop IDs, and verification date. Route results need ordered edges, scheduled stop visits, walking seconds, dwell seconds, buffer seconds, estimated spending, and warnings.

### Data checks before routing

- [ ] IDs are unique; all referenced nodes, places, and edges exist
- [ ] Lengths, delays, dwell times, and costs are finite and nonnegative
- [ ] Reverse arcs exist only where walking both ways is permitted
- [ ] Gates and crossings are represented explicitly
- [ ] Edge geometry starts and ends at the correct nodes
- [ ] Each supported start has at least one usable return route
- [ ] Disconnected areas produce “unreachable,” never a straight-line shortcut
- [ ] Each advertised route is walked and access-checked before the pilot
- [ ] Every arc in a two-way segment is an exact reverse, with matching length, steps and cover

All except the last two items are automated by `npm run data:check`. Use `npm run data:check -- --production` before deploying; it also refuses fixture data. `npm run data:geojson` writes a file you can open on geojson.io to check the graph visually: red edges are restricted, orange have steps, green are covered.

For v1, include only edges confirmed usable throughout the supported planning window. Remove closed or uncertain-access edges. If gate schedules become complex, narrow the pilot window rather than implementing time-dependent pathfinding immediately. A “quiet” tag is not a safety guarantee. Do not promise wheelchair access without a proper access audit.

## 5. The routing design

### Dijkstra has one clear job

Use an adjacency list to represent outgoing edges, a min-heap to choose the next closest node, and predecessor edges to reconstruct the route. Dijkstra works with nonnegative edge weights and respects directed edges. It calculates shortest paths from a source; unreachable destinations remain unreachable. [Princeton shortest paths reference](https://algs4.cs.princeton.edu/44sp/)

For this app, the routing weight is estimated walking time:

```text
edgeSeconds = meters / paceMetersPerSecond + ascentMeters × climbSecondsPerMeter + delaySeconds
```

Start with explicit, adjustable assumptions: 1.0 m/s for relaxed walking, 1.2 m/s for normal walking, and 6 s per metre climbed (Naismith's rule: one hour per 600 m of ascent). These are planning defaults to calibrate in field tests, not measured campus averages. Climb applies in the uphill direction only, so A→B can cost more than B→A. That is why the graph keeps directed arcs. Ignore descent for now; gentle downhill on campus paths is roughly as fast as flat ground.

**Rain mode changes which path is chosen, not how long it takes.** When choosing a path, Dijkstra uses `edgeSeconds × 1.5` for uncovered edges, so covered paths win when the detour is reasonable. The times shown always come from the true `edgeSeconds`. This keeps the rule below: do not adjust edge times for comfort.

Keep seconds internally and round only for display. Reject negative weights. Do not subtract “nice scenery” from edge time: route desirability belongs in the itinerary ranking.

### The itinerary is a separate problem

Dijkstra does not choose a satisfying hour-long outing, budget for coffee, or allocate sitting time. In particular, the shortest path from a start back to itself is the empty path.

Use two candidate sources:

1. **Generated outings:** an ordered sequence of up to three stops connected by shortest walking paths, returning to the start
2. **Curated walks:** a few verified closed walks, including no-purchase walks, with explicit edge sequences

Generated outings may retrace their path. Label those “out-and-back” when appropriate; a return to the start does not imply a non-repeating loop. The curated walks supply good pure-walking options without needing a sophisticated cycle algorithm.

### Concrete planning pipeline

1. Validate inputs and load the selected dataset version
2. Work out the deadline: `min(now + duration, back-by, sunset, end of pilot window)`. Refuse with a specific message if it is before sunrise, after sunset, outside the window, or past the back-by time
3. Remove disallowed edges, plus stepped edges when Avoid steps is on
4. Keep all required places, then choose up to 12 total candidate places. Exclude unknown hours, unknown prices, closed today, unreachable, over budget, and (in rain mode) unsheltered stops. Rank by occasion points, then distance, then id
5. Run one reverse Dijkstra from the start (true times) to get the shortest possible way home from every node. Run forward Dijkstra lazily from each leg's source and reuse it within the request
6. Depth-first search over ordered selections of 1–3 distinct stops (at most 1,464 with 12 candidates). Prune a branch as soon as `arrival + dwell + shortest way home + buffer` exceeds the deadline, summed upper-bound spend exceeds the budget, a visit misses its verified window, or the remaining slots can't fit the missing required stops. Every prune is safe because costs only grow as stops are added
7. Do not schedule waiting for a place to open in v1
8. Evaluate the curated walks under the same checks
9. Score feasible plans, remove near-duplicates, and show up to three

The empty generated sequence is not a useful walk and should be discarded. A curated walk with no stop can still qualify. A zero-dwell waypoint can shape a walk without pretending the user will sit there.

Keep required places when narrowing candidates. If the requirements cannot fit the three-stop cap, explain the limit before planning. A disabled café toggle means cafés are optional, not forbidden; add an explicit “No paid stops” setting only if testers need that distinction.

For this size, bounded enumeration is easier to explain and test than a complicated optimiser. It finds the best plan under your scoring rule **within the candidates and path variants examined**, not the globally best outing. A greedy “add the best-value stop” approach is an option later for a much larger dataset, but can miss combinations that fit better.

### Hard limits and soft preferences

Hard limits always win:

```text
walking + dwell + buffer <= min(duration, back-by − now, sunset − now, window end − now)
sum of estimated upper-bound spending <= budget
all required places/categories included
all route edges allowed (and step-free when Avoid steps is on) and all visits feasible
in rain mode, every stop with dwell time is sheltered (unless the user required it)
```

Use a small editable buffer, initially 5 minutes. Label it clearly; it cannot guarantee punctuality. Price ranges are estimates, not a promise about what a person orders. Unknown-cost paid stops cannot satisfy a strict budget and should be excluded until checked. ₹0 plans use genuinely free activities.

Rank remaining plans simply: occasion match first, then less retracing, then useful time fit. In rain mode, covered share comes straight after occasion, because staying dry matters more than avoiding a retraced path. Zero-dwell waypoints don't count towards the occasion average. That way passing the pond to turn an out-and-back into a loop isn't penalised; the lower retracing rewards it instead. Give each place 0–2 occasion points using a short, inspectable tag rule; cap or average the total so adding extra stops does not always win. Avoid scoring unused time as a severe failure: a calm 42-minute plan can be better than cramming 59 minutes into an hour.

Do not repeatedly award points for the same place or for passing it on another leg. Explicitly scheduled visits get dwell and spending; merely passing a place does not.

For diversity, compare physical `segmentId` sets as well as stop sets. Treat identical stops and very high path overlap, initially over 80%, as near-duplicates. This threshold is a tuning choice. If the graph only supports one distinct route, return one.

### An illustrative result

All names, prices, and timings here are fictional:

```text
Request: 60 minutes, ₹150 per person, friends, café required
Start A → Café B → Seated Spot C → Start A

Walking: 8 + 6 + 11 = 25 minutes
Café: 15 minutes, estimated ₹80–120
Seated break: 10 minutes, free
Buffer: 5 minutes
Planned total: 55 minutes
Unallocated time: 5 minutes
Budget check: ₹120 <= ₹150
```

Do not silently use the remaining five minutes as extra dwell. If the café is closed, do not drop it while calling the request satisfied. Offer a different qualifying café, or show an explicit alternative that the user can choose.

### When nothing fits

Show the specific blocker and one or two edits: “No verified café fits a 30-minute return walk from this start. Try 45 minutes or remove the café requirement.” Only state a precise minimum duration if the planner actually calculated it. Never relax budget, accessibility restrictions, required stops, or access rules automatically.

**Implemented:** when nothing fits, the planner runs the same search again with one limit lifted. It tries time first, then budget, then both. These relaxed results are never shown as plans; they only provide the numbers for the message. That lets it state real figures: “Nothing fits in the 34 minutes of daylight left (sunset 18:20). The shortest suitable plan found needs 36 minutes, including the buffer.” Or: “The cheapest suitable plan found is estimated at up to ₹60.” The minimum is exact among the candidates examined, not across the whole dataset.

## 6. A clean interface on phones and laptops

Use one page, normal typography, one accent colour, and plain labels. Skip a large marketing hero, decorative gradients, animated backgrounds, and chat-style planning.

**Phone:** show the short form first. After planning, show the selected route's summary and itinerary, with a List / Map switch. Keep the map from swallowing the screen. A simple tab is easier to build and use than a draggable bottom sheet.

**Laptop:** show a left panel for controls/results and a larger map on the right. Keep the selected result and highlighted route in sync. At narrow widths, collapse to the phone layout rather than shrinking both columns.

Details that matter:

- At least 44px touch targets as a design target, visible keyboard focus, real field labels, readable contrast, and 16px or larger input text
- No hover-only controls; errors beside the relevant field
- Duration presets plus a numeric input, rather than a slider alone
- Only the selected route prominently drawn; secondary routes muted
- Clearly numbered stops matching the itinerary
- Preserve entered values when editing or returning from a shared plan
- Loading, invalid-input, no-result, missing-map, and outdated-link states
- No horizontal page scrolling at 360px width; test landscape as well
- Text itinerary remains usable if tiles fail or the map is hidden

## 7. Sharing and local saving without accounts

Use a shareable URL fragment containing a schema version, dataset version, selected route identifier or compact ordered edge IDs, stop dwell choices, and necessary planning inputs. Build it with a small validated serializer. A prototype format could look like `#v=1&data=pilot1&...`; this is a format sketch, not an existing URL.

Preserve the selected route rather than simply regenerating a possibly different result from the same preferences. Cap links at a practical target of roughly 2 KB; if a detailed route will not fit, provide “Copy itinerary” instead. Avoid a URL-shortening service or backend in v1.

On open, validate types, limits, IDs, edge continuity, totals, and the dataset version. Treat the link as untrusted input and render names as text. Recheck current closures and visit hours before suggesting someone follow an old plan. If its data version is unavailable or its route is no longer valid, show “This plan needs updating” and offer regeneration; do not silently substitute a new route.

Use the browser's share sheet where supported and a copy-link fallback. Store favourites locally only when the user chooses Save; offer Remove and Clear saved plans. Explain that local saves do not sync between devices and may disappear when browser data is cleared.

### Calibration log

After an outing, a tester can record how long the walk actually took. The log stays on the device (`localStorage`) and is exported as JSON on request; nothing is uploaded. `summarise()` reports the median ratio of actual to predicted walking time, the share of walks within ±20%, and a dwell ratio. `suggestedPaceMps()` gives the pace that would have made the median walk exact. This is a suggestion to review, never applied automatically. If the climb term is the problem, short uphill walks will be consistently slow while flat ones are fine. Adjust `climbSecPerM` in `planner/config.ts`, not the pace.

### Privacy

Shared links reveal the selected public starting point, route, and preferences to anyone receiving them. Use landmarks, not hostel room numbers or exact home addresses. URL fragments reduce routine server-side exposure but are not secret or encrypted storage. No background location permission, account, or location history is needed. Hosting and map-tile providers may still receive network information such as IP addresses and requested map areas; say so in a short privacy note. Everything shipped in the static dataset is public, so keep personal notes and sensitive campus details out of it.

## 8. Performance and deployment

### Targets to measure

These are engineering budgets for the pilot, not measured results:

- Initial application JS and CSS: aim below 200 KB compressed, excluding map tiles and dataset
- Reviewed dataset: aim below 200 KB compressed; remove redundant geometry points without cutting across paths
- Generate suggestions within 200 ms after data load on a representative mid-range phone
- Keep the input form usable before the map finishes loading
- Keep the initial map bounded to the pilot area and avoid loading every result's markers at once

The planner is a pure, deterministic function of `(dataset, request, now)`, with no hidden clock or randomness. Tests can pin the time, and a shared link can be checked against a recomputed result.

Measure the production build and a real phone. (First development build: 82 KB gzipped JS including React and the fixture dataset.) If planning blocks the UI, first shrink the candidate set, reuse shortest-path results within the request, and avoid repeated graph parsing. Only add a Web Worker after measurement shows it helps. Avoid persistent all-pairs tables and a cache-invalidation system for this tiny graph.

### Hosting plan for later

Build static assets and deploy the output directory to a static host, for example GitHub Pages if the project will live on GitHub. Configure Vite's base path for a repository subpath, use fragment-based sharing so refreshes work without server rewrite rules, and test a direct shared link on the deployed origin. `vite preview` is for local checking, not a production server. [Vite static deployment guide](https://vite.dev/guide/static-deploy.html)

Choose the actual host during implementation. Verify current limits and terms before using it; no paid plan is necessary to assume in this roadmap. Never put secret API keys in static frontend code. If a map provider uses a browser-visible key, follow its restrictions and quota guidance.

### OSM obligations and practical limits

If using OSM data, keep visible OpenStreetMap attribution and the appropriate ODbL notice. Review ODbL obligations before distributing an OSM-derived database; a separate licence for application code does not replace data obligations. Record what came from OSM versus independent surveys. [OSM copyright and licence](https://www.openstreetmap.org/copyright)

OSM's public raster tile service has a usage policy, not an unlimited hosting guarantee. Follow attribution, identification/referrer, and caching requirements; do not bulk-download or prefetch tiles for offline use. Keep the tile provider configurable and choose a suitable provider before broader launch. [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/)

The planner can operate without a live routing API after its assets load. That does **not** make the whole website offline-capable. A later service worker may cache your app and permitted local data; offline basemaps need a provider or dataset whose terms permit them. Do not cache public OSM tiles for offline map packs.

## 9. Build in six manageable stages

Treat these as suggested weeks, not promised deadlines. If web development is new, allow extra time for the UI. Finish each acceptance check before expanding scope.

### Week 1 — Validate the need and map a small area

- [ ] Interview five students about actual outings
- [ ] Choose the pilot boundary and supported daylight window
- [ ] Review OSM coverage and choose survey-first or reviewed-extract-first data
- [ ] Curate the initial graph, 10–15 places, and 3–5 walk templates
- [ ] Record sources, verification dates, and access restrictions
- [ ] For each edge, record steps, cover, and any noticeable climb; tag sheltered stops. Rain mode and Avoid steps depend on these fields
- [ ] Replace the fixture with `src/data/<version>.json` and get `npm run data:check` passing with zero errors

**Done when:** three manual sample itineraries can be walked as described, and every edge used is real and permitted. If data collection is too large, shrink the boundary.

### Week 2 — Build the routing core without the map

- [x] Define types and data validation
- [x] Implement adjacency lists, a min-heap, Dijkstra (forward and reverse), and path reconstruction
- [x] Add tiny hand-checkable graph fixtures and a synthetic pilot fixture
- [x] Print one start-to-stop route and a valid journey home (planner playground)
- [x] Climb-aware edge cost, avoid-steps filter, rain routing weight
- [x] `data:check`, `data:geojson`, `data:fixture` scripts

**Done when:** shortest-path tests pass, directed reachability works, and disconnected destinations cannot produce fabricated paths.

### Week 3 — Make the itinerary planner useful

- [x] Implement required-stop filtering and pruned depth-first search
- [x] Include walking, dwell, buffer, return, spending, and open-window checks
- [x] Back-by and sunset deadlines
- [x] Add curated no-purchase walks
- [x] Add simple occasion ranking, rain ranking, and duplicate suppression
- [x] Write clear no-result reasons with calculated minimum time or spend
- [ ] Repeat the matrix against the real dataset once Week 1 data exists

**Done when:** a fixed matrix of 30/45/60/90-minute and ₹0/₹100/₹200 requests produces valid plans or honest failures. The algorithm never exceeds a hard limit in its own model. *(Met on fixture data: `tests/invariants.test.ts` covers 432 combinations of start, duration, budget, occasion, rain mode and time of day.)*

### Week 4 — Build the responsive product

- [x] Build the form and itinerary cards first
- [x] Add Leaflet with path geometry and attribution (OSM demo geometry; verified geometry still needs Week 1)
- [x] Surface back-by, avoid steps and rain mode under “Options”; show the deadline reason and sunset time
- [x] Implement responsive phone map and laptop split view (the 2 October redesign uses an inline/full-screen persistent phone map)
- [x] Add keyboard access and all error/empty/loading states
- [x] Keep map failure independent from planning

**Done when:** someone can create and understand a plan without help on a phone and laptop, and without relying solely on map colours.

### Week 5 — Add sharing and test outside

- [x] Add versioned share links and copy-itinerary fallback
- [ ] Add explicit local Save and Delete actions (not built yet: the share link doubles as a bookmark)
- [x] Test malicious, truncated, outdated, and unknown-ID links
- [ ] Ask 5–10 volunteers to try suitable daylight outings
- [ ] Compare predicted walking and dwell time with separately recorded actual times
- [x] Add a small “I did this walk” form backed by the calibration log, with Export and Clear
- [ ] Review `summarise()` output per pace; adjust pace or climb defaults only with evidence

**Done when:** links round-trip correctly, no access mistake remains in advertised routes, and timing errors are understood. An initial calibration target is walking estimates within about 20% on checked routes; revise assumptions rather than hiding poor estimates behind a bigger buffer.

### Week 6 — Ship a small pilot

- [ ] Run `npm run verify` (lint, type checking, tests, production build)
- [ ] Run `npm run data:check -- --production` against the real dataset
- [ ] Measure payload and planning speed on an actual phone
- [x] Deploy the static build (GitHub Pages via Actions) and verify shared links after reload
- [ ] Publish coverage, assumptions, attribution, and a last-updated date
- [ ] Provide a simple path/price correction contact without collecting unnecessary personal details
- [ ] Recheck the routes before inviting testers

**Done when:** a new tester can open the link, plan a feasible outing, share it, and report a problem. Keep the release labelled as a local pilot.

## 10. Tests that protect the product

**Algorithm tests:** known shortest path; ties; one-way walking arc; unreachable node; zero-length connector; invalid negative weight; stale heap entries; predecessor reconstruction; valid return even when outbound and return paths differ; reverse search; brute-force comparison on 200 random graphs.

**Cost and time tests:** climb counts only uphill; explicit ascent overrides elevations; rain changes the chosen path but not the reported seconds; avoid steps makes a stairs-only destination unreachable; sunrise and sunset within a minute of USNO on two reference dates; sunset between 17:45 and 19:15 IST all year; IST conversion across UTC midnight; a visit that spans a closing time is rejected.

**Planner tests:** budget exactly at the limit; duration exactly at the limit; dwell pushes the plan over; missing return leg; café required but none qualifies; a required stop survives candidate trimming; unknown price; closing during a visit; no paid stops under ₹0; no-stop curated walk; no duplicate POI reward; honest out-and-back label; back-by tighter than the duration; sunset cutting a 90-minute request short; correct minimum duration and minimum spend in blockers; rain mode scheduling only sheltered stops; avoid steps never using a stepped edge; deterministic output.

**Data tests:** each validator error code is triggered by a targeted change to the fixture; the loader refuses broken data; production mode refuses fixture data. **Calibration tests:** medians, the within-20% share, pace filtering, and storage that is corrupt, full or unavailable.

**Invariants for every returned plan:** edge sequence is continuous, start equals end, all required stops are scheduled, time components add up, spend is within the stated model, and no disallowed edge is used. On tiny graphs, compare Dijkstra against an independent brute-force shortest-path check.

**Product tests:** 360px phone, landscape phone, laptop, keyboard-only use, slow connection, failed tiles, repeated Generate clicks, changing inputs after selection, opening a shared link, browser Back/Forward, corrupt local saves, unavailable storage, and an expired dataset version.

A test suite validates the software's model. Field checks validate whether that model matches a real walk; both are necessary.

## 11. Community sharing comes after the planner earns trust

First, sharing means “send this route to a friend.” That already tests whether people find the output worth passing on.

Next, invite a small number of students to submit favourite routes through a simple reviewed process. Store route geometry separately from their personal identity. Ask for permission before publishing a name or description. Record duration as a reported observation with pace and date, not a universal fact.

Only build a public feed after people repeatedly share routes and someone is willing to maintain it. That stage needs moderation, reporting, removal, spam protection, and a review queue for paths that appear restricted, unsafe, or outdated. User submissions must not modify the trusted routing graph automatically. Avoid publishing live locations, habitual schedules, room numbers, or identifying data about minors. Render submitted text safely.

Do not add a full social system merely because it is in the long-term idea. It has a very different maintenance cost from a static planner.

## 12. Editable decisions before implementation

- [ ] Pilot boundary: ____________________
- [ ] Verified public starting points: ____________________
- [ ] Supported daylight time window: ____________________
- [x] Plain TypeScript or React already familiar: **Vite + React + TypeScript** (decided 1 October 2026)
- [ ] Data approach and licence notes: ____________________
- [ ] First five places to verify: ____________________
- [ ] Person responsible for correcting access and price data: ____________________
- [ ] Review cadence during pilot: ____________________
- [ ] Tile provider and deployment host: ____________________
- [ ] First testers and intended test week: ____________________

Recommended defaults to edit (all in `src/core/planner/config.ts`): 12 candidate places, at most 3 scheduled stops, 5-minute buffer, per-person INR budget, 30–90 minutes, no accounts, no tracking, a 3-result maximum, 1.0/1.2 m/s pace, 6 s per metre climbed, a 1.5× rain penalty on uncovered edges when choosing a path, 80% overlap for near-duplicates, and a “last checked” warning after 120 days.

## 13. How to use this file with Codex later

Give Codex this file after editing the decisions. Ask it to implement one milestone at a time, keep the routing core independent of the UI, and show tests and unresolved assumptions at each checkpoint. Have it use clearly labelled fixture data until the real campus dataset is verified.

Do not let placeholder coordinates, invented prices, or fabricated opening hours become production facts. Do not let it expand the project into a backend or AI application without a concrete need. Review what it builds and make sure you can explain the graph, heap, planner, and feasibility checks yourself.

**The first useful milestone is a small program that returns one believable outing and explains why it fits. Build that before polishing the map.** *(Reached on fixture data on 1 October 2026; run `npm run dev` to try the playground. The next real milestone is Week 1: field data.)*
