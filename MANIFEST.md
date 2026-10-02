# Campus Loops: project manifest

This is the project guide: what was built, how to run it, how it works, what to trust, and what to do next. Updated **2 October 2026**; dated earlier QA checkpoints remain historical evidence.

- **Repository:** https://github.com/Deftsalt-debug/campus-loops
- **Live site:** https://deftsalt-debug.github.io/campus-loops/ (redeploys automatically on every push to `main`)
- **Local folder:** `~/Desktop/Projects/LoopCampus`

---

## 1. Status at a glance

| Area | State |
|---|---|
| Routing core (heap, Dijkstra, costs, sunset) | ✅ Built and tested |
| Planner (8 occasion modes, limits, ranking, diversity, explanations) | ✅ Built and tested |
| Interface (form, plan cards, Leaflet map, phone and laptop layouts, light/dark, interactive backdrop) | ✅ Built and QA'd in the browser |
| Google Maps hand-off (directions link, KML for My Maps, GPX) | ✅ Built; link checked live in Google Maps |
| Share links that re-check the exact route | ✅ Built and tested |
| Calibration log ("how long did it really take") | ✅ Built (stays on the device) |
| Deployment (GitHub Actions → Pages) | ✅ Set up |
| **Field-verified data** (walk the routes, check prices and hours) | ❌ **Not done.** The app runs on a labelled demo dataset |
| Saved walks and backup/restore | ✅ Local storage, up to 12 walks, validated JSON restore |
| Stop durations and comparison | ✅ Editable 0–120 minute visits; side-by-side route metrics |
| Campus field notebook | ✅ Local observations and export for manual review; no automatic routing changes |
| Community routes | ⏳ Not started (roadmap) |

**Bottom line:** the software is complete for a pilot. The *data* is a demo: real streets and real place names from OpenStreetMap, but prices and some opening hours are placeholders, and nothing has been walked yet.

---

## 2. Run it

```bash
cd ~/Desktop/Projects/LoopCampus
npm install          # first time only
npm run dev          # opens on http://localhost:5173
npm run verify       # lint + typecheck + all tests + production build (run before every push)
```

At night the planner refuses to plan, because it's daylight-only and checks sunset. Click **Preview tomorrow 10:00** in the notice, or set *More options → Plan as if it's…*.

Other commands:

| Command | Use it to |
|---|---|
| `npm run data:check -- src/data/manipal-demo.json` | Validate a dataset (add `--production` to also reject demo and placeholder data) |
| `npm run data:osm` | Rebuild the demo dataset from the saved OSM snapshot |
| `npm run data:osm -- --fetch --elevation` | Re-download OSM and fill missing elevations (network needed; be polite, one run) |
| `npm run data:geojson -- src/data/manipal-demo.json` | Write `out/*.geojson` and drag it onto https://geojson.io to eyeball the network |
| `npm test` | Tests only |
| open `http://localhost:5173/?data=fixture` | Use the synthetic grid dataset the tests use |

---

## 3. Using the app

1. **Pick an occasion.** Choosing one fills in sensible defaults, which you can change:

   | Mode | Looks for | Avoids | Defaults | Max stops |
   |---|---|---|---|---|
   | Date | scenic/view/nature; dessert/cozy/coffee | quick canteens | 60 min · ₹300 · relaxed · café on | 3 |
   | Friends | group/lively; food | – | 60 min · ₹200 · normal | 3 |
   | Catch-up | quiet/conversation; somewhere to sit | lively | 45 min · ₹150 · relaxed | 3 |
   | Walking meeting | quiet/conversation/wifi; seating/coffee | lively, group | 45 min · free · normal | **2** |
   | Show someone around | landmarks/iconic; photo/scenic | – | 90 min · ₹200 · relaxed | 3 |
   | Solo reset | quiet/nature; scenic/shade/seating | lively, group | 45 min · free · relaxed | 3 |
   | Study break | quick/snacks; coffee/seating | – | 45 min · ₹200 · normal · café on | **2** |
   | Active walk | ranks by **time spent walking** | – | 45 min · free · normal | **2** |

   Modes are defined in `src/core/planner/occasions.ts`. Add or tweak one there; each needs a label, a blurb, up to two rules, avoided tags and defaults.
2. **Start and finish at** one of 4 public landmarks: Tiger Circle, MIT Central Library, Student Plaza or KMC Greens.
3. **Time** (30–90 min), **budget per person**, up to **two must-visit places**, and **Include a café**.
4. **More options:** pace (relaxed 1.0 m/s, normal 1.2 m/s), **Back by** (e.g. a hostel in-time), **Avoid steps**, **Rain mode**, **Plan as if it's…** (preview another time).
5. **Results** update live: up to 3 different plans. Hover a card to preview its route on the map, and click to select it. The selected card shows a timeline with clock times, warnings (placeholder prices or hours, steps, old data), and actions.
6. **Actions:** Start in Google Maps · Share (system share sheet or copy link) · Copy text · KML for Google My Maps · GPX · **Add to calendar** (.ics with the itinerary and a 10-minute reminder) · *Walked it? Log the real time*.
7. On a phone, use the **List / Map** switch above the results.

