# Campus Loops

**Plan a walk around MIT Manipal that fits your time, budget and occasion, and get back in time.**

You choose the occasion (a date, friends, a walking meeting, a study break and more), a start point, how long you have, and a budget. Campus Loops then suggests up to three genuinely different walks. Each one comes with stops, estimated clock times and spend, and a route drawn on a saved campus path overview. Open a venue in Google Maps to check its current listing, send an itinerary to Google Maps for navigation, export it to Google My Maps, or share a link.

**Live demo:** [Campus Loops](https://deftsalt-debug.github.io/campus-loops/) · [Release checklist](RELEASE.md)

> ⚠️ **Saved demo data, not live venue information.** Walking and visit times are estimates. Paths, locations and opening hours come from a dated OpenStreetMap snapshot and demo assumptions; prices, free-stop assumptions and some hours are placeholders. Google Maps links let you check current listings and choose a matching venue, but do not update this planner automatically or guarantee that a venue is open. The source comparison on 1 October 2026 matched all 7,099 saved elements; it did not verify the campus in person. Check access and venue details before you go. See [map provenance and refresh instructions](data/osm/README.md).

---

## What it does

| | |
|---|---|
| **8 occasion modes** | Date · Friends · Catch-up · Walking meeting · Show someone around · Solo reset · Study break · Active walk. Each mode has its own scoring rules, tags it avoids, sensible defaults and (for meetings and study breaks) a two-stop cap. Active walk ranks by time spent walking. |
| **Six campus starts** | Tiger Circle, MIT Central Library, Student Plaza, KMC Greens, MIT Food Court 1 and MIT Food Court 2. Starts are approximate path anchors; entrances have not been surveyed. |
| **Campus stop finder** | Search the catalogue by place name or interests such as quiet, food or coffee, filter by category, and add or remove up to two must-visits. Places with unknown prices or hours remain discoverable but cannot be added for planning. |
| **Honest limits** | Plans apply your time limit, budget, required stops and the dataset's access rules to their estimates. They end before the estimated sunset, calculated on your device using NOAA equations, and before your optional *back-by* time, e.g. a hostel in-time. |
| **Return buffer** | Reserve 0–30 minutes within your time limit for delays or getting to class after returning. The default is five minutes, and shared walks preserve custom buffers. Deadlines refresh when you return to a backgrounded tab. |
| **Time at your stops** | Set 0–120 minutes for selected stops, including fractional minutes, or reset to the dataset default. Zero means a free pass-by and does not satisfy a café requirement. Shared custom times remain editable. |
| **Walk comparison** | Compare total time, walking distance, stops, return buffer, spare time, cost and retracing; select a walk directly from the table. |
| **Saved campus routes** | Dijkstra (hand-written binary heap) runs over 485 imported path segments, represented by 390 nodes and 970 directed arcs, with walking times adjusted for hills using SRTM elevation (6 s per metre climbed). A pruned search tries every order of up to three shortlisted stops. |
| **Clear failures** | If nothing fits, it tells you why and gives a number it actually calculated: "needs 36 minutes", "cheapest plan is ₹60", "sunset is at 18:20". It never silently relaxes a limit. |
| **Google Maps** | Venue links search Google Maps for the place name and campus area so you can check the matching listing's hours, entrance and location. These are external links, not a live Places feed. **Start in Google Maps** preserves your stops within a three-waypoint limit that also works in mobile browsers; spare slots add route-shaping points (no API key needed). Google chooses its own paths. **KML for Google My Maps** carries the exact line, which then shows up in the Google Maps app under *Saved → Maps*. GPX export works with other apps. **Add to calendar** saves an .ics event with the itinerary and a 10-minute reminder. |
| **Sharing** | The request and route identity live in the link's `#fragment`. Opening a shared link re-checks that route against the current time even if its stops are no longer in the recommendation shortlist. If it no longer fits, the app says so instead of swapping in a different route. A dataset-version mismatch requires a fresh plan. |
| **Saved plans and backups** | Keep up to 12 plans locally. Export a JSON backup and restore it on another device; validated restores merge without replacing existing walks or changing their dataset versions. Opening a saved walk rechecks its route. |
| **Campus field notebook** | Record dated observations about prices, hours or access, then export them for manual review. Up to 100 notes stay in this browser. Observations never automatically change planner data. |
| **Modes for conditions** | *Rain mode* prefers covered paths and schedules sheltered stops unless you explicitly require an unsheltered place, which is flagged. *Avoid steps* excludes paths marked with steps. Stair and cover records in the demo have not been surveyed. |
| **Calibration log** | After a walk, log walking time excluding stops and the return buffer. The log stays on your device, can be exported as JSON, and summarises how accurate the estimates are. Logging does not automatically change future estimates. |
| **Interface** | A three-step flow: describe the outing as one sentence, choose a walk, head out. One persistent map (beside the panel on laptops, inline and expandable to full screen on phones) is linked both ways with the list and itinerary. Secondary tools live in a slide-in drawer. Light and dark themes, an interactive dot-grid backdrop, and full keyboard and reduced-motion support. See [How the interface works](#how-the-interface-works). |

## How the interface works

User testing found the previous layout cluttered, with no clear order of events, and the map slow to respond to buttons. The interface is now organised around what the app is for: **describe → choose → go**.

1. **Your outing.** One sentence, with every underlined phrase editable: *Out **with friends** from **Tiger Circle** for **60 min**, spending **up to ₹200**.* A phrase opens a small editor in a tray beneath it, which closes when you pick and returns focus to the phrase. A row below holds **Café stop**, **Must-visit** (search, add, set stop time) and **Options** (pace, back-by, buffer, steps, rain, preview). Options shows a count and a one-line summary of anything changed from the occasion's defaults, so no setting is hidden.
2. **Choose a walk.** Compact cards, each with a miniature of its route's shape. Hovering or focusing a card previews its route on the map; hovering a line on the map highlights its card. **Compare** opens the comparison table in place.
3. **Head out.** The chosen walk's timeline, then one primary action, **Start in Google Maps**, with Share, Save and Copy beside it. Hovering a stop highlights its pin; the pin button pans the map to it (and, on phones, brings the map into view). Clicking a pin highlights its row. Exports (KML, GPX, calendar) and walk logging are tucked into disclosures.

Saved walks, the field notebook, data provenance, privacy and the calibration log are in a drawer (the bookmark and menu buttons, or **Demo** for data notes). It slides in from the right on laptops and up from the bottom on phones. Its header stays visible while content scrolls. Touch controls have 44 px targets, editable fields use at least 16 px text, and the panel, drawer and expanded map respect device safe areas.

**Motion explains change.** Tokens in `src/styles.css` (`--t1`/`--t2`/`--t3`, `--ease-out`, `--ease-spring`) drive every transition. Things that open slide and fade in; chosen things pop; a newly selected route draws itself from start to finish after the camera flies to it, and its pins pop in in order. While new walks are worked out, a thin bar runs along the map and old routes dim, so a press is always acknowledged. Reduced-motion turns all of it off, including map flights.

**Responsiveness.** There is exactly one Leaflet map for the life of the page; crossing the phone/laptop breakpoint never rebuilds it. Selecting a walk commits the card first and renders the itinerary and map in a deferred pass. The dot-grid backdrop is a CSS pattern with compositor-only hotspot and ripple layers; the old full-screen canvas was re-rasterised every frame and was the main source of map jank. On phones, one finger scrolls the page past the inline map (two fingers move it, or expand it to full screen).

## Quick start

Use **Node.js 24**. The toolchain supports Node 22 (22.12 or later), Node 24, and Node 26 or later.

```bash
npm ci
npm run dev          # http://localhost:5173
```

At night, sunset blocks new plans. Use **Preview tomorrow 10:00** in the notice, or *Options → Plan as if it's…*.

For a class break, choose your campus start, open **Must-visit** and search campus places to add a required stop, and set *Options → Back by* and *Return buffer*. A buffer is part of the time you have: a 30-minute gap with a 10-minute buffer leaves at most 20 minutes for walking and stops. If the route cannot fit, change the choices rather than assuming the return deadline has been relaxed.

| Command | What it does |
|---|---|
| `npm run verify` | Lint, typecheck, all unit and invariant tests, production build |
| `npm test` | Vitest only |
| `npm run benchmark` | Repeatable 96-request campus workload, timings and a result digest; compare on the same machine |
| `npm audit --audit-level=moderate` | Check dependencies for known advisories; also runs in release CI |
| `npm run data:check -- <file>` | Validate a dataset; defaults to the Manipal dataset used by the app. Add `--production` to also refuse demo and placeholder data |
| `npm run data:osm` | Rebuild `src/data/manipal-demo.json` from the saved OSM snapshot (`-- --fetch` to re-download, `-- --elevation` to fill missing heights) |
| `npm run data:geojson -- <file>` | Validate and export a dataset to `out/*.geojson` for a visual check on geojson.io; defaults to the app's Manipal dataset |
| `npm run data:fixture` | Regenerate the synthetic test fixture |
| `?data=fixture` | Add to the app URL to plan on the synthetic grid used by the tests |

## Hosting and map providers

`npm run build` writes a static website to `dist/`. Planning runs in the browser; the app needs no server, database, paid map API or API key. Its relative asset URLs work at the repository's `/campus-loops/` sub-path and at a host's root. Shared plans use URL fragments (`#…`), so no server-side routing or catch-all rewrite is required. `npm run preview` serves the production build locally.

### Vercel

Import this repository into Vercel with **Root Directory = the repository root** (leave it unset, or use `.`), **Framework Preset = Vite**, and **Node.js Version = 24.x**. The committed `vercel.json` sets **Install Command = `npm ci`**, **Build Command = `npm run build`**, and **Output Directory = `dist`**. No environment variables are required for the default app. An eligible personal project can use Vercel Hobby within its limits; the app uses no serverless functions or paid map service. Run `npm run verify` before publishing; Vercel's configured build does not run the full test suite.

### GitHub Pages

Choose **Settings → Pages → Build and deployment → Source = GitHub Actions**. The existing workflow uses Node 24, verifies pull requests, and deploys successful builds from `main` to Pages at `https://<owner>.github.io/campus-loops/`. It can also be triggered manually on `main`. PR checks use a read-only token and cannot cancel a `main` release; only the deploy job receives Pages write permissions. GitHub Pages supports this static build without a backend or API keys. Dependabot proposes npm and Actions updates; review them before merging.

Both hosting options serve the same build. After deployment, check the public URL, reopen a shared walk and check Google Maps links on a phone. Configuration and local build checks do not establish that a deployment has been published. If hosting at a new domain, update `index.html`'s canonical and Open Graph URLs. Saved walks remain in the browser for the domain where they were created; use a backup to move them to a different host.

### Map display and current venue details

The default map draws the saved campus path network, start points and route directly in Leaflet. It makes no external tile requests and needs no provider account. This overview helps compare routes; it is not a live street map and does not make the saved paths or locations current. Google Maps venue links open the external listing search for current details, and **Start in Google Maps** hands navigation to Google. Google chooses its own paths, and a matching listing still needs checking. No Google Places, Google Maps JavaScript, Bing or other paid API is called; the app does not fetch live opening hours, prices, closures or venue updates.

For an optional background street map, copy `.env.example` to `.env.local` and configure a provider whose terms and capacity fit your traffic before building:

| Variable | Meaning |
|---|---|
| `VITE_MAP_TILE_URL` | Leave empty for the saved path overview. To add tiles, use an HTTPS XYZ template such as `https://tiles.example.com/{z}/{x}/{y}.png`, or a same-origin `/path/{z}/{x}/{y}.png` template. |
| `VITE_MAP_TILE_ATTRIBUTION` | Required plain-text credit for a custom provider; linked OSM data attribution is also included. |
| `VITE_MAP_TILE_MAX_ZOOM` | Integer from 1 to 22; default 19. |

For Pages, set the same names under **Settings → Secrets and variables → Actions → Variables**; for Vercel, use **Project Settings → Environment Variables**, then rebuild. Remove an existing `VITE_MAP_TILE_URL` setting to use the default tile-free overview. These Vite values are embedded in public JavaScript. Use only public, domain-restricted provider keys where supported; keep secret credentials out of these values. Templates require `{z}`, `{x}` and `{y}`; optional `{s}` and `{r}` are supported, while unknown or incomplete placeholders are rejected before Leaflet loads them. Invalid or unavailable custom tiles produce an explanation while the saved path overview and itinerary remain usable. External maps need a network connection; no tile prefetching, offline tile download or guaranteed offline startup is implemented.

The 2 October 2026 audit upgrades TypeScript to 7.0.2 and Node typings to 24.19.1, matching the recommended Node 24 runtime. GitHub Actions use verified immutable commit pins; Dependabot can propose pin updates. The dependency advisory gate rejects moderate or higher findings. `main` was unprotected at the audit checkpoint; requiring the **verify** job before merges is recommended. Repository permissions and protection settings were not changed.

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
| `src/ui/` | React components: outing builder, walk chooser and detail, map dock and Leaflet map, drawer, backdrop and effects |
| `scripts/` | OSM importer, validator CLI, GeoJSON export, fixture generator |
| `data/osm/` | Saved OSM snapshot, checksum and acquisition metadata, elevation cache, and provenance notes, so the demo rebuilds offline |
| `tests/` | Unit, behaviour, export, demo-data and invariant tests |

## Data and credits

The importer respects explicit pedestrian access and direction rules, excludes restrictions it cannot evaluate, and prevents restricted segments from connecting otherwise inaccessible components. It parses a conservative subset of OSM opening hours. Explicit closures, unsupported expressions and ambiguous overlapping weekday rules make a stop unavailable; demo placeholder hours are used only when hours are missing. The library and planetarium stops describe their exterior, not admission or opening guarantees. Full caveats and refresh steps are in [data/osm/README.md](data/osm/README.md).

An offline rebuild preserves the snapshot acquisition date. A checksum mismatch stops the import, and the dataset version includes the snapshot date, importer revision and checksum prefix. Refreshed map tiles and a refreshed route dataset are separate things; neither replaces local field verification.

- Map data and the demo dataset: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the **Open Database License (ODbL) 1.0**. `src/data/manipal-demo.json` and `data/osm/` are derived from OSM and stay under the ODbL.
- Map display: the default saved path overview uses no external tile service. If you configure tiles, follow that provider's attribution and usage terms. OpenStreetMap public tiles, if selected, remain subject to their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- Elevation: SRTM 30 m via [OpenTopoData](https://www.opentopodata.org/).
- Google Maps links use the public [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) format. No API key is used or stored.

## Privacy

No accounts, tracking or analytics. Planning runs entirely in your browser. The default path overview makes no external map requests. If you configure a tile provider, it sees your IP address and the map area you view. When you open a Google Maps link, Google receives your place search or route points. Shared links contain your start point, route and preferences, so they aren't secret. Saved walks, calibration logs and field notes stay in this browser and are lost when site data is cleared; they leave only when you export them. Saved-walk backups can be restored; notebook exports support manual review. Blocked or full browser storage produces a clear failure. See [SECURITY.md](SECURITY.md) for reporting issues.

## Status and next steps

This is a working demo, not a verified pilot. To make it trustworthy, follow Week 1 of [ROADMAP.md](ROADMAP.md): walk the routes, check access, prices and hours, and record cover and steps, until `npm run data:check -- --production` passes. [MANIFEST.md](MANIFEST.md) explains every part of the project in detail.

The 2 October 2026 repository audit and mobile follow-up pass lint, typechecking, 1,829 tests across 25 files, the production build and structural data validation; the dependency audit reports zero vulnerabilities. An additional 768-scenario campus matrix independently replays route timing, budgets and exact shared-plan rebuilding. All recommended outings include actual walking, even when starting at a café. The production-data gate remains blocked by the fixture marker and placeholders. See [RELEASE.md](RELEASE.md) for current evidence and the distinction from earlier browser baselines.

Three useful MIT Manipal additions for a future verified pilot are:

- **Construction and monsoon closures:** time-bounded restrictions with a named source, checked date and expiry, so the planner avoids affected paths only while the report remains valid.
- **Verified prices and opening hours:** locally checked menus and schedules with review dates, replacing the demo assumptions before making budget or availability promises.
- **Water, toilets and shelter:** surveyed points with entrance/access details and accessibility notes, so students can choose useful stops during hot weather or rain.

These are roadmap suggestions requiring verified local data; they are not live features or monitored feeds.

No licence has been chosen for the code yet. Until one is added, the default is all rights reserved.
