# Local development and releases

## Setup

Use Node.js 24 and the committed npm lockfile. The default app needs no API key or backend.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. If sunset prevents planning, select a daytime preview.
`npm run build` writes `dist/`; `npm run preview` serves it locally. Test a sub-path with `npm run preview -- --base /campus-loops/`.

## Checks and data tools

| Command | Purpose |
| --- | --- |
| `npm run verify` | Lint, type-check, unit/invariant tests and production build |
| `npm run test:watch` | Unit-test watch mode |
| `npm run test:browser` | Real-map browser checks at root and Pages paths |
| `npm run test:browser:google` | Placeholder-key build and locally stubbed Google API |
| `npm run benchmark` | Repeatable planner workload; compare on the same machine |
| `npm run data:check -- <file>` | Validate a dataset; defaults to the app's saved dataset |
| `npm run data:geojson -- <file>` | Export validated data for visual inspection |
| `npm run data:fixture` | Regenerate the synthetic test fixture |
| `npm run data:osm` | Rebuild the saved OSM dataset; see provenance before refreshing |
| `npm audit --audit-level=moderate` | Query current dependency advisories |

Install the browser runtime with `npx playwright install --with-deps chromium`.
The real-map suite previews the existing `dist/`; build it without a Google key. The Google suite builds separately into `dist-google/` using a fake key and stubbed responses.
`BROWSER_EXECUTABLE_PATH` can select an existing Chromium browser. `BROWSER_BASE_URL` targets a published site for the real-map suite.
Add `?data=fixture` to use the synthetic grid. `data:check --production` rejects the current demo assumptions as expected.

## Optional providers

Copy `.env.example` to `.env.local`. Never commit that file or a server secret.
For Google Maps, configure `VITE_GOOGLE_MAPS_API_KEY` and optionally `VITE_GOOGLE_MAPS_MAP_ID`.
Enable Maps JavaScript API and Places API (New) in the provider project. Restrict the browser key to the intended website addresses and those APIs.
Review current [Google Maps billing documentation](https://developers.google.com/maps/billing-and-pricing/overview) before enabling it; quota guards and budget alerts do not guarantee zero charges.
The key is public in the built JavaScript. A rejected key should fall back to the default map.
For a custom raster provider, set `VITE_MAP_TILE_URL`, `VITE_MAP_TILE_MAX_ZOOM` and plain-text `VITE_MAP_TILE_ATTRIBUTION` as described in `.env.example`.
Tiles do not refresh saved paths, hours or prices.

## Short release checklist

- Run `npm ci`, `npm run verify`, `npm run data:check` and `npm audit --audit-level=moderate`.
- Build without a Google key; run `npm run test:browser -- --repeat-each=2` and `npm run test:browser:google`.
- Check phone/desktop layout, keyboard focus, map failure/retry, shared-route rejection, saving/backups and export links.
- Review dataset changes and keep the demo label until access, entrances, hours, prices, steps and cover are surveyed.
- If optional Google settings change, separately check the actual provider configuration; the stub suite does not verify billing or a real key.
- After an authorised deployment, verify the published URL, shared walk and release manifest rather than treating a local build as publication evidence.

The existing Pages workflow runs those automated gates and deploys successful `main` releases. PRs and other branches do not deploy through it.
Repository settings and secrets are managed separately; this guide does not imply they have been changed.
For an already-connected Vercel mirror, retain the root configuration: Vite, `npm ci`, `npm run build`, output `dist`, Node 24. Its build alone does not run all tests.
If moving domains, update canonical metadata and export browser-local plans before moving. There is no automatic storage migration.

## Data refresh and field verification

Follow [data provenance](DATA_PROVENANCE.md) before using `data:osm -- --fetch` or `--elevation`.
Review fresh paths/restrictions locally and check real entrances, crossings, hours, prices and accessibility before describing routes as verified.
A successful structural check does not establish real-world access or safety. Keep the original source snapshot/checksum together.