---

## 4. Google Maps: what you get and its limits

| Option | What happens | Accuracy |
|---|---|---|
| **Start in Google Maps** | Opens walking directions: start → your stops (in order) → back to start. Up to three waypoints preserve all planned visits, then add shaping points if space remains. No API key. | The three-waypoint default fits mobile browsers as well as desktop and the Maps app. Google chooses its own paths between points, so its route and times may differ. Use KML/GPX for the exact drawn route. |
| **KML for Google My Maps** | Download the KML, go to https://www.google.com/mymaps → *Create a new map* → *Import* → pick the file. | Exact line, stop pins and descriptions. It then shows up in the Google Maps app under **Saved → Maps**. |
| **GPX** | For other apps (Organic Maps, Strava, Komoot…). | Exact line. |

**Why no Google map embedded in the app?** Google's map SDK needs a Google Cloud API key with billing. The in-app map is Leaflet + OpenStreetMap, which is free and draws our exact route. If you later want a Google basemap, get a Maps JavaScript API key, restrict it to your domain, and swap the map component. Keep the planner untouched.

---

## 5. How the planner works

`plan(dataset, request, now)` in `src/core/planner/plan.ts` is a pure function. The same inputs always give the same output, which is what makes share links and tests reliable.

1. **Deadline** = the earliest of: your duration, your back-by time, **today's sunset** (NOAA equations, matched to the US Naval Observatory within a minute), and the end of pilot hours (06:30–19:00 for the demo).
2. **Graph**: only allowed edges, with stepped edges dropped if Avoid steps is on. Edge time = `metres / pace + metres climbed × 6 s + crossing delay`. Climb comes from SRTM elevation, so uphill is slower than downhill on the same street.
3. **Candidates**: up to 12 places. Places with unknown prices or hours, places closed today, unreachable places, places over budget, and (in rain) unsheltered stops are excluded. They're ranked by the occasion rules.
4. **Search**: Dijkstra between stops (hand-written binary heap), then a depth-first search over every order of 1–3 stops. Branches are pruned the moment one can't fit, using the shortest possible way home as a lower bound, so pruning never removes a valid plan.
4b. **Loop home**: if the quickest way back retraces the way out, the planner also tries a *different way home*. It runs Dijkstra with a ×4 cost on segments already walked, and accepts the result only if it retraces less and takes at most **2×** the quickest return. Both versions are judged under the same hard limits; ranking prefers the loop, and the duplicate rule shows only one. Loop plans have ids starting `l:` (quickest-return plans start `g:`). The rule depends only on the stops, so a shared loop always rebuilds to the same route. Across the demo's six starts and eight modes this cut out-and-back suggestions from about 80% to 40%. The rest are mostly dead-end roads, where no other way home exists.
5. **Ranking**: occasion fit → (rain: covered share) → (Active: walking share) → less retracing → time fit (anything using at least half the time counts as a good fit; no cramming).
6. **Diversity**: a plan is dropped if it has the same stops as one already shown, or shares more than 80% of its path. Showing one plan is fine; the list is never padded.
7. **When nothing fits**: the planner re-runs with one limit lifted only to *report* numbers, e.g. "needs 36 minutes", "cheapest is ₹60". It never relaxes a limit for you.

All tunable numbers (pace, climb cost, rain penalty, buffer, caps) are in `src/core/planner/config.ts`.

---

## 6. The data: what's real and what isn't

**Demo dataset:** `src/data/manipal-demo.json`, built by `scripts/import-osm.ts` from `data/osm/raw.json`, an OpenStreetMap snapshot of the MIT campus and Tiger Circle area downloaded on 1 October 2026.

| Item | Source | Trust |
|---|---|---|
| Paths (390 junctions, 485 segments) | OSM ways | Real geometry, **not walked**. Recorded restricted paths and disconnected segments are omitted; missing restrictions still need a local survey. |
| Elevation | SRTM 30 m (OpenTopoData), cached in `data/osm/elevation.json` | Rough: ±a few metres of noise per point |
| Places (18) | OSM features chosen by hand in `PLACES` in the import script | Real names and locations. Each is attached to the nearest path node (≤42 m away), not a surveyed entrance |
| Opening hours | Supported simple OSM `opening_hours`; **placeholders** only when absent | Unsupported explicit hours leave a stop unavailable. Free-stop and outdoor availability assumptions are also labelled placeholders. |
| Prices | **Placeholders** (per-person ranges) | Each plan says so |
| Covered paths, steps | Not tagged in OSM here | Rain mode currently relies only on sheltered *stops*; Avoid steps has nothing to remove yet |

