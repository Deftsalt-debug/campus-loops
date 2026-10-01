# Public demo release

Campus Loops can be released as a **public demo**. Its planner runs locally and the repository deploys a static build. The Manipal dataset has not been field-checked: real path geometry and place names come from OSM, while prices and some hours are placeholders. Publishing the software does not make those observations verified.

## Before publishing a build

Run with Node.js 24 and the committed lockfile:

```bash
npm ci
npm run verify
npm run data:check -- src/data/manipal-demo.json
npm audit --audit-level=high
```

Use `npm run preview` to check the build, including loading it under the `/campus-loops/` sub-path. Verify phone and desktop layouts, keyboard navigation, light/dark themes, route selection, Map/List tabs, the after-sunset preview, a valid shared plan, an invalid shared plan, saving/reopening/removing plans, Google Maps, KML/GPX exports, and logging/exporting/clearing a real walking time. Block the tile host once to check the map's failure message and usable itinerary. Test with storage blocked to check that Save/logging reports failure.

The GitHub workflow runs automated checks before uploading `dist/`. Deployment occurs only from `main`; pull requests and workflow runs from other branches cannot publish. Set **Settings → Pages → Source = GitHub Actions**. Require the verification job on pull requests in branch protection. Enable Dependabot alerts and private vulnerability reporting in repository settings.

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

## Verification recorded on 1 October 2026

- `npm run verify`: lint and TypeScript checks pass, 1,421 tests pass in 15 files, production build passes. The live dependency audit reported zero vulnerabilities.
- Structural validation of the demo reports zero errors. Production validation intentionally rejects its demo marker and 21 placeholder values; field verification remains required.
- The built app loads and reconstructs a shared walk at `/campus-loops/`. Browser checks cover all eight occasions, invalid duration/budget inputs, a passed back-by time, saved-walk reopening and reload, outdated data links, preserved custom stop times and buffers, copy feedback, and calibration save/clear.
- Layout checks at 320×740, 360×800, 844×390, and 1280×900 found no page overflow or form controls extending beyond the viewport. Mobile tabs support arrow-key switching and hide the inactive panel. Light and dark views were inspected.
- A separate build with an unavailable tile host shows a retry notice while retaining route lines, attribution, and the itinerary. A missing map-library chunk offers a reload action.
- Independently exported 74 demo itineraries and parsed all 148 GPX/KML documents with Python's XML parser; every document is valid XML.
- A local Node benchmark over 320 requests across four starts and eight occasions measured a 1.33 ms median, 3.46 ms 95th percentile, and 5.21 ms maximum. These are desktop measurements; test a representative phone before claiming phone performance.
- The final build's compressed main JavaScript is approximately 99 KB, its main CSS 4.3 KB, the demo dataset 42.5 KB, and the separately loaded map JavaScript 43.4 KB.

Desktop and phone screenshots are saved locally in `out/release-qa/` (generated artifacts, excluded from Git). The Codex in-app browser did not expose the GPX download event to the test harness; export serializers are covered by tests, but check downloaded files and Google My Maps import in your target browsers before a wider launch. Publishing uses the `main` branch's GitHub Pages workflow.
