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

Use `npm run preview` to check the build, including loading it under the `/campus-loops/` sub-path. Verify phone and desktop layouts, keyboard navigation, light/dark themes, each sentence editor (occasion, start, time, budget), Must-visit and Options, route selection from cards and from the map, timeline ↔ pin linking, the phone map's expand and two-finger hint, the drawer, **Show entire route**, the after-sunset preview, a valid shared plan, an invalid shared plan, saving/reopening/removing plans, **Start in Google Maps**, KML/GPX exports, and logging/exporting/clearing a real walking time. Search the campus catalogue, add two must-visits, remove one and check unavailable places; try a short class gap with different return buffers. Check that returning to a backgrounded tab refreshes the departure/deadline. Block the tile host once to check the map's failure message and usable itinerary. Test with storage blocked to check that Save/logging reports failure.

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

## Fifth review — interface flow and map responsiveness (2 October 2026)

User testing reported a cluttered page with no clear order of events, and a map that lagged behind its buttons. This review redesigns the interface around **describe → choose → go** without removing any feature. See [How the interface works](README.md#how-the-interface-works).

- **Flow.** The eight occasion tiles and long form became one editable sentence with an editor tray, plus a Café stop / Must-visit / Options row; Options counts and summarises anything changed from the occasion defaults. Walk cards are compact, with route-shape thumbnails. The chosen walk has one primary action (**Start in Google Maps**) and its exports in disclosures. Saved walks, field notes, data notes, privacy and calibration moved into a drawer. The phone page went from about 3,600 px to 2,600 px tall with every control still reachable.
- **Linking.** Card hover/focus previews its route; map-line hover highlights its card; a map pin highlights its itinerary row and a row highlights (or, via its pin button, pans to) its pin. On phones, "show on map" scrolls the map into view.
- **Map lag, root cause.** A trace of six walk selections showed **3.6 s of the 5.2 s** of main-thread work was the full-viewport backdrop canvas being re-rasterised and re-uploaded every frame for ~900 ms after each tap, competing with map animation. The backdrop is now a CSS dot pattern with compositor-only hotspot and ripple layers (same look). Main-thread work for the same six selections fell to **1.6 s**.
- **Map lag, structure.** One Leaflet map for the page's lifetime: the phone Map tab rebuilt it on every visit (three builds in three visits); crossing the breakpoint now keeps the same instance (verified). Zoom animation is back on (with a guard for Leaflet 1.9.4's post-`remove()` zoom callback), selections fly to the route, the line draws itself and pins pop in order. Tiles keep Leaflet's default buffer. The accent colour is cached instead of forcing a style recalculation on every map update. Selecting a walk commits the card first and renders the itinerary and map in a deferred pass.
- **Measured** with Chromium Event Timing at 4× CPU throttling (median of 6 selections / 3–6 budget changes; same machine, previous build alongside):

  | Interaction | Before | After |
  |---|---|---|
  | Select a walk, laptop | 232 ms, 64 long frames | **144 ms, 9 long frames** |
  | Select a walk, phone (map now live, previously hidden) | 128 ms | 160 ms |
  | Change budget, laptop | 160 ms, 28 long frames | **144 ms, 10–15 long frames** |
  | Open the phone map | 112 ms + full map rebuild | **0 ms (always present)** |

  These are emulated measurements, not physical-phone results.
