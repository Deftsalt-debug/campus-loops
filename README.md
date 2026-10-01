# Campus Loops

**Plan a walk around MIT Manipal that fits your time, budget and occasion, and get back in time.**

You choose the occasion (a date, friends, a walking meeting, a study break and more), a start point, how long you have, and a budget. Campus Loops then suggests up to three genuinely different walks. Each one comes with stops, clock times, an estimated spend and a route drawn on the map. You can open any plan in Google Maps, save it to Google My Maps, or share a link.

**Live demo:** https://deftsalt-debug.github.io/campus-loops/

> ⚠️ **Demo data.** Paths and places come from an OpenStreetMap snapshot (1 October 2026) and haven't been walked or checked in person. Prices and some opening hours are placeholders, and the app labels every plan that relies on them. Treat routes as suggestions and check access before you go.

---

## What it does

| | |
|---|---|
| **8 occasion modes** | Date · Friends · Catch-up · Walking meeting · Show someone around · Solo reset · Study break · Active walk. Each mode has its own scoring rules, tags it avoids, sensible defaults and (for meetings and study breaks) a two-stop cap. Active walk ranks by time spent walking. |
| **Honest limits** | Plans never break your time limit, budget, required stops or access rules. They end before sunset, which is calculated on your device and matches US Naval Observatory times to within a minute, and before your optional *back-by* time, e.g. a hostel in-time. |
| **Real routes** | Dijkstra (hand-written binary heap) runs over about 500 real path segments, with walking times adjusted for hills using SRTM elevation (6 s per metre climbed). A pruned search tries every order of up to three stops. |
| **Clear failures** | If nothing fits, it tells you why and gives a number it actually calculated: "needs 36 minutes", "cheapest plan is ₹60", "sunset is at 18:20". It never silently relaxes a limit. |
| **Google Maps** | **Open in Google Maps** gives walking directions through your stops plus shaping points along the route (no API key needed). **KML for Google My Maps** carries the exact line, which then shows up in the Google Maps app under *Saved → Maps*. GPX export works with other apps. |
| **Sharing** | The whole plan lives in the link's `#fragment`. Opening a shared link re-checks that exact route against the current time. If it no longer fits, the app says so instead of swapping in a different route. |
| **Modes for conditions** | *Rain mode* allows only sheltered stops and prefers covered paths. *Avoid steps* drops stairs from routing. |
| **Calibration log** | After a walk, log how long it really took. The log stays on your device, can be exported as JSON, and summarises how accurate the estimates are. |
| **Interface** | Responsive (phone List/Map tabs, laptop split view), light and dark themes, an interactive dot-grid backdrop with a cursor hotspot and click ripples, spotlight hover on cards, and keyboard and reduced-motion support. |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

At night, sunset blocks new plans. Use **Preview tomorrow 10:00** in the notice, or *More options → Plan as if it's…*.

| Command | What it does |
|---|---|
| `npm run verify` | Lint, typecheck, all tests (~1,300), production build |
| `npm test` | Vitest only |
| `npm run data:check -- <file>` | Validate a dataset; add `--production` to also refuse demo and placeholder data |
| `npm run data:osm` | Rebuild `src/data/manipal-demo.json` from the saved OSM snapshot (`-- --fetch` to re-download, `-- --elevation` to fill missing heights) |
| `npm run data:geojson -- <file>` | Export a dataset to `out/*.geojson` for a visual check on geojson.io |
| `npm run data:fixture` | Regenerate the synthetic test fixture |
| `?data=fixture` | Add to the app URL to plan on the synthetic grid used by the tests |

## How it works

```
form ─► plan(dataset, request, now) ─► up to 3 plans ─► list + Leaflet map
              │
              ├─ deadline = min(duration, back-by, sunset, pilot hours)
              ├─ graph: allowed edges (minus steps if avoiding them)
              │         cost = metres / pace + climb × 6 s/m + crossing delay
              ├─ candidates: ≤12 places with known hours and prices that fit the mode
              ├─ Dijkstra legs + pruned depth-first search over 1–3 stops
              ├─ rank: occasion fit → (rain: cover) → (active: walking) → less retracing → time fit
              └─ diversity: drop same stop set or >80% shared path
```

`plan()` is a pure function, so the same inputs always give the same output. Everything in `src/core/` is framework-free, and a lint rule enforces that.

| Path | What |
|---|---|
| `src/core/routing/` | Min-heap, Dijkstra (forward and reverse), path reconstruction |
| `src/core/graph/` | Adjacency lists; walking cost with climb and rain weighting |
| `src/core/planner/` | Occasion modes, candidates, search, curated walks, scoring, diversity, explanations, `plan()` / `rebuildPlan()` |
| `src/core/time/` | IST clock, opening windows, sunrise/sunset (NOAA equations) |
| `src/core/export/` | Google Maps URL, KML, GPX, plain-text itinerary |
| `src/core/share.ts` | Versioned, validated share links |
| `src/core/dataset/` | Validation (IDs, geometry, segments, hours, reachability, production rules) |
| `src/ui/` | React components: form, plan cards, Leaflet map, backdrop and effects |
| `scripts/` | OSM importer, validator CLI, GeoJSON export, fixture generator |
| `data/osm/` | Saved OSM snapshot and elevation cache, so the demo rebuilds offline |
| `tests/` | Unit, behaviour, export, demo-data and invariant tests |

## Data and credits

- Map data and the demo dataset: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the **Open Database License (ODbL) 1.0**. `src/data/manipal-demo.json` and `data/osm/` are derived from OSM and stay under the ODbL.
- Map tiles: OpenStreetMap's public tile server, used under its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Choose a dedicated tile provider before wider use.
- Elevation: SRTM 30 m via [OpenTopoData](https://www.opentopodata.org/).
- Google Maps links use the public [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) format. No API key is used or stored.

## Privacy

No accounts, tracking or analytics. Planning runs entirely in your browser. The map tile server sees your IP address and the map area you view. When you open a Google Maps link, Google receives the route points. Shared links contain your start point, route and preferences, so they aren't secret. The calibration log never leaves your device unless you export it.

## Status and next steps

This is a working demo, not a verified pilot. To make it trustworthy, follow Week 1 of [ROADMAP.md](ROADMAP.md): walk the routes, check access, prices and hours, and record cover and steps, until `npm run data:check -- --production` passes. [MANIFEST.md](MANIFEST.md) explains every part of the project in detail.

No licence has been chosen for the code yet. Until one is added, the default is all rights reserved.