The synthetic fixture (`src/data/fixtures/pilot-fixture.json`, made-up "Fixture Café A" grid) is only for tests.

The current app has six starts, including Food Court 1 and Food Court 2, plus searchable campus stops and a selectable return buffer. Snapshot checksum, live-source comparison and refresh instructions are in [data/osm/README.md](data/osm/README.md). The library and planetarium stops refer to their exteriors; entry is not promised.

**Production guard:** `npm run data:check -- <file> --production` fails on demo data and on any placeholder hours or prices. Use it before you call anything "verified".

### Making it real (roadmap Week 1)
1. Walk the area. For each path, note steps, cover and any restrictions. For each place, note its real entrance, price range and opening hours, and the date you checked.
2. Edit the `PLACES` list in `scripts/import-osm.ts` (or the generated JSON). Set `hoursSource`/`spendSource` to `'survey'` once checked.
3. Fix or add OSM data upstream if you can. It helps everyone, and the next `--fetch` will pick it up.
4. Set `isFixture: false` only after completing the field verification, then require `npm run data:check -- --production` to pass before claiming verified routes.

---

## 7. Project map

```
src/core/            framework-free logic (lint blocks React imports here)
  routing/           minHeap.ts, dijkstra.ts, path.ts
  graph/             buildGraph.ts, edgeCost.ts
  planner/           occasions.ts, config.ts, candidates.ts, search.ts, curated.ts,
                     score.ts, diversity.ts, explain.ts, plan.ts (+ rebuildPlan)
  time/              clock.ts (IST), sun.ts (sunrise/sunset)
  export/            googleMaps.ts, files.ts (KML, GPX, text)
  dataset/           validate.ts, load.ts
  geo.ts, share.ts, identifiers.ts, calibration.ts, types.ts
src/ui/              OutingBuilder (sentence + tray), WalkChooser, WalkDetail, MapDock + RouteMap (Leaflet),
                     Drawer, AboutPanel, SavedWalks, FieldNotebook, PlanComparison, Backdrop, effects, format
src/storage/         calibrationLog.ts, savedPlans.ts, fieldNotes.ts (localStorage, fail safely)
src/data/            manipal-demo.json, fixtures/pilot-fixture.json
scripts/             import-osm.ts, osm-rules.ts, validate-data.ts, export-geojson.ts, build-fixture.ts
data/osm/            raw OSM snapshot, provenance + elevation cache (ODbL)
tests/               22 files; see RELEASE.md for the latest QA checkpoint
.github/workflows/   deploy.yml (verify → build → GitHub Pages)
ROADMAP.md           product plan, decisions, weekly checklists
```

---

## 8. Quality assurance performed

Current automated and browser results are recorded in [RELEASE.md](RELEASE.md). The following is the original implementation baseline, retained for context.

**Original automated baseline:** 1,314 tests across 10 files, all passing, plus lint, typecheck and production build (`npm run verify`). Highlights:
- Dijkstra compared against brute force on 200 random graphs.
- A matrix of **1,152 requests** (2 starts × 4 durations × 3 budgets × 8 modes × rain on/off × 3 times of day). For every plan it checks that the route is continuous and closed, totals add up, nothing breaks a hard limit, the mode's stop cap holds, and **the share link rebuilds the identical plan**.
- Every start × every mode on the real demo data.
- Sunset checked against USNO on two dates; Google Maps URLs checked against the documented format (≤9 waypoints, ≤2,048 characters); hostile share links rejected; KML/GPX escaping.

**Manual, two passes in a real browser:**
- *Pass 1* found and fixed: the map opening zoomed far out (it now frames the places); route lines drawn offset from their markers after the map's zoom animation (they're now re-projected after every move, and alignment was verified in the DOM); the map re-flying on every hover or clock tick (it now fits only when the selection changes); the Central Library start snapping onto a private road (anchors now snap only to walkable ways); a heading nested inside a button (accessibility).
- *Pass 2* found and fixed: re-planning on every hover while in preview mode (performance); the calibration count not refreshing; two map instances on phones (now one).
- *Final check on the live site* found and fixed: two results could share a name. Generated plans now include their stops ("Walk with a café stop · Sugar Plum (via Fountain near Tiger Circle)"), which keeps names unique and stable for share links. A test now enforces this for every start and mode.
- Checked: desktop dark mode, phone (375 px) light mode with no horizontal scroll, List/Map tabs, shared link → "Showing a shared plan", a bogus plan id → "no longer fits" + *Plan again*, after-sunset → preview buttons, Google Maps link opening the right walking route, and the production build's assets loading under the `/campus-loops/` sub-path.

