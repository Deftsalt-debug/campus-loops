# Campus Loops

**Plan a walk around MIT Manipal that fits your time, budget and occasion, and get back in time.**

You choose the occasion (a date, friends, a walking meeting, a study break and more), a start point, how long you have, and a budget. Campus Loops then suggests up to three genuinely different walks. Each one comes with stops, clock times, an estimated spend and a route drawn on the map. You can open any plan in Google Maps, save it to Google My Maps, or share a link.

**Live demo:** [Campus Loops](https://deftsalt-debug.github.io/campus-loops/) · [Release checklist](RELEASE.md)

> ⚠️ **Demo data.** The saved OpenStreetMap snapshot was compared with the live source on 1 October 2026; all 7,099 elements matched. Paths and places haven't been walked or checked in person. Prices, free-stop assumptions and some opening hours are placeholders, and the app labels plans that rely on them. Treat routes as suggestions and check access before you go. See [map provenance and refresh instructions](data/osm/README.md).

---

## What it does

| | |
|---|---|
| **8 occasion modes** | Date · Friends · Catch-up · Walking meeting · Show someone around · Solo reset · Study break · Active walk. Each mode has its own scoring rules, tags it avoids, sensible defaults and (for meetings and study breaks) a two-stop cap. Active walk ranks by time spent walking. |
| **Six campus starts** | Tiger Circle, MIT Central Library, Student Plaza, KMC Greens, MIT Food Court 1 and MIT Food Court 2. Starts are approximate path anchors; entrances have not been surveyed. |
| **Campus stop finder** | Search the catalogue by place name or interests such as quiet, food or coffee, filter by category, and add or remove up to two must-visits. Places with unknown prices or hours remain discoverable but cannot be added for planning. |
| **Honest limits** | Plans enforce your time limit, budget, required stops and the dataset's access rules. They end before the estimated sunset, calculated on your device using NOAA equations, and before your optional *back-by* time, e.g. a hostel in-time. |
| **Return buffer** | Reserve 0–30 minutes within your time limit for delays or getting to class after returning. The default is five minutes, and shared walks preserve custom buffers. Deadlines refresh when you return to a backgrounded tab. |
| **Time at your stops** | Set 0–120 minutes for selected stops, including fractional minutes, or reset to the dataset default. Zero means a free pass-by and does not satisfy a café requirement. Shared custom times remain editable. |
| **Walk comparison** | Compare total time, walking distance, stops, return buffer, spare time, cost and retracing; select a walk directly from the table. |
| **Real routes** | Dijkstra (hand-written binary heap) runs over 485 imported path segments, represented by 390 nodes and 970 directed arcs, with walking times adjusted for hills using SRTM elevation (6 s per metre climbed). A pruned search tries every order of up to three shortlisted stops. |
| **Clear failures** | If nothing fits, it tells you why and gives a number it actually calculated: "needs 36 minutes", "cheapest plan is ₹60", "sunset is at 18:20". It never silently relaxes a limit. |
| **Google Maps** | **Open in Google Maps** gives walking directions through your stops plus shaping points along the route (no API key needed). **KML for Google My Maps** carries the exact line, which then shows up in the Google Maps app under *Saved → Maps*. GPX export works with other apps. **Add to calendar** saves an .ics event with the itinerary and a 10-minute reminder. |
| **Sharing** | The request and route identity live in the link's `#fragment`. Opening a shared link re-checks that route against the current time even if its stops are no longer in the recommendation shortlist. If it no longer fits, the app says so instead of swapping in a different route. A dataset-version mismatch requires a fresh plan. |
| **Saved plans and backups** | Keep up to 12 plans locally. Export a JSON backup and restore it on another device; validated restores merge without replacing existing walks or changing their dataset versions. Opening a saved walk rechecks its route. |
| **Campus field notebook** | Record dated observations about prices, hours or access, then export them for manual review. Up to 100 notes stay in this browser. Observations never automatically change planner data. |
| **Modes for conditions** | *Rain mode* prefers covered paths and schedules sheltered stops unless you explicitly require an unsheltered place, which is flagged. *Avoid steps* excludes paths marked with steps. Stair and cover records in the demo have not been surveyed. |
| **Calibration log** | After a walk, log walking time excluding stops and the return buffer. The log stays on your device, can be exported as JSON, and summarises how accurate the estimates are. Logging does not automatically change future estimates. |
| **Interface** | Responsive (phone List/Map tabs, laptop split view), light and dark themes, a **Show entire route** map control, an interactive dot-grid backdrop with a cursor hotspot and click ripples, spotlight hover on cards, and keyboard and reduced-motion support. |

## Quick start

Use **Node.js 24**. The toolchain supports Node 22 (22.12 or later), Node 24, and Node 26 or later.

```bash
npm ci
npm run dev          # http://localhost:5173
```

At night, sunset blocks new plans. Use **Preview tomorrow 10:00** in the notice, or *More options → Plan as if it's…*.

For a class break, choose your campus start, use **Find a campus stop** to add a must-visit, and set *More options → Back by* and *Return buffer*. A buffer is part of the time you have: a 30-minute gap with a 10-minute buffer leaves at most 20 minutes for walking and stops. If the route cannot fit, change the choices rather than assuming the return deadline has been relaxed.

| Command | What it does |
|---|---|
| `npm run verify` | Lint, typecheck, all unit and invariant tests, production build |
| `npm test` | Vitest only |
| `npm run benchmark` | Repeatable 96-request campus workload, timings and a result digest; compare on the same machine |
| `npm audit --audit-level=high` | Check dependencies for known advisories; also runs in release CI |
| `npm run data:check -- <file>` | Validate a dataset; defaults to the Manipal dataset used by the app. Add `--production` to also refuse demo and placeholder data |
| `npm run data:osm` | Rebuild `src/data/manipal-demo.json` from the saved OSM snapshot (`-- --fetch` to re-download, `-- --elevation` to fill missing heights) |
| `npm run data:geojson -- <file>` | Validate and export a dataset to `out/*.geojson` for a visual check on geojson.io; defaults to the app's Manipal dataset |
| `npm run data:fixture` | Regenerate the synthetic test fixture |
| `?data=fixture` | Add to the app URL to plan on the synthetic grid used by the tests |

## Hosting and map providers

`npm run build` writes a static website to `dist/`. Its relative asset URLs work at the repository's `/campus-loops/` sub-path and on another static host. `npm run preview` serves the production build locally.

GitHub Actions verifies pull requests and deploys successful builds from `main` to Pages. Choose **GitHub Actions** as the Pages source in repository settings. PR checks use a read-only token and cannot cancel a `main` release. Only the deploy job receives Pages write permissions. Dependabot proposes npm and Actions updates; review them before merging.

The repository review on 1 October 2026 found five open Dependabot PRs proposing major updates with their existing checks passing; they were not merged as part of this polish. `main` was unprotected at that checkpoint. Requiring the **verify** job before merges is recommended; repository permissions and protection settings were not changed.

The default map uses OpenStreetMap's public tile server for a small demo. For a broader audience, choose a provider whose terms and capacity fit your traffic. Copy `.env.example` to `.env.local`, then set these values before building:

| Variable | Meaning |
|---|---|
| `VITE_MAP_TILE_URL` | HTTPS XYZ template such as `https://tiles.example.com/{z}/{x}/{y}.png`, or a same-origin `/path/{z}/{x}/{y}.png` template |
| `VITE_MAP_TILE_ATTRIBUTION` | Required plain-text credit for a custom provider; linked OSM data attribution is also included |
| `VITE_MAP_TILE_MAX_ZOOM` | Integer from 1 to 22; default 19 |

For Pages, set the same names under **Settings → Secrets and variables → Actions → Variables**, then rebuild. These Vite values are embedded in public JavaScript. Use only public, domain-restricted provider keys where supported; keep secret credentials on a server. Templates require `{z}`, `{x}` and `{y}`; optional `{s}` and `{r}` are supported, while unknown or incomplete placeholders are rejected before Leaflet loads them. If tile configuration is invalid or the provider is unavailable, the app explains the failure while the itinerary remains usable. Maps need a network connection; no tile prefetching or offline caching is implemented. If hosting at a new domain, update `index.html`'s canonical and Open Graph URLs.

## How it works

```
form ─► plan(dataset, request, now) ─► up to 3 plans ─► list + Leaflet map
              │
              ├─ deadline = min(duration, back-by, sunset, pilot hours)
              ├─ graph: allowed edges (minus steps if avoiding them)
              │         cost = metres / pace + climb × 6 s/m + crossing delay
              ├─ candidates: ≤12 places with known hours and prices that fit the mode
              ├─ Dijkstra legs + pruned depth-first search over 1–3 stops
              ├─ loop home: if the way back retraces the way out, try a different
              │            way home (≤2× the quickest return, still within your limits)
              ├─ rank: occasion fit → (rain: cover) → (active: walking) → less retracing → time fit
              └─ diversity: drop same stop set or >80% shared path
```

`plan()` is a pure function, so the same inputs always give the same output. Everything in `src/core/` is framework-free, and a lint rule enforces that.

`rebuildPlan()` checks the saved stop sequence without depending on the current recommendation shortlist; prefix pruning avoids searching every permutation of the full catalogue. Dataset and share validation reject incompatible identifiers, including dots in place IDs because dots separate stops in generated route IDs. Stored dates require valid calendar dates and explicit timezones, and saved records retain only their documented fields.

| Path | What |
|---|---|
| `src/core/routing/` | Min-heap, Dijkstra (forward and reverse), path reconstruction |
| `src/core/graph/` | Adjacency lists; walking cost with climb and rain weighting |
| `src/core/planner/` | Occasion modes, candidates, search, curated walks, scoring, diversity, explanations, `plan()` / `rebuildPlan()` |
| `src/core/time/` | IST clock, opening windows, sunrise/sunset (NOAA equations) |
| `src/core/export/` | Google Maps URL, KML, GPX, plain-text itinerary |
| `src/core/share.ts` | Versioned, validated share links |
| `src/core/dataset/` | Validation (IDs, geometry, segments, hours, reachability, production rules) |
| `src/storage/` | Saved walks and validated backups, calibration logs, and local field observations |
| `src/ui/` | React components: form, plan cards, Leaflet map, backdrop and effects |
| `scripts/` | OSM importer, validator CLI, GeoJSON export, fixture generator |
| `data/osm/` | Saved OSM snapshot, checksum and acquisition metadata, elevation cache, and provenance notes, so the demo rebuilds offline |
| `tests/` | Unit, behaviour, export, demo-data and invariant tests |

## Data and credits

The importer respects explicit pedestrian access and direction rules, excludes restrictions it cannot evaluate, and prevents restricted segments from connecting otherwise inaccessible components. It parses a conservative subset of OSM opening hours. Explicit closures, unsupported expressions and ambiguous overlapping weekday rules make a stop unavailable; demo placeholder hours are used only when hours are missing. The library and planetarium stops describe their exterior, not admission or opening guarantees. Full caveats and refresh steps are in [data/osm/README.md](data/osm/README.md).

An offline rebuild preserves the snapshot acquisition date. A checksum mismatch stops the import, and the dataset version includes the snapshot date, importer revision and checksum prefix. Refreshed map tiles and a refreshed route dataset are separate things; neither replaces local field verification.

- Map data and the demo dataset: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the **Open Database License (ODbL) 1.0**. `src/data/manipal-demo.json` and `data/osm/` are derived from OSM and stay under the ODbL.
- Map tiles: OpenStreetMap's public tile server, used under its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Choose a dedicated tile provider before wider use.
- Elevation: SRTM 30 m via [OpenTopoData](https://www.opentopodata.org/).
- Google Maps links use the public [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) format. No API key is used or stored.

## Privacy

No accounts, tracking or analytics. Planning runs entirely in your browser. Your map provider sees your IP address and the map area you view. When you open a Google Maps link, Google receives the route points. Shared links contain your start point, route and preferences, so they aren't secret. Saved walks, calibration logs and field notes stay in this browser and are lost when site data is cleared; they leave only when you export them. Saved-walk backups can be restored; notebook exports support manual review. Blocked or full browser storage produces a clear failure. See [SECURITY.md](SECURITY.md) for reporting issues.

## Status and next steps

This is a working demo, not a verified pilot. To make it trustworthy, follow Week 1 of [ROADMAP.md](ROADMAP.md): walk the routes, check access, prices and hours, and record cover and steps, until `npm run data:check -- --production` passes. [MANIFEST.md](MANIFEST.md) explains every part of the project in detail.

The current QA checkpoint passes lint, typechecking, 1,588 tests across 18 files, the production build and structural data validation; the dependency audit reports zero vulnerabilities. All recommended outings include actual walking, even when starting at a café. The production-data gate remains blocked by the fixture marker and placeholders. See [RELEASE.md](RELEASE.md) for current evidence and the distinction from earlier browser baselines.

Three useful MIT Manipal additions for a future verified pilot are:

- **Construction and monsoon closures:** time-bounded restrictions with a named source, checked date and expiry, so the planner avoids affected paths only while the report remains valid.
- **Verified prices and opening hours:** locally checked menus and schedules with review dates, replacing the demo assumptions before making budget or availability promises.
- **Water, toilets and shelter:** surveyed points with entrance/access details and accessibility notes, so students can choose useful stops during hot weather or rain.

These are roadmap suggestions requiring verified local data; they are not live features or monitored feeds.

No licence has been chosen for the code yet. Until one is added, the default is all rights reserved.
