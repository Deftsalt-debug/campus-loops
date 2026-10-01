# Public demo release

Campus Loops can be released as a **public demo**. Its planner runs locally and the repository deploys a static build. The Manipal dataset has not been field-checked: path geometry and place names come from OSM, while prices, free-stop assumptions, outdoor availability and some hours are placeholders. Publishing the software does not make those observations verified.

The current dataset is `manipal-demo-2026-10-01-r2-898391fa`: 390 nodes, 485 path segments, 970 directed arcs, 18 places and six starts. Food Court 1 and Food Court 2 join Tiger Circle, MIT Central Library, Student Plaza and KMC Greens. The original snapshot matched all 7,099 elements in a live OSM comparison on 1 October 2026; its newest element edit was 2 September 2026. This confirms the source comparison, not the condition of campus paths. See [map provenance](data/osm/README.md).

## Before publishing a build

Run with Node.js 24 and the committed lockfile:

```bash
npm ci
npm run verify
npm run data:check -- src/data/manipal-demo.json
npm audit --audit-level=high
```

Use `npm run preview` to check the build, including loading it under the `/campus-loops/` sub-path. Verify phone and desktop layouts, keyboard navigation, light/dark themes, route selection, Map/List tabs, **Show entire route**, the after-sunset preview, a valid shared plan, an invalid shared plan, saving/reopening/removing plans, Google Maps, KML/GPX exports, and logging/exporting/clearing a real walking time. Search the campus catalogue, add two must-visits, remove one and check unavailable places; try a short class gap with different return buffers. Check that returning to a backgrounded tab refreshes the departure/deadline. Block the tile host once to check the map's failure message and usable itinerary. Test with storage blocked to check that Save/logging reports failure.

The GitHub workflow runs automated checks before uploading `dist/`. Deployment occurs only from `main`; pull requests and workflow runs from other branches cannot publish. Set **Settings → Pages → Source = GitHub Actions**. Require the **verify** job on pull requests in branch protection. Enable Dependabot alerts and private vulnerability reporting in repository settings.

At the 1 October 2026 repository review, `main` was unprotected. Five open Dependabot PRs proposed major updates and had passed their existing checks; they were not merged as part of this release work. Passing those checks alone does not establish compatibility for a major upgrade. Review and test them separately. Repository permissions and branch protection were not changed.

For traffic beyond a small demo, configure a suitable tile provider as described in the README. The `VITE_MAP_TILE_*` repository variables are read at build time. Provider credentials embedded in those variables are public. The app has no offline tile download feature.

Before publishing at a different URL, update the canonical and Open Graph URLs in `index.html`. The web manifest provides a home-screen shortcut; it does not provide offline maps or guarantee offline startup. No code licence has been selected; choosing one remains the owner's decision. OSM-derived data retains its existing ODbL attribution.

## Before calling the routes verified

1. Walk the advertised routes and check public access, actual entrances, crossings, steps, and cover. Rain mode and Avoid steps depend on that recorded data.
2. Check opening hours and current per-person prices, record the source and date, and replace every placeholder.
3. Collect walk times, review the exported calibration logs, and adjust planning assumptions from evidence.
4. Mark the dataset as non-fixture only after the observations support it, and run the exact dataset through the production validator:

   ```bash
   npm run data:check -- src/data/manipal-demo.json --production
   ```

The current demo is expected to fail this last check. Passing structural validation alone does not establish real-world access, price accuracy, accessibility, or safety. Keep the demo label until the field work is complete.

## Rolling back

Revert the faulty change through a pull request or restore the last known good commit on `main` using the team's normal Git process. The workflow rebuilds and publishes that version after verification. Saved plans reopen against the deployed dataset and current time; a route that no longer fits shows a failure instead of silently substituting another walk. Local data is not a backup and is not migrated between devices or domains.

## Current automated verification — 1 October 2026

- `npm run verify`: lint and TypeScript checks pass, **1,524 tests pass across 17 files**, and the production build passes. The dependency audit reports **zero vulnerabilities**.
- Structural validation of the regenerated Manipal dataset reports **zero errors**. Production validation correctly rejects the fixture marker and **33 placeholder hours/price values**; the routes are not a verified production pilot.
- Saved-route reconstruction now checks the requested sequence independently of recommendation ranking. A feasible saved walk remains available when another stop enters the shortlist; closed or infeasible saved walks are rejected rather than replaced. An independent sweep rebuilt 172 recommendations across the current starts, occasion modes and rain settings to exactly one identical plan at the same departure time, with no failures.
- Dataset/share identifiers cannot ambiguously combine `a` plus `b` with a place named `a.b`; place IDs cannot contain the route separator. Empty routing datasets are rejected. Saved plans and calibration records reject impossible dates and timestamps without a timezone, retain supported existing ISO records, and discard undocumented fields.
- Catalogue tests cover name/category/interest search, unknown details, adding/removing/replacing must-visits and preserving both slots. A real planning scenario verifies that a chosen stop fits a 30-minute class gap with a 10-minute buffer, while a 20-minute buffer correctly leaves no feasible plan.
- Importer tests cover pedestrian access precedence, forward and reverse access, conditional restrictions, pedestrian exceptions to one-way tags, private barriers, weekday mapping, invalid/overnight/overlapping hours, and explicit closures. Unsupported supplied hours remain unavailable; only missing hours use labelled demo assumptions. The snapshot checksum is tied to the dataset version.
- Map configuration tests reject unsupported or incomplete placeholders before map initialization. The map includes a route refit control; occasion selection supports Home/End, and calibration instructions distinguish walking time from stops and buffers without promising automatic adjustment.