---

### Third review — 1 October 2026 (evening)

I re-checked the whole repository, including four commits made in between (saved walks, configurable tiles, input-shape validation, OSM import rules, an error boundary, a web manifest). Baseline: 1,527 tests green, CI green, zero audit findings. A content sweep of 144 real requests (6 starts × 8 modes × 3 times of day) found three product problems, all now fixed with regression tests:

- **Mode defaults that never worked.** Study break (30 min, ₹100, café on) failed 18 of 18 times; walking meeting and solo reset failed from some starts by 1–7 minutes. New defaults: meeting 45 min, solo 45 min, study break 45 min at ₹200. A test now requires every mode's defaults to find a walk from every start at midday. The one documented exception is a study break starting *at* Food Court 2, where the nearest food is the place you're standing in.
- **"Loops" that weren't.** 80% of suggestions were out-and-back. The new *loop home* step (§5, 4b) brings that to 40%. Worst-case planning time stayed at about 37 ms.
- **Pointless stops.** Starting at Student Plaza could suggest "walk to Student Plaza". Optional stops with a round trip under 2 minutes are now skipped; a must-visit still works.

Also added **Add to calendar** (.ics, RFC 5545: UTC times, escaping, 75-octet line folding, a 10-minute reminder), and moved CI to the Node 24 versions of the GitHub actions (checkout v7, setup-node v7, upload-pages-artifact v5, deploy-pages v5).

Browser QA: the loop route line starts and ends on the start pin and passes through the stop pin (0 px error, measured in the DOM); every mode's defaults return walks in the UI; mode keyboard navigation wraps; no unlabeled controls, duplicate ids or console errors; no horizontal overflow and no small touch targets at 360 px; a reloaded shared link reopens as "checked again just now".

## 9. Deployment

- `.github/workflows/deploy.yml` runs on every push to `main`: `npm ci` → `npm run verify` → demo data check → upload `dist/` → deploy to GitHub Pages. Pull requests run the checks without deploying.
- `vite.config.ts` uses `base: './'`, so the build works at any sub-path.
- To redeploy, push to `main`, or use *Actions → Test and deploy → Run workflow*.
- If Pages ever shows 404: open *Settings → Pages* and make sure **Source = GitHub Actions**.

---

## 10. Privacy, licences, obligations

- **No accounts, analytics or tracking.** Planning runs in the browser. The OSM tile server sees visitors' IP addresses and the map areas they view. Google sees route points when someone opens a Google Maps link. Share links aren't secret.
- **OpenStreetMap data is ODbL.** The demo dataset and `data/osm/` are derived databases: keep the attribution (it's in the footer, README, KML and GPX) and share any changes to the data under the ODbL.
- **OSM tile server:** fine for a small pilot, but its [usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids heavy use. Switch providers (e.g. MapTiler, Stadia, or self-hosted) before wider launch: set the `VITE_MAP_TILE_*` build variables described in the README.
- **Code licence:** none chosen yet, so it's all rights reserved by default. If you want others to reuse it, add a `LICENSE` (MIT is common for student projects).

---

## 11. Known limitations (be honest about these)

1. The data is unverified (see §6). The banner says so, and plans flag placeholders.
2. Covered paths and steps aren't mapped in OSM here, so rain mode and avoid steps are weaker than designed until surveyed.
3. Elevation is 30 m SRTM: good enough to make hills cost something, but noisy on short edges.
4. Places are anchored to the nearest path point, not their real entrance.
5. There's no road-crossing delay yet (`delaySeconds` is 0 on all demo edges).
6. The Google Maps link approximates our route; the KML is exact.
6b. About 40% of suggestions are still out-and-back, because many campus roads are dead ends in the map data and no reasonable different way home exists.
7. Planning is limited to today and 30–90 minutes; there's no future-date planning beyond the preview tool.
8. Saved walks and field notes are local to the browser. Export a backup before clearing site data; saved-walk backups can be restored, while field notes export for manual review.

---

## 12. Suggested next steps (in order)

1. **Validate the need:** show the live link to 5 students and ask them to pick a plan for a real outing (roadmap §1).
2. **Field-check 3 routes** from Tiger Circle and Student Plaza: time them, then log the times in the app's calibration log.
3. **Replace placeholders** for the 5 most-used places (prices, hours); set their sources to `'survey'`.
4. **Survey cover and steps** on the main campus paths so rain mode and avoid steps have real effect.
5. Add road-crossing delays at the highway junctions near Tiger Circle.
6. Choose a tile provider and a code licence.
7. After field verification, consider curated "favourite walks" from students (roadmap §11). Saved walks and backup/restore are already available.