- **Checks.** `npm run verify`: **1,770 tests pass across 22 files** (new: sentence phrasing, adjusted-option summary, route-thumbnail projection, download file names); lint, TypeScript and build pass; zero dependency vulnerabilities. Scripted browser runs covered every editor, keyboard-only use (tab order follows the sentence, arrow keys in radio groups, Escape returns focus), the after-hours blocker and its preview recovery, shared and invalid links, saving with the header badge, drawer open/close, map expand with scroll lock, dark mode and reduced motion. No page overflow at 320×740, 844×390, 1024×768 or 1280×900 with every tray open; no console errors.
- **QA audit.** A scripted end-to-end pass on the production build (79 checks) covered every occasion and start, invalid and custom durations/budgets, the free budget, the café toggle, must-visit search/add/remove with fractional, over-limit and reset stop times, the Options summary, comparison-table selection, Share and Copy (clipboard contents), the Google Maps URL, KML/GPX/ICS downloads, save → open → remove, backup export and duplicate-merging restore, notebook save/export/remove, calibration log/count/clear, the after-hours blocker and preview recovery, shared, invalid, other-dataset-version and hash-change links, the fixture dataset, blocked storage, the phone map (inline gestures, two-finger hint, modal full screen with inert background, Escape, rotating to wide), the phone bottom sheet, and loading from the `/campus-loops/` sub-path. axe-core reported **0 violations** (WCAG 2.2 AA + best practice) across 48 states (12 UI states × light/dark × laptop/phone); every text/background token pair was computed to pass AA in both themes (tightest: accent on its tint, 4.53:1). The planner benchmark digest is unchanged.
- **Fixed during QA:** the sentence's start token and the map's start pin shared an accessible name; invalid sentence values used `aria-invalid` on a button (now described by the visible error, which also stays visible for an invalid preview time with its editor closed); walk cards announced every statistic as their name (now name + description); step 2 had no message when inputs were invalid; the full-screen phone map left covered controls reachable by Tab and stayed expanded after rotating to the wide layout; fractional map zoom blurred tiles; and (pre-existing) download names dropped accented letters (`caf-stop` → `cafe-stop`).
- **Size.** App CSS **9.44 KB** gzip (was 5.02) for the new component styles and motion; main JavaScript **112.85 KB** gzip (was 108.52). No dependencies were added.

## Final production-build audit — 2 October 2026