## Current browser verification — 1 October 2026

Checked the built app with the six-start dataset using the in-app browser, separately from the development server:

| Scenario | Observed result |
|---|---|
| Food Court 1 to the library exterior, 45-minute allowance, back by 10:40, 10-minute buffer | Returns by 10:22, retains the buffer, costs zero under the explicitly labelled demo assumptions. |
| Same request with a 20-minute buffer | Rejects the outing: the shortest suitable plan needs 43 minutes, beyond the 40-minute deadline. |
| Back-by time 09:40 with departure at 10:00 | Shows an already-passed deadline and offers no route. Native time-editor input updates the shared link correctly. |
| Saved route, reload, shared link | Preserves the exact stop sequence, deadline and buffer; the saved indicator survives reload. |
| Copy itinerary; log 20 walking minutes; clear the test log | Copy feedback appears, the local log count changes from 0 to 1, and clearing restores 0. |
| Map and layout | Map tiles and route markers render; Show entire route refits the selected walk. Mobile Map/Itineraries tabs switch by click and arrow key. Only one map instance is mounted. |
| Responsive widths | At 320×740, 360×800, 844×390 and 1280×900, the page has no horizontal overflow and form controls remain within the viewport. Dark appearance was visually inspected. |

Development-browser checks also exercised campus search by library/food, two-stop capacity, removing a stop, and safe recovery from a link to the previous dataset version. The production browser reported no warning or error logs in the exercised flows. Screenshots are local generated artifacts in `out/current-qa/`. This pass does not claim a fresh light-theme, physical-phone, denied-storage, tile-outage, downloaded-file or Google My Maps import check; related automated regressions and earlier baseline evidence are listed separately.

The current build's compressed main JavaScript is approximately 101.1 KB, main CSS 4.4 KB, demo data 41.9 KB and separately loaded map JavaScript 43.4 KB. These checks do not replace local field validation or successful deployment verification.

## Previous browser, export and performance baseline

The following evidence was recorded earlier on 1 October 2026, **before this polish and the six-start dataset revision**. It is retained as a regression baseline and is not a claim that the current build has repeated every check:

- The previous build loaded and reconstructed a shared walk at `/campus-loops/`. Browser checks covered all eight occasions, invalid duration/budget inputs, a passed back-by time, saved-walk reopening and reload, outdated data links, preserved custom stop times and buffers, copy feedback, and calibration save/clear.
- Earlier layout checks at 320×740, 360×800, 844×390 and 1280×900 found no page overflow or form controls extending beyond the viewport. Mobile tabs supported arrow-key switching and hid the inactive panel. Light and dark views were inspected.
- A previous separate build with an unavailable tile host showed a retry notice while retaining route lines, attribution and the itinerary. A missing map-library chunk offered a reload action.
- The earlier export check generated 74 demo itineraries and parsed all 148 GPX/KML documents with Python's XML parser; every document was valid XML.
- The previous local Node benchmark over 320 requests across four starts and eight occasions measured a 1.33 ms median, 3.46 ms 95th percentile and 5.21 ms maximum. These are historical desktop measurements, not current-build or phone-performance claims.
- Earlier compressed assets measured approximately 99 KB for main JavaScript, 4.3 KB for main CSS, 42.5 KB for the demo dataset and 43.4 KB for separately loaded map JavaScript. Re-measure the deployed build before quoting current bundle sizes.

Earlier desktop and phone screenshots were saved locally in `out/release-qa/` (generated artifacts, excluded from Git). The earlier Codex in-app browser harness did not expose the GPX download event; export serializers remain covered by tests, but downloaded files and Google My Maps import need checking in target browsers before a wider launch. Publishing uses the `main` branch's GitHub Pages workflow.

## Useful additions after local verification

These are proposals, not implemented or monitored services:

1. **Construction and monsoon closures:** record affected segments, a reliable source, checked time and expiry so stale reports do not block paths forever.
2. **Verified prices and opening hours:** replace placeholder budgets and availability with dated local observations and an explicit review schedule.
3. **Water, toilets and shelter:** survey useful points, actual entrances, access restrictions and accessibility details before exposing them as route options.

Each addition depends on verified MIT Manipal data and a process for keeping it current. Keep the public-demo label until those underlying observations justify stronger claims.