- Reinstalled the exact lockfile with `npm ci`, reran lint, TypeScript, the full suite and the production build, and checked npm advisories. **1,759 tests pass across 21 files; zero dependency vulnerabilities.** No new dependencies were added.
- Added a 768-case real-campus audit (six starts × eight modes × sixteen scenarios), independently replaying route continuity, walking time, stop arrival/opening windows, spend, required visits, return buffers, deadlines and exact encoded-share rebuilding. It covers zero/fractional visits, rain, avoiding steps, Sunday hours, closed periods and class breaks.
- Fixed an invalid-share crash: inherited object properties (`constructor`, `toString`, `__proto__`) now fail occasion validation. The old deployed build reproduced the crash; the fixed production build displays the invalid-link notice and remains usable.
- Fixed saved-walk/calibration mutations that silently overwrote damaged storage. Damaged records now pause writes, readable entries remain exportable, and recovery is explicit. Saved-walk overflow preserves all readable records. Browser checks seeded disposable mixed valid/invalid records, verified Save and Restore were blocked, verified repair retained the valid walk, and verified explicit calibration Clear recovered the log. The temporary fixture was removed by the clean production rebuild and is absent from `dist/`.
- Fixed stale hover references hiding the selected map route after recommendations change. Default Google Maps links now preserve every visit within the [three-waypoint mobile-browser contract](https://developers.google.com/maps/documentation/urls/get-started#directions-action); 272 campus plans and a long-route regression verify stop order, waypoint counts and URL length.
- Production-browser checks at `/campus-loops/`: Food Court 1 → library exterior, departure 10:00, back by 10:40, ten-minute return buffer returns at 10:22. Raising the buffer to twenty minutes correctly rejects the outing as needing 43 minutes. Save/reload preserves the exact route, deadline and buffer. Native time-editor keyboard events were verified against the resulting shared link.
- Widths 320×740, 844×390 and 1280×900 have no page overflow; Map/Itineraries navigation, zoom and route refit retain one map and the selected pins across remounts. Healthy-browser checks produced no new warning/error logs. A separate build with missing map tiles retained its route lines, pins and usable itinerary, displayed the failure message and supported retry. Missing provider attribution also produced a usable fallback.
- Final local benchmark: median **1.37 ms**, p95 **8.84 ms**, maximum **14.58 ms** over 288 timed samples. Result digest remains unchanged from the previous release. Main JavaScript is **108.52 KB gzip**; app CSS **5.02 KB**, demo data **41.87 KB**, map JavaScript **43.37 KB**.
- Structural data validation passes. Strict `--production` validation intentionally fails with the fixture marker plus **33 unverified price/hour values**. This is a verified software build for a public demo, not field-verified campus guidance. Previous downloaded-file/calendar-import limitations still apply; target-device and in-person validation are not claimed.

## Fourth review — student tools and optimization (2 October 2026)

- Added editable 0–120 minute stops, a route comparison table, saved-walk JSON backup/restore, and a local campus field notebook. Notes are explicitly unverified observations and never change the planner automatically.
- Two QA passes: focused feature tests plus independent cross-review, then the full suite and browser scenarios against development and separately built production pages at `/campus-loops/`. **1,693 tests pass across 20 files**; lint, TypeScript and the production build pass. Dependency audit: **zero vulnerabilities**. Dataset validation: zero errors; the fixture flag and 33 placeholder price/hour values remain visible warnings.
- Fixed café pass-bys counting as café visits or purchases, a rain-mode false negative when a less sheltered loop returns faster, calendar-event collisions across starts/map versions, malformed restored links changing the page path, readable notebook overflow being discarded, and a comparison-table overflow at 320 px. Regressions cover core rules, atomic restore, storage failures, overflow preservation and calendar identity.
- Browser scenarios: fractional/zero/blank/over-limit stop times; reset and preserved optional overrides; comparison selection updating the route; backup merge and duplicate counts; invalid backup rejection preserving saved records; restoring a custom-time route; notebook save/reload/delete; saved-walk and notebook changes propagating to another tab. Responsive checks at 320×740, 844×390 and 1280×900 show no page overflow. The comparison table scrolls with the keyboard, mobile tabs work, and repeated map zoom/remounts retain one map with no console errors.
- A repeated 96-request campus benchmark (288 measured samples after warmup) improved from median **1.71 ms**, p95 **17.02 ms**, total **993.22 ms** to median **1.32 ms**, p95 **8.60 ms**, total **587.72 ms** on this development machine. The full result digest stayed `303b108c961c5ce3764c5ee0979e2cafb5ac45c006e01b8d9ae5039971bf5b3b`. Targeted loop-return searches stop when the destination is settled; edge weights are cached only within each request. Run `npm run benchmark` to repeat; these are desktop measurements, not physical-phone results.
- Compressed production assets: main JavaScript **107.64 KB**, app CSS **5.02 KB**, demo data **41.87 KB**, separately loaded map JavaScript **43.37 KB**. No dependencies were added.
- Backup serialization and real file-chooser imports passed. The in-app browser reported the export action but did not expose its download event; actual downloaded-file handling and importing ICS into an external calendar remain target-browser checks. Screenshots and disposable import fixtures are in ignored `out/next-features-qa/`.

The release remains a public demo until campus paths, entrances, steps, cover, prices and hours have been checked locally. The notebook makes that field work easier without promoting observations to trusted data.

## Third review — loops, defaults, calendar (1 October 2026, evening)

- `npm run verify`: **1,588 tests pass across 18 files**; lint, typecheck and the production build pass. Audit: zero vulnerabilities.
- Content sweep (6 starts × 8 modes × 3 times): every mode's defaults now return walks from every start at midday, except the documented study-break-from-Food-Court-2 case. Out-and-back suggestions fell from about 80% to 40% with *loop home*. No request took over 40 ms.
- Loop plans (`l:` ids) rebuild identically from share links. That's covered by the 1,152-request invariant matrix and dedicated tests, including the loop being refused once it no longer fits.
- Calendar export follows RFC 5545 (CRLF, escaping, folding, UTC), with tests for each. A shell-escaping slip in the semicolon escape was caught by lint and is pinned by a test.
- In-app browser: the loop line meets the start and stop pins exactly; keyboard, labelling, 360 px layout and shared-link reload all checked. No console errors.

## Earlier automated verification — 1 October 2026 (before the third review)

- `npm run verify`: lint and TypeScript checks pass, **1,527 tests pass across 17 files**, and the production build passes. The dependency audit reports **zero vulnerabilities**.
- Structural validation of the regenerated Manipal dataset reports **zero errors**. Production validation correctly rejects the fixture marker and **33 placeholder hours/price values**; the routes are not a verified production pilot.
- Saved-route reconstruction now checks the requested sequence independently of recommendation ranking. A feasible saved walk remains available when another stop enters the shortlist; closed or infeasible saved walks are rejected rather than replaced. An independent sweep rebuilt 165 recommendations across the current starts, occasion modes and rain settings to exactly one identical plan at the same departure time, with no failures.
- Every generated outing must include positive walking distance. The live Food Court 2 check exposed a stationary meal being offered as a walk; regression tests now reject stationary stops and zero-distance gate-delay loops while allowing a stop at the starting point followed by a real walk. Both synthetic and six-start/eight-mode dataset sweeps enforce positive walking distance and time.
- Dataset/share identifiers cannot ambiguously combine `a` plus `b` with a place named `a.b`; place IDs cannot contain the route separator. Empty routing datasets are rejected. Saved plans and calibration records reject impossible dates and timestamps without a timezone, retain supported existing ISO records, and discard undocumented fields.
- Catalogue tests cover name/category/interest search, unknown details, adding/removing/replacing must-visits and preserving both slots. A real planning scenario verifies that a chosen stop fits a 30-minute class gap with a 10-minute buffer, while a 20-minute buffer correctly leaves no feasible plan.
- Importer tests cover pedestrian access precedence, forward and reverse access, conditional restrictions, pedestrian exceptions to one-way tags, private barriers, weekday mapping, invalid/overnight/overlapping hours, and explicit closures. Unsupported supplied hours remain unavailable; only missing hours use labelled demo assumptions. The snapshot checksum is tied to the dataset version.
- Map configuration tests reject unsupported or incomplete placeholders before map initialization. The map includes a route refit control; occasion selection supports Home/End, and calibration instructions distinguish walking time from stops and buffers without promising automatic adjustment.

## Earlier browser verification — 1 October 2026 (before the third review)

Checked the built app with the six-start dataset using the in-app browser, separately from the development server:

| Scenario | Observed result |
|---|---|
| Food Court 1 to the library exterior, 45-minute allowance, back by 10:40, 10-minute buffer | Returns by 10:22, retains the buffer, costs zero under the explicitly labelled demo assumptions. |
| Same request with a 20-minute buffer | Rejects the outing: the shortest suitable plan needs 43 minutes, beyond the 40-minute deadline. |
| Back-by time 09:40 with departure at 10:00 | Shows an already-passed deadline and offers no route. Native time-editor input updates the shared link correctly. |
| Saved route, reload, shared link | Preserves the exact stop sequence, deadline and buffer; the saved indicator survives reload. |
| Copy itinerary; log 20 walking minutes; clear the test log | Copy feedback appears, the local log count changes from 0 to 1, and clearing restores 0. |
| Map and layout | Map tiles and route markers render; Show entire route refits the selected walk. Mobile Map/Itineraries tabs switch by click and arrow key. Only one map instance is mounted. |
| Rapid map teardown | Six repeated desktop → mobile → desktop switches, with zoom buttons and route refitting between switches, retain one working map with loaded tiles and no warning/error logs. Zoom transitions are disabled to avoid Leaflet 1.9.4's uncancelled completion callback after teardown; pan and tile fades remain available. |
| Responsive widths | At 320×740, 360×800, 844×390 and 1280×900, the page has no horizontal overflow and form controls remain within the viewport. Dark appearance was visually inspected. |

Development-browser checks also exercised campus search by library/food, two-stop capacity, removing a stop, and safe recovery from a link to the previous dataset version. A later resize stress check exposed a Leaflet zoom-callback error; the final built-app regression above confirms the fix. Other exercised planning/storage flows reported no warning or error logs. Screenshots are local generated artifacts in `out/current-qa/`. This pass does not claim a fresh light-theme, physical-phone, denied-storage, tile-outage, downloaded-file or Google My Maps import check; related automated regressions and earlier baseline evidence are listed separately.

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
